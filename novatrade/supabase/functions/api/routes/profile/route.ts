import { body, HttpError, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { ensureProfile, q } from "../../../_shared/server/util.ts";

const MEDIA_RE = (base: string) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/storage/v1/object/public/nova-media/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$`);

/** GET /profile            -> my profile (created on first use)
 *  GET /profile?handle=x   -> someone's public profile with counts, whether I follow them, and their recent posts */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); const handle = q(req, "handle");
  const me = await ensureProfile(s.userId, s.email);
  let p = me;
  if (handle && handle.toLowerCase() !== me.handle) {
    const { data } = await s.db.from("nova_profiles").select("*").ilike("handle", handle).maybeSingle();
    if (!data) throw new HttpError(404, "Profile not found.");
    p = data;
  }
  const [{ data: counts }, { data: follow }, { data: posts }] = await Promise.all([
    s.db.from("nova_profile_counts").select("*").eq("user_id", p.user_id).maybeSingle(),
    s.db.from("nova_social_follows").select("followee").eq("follower", s.userId).eq("followee", p.user_id).maybeSingle(),
    s.db.from("nova_posts").select("id,body,media_url,token_symbol,token_address,created_at,edited_at").eq("author", p.user_id).order("created_at", { ascending: false }).limit(20),
  ]);
  return { profile: p, isMe: p.user_id === s.userId, counts: counts ?? { followers: 0, following: 0, posts: 0 }, following: Boolean(follow), posts: posts ?? [] };
});

/** Edit profile. Picture/banner are uploaded by the browser to the nova-media bucket (own folder); this validates the URLs point there. */
export const PUT = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req); const me = await ensureProfile(s.userId, s.email);
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, ""); const ok = base ? MEDIA_RE(base) : null;
  const upd: Record<string, unknown> = {};
  if (b.display_name !== undefined) upd.display_name = v.str(b, "display_name", { max: 40 });
  if (b.bio !== undefined) upd.bio = v.str(b, "bio", { optional: true, max: 280 }) || null;
  if (b.handle !== undefined) { const h = v.str(b, "handle", { min: 3, max: 20 }).toLowerCase(); if (!/^[a-z0-9_]{3,20}$/.test(h)) throw new HttpError(400, "Handle can use a-z, 0-9 and _ (3-20 characters)."); upd.handle = h; }
  if (b.is_public !== undefined) upd.is_public = v.bool(b, "is_public");
  const own = (u: string) => { if (!ok || !ok.test(u) || !u.includes(`/${s.userId}/`)) throw new HttpError(400, "Upload the file through the app so it is stored in your own media folder."); return u; };
  if (b.avatar_url !== undefined) upd.avatar_url = b.avatar_url ? own(v.str(b, "avatar_url", { max: 600 })) : null;
  if (b.banner_url !== undefined) {
    if (!b.banner_url) { upd.banner_url = null; upd.banner_kind = null; upd.banner_seconds = null; }
    else {
      const kind = v.oneOf(b, "banner_kind", ["image", "video"] as const);
      upd.banner_url = own(v.str(b, "banner_url", { max: 600 })); upd.banner_kind = kind;
      if (kind === "video") { const sec = v.num(b, "banner_seconds", { min: 1, max: 10 }); upd.banner_seconds = sec; } else upd.banner_seconds = null;
    }
  }
  const { data, error } = await serviceDb().from("nova_profiles").update(upd).eq("user_id", me.user_id).select("*").single();
  if (error) throw new HttpError(409, error.message.includes("handle") || error.code === "23505" ? "That handle is taken." : "Could not save the profile.");
  return { profile: data };
});
