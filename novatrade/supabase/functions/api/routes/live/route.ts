import { checkLiveUnlock } from "../../../_shared/core/execution.ts";
import { body, HttpError, route, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb, securityEvent, notify } from "../../../_shared/server/auth.ts";
import { loadConnection } from "../../../_shared/server/connections.ts";
import { loadRiskLimits, loadSettings } from "../../../_shared/server/account.ts";

export const CONFIRM_PHRASE = "ENABLE LIVE TRADING";

async function checksFor(userId: string, connectionId: string | null) {
  const settings = await loadSettings(userId);
  const limits = await loadRiskLimits(userId);
  const conn = connectionId ? await loadConnection(userId, connectionId) : null;
  const unlock = checkLiveUnlock({
    connection: conn ? { status: conn.status, permissionsVerified: conn.permissions_verified, withdrawalPermission: conn.withdrawal_permission } : null,
    limits, userEnabledLive: settings.liveEnabled, executionTestPassedAt: conn?.execution_test_passed_at ?? null,
  });
  return { settings, ...unlock, connectionEnvironment: conn?.environment ?? null };
}

export const GET = route(async (req: Request) => {
  const s = await requireUser();
  const id = new URL(req.url).searchParams.get("connectionId");
  return { phrase: CONFIRM_PHRASE, ...(await checksFor(s.userId, id ? uuid(id, "connectionId") : null)) };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser();
  const b = await body(req);
  const action = v.oneOf(b, "action", ["enable", "disable"] as const);
  const db = serviceDb();
  if (action === "disable") {
    await db.from("nova_user_settings").upsert({ user_id: s.userId, live_enabled: false, live_unlocked_at: null, execution_mode: "analysis", updated_at: new Date().toISOString() });
    await securityEvent(s.userId, "live_disabled");
    return { ok: true, ...(await checksFor(s.userId, null)) };
  }
  if (v.str(b, "confirm") !== CONFIRM_PHRASE) throw new HttpError(400, `Type exactly: ${CONFIRM_PHRASE}`);
  const connectionId = uuid(v.str(b, "connectionId"), "connectionId");
  const conn = await loadConnection(s.userId, connectionId);
  if (conn.environment !== "live") throw new HttpError(409, "Choose a live-environment connection. Paper/practice connections cannot unlock live trading.");
  // Record the user's explicit opt-in, then see whether every other check really passes.
  await db.from("nova_user_settings").upsert({ user_id: s.userId, live_enabled: true, updated_at: new Date().toISOString() });
  const r = await checksFor(s.userId, connectionId);
  if (!r.unlocked) {
    await db.from("nova_user_settings").update({ live_unlocked_at: null }).eq("user_id", s.userId);
    return { ok: false, message: "Live trading stays locked until every check passes.", ...r };
  }
  await db.from("nova_user_settings").update({ live_unlocked_at: new Date().toISOString() }).eq("user_id", s.userId);
  await securityEvent(s.userId, "live_unlocked", { connectionId });
  await notify(s.userId, "security", "Live trading unlocked", "Live mode can now be selected. You can disable it at any time in Settings.");
  return { ok: true, message: "Live trading is unlocked. Select Live in the mode switch to use it.", ...(await checksFor(s.userId, connectionId)) };
});
