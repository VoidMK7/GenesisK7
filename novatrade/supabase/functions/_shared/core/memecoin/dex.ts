import type { MemeChain, MemePair } from "./types.ts";

const CHAIN_IDS: Record<string, MemeChain> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc" };
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : undefined);

/** Normalises one DexScreener pair object. Returns null if it lacks what a decision needs (never invents values). */
export function normalizeDexPair(raw: unknown, nowMs = Date.now()): MemePair | null {
  const p = raw as Record<string, any> | null;
  if (!p || typeof p !== "object") return null;
  const chain = CHAIN_IDS[String(p.chainId)];
  const token = p.baseToken?.address;
  const price = num(p.priceUsd);
  if (!chain || typeof token !== "string" || !token || !price || price <= 0) return null;
  const created = num(p.pairCreatedAt);
  const socials: MemePair["socials"] = {};
  for (const s of p.info?.socials ?? []) { if (s?.type === "twitter" && typeof s.url === "string") socials.twitter = s.url; if (s?.type === "telegram" && typeof s.url === "string") socials.telegram = s.url; }
  const site = p.info?.websites?.[0]?.url; if (typeof site === "string") socials.website = site;
  const img = p.info?.imageUrl;
  return {
    chain, tokenAddress: token, pairAddress: String(p.pairAddress ?? ""), symbol: String(p.baseToken?.symbol ?? "?").slice(0, 24), name: String(p.baseToken?.name ?? "").slice(0, 60),
    imageUrl: typeof img === "string" && /^https:\/\//.test(img) ? img : undefined, dex: String(p.dexId ?? ""), url: typeof p.url === "string" ? p.url : undefined,
    priceUsd: price, liquidityUsd: num(p.liquidity?.usd) ?? 0, volume24hUsd: num(p.volume?.h24) ?? 0, fdvUsd: num(p.fdv),
    ageMinutes: created ? Math.max(0, Math.round((nowMs - created) / 60_000)) : undefined,
    buys24h: num(p.txns?.h24?.buys) ?? 0, sells24h: num(p.txns?.h24?.sells) ?? 0, buys1h: num(p.txns?.h1?.buys) ?? 0, sells1h: num(p.txns?.h1?.sells) ?? 0,
    change: { m5: num(p.priceChange?.m5), h1: num(p.priceChange?.h1), h6: num(p.priceChange?.h6), h24: num(p.priceChange?.h24) }, socials,
  };
}

/** One token can have many pairs. Keep the deepest-liquidity pair per token. */
export function bestPairs(raws: unknown[], nowMs = Date.now()): MemePair[] {
  const best = new Map<string, MemePair>();
  for (const r of raws) {
    const p = normalizeDexPair(r, nowMs); if (!p) continue;
    const k = p.chain + ":" + p.tokenAddress;
    const cur = best.get(k);
    if (!cur || p.liquidityUsd > cur.liquidityUsd) best.set(k, p);
  }
  return [...best.values()];
}
