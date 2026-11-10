import { body, HttpError, route, uuid } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";
export const POST = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id); const db = serviceDb();
  const { data: r } = await db.from("nova_rooms").select("kind,is_public").eq("id", id).maybeSingle();
  if (!r || r.kind !== "community" || !r.is_public) throw new HttpError(404, "Community not found, or it is invite-only.");
  await db.from("nova_room_members").upsert({ room_id: id, user_id: s.userId, role: "member" }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
  void body; return { ok: true };
});
