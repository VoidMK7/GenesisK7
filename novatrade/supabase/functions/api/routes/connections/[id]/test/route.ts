import { route, uuid, rateLimit } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";
import { connectorFor } from "../../../../../_shared/server/connections.ts";

export const POST = route(async (_req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  rateLimit(`conntest:${s.userId}`, 10, 60_000);
  const { connector, row } = await connectorFor(s.userId, uuid(ctx.params.id));
  const t = await connector.test();
  const verified = t.ok && t.withdrawalPermission === false;
  await serviceDb().from("nova_broker_connections").update({
    status: t.ok ? "connected" : "error", last_error: t.ok ? null : t.error ?? "failed", last_tested_at: new Date().toISOString(),
    permissions: t.permissions, trading_permission: t.tradingPermission,
    // never store `true` for withdrawal: the DB constraint rejects it; a withdrawal-capable key is flagged as an error instead
    withdrawal_permission: t.withdrawalPermission === true ? null : t.withdrawalPermission,
    permissions_verified: verified,
    ...(t.withdrawalPermission === true ? { status: "error", last_error: "Key now has withdrawal permission. Replace it." } : {}),
    ...(verified ? {} : { execution_test_passed_at: null }),
  }).eq("id", row.id).eq("user_id", s.userId);
  return { ok: t.ok, permissionsVerified: verified, withdrawalPermission: t.withdrawalPermission, tradingPermission: t.tradingPermission, error: t.error };
});
