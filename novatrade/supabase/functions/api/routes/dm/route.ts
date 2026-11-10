import { body, HttpError, rateLimit, route, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
/** Opens (or returns) the 1:1 conversation with another user. */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`dm:${s.userId}`, 20, 3_600_000); const b = await body(req); const other = uuid(v.str(b, "userId"), "userId"); const db = serviceDb();
  if (other === s.userId) throw new HttpError(400, "You cannot message yourself.");
  const { data: target } = await db.from("nova_profiles").select("user_id").eq("user_id", other).eq("is_public", true).maybeSingle();
  if (!target) throw new HttpError(404, "User not found.");
  const { data: mine } = await db.from("nova_room_members").select("room_id").eq("user_id", s.userId);
  if (mine?.length) { const { data: shared } = await db.from("nova_room_members").select("room_id").eq("user_id", other).in("room_id", mine.map((m) => m.room_id as string)); 
    if (shared?.length) { const { data: dm } = await db.from("nova_rooms").select("id").eq("kind", "dm").in("id", shared.map((m) => m.room_id as string)).limit(1).maybeSingle(); if (dm) return { roomId: dm.id }; } }
  const { data: room } = await db.from("nova_rooms").insert({ kind: "dm", is_public: false, created_by: s.userId }).select("id").single();
  await db.from("nova_room_members").insert([{ room_id: room!.id, user_id: s.userId, role: "member" }, { room_id: room!.id, user_id: other, role: "member" }]);
  return { roomId: room!.id };
});
