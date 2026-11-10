import { body, HttpError, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";

export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  const id = uuid(ctx.params.id);
  const b = await body(req);
  const d = v.oneOf(b, "decision", ["approved", "rejected"] as const);
  const db = serviceDb();
  const { data } = await db.from("nova_strategies").update({ status: d }).eq("id", id).eq("user_id", s.userId).eq("status", "proposed").select("id").maybeSingle();
  if (!data) throw new HttpError(409, "Only a proposed strategy can be approved or rejected.");
  await db.from("nova_strategy_events").insert({ strategy_id: id, user_id: s.userId, kind: d, message: `You ${d} this strategy.`, detail: {} });
  return { ok: true };
});
