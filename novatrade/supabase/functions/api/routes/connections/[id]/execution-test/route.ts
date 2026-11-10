import { body, HttpError, rateLimit, route, symbol, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, securityEvent, serviceDb } from "../../../../../_shared/server/auth.ts";
import { connectorFor } from "../../../../../_shared/server/connections.ts";
import { parseAssetClass, providerFor } from "../../../../../_shared/server/market.ts";

const CAP_NOTIONAL = 15; // crypto test order stays under this value
const MAX_UNIT_PRICE = 2000;

/** Places a limit order far below the market (it cannot fill), confirms the broker accepted it, then cancels it. */
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  rateLimit(`exectest:${s.userId}`, 3, 300_000);
  const b = await body(req);
  const cls = parseAssetClass(v.str(b, "class"));
  const sym = symbol(v.str(b, "symbol"));
  const { connector, row } = await connectorFor(s.userId, uuid(ctx.params.id));
  if (!row.permissions_verified) throw new HttpError(409, "Verify this connection's permissions first (Test connection).");
  const price = (await providerFor(cls).getQuote(sym)).price;
  const limit = Number((price * 0.5).toPrecision(6));
  const qty = cls === "crypto" ? Number((CAP_NOTIONAL / limit).toPrecision(4)) : 1;
  if (qty * limit > MAX_UNIT_PRICE) throw new HttpError(400, "That instrument is too expensive for a safe test order. Choose a cheaper symbol.");

  const clientOrderId = `nova-test-${Date.now()}`;
  const db = serviceDb();
  let step = "place";
  try {
    const placed = await connector.placeOrder({ symbol: sym, side: "buy", type: "limit", quantity: qty, limitPrice: limit, clientOrderId });
    if (placed.status === "rejected") throw new Error(placed.reason ?? "Order rejected by the broker.");
    if (placed.status === "filled" || placed.status === "partially_filled") {
      await securityEvent(s.userId, "execution_test_unexpected_fill", { provider: row.provider });
      throw new Error("The test order filled unexpectedly. Check your broker account.");
    }
    step = "cancel";
    await connector.cancelOrder(placed.brokerOrderId, sym);
    step = "verify";
    const after = await connector.getOrder(placed.brokerOrderId, sym);
    if (after.status !== "cancelled") throw new Error(`Cancel not confirmed (status: ${after.status}). Cancel it manually at your broker.`);
    await db.from("nova_broker_connections").update({ execution_test_passed_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", s.userId);
    await securityEvent(s.userId, "execution_test_passed", { provider: row.provider });
    return { ok: true, message: `Placed and cancelled a ${qty} ${sym} limit order at ${limit}, far below market. Nothing was bought.` };
  } catch (e) {
    await db.from("nova_broker_connections").update({ execution_test_passed_at: null }).eq("id", row.id).eq("user_id", s.userId);
    throw new HttpError(502, `Execution test failed at "${step}": ${e instanceof Error ? e.message : "unknown error"}`);
  }
});
