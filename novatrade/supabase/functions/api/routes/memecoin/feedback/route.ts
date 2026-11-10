import { body, HttpError, route, uuid, v } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";

/** Thumbs up/down on one of your trades. A note becomes a taught rule only when you choose to (see /teach). */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  const tradeId = uuid(v.str(b, "tradeId"), "tradeId"); const rating = v.num(b, "rating", { min: -1, max: 1 });
  if (rating !== 1 && rating !== -1) throw new HttpError(400, "rating must be 1 or -1.");
  const db = serviceDb();
  const { data: t } = await db.from("nova_trade_log").select("id").eq("id", tradeId).eq("user_id", s.userId).maybeSingle();
  if (!t) throw new HttpError(404, "Trade not found.");
  await db.from("nova_trade_feedback").upsert({ trade_id: tradeId, user_id: s.userId, rating, note: v.str(b, "note", { optional: true, max: 300 }) || null });
  return { ok: true };
});
