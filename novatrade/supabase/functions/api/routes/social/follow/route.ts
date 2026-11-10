import { body, HttpError, route, uuid, v } from "../../../../_shared/server/http.ts";
import { notify, requireUser } from "../../../../_shared/server/auth.ts";
export const POST = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req); const target = uuid(v.str(b, "userId"), "userId"); const follow = v.bool(b, "follow") ?? true;
  if (target === s.userId) throw new HttpError(400, "You cannot follow yourself.");
  if (follow) { const { error } = await s.db.from("nova_social_follows").insert({ follower: s.userId, followee: target }); if (!error) await notify(target, "follow", "You have a new follower"); }
  else await s.db.from("nova_social_follows").delete().eq("follower", s.userId).eq("followee", target);
  const { data: c } = await s.db.from("nova_profile_counts").select("followers").eq("user_id", target).maybeSingle();
  return { following: follow, followers: Number(c?.followers ?? 0) };
});
