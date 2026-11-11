import { body, HttpError, rateLimit, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser } from "../../../../../_shared/server/auth.ts";
export const GET = route(async (_r: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const { data } = await s.db.from("nova_post_comments").select("id,author,body,created_at").eq("post_id", uuid(ctx.params.id)).order("created_at").limit(100);
  const ids = [...new Set((data ?? []).map((c) => c.author as string))]; const { data: prof } = ids.length ? await s.db.from("nova_profiles").select("user_id,handle,display_name,avatar_url").in("user_id", ids) : { data: [] };
  return { comments: (data ?? []).map((c) => ({ ...c, author: (prof ?? []).find((p) => p.user_id === c.author) ?? null })) };
});
export const POST = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); rateLimit(`cmt:${s.userId}`, 20, 60_000); const b = await body(req);
  const { error } = await s.db.from("nova_post_comments").insert({ post_id: uuid(ctx.params.id), author: s.userId, body: v.str(b, "body", { max: 500 }) });
  if (error) throw new HttpError(400, "Could not comment."); return { ok: true };
});
