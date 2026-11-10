import { body, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";

export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await s.db.from("nova_notifications").select("id,kind,title,body,read,created_at").order("created_at", { ascending: false }).limit(100);
  return { notifications: data ?? [] };
});
export const POST = route(async (req: Request) => {
  const s = await requireUser();
  const b = await body(req);
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  let q = serviceDb().from("nova_notifications").update({ read: true }).eq("user_id", s.userId);
  if (!(v.bool(b, "all") === true)) q = q.in("id", ids);
  await q;
  return { ok: true };
});
