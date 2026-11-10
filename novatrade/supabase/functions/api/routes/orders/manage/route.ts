import { body, HttpError, rateLimit, route, symbol, uuid, v } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { connectorFor } from "../../../../_shared/server/connections.ts";
import { ensurePaperAccount } from "../../../../_shared/server/account.ts";
import { parseAssetClass } from "../../../../_shared/server/market.ts";
import { executeOrder } from "../../../../_shared/server/orders.ts";
import { SupabaseOrderStore } from "../../../../_shared/server/store.ts";


/** Cancel, close or modify. Each is idempotent and writes to the audit trail. */
export const POST = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`manage:${s.userId}`, 30, 60_000);
  const b = await body(req);
  const action = v.oneOf(b, "action", ["cancel", "close", "modify"] as const);
  const key = v.str(b, "idempotencyKey", { min: 8, max: 120 });
  const sym = symbol(v.str(b, "symbol"));
  const connectionId = v.str(b, "connectionId", { optional: true });

  if (action === "close" && !connectionId) {
    const { account, classes } = await ensurePaperAccount(s.userId);
    const pos = account.positions.find((p) => p.symbol === sym);
    if (!pos) throw new HttpError(404, "No open paper position for that symbol.");
    return executeOrder(s.userId, { assetClass: classes[sym] ?? parseAssetClass(v.str(b, "class", { optional: true }) || "crypto"), symbol: sym, side: "sell", type: "market", quantity: pos.qty, idempotencyKey: key, forceMode: "paper", reduceOnly: true });
  }
  if (!connectionId) throw new HttpError(400, "connectionId is required.");
  const { connector, row } = await connectorFor(s.userId, uuid(connectionId, "connectionId"));
  const store = new SupabaseOrderStore(row.id);
  const claim = await store.claim(s.userId, key);
  if (!claim.fresh) return claim.existing ?? { status: "duplicate", message: "This request is already being processed." };
  const mode = row.environment === "live" ? "live" : "paper";
  const brokerOrderId = v.str(b, "brokerOrderId", { optional: true, max: 120 });

  try {
    if (action === "cancel") {
      if (!brokerOrderId) throw new HttpError(400, "brokerOrderId is required.");
      await connector.cancelOrder(brokerOrderId, sym);
      await store.audit({ userId: s.userId, mode, idempotencyKey: key, event: "cancelled", brokerOrderId, detail: { symbol: sym } });
    } else if (action === "modify") {
      if (!brokerOrderId) throw new HttpError(400, "brokerOrderId is required.");
      if (!connector.capabilities.modifyOrder) throw new HttpError(409, "This broker connection cannot modify orders. Cancel and re-place instead.");
      const changes = { limitPrice: v.num(b, "limitPrice", { optional: true, min: 1e-12 }), quantity: v.num(b, "quantity", { optional: true, min: 1e-12 }) };
      const r = await connector.modifyOrder(brokerOrderId, changes, sym);
      await store.audit({ userId: s.userId, mode, idempotencyKey: key, event: "modified", brokerOrderId: r.brokerOrderId, detail: { symbol: sym, changes } });
    } else {
      const r = await connector.closePosition(sym);
      await store.audit({ userId: s.userId, mode, idempotencyKey: key, event: r.status === "filled" ? "filled" : "submitted", brokerOrderId: r.brokerOrderId, detail: { symbol: sym, closing: true, status: r.status, price: r.avgPrice ?? null, quantity: r.filledQty ?? null, side: "sell" } });
    }
    const result = { status: "ok", message: `${action} sent to the broker.` };
    await store.complete(s.userId, key, result as never);
    return result;
  } catch (e) {
    const result = { status: "error", message: e instanceof Error ? e.message : "Broker error." };
    await store.complete(s.userId, key, result as never);
    throw e instanceof HttpError ? e : new HttpError(502, result.message);
  }
});
