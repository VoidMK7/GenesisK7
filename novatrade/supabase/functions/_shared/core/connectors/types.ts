import type { Side } from "../types.ts";

export interface ConnectorCapabilities {
  assetClasses: string[];
  orderTypes: ("market" | "limit")[];
  stopLoss: boolean; // can attach a protective stop to the entry order
  takeProfit: boolean;
  modifyOrder: boolean;
  shorting: boolean;
  paperEnvironment: boolean;
}

export interface ConnectorCredentials {
  apiKey: string;
  apiSecret?: string;
  accountId?: string;
  environment: "paper" | "live";
}

export interface TestResult {
  ok: boolean;
  accountId?: string;
  permissions: string[];
  /** true = key CAN withdraw (we refuse). false = cannot. null = could not be determined (we refuse for live). */
  withdrawalPermission: boolean | null;
  tradingPermission: boolean | null;
  error?: string;
}

export interface AccountInfo {
  accountId: string;
  currency: string;
  equity: number;
  cash: number;
  buyingPower?: number;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number; // signed
  avgPrice: number;
  marketValue: number;
  unrealizedPnl?: number;
}

export interface ConnectorOrder {
  symbol: string;
  side: Side;
  type: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId: string;
}

export type BrokerOrderStatus = "accepted" | "partially_filled" | "filled" | "rejected" | "cancelled";

export interface PlacedOrder {
  brokerOrderId: string;
  status: BrokerOrderStatus;
  filledQty?: number;
  avgPrice?: number;
  fee?: number;
  reason?: string;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee?: number;
  time: string;
}

export interface BrokerConnector {
  readonly id: string;
  readonly capabilities: ConnectorCapabilities;
  test(): Promise<TestResult>;
  getAccount(): Promise<AccountInfo>;
  getBalances(): Promise<Balance[]>;
  getPositions(): Promise<BrokerPosition[]>;
  placeOrder(o: ConnectorOrder): Promise<PlacedOrder>;
  getOrder(brokerOrderId: string, symbol?: string): Promise<PlacedOrder>;
  modifyOrder(brokerOrderId: string, changes: { limitPrice?: number; quantity?: number; stopLoss?: number; takeProfit?: number }, symbol?: string): Promise<PlacedOrder>;
  cancelOrder(brokerOrderId: string, symbol?: string): Promise<void>;
  getTradeHistory(opts?: { symbol?: string; limit?: number }): Promise<TradeRecord[]>;
  closePosition(symbol: string): Promise<PlacedOrder>;
}

export class ConnectorError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

export async function http<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = undefined;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    if (!res.ok) {
      const msg = typeof body === "object" && body && "message" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).message)
        : `HTTP ${res.status}`;
      throw new ConnectorError(msg, res.status, res.status >= 500 || res.status === 429);
    }
    return body as T;
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw new ConnectorError(e instanceof Error ? e.message : "Network error", undefined, true);
  } finally {
    clearTimeout(timer);
  }
}
