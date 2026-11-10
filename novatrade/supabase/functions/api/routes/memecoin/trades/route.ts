import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { intParam, q } from "../../../../_shared/server/util.ts";

/** Every trade decision, newest first: fills, skips and approvals, each with the reason and the numbers behind it. */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); const side = q(req, "side");
  let qry = s.db.from("nova_trade_log").select("*").order("created_at", { ascending: false }).limit(intParam(q(req, "limit"), 50, 1, 200));
  if (side === "buy" || side === "sell" || side === "skip") qry = qry.eq("side", side);
  const { data } = await qry;
  const ids = (data ?? []).map((t) => t.id as string);
  const { data: fb } = ids.length ? await s.db.from("nova_trade_feedback").select("trade_id,rating,note").in("trade_id", ids) : { data: [] };
  return { trades: (data ?? []).map((t) => ({ ...t, feedback: (fb ?? []).find((f) => f.trade_id === t.id) ?? null })),
    note: "Entries marked simulated are paper trades modelled on market prices. Only entries with status 'confirmed' and a transaction signature are real." };
});
