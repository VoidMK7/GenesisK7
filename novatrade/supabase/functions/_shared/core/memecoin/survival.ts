/**
 * Survival logic for the six agents. Pure functions: no network, no database, no clock except what is passed in.
 * Nothing here predicts prices. It decides how much risk is acceptable, when to stand aside, and when moving money
 * from one coin to another is worth the cost.
 */
import type { MemePair, OnchainFacts } from "./types.ts";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/* ----------------------------------------------------------------- goal realism */

export interface PlanInput { startUsd: number; targetUsd: number; days: number }
export interface Plan { requiredMultiple: number; requiredDailyPct: number; verdict: "realistic" | "ambitious" | "unrealistic" | "invalid"; message: string }

/** Turns "make $10 into $1,000 in 30 days" into the maths. It never pretends an extreme target is safe. */
export function goalPlan(i: PlanInput): Plan {
  const start = num(i.startUsd), target = num(i.targetUsd), days = Math.floor(num(i.days));
  if (!(start > 0) || !(target > 0) || days < 1) return { requiredMultiple: 0, requiredDailyPct: 0, verdict: "invalid", message: "Enter a starting amount, a target and a number of days." };
  const mult = target / start; const daily = (Math.pow(mult, 1 / days) - 1) * 100;
  if (mult <= 1) return { requiredMultiple: mult, requiredDailyPct: daily, verdict: "realistic", message: "Your target is at or below your starting amount. Protecting it is the goal." };
  const m = `${mult.toFixed(mult >= 10 ? 0 : 1)}x in ${days} day${days === 1 ? "" : "s"} needs about ${daily.toFixed(daily >= 10 ? 0 : 1)}% growth every single day, compounded.`;
  if (daily <= 1.5) return { requiredMultiple: mult, requiredDailyPct: daily, verdict: "realistic", message: m + " That is demanding but not absurd. It is still not guaranteed." };
  if (daily <= 4) return { requiredMultiple: mult, requiredDailyPct: daily, verdict: "ambitious", message: m + " That is far beyond what most traders sustain. Expect to miss it, and expect losing streaks along the way." };
  return { requiredMultiple: mult, requiredDailyPct: daily, verdict: "unrealistic", message: m + " Chasing that means taking risks that usually end in losing the account. The agents will protect your money first and will not raise risk to reach this number." };
}

/* ----------------------------------------------------------------- survival status */

export interface SurvivalInput {
  startUsd: number;
  closedPnlUsd: number[];          // realised P&L of closed positions, OLDEST first
  openUnrealisedUsd?: number;
  lastClosedAt?: number | null;    // ms epoch of the most recent close
  now: number;
  cfg?: Partial<SurvivalConfig>;
}
export interface SurvivalConfig {
  cautiousDrawdownPct: number;     // size is halved beyond this drawdown from peak
  preserveDrawdownPct: number;     // no new entries beyond this drawdown from peak
  floorPct: number;                // no new entries when equity is below this % of the start
  lossStreakCooldown: number;      // consecutive losses that trigger a pause
  cooldownMinutes: number;
}
export const SURVIVAL_DEFAULTS: SurvivalConfig = { cautiousDrawdownPct: 8, preserveDrawdownPct: 20, floorPct: 60, lossStreakCooldown: 3, cooldownMinutes: 45 };

export interface SurvivalStatus {
  mode: "normal" | "cautious" | "cooldown" | "preserve";
  allowEntries: boolean;
  sizeMultiplier: number;
  equityUsd: number; peakUsd: number; drawdownPct: number; lossStreak: number;
  resumeAt?: number;
  reason: string;
}

/** Capital preservation first. Looks only at what really happened (realised results plus open P&L). */
export function survivalStatus(i: SurvivalInput): SurvivalStatus {
  const cfg = { ...SURVIVAL_DEFAULTS, ...(i.cfg ?? {}) }; const start = Math.max(0, num(i.startUsd));
  let eq = start, peak = start, streak = 0;
  for (const p of i.closedPnlUsd) { eq += num(p); peak = Math.max(peak, eq); streak = num(p) < 0 ? streak + 1 : 0; }
  const equity = eq + num(i.openUnrealisedUsd); peak = Math.max(peak, equity);
  const dd = peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0; const base = { equityUsd: equity, peakUsd: peak, drawdownPct: dd, lossStreak: streak };
  if (start > 0 && equity < (start * cfg.floorPct) / 100) return { ...base, mode: "preserve", allowEntries: false, sizeMultiplier: 0, reason: `Equity is below ${cfg.floorPct}% of your starting amount. Standing aside to protect what is left.` };
  if (dd >= cfg.preserveDrawdownPct) return { ...base, mode: "preserve", allowEntries: false, sizeMultiplier: 0, reason: `Down ${dd.toFixed(1)}% from the peak. No new entries until it recovers or you change the limit.` };
  if (streak >= cfg.lossStreakCooldown && i.lastClosedAt) {
    const resume = i.lastClosedAt + cfg.cooldownMinutes * 60_000;
    if (i.now < resume) return { ...base, mode: "cooldown", allowEntries: false, sizeMultiplier: 0, resumeAt: resume, reason: `${streak} losses in a row. Pausing new entries for ${cfg.cooldownMinutes} minutes.` };
  }
  if (dd >= cfg.cautiousDrawdownPct) return { ...base, mode: "cautious", allowEntries: true, sizeMultiplier: 0.5, reason: `Down ${dd.toFixed(1)}% from the peak. Position sizes are halved.` };
  return { ...base, mode: "normal", allowEntries: true, sizeMultiplier: 1, reason: "Within all survival limits." };
}

/* ----------------------------------------------------------------- scoring */

/** 0..100 trading-activity score from public pair data. It ranks coins against each other. It is not a price forecast. */
export function momentumScore(p: Pick<MemePair, "liquidityUsd" | "volume24hUsd" | "buys1h" | "sells1h" | "buys24h" | "sells24h" | "change">): number {
  const t1 = num(p.buys1h) + num(p.sells1h), t24 = num(p.buys24h) + num(p.sells24h);
  const flow1 = t1 >= 10 ? (num(p.buys1h) / t1 - 0.5) * 2 : 0;          // -1..1
  const flow24 = t24 >= 30 ? (num(p.buys24h) / t24 - 0.5) * 2 : 0;
  const h1 = clamp(num(p.change?.h1), -40, 40) / 40, h6 = clamp(num(p.change?.h6), -60, 60) / 60;
  const vl = p.liquidityUsd > 0 ? clamp(p.volume24hUsd / p.liquidityUsd, 0, 6) / 6 : 0;
  const liq = clamp(Math.log10(Math.max(1, p.liquidityUsd)) - 3.5, 0, 2.5) / 2.5;       // $3k..$1M
  const raw = 50 + flow1 * 14 + flow24 * 8 + h1 * 9 + h6 * 5 + vl * 6 + liq * 10;
  // an over-extended pump is a risk, not a strength
  const stretch = Math.max(0, num(p.change?.h1) - 60) * 0.25;
  return Math.round(clamp(raw - stretch, 0, 100));
}

export interface ResearchInput { pair: MemePair; facts?: OnchainFacts; holders?: number; organicScore?: number; devPct?: number }
export interface Research { score: number; verified: string[]; unknown: string[]; flags: string[]; pass: boolean }

/** Researcher: separates what was verified from what is unknown. Unknowns count against the coin, never for it. */
export function researchCoin(i: ResearchInput, minScore = 55): Research {
  const verified: string[] = [], unknown: string[] = [], flags: string[] = []; let s = 50; const f = i.facts;
  if (f?.mintAuthorityRenounced === true) { s += 12; verified.push("Mint authority renounced"); } else if (f?.mintAuthorityRenounced === false) { s -= 25; flags.push("Mint authority is still active: more supply can be created"); } else unknown.push("Mint authority");
  if (f?.freezeAuthorityRenounced === true) { s += 8; verified.push("Freeze authority renounced"); } else if (f?.freezeAuthorityRenounced === false) { s -= 20; flags.push("Freeze authority is active: your tokens could be frozen"); } else unknown.push("Freeze authority");
  if (f?.top10HoldersPct !== undefined) { if (f.top10HoldersPct > 50) { s -= 20; flags.push(`Top 10 holders own ${f.top10HoldersPct.toFixed(0)}%`); } else if (f.top10HoldersPct > 30) { s -= 8; flags.push(`Top 10 holders own ${f.top10HoldersPct.toFixed(0)}%`); } else { s += 8; verified.push(`Top 10 holders own ${f.top10HoldersPct.toFixed(0)}%`); } } else unknown.push("Holder concentration");
  if (i.devPct !== undefined) { if (i.devPct > 10) { s -= 12; flags.push(`Dev holds ${i.devPct.toFixed(1)}%`); } else verified.push(`Dev holds ${i.devPct.toFixed(1)}%`); } else unknown.push("Developer holdings");
  if (i.holders !== undefined) { if (i.holders < 100) { s -= 10; flags.push(`Only ${i.holders} holders`); } else if (i.holders > 1000) { s += 6; verified.push(`${i.holders.toLocaleString("en-US")} holders`); } } else unknown.push("Holder count");
  if (i.organicScore !== undefined) { if (i.organicScore < 30) { s -= 10; flags.push("Low organic trading score (looks wash-traded)"); } else if (i.organicScore > 60) { s += 6; verified.push("Healthy organic trading score"); } }
  const p = i.pair; if (p.socials.website || p.socials.twitter) { s += 3; verified.push("Has a website or X account (not proof of anything)"); } else flags.push("No website or X account listed");
  const L = p.liquidityUsd; if (L < 10_000) { s -= 15; flags.push(`Liquidity only $${Math.round(L).toLocaleString("en-US")}: selling may be hard`); } else if (L > 100_000) { s += 6; verified.push("Deep liquidity"); }
  const t = num(p.buys24h) + num(p.sells24h); if (t < 50) { s -= 8; flags.push("Very few trades in 24h"); }
  s -= Math.min(10, unknown.length * 2.5);                                  // unknown is a cost
  const score = Math.round(clamp(s, 0, 100)); return { score, verified, unknown, flags, pass: score >= minScore && !flags.some((x) => /still active|is active/.test(x)) };
}

/* ----------------------------------------------------------------- sniper */

export interface SniperConfig { minAgeMin: number; maxAgeMin: number; minLiquidityUsd: number; maxTop10Pct: number; probeFraction: number }
export const SNIPER_DEFAULTS: SniperConfig = { minAgeMin: 3, maxAgeMin: 45, minLiquidityUsd: 15_000, maxTop10Pct: 35, probeFraction: 0.3 };
export interface SniperResult { ok: boolean; probeUsd: number; failed: string[]; why: string[] }

/** Sniper: a brand-new coin is allowed only if its contract checks are VERIFIED clean. Unknown means no. Small probe size only. */
export function sniperCheck(p: MemePair, facts: OnchainFacts | undefined, normalSizeUsd: number, cfg: Partial<SniperConfig> = {}): SniperResult {
  const c = { ...SNIPER_DEFAULTS, ...cfg }; const failed: string[] = [], why: string[] = [];
  const age = p.ageMinutes; if (age === undefined) failed.push("Pair age unknown"); else if (age < c.minAgeMin) failed.push(`Only ${age}m old: too early to see real trading`); else if (age > c.maxAgeMin) failed.push(`${age}m old: no longer a fresh launch`); else why.push(`Fresh pair, ${age}m old`);
  if (p.liquidityUsd < c.minLiquidityUsd) failed.push(`Liquidity $${Math.round(p.liquidityUsd).toLocaleString("en-US")} is under $${c.minLiquidityUsd.toLocaleString("en-US")}`); else why.push("Liquidity is sufficient");
  if (facts?.mintAuthorityRenounced !== true) failed.push("Mint authority not verified as renounced");
  if (facts?.freezeAuthorityRenounced !== true) failed.push("Freeze authority not verified as renounced");
  if (facts?.top10HoldersPct === undefined) failed.push("Holder concentration unknown"); else if (facts.top10HoldersPct > c.maxTop10Pct) failed.push(`Top 10 holders own ${facts.top10HoldersPct.toFixed(0)}%`);
  if (p.buys1h + p.sells1h >= 10 && p.buys1h < p.sells1h) failed.push("More sells than buys in the last hour");
  const ok = failed.length === 0; return { ok, probeUsd: ok ? Math.max(0, +(normalSizeUsd * c.probeFraction).toFixed(2)) : 0, failed, why };
}

/* ----------------------------------------------------------------- rotation */

export interface RotPos { id: string; mint: string; symbol: string; score: number; valueUsd: number; costUsd: number; heldMinutes: number }
export interface RotCand { mint: string; symbol: string; score: number }
export interface RotInput { positions: RotPos[]; candidates: RotCand[]; feeBps: number; slippageBps: number; minEdge: number; holdFloor: number; minHoldMinutes: number; maxPerHour: number; doneLastHour: number }
export interface RotPlan { rotate: boolean; sell?: RotPos; buy?: RotCand; edge?: number; costPct?: number; reason: string }

/**
 * Rotator: sell the weakest holding and buy a stronger coin ONLY when the score gap is large, the holding has really gone weak,
 * it has been held long enough, and the hourly limit allows it. Every switch costs fees and slippage twice, so churning is capped.
 */
export function rotationPlan(i: RotInput): RotPlan {
  if (i.doneLastHour >= i.maxPerHour) return { rotate: false, reason: `Rotation limit reached (${i.maxPerHour}/hour). Fees add up fast.` };
  const held = new Set(i.positions.map((p) => p.mint)); const cands = i.candidates.filter((c) => !held.has(c.mint)).sort((a, b) => b.score - a.score);
  if (!cands.length) return { rotate: false, reason: "No stronger coin that passes every check." };
  const weak = [...i.positions].filter((p) => p.heldMinutes >= i.minHoldMinutes).sort((a, b) => a.score - b.score)[0];
  if (!weak) return { rotate: false, reason: "Nothing has been held long enough to judge." };
  const best = cands[0]; const edge = best.score - weak.score; const costPct = 2 * ((i.feeBps + i.slippageBps) / 100);       // sell + buy
  if (weak.score >= i.holdFloor) return { rotate: false, reason: `${weak.symbol} is still healthy (score ${weak.score}). Holding.` };
  if (edge < i.minEdge) return { rotate: false, edge, costPct, reason: `Best alternative ${best.symbol} is only ${edge} points better: not enough to cover about ${costPct.toFixed(1)}% in switching costs.` };
  return { rotate: true, sell: weak, buy: best, edge, costPct, reason: `${weak.symbol} weakened to ${weak.score}; ${best.symbol} scores ${best.score} (+${edge}). Switching costs about ${costPct.toFixed(1)}%.` };
}

/* ----------------------------------------------------------------- learning */

export interface Lesson { agent: string; entryScore?: number | null; actualPct: number }
export interface AgentStat { agent: string; n: number; winRatePct: number | null; avgPct: number | null; adjust: number }

/** Per-agent results from recorded lessons. The adjustment is small and bounded, and only appears after 8 recorded outcomes. */
export function lessonStats(rows: Lesson[]): AgentStat[] {
  const by = new Map<string, Lesson[]>(); for (const r of rows) by.set(r.agent, [...(by.get(r.agent) ?? []), r]);
  return [...by.entries()].map(([agent, rs]) => {
    const n = rs.length, wins = rs.filter((r) => r.actualPct > 0).length, avg = rs.reduce((a, r) => a + r.actualPct, 0) / n;
    return { agent, n, winRatePct: +((wins / n) * 100).toFixed(1), avgPct: +avg.toFixed(2), adjust: n >= 8 ? +clamp((wins / n - 0.5) * 10, -5, 5).toFixed(2) : 0 };
  });
}

/** Position size for one entry given survival state and a hard cap. Never raises size to win back losses. */
export function entrySize(baseUsd: number, status: SurvivalStatus, capUsd: number): number {
  if (!status.allowEntries) return 0;
  return Math.max(0, +Math.min(baseUsd * status.sizeMultiplier, capUsd).toFixed(2));
}
