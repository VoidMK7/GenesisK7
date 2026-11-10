import { MEME_CHAINS, rugScore, type MemeChain } from "../../../../_shared/core/memecoin/index.ts";
import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { scanCandidates } from "../../../../_shared/server/memecoin.ts";
import { q } from "../../../../_shared/server/util.ts";

/** Live fresh tokens with their real market data and the transparent safety score. Needs no strategy. */
export const GET = route(async (req: Request) => {
  await requireUser();
  const chains = (q(req, "chains") ?? "solana").split(",").filter((c): c is MemeChain => (MEME_CHAINS as string[]).includes(c));
  const { pairs, errors } = await scanCandidates(chains.length ? chains : ["solana"], 40);
  return { tokens: pairs.map((p) => ({ ...p, safety: rugScore(p) })).sort((a, b) => (b.volume24hUsd - a.volume24hUsd)), errors, source: "DexScreener public API" };
});
