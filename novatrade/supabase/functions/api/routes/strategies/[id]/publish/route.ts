import { HttpError, route, uuid } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";

export const POST = route(async (_req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  const id = uuid(ctx.params.id);
  const { data } = await serviceDb().from("nova_strategies").update({ visibility: "public", moderation: "pending" }).eq("id", id).eq("user_id", s.userId).select("id").maybeSingle();
  if (!data) throw new HttpError(404, "Strategy not found.");
  return { ok: true, message: "Submitted for admin review. It appears on the marketplace once approved." };
});
