import { DEFAULT_FOLLOW, parseSolanaSwap, pickFollows, planBatch, rankTraders, riskGate, type FollowCriteria, type MemeChain, type TraderRow } from "../core/memecoin/index.ts";
import { notify, serviceDb } from "./auth.ts";
import { buyPaper, closePaper, loadStrategy, logEvent, nativeUsd, pairsForTokens, rpc, tokenPair } from "./memecoin.ts";

/**
 * Serverless-friendly by construction:
 *  - every call takes a time budget and stops starting new work when it is spent (default 8s, safe inside Vercel Hobby's 10s default),
 *  - state lives in the database (cursors), never in memory, so any invocation can resume where the last one stopped,
 *  - wallets are visited stalest-first, so a small batch per run still covers everyone over successive runs,
 *  - RPC calls are small: one signatures list per wallet, and full transactions only for NEW signatures (capped).
 */
const PER_WALLET_MS = 2500;
const MAX_NEW_TX = 8;

export function criteriaFromRow(r: any): FollowCriteria {
  if (!r) return DEFAULT_FOLLOW;
  return { minTrades: r.min_trades, minWinRatePct: Number(r.min_win_rate_pct), minPnlUsd: Number(r.min_pnl_usd), maxStaleHours: r.max_stale_hours, maxFollowed: r.max_followed };
}

export async function loadTraderRows(): Promise<TraderRow[]> {
  const { data } = await serviceDb().from("nova_external_traders").select("*").limit(1000);
  return (data ?? []).map((r) => ({ id: r.id as string, platform: r.platform as string, handle: r.handle as string, walletAddress: r.wallet_address as string | null,
    stats: { pnlUsd: r.stats?.pnl_usd, winRatePct: r.stats?.win_rate_pct, trades: r.stats?.trades, periodDays: r.stats?.period_days }, fetchedAt: r.fetched_at as string }));
}

/** Re-ranks the real, published numbers and follows / unfollows according to the user's own thresholds. */
export async function refreshAutoFollow(userId: string, rows?: TraderRow[]) {
  const db = serviceDb();
  const { data: cfg } = await db.from("nova_autofollow").select("*").eq("user_id", userId).maybeSingle();
  if (!cfg?.enabled) return { added: 0, dropped: 0 };
  const c = criteriaFromRow(cfg);
  const all = (rows ?? await loadTraderRows()).filter((t) => t.walletAddress);
  const { data: cur } = await db.from("nova_followed_traders").select("chain,wallet_address,source").eq("user_id", userId);
  const keyOf = (t: TraderRow, chain: string) => chain + ":" + t.walletAddress;
  const { data: ext } = await db.from("nova_external_traders").select("id,chain").in("id", all.map((t) => t.id).slice(0, 1000));
  const chainOf = new Map((ext ?? []).map((e) => [e.id as string, e.chain as string]));
  const followedIds = new Set(all.filter((t) => (cur ?? []).some((f) => f.source === "auto" && f.wallet_address === t.walletAddress)).map((t) => t.id));
  const ranked = rankTraders(all, c);
  const pick = pickFollows(ranked, c, followedIds);
  for (const r of pick.add) {
    const t = r.trader; const chain = chainOf.get(t.id) ?? "solana";
    await db.from("nova_followed_traders").upsert({ user_id: userId, chain, wallet_address: t.walletAddress, handle: t.handle, platform: t.platform, source: "auto",
      reason: `Win rate ${t.stats.winRatePct}%, ${t.stats.trades} trades, profit $${Math.round(t.stats.pnlUsd ?? 0)} as published by ${t.platform}. Score ${r.score}.` }, { onConflict: "user_id,chain,wallet_address" });
    await notify(userId, "follow", `Now following ${t.handle}`, `The AI picked ${t.handle} (${t.platform}): ${t.stats.winRatePct}% win rate over ${t.stats.trades} trades. You will be told about each trade they make.`);
    void keyOf;
  }
  for (const r of pick.drop) {
    await db.from("nova_followed_traders").delete().eq("user_id", userId).eq("source", "auto").eq("wallet_address", r.trader.walletAddress!);
    await notify(userId, "follow", `Stopped following ${r.trader.handle}`, r.why.slice(0, 2).join(". ") + ".");
  }
  return { added: pick.add.length, dropped: pick.drop.length };
}

async function sigs(address: string, until?: string | null) {
  return rpc<{ signature: string; err: unknown; blockTime: number | null }[]>("solana", "getSignaturesForAddress", [address, { limit: 20, ...(until ? { until } : {}), commitment: "confirmed" }], 5000);
}

export interface WatchSummary { wallets: number; checked: number; newTrades: number; alerts: number; mirrored: number; skippedChains: number; stoppedEarly: boolean; errors: string[] }

export async function runWatch(budgetMs = 8000): Promise<WatchSummary> {
  const t0 = Date.now(); const db = serviceDb();
  const sum: WatchSummary = { wallets: 0, checked: 0, newTrades: 0, alerts: 0, mirrored: 0, skippedChains: 0, stoppedEarly: false, errors: [] };
  const { data: followed } = await db.from("nova_followed_traders").select("user_id,chain,wallet_address,handle").limit(2000);
  const distinct = new Map<string, { chain: string; address: string; handle: string }>();
  for (const f of followed ?? []) {
    if (f.chain !== "solana") { sum.skippedChains++; continue; }             // EVM transaction decoding needs an indexer: not covered
    distinct.set(f.wallet_address as string, { chain: f.chain as string, address: f.wallet_address as string, handle: f.handle as string });
  }
  sum.wallets = distinct.size;
  if (!distinct.size) return sum;
  const { data: cur } = await db.from("nova_watch_cursors").select("*").eq("chain", "solana").in("wallet_address", [...distinct.keys()]);
  const cursor = new Map<string, any>((cur ?? []).map((c) => [c.wallet_address as string, c]));
  const batch = planBatch([...distinct.keys()].map((w) => ({ walletId: w, lastCheckedAt: (cursor.get(w)?.last_checked_at as string) ?? null })), budgetMs - 1500, PER_WALLET_MS);
  const solUsd = await nativeUsd("solana");
  for (const target of batch) {
    if (Date.now() - t0 > budgetMs - PER_WALLET_MS) { sum.stoppedEarly = true; break; }
    const addr = target.walletId; const info = distinct.get(addr)!; const c = cursor.get(addr);
    try {
      const list = await sigs(addr, c?.last_signature as string | null);
      sum.checked++;
      if (!c?.last_signature) {                                              // first look: remember the newest, do not back-fill history as "new trades"
        await db.from("nova_watch_cursors").upsert({ chain: "solana", wallet_address: addr, last_signature: list[0]?.signature ?? null, last_checked_at: new Date().toISOString(), last_error: null });
        continue;
      }
      const fresh = list.filter((s) => !s.err).slice(0, MAX_NEW_TX).reverse();      // oldest first
      for (const s of fresh) {
        if (Date.now() - t0 > budgetMs - 800) { sum.stoppedEarly = true; break; }
        const tx = await rpc<any>("solana", "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], 4000).catch(() => null);
        const swap = tx ? parseSolanaSwap({ ...tx, signature: s.signature }, addr) : null;
        if (!swap) continue;
        const usd = swap.quote === "USD" ? swap.quoteAmount : solUsd === null ? null : swap.quoteAmount * solUsd;
        const { data: row, error } = await db.from("nova_observed_trades").insert({ chain: "solana", wallet_address: addr, signature: swap.signature || s.signature, side: swap.side, token_address: swap.mint, token_amount: swap.tokenAmount,
          quote: swap.quote, quote_amount: swap.quoteAmount, usd, block_time: swap.blockTime ? new Date(swap.blockTime * 1000).toISOString() : null }).select("id").single();
        if (error || !row) continue;                                          // duplicate signature: already processed
        sum.newTrades++;
        const n = await alertFollowers(row.id as number, addr, info.handle, swap.side, swap.mint, usd, swap.quote === "SOL" ? swap.quoteAmount : null);
        sum.alerts += n.alerts; sum.mirrored += n.mirrored;
      }
      const newest = list[0]?.signature;
      // Advance the cursor only past what was actually processed. If we stopped early, the rest is picked up next run (the `until` cursor stays put).
      if (!sum.stoppedEarly && newest) await db.from("nova_watch_cursors").upsert({ chain: "solana", wallet_address: addr, last_signature: newest, last_checked_at: new Date().toISOString(), last_error: null });
      else await db.from("nova_watch_cursors").update({ last_checked_at: new Date().toISOString() }).eq("chain", "solana").eq("wallet_address", addr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "watch failed"; sum.errors.push(`${info.handle}: ${msg}`);
      await db.from("nova_watch_cursors").upsert({ chain: "solana", wallet_address: addr, last_signature: c?.last_signature ?? null, last_checked_at: new Date().toISOString(), last_error: msg.slice(0, 200) });
    }
  }
  return sum;
}

async function alertFollowers(observedId: number, address: string, handle: string, side: "buy" | "sell", mint: string, usd: number | null, sol: number | null) {
  const db = serviceDb(); let alerts = 0, mirrored = 0;
  const { data: fs } = await db.from("nova_followed_traders").select("user_id").eq("chain", "solana").eq("wallet_address", address).limit(500);
  let pair: Awaited<ReturnType<typeof tokenPair>> = null;
  try { pair = await tokenPair("solana", mint); } catch { /* name unknown, still alert with the address */ }
  const sym = pair?.symbol ?? mint.slice(0, 4) + "…";
  const amount = usd !== null ? `$${usd.toFixed(2)}` : sol !== null ? `${sol.toFixed(3)} SOL` : "an unpriced amount";
  for (const f of fs ?? []) {
    const userId = f.user_id as string;
    const { error } = await db.from("nova_trade_alerts").insert({ user_id: userId, observed_id: observedId });
    if (error) continue;                                                     // already alerted for this trade
    await notify(userId, "trader_trade", `${handle} ${side === "buy" ? "bought" : "sold"} ${sym}`, `${amount} on-chain. This is what they did; nothing was traded for you unless you turned mirroring on.`);
    await logEvent(userId, "scanner", "followed_trade", `${handle} ${side === "buy" ? "bought" : "sold"} ${sym} for ${amount}.`, { token: mint, symbol: sym, detail: { wallet: address, side } });
    alerts++;
    const { data: cfg } = await db.from("nova_autofollow").select("on_trade").eq("user_id", userId).maybeSingle();
    if (cfg?.on_trade === "notify_and_mirror" && pair) { try { if (await mirror(userId, pair, side, handle, address)) mirrored++; } catch { /* alert already sent */ } }
  }
  return { alerts, mirrored };
}

/** Mirrors a followed wallet's trade as a PAPER position (or an approval request in live_approval mode). Never signs or sends anything. */
async function mirror(userId: string, p: NonNullable<Awaited<ReturnType<typeof tokenPair>>>, side: "buy" | "sell", handle: string, wallet: string): Promise<boolean> {
  const db = serviceDb(); const s = await loadStrategy(userId);
  const { data: open } = await db.from("nova_meme_positions").select("*").eq("user_id", userId).eq("status", "open").eq("token_address", p.tokenAddress).eq("mode", "paper");
  if (side === "sell") {
    if (!open?.length) return false;
    for (const pos of open) await closePaper(userId, pos, p.priceUsd, "copy_exit", `${handle} sold ${p.symbol}, so the mirrored paper position was closed.`, s.slippageBps, "copy", wallet);
    return true;
  }
  if (open?.length || s.mode === "analysis") return false;
  const { data: all } = await db.from("nova_meme_positions").select("cost_usd").eq("user_id", userId).eq("status", "open");
  const gate = riskGate({ strategy: s, openCount: all?.length ?? 0, openCostUsd: (all ?? []).reduce((a, r) => a + Number(r.cost_usd), 0), budgetUsd: s.positionUsd * s.maxOpenPositions, realisedLossTodayUsd: 0, wantUsd: s.positionUsd });
  if (!gate.ok) { await logEvent(userId, "risk", "blocked", `Did not mirror ${handle}'s ${p.symbol} buy: ${gate.blockers[0]}.`, { token: p.tokenAddress, symbol: p.symbol }); return false; }
  const reason = `${handle} bought ${p.symbol} on-chain, so the mirrored paper position was opened at your size of $${gate.sizeUsd.toFixed(2)}.`;
  if (s.mode === "live_approval") {
    await db.from("nova_trade_log").insert({ user_id: userId, mode: "live", agent: "copy", side: "buy", chain: "solana", token_address: p.tokenAddress, symbol: p.symbol, image_url: p.imageUrl ?? null, price: p.priceUsd, usd: gate.sizeUsd,
      status: "awaiting_approval", reason, evidence: { liquidityUsd: p.liquidityUsd, price: p.priceUsd }, source_wallet: wallet, simulated: true });
    await notify(userId, "approval", `Approve a copy of ${handle}? ${p.symbol}`, `$${gate.sizeUsd.toFixed(2)} proposed. Nothing is sent until you approve.`);
    return true;
  }
  await buyPaper(userId, s, p, gate.sizeUsd, reason, { liquidityUsd: p.liquidityUsd, price: p.priceUsd }, [], "copy", wallet);
  return true;
}

export { pairsForTokens };
