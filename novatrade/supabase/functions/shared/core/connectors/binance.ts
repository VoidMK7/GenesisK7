import { createHmac } from "node:crypto";
import { ConnectorError, http, type AccountInfo, type Balance, type BrokerConnector, type BrokerPosition, type ConnectorCapabilities, type ConnectorCredentials, type ConnectorOrder, type PlacedOrder, type TestResult, type TradeRecord, type BrokerOrderStatus } from "./types.ts";

const num = (v: unknown): number => (v === undefined || v === null || v === "" ? NaN : Number(v));
const STABLES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

function mapStatus(s: string): BrokerOrderStatus {
  switch (s) {
    case "FILLED": return "filled";
    case "PARTIALLY_FILLED": return "partially_filled";
    case "CANCELED": case "EXPIRED": case "EXPIRED_IN_MATCH": case "PENDING_CANCEL": return "cancelled";
    case "REJECTED": return "rejected";
    default: return "accepted";
  }
}

const decimals = (step: string) => {
  const s = step.replace(/0+$/, "");
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};
const floorTo = (v: number, step: string) => {
  const st = Number(step);
  if (!(st > 0)) return v.toString();
  return (Math.floor(v / st + 1e-9) * st).toFixed(decimals(step));
};

interface BOrder { symbol: string; orderId: number; clientOrderId: string; status: string; executedQty: string; cummulativeQuoteQty: string; fills?: { commission: string; commissionAsset: string }[] }

/**
 * Binance Spot. Limitation (by design): this connector places the entry order only. It cannot attach a protective
 * stop, so `capabilities.stopLoss` is false and live orders are blocked while "require stop-loss" is on.
 * Binance.com is unavailable in some regions (HTTP 451); that error is shown as-is.
 */
export class BinanceConnector implements BrokerConnector {
  readonly id = "binance";
  readonly capabilities: ConnectorCapabilities = {
    assetClasses: ["crypto"],
    orderTypes: ["market", "limit"],
    stopLoss: false,
    takeProfit: false,
    modifyOrder: false,
    shorting: false,
    paperEnvironment: true, // Binance Spot Testnet
  };
  private base: string;
  constructor(private c: ConnectorCredentials, private now: () => number = Date.now) {
    if (!c.apiSecret) throw new ConnectorError("Binance needs an API key and secret.");
    this.base = c.environment === "paper" ? "https://testnet.binance.vision" : "https://api.binance.com";
  }
  private sign(params: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    q.set("timestamp", String(this.now()));
    q.set("recvWindow", "5000");
    const qs = q.toString();
    const sig = createHmac("sha256", this.c.apiSecret!).update(qs).digest("hex");
    return `${qs}&signature=${sig}`;
  }
  private req<T>(method: string, path: string, params: Record<string, string | number | undefined> = {}) {
    return http<T>(`${this.base}${path}?${this.sign(params)}`, { method, headers: { "X-MBX-APIKEY": this.c.apiKey } });
  }
  private pub<T>(path: string) { return http<T>(`${this.base}${path}`); }

  async test(): Promise<TestResult> {
    try {
      const acct = await this.req<{ canTrade: boolean; accountType?: string }>("GET", "/api/v3/account");
      let withdrawal: boolean | null = null;
      if (this.c.environment === "paper") {
        withdrawal = false; // the testnet has no withdrawals
      } else {
        try {
          const r = await this.req<{ enableWithdrawals: boolean; enableSpotAndMarginTrading: boolean }>("GET", "/sapi/v1/account/apiRestrictions");
          withdrawal = Boolean(r.enableWithdrawals);
        } catch { withdrawal = null; } // cannot verify: live stays locked
      }
      return {
        ok: true,
        accountId: acct.accountType ?? "spot",
        permissions: ["read", acct.canTrade ? "trade" : "trade_blocked", ...(withdrawal ? ["WITHDRAW"] : [])],
        withdrawalPermission: withdrawal,
        tradingPermission: acct.canTrade,
        error: withdrawal === null ? "Could not verify withdrawal permission. Live trading stays locked until it can be verified." : undefined,
      };
    } catch (e) {
      return { ok: false, permissions: [], withdrawalPermission: null, tradingPermission: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getBalances(): Promise<Balance[]> {
    const a = await this.req<{ balances: { asset: string; free: string; locked: string }[] }>("GET", "/api/v3/account");
    return a.balances.map((b) => ({ asset: b.asset, free: num(b.free), locked: num(b.locked) })).filter((b) => b.free > 0 || b.locked > 0);
  }
  async getAccount(): Promise<AccountInfo> {
    const bal = await this.getBalances();
    const cash = bal.filter((b) => b.asset === "USDT").reduce((s, b) => s + b.free + b.locked, 0);
    const pos = await this.getPositions();
    const held = pos.reduce((s, p) => s + (Number.isFinite(p.marketValue) ? p.marketValue : 0), 0);
    const otherStables = bal.filter((b) => STABLES.has(b.asset) && b.asset !== "USDT").reduce((s, b) => s + b.free + b.locked, 0);
    return { accountId: "spot", currency: "USDT", equity: cash + otherStables + held, cash };
  }
  async getPositions(): Promise<BrokerPosition[]> {
    const bal = await this.getBalances();
    const out: BrokerPosition[] = [];
    for (const b of bal) {
      if (STABLES.has(b.asset)) continue;
      const qty = b.free + b.locked;
      let price = NaN;
      try { price = num((await this.pub<{ price: string }>(`/api/v3/ticker/price?symbol=${b.asset}USDT`)).price); } catch { /* unpriced */ }
      out.push({ symbol: `${b.asset}USDT`, quantity: qty, avgPrice: NaN, marketValue: Number.isFinite(price) ? qty * price : NaN });
    }
    return out;
  }

  private async filters(symbol: string) {
    const r = await this.pub<{ symbols: { baseAsset: string; filters: { filterType: string; stepSize?: string; tickSize?: string; minQty?: string }[] }[] }>(`/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
    const s = r.symbols[0];
    if (!s) throw new ConnectorError(`Unknown symbol ${symbol}.`);
    return {
      base: s.baseAsset,
      step: s.filters.find((f) => f.filterType === "LOT_SIZE")?.stepSize ?? "0.00000001",
      tick: s.filters.find((f) => f.filterType === "PRICE_FILTER")?.tickSize ?? "0.00000001",
    };
  }

  async placeOrder(o: ConnectorOrder): Promise<PlacedOrder> {
    if (o.stopLoss !== undefined || o.takeProfit !== undefined) {
      throw new ConnectorError("The Binance connector cannot attach stop-loss or take-profit orders.");
    }
    const f = await this.filters(o.symbol);
    const params: Record<string, string | number | undefined> = {
      symbol: o.symbol,
      side: o.side.toUpperCase(),
      type: o.type.toUpperCase(),
      quantity: floorTo(o.quantity, f.step),
      newClientOrderId: o.clientOrderId.slice(0, 36),
      newOrderRespType: "FULL",
    };
    if (o.type === "limit") {
      if (o.limitPrice === undefined) throw new ConnectorError("A limit price is required for limit orders.");
      params.price = floorTo(o.limitPrice, f.tick);
      params.timeInForce = "GTC";
    }
    try {
      return this.toPlaced(await this.req<BOrder>("POST", "/api/v3/order", params));
    } catch (e) {
      if (e instanceof ConnectorError && e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 429) {
        return { brokerOrderId: "", status: "rejected", reason: e.message };
      }
      throw e;
    }
  }
  private toPlaced(r: BOrder): PlacedOrder {
    const qty = num(r.executedQty);
    const quote = num(r.cummulativeQuoteQty);
    return {
      brokerOrderId: String(r.orderId),
      status: mapStatus(r.status),
      filledQty: qty > 0 ? qty : undefined,
      avgPrice: qty > 0 ? quote / qty : undefined,
    };
  }
  async getOrder(id: string, symbol?: string): Promise<PlacedOrder> {
    if (!symbol) throw new ConnectorError("Binance needs the symbol to look up an order.");
    return this.toPlaced(await this.req<BOrder>("GET", "/api/v3/order", { symbol, orderId: id }));
  }
  async modifyOrder(): Promise<PlacedOrder> {
    throw new ConnectorError("Modifying orders is not supported by this connector. Cancel and place a new order.");
  }
  async cancelOrder(id: string, symbol?: string): Promise<void> {
    if (!symbol) throw new ConnectorError("Binance needs the symbol to cancel an order.");
    await this.req<unknown>("DELETE", "/api/v3/order", { symbol, orderId: id });
  }
  async getTradeHistory(opts: { symbol?: string; limit?: number } = {}): Promise<TradeRecord[]> {
    if (!opts.symbol) throw new ConnectorError("Binance trade history needs a symbol.");
    const r = await this.req<{ id: number; symbol: string; isBuyer: boolean; qty: string; price: string; time: number }[]>("GET", "/api/v3/myTrades", { symbol: opts.symbol, limit: opts.limit ?? 50 });
    return r.map((t) => ({ id: String(t.id), symbol: t.symbol, side: t.isBuyer ? "buy" : "sell", quantity: num(t.qty), price: num(t.price), time: new Date(t.time).toISOString() }));
  }
  async closePosition(symbol: string): Promise<PlacedOrder> {
    const f = await this.filters(symbol);
    const bal = (await this.getBalances()).find((b) => b.asset === f.base);
    if (!bal || bal.free <= 0) throw new ConnectorError(`No free ${f.base} balance to sell.`);
    return this.placeOrder({ symbol, side: "sell", type: "market", quantity: bal.free, clientOrderId: `close-${Date.now()}` });
  }
}
