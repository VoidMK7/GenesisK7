import { body, HttpError, rateLimit, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { q } from "../../../_shared/server/util.ts";

/** ?kind=community (public rooms + mine) | dm (my conversations) */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); const kind = q(req, "kind") === "dm" ? "dm" : "community";
  const { data: rooms } = await s.db.from("nova_rooms").select("id,kind,slug,name,description,is_public,created_at").eq("kind", kind).order("created_at", { ascending: false }).limit(60);
  const ids = (rooms ?? []).map((r) => r.id as string);
  const { data: members } = ids.length ? await s.db.from("nova_room_members").select("room_id,user_id").in("room_id", ids) : { data: [] };
  const names = new Map<string, { handle: string; display_name: string; avatar_url: string | null }>();
  if (kind === "dm") { const uids = [...new Set((members ?? []).map((m) => m.user_id as string))]; const { data: p } = uids.length ? await s.db.from("nova_profiles").select("user_id,handle,display_name,avatar_url").in("user_id", uids) : { data: [] }; for (const x of p ?? []) names.set(x.user_id as string, x as never); }
  return { rooms: (rooms ?? []).map((r) => { const ms = (members ?? []).filter((m) => m.room_id === r.id); const other = kind === "dm" ? ms.find((m) => m.user_id !== s.userId) : null;
    return { ...r, members: ms.length, joined: ms.some((m) => m.user_id === s.userId), with: other ? names.get(other.user_id as string) ?? null : null }; }) };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`room:${s.userId}`, 5, 3_600_000); const b = await body(req); const db = serviceDb();
  const name = v.str(b, "name", { min: 3, max: 48 }); const slug = (v.str(b, "slug", { optional: true, max: 32 }) || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  if (slug.length < 3) throw new HttpError(400, "Pick a longer name.");
  const { data: room, error } = await db.from("nova_rooms").insert({ kind: "community", slug, name, description: v.str(b, "description", { optional: true, max: 300 }) || null, is_public: v.bool(b, "is_public") ?? true, created_by: s.userId }).select("id,slug").single();
  if (error || !room) throw new HttpError(409, "A community with that name already exists.");
  await db.from("nova_room_members").insert({ room_id: room.id, user_id: s.userId, role: "owner" });
  return { room };
});
