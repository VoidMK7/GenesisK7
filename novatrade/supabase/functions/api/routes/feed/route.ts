import { body, HttpError, rateLimit, route, v } from "../../../_shared/server/http.ts";
import { requireUser } from "../../../_shared/server/auth.ts";
import { ensureProfile, intParam, q } from "../../../_shared/server/util.ts";

/** ?tab=for-you (all) | following */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); await ensureProfile(s.userId, s.email);
  let qry = s.db.from("nova_posts").select("id,author,body,media_url,token_address,token_symbol,created_at").order("created_at", { ascending: false }).limit(intParam(q(req, "limit"), 30, 1, 60));
  if (q(req, "tab") === "following") {
    const { data: f } = await s.db.from("nova_social_follows").select("followee").eq("follower", s.userId);
    const ids = (f ?? []).map((x) => x.followee as string); if (!ids.length) return { posts: [], empty: "Follow people to fill this tab." };
    qry = qry.in("author", ids);
  }
  const { data: posts } = await qry; const list = posts ?? []; const ids = list.map((p) => p.id as string); const authors = [...new Set(list.map((p) => p.author as string))];
  const [{ data: prof }, { data: stats }, { data: mine }] = await Promise.all([
    authors.length ? s.db.from("nova_profiles").select("user_id,handle,display_name,avatar_url").in("user_id", authors) : { data: [] },
    ids.length ? s.db.from("nova_post_stats").select("*").in("post_id", ids) : { data: [] },
    ids.length ? s.db.from("nova_post_likes").select("post_id").eq("user_id", s.userId).in("post_id", ids) : { data: [] },
  ]);
  return { posts: list.map((p) => ({ ...p, author: (prof ?? []).find((a) => a.user_id === p.author) ?? { user_id: p.author, handle: "unknown", display_name: "Unknown" },
    likes: Number((stats ?? []).find((x) => x.post_id === p.id)?.likes ?? 0), comments: Number((stats ?? []).find((x) => x.post_id === p.id)?.comments ?? 0), liked: (mine ?? []).some((x) => x.post_id === p.id) })) };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`post:${s.userId}`, 10, 60_000); await ensureProfile(s.userId, s.email); const b = await body(req);
  const text = v.str(b, "body", { max: 1000 }); const media = v.str(b, "media_url", { optional: true, max: 600 });
  if (media && !new RegExp(`^${(process.env.SUPABASE_URL ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/storage/v1/object/public/nova-media/`).test(media)) throw new HttpError(400, "Attach media through the app upload.");
  const { data, error } = await s.db.from("nova_posts").insert({ author: s.userId, body: text, media_url: media || null, token_address: v.str(b, "token_address", { optional: true, max: 80 }) || null, token_symbol: v.str(b, "token_symbol", { optional: true, max: 24 }) || null }).select("id").single();
  if (error) throw new HttpError(400, "Could not post.");
  return { id: data.id };
});
