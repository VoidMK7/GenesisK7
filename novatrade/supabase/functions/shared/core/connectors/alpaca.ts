import { ConnectorError, http, type AccountInfo, type Balance, type BrokerConnector, type BrokerPosition, type ConnectorCapabilities, type ConnectorCredentials, type ConnectorOrder, type PlacedOrder, type TestResult, type TradeRecord, type BrokerOrderStatus } from "./types.ts";

const num = (v: unknown): number => (v === undefined || v === null || v === "" ? NaN : Number(v));

function mapStatus(s: string): BrokerOrderStatus {
  switch (s) {
    case "filled": return "filled";
    case "partially_filled": return "partially_filled";
    case "canceled": case "expired": case "done_for_day": return "cancelled";
    case "rejected": case "suspended": return "rejected";
    default: return "accepted"; // new, accepted, pending_new, held, replaced...
  }
}

interface AlpacaOrder { id: string; status: string; filled_qty?: string; filled_avg_price?: string | null }

/** Alpaca (US stocks, ETFs, crypto) via the official Trading API. Trading keys cannot withdraw funds. */
export class AlpacaConnector implements BrokerConnector {
  readonly id = "alpaca";
  readonly capabilities: ConnectorCapabilities = {
    assetClasses: ["stocks", "etf", "crypto"],
    orderTypes: ["market", "limit"],
    stopLoss: true,
    takeProfit: true,
    modifyOrder: true,
    shorting: true,
    paperEnvironment: true,
  };
  private base: string;
  constructor(private c: ConnectorCredentials) {
    if (!c.apiSecret) throw new ConnectorError("Alpaca needs an API key and secret.");
    this.base = c.environment === "paper" ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
  }
  private h() {
    return { "APCA-API-KEY-ID": this.c.apiKey, "APCA-API-SECRET-KEY": this.c.apiSecret!, "content-type": "application/json" };
  }
  private get<T>(p: string) { return http<T>(this.base + p, { headers: this.h() }); }

  async test(): Promise<TestResult> {
    try {
      const a = await this.get<{ id: string; status: string; trading_blocked?: boolean; account_blocked?: boolean }>("/v2/account");
      const canTrade = a.status === "ACTIVE" && !a.trading_blocked && !a.account_blocked;
      return {
        ok: true,
        accountId: a.id,
        permissions: ["read", canTrade ? "trade" : "trade_blocked"],
        // The Alpaca Trading API has no withdrawal endpoint; transfers are not available to these keys.
        withdrawalPermission: false,
        tradingPermission: canTrade,
      };
    } catch (e) {
      return { ok: false, permissions: [], withdrawalPermission: null, tradingPermission: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getAccount(): Promise<AccountInfo> {
    const a = await this.get<{ id: string; currency: string; equity: string; cash: string; buying_power: string }>("/v2/account");
    return { accountId: a.id, currency: a.currency, equity: num(a.equity), cash: num(a.cash), buyingPower: num(a.buying_power) };
  }
  async getBalances(): Promise<Balance[]> {
    const a = await this.getAccount();
    return [{ asset: a.currency, free: a.cash, locked: 0 }];
  }
  async getPositions(): Promise<BrokerPosition[]> {
    const p = await this.get<{ symbol: string; qty: string; avg_entry_price: string; market_value: string; unrealized_pl: string }[]>("/v2/positions");
    return p.map((x) => ({ symbol: x.symbol, quantity: num(x.qty), avgPrice: num(x.avg_entry_price), marketValue: num(x.market_value), unrealizedPnl: num(x.unrealized_pl) }));
  }

  async placeOrder(o: ConnectorOrder): Promise<PlacedOrder> {
    const isCrypto = o.symbol.includes("/");
    const body: Record<string, unknown> = {
      symbol: o.symbol,
      qty: String(o.quantity),
      side: o.side,
      type: o.type,
      time_in_force: isCrypto ? "gtc" : o.type === "limit" ? "gtc" : "day",
      client_order_id: o.clientOrderId,
    };
    if (o.type === "limit") {
      if (o.limitPrice === undefined) throw new ConnectorError("A limit price is required for limit orders.");
      body.limit_price = String(o.limitPrice);
    }
    if (o.stopLoss !== undefined || o.takeProfit !== undefined) {
      if (isCrypto) throw new ConnectorError("Alpaca does not support bracket/stop attachments on crypto orders.");
      // Alpaca: both legs => bracket; stop only or take-profit only => OTO / one leg.
      if (o.stopLoss !== undefined && o.takeProfit !== undefined) body.order_class = "bracket";
      else body.order_class = "oto";
      if (o.takeProfit !== undefined) body.take_profit = { limit_price: String(o.takeProfit) };
      if (o.stopLoss !== undefined) body.stop_loss = { stop_price: String(o.stopLoss) };
    }
    try {
      const r = await http<AlpacaOrder>(this.base + "/v2/orders", { method: "POST", headers: this.h(), body: JSON.stringify(body) });
      return this.toPlaced(r);
    } catch (e) {
      // 4xx from the broker is a definite rejection (the order does not exist). 5xx/network are unknown outcomes.
      if (e instanceof ConnectorError && e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 429) {
        return { brokerOrderId: "", status: "rejected", reason: e.message };
      }
      throw e;
    }
  }
  private toPlaced(r: AlpacaOrder): PlacedOrder {
    return { brokerOrderId: r.id, status: mapStatus(r.status), filledQty: num(r.filled_qty) || undefined, avgPrice: num(r.filled_avg_price) || undefined };
  }
  async getOrder(id: string): Promise<PlacedOrder> {
    return this.toPlaced(await this.get<AlpacaOrder>(`/v2/orders/${encodeURIComponent(id)}`));
  }
  async modifyOrder(id: string, ch: { limitPrice?: number; quantity?: number }): Promise<PlacedOrder> {
    const body: Record<string, string> = {};
    if (ch.limitPrice !== undefined) body.limit_price = String(ch.limitPrice);
    if (ch.quantity !== undefined) body.qty = String(ch.quantity);
    return this.toPlaced(await http<AlpacaOrder>(`${this.base}/v2/orders/${encodeURIComponent(id)}`, { method: "PATCH", headers: this.h(), body: JSON.stringify(body) }));
  }
  async cancelOrder(id: string): Promise<void> {
    await http<unknown>(`${this.base}/v2/orders/${encodeURIComponent(id)}`, { method: "DELETE", headers: this.h() });
  }
  async getTradeHistory(opts: { symbol?: string; limit?: number } = {}): Promise<TradeRecord[]> {
    const rows = await this.get<{ id: string; symbol: string; side: "buy" | "sell"; qty: string; price: string; transaction_time: string }[]>(`/v2/account/activities/FILL?page_size=${opts.limit ?? 50}`);
    return rows
      .filter((r) => !opts.symbol || r.symbol === opts.symbol)
      .map((r) => ({ id: r.id, symbol: r.symbol, side: r.side, quantity: num(r.qty), price: num(r.price), time: r.transaction_time }));
  }
  async closePosition(symbol: string): Promise<PlacedOrder> {
    const r = await http<AlpacaOrder>(`${this.base}/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", headers: this.h() });
    return this.toPlaced(r);
  }
}
