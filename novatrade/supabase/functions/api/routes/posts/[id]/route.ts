import { route, uuid } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
export const DELETE = route(async (_r: Request, ctx: { params: Record<string, string> }) => { const s = await requireUser(); await s.db.from("nova_posts").delete().eq("id", uuid(ctx.params.id)).eq("author", s.userId); return { ok: true }; });
