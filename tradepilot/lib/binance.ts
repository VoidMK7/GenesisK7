import crypto from "crypto";

// Binance SPOT adapter. UNTESTED against the real API. Defaults to the TESTNET.
export type Creds = { apiKey: string; apiSecret: string; testnet: boolean };
const base = (c: Creds) => (c.testnet ? "https://testnet.binance.vision" : "https://api.binance.com");

async function call(c: Creds, method: "GET" | "POST" | "DELETE", p: string, params: Record<string, string | number> = {}, signed = true) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => q.set(k, String(v)));
  if (signed) {
    q.set("timestamp", String(Date.now()));
    q.set("recvWindow", "5000");
    q.set("signature", crypto.createHmac("sha256", c.apiSecret).update(q.toString()).digest("hex"));
  }
  const res = await fetch(`${base(c)}${p}?${q}`, { method, headers: { "X-MBX-APIKEY": c.apiKey }, cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Binance ${res.status}: ${(j as { msg?: string }).msg || "request failed"}`);
  return j;
}

export async function getAccount(c: Creds) { return call(c, "GET", "/api/v3/account"); }
export async function freeBalance(c: Creds, asset: string): Promise<number> {
  const a = await getAccount(c);
  const b = (a.balances as { asset: string; free: string }[]).find((x) => x.asset === asset);
  return b ? +b.free : 0;
}

type Filters = { stepSize: string; minQty: string; tickSize: string; minNotional: number };
export async function symbolFilters(c: Creds, symbol: string): Promise<Filters> {
  const j = await call(c, "GET", "/api/v3/exchangeInfo", { symbol }, false);
  const f = j.symbols[0].filters as Record<string, string>[];
  const lot = f.find((x) => x.filterType === "LOT_SIZE")!;
  const price = f.find((x) => x.filterType === "PRICE_FILTER")!;
  const notional = f.find((x) => x.filterType === "NOTIONAL" || x.filterType === "MIN_NOTIONAL");
  return { stepSize: lot.stepSize, minQty: lot.minQty, tickSize: price.tickSize, minNotional: notional ? +(notional.minNotional) : 0 };
}
const decimals = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").split(".")[1]?.length ?? 0 : 0);
export function roundDown(x: number, step: string): string {
  const st = +step;
  return (Math.floor(x / st + 1e-9) * st).toFixed(decimals(step));
}

export type Fill = { avgPrice: number; qty: number; orderId: number };
export async function marketOrder(c: Creds, symbol: string, side: "BUY" | "SELL", qty: string): Promise<Fill> {
  const o = await call(c, "POST", "/api/v3/order", { symbol, side, type: "MARKET", quantity: qty, newOrderRespType: "FULL" });
  const executed = +o.executedQty;
  if (!(executed > 0)) throw new Error("Market order did not fill");
  return { avgPrice: +o.cummulativeQuoteQty / executed, qty: executed, orderId: o.orderId };
}
// Protective exit after a BUY: OCO sell (take-profit above, stop-loss below).
export async function placeOco(c: Creds, symbol: string, qty: string, target: string, stop: string, stopLimit: string) {
  const o = await call(c, "POST", "/api/v3/orderList/oco", {
    symbol, side: "SELL", quantity: qty,
    aboveType: "LIMIT_MAKER", abovePrice: target,
    belowType: "STOP_LOSS_LIMIT", belowStopPrice: stop, belowPrice: stopLimit, belowTimeInForce: "GTC",
  });
  return { orderListId: o.orderListId as number };
}
export async function cancelOco(c: Creds, symbol: string, orderListId: number) {
  return call(c, "DELETE", "/api/v3/orderList", { symbol, orderListId });
}
export async function getOcoStatus(c: Creds, orderListId: number) {
  const l = await call(c, "GET", "/api/v3/orderList", { orderListId });
  return { done: l.listOrderStatus === "ALL_DONE", orders: (l.orders || []) as { symbol: string; orderId: number }[] };
}
export async function getOrder(c: Creds, symbol: string, orderId: number) {
  const o = await call(c, "GET", "/api/v3/order", { symbol, orderId });
  return { status: o.status as string, executedQty: +o.executedQty, quote: +o.cummulativeQuoteQty };
}
