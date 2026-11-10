import type { Candle } from "../types.ts";

export type AssetClass = "crypto" | "stocks" | "etf" | "forex" | "commodities" | "indices" | "futures";
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** How fresh the data is, stated by the provider layer rather than guessed by the UI. */
export type Freshness = "realtime" | "delayed" | "unknown";

export interface DataMeta {
  provider: string;
  freshness: Freshness;
  note?: string;
  fetchedAt: number;
}

export interface CandleResult { candles: Candle[]; meta: DataMeta }
export interface Quote { symbol: string; price: number; change24hPct?: number; high24h?: number; low24h?: number; volume24h?: number; meta: DataMeta }
export interface OrderBook { bids: [number, number][]; asks: [number, number][]; meta: DataMeta }

export interface MarketProvider {
  readonly id: string;
  readonly assetClasses: AssetClass[];
  getCandles(symbol: string, interval: Interval, limit: number): Promise<CandleResult>;
  getQuote(symbol: string): Promise<Quote>;
  getOrderBook?(symbol: string, depth: number): Promise<OrderBook>;
  /** Many 24h tickers in one call, for market lists. Optional: not every provider offers it. */
  getTickers?(symbols: string[]): Promise<{ tickers: Quote[]; meta: DataMeta }>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export async function getJson<T>(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(text); msg = j.message ?? j.msg ?? j.errorMessage ?? j.error?.[0] ?? msg; } catch { /* keep */ }
      if (res.status === 451) msg += " (this provider blocks your server's region)";
      throw new ProviderError(String(msg), res.status);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(e instanceof Error ? e.message : "Network error");
  } finally {
    clearTimeout(t);
  }
}

/** Drops malformed bars, sorts, removes duplicates. Providers occasionally return gaps or repeats. */
export function cleanCandles(c: Candle[]): Candle[] {
  const seen = new Set<number>();
  return c
    .filter((x) => [x.t, x.o, x.h, x.l, x.c].every(Number.isFinite) && x.h >= x.l && x.c > 0 && x.o > 0)
    .sort((a, b) => a.t - b.t)
    .filter((x) => (seen.has(x.t) ? false : (seen.add(x.t), true)));
}

export const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};
