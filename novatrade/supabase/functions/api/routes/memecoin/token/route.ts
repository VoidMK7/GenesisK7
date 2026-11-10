import { activeStopLine, rugScore } from "../../../../_shared/core/memecoin/index.ts";
import { HttpError, route } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { onchainFacts, tokenPair } from "../../../../_shared/server/memecoin.ts";
import { addressParam, chainParam, q } from "../../../../_shared/server/util.ts";

export const GET = route(async (req: Request) => {
  const s = await requireUser(); const chain = chainParam(q(req, "chain")); const address = addressParam(chain, q(req, "address"));
  const p = await tokenPair(chain, address); if (!p) throw new HttpError(404, "No trading pair found for this token.");
  const facts = await onchainFacts(chain, address);
  const db = serviceDb();
  const [{ data: pos }, { data: log }] = await Promise.all([
    db.from("nova_meme_positions").select("*").eq("user_id", s.userId).eq("token_address", address).order("opened_at", { ascending: false }).limit(5),
    db.from("nova_trade_log").select("id,side,status,price,usd,reason,agent,created_at").eq("user_id", s.userId).eq("token_address", address).order("created_at", { ascending: false }).limit(30),
  ]);
  const open = (pos ?? []).find((x) => x.status === "open");
  return { pair: p, safety: rugScore(p, facts), contractFacts: facts ?? null, position: open ? { ...open, stopLine: activeStopLine({ entryPrice: Number(open.entry_price), peakPrice: Number(open.peak_price), stopLossPct: Number(open.stop_loss_pct), trailingStopPct: Number(open.trailing_stop_pct), takeProfitPct: Number(open.take_profit_pct) }) } : null, history: pos ?? [], log: log ?? [] };
});
