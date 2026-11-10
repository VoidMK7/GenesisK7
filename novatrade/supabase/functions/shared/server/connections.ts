import { createConnector } from "../core/connectors/registry.ts";
import type { BrokerConnector } from "../core/connectors/types.ts";
import { decryptSecret } from "../core/crypto.ts";
import { serviceDb } from "./auth.ts";
import { HttpError } from "./http.ts";

export interface ConnectionRow {
  id: string; user_id: string; provider: string; label: string | null; environment: "paper" | "live"; account_ref: string | null;
  secret_id: string | null; withdrawal_permission: boolean | null; trading_permission: boolean | null; permissions_verified: boolean;
  status: string; execution_test_passed_at: string | null;
}

export async function loadConnection(userId: string, id: string): Promise<ConnectionRow> {
  const { data } = await serviceDb().from("nova_broker_connections").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "Connection not found.");
  return data as ConnectionRow;
}

/** Decrypts the stored credentials in memory only for the duration of the call. */
export async function connectorFor(userId: string, id: string): Promise<{ connector: BrokerConnector; row: ConnectionRow }> {
  const row = await loadConnection(userId, id);
  if (!row.secret_id) throw new HttpError(409, "This connection has no stored credentials. Reconnect it.");
  const { data: sec } = await serviceDb().from("nova_secrets").select("ciphertext").eq("id", row.secret_id).eq("user_id", userId).maybeSingle();
  if (!sec) throw new HttpError(409, "Stored credentials are missing. Reconnect it.");
  let creds: { apiKey: string; apiSecret?: string; accountId?: string };
  try {
    creds = JSON.parse(decryptSecret(sec.ciphertext as string));
  } catch {
    throw new HttpError(500, "Stored credentials could not be decrypted (was CREDENTIAL_ENCRYPTION_KEY changed?).");
  }
  return { connector: createConnector(row.provider, { ...creds, environment: row.environment }), row };
}
