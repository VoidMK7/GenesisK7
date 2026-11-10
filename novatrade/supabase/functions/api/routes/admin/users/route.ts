import { body, HttpError, route, uuid, v } from "../../../../_shared/server/http.ts";
import { requireAdmin, securityEvent, serviceDb } from "../../../../_shared/server/auth.ts";

export const GET = route(async () => {
  await requireAdmin();
  const db = serviceDb();
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (error) throw new HttpError(502, "Could not list users.");
  const ids = data.users.map((u) => u.id);
  const [{ data: st }, { data: sub }, { data: roles }] = await Promise.all([
    db.from("nova_user_settings").select("user_id,execution_mode,emergency_stop").in("user_id", ids),
    db.from("nova_subscriptions").select("user_id,plan,status").in("user_id", ids),
    db.from("user_roles").select("user_id,role").in("user_id", ids),
  ]);
  return { users: data.users.map((u) => ({ id: u.id, email: u.email, createdAt: u.created_at, lastSignIn: u.last_sign_in_at,
    mode: st?.find((x) => x.user_id === u.id)?.execution_mode ?? "analysis", emergencyStop: st?.find((x) => x.user_id === u.id)?.emergency_stop ?? false,
    plan: sub?.find((x) => x.user_id === u.id)?.plan ?? "free", subscription: sub?.find((x) => x.user_id === u.id)?.status ?? "active",
    roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role) })) };
});

/** Admins can pause a subscription or force a user's emergency stop on. They can never enable live trading for anyone. */
export const POST = route(async (req: Request) => {
  const a = await requireAdmin();
  const b = await body(req);
  const userId = uuid(v.str(b, "userId"), "userId");
  const action = v.oneOf(b, "action", ["pause", "activate", "emergency_stop"] as const);
  const db = serviceDb();
  if (action === "emergency_stop") await db.from("nova_user_settings").upsert({ user_id: userId, emergency_stop: true, updated_at: new Date().toISOString() });
  else await db.from("nova_subscriptions").upsert({ user_id: userId, status: action === "pause" ? "paused" : "active", updated_at: new Date().toISOString() });
  await securityEvent(userId, `admin_${action}`, { by: a.userId });
  return { ok: true };
});
