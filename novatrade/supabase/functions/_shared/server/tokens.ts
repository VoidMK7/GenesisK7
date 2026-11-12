import { rugScore, type MemePair } from "../core/memecoin/index.ts";
import { serviceDb } from "./auth.ts";
import { pairsForTokens, scanCandidates } from "./memecoin.ts";

/** Market lists, token facts and price history for the Solana coin pages. Every figure comes from a public provider; nothing is estimated here. */

const env = (k: string) => process.env[k] ?? "";
const JUP = "https://api.jup.ag";
const DEX = "https://api.dexscreener.com";
const GECKO = "https://api.geckoterminal.com/api/v2";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const mem = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = mem.get(key); if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn(); mem.set(key, { at: Date.now(), v }); if (mem.size > 300) mem.delete(mem.keys().next().value as string); return v;
}
async function getJson<T>(url: string, headers: Record<string, string> = {}, ms = 9000): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} answered ${r.status}`), { status: r.status });
  return (await r.json()) as T;
}
const jupHeaders = (): Record<string, string> => (env("JUPITER_API_KEY") ? { "x-api-key": env("JUPITER_API_KEY") } : {});

export interface TokenCard { mint: string; symbol: string; name: string; image: string | null; priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; change24hPct: number | null; holders: number | null; verified: boolean; organic: number | null; ageMinutes: number | null; safety: number | null; dex?: string }

interface JupToken { id: string; name?: string; symbol?: string; icon?: string | null; usdPrice?: number | null; mcap?: number | null; fdv?: number | null; liquidity?: number | null; holderCount?: number | null; isVerified?: boolean | null; organicScore?: number | null;
  firstPool?: { createdAt?: string } | null; audit?: { isSus?: boolean | null; mintAuthorityDisabled?: boolean | null; freezeAuthorityDisabled?: boolean | null; topHoldersPercentage?: number | null; devBalancePercentage?: number | null; devMints?: number | null } | null;
  stats24h?: { numBuys?: number | null; numSells?: number | null; numTraders?: number | null; buyVolume?: number | null; sellVolume?: number | null } | null; twitter?: string | null; website?: string | null; telegram?: string | null }

const httpsOnly = (u?: string | null) => (u && /^https:\/\//i.test(u) ? u : null);
const ageMin = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null; };

/** Prefers DexScreener's live pool numbers (price, volume, 24h change, safety) and fills the rest from Jupiter's index. */
function card(j: JupToken | null, p: MemePair | undefined, mint: string): TokenCard {
  return { mint, symbol: p?.symbol ?? j?.symbol ?? mint.slice(0, 4), name: p?.name ?? j?.name ?? "", image: httpsOnly(p?.imageUrl ?? j?.icon), priceUsd: p?.priceUsd ?? j?.usdPrice ?? null,
    mcapUsd: p?.fdvUsd ?? j?.mcap ?? j?.fdv ?? null, liquidityUsd: p?.liquidityUsd ?? j?.liquidity ?? null, volume24hUsd: p?.volume24hUsd ?? null, change24hPct: p?.change?.h24 ?? null,
    holders: j?.holderCount ?? null, verified: Boolean(j?.isVerified), organic: j?.organicScore ?? null, ageMinutes: p?.ageMinutes ?? ageMin(j?.firstPool?.createdAt), safety: p ? rugScore(p).score : null, dex: p?.dex };
}
async function enrich(list: JupToken[]): Promise<TokenCard[]> {
  const mints = list.map((t) => t.id).filter((m) => BASE58.test(m));
  let by = new Map<string, MemePair>();
  try { by = new Map((await pairsForTokens("solana", mints.slice(0, 60))).map((p) => [p.tokenAddress, p])); } catch { /* cards fall back to Jupiter's numbers */ }
  return list.filter((t) => BASE58.test(t.id)).map((t) => card(t, by.get(t.id), t.id));
}
const fromPair = (p: MemePair): TokenCard => card(null, p, p.tokenAddress);

/** Search by name, symbol or contract address across every Solana token Jupiter indexes. Falls back to DexScreener search. */
export async function searchTokens(query: string): Promise<{ tokens: TokenCard[]; source: string }> {
  const qy = query.trim().slice(0, 80); if (qy.length < 2) return { tokens: [], source: "none" };
  return cached(`s:${qy.toLowerCase()}`, 20_000, async () => {
    try { return { tokens: await enrich(await getJson<JupToken[]>(`${JUP}/tokens/v2/search?query=${encodeURIComponent(qy)}`, jupHeaders())), source: "Jupiter token index" }; }
    catch { /* rate limit or outage: use the second provider */ }
    const r = await getJson<{ pairs?: unknown[] }>(`${DEX}/latest/dex/search?q=${encodeURIComponent(qy)}`);
    const { bestPairs } = await import("../core/memecoin/index.ts");
    return { tokens: bestPairs((r.pairs ?? []).filter((x: any) => x?.chainId === "solana")).slice(0, 25).map(fromPair), source: "DexScreener search" };
  });
}

/** Tokens whose first pool was created most recently, then boosted/profiled tokens. These are brand new listings. */
export async function newTokens(): Promise<{ tokens: TokenCard[]; source: string; errors: string[] }> {
  return cached("new", 30_000, async () => {
    const errors: string[] = [];
    try { return { tokens: await enrich(await getJson<JupToken[]>(`${JUP}/tokens/v2/recent`, jupHeaders())), source: "Jupiter: recently created pools", errors }; }
    catch (e) { errors.push(e instanceof Error ? e.message : "Jupiter failed"); }
    const s = await scanCandidates(["solana"], 40);
    return { tokens: s.pairs.map(fromPair), source: "DexScreener: newest profiles and boosts", errors: [...errors, ...s.errors] };
  });
}
export async function trendingTokens(): Promise<{ tokens: TokenCard[]; errors: string[] }> {
  return cached("trend", 30_000, async () => { const s = await scanCandidates(["solana"], 40); return { tokens: s.pairs.map(fromPair).sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)), errors: s.errors }; });
}

export interface TokenFacts { holders: number | null; top10Pct: number | null; devPct: number | null; mintAuthorityDisabled: boolean | null; freezeAuthorityDisabled: boolean | null; isSus: boolean; organic: number | null; verified: boolean;
  numBuys: number | null; numSells: number | null; numTraders: number | null; buyVolumeUsd: number | null; sellVolumeUsd: number | null; website: string | null; twitter: string | null; telegram: string | null; source: string }

/** Holder count, top-holder share, authorities and 24h buy/sell counts from Jupiter's index. Null when the index has nothing for this mint. */
export async function tokenFacts(mint: string): Promise<TokenFacts | null> {
  return cached(`f:${mint}`, 45_000, async () => {
    try {
      const j = (await getJson<JupToken[]>(`${JUP}/tokens/v2/search?query=${encodeURIComponent(mint)}`, jupHeaders())).find((t) => t.id === mint); if (!j) return null;
      return { holders: j.holderCount ?? null, top10Pct: j.audit?.topHoldersPercentage ?? null, devPct: j.audit?.devBalancePercentage ?? null, mintAuthorityDisabled: j.audit?.mintAuthorityDisabled ?? null, freezeAuthorityDisabled: j.audit?.freezeAuthorityDisabled ?? null,
        isSus: Boolean(j.audit?.isSus), organic: j.organicScore ?? null, verified: Boolean(j.isVerified), numBuys: j.stats24h?.numBuys ?? null, numSells: j.stats24h?.numSells ?? null, numTraders: j.stats24h?.numTraders ?? null,
        buyVolumeUsd: j.stats24h?.buyVolume ?? null, sellVolumeUsd: j.stats24h?.sellVolume ?? null, website: httpsOnly(j.website), twitter: httpsOnly(j.twitter), telegram: httpsOnly(j.telegram), source: "Jupiter token index" };
    } catch { return null; }
  });
}

// ---------------------------------------------------------------- price history (GeckoTerminal OHLCV, cached in the database)
export const TIMEFRAMES = { "1H": { tf: "minute", agg: 1, limit: 60, ttl: 30 }, "4H": { tf: "minute", agg: 5, limit: 48, ttl: 45 }, "1D": { tf: "minute", agg: 15, limit: 96, ttl: 90 },
  "7D": { tf: "hour", agg: 1, limit: 168, ttl: 300 }, "1M": { tf: "hour", agg: 4, limit: 180, ttl: 600 }, "ALL": { tf: "day", agg: 1, limit: 365, ttl: 1800 } } as const;
export type Timeframe = keyof typeof TIMEFRAMES;
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export async function candlesFor(pool: string, tf: Timeframe): Promise<{ candles: Candle[]; stale: boolean }> {
  const cfg = TIMEFRAMES[tf]; const key = `${pool}:${tf}`; const db = serviceDb();
  const { data: hit } = await db.from("nova_chart_cache").select("data,fetched_at").eq("key", key).maybeSingle();
  const fresh = hit && Date.now() - new Date(hit.fetched_at as string).getTime() < cfg.ttl * 1000;
  if (fresh) return { candles: hit!.data as Candle[], stale: false };
  try {
    const r = await getJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(`${GECKO}/networks/solana/pools/${encodeURIComponent(pool)}/ohlcv/${cfg.tf}?aggregate=${cfg.agg}&limit=${cfg.limit}&currency=usd`, { accept: "application/json;version=20230302" });
    const list = (r.data?.attributes?.ohlcv_list ?? []).filter((x) => x.length >= 6 && x.every(Number.isFinite)).map((x) => ({ t: x[0] * 1000, o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })).sort((a, b) => a.t - b.t);
    if (list.length) await db.from("nova_chart_cache").upsert({ key, data: list, fetched_at: new Date().toISOString() });
    return { candles: list, stale: false };
  } catch {
    if (hit) return { candles: hit.data as Candle[], stale: true };                    // better an older chart than none, and it is labelled as such
    throw new Error("The chart provider did not answer (it limits free requests). Try again in a minute.");
  }
}
