import { body, HttpError, route, uuid, v } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
export const DELETE = route(async (_r: Request, ctx: { params: Record<string, string> }) => { const s = await requireUser(); await s.db.from("nova_posts").delete().eq("id", uuid(ctx.params.id)).eq("author", s.userId); return { ok: true }; });

/** PATCH /posts/:id  { body } -> edit my own post text (media and token tag stay). */
export const PATCH = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const b = await body(req);
  const text = v.str(b, "body", { max: 1000 }).trim();
  if (!text) throw new HttpError(400, "A post cannot be empty.");
  const { data, error } = await s.db.from("nova_posts").update({ body: text, edited_at: new Date().toISOString() }).eq("id", uuid(ctx.params.id)).eq("author", s.userId).select("id,body,edited_at").maybeSingle();
  if (error) throw new HttpError(400, "Could not edit this post.");
  if (!data) throw new HttpError(404, "Post not found, or it is not yours.");
  return { post: data };
});
