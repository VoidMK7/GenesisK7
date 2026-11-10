import { activeStopLine, type MemeChain } from "../../../../_shared/core/memecoin/index.ts";
import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { pairsForTokens } from "../../../../_shared/server/memecoin.ts";

export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await s.db.from("nova_meme_positions").select("*").order("opened_at", { ascending: false }).limit(100);
  const open = (data ?? []).filter((p) => p.status === "open");
  const price = new Map<string, number>();
  for (const c of new Set<MemeChain>(open.map((o) => o.chain as MemeChain))) { try { for (const p of await pairsForTokens(c, open.filter((o) => o.chain === c).map((o) => o.token_address as string))) price.set(c + ":" + p.tokenAddress, p.priceUsd); } catch { /* shown without a live price */ } }
  return { positions: (data ?? []).map((p) => { const now = price.get(p.chain + ":" + p.token_address); return { ...p, nowPrice: now ?? null, valueUsd: now ? now * Number(p.qty) : null, unrealisedUsd: now ? now * Number(p.qty) - Number(p.cost_usd) : null,
    stopLine: p.status === "open" ? activeStopLine({ entryPrice: Number(p.entry_price), peakPrice: Number(p.peak_price), stopLossPct: Number(p.stop_loss_pct), trailingStopPct: Number(p.trailing_stop_pct), takeProfitPct: Number(p.take_profit_pct) }) : null }; }) };
});
