// Public market data (no keys). Default host serves public data only and is reachable
// where api.binance.com is geo-blocked. Override with MARKET_DATA_URL.
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
const BASE = () => process.env.MARKET_DATA_URL || "https://data-api.binance.vision";

export const INTERVAL_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };
export const isSymbol = (s: string) => /^[A-Z0-9]{5,15}$/.test(s);

export async function fetchKlines(symbol: string, interval = "15m", limit = 500, startTime?: number): Promise<Candle[]> {
  if (!isSymbol(symbol)) throw new Error("Bad symbol");
  if (!INTERVAL_MIN[interval]) throw new Error("Bad interval");
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime) q.set("startTime", String(startTime));
  const res = await fetch(`${BASE()}/api/v3/klines?${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Market data error ${res.status} for ${symbol}`);
  const rows = (await res.json()) as unknown[][];
  return rows.map((r) => ({ t: Number(r[0]), o: +String(r[1]), h: +String(r[2]), l: +String(r[3]), c: +String(r[4]), v: +String(r[5]) }));
}
export async function fetchPrice(symbol: string): Promise<number> {
  if (!isSymbol(symbol)) throw new Error("Bad symbol");
  const res = await fetch(`${BASE()}/api/v3/ticker/price?symbol=${symbol}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Price error ${res.status} for ${symbol}`);
  return +(await res.json()).price;
}
