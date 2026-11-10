import { ConnectorError, http, type AccountInfo, type Balance, type BrokerConnector, type BrokerPosition, type ConnectorCapabilities, type ConnectorCredentials, type ConnectorOrder, type PlacedOrder, type TestResult, type TradeRecord } from "./types.ts";

const num = (v: unknown): number => (v === undefined || v === null || v === "" ? NaN : Number(v));

const px = (instrument: string, v: number) => v.toFixed(instrument.includes("JPY") ? 3 : 5);

/** OANDA v20 REST (forex and CFDs where your account region offers them). Tokens cannot withdraw funds. */
export class OandaConnector implements BrokerConnector {
  readonly id = "oanda";
  readonly capabilities: ConnectorCapabilities = {
    assetClasses: ["forex", "commodities", "indices"],
    orderTypes: ["market", "limit"],
    stopLoss: true,
    takeProfit: true,
    modifyOrder: true,
    shorting: true,
    paperEnvironment: true,
  };
  private base: string;
  private acct: string;
  constructor(private c: ConnectorCredentials) {
    if (!c.accountId) throw new ConnectorError("OANDA needs an account ID (for example 101-001-1234567-001).");
    this.acct = c.accountId;
    this.base = c.environment === "paper" ? "https://api-fxpractice.oanda.com" : "https://api-fxtrade.oanda.com";
  }
  private h() { return { authorization: `Bearer ${this.c.apiKey}`, "content-type": "application/json" }; }
  private get<T>(p: string) { return http<T>(`${this.base}/v3/accounts/${this.acct}${p}`, { headers: this.h() }); }

  async test(): Promise<TestResult> {
    try {
      const r = await this.get<{ account: { id: string; marginAvailable?: string } }>("/summary");
      return { ok: true, accountId: r.account.id, permissions: ["read", "trade"], withdrawalPermission: false, tradingPermission: true };
    } catch (e) {
      return { ok: false, permissions: [], withdrawalPermission: null, tradingPermission: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
  async getAccount(): Promise<AccountInfo> {
    const r = await this.get<{ account: { id: string; currency: string; NAV: string; balance: string; marginAvailable: string } }>("/summary");
    return { accountId: r.account.id, currency: r.account.currency, equity: num(r.account.NAV), cash: num(r.account.balance), buyingPower: num(r.account.marginAvailable) };
  }
  async getBalances(): Promise<Balance[]> {
    const a = await this.getAccount();
    return [{ asset: a.currency, free: a.cash, locked: 0 }];
  }
  async getPositions(): Promise<BrokerPosition[]> {
    const r = await this.get<{ positions: { instrument: string; long: { units: string; averagePrice?: string; unrealizedPL?: string }; short: { units: string; averagePrice?: string; unrealizedPL?: string } }[] }>("/openPositions");
    const out: BrokerPosition[] = [];
    for (const p of r.positions) {
      const lu = num(p.long.units), su = num(p.short.units);
      if (lu) out.push({ symbol: p.instrument, quantity: lu, avgPrice: num(p.long.averagePrice), marketValue: NaN, unrealizedPnl: num(p.long.unrealizedPL) });
      if (su) out.push({ symbol: p.instrument, quantity: su, avgPrice: num(p.short.averagePrice), marketValue: NaN, unrealizedPnl: num(p.short.unrealizedPL) });
    }
    return out;
  }

  async placeOrder(o: ConnectorOrder): Promise<PlacedOrder> {
    const units = o.side === "buy" ? o.quantity : -o.quantity;
    const order: Record<string, unknown> = {
      type: o.type === "market" ? "MARKET" : "LIMIT",
      instrument: o.symbol,
      units: String(units),
      timeInForce: o.type === "market" ? "FOK" : "GTC",
      positionFill: "DEFAULT",
      clientExtensions: { id: o.clientOrderId.slice(0, 50) },
    };
    if (o.type === "limit") {
      if (o.limitPrice === undefined) throw new ConnectorError("A limit price is required for limit orders.");
      order.price = px(o.symbol, o.limitPrice);
    }
    if (o.stopLoss !== undefined) order.stopLossOnFill = { price: px(o.symbol, o.stopLoss) };
    if (o.takeProfit !== undefined) order.takeProfitOnFill = { price: px(o.symbol, o.takeProfit) };
    try {
      const r = await http<{
        orderFillTransaction?: { id: string; price?: string; units?: string; commission?: string };
        orderCreateTransaction?: { id: string };
        orderCancelTransaction?: { id: string; reason?: string };
        orderRejectTransaction?: { id: string; rejectReason?: string };
      }>(`${this.base}/v3/accounts/${this.acct}/orders`, { method: "POST", headers: this.h(), body: JSON.stringify({ order }) });
      if (r.orderFillTransaction) {
        const f = r.orderFillTransaction;
        return { brokerOrderId: r.orderCreateTransaction?.id ?? f.id, status: "filled", filledQty: Math.abs(num(f.units)), avgPrice: num(f.price), fee: Math.abs(num(f.commission)) || 0 };
      }
      if (r.orderCancelTransaction) return { brokerOrderId: r.orderCreateTransaction?.id ?? r.orderCancelTransaction.id, status: "rejected", reason: r.orderCancelTransaction.reason };
      if (r.orderRejectTransaction) return { brokerOrderId: r.orderRejectTransaction.id, status: "rejected", reason: r.orderRejectTransaction.rejectReason };
      return { brokerOrderId: r.orderCreateTransaction?.id ?? "", status: "accepted" };
    } catch (e) {
      if (e instanceof ConnectorError && e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 429) {
        return { brokerOrderId: "", status: "rejected", reason: e.message };
      }
      throw e;
    }
  }
  async getOrder(id: string): Promise<PlacedOrder> {
    const r = await this.get<{ order: { id: string; state: string; fillingTransactionID?: string; price?: string } }>(`/orders/${encodeURIComponent(id)}`);
    const st = r.order.state;
    if (st === "FILLED") {
      let avg: number | undefined;
      let qty: number | undefined;
      if (r.order.fillingTransactionID) {
        try {
          const t = await this.get<{ transaction: { price?: string; units?: string } }>(`/transactions/${encodeURIComponent(r.order.fillingTransactionID)}`);
          avg = num(t.transaction.price); qty = Math.abs(num(t.transaction.units));
        } catch { /* fill details unavailable: leave undefined so it is NOT reported as confirmed */ }
      }
      return { brokerOrderId: id, status: "filled", avgPrice: avg, filledQty: qty };
    }
    if (st === "CANCELLED") return { brokerOrderId: id, status: "cancelled" };
    return { brokerOrderId: id, status: "accepted" };
  }
  async modifyOrder(id: string, ch: { limitPrice?: number; quantity?: number; stopLoss?: number; takeProfit?: number }, symbol?: string): Promise<PlacedOrder> {
    const existing = await this.get<{ order: { type: string; instrument: string; units: string; price?: string } }>(`/orders/${encodeURIComponent(id)}`);
    const inst = symbol ?? existing.order.instrument;
    const order = {
      type: existing.order.type,
      instrument: inst,
      units: ch.quantity !== undefined ? String(Math.sign(num(existing.order.units)) * ch.quantity) : existing.order.units,
      price: ch.limitPrice !== undefined ? px(inst, ch.limitPrice) : existing.order.price,
      timeInForce: "GTC",
      positionFill: "DEFAULT",
    };
    const r = await http<{ orderCreateTransaction?: { id: string } }>(`${this.base}/v3/accounts/${this.acct}/orders/${encodeURIComponent(id)}`, { method: "PUT", headers: this.h(), body: JSON.stringify({ order }) });
    return { brokerOrderId: r.orderCreateTransaction?.id ?? id, status: "accepted" };
  }
  async cancelOrder(id: string): Promise<void> {
    await http<unknown>(`${this.base}/v3/accounts/${this.acct}/orders/${encodeURIComponent(id)}/cancel`, { method: "PUT", headers: this.h() });
  }
  async getTradeHistory(opts: { symbol?: string; limit?: number } = {}): Promise<TradeRecord[]> {
    const q = `?state=CLOSED&count=${opts.limit ?? 50}${opts.symbol ? `&instrument=${encodeURIComponent(opts.symbol)}` : ""}`;
    const r = await this.get<{ trades: { id: string; instrument: string; initialUnits: string; price: string; closeTime?: string; openTime: string; financing?: string }[] }>(`/trades${q}`);
    return r.trades.map((t) => ({ id: t.id, symbol: t.instrument, side: num(t.initialUnits) >= 0 ? "buy" : "sell", quantity: Math.abs(num(t.initialUnits)), price: num(t.price), time: t.closeTime ?? t.openTime }));
  }
  async closePosition(symbol: string): Promise<PlacedOrder> {
    const pos = (await this.getPositions()).find((p) => p.symbol === symbol);
    if (!pos) throw new ConnectorError(`No open position in ${symbol}.`);
    const body = pos.quantity > 0 ? { longUnits: "ALL" } : { shortUnits: "ALL" };
    const r = await http<{ longOrderFillTransaction?: { id: string; price?: string; units?: string }; shortOrderFillTransaction?: { id: string; price?: string; units?: string } }>(
      `${this.base}/v3/accounts/${this.acct}/positions/${encodeURIComponent(symbol)}/close`, { method: "PUT", headers: this.h(), body: JSON.stringify(body) });
    const f = r.longOrderFillTransaction ?? r.shortOrderFillTransaction;
    if (!f) return { brokerOrderId: "", status: "accepted" };
    return { brokerOrderId: f.id, status: "filled", avgPrice: num(f.price), filledQty: Math.abs(num(f.units)) };
  }
}
