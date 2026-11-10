import { body, HttpError, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";

/** Reject a pending approval. (Approving a real on-chain buy needs a signer adapter, which this version does not include.) */
export const POST = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id); const b = await body(req);
  const action = v.oneOf(b, "action", ["reject", "approve"] as const);
  const db = serviceDb();
  const { data: t } = await db.from("nova_trade_log").select("id,status").eq("id", id).eq("user_id", s.userId).maybeSingle();
  if (!t) throw new HttpError(404, "Trade not found.");
  if (t.status !== "awaiting_approval") throw new HttpError(409, "This trade is not waiting for approval.");
  if (action === "approve") throw new HttpError(501, "Real on-chain execution is not configured. This version can reject proposals and run paper trades; sending a real swap needs a wallet-signing adapter that you add and audit.", { code: "requires_configuration" });
  await db.from("nova_trade_log").update({ status: "rejected" }).eq("id", id).eq("user_id", s.userId);
  return { ok: true };
});
