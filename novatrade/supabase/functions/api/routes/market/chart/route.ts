import { validateAddress } from "../../../../_shared/core/memecoin/index.ts";
import { HttpError, route } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { tokenPair } from "../../../../_shared/server/memecoin.ts";
import { candlesFor, TIMEFRAMES, type Timeframe } from "../../../../_shared/server/tokens.ts";
import { q } from "../../../../_shared/server/util.ts";

/** Price candles for one coin plus YOUR buys and sells on it, so they can be drawn as markers. ?mint=&tf=1H|4H|1D|7D|1M|ALL */
export const GET = route(async (req: Request) => {
  const s = await requireUser(); const mint = q(req, "mint") ?? ""; const tf = (q(req, "tf") ?? "1D").toUpperCase() as Timeframe;
  if (!validateAddress("solana", mint)) throw new HttpError(400, "That is not a Solana token address.");
  if (!(tf in TIMEFRAMES)) throw new HttpError(400, "tf must be one of: " + Object.keys(TIMEFRAMES).join(", ") + ".");
  const pair = await tokenPair("solana", mint); if (!pair) throw new HttpError(404, "No trading pool was found for this coin.");
  let candles: Awaited<ReturnType<typeof candlesFor>>;
  try { candles = await candlesFor(pair.pairAddress, tf); } catch (e) { throw new HttpError(503, e instanceof Error ? e.message : "Chart unavailable.", { code: "chart_unavailable" }); }
  const first = candles.candles[0]?.t ?? Date.now();
  const { data: log } = await serviceDb().from("nova_trade_log").select("created_at,side,usd,price,mode,status").eq("user_id", s.userId).eq("token_address", mint).in("side", ["buy", "sell"]).in("status", ["simulated_fill", "confirmed"]).gte("created_at", new Date(first - 3600e3).toISOString()).order("created_at").limit(300);
  return { pool: pair.pairAddress, tf, candles: candles.candles, stale: candles.stale, priceUsd: pair.priceUsd, markers: (log ?? []).map((t) => ({ t: new Date(t.created_at as string).getTime(), side: t.side, usd: t.usd === null ? null : Number(t.usd), price: t.price === null ? null : Number(t.price), mode: t.mode })), source: "GeckoTerminal (price candles), DexScreener (pool)" };
});
