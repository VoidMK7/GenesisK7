/**
 * NovaTrade Six-Agent Engine
 * Location: supabase/functions/api/agents/novatrade-agents.ts
 *
 * SAFE MODE:
 * - Reads public market data from DexScreener.
 * - Produces research, risk assessments and watch/avoid decisions.
 * - "Execution" is PAPER-ONLY. There is deliberately no wallet, signing,
 *   private-key, swap, buy, or sell integration in this module.
 * - Learning adapts scoring weights from recorded paper outcomes. It does not
 *   train an underlying language model.
 *
 * Integrate by importing runNovaTradeAgents() from an existing Supabase
 * Edge Function route. See the usage example at the bottom.
 */

export type AgentName =
  | "scanner"
  | "research"
  | "risk"
  | "strategy"
  | "paper-execution"
  | "learning";

export type Decision = "WATCH" | "AVOID" | "PAPER_BUY" | "PAPER_HOLD";

export interface NovaTradeConfig {
  chainId: string;
  tokenAddresses: string[];
  maxTokens?: number;
  paperStartingBalanceUsd?: number;
  paperAllocationPct?: number;
  minLiquidityUsd?: number;
  minVolume24hUsd?: number;
  minScoreToPaperBuy?: number;
  maxRiskScore?: number;
  fetchTimeoutMs?: number;
}

export interface MarketSnapshot {
  chainId: string;
  tokenAddress: string;
  pairAddress: string;
  dexId: string;
  url?: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
  priceChange6hPct: number;
  priceChange24hPct: number;
  txns24h: { buys: number; sells: number };
  fdvUsd?: number;
  pairCreatedAt?: number;
}

export interface AgentFinding {
  agent: AgentName;
  status: "ok" | "warning" | "blocked";
  summary: string;
  details: Record<string, unknown>;
}

export interface TokenAssessment {
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  score: number;
  riskScore: number;
  decision: Decision;
  reasons: string[];
  market: MarketSnapshot;
  agents: AgentFinding[];
}

export interface PaperPosition {
  tokenAddress: string;
  symbol: string;
  entryPriceUsd: number;
  quantity: number;
  investedUsd: number;
  openedAt: string;
  status: "OPEN";
}

export interface PaperPortfolio {
  startingBalanceUsd: number;
  cashUsd: number;
  positions: PaperPosition[];
  paperTrades: Array<{
    tokenAddress: string;
    symbol: string;
    side: "PAPER_BUY";
    priceUsd: number;
    amountUsd: number;
    createdAt: string;
    note: string;
  }>;
}

export interface LearningState {
  observations: number;
  successfulPaperSignals: number;
  unsuccessfulPaperSignals: number;
  scoreAdjustment: number;
  lastUpdatedAt: string | null;
}

export interface LearningStore {
  load(): Promise<LearningState | null>;
  save(state: LearningState): Promise<void>;
}

export interface NovaTradeResult {
  generatedAt: string;
  mode: "LIVE_MARKET_DATA_PAPER_EXECUTION";
  agents: AgentName[];
  assessments: TokenAssessment[];
  portfolio: PaperPortfolio;
  learning: LearningState;
  notices: string[];
}

const DEFAULTS = {
  maxTokens: 20,
  paperStartingBalanceUsd: 100,
  paperAllocationPct: 0.05,
  minLiquidityUsd: 10_000,
  minVolume24hUsd: 5_000,
  minScoreToPaperBuy: 65,
  maxRiskScore: 55,
  fetchTimeoutMs: 8_000,
};

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (value: unknown): number => num(value);

function emptyLearningState(): LearningState {
  return {
    observations: 0,
    successfulPaperSignals: 0,
    unsuccessfulPaperSignals: 0,
    scoreAdjustment: 0,
    lastUpdatedAt: null,
  };
}

function emptyPortfolio(startingBalanceUsd: number): PaperPortfolio {
  return {
    startingBalanceUsd,
    cashUsd: startingBalanceUsd,
    positions: [],
    paperTrades: [],
  };
}

/** Agent 1: discovers current pairs for supplied token addresses. */
async function scannerAgent(
  chainId: string,
  tokenAddresses: string[],
  timeoutMs: number,
): Promise<{ markets: MarketSnapshot[]; finding: AgentFinding }> {
  const markets: MarketSnapshot[] = [];
  const errors: string[] = [];

  for (const address of tokenAddresses) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url =
        `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        errors.push(`${address}: market provider returned ${response.status}`);
        continue;
      }

      const rows = await response.json();
      if (!Array.isArray(rows)) continue;

      const matching = rows
        .filter((row: any) =>
          String(row?.chainId ?? "").toLowerCase() === chainId.toLowerCase()
        )
        .sort((a: any, b: any) =>
          num(b?.liquidity?.usd) - num(a?.liquidity?.usd)
        );

      const pair = matching[0];
      if (!pair?.baseToken?.address) continue;

      // The requested token can appear as either side of a pair.
      const requested = address.toLowerCase();
      const isBase = String(pair.baseToken.address).toLowerCase() === requested;
      const token = isBase ? pair.baseToken : pair.quoteToken;
      const quote = isBase ? pair.quoteToken : pair.baseToken;
      const price = num(pair.priceUsd);

      markets.push({
        chainId,
        tokenAddress: address,
        pairAddress: String(pair.pairAddress ?? ""),
        dexId: String(pair.dexId ?? "unknown"),
        url: typeof pair.url === "string" ? pair.url : undefined,
        baseToken: {
          address: String(token?.address ?? address),
          name: String(token?.name ?? "Unknown"),
          symbol: String(token?.symbol ?? "UNKNOWN"),
        },
        quoteToken: {
          address: String(quote?.address ?? ""),
          symbol: String(quote?.symbol ?? ""),
        },
        priceUsd: price,
        liquidityUsd: num(pair?.liquidity?.usd),
        volume24hUsd: num(pair?.volume?.h24),
        priceChange5mPct: pct(pair?.priceChange?.m5),
        priceChange1hPct: pct(pair?.priceChange?.h1),
        priceChange6hPct: pct(pair?.priceChange?.h6),
        priceChange24hPct: pct(pair?.priceChange?.h24),
        txns24h: {
          buys: num(pair?.txns?.h24?.buys),
          sells: num(pair?.txns?.h24?.sells),
        },
        fdvUsd: pair?.fdv == null ? undefined : num(pair.fdv),
        pairCreatedAt: pair?.pairCreatedAt == null
          ? undefined
          : num(pair.pairCreatedAt),
      });
    } catch (error) {
      errors.push(
        `${address}: ${error instanceof Error ? error.message : "fetch failed"}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    markets,
    finding: {
      agent: "scanner",
      status: errors.length ? "warning" : "ok",
      summary: `Found ${markets.length} market pair(s) from public market data.`,
      details: { requested: tokenAddresses.length, found: markets.length, errors },
    },
  };
}

/**
 * Agent 2: research + developer-watch screening.
 * Public pair data cannot prove who controls a token or whether a developer
 * is selling. Those facts are marked UNKNOWN rather than guessed.
 */
function researchAgent(market: MarketSnapshot): AgentFinding {
  const buyCount = market.txns24h.buys;
  const sellCount = market.txns24h.sells;
  const total = buyCount + sellCount;
  const buyRatio = total > 0 ? buyCount / total : 0;
  const ageHours = market.pairCreatedAt
    ? Math.max(0, (Date.now() - market.pairCreatedAt) / 3_600_000)
    : null;

  const flags: string[] = [];
  if (total < 20) flags.push("Low 24-hour transaction count");
  if (buyRatio < 0.35 && total > 0) flags.push("Sell transactions outweigh buys");
  if (ageHours !== null && ageHours < 2) flags.push("Very new trading pair");
  if (!market.pairCreatedAt) flags.push("Pair age unavailable");
  flags.push("Developer wallet activity: UNKNOWN (not verified by this feed)");
  flags.push("Ownership/renounced status: UNKNOWN (not verified by this feed)");

  return {
    agent: "research",
    status: flags.length > 2 ? "warning" : "ok",
    summary: "Reviewed pair age, trading activity and available public metadata.",
    details: {
      buyRatio: Number(buyRatio.toFixed(3)),
      transactions24h: total,
      pairAgeHours: ageHours === null ? "unknown" : Number(ageHours.toFixed(2)),
      developerWalletStatus: "UNKNOWN",
      ownershipStatus: "UNKNOWN",
      flags,
    },
  };
}

/** Agent 3: conservative market-risk scoring; not a security audit. */
function riskAgent(
  market: MarketSnapshot,
  research: AgentFinding,
  minLiquidityUsd: number,
  minVolume24hUsd: number,
): { riskScore: number; finding: AgentFinding; reasons: string[] } {
  let risk = 20;
  const reasons: string[] = [];

  if (market.liquidityUsd < minLiquidityUsd) {
    risk += 25;
    reasons.push("Liquidity is below the configured minimum");
  }
  if (market.volume24hUsd < minVolume24hUsd) {
    risk += 15;
    reasons.push("24-hour volume is below the configured minimum");
  }
  if (market.priceChange24hPct > 100) {
    risk += 15;
    reasons.push("Large 24-hour price increase; elevated volatility");
  }
  if (market.priceChange24hPct < -35) {
    risk += 15;
    reasons.push("Large 24-hour price decline");
  }
  if (market.txns24h.sells > market.txns24h.buys * 1.8) {
    risk += 15;
    reasons.push("Sell pressure is substantially higher than buy activity");
  }

  const researchFlags = (research.details.flags as string[]) ?? [];
  if (researchFlags.includes("Very new trading pair")) {
    risk += 10;
    reasons.push("Very new pair has limited history");
  }
  if (researchFlags.some((flag) => flag.includes("UNKNOWN"))) {
    risk += 10;
    reasons.push("Important developer/ownership checks are unavailable");
  }

  risk = clamp(risk, 0, 100);
  if (!reasons.length) reasons.push("No configured market-risk threshold was triggered");

  return {
    riskScore: risk,
    reasons,
    finding: {
      agent: "risk",
      status: risk >= 70 ? "blocked" : risk >= 50 ? "warning" : "ok",
      summary: `Market risk score: ${risk}/100. This is a screening estimate, not a safety guarantee.`,
      details: { riskScore: risk, reasons },
    },
  };
}

/** Agent 4: ranks candidates; never submits a real order. */
function strategyAgent(
  market: MarketSnapshot,
  riskScore: number,
  learningAdjustment: number,
  minScore: number,
  maxRisk: number,
): { score: number; decision: Decision; reasons: string[]; finding: AgentFinding } {
  const volumeToLiquidity = market.liquidityUsd > 0
    ? market.volume24hUsd / market.liquidityUsd
    : 0;
  const totalTx = market.txns24h.buys + market.txns24h.sells;
  const buyRatio = totalTx > 0 ? market.txns24h.buys / totalTx : 0;

  let score = 35;
  score += clamp(Math.log10(Math.max(1, market.liquidityUsd)) * 4, 0, 24);
  score += clamp(Math.log10(Math.max(1, market.volume24hUsd)) * 3, 0, 18);
  score += clamp((buyRatio - 0.5) * 24, -12, 12);
  score += clamp(volumeToLiquidity * 8, 0, 8);
  score -= riskScore * 0.45;
  score += clamp(learningAdjustment, -8, 8);
  score = Math.round(clamp(score, 0, 100));

  const reasons = [
    `Liquidity: $${market.liquidityUsd.toFixed(0)}`,
    `24-hour volume: $${market.volume24hUsd.toFixed(0)}`,
    `Buy share: ${(buyRatio * 100).toFixed(1)}%`,
    `Risk score: ${riskScore}/100`,
    `Learning adjustment: ${learningAdjustment.toFixed(1)}`,
  ];

  let decision: Decision = "WATCH";
  if (riskScore > maxRisk) decision = "AVOID";
  else if (score >= minScore) decision = "PAPER_BUY";

  return {
    score,
    decision,
    reasons,
    finding: {
      agent: "strategy",
      status: decision === "AVOID" ? "blocked" : "ok",
      summary: `Strategy score ${score}/100 produced ${decision}.`,
      details: { score, decision, reasons },
    },
  };
}

/** Agent 5: simulated execution only. */
function paperExecutionAgent(
  assessments: TokenAssessment[],
  portfolio: PaperPortfolio,
  allocationPct: number,
): { portfolio: PaperPortfolio; findings: Map<string, AgentFinding> } {
  const findings = new Map<string, AgentFinding>();
  const maxOpenPositions = 2;

  for (const assessment of assessments) {
    if (assessment.decision !== "PAPER_BUY") continue;

    const alreadyOpen = portfolio.positions.some(
      (position) => position.tokenAddress.toLowerCase() ===
        assessment.tokenAddress.toLowerCase(),
    );
    if (alreadyOpen) {
      findings.set(assessment.tokenAddress, {
        agent: "paper-execution",
        status: "warning",
        summary: "Skipped: a simulated position already exists.",
        details: { reason: "duplicate_position" },
      });
      continue;
    }
    if (portfolio.positions.length >= maxOpenPositions) {
      findings.set(assessment.tokenAddress, {
        agent: "paper-execution",
        status: "warning",
        summary: "Skipped: paper portfolio reached its open-position limit.",
        details: { maxOpenPositions },
      });
      continue;
    }

    const amount = Math.min(
      portfolio.cashUsd,
      portfolio.cashUsd * clamp(allocationPct, 0.01, 0.10),
    );
    if (amount <= 0 || assessment.priceUsd <= 0) {
      findings.set(assessment.tokenAddress, {
        agent: "paper-execution",
        status: "blocked",
        summary: "Skipped: invalid simulated balance or price.",
        details: {},
      });
      continue;
    }

    portfolio.cashUsd -= amount;
    portfolio.positions.push({
      tokenAddress: assessment.tokenAddress,
      symbol: assessment.symbol,
      entryPriceUsd: assessment.priceUsd,
      quantity: amount / assessment.priceUsd,
      investedUsd: amount,
      openedAt: new Date().toISOString(),
      status: "OPEN",
    });
    portfolio.paperTrades.push({
      tokenAddress: assessment.tokenAddress,
      symbol: assessment.symbol,
      side: "PAPER_BUY",
      priceUsd: assessment.priceUsd,
      amountUsd: amount,
      createdAt: new Date().toISOString(),
      note: "Simulated trade only. No wallet or funds were accessed.",
    });

    findings.set(assessment.tokenAddress, {
      agent: "paper-execution",
      status: "ok",
      summary: `Recorded a simulated $${amount.toFixed(2)} paper position.`,
      details: { amountUsd: amount, quantity: amount / assessment.priceUsd },
    });
  }
  return { portfolio, findings };
}

/** Agent 6: adjusts future score bias from outcomes supplied by the app. */
function learningAgent(
  state: LearningState,
  feedback?: { successfulSignals?: number; unsuccessfulSignals?: number },
): { state: LearningState; finding: AgentFinding } {
  const successful = Math.max(0, Math.floor(feedback?.successfulSignals ?? 0));
  const unsuccessful = Math.max(0, Math.floor(feedback?.unsuccessfulSignals ?? 0));

  state.successfulPaperSignals += successful;
  state.unsuccessfulPaperSignals += unsuccessful;
  state.observations += successful + unsuccessful;

  const total = state.successfulPaperSignals + state.unsuccessfulPaperSignals;
  if (total >= 5) {
    const successRate = state.successfulPaperSignals / total;
    // Small bounded adjustment; never overrides the hard risk gate.
    state.scoreAdjustment = clamp((successRate - 0.5) * 12, -6, 6);
  }
  state.lastUpdatedAt = new Date().toISOString();

  return {
    state,
    finding: {
      agent: "learning",
      status: "ok",
      summary: `Learning state updated from ${state.observations} recorded outcome(s).`,
      details: {
        observations: state.observations,
        successRate: total
          ? Number((state.successfulPaperSignals / total).toFixed(3))
          : null,
        scoreAdjustment: state.scoreAdjustment,
        note: "Learning uses feedback from paper outcomes; it does not guarantee future performance.",
      },
    },
  };
}

/**
 * Main orchestrator. Supply a LearningStore to persist learning state in your
 * own database. Without one, learning state lasts only for this invocation.
 */
export async function runNovaTradeAgents(
  config: NovaTradeConfig,
  options: {
    learningStore?: LearningStore;
    learningFeedback?: {
      successfulSignals?: number;
      unsuccessfulSignals?: number;
    };
    paperPortfolio?: PaperPortfolio;
  } = {},
): Promise<NovaTradeResult> {
  const settings = { ...DEFAULTS, ...config };
  const chainId = String(settings.chainId ?? "").trim();
  const addresses = [...new Set(
    (settings.tokenAddresses ?? [])
      .map((address) => String(address).trim())
      .filter(Boolean),
  )].slice(0, settings.maxTokens);

  if (!chainId) throw new Error("chainId is required.");
  if (!addresses.length) {
    throw new Error("Provide at least one token address to scan.");
  }

  const notices = [
    "This module reads public market data and records simulated trades only.",
    "It does not connect to FOMO, wallets, private keys, or real-money execution.",
    "Developer-wallet and ownership checks are UNKNOWN unless a trusted data source is separately integrated.",
    "Market screening scores are estimates, not guarantees or financial advice.",
  ];

  const priorLearning = await options.learningStore?.load();
  const learning = priorLearning ?? emptyLearningState();

  const scan = await scannerAgent(
    chainId,
    addresses,
    settings.fetchTimeoutMs,
  );

  const assessments: TokenAssessment[] = scan.markets.map((market) => {
    const research = researchAgent(market);
    const risk = riskAgent(
      market,
      research,
      settings.minLiquidityUsd,
      settings.minVolume24hUsd,
    );
    const strategy = strategyAgent(
      market,
      risk.riskScore,
      learning.scoreAdjustment,
      settings.minScoreToPaperBuy,
      settings.maxRiskScore,
    );

    return {
      tokenAddress: market.tokenAddress,
      symbol: market.baseToken.symbol,
      name: market.baseToken.name,
      priceUsd: market.priceUsd,
      score: strategy.score,
      riskScore: risk.riskScore,
      decision: strategy.decision,
      reasons: [...risk.reasons, ...strategy.reasons],
      market,
      agents: [scan.finding, research, risk.finding, strategy.finding],
    };
  }).sort((a, b) => b.score - a.score);

  const portfolio = options.paperPortfolio ??
    emptyPortfolio(settings.paperStartingBalanceUsd);

  const execution = paperExecutionAgent(
    assessments,
    portfolio,
    settings.paperAllocationPct,
  );

  for (const assessment of assessments) {
    const executionFinding = execution.findings.get(assessment.tokenAddress);
    if (executionFinding) assessment.agents.push(executionFinding);
    else {
      assessment.agents.push({
        agent: "paper-execution",
        status: "ok",
        summary: "No simulated transaction was made for this token.",
        details: { decision: assessment.decision },
      });
    }
  }

  const learningResult = learningAgent(learning, options.learningFeedback);
  if (options.learningStore) await options.learningStore.save(learningResult.state);

  for (const assessment of assessments) {
    assessment.agents.push(learningResult.finding);
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "LIVE_MARKET_DATA_PAPER_EXECUTION",
    agents: [
      "scanner",
      "research",
      "risk",
      "strategy",
      "paper-execution",
      "learning",
    ],
    assessments,
    portfolio: execution.portfolio,
    learning: learningResult.state,
    notices,
  };
}

/*
 * Minimal Supabase Edge Function usage (adapt the request/response wrapper to
 * your existing route; do not create a second Deno.serve() if one already exists):
 *
 * import { runNovaTradeAgents } from "../agents/novatrade-agents.ts";
 *
 * const result = await runNovaTradeAgents({
 *   chainId: "solana",
 *   tokenAddresses: ["TOKEN_MINT_ADDRESS"],
 *   paperStartingBalanceUsd: 100,
 * });
 *
 * return new Response(JSON.stringify(result), {
 *   headers: { "content-type": "application/json" },
 * });
 *
 * IMPORTANT: Persist the returned paper portfolio and LearningState in
 * Supabase from your existing server-side route using tables protected by RLS.
 */
