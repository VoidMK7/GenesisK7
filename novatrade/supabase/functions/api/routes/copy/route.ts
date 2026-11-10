import { qualifies } from "../../../_shared/core/engines/copy.ts";
import { body, HttpError, route, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { loadSettings } from "../../../_shared/server/account.ts";
import { loadConnection } from "../../../_shared/server/connections.ts";
import { loadTraders } from "../../../_shared/server/traders.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await s.db.from("nova_copy_subscriptions").select("id,leader,allocation,connection_id,max_trade_pct,stop_loss_pct,status,stopped_reason,created_at").eq("follower", s.userId).order("created_at", { ascending: false });
  return { subscriptions: data ?? [] };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser();
  const b = await body(req);
  const db = serviceDb();
  const action = v.oneOf(b, "action", ["start", "stop"] as const);
  if (action === "stop") {
    const { data } = await db.from("nova_copy_subscriptions").update({ status: "stopped", stopped_at: new Date().toISOString(), stopped_reason: "stopped by you" }).eq("id", uuid(v.str(b, "id"))).eq("follower", s.userId).eq("status", "active").select("id").maybeSingle();
    if (!data) throw new HttpError(404, "No active copy subscription found.");
    return { ok: true };
  }
  const leader = uuid(v.str(b, "leader"), "leader");
  if (leader === s.userId) throw new HttpError(400, "You cannot copy yourself.");
  const t = (await loadTraders()).find((x) => x.traderId === leader);
  if (!t) throw new HttpError(404, "That trader is not available for copying.");
  const q = qualifies(t);
  if (!q.ok) throw new HttpError(409, `This trader does not meet the copy requirements: ${q.reasons.join("; ")}.`);
  const settings = await loadSettings(s.userId);
  const connectionId = v.str(b, "connectionId", { optional: true });
  if (settings.executionMode === "live") {
    if (!connectionId) throw new HttpError(400, "Choose the live connection that copied trades should use.");
    const c = await loadConnection(s.userId, uuid(connectionId, "connectionId"));
    if (c.environment !== "live") throw new HttpError(409, "Choose a live connection.");
  }
  // Only trades the leader makes after this moment are copied.
  const { data: last } = await db.from("nova_order_audit").select("id").eq("user_id", leader).eq("mode", "live").order("id", { ascending: false }).limit(1).maybeSingle();
  const { error } = await db.from("nova_copy_subscriptions").insert({
    follower: s.userId, leader, allocation: v.num(b, "allocation", { min: 1 })!, connection_id: connectionId ? uuid(connectionId, "connectionId") : null,
    max_trade_pct: v.num(b, "maxTradePct", { optional: true, min: 1, max: 100 }) ?? 10, stop_loss_pct: v.num(b, "stopLossPct", { optional: true, min: 0.1, max: 50 }) ?? 5,
    cursor_audit_id: Number(last?.id ?? 0),
  });
  if (error) throw new HttpError(409, error.code === "23505" ? "You are already copying this trader." : "Could not start copying.");
  return { ok: true, message: settings.executionMode === "analysis" ? "Copying started. In Analysis Only mode, copied trades are recorded but not executed." : "Copying started." };
});
