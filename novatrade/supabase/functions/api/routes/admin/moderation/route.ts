import { body, HttpError, route, uuid, v } from "../../../../_shared/server/http.ts";
import { requireAdmin, securityEvent, serviceDb } from "../../../../_shared/server/auth.ts";

export const GET = route(async () => {
  await requireAdmin();
  const { data } = await serviceDb().from("nova_strategies").select("id,engine,symbol,market,name,direction,payload,created_at").eq("moderation", "pending").order("created_at");
  return { pending: data ?? [] };
});
export const POST = route(async (req: Request) => {
  const a = await requireAdmin();
  const b = await body(req);
  const id = uuid(v.str(b, "id"));
  const decision = v.oneOf(b, "decision", ["approved", "rejected"] as const);
  const { data } = await serviceDb().from("nova_strategies").update({ moderation: decision, ...(decision === "rejected" ? { visibility: "private" } : {}) }).eq("id", id).eq("moderation", "pending").select("id").maybeSingle();
  if (!data) throw new HttpError(404, "Nothing pending with that id.");
  await securityEvent(a.userId, "strategy_moderated", { id, decision });
  return { ok: true };
});
