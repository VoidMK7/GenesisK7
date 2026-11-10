import { body, HttpError, rateLimit, route, symbol, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser } from "../../../_shared/server/auth.ts";
import { parseAssetClass } from "../../../_shared/server/market.ts";
import { executeOrder } from "../../../_shared/server/orders.ts";


export const GET = route(async (req: Request) => {
  const s = await requireUser();
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50);
  const { data } = await s.db.from("nova_order_audit").select("id,mode,engine,event,idempotency_key,broker_order_id,detail,created_at").order("id", { ascending: false }).limit(limit);
  return { audit: data ?? [] };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`order:${s.userId}`, 30, 60_000);
  const b = await body(req);
  const type = v.oneOf(b, "type", ["market", "limit"] as const);
  const limitPrice = v.num(b, "limitPrice", { optional: true, min: 1e-12 });
  if (type === "limit" && !limitPrice) throw new HttpError(400, "limitPrice is required for limit orders.");
  const engine = v.str(b, "engine", { optional: true });
  if (engine && !["copy", "algo", "autonomous", "hybrid"].includes(engine)) throw new HttpError(400, "Unknown engine.");
  const connectionId = v.str(b, "connectionId", { optional: true });
  const strategyId = v.str(b, "strategyId", { optional: true });
  // forceMode is deliberately not read from the body.
  return executeOrder(s.userId, {
    assetClass: parseAssetClass(v.str(b, "class")), symbol: symbol(v.str(b, "symbol")), side: v.oneOf(b, "side", ["buy", "sell"] as const), type,
    quantity: v.num(b, "quantity", { min: 1e-12 })!, limitPrice, stopLoss: v.num(b, "stopLoss", { optional: true, min: 1e-12 }), takeProfit: v.num(b, "takeProfit", { optional: true, min: 1e-12 }),
    idempotencyKey: v.str(b, "idempotencyKey", { min: 8, max: 120 }), engine: (engine || undefined) as undefined | "copy" | "algo" | "autonomous" | "hybrid",
    connectionId: connectionId ? uuid(connectionId, "connectionId") : undefined, strategyId: strategyId ? uuid(strategyId, "strategyId") : undefined,
    reduceOnly: v.bool(b, "reduceOnly"),
  });
});
