import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { newTokens, searchTokens, trendingTokens } from "../../../../_shared/server/tokens.ts";
import { q } from "../../../../_shared/server/util.ts";

/** ?q=text searches every Solana token; ?list=new shows the newest listings; ?list=trending shows what is trading most. */
export const GET = route(async (req: Request) => {
  await requireUser(); const text = q(req, "q"); const list = q(req, "list");
  if (text) return searchTokens(text);
  if (list === "trending") return { ...(await trendingTokens()), source: "DexScreener: boosted and profiled tokens by volume" };
  return newTokens();
});
