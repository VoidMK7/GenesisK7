import { route } from "../../../../_shared/server/http.ts";
import { serviceDb } from "../../../../_shared/server/auth.ts";
import { cronAuthorized } from "../../../../_shared/server/cron.ts";
import { runUserCycle } from "../../../../_shared/server/memecoin.ts";
import { intParam, q } from "../../../../_shared/server/util.ts";

/** Runs the scan/analyse/risk/execute cycle for users whose strategy is switched on, least-recently-run first, within a time budget. */
async function run(req: Request) {
  cronAuthorized(req);
  const t0 = Date.now(); const budget = intParam(q(req, "budget"), 8000, 2000, 50_000);
  const { data: due } = await serviceDb().from("nova_meme_strategy").select("user_id").eq("enabled", true).order("last_cycle_at", { ascending: true, nullsFirst: true }).limit(20);
  const done: Record<string, unknown>[] = [];
  for (const u of due ?? []) {
    if (Date.now() - t0 > budget - 3500) break;                      // a cycle needs a few seconds; do not start one we cannot finish
    try { done.push({ ...(await runUserCycle(u.user_id as string)), user: String(u.user_id).slice(0, 8) }); } catch (e) { done.push({ user: String(u.user_id).slice(0, 8), error: e instanceof Error ? e.message : "failed" }); }
  }
  return { users: done.length, due: due?.length ?? 0, results: done, ms: Date.now() - t0 };
}
export const GET = route(run);
export const POST = route(run);
