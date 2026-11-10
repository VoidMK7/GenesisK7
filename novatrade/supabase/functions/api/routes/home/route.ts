import { route } from "../../../_shared/server/http.ts";
import { requireUser } from "../../../_shared/server/auth.ts";
import { loadStrategy, pairsForTokens } from "../../../_shared/server/memecoin.ts";
import type { MemeChain } from "../../../_shared/core/memecoin/index.ts";

/** Home summary. Every figure is computed from the user's own logged paper/live records; there is no demo data. */
export const GET = route(async () => {
  const s = await requireUser();
  const [{ data: pos }, { data: log }, strategy] = await Promise.all([
    s.db.from("nova_meme_positions").select("*").order("opened_at", { ascending: true }).limit(500),
    s.db.from("nova_trade_log").select("id,side,symbol,image_url,price,usd,status,created_at,simulated").in("side", ["buy", "sell"]).eq("status", "simulated_fill").order("created_at", { ascending: true }).limit(500),
    loadStrategy(s.userId),
  ]);
  const closed = (pos ?? []).filter((p) => p.status === "closed"), open = (pos ?? []).filter((p) => p.status === "open");
  const price = new Map<string, number>();
  for (const c of new Set<MemeChain>(open.map((o) => o.chain as MemeChain))) { try { for (const p of await pairsForTokens(c, open.filter((o) => o.chain === c).map((o) => o.token_address as string))) price.set(c + ":" + p.tokenAddress, p.priceUsd); } catch { /* unpriced */ } }
  const realised = closed.reduce((a, p) => a + Number(p.pnl_usd ?? 0), 0);
  let unrealised = 0, unpriced = 0; for (const p of open) { const now = price.get(p.chain + ":" + p.token_address); if (now) unrealised += now * Number(p.qty) - Number(p.cost_usd); else unpriced++; }
  const wins = closed.filter((p) => Number(p.pnl_usd) > 0).length;
  // Equity curve of realised P&L only, one point per closed trade.
  let run = 0; const series = closed.sort((a, b) => +new Date(a.closed_at) - +new Date(b.closed_at)).map((p) => { run += Number(p.pnl_usd ?? 0); return { t: p.closed_at, v: run }; });
  return { mode: strategy.mode, enabled: strategy.enabled, realisedUsd: realised, unrealisedUsd: unrealised, unpricedPositions: unpriced, openCount: open.length, closedCount: closed.length, winRatePct: closed.length ? (wins / closed.length) * 100 : null, series,
    markers: (log ?? []).slice(-60).map((t) => ({ t: t.created_at, side: t.side, symbol: t.symbol, image: t.image_url, usd: t.usd })), simulated: true,
    note: closed.length ? undefined : "No closed trades yet. Figures appear here from your own trade log." };
});
