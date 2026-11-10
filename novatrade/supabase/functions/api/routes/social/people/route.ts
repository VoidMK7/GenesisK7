import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { ensureProfile, q } from "../../../../_shared/server/util.ts";
/** Search by handle or name, or suggestions (most-followed first) when no query. */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); await ensureProfile(s.userId, s.email);
  const term = (q(req, "q") ?? "").trim().replace(/[%,()]/g, "").slice(0, 30);
  let qry = s.db.from("nova_profiles").select("user_id,handle,display_name,avatar_url,bio").neq("user_id", s.userId).eq("is_public", true).limit(30);
  if (term) qry = qry.or(`handle.ilike.%${term}%,display_name.ilike.%${term}%`);
  const { data } = await qry; const ids = (data ?? []).map((p) => p.user_id as string);
  const [{ data: counts }, { data: mine }] = await Promise.all([ids.length ? s.db.from("nova_profile_counts").select("*").in("user_id", ids) : { data: [] }, ids.length ? s.db.from("nova_social_follows").select("followee").eq("follower", s.userId).in("followee", ids) : { data: [] }]);
  return { people: (data ?? []).map((p) => ({ ...p, followers: Number((counts ?? []).find((c) => c.user_id === p.user_id)?.followers ?? 0), following: (mine ?? []).some((m) => m.followee === p.user_id) })).sort((a, b) => b.followers - a.followers) };
});
