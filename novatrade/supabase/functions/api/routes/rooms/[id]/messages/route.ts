import { body, HttpError, rateLimit, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";
import { intParam, q } from "../../../../../_shared/server/util.ts";

/** ?after=<id> returns only newer messages, so clients can poll cheaply. Reads go through your own session (database policy decides what you may see). */
export const GET = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id); const after = Number(q(req, "after") ?? 0);
  let qry = s.db.from("nova_messages").select("id,sender,body,created_at").eq("room_id", id).eq("hidden", false);
  qry = after > 0 ? qry.gt("id", after).order("id", { ascending: true }).limit(100) : qry.order("id", { ascending: false }).limit(intParam(q(req, "limit"), 50, 1, 100));
  const { data } = await qry; const list = after > 0 ? data ?? [] : (data ?? []).reverse();
  const ids = [...new Set(list.map((m) => m.sender as string))]; const { data: prof } = ids.length ? await s.db.from("nova_profiles").select("user_id,handle,display_name,avatar_url").in("user_id", ids) : { data: [] };
  return { messages: list.map((m) => ({ ...m, mine: m.sender === s.userId, sender: (prof ?? []).find((p) => p.user_id === m.sender) ?? { handle: "unknown", display_name: "Unknown" } })) };
});
export const POST = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); rateLimit(`msg:${s.userId}`, 30, 60_000); const b = await body(req); const id = uuid(ctx.params.id);
  const { error } = await s.db.from("nova_messages").insert({ room_id: id, sender: s.userId, body: v.str(b, "body", { max: 2000 }) });
  if (error) throw new HttpError(403, "You are not a member of this room. Join it first."); void serviceDb; return { ok: true };
});
