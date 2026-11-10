import { body, HttpError, route, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";

export const POST = route(async (req: Request) => {
  const s = await requireUser();
  const b = await body(req);
  const leader = uuid(v.str(b, "leader"), "leader");
  const follow = v.bool(b, "follow") ?? true;
  if (leader === s.userId) throw new HttpError(400, "You cannot follow yourself.");
  const db = serviceDb();
  if (follow) {
    const { data: p } = await db.from("nova_trader_profiles").select("user_id").eq("user_id", leader).eq("is_public", true).maybeSingle();
    if (!p) throw new HttpError(404, "Trader not found.");
    await db.from("nova_follows").upsert({ follower: s.userId, leader });
  } else await db.from("nova_follows").delete().eq("follower", s.userId).eq("leader", leader);
  return { ok: true };
});
