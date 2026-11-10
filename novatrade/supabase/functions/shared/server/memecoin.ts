import { bestPairs, compileRules, DEFAULT_STRATEGY, evaluateToken, NATIVE, paperBuy, paperSell, riskGate, tickPosition, allocationBudget, type MemeChain, type MemePair, type MemeStrategy, type OnchainFacts, type TaughtRule } from "../core/memecoin/index.ts";
import { loadAiClient } from "./ai.ts";
import { notify, serviceDb } from "./auth.ts";

const DEX = "https://api.dexscreener.com";
const timeout = (ms: number) => AbortSignal.timeout(ms);

async function getJson<T>(url: string, ms = 6000, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, signal: timeout(ms), headers: { accept: "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return (await r.json()) as T;
}

// ---------------------------------------------------------------- market data (DexScreener public API; no key)
export async function pairsForTokens(chain: MemeChain, addresses: string[]): Promise<MemePair[]> {
  const out: unknown[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30).map(encodeURIComponent).join(",");
    out.push(...(await getJson<unknown[]>(`${DEX}/tokens/v1/${chain}/${chunk}`)));
  }
  return bestPairs(out);
}

/** Fresh tokens: the latest profiles and boosted tokens DexScreener lists, then their real trading data. */
export async function scanCandidates(chains: MemeChain[], limit = 60): Promise<{ pairs: MemePair[]; errors: string[] }> {
  const errors: string[] = []; const byChain = new Map<MemeChain, Set<string>>();
  const add = (list: { chainId?: string; tokenAddress?: string }[]) => { for (const t of list ?? []) { const c = t.chainId as MemeChain; if (chains.includes(c) && t.tokenAddress) (byChain.get(c) ?? byChain.set(c, new Set()).get(c)!).add(t.tokenAddress); } };
  await Promise.all([`${DEX}/token-profiles/latest/v1`, `${DEX}/token-boosts/latest/v1`].map(async (u) => { try { add(await getJson(u)); } catch (e) { errors.push(e instanceof Error ? e.message : "fetch failed"); } }));
  const pairs: MemePair[] = [];
  await Promise.all([...byChain.entries()].map(async ([c, set]) => { try { pairs.push(...(await pairsForTokens(c, [...set].slice(0, limit)))); } catch (e) { errors.push(e instanceof Error ? e.message : "fetch failed"); } }));
  return { pairs, errors };
}

export async function tokenPair(chain: MemeChain, address: string): Promise<MemePair | null> { return (await pairsForTokens(chain, [address]))[0] ?? null; }

/** Optional contract scan. Only runs when RUGCHECK_ENABLED=true (public RugCheck report API, Solana). Returns undefined on any failure. */
export async function onchainFacts(chain: MemeChain, mint: string): Promise<OnchainFacts | undefined> {
  if (chain !== "solana" || process.env.RUGCHECK_ENABLED !== "true") return undefined;
  try {
    const r = await getJson<any>(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, 6000);
    const top10 = Array.isArray(r.topHolders) ? r.topHolders.slice(0, 10).reduce((a: number, h: any) => a + Number(h.pct ?? 0), 0) : undefined;
    const locked = Array.isArray(r.markets) ? Math.max(0, ...r.markets.map((m: any) => Number(m.lp?.lpLockedPct ?? 0))) : undefined;
    return { source: "rugcheck", mintAuthorityRenounced: r.mintAuthority === null || r.mintAuthority === undefined, freezeAuthorityRenounced: r.freezeAuthority === null || r.freezeAuthority === undefined,
      top10HoldersPct: top10, lpLockedPct: locked };
  } catch { return undefined; }
}

// ---------------------------------------------------------------- chain reads (read-only RPC)
const RPC: Record<MemeChain, string> = {
  solana: "https://api.mainnet-beta.solana.com", base: "https://mainnet.base.org", ethereum: "https://cloudflare-eth.com", bsc: "https://bsc-dataseed.binance.org",
};
export const rpcUrl = (c: MemeChain) => (process.env[`RPC_URL_${c.toUpperCase()}`] || (c === "solana" ? process.env.SOLANA_RPC_URL : "") || RPC[c]);
export async function rpc<T>(chain: MemeChain, method: string, params: unknown[], ms = 6000): Promise<T> {
  const r = await getJson<{ result?: T; error?: { message: string } }>(rpcUrl(chain), ms, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (r.error) throw new Error(`RPC ${method}: ${r.error.message}`);
  return r.result as T;
}

const WSOL = "So11111111111111111111111111111111111111112";
const nativePriceCache = new Map<string, { usd: number; at: number }>();
export async function nativeUsd(chain: MemeChain): Promise<number | null> {
  const key = chain === "solana" ? "solana" : chain === "bsc" ? "bsc" : "ethereum";
  const hit = nativePriceCache.get(key); if (hit && Date.now() - hit.at < 60_000) return hit.usd;
  const addr = key === "solana" ? WSOL : key === "bsc" ? "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  try { const p = (await pairsForTokens(key as MemeChain, [addr]))[0]; if (p) { nativePriceCache.set(key, { usd: p.priceUsd, at: Date.now() }); return p.priceUsd; } } catch { /* unpriced */ }
  return null;
}

export interface WalletRead { nativeSymbol: string; nativeBalance: number; totalUsd: number | null; tokens: { mint: string; symbol: string; amount: number; usd: number | null }[]; unpriced: number; source: string; note?: string }

/** Reads balances only. Solana: SOL + SPL tokens. EVM: native balance only (token balances need an indexer, which is not configured). */
export async function readWallet(chain: MemeChain, address: string): Promise<WalletRead> {
  const price = await nativeUsd(chain);
  if (chain !== "solana") {
    const hex = await rpc<string>(chain, "eth_getBalance", [address, "latest"]);
    const bal = Number(BigInt(hex)) / 1e18;
    return { nativeSymbol: NATIVE[chain], nativeBalance: bal, totalUsd: price === null ? null : bal * price, tokens: [], unpriced: 0, source: rpcUrl(chain).replace(/\/\/([^/]+).*/, "//$1"), note: "Token balances on this chain need an indexer; only the native balance is read." };
  }
  const [lam, tok, tok22] = await Promise.all([
    rpc<{ value: number }>(chain, "getBalance", [address]),
    rpc<{ value: any[] }>(chain, "getTokenAccountsByOwner", [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]),
    rpc<{ value: any[] }>(chain, "getTokenAccountsByOwner", [address, { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }, { encoding: "jsonParsed" }]).catch(() => ({ value: [] })),
  ]);
  const held = [...tok.value, ...tok22.value].map((a) => a.account?.data?.parsed?.info).filter((i) => i && Number(i.tokenAmount?.uiAmount) > 0).map((i) => ({ mint: String(i.mint), amount: Number(i.tokenAmount.uiAmount) }));
  const top = held.sort((a, b) => b.amount - a.amount).slice(0, 60);
  let priced = new Map<string, MemePair>();
  try { priced = new Map((await pairsForTokens("solana", top.map((t) => t.mint))).map((p) => [p.tokenAddress, p])); } catch { /* leaves tokens unpriced */ }
  const tokens = top.map((t) => { const p = priced.get(t.mint); return { mint: t.mint, symbol: p?.symbol ?? t.mint.slice(0, 4) + "…", amount: t.amount, usd: p ? t.amount * p.priceUsd : null }; });
  const unpriced = tokens.filter((t) => t.usd === null).length;
  const sol = lam.value / 1e9;
  const total = price === null ? null : sol * price + tokens.reduce((a, t) => a + (t.usd ?? 0), 0);
  return { nativeSymbol: "SOL", nativeBalance: sol, totalUsd: total, tokens, unpriced, source: "Solana RPC + DexScreener prices", note: unpriced ? `${unpriced} token(s) have no market price and are not counted in the total.` : undefined };
}

// ---------------------------------------------------------------- user data
export async function loadStrategy(userId: string): Promise<MemeStrategy & { prompt: string }> {
  const { data: r } = await serviceDb().from("nova_meme_strategy").select("*").eq("user_id", userId).maybeSingle();
  if (!r) return { ...DEFAULT_STRATEGY, prompt: "" };
  const n = (x: unknown) => (x === null || x === undefined ? undefined : Number(x));
  return { prompt: r.prompt as string, enabled: Boolean(r.enabled), mode: r.mode, chains: r.chains, minLiquidityUsd: Number(r.min_liquidity_usd), minVolume24hUsd: Number(r.min_volume_24h_usd), minAgeMinutes: r.min_age_minutes, maxAgeHours: r.max_age_hours,
    maxFdvUsd: n(r.max_fdv_usd), minBuySellRatio: Number(r.min_buy_sell_ratio), minRugScore: r.min_rug_score, positionUsd: Number(r.position_usd), maxOpenPositions: r.max_open_positions, takeProfitPct: Number(r.take_profit_pct),
    stopLossPct: Number(r.stop_loss_pct), trailingStopPct: Number(r.trailing_stop_pct), slippageBps: r.slippage_bps, dailyLossLimitUsd: n(r.daily_loss_limit_usd) };
}
export async function loadRules(userId: string): Promise<TaughtRule[]> {
  const { data } = await serviceDb().from("nova_ai_rules").select("id,kind,text").eq("user_id", userId).eq("active", true).order("created_at").limit(200);
  return (data ?? []) as TaughtRule[];
}

export async function logEvent(userId: string, agent: "scanner" | "analyst" | "executor" | "risk" | "system", kind: string, message: string, p?: { token?: string; symbol?: string; detail?: Record<string, unknown> }) {
  await serviceDb().from("nova_agent_events").insert({ user_id: userId, agent, kind, message: message.slice(0, 600), token_address: p?.token ?? null, symbol: p?.symbol ?? null, detail: p?.detail ?? {} });
}

/** Plain-language reason. Built from the real numbers; if the user's AI is connected it may rephrase, but never adds facts. */
async function explain(userId: string, p: MemePair, reasons: string[], taught: TaughtRule[]): Promise<string> {
  const base = reasons.join(". ") + ".";
  const ai = await loadAiClient(userId).catch(() => null);
  if (!ai) return base;
  try {
    const c = await ai.client.chat([
      { role: "system", content: "You are the Analyst agent of a memecoin trading assistant. Rewrite the verified facts as 2 short plain sentences for the user. Use ONLY the facts given. Do not predict prices, do not promise profit, do not add numbers." },
      { role: "user", content: `Token ${p.symbol}. Facts: ${reasons.join(" | ")}. User's taught rules: ${taught.map((t) => t.text).join(" | ") || "none"}.` },
    ], { maxTokens: 160, temperature: 0.2 });
    return c.text.trim().slice(0, 500) || base;
  } catch { return base; }
}

async function buyPaper(userId: string, s: MemeStrategy, p: MemePair, sizeUsd: number, reason: string, evidence: Record<string, unknown>, rulesApplied: string[], agent: "executor" | "copy", sourceWallet?: string, walletId?: string | null) {
  const db = serviceDb();
  const fill = paperBuy(p.priceUsd, sizeUsd, s.slippageBps);
  const { data: pos } = await db.from("nova_meme_positions").insert({ user_id: userId, wallet_id: walletId ?? null, mode: "paper", chain: p.chain, token_address: p.tokenAddress, symbol: p.symbol, name: p.name, image_url: p.imageUrl ?? null,
    entry_price: fill.fillPrice, qty: fill.qty, cost_usd: sizeUsd, peak_price: fill.fillPrice, stop_loss_pct: s.stopLossPct, trailing_stop_pct: s.trailingStopPct, take_profit_pct: s.takeProfitPct }).select("id").single();
  await db.from("nova_trade_log").insert({ user_id: userId, position_id: pos?.id ?? null, mode: "paper", agent, side: "buy", chain: p.chain, token_address: p.tokenAddress, symbol: p.symbol, image_url: p.imageUrl ?? null,
    price: fill.fillPrice, qty: fill.qty, usd: sizeUsd, status: "simulated_fill", reason, evidence: { ...evidence, modelled_slippage_bps: s.slippageBps, modelled_fee_bps: 30 }, rules_applied: rulesApplied, source_wallet: sourceWallet ?? null, simulated: true });
  await logEvent(userId, "executor", "paper_buy", `Paper buy ${p.symbol} for $${sizeUsd.toFixed(2)} at ${fill.fillPrice.toPrecision(4)} (simulated fill, not a real trade).`, { token: p.tokenAddress, symbol: p.symbol });
  await notify(userId, "trade", `Paper buy: ${p.symbol}`, `$${sizeUsd.toFixed(2)} simulated. ${reason.slice(0, 160)}`);
}

export async function closePaper(userId: string, pos: any, price: number, reason: "take_profit" | "stop_loss" | "trailing_stop" | "manual" | "copy_exit" | "risk", why: string, slippageBps: number, agent: "executor" | "copy" | "user" = "executor", sourceWallet?: string) {
  const db = serviceDb();
  const sell = paperSell(price, Number(pos.qty), slippageBps);
  const pnl = sell.proceedsUsd - Number(pos.cost_usd);
  await db.from("nova_meme_positions").update({ status: "closed", exit_price: sell.fillPrice, exit_reason: reason, pnl_usd: pnl, closed_at: new Date().toISOString() }).eq("id", pos.id).eq("user_id", userId).eq("status", "open");
  await db.from("nova_trade_log").insert({ user_id: userId, position_id: pos.id, mode: "paper", agent, side: "sell", chain: pos.chain, token_address: pos.token_address, symbol: pos.symbol, image_url: pos.image_url,
    price: sell.fillPrice, qty: pos.qty, usd: sell.proceedsUsd, status: "simulated_fill", reason: why, evidence: { pnl_usd: pnl, entry_price: Number(pos.entry_price), exit_reason: reason }, source_wallet: sourceWallet ?? null, simulated: true });
  await logEvent(userId, "executor", "paper_sell", `Paper sell ${pos.symbol}: ${reason.replace("_", " ")}, ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (simulated).`, { token: pos.token_address, symbol: pos.symbol });
  await notify(userId, "trade", `Paper sell: ${pos.symbol}`, `${why} Result ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (simulated).`);
  return pnl;
}

/** Re-prices open paper positions and applies the stop / take-profit / trailing stop. Cheap: one batched price call per chain. */
export async function tickPositions(userId: string, s: MemeStrategy): Promise<{ checked: number; closed: number }> {
  const db = serviceDb();
  const { data: open } = await db.from("nova_meme_positions").select("*").eq("user_id", userId).eq("status", "open").eq("mode", "paper").limit(100);
  if (!open?.length) return { checked: 0, closed: 0 };
  const prices = new Map<string, number>();
  for (const chain of new Set<MemeChain>(open.map((o) => o.chain as MemeChain))) {
    try { for (const p of await pairsForTokens(chain, open.filter((o) => o.chain === chain).map((o) => o.token_address as string))) prices.set(chain + ":" + p.tokenAddress, p.priceUsd); } catch { /* keep positions as they are */ }
  }
  let closed = 0;
  for (const pos of open) {
    const price = prices.get(pos.chain + ":" + pos.token_address); if (!price) continue;
    const r = tickPosition({ entryPrice: Number(pos.entry_price), peakPrice: Number(pos.peak_price), stopLossPct: Number(pos.stop_loss_pct), trailingStopPct: Number(pos.trailing_stop_pct), takeProfitPct: Number(pos.take_profit_pct) }, price);
    if (r.peak > Number(pos.peak_price)) await db.from("nova_meme_positions").update({ peak_price: r.peak }).eq("id", pos.id).eq("user_id", userId);
    if (r.exit) {
      const label = r.exit.reason === "stop_loss" ? `Price ${price.toPrecision(4)} fell to the ${pos.stop_loss_pct}% stop (${r.exit.trigger.toPrecision(4)})` : r.exit.reason === "take_profit" ? `Price ${price.toPrecision(4)} reached the +${pos.take_profit_pct}% target` : `Price ${price.toPrecision(4)} fell ${pos.trailing_stop_pct}% from its peak of ${r.peak.toPrecision(4)}`;
      await closePaper(userId, pos, price, r.exit.reason, label + ".", s.slippageBps); closed++;
    }
  }
  return { checked: open.length, closed };
}

/** One Scanner -> Analyst -> Risk -> Executor pass for a user. Bounded work: at most `maxBuys` entries per pass. */
export async function runUserCycle(userId: string, opts: { maxBuys?: number; skipLogLimit?: number } = {}): Promise<{ scanned: number; bought: number; proposed: number; skipped: number; ticks: { checked: number; closed: number }; errors: string[] }> {
  const db = serviceDb();
  const s = await loadStrategy(userId);
  const out = { scanned: 0, bought: 0, proposed: 0, skipped: 0, ticks: { checked: 0, closed: 0 }, errors: [] as string[] };
  if (!s.enabled) return out;
  out.ticks = await tickPositions(userId, s);
  const rules = await loadRules(userId); const compiled = compileRules(rules);
  const { pairs, errors } = await scanCandidates(s.chains); out.errors = errors; out.scanned = pairs.length;
  await logEvent(userId, "scanner", "scan", `Scanned ${pairs.length} fresh tokens on ${s.chains.join(", ")}.`, { detail: { errors } });
  const { data: open } = await db.from("nova_meme_positions").select("token_address,cost_usd").eq("user_id", userId).eq("status", "open");
  const openAddr = new Set<string>((open ?? []).map((o) => o.token_address as string)); let openCost = (open ?? []).reduce((a, o) => a + Number(o.cost_usd), 0); let openCount = open?.length ?? 0;
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { data: lossRows } = await db.from("nova_meme_positions").select("pnl_usd").eq("user_id", userId).eq("status", "closed").gte("closed_at", since.toISOString());
  const lossToday = (lossRows ?? []).reduce((a, r) => a + Math.min(0, Number(r.pnl_usd ?? 0)), 0) * -1;
  const budget = s.positionUsd * s.maxOpenPositions;                       // paper bankroll = what the strategy is allowed to deploy
  let skipLogs = 0; const maxBuys = opts.maxBuys ?? 2;
  for (const p of pairs.sort((a, b) => b.volume24hUsd - a.volume24hUsd)) {
    if (out.bought + out.proposed >= maxBuys) break;
    const facts = await onchainFacts(p.chain, p.tokenAddress);
    const d = evaluateToken(p, s, compiled, { openAddresses: openAddr, onchain: facts });
    if (d.action === "skip") {
      out.skipped++;
      if (skipLogs < (opts.skipLogLimit ?? 3) && !d.failed.includes("Already holding this token")) {
        skipLogs++;
        await db.from("nova_trade_log").insert({ user_id: userId, mode: "analysis", agent: "analyst", side: "skip", chain: p.chain, token_address: p.tokenAddress, symbol: p.symbol, image_url: p.imageUrl ?? null, price: p.priceUsd,
          status: "skipped", reason: d.failed.slice(0, 4).join(". ") + ".", evidence: d.metrics, rules_applied: d.rulesApplied, simulated: true });
      }
      continue;
    }
    const gate = riskGate({ strategy: s, openCount, openCostUsd: openCost, budgetUsd: budget, realisedLossTodayUsd: lossToday, wantUsd: s.positionUsd });
    if (!gate.ok) { await logEvent(userId, "risk", "blocked", `Risk blocked ${p.symbol}: ${gate.blockers[0]}.`, { token: p.tokenAddress, symbol: p.symbol }); break; }
    const reason = await explain(userId, p, d.reasons, compiled.advisory);
    if (s.mode === "analysis") { out.skipped++; await logEvent(userId, "analyst", "would_buy", `Would buy ${p.symbol} (analysis only). ${d.reasons[0]}.`, { token: p.tokenAddress, symbol: p.symbol }); continue; }
    if (s.mode === "live_approval") {
      await db.from("nova_trade_log").insert({ user_id: userId, mode: "live", agent: "executor", side: "buy", chain: p.chain, token_address: p.tokenAddress, symbol: p.symbol, image_url: p.imageUrl ?? null, price: p.priceUsd, usd: gate.sizeUsd,
        status: "awaiting_approval", reason, evidence: d.metrics, rules_applied: d.rulesApplied, simulated: true });
      await notify(userId, "approval", `Approve a buy? ${p.symbol}`, `$${gate.sizeUsd.toFixed(2)} proposed. Nothing is sent until you approve.`);
      out.proposed++; openAddr.add(p.tokenAddress); continue;
    }
    await buyPaper(userId, s, p, gate.sizeUsd, reason, d.metrics, d.rulesApplied, "executor");
    out.bought++; openAddr.add(p.tokenAddress); openCost += gate.sizeUsd; openCount++;
  }
  await db.from("nova_meme_strategy").update({ last_cycle_at: new Date().toISOString() }).eq("user_id", userId);
  return out;
}

export { allocationBudget, buyPaper };
