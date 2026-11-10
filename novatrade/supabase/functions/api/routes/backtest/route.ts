import { backtest, passesGate, type StrategyId } from "../../../_shared/core/backtest.ts";
import { body, rateLimit, route, symbol, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { parseAssetClass, parseInterval, withProvider } from "../../../_shared/server/market.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await s.db.from("nova_backtests").select("id,symbol,market,interval,strategy,params,result,created_at").order("created_at", { ascending: false }).limit(30);
  return { backtests: data ?? [] };
});

export const POST = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`bt:${s.userId}`, 15, 60_000);
  const b = await body(req);
  const cls = parseAssetClass(v.str(b, "class"));
  const sym = symbol(v.str(b, "symbol"));
  const interval = parseInterval(v.str(b, "interval", { optional: true }) || "1h");
  const strategy = v.oneOf<StrategyId>(b, "strategy", ["sma_cross", "rsi_meanrev"]);
  const params = {
    fast: v.num(b, "fast", { optional: true, min: 2, max: 200 }), slow: v.num(b, "slow", { optional: true, min: 3, max: 400 }),
    period: v.num(b, "period", { optional: true, min: 2, max: 100 }), buyBelow: v.num(b, "buyBelow", { optional: true, min: 1, max: 50 }), sellAbove: v.num(b, "sellAbove", { optional: true, min: 50, max: 99 }),
  };
  const feeBps = v.num(b, "feeBps", { optional: true, min: 0, max: 200 }) ?? 10;
  const slippageBps = v.num(b, "slippageBps", { optional: true, min: 0, max: 200 }) ?? 5;
  const { candles, meta } = await withProvider(cls, (p) => p.getCandles(sym, interval, 1000));
  const r = backtest(candles, { strategy, params, feeBps, slippageBps });
  const gate = passesGate(r);
  const payload = { ...r, gate, data: meta, equity: r.equity.filter((_, i) => i % Math.max(1, Math.floor(r.equity.length / 300)) === 0) };
  const { data } = await serviceDb().from("nova_backtests").insert({ user_id: s.userId, symbol: sym, market: cls, interval, strategy, params, result: payload }).select("id").single();
  return { id: data?.id ?? null, ...payload };
});
