import { route, uuid } from "../../../../_shared/server/http.ts";
import { requireUser, securityEvent, serviceDb } from "../../../../_shared/server/auth.ts";
import { loadConnection } from "../../../../_shared/server/connections.ts";

export const DELETE = route(async (_req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  const c = await loadConnection(s.userId, uuid(ctx.params.id));
  const db = serviceDb();
  if (c.secret_id) await db.from("nova_secrets").delete().eq("id", c.secret_id).eq("user_id", s.userId);
  await db.from("nova_broker_connections").delete().eq("id", c.id).eq("user_id", s.userId);
  // Losing the only live connection means live can no longer be considered unlocked.
  await db.from("nova_user_settings").update({ live_unlocked_at: null, live_enabled: false, execution_mode: "analysis" }).eq("user_id", s.userId).eq("execution_mode", "live");
  await securityEvent(s.userId, "connection_deleted", { provider: c.provider });
  return { ok: true };
});
