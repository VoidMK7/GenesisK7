import type { Candle } from "../types.ts";
import { cleanCandles, getJson, INTERVAL_MS, ProviderError, type AssetClass, type CandleResult, type DataMeta, type Interval, type MarketProvider, type OrderBook, type Quote } from "./types.ts";

const n = (v: unknown) => Number(v);
const meta = (provider: string, freshness: "realtime" | "delayed" | "unknown", note?: string) => ({ provider, freshness, note, fetchedAt: Date.now() });

/** Binance public market data (no key). Real-time. Symbols look like BTCUSDT. */
export class BinancePublic implements MarketProvider {
  readonly id = "binance";
  readonly assetClasses: AssetClass[] = ["crypto"];
  constructor(private base = "https://api.binance.com") {}

  async getCandles(symbol: string, interval: Interval, limit: number): Promise<CandleResult> {
    const rows = await getJson<(string | number)[][]>(`${this.base}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${Math.min(limit, 1000)}`);
    const candles: Candle[] = rows.map((r) => ({ t: n(r[0]), o: n(r[1]), h: n(r[2]), l: n(r[3]), c: n(r[4]), v: n(r[5]) }));
    return { candles: cleanCandles(candles), meta: meta("binance", "realtime", "Includes the still-forming latest bar.") };
  }
  async getQuote(symbol: string): Promise<Quote> {
    const t = await getJson<{ lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }>(`${this.base}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
    return { symbol, price: n(t.lastPrice), change24hPct: n(t.priceChangePercent), high24h: n(t.highPrice), low24h: n(t.lowPrice), volume24h: n(t.quoteVolume), meta: meta("binance", "realtime") };
  }
  async getTickers(symbols: string[]): Promise<{ tickers: Quote[]; meta: DataMeta }> {
    const list = encodeURIComponent(JSON.stringify(symbols));
    const rows = await getJson<{ symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }[]>(`${this.base}/api/v3/ticker/24hr?symbols=${list}`);
    const m = meta("binance", "realtime");
    return { tickers: rows.map((t) => ({ symbol: t.symbol, price: n(t.lastPrice), change24hPct: n(t.priceChangePercent), high24h: n(t.highPrice), low24h: n(t.lowPrice), volume24h: n(t.quoteVolume), meta: m })), meta: m };
  }
  async getOrderBook(symbol: string, depth = 20): Promise<OrderBook> {
    const d = await getJson<{ bids: string[][]; asks: string[][] }>(`${this.base}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${depth}`);
    return { bids: d.bids.map((x) => [n(x[0]), n(x[1])]), asks: d.asks.map((x) => [n(x[0]), n(x[1])]), meta: meta("binance", "realtime") };
  }
}

const KRAKEN_INTERVAL: Record<Interval, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

/** Kraken public market data (no key). Pairs look like XBTUSD. */
export class KrakenPublic implements MarketProvider {
  readonly id = "kraken";
  readonly assetClasses: AssetClass[] = ["crypto"];
  private base = "https://api.kraken.com/0/public";
  async getCandles(symbol: string, interval: Interval, limit: number): Promise<CandleResult> {
    const r = await getJson<{ error: string[]; result: Record<string, unknown> }>(`${this.base}/OHLC?pair=${encodeURIComponent(symbol)}&interval=${KRAKEN_INTERVAL[interval]}`);
    if (r.error?.length) throw new ProviderError(r.error.join("; "));
    const key = Object.keys(r.result).find((k) => k !== "last");
    if (!key) throw new ProviderError("Kraken returned no data for this pair.");
    const rows = r.result[key] as (string | number)[][];
    const candles: Candle[] = rows.map((x) => ({ t: n(x[0]) * 1000, o: n(x[1]), h: n(x[2]), l: n(x[3]), c: n(x[4]), v: n(x[6]) }));
    return { candles: cleanCandles(candles).slice(-limit), meta: meta("kraken", "realtime", "Kraken returns at most 720 bars.") };
  }
  async getQuote(symbol: string): Promise<Quote> {
    const r = await getJson<{ error: string[]; result: Record<string, { c: string[]; h: string[]; l: string[]; v: string[]; o: string }> }>(`${this.base}/Ticker?pair=${encodeURIComponent(symbol)}`);
    if (r.error?.length) throw new ProviderError(r.error.join("; "));
    const t = Object.values(r.result)[0];
    const price = n(t.c[0]);
    return { symbol, price, change24hPct: ((price - n(t.o)) / n(t.o)) * 100, high24h: n(t.h[1]), low24h: n(t.l[1]), volume24h: n(t.v[1]), meta: meta("kraken", "realtime") };
  }
}

const ALPACA_TF: Record<Interval, string> = { "1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour", "4h": "4Hour", "1d": "1Day" };

/** Alpaca market data for US stocks and ETFs. The free feed is "iex": real-time but only IEX venue volume. */
export class AlpacaData implements MarketProvider {
  readonly id = "alpaca";
  readonly assetClasses: AssetClass[] = ["stocks", "etf"];
  constructor(private key: string, private secret: string, private feed: "iex" | "sip" = "iex") {}
  private h() { return { "APCA-API-KEY-ID": this.key, "APCA-API-SECRET-KEY": this.secret }; }
  private note() {
    return this.feed === "iex"
      ? "IEX feed: real-time but reflects only IEX-venue trades, so volume is understated."
      : "SIP feed: consolidated. Without a paid data subscription Alpaca may serve it delayed by about 15 minutes.";
  }
  async getCandles(symbol: string, interval: Interval, limit: number): Promise<CandleResult> {
    const start = new Date(Date.now() - limit * INTERVAL_MS[interval] * (interval === "1d" ? 1.6 : 4)).toISOString();
    const r = await getJson<{ bars: { t: string; o: number; h: number; l: number; c: number; v: number }[] | null }>(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${ALPACA_TF[interval]}&limit=${Math.min(limit, 10000)}&start=${encodeURIComponent(start)}&feed=${this.feed}&adjustment=split`, this.h());
    const candles: Candle[] = (r.bars ?? []).map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    return { candles: cleanCandles(candles).slice(-limit), meta: meta("alpaca", this.feed === "iex" ? "realtime" : "unknown", this.note()) };
  }
  async getQuote(symbol: string): Promise<Quote> {
    const r = await getJson<{ trade: { p: number } }>(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=${this.feed}`, this.h());
    return { symbol, price: r.trade.p, meta: meta("alpaca", this.feed === "iex" ? "realtime" : "unknown", this.note()) };
  }
}

const OANDA_GRAN: Record<Interval, string> = { "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D" };

/** OANDA candles for forex and CFDs (commodities, indices where offered). Symbols look like EUR_USD. */
export class OandaData implements MarketProvider {
  readonly id = "oanda";
  readonly assetClasses: AssetClass[] = ["forex", "commodities", "indices"];
  private base: string;
  constructor(private token: string, env: "practice" | "live" = "practice") {
    this.base = env === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
  }
  private h() { return { authorization: `Bearer ${this.token}` }; }
  async getCandles(symbol: string, interval: Interval, limit: number): Promise<CandleResult> {
    const r = await getJson<{ candles: { time: string; volume: number; complete: boolean; mid?: { o: string; h: string; l: string; c: string } }[] }>(
      `${this.base}/v3/instruments/${encodeURIComponent(symbol)}/candles?granularity=${OANDA_GRAN[interval]}&count=${Math.min(limit, 5000)}&price=M`, this.h());
    const candles: Candle[] = r.candles.filter((c) => c.mid).map((c) => ({ t: Date.parse(c.time), o: n(c.mid!.o), h: n(c.mid!.h), l: n(c.mid!.l), c: n(c.mid!.c), v: c.volume }));
    return { candles: cleanCandles(candles), meta: meta("oanda", "realtime", "Mid prices. Volume is tick count, not traded volume.") };
  }
  async getQuote(symbol: string): Promise<Quote> {
    const { candles, meta: m } = await this.getCandles(symbol, "1m", 2);
    const last = candles[candles.length - 1];
    if (!last) throw new ProviderError("No price available.");
    return { symbol, price: last.c, meta: m };
  }
}

export interface MarketEnv {
  cryptoProvider?: string;
  equitiesProvider?: string;
  equitiesKey?: string;
  equitiesSecret?: string;
  equitiesFeed?: string;
  forexProvider?: string;
  forexKey?: string;
  oandaEnv?: string;
}

export type Resolution =
  | { ok: true; provider: MarketProvider }
  | { ok: false; reason: "not_configured" | "unsupported"; message: string };

const FOREX_LIKE: AssetClass[] = ["forex", "commodities", "indices"];

export function resolveProvider(assetClass: AssetClass, e: MarketEnv): Resolution {
  if (assetClass === "futures") return { ok: false, reason: "unsupported", message: "No futures data provider is built in. Futures need a licensed data vendor." };
  if (assetClass === "crypto") {
    if (e.cryptoProvider === "binance") return { ok: true, provider: new BinancePublic() };
    if (e.cryptoProvider === "kraken") return { ok: true, provider: new KrakenPublic() };
    return { ok: false, reason: "not_configured", message: "Set MARKET_DATA_CRYPTO_PROVIDER to binance or kraken." };
  }
  if (assetClass === "stocks" || assetClass === "etf") {
    if (e.equitiesProvider === "alpaca" && e.equitiesKey && e.equitiesSecret) return { ok: true, provider: new AlpacaData(e.equitiesKey, e.equitiesSecret, e.equitiesFeed === "sip" ? "sip" : "iex") };
    return { ok: false, reason: "not_configured", message: "Set MARKET_DATA_EQUITIES_PROVIDER=alpaca with an Alpaca key and secret." };
  }
  if (FOREX_LIKE.includes(assetClass)) {
    if (e.forexProvider === "oanda" && e.forexKey) return { ok: true, provider: new OandaData(e.forexKey, e.oandaEnv === "live" ? "live" : "practice") };
    return { ok: false, reason: "not_configured", message: "Set MARKET_DATA_FOREX_PROVIDER=oanda with an OANDA token." };
  }
  return { ok: false, reason: "unsupported", message: `Unknown asset class ${assetClass}.` };
}

export function marketEnvFromProcess(): MarketEnv {
  const p = process.env;
  return {
    cryptoProvider: p.MARKET_DATA_CRYPTO_PROVIDER?.trim().toLowerCase() || undefined,
    equitiesProvider: p.MARKET_DATA_EQUITIES_PROVIDER?.trim().toLowerCase() || undefined,
    equitiesKey: p.MARKET_DATA_EQUITIES_API_KEY || undefined,
    equitiesSecret: p.MARKET_DATA_EQUITIES_API_SECRET || undefined,
    equitiesFeed: p.MARKET_DATA_EQUITIES_FEED || undefined,
    forexProvider: p.MARKET_DATA_FOREX_PROVIDER?.trim().toLowerCase() || undefined,
    forexKey: p.MARKET_DATA_FOREX_API_KEY || undefined,
    oandaEnv: p.OANDA_ENV || undefined,
  };
}
