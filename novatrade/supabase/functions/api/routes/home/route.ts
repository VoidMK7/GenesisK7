import { activeStopLine, type MemeChain } from "../../../_shared/core/memecoin/index.ts";
import { route } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { loadStrategy, pairsForTokens } from "../../../_shared/server/memecoin.ts";
import { getWallet, recordSnapshot, walletValue } from "../../../_shared/server/live.ts";
import { q } from "../../../_shared/server/util.ts";

/**
 * Home / portfolio summary for ONE book: ?mode=paper (default) or ?mode=live.
 * Every figure is computed from the user's own recorded trades and the wallet's real balance. There is no demo data.
 */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); const mode = q(req, "mode") === "live" ? "live" : "paper"; const db = serviceDb();
  const [{ data: pos }, { data: log }, { data: snaps }, strategy] = await Promise.all([
    db.from("nova_meme_positions").select("*").eq("user_id", s.userId).eq("mode", mode).order("opened_at", { ascending: true }).limit(500),
    db.from("nova_trade_log").select("id,side,symbol,image_url,token_address,price,usd,status,created_at,evidence,mode").eq("user_id", s.userId).eq("mode", mode).in("side", ["buy", "sell"]).in("status", ["simulated_fill", "confirmed"]).order("created_at", { ascending: true }).limit(600),
    db.from("nova_equity_snapshots").select("at,pnl_usd").eq("user_id", s.userId).eq("mode", mode).order("at", { ascending: true }).limit(2500),
    loadStrategy(s.userId),
  ]);
  const closed = (pos ?? []).filter((p) => p.status === "closed"), open = (pos ?? []).filter((p) => p.status === "open");
  const price = new Map<string, number>();
  for (const c of new Set<MemeChain>(open.map((o) => o.chain as MemeChain))) { try { for (const p of await pairsForTokens(c, open.filter((o) => o.chain === c).map((o) => o.token_address as string))) price.set(c + ":" + p.tokenAddress, p.priceUsd); } catch { /* unpriced */ } }

  const openRows = open.map((p) => {
    const now = price.get(p.chain + ":" + p.token_address) ?? null; const value = now === null ? null : now * Number(p.qty); const unreal = value === null ? null : value - Number(p.cost_usd);
    return { id: p.id, mint: p.token_address, symbol: p.symbol, image: p.image_url, qty: Number(p.qty), costUsd: Number(p.cost_usd), entryPrice: Number(p.entry_price), nowPrice: now, valueUsd: value, unrealisedUsd: unreal, pnlPct: unreal === null ? null : (unreal / Number(p.cost_usd)) * 100,
      realisedUsd: Number(p.realised_usd ?? 0), openedAt: p.opened_at, autoExit: p.auto_exit !== false, stopLine: activeStopLine({ entryPrice: Number(p.entry_price), peakPrice: Number(p.peak_price), stopLossPct: Number(p.stop_loss_pct), trailingStopPct: Number(p.trailing_stop_pct), takeProfitPct: Number(p.take_profit_pct) }) };
  });
  const closedRows = closed.slice().sort((a, b) => +new Date(b.closed_at) - +new Date(a.closed_at)).slice(0, 60).map((p) => ({ id: p.id, mint: p.token_address, symbol: p.symbol, image: p.image_url, costUsd: Number(p.cost_usd), pnlUsd: Number(p.pnl_usd ?? 0), pnlPct: Number(p.cost_usd) > 0 ? (Number(p.pnl_usd ?? 0) / Number(p.cost_usd)) * 100 : null,
    reason: p.exit_reason, openedAt: p.opened_at, closedAt: p.closed_at }));

  const realised = closed.reduce((a, p) => a + Number(p.pnl_usd ?? 0), 0) + open.reduce((a, p) => a + Number(p.realised_usd ?? 0), 0);
  const unrealised = openRows.reduce((a, p) => a + (p.unrealisedUsd ?? 0), 0); const unpriced = openRows.filter((p) => p.unrealisedUsd === null).length; const total = realised + unrealised;
  const wins = closed.filter((p) => Number(p.pnl_usd) > 0).length; const pnls = closed.map((p) => Number(p.pnl_usd ?? 0));
  const holdMin = closed.length ? closed.reduce((a, p) => a + (+new Date(p.closed_at) - +new Date(p.opened_at)) / 60000, 0) / closed.length : null;

  // Growth curve: stored snapshots when there are any, otherwise the running realised profit at each sell. Always ends at "now".
  let series: { t: string; v: number }[];
  if ((snaps ?? []).length >= 2) series = (snaps ?? []).map((x) => ({ t: x.at as string, v: Number(x.pnl_usd) }));
  else { let run = 0; const sells = (log ?? []).filter((t) => t.side === "sell"); series = sells.map((t) => { run += Number((t.evidence as any)?.pnl_usd ?? 0); return { t: t.created_at as string, v: run }; }); if (series.length) series.unshift({ t: (log ?? [])[0].created_at as string, v: 0 }); }
  if (series.length) series.push({ t: new Date().toISOString(), v: total });

  let wallet: Record<string, unknown> | null = null;
  if (mode === "live") {
    const w = await getWallet(s.userId);
    if (w) {
      try {
        const v = await walletValue(w.address);
        const { data: led } = await db.from("nova_wallet_ledger").select("kind,usd").eq("user_id", s.userId);
        const net = (led ?? []).reduce((a, l) => a + (l.kind === "deposit" ? Number(l.usd ?? 0) : l.kind === "withdraw" ? -Number(l.usd ?? 0) : 0), 0);
        wallet = { address: w.address, valueUsd: v.totalUsd, sol: v.sol, netDepositedUsd: net, growthUsd: v.totalUsd === null ? null : v.totalUsd - net };
        await recordSnapshot(s.userId, "live", total, v.totalUsd);
      } catch { wallet = { address: w.address, valueUsd: null, error: "Could not read the wallet right now." }; }
    }
  } else await recordSnapshot(s.userId, "paper", total, null);

  return { mode, strategyMode: strategy.mode, enabled: strategy.enabled, realisedUsd: realised, unrealisedUsd: unrealised, totalUsd: total, unpricedPositions: unpriced, openCount: open.length, closedCount: closed.length,
    winRatePct: closed.length ? (wins / closed.length) * 100 : null, bestUsd: pnls.length ? Math.max(...pnls) : null, worstUsd: pnls.length ? Math.min(...pnls) : null, avgHoldMinutes: holdMin, series, wallet,
    open: openRows, closed: closedRows, markers: (log ?? []).slice(-120).map((t) => ({ t: t.created_at, side: t.side, symbol: t.symbol, image: t.image_url, mint: t.token_address, usd: t.usd })), simulated: mode === "paper",
    note: closed.length || open.length ? undefined : mode === "live" ? "No live trades yet. Fund your wallet and buy a coin, or switch your agent to live." : "No paper trades yet. Buy a coin on paper or switch your agent on." };
});
