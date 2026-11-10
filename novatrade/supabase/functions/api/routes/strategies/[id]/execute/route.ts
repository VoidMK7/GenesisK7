import type { StrategyProposal } from "../../../../../_shared/core/types.ts";
import type { AssetClass } from "../../../../../_shared/core/market/types.ts";
import { body, HttpError, rateLimit, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";
import { executeOrder } from "../../../../../_shared/server/orders.ts";


/** Sends an approved long strategy through the same risk-checked pipeline as any other order. */
export const POST = route(async (req: Request, ctx: { params: { id: string } }) => {
  const s = await requireUser();
  rateLimit(`exec:${s.userId}`, 20, 60_000);
  const id = uuid(ctx.params.id);
  const b = await body(req);
  const { data: st } = await serviceDb().from("nova_strategies").select("*").eq("id", id).eq("user_id", s.userId).maybeSingle();
  if (!st) throw new HttpError(404, "Strategy not found.");
  if (st.status !== "approved") throw new HttpError(409, "Approve the strategy before executing it.");
  const p = (st.payload as { proposal: StrategyProposal }).proposal;
  if (p.direction !== "long") throw new HttpError(409, "Only long strategies can be executed. Short and neutral proposals are analysis-only.");
  const connectionId = v.str(b, "connectionId", { optional: true });
  return executeOrder(s.userId, {
    assetClass: st.market as AssetClass, symbol: st.symbol, side: "buy", type: p.entry.type, quantity: v.num(b, "quantity", { min: 1e-12 })!,
    limitPrice: p.entry.type === "limit" ? p.entry.price : undefined, stopLoss: p.stopLoss, takeProfit: p.takeProfits[0],
    idempotencyKey: v.str(b, "idempotencyKey", { min: 8, max: 120 }), engine: st.engine, strategyId: id, connectionId: connectionId ? uuid(connectionId, "connectionId") : undefined,
  });
});
