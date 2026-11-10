import { route } from "../../../../_shared/server/http.ts";
import { serviceDb } from "../../../../_shared/server/auth.ts";
import { cronAuthorized } from "../../../../_shared/server/cron.ts";
import { loadTraderRows, refreshAutoFollow, runWatch } from "../../../../_shared/server/watch.ts";
import { intParam, q } from "../../../../_shared/server/util.ts";

/**
 * Follows top traders and reports each new trade. Time-boxed: `?budget=` ms (default 8000, max 50000) so it fits a
 * short serverless limit. Call it every minute from Supabase pg_cron (see supabase/optional) or any external pinger.
 */
async function run(req: Request) {
  cronAuthorized(req);
  const t0 = Date.now(); const budget = intParam(q(req, "budget"), 8000, 2000, 50_000);
  const db = serviceDb();
  let follows = { added: 0, dropped: 0, users: 0 };
  if (q(req, "follow") !== "0") {
    const { data: users } = await db.from("nova_autofollow").select("user_id").eq("enabled", true).order("updated_at", { ascending: true }).limit(10);
    const rows = users?.length ? await loadTraderRows() : [];
    for (const u of users ?? []) { if (Date.now() - t0 > budget * 0.3) break; const r = await refreshAutoFollow(u.user_id as string, rows); follows = { added: follows.added + r.added, dropped: follows.dropped + r.dropped, users: follows.users + 1 }; }
  }
  const watch = await runWatch(Math.max(2000, budget - (Date.now() - t0)));
  return { follows, watch, ms: Date.now() - t0 };
}
export const GET = route(run);
export const POST = route(run);
