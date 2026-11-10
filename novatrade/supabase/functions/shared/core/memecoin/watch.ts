/** Following top traders: ranking, swap detection from raw transactions, and time-boxed batch planning. All pure. */

export interface TraderStats { pnlUsd?: number; winRatePct?: number; trades?: number; periodDays?: number }
export interface TraderRow { id: string; platform: string; handle: string; walletAddress?: string | null; stats: TraderStats; fetchedAt: string }
export interface FollowCriteria { minTrades: number; minWinRatePct: number; minPnlUsd: number; maxStaleHours: number; maxFollowed: number }
export const DEFAULT_FOLLOW: FollowCriteria = { minTrades: 30, minWinRatePct: 55, minPnlUsd: 5_000, maxStaleHours: 48, maxFollowed: 5 };

export interface Ranked { trader: TraderRow; score: number; qualifies: boolean; why: string[] }

/**
 * Ranks traders on the figures their SOURCE published. A trader qualifies only if every criterion is met by a real, fresh number:
 * a missing stat is a failed criterion, not a guess. The score only orders qualifiers; it is not a prediction of future results.
 */
export function rankTraders(rows: TraderRow[], c: FollowCriteria, nowMs = Date.now()): Ranked[] {
  const out: Ranked[] = rows.map((t) => {
    const why: string[] = []; const s = t.stats;
    const ageH = (nowMs - new Date(t.fetchedAt).getTime()) / 3_600_000;
    if (!t.walletAddress) why.push("No wallet address, so its trades cannot be watched");
    if (!(ageH <= c.maxStaleHours)) why.push(`Stats are ${Math.round(ageH)}h old (limit ${c.maxStaleHours}h)`);
    if (s.trades === undefined || s.trades < c.minTrades) why.push(`${s.trades ?? "Unknown"} trades (need ${c.minTrades}+)`);
    if (s.winRatePct === undefined || s.winRatePct < c.minWinRatePct) why.push(`Win rate ${s.winRatePct === undefined ? "unknown" : s.winRatePct.toFixed(0) + "%"} (need ${c.minWinRatePct}%+)`);
    if (s.pnlUsd === undefined || s.pnlUsd < c.minPnlUsd) why.push(`Profit ${s.pnlUsd === undefined ? "unknown" : "$" + Math.round(s.pnlUsd)} (need $${c.minPnlUsd}+)`);
    const wr = Math.min(100, Math.max(0, s.winRatePct ?? 0)) / 100;
    const pnl = Math.log10(1 + Math.max(0, s.pnlUsd ?? 0)) / 6;            // $1M ~ 1.0
    const act = Math.min(1, (s.trades ?? 0) / 200);
    const score = Math.round((0.45 * wr + 0.4 * Math.min(1, pnl) + 0.15 * act) * 100);
    return { trader: t, score, qualifies: why.length === 0, why };
  });
  return out.sort((a, b) => Number(b.qualifies) - Number(a.qualifies) || b.score - a.score);
}

/** Who to follow now: the best qualifiers up to the cap, keeping anyone already followed who still qualifies. */
export function pickFollows(ranked: Ranked[], c: FollowCriteria, alreadyIds: Set<string>) {
  const q = ranked.filter((r) => r.qualifies);
  const keep = q.filter((r) => alreadyIds.has(r.trader.id));
  const add = q.filter((r) => !alreadyIds.has(r.trader.id)).slice(0, Math.max(0, c.maxFollowed - keep.length));
  const drop = ranked.filter((r) => !r.qualifies && alreadyIds.has(r.trader.id));
  return { add, keep, drop };
}

export interface DetectedSwap { signature: string; blockTime: number | null; side: "buy" | "sell"; mint: string; tokenAmount: number; quote: "SOL" | "USD"; quoteAmount: number }
const WSOL = "So11111111111111111111111111111111111111112";
const STABLES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);

/** Reads one `getTransaction` (jsonParsed) result and says what the watched wallet did, or null if it was not a single clean swap. */
export function parseSolanaSwap(tx: any, owner: string): DetectedSwap | null {
  try {
    if (!tx?.meta || tx.meta.err) return null;
    const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
    const idx = keys.indexOf(owner); if (idx < 0) return null;
    const fee = idx === 0 ? Number(tx.meta.fee ?? 0) : 0;
    const nativeDelta = (Number(tx.meta.postBalances[idx]) - Number(tx.meta.preBalances[idx]) + fee) / 1e9;
    const sum = (arr: any[] | undefined) => { const m = new Map<string, number>(); for (const b of arr ?? []) if (b.owner === owner) m.set(b.mint, (m.get(b.mint) ?? 0) + Number(b.uiTokenAmount?.uiAmount ?? 0)); return m; };
    const pre = sum(tx.meta.preTokenBalances), post = sum(tx.meta.postTokenBalances);
    const deltas = new Map<string, number>();
    for (const m of new Set([...pre.keys(), ...post.keys()])) { const d = (post.get(m) ?? 0) - (pre.get(m) ?? 0); if (Math.abs(d) > 0) deltas.set(m, d); }
    const wsol = deltas.get(WSOL) ?? 0; deltas.delete(WSOL);
    let usd = 0; for (const m of [...deltas.keys()]) if (STABLES.has(m)) { usd += deltas.get(m)!; deltas.delete(m); }
    if (deltas.size !== 1) return null;                         // zero, or several tokens moved: not a clean swap
    const [mint, tokenDelta] = [...deltas.entries()][0];
    const solDelta = nativeDelta + wsol;
    const quote: "SOL" | "USD" = Math.abs(usd) > 0 && Math.abs(solDelta) < 0.01 ? "USD" : "SOL";
    const quoteDelta = quote === "USD" ? usd : solDelta;
    if (!(Math.sign(quoteDelta) === -Math.sign(tokenDelta))) return null;   // a transfer, not a swap
    return { signature: tx.transaction?.signatures?.[0] ?? tx.signature ?? "", blockTime: typeof tx.blockTime === "number" ? tx.blockTime : null, side: tokenDelta > 0 ? "buy" : "sell", mint, tokenAmount: Math.abs(tokenDelta), quote, quoteAmount: Math.abs(quoteDelta) };
  } catch { return null; }
}

export interface WatchTarget { walletId: string; lastCheckedAt: string | null }
/**
 * Picks which wallets to check in this invocation so a short serverless run never overruns.
 * Stalest first, so every wallet gets its turn across successive runs. `costMs` is the expected time per wallet.
 */
export function planBatch(targets: WatchTarget[], budgetMs: number, costMs: number, hardMax = 25): WatchTarget[] {
  const n = Math.max(1, Math.min(hardMax, Math.floor(budgetMs / Math.max(1, costMs))));
  return [...targets].sort((a, b) => (a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0) - (b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0)).slice(0, n);
}
