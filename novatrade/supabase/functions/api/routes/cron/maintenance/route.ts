import { route } from "../../../../_shared/server/http.ts";
import { serviceDb } from "../../../../_shared/server/auth.ts";
import { cronAuthorized } from "../../../../_shared/server/cron.ts";

/** Expires proposals older than 24h and trims old notifications. */
export const GET = route(async (req: Request) => {
  cronAuthorized(req);
  const db = serviceDb();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  await db.from("nova_strategies").update({ status: "expired" }).eq("status", "proposed").lt("created_at", day);
  await db.from("nova_notifications").delete().eq("read", true).lt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  return { ok: true };
});
