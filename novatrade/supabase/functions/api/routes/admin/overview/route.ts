import { integrationStatus } from "../../../../_shared/server/config.ts";
import { route } from "../../../../_shared/server/http.ts";
import { requireAdmin, serviceDb } from "../../../../_shared/server/auth.ts";

export const GET = route(async () => {
  await requireAdmin();
  const db = serviceDb();
  const count = async (t: string, f?: (q: any) => any) => { const q = db.from(t).select("*", { count: "exact", head: true }); const { count: c } = await (f ? f(q) : q); return c ?? 0; };
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [strategies, backtests, connections, pendingSources, pendingStrategies, liveUsers, subs] = await Promise.all([
    count("nova_strategies"), count("nova_backtests"), count("nova_broker_connections"),
    count("nova_knowledge_sources", (q) => q.eq("status", "pending_review")), count("nova_strategies", (q) => q.eq("moderation", "pending")),
    count("nova_user_settings", (q) => q.eq("execution_mode", "live")), count("nova_copy_subscriptions", (q) => q.eq("status", "active")),
  ]);
  const { data: usage } = await db.from("nova_api_usage").select("*").gte("day", since.slice(0, 10)).order("day", { ascending: false });
  const { data: events } = await db.from("nova_security_events").select("id,user_id,kind,created_at").order("id", { ascending: false }).limit(30);
  return { integrations: integrationStatus(), counts: { strategies, backtests, connections, pendingSources, pendingStrategies, liveUsers, activeCopySubscriptions: subs }, usage: usage ?? [], securityEvents: events ?? [] };
});
