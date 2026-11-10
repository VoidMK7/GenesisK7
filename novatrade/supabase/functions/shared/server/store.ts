import type { AuditEntry, ExecutionResult, OrderStore } from "../core/execution.ts";
import { serviceDb } from "./auth.ts";

/** Postgres-backed idempotency and audit. The (user_id, idempotency_key) primary key is what blocks duplicate orders. */
export class SupabaseOrderStore implements OrderStore {
  constructor(private connectionId: string | null) {}

  async claim(userId: string, key: string): Promise<{ fresh: boolean; existing?: ExecutionResult }> {
    const db = serviceDb();
    const { error } = await db.from("nova_order_requests").insert({ user_id: userId, idempotency_key: key });
    if (!error) return { fresh: true };
    if (error.code === "23505") {
      const { data } = await db.from("nova_order_requests").select("result").eq("user_id", userId).eq("idempotency_key", key).maybeSingle();
      return { fresh: false, existing: (data?.result as ExecutionResult | null) ?? undefined };
    }
    throw new Error(`Could not record the order request: ${error.message}`);
  }

  async complete(userId: string, key: string, result: ExecutionResult): Promise<void> {
    await serviceDb().from("nova_order_requests").update({ status: "completed", result, completed_at: new Date().toISOString() }).eq("user_id", userId).eq("idempotency_key", key);
  }

  async audit(e: AuditEntry): Promise<void> {
    const { error } = await serviceDb().from("nova_order_audit").insert({
      user_id: e.userId, connection_id: this.connectionId, engine: e.engine ?? null, mode: e.mode,
      idempotency_key: e.idempotencyKey, event: e.event, broker_order_id: e.brokerOrderId ?? null, detail: e.detail,
    });
    // The audit trail is mandatory: if it cannot be written, the order must not proceed.
    if (error) throw new Error(`Audit write failed: ${error.message}`);
  }
}
