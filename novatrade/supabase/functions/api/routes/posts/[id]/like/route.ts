import { route, uuid } from "../../../../../_shared/server/http.ts";
import { requireUser } from "../../../../../_shared/server/auth.ts";
import { notify } from "../../../../../_shared/server/auth.ts";

/** Toggles your like. Uses your own session, so database policy (not this code) guarantees you can only like as yourself. */
export const POST = route(async (_r: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id);
  const { data: ex } = await s.db.from("nova_post_likes").select("post_id").eq("post_id", id).eq("user_id", s.userId).maybeSingle();
  if (ex) await s.db.from("nova_post_likes").delete().eq("post_id", id).eq("user_id", s.userId);
  else { await s.db.from("nova_post_likes").insert({ post_id: id, user_id: s.userId }); const { data: p } = await s.db.from("nova_posts").select("author").eq("id", id).maybeSingle(); if (p && p.author !== s.userId) await notify(p.author as string, "like", "Someone liked your post"); }
  const { data: st } = await s.db.from("nova_post_stats").select("likes").eq("post_id", id).maybeSingle();
  return { liked: !ex, likes: Number(st?.likes ?? 0) };
});
