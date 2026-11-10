import { createConnector, getConnectorInfo } from "../../../_shared/core/connectors/registry.ts";
import { encryptSecret, maskSecret } from "../../../_shared/core/crypto.ts";
import { body, HttpError, rateLimit, route, v } from "../../../_shared/server/http.ts";
import { requireUser, securityEvent, serviceDb } from "../../../_shared/server/auth.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await s.db.from("nova_broker_connections")
    .select("id,provider,label,environment,account_ref,withdrawal_permission,trading_permission,permissions_verified,status,last_error,last_tested_at,execution_test_passed_at,created_at")
    .order("created_at", { ascending: false });
  return { connections: data ?? [] };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`conn:${s.userId}`, 8, 60_000);
  const b = await body(req);
  const provider = v.str(b, "provider");
  const info = getConnectorInfo(provider);
  if (!info) throw new HttpError(400, "Unknown provider.");
  if (info.support !== "supported") throw new HttpError(400, `${info.name} is not supported yet. ${info.limitations[0] ?? ""}`);
  const environment = v.oneOf(b, "environment", ["paper", "live"] as const);
  const apiKey = v.str(b, "apiKey", { max: 300 });
  const apiSecret = v.str(b, "apiSecret", { optional: true, max: 300 }) || undefined;
  const accountId = v.str(b, "accountId", { optional: true, max: 100 }) || undefined;
  for (const f of info.credentialFields) if (f.required && !({ apiKey, apiSecret, accountId })[f.key]) throw new HttpError(400, `${f.label} is required.`);
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) throw new HttpError(503, "CREDENTIAL_ENCRYPTION_KEY is not set on the server, so credentials cannot be stored safely.");

  const creds = { apiKey, apiSecret, accountId, environment };
  const test = await createConnector(provider, creds).test();
  if (!test.ok) throw new HttpError(400, `The broker rejected these credentials: ${test.error ?? "unknown error"}`);
  if (test.withdrawalPermission === true) {
    await securityEvent(s.userId, "withdrawal_key_refused", { provider });
    throw new HttpError(400, "This key can withdraw funds. NovaTrade never accepts keys with withdrawal permission. Create a trade-only key and try again.");
  }
  if (test.tradingPermission === false) throw new HttpError(400, "This key cannot trade. Create a key with trading permission.");

  const db = serviceDb();
  const { data: sec, error: e1 } = await db.from("nova_secrets").insert({ user_id: s.userId, kind: "broker", ciphertext: encryptSecret(JSON.stringify(creds)), hint: maskSecret(apiKey) }).select("id").single();
  if (e1 || !sec) throw new HttpError(500, "Could not store the credentials.");
  const { data: conn, error: e2 } = await db.from("nova_broker_connections").insert({
    user_id: s.userId, provider, label: v.str(b, "label", { optional: true, max: 60 }) || info.name, environment, account_ref: test.accountId ?? accountId ?? null,
    secret_id: sec.id, permissions: test.permissions, withdrawal_permission: test.withdrawalPermission, trading_permission: test.tradingPermission,
    permissions_verified: test.withdrawalPermission === false, status: "connected", last_tested_at: new Date().toISOString(),
  }).select("id,permissions_verified").single();
  if (e2 || !conn) { await db.from("nova_secrets").delete().eq("id", sec.id); throw new HttpError(500, "Could not save the connection."); }
  await securityEvent(s.userId, "connection_created", { provider, environment });
  return {
    id: conn.id, permissionsVerified: conn.permissions_verified, hint: maskSecret(apiKey),
    warning: test.withdrawalPermission === null ? "NovaTrade could not confirm this key cannot withdraw, so live trading will stay locked for this connection." : undefined,
  };
});
