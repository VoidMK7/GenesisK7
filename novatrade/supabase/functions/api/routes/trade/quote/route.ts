import { validateAddress } from "../../../../_shared/core/memecoin/index.ts";
import { body, HttpError, rateLimit, route, v } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { assertLive, liveQuote } from "../../../../_shared/server/live.ts";

/** Prices a live swap without sending anything. Buy: give usd. Sell: give pct (1 to 100 of what you hold). */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`quote:${s.userId}`, 30, 60_000); const b = await body(req); await assertLive(s.userId);
  const side = v.oneOf(b, "side", ["buy", "sell"] as const); const mint = v.str(b, "mint", { max: 60 });
  if (!validateAddress("solana", mint)) throw new HttpError(400, "That is not a Solana token address.");
  const slip = v.num(b, "slippageBps", { min: 10, max: 5000, optional: true });
  return liveQuote(s.userId, side === "buy" ? { side, mint, usd: v.num(b, "usd", { min: 0.01, max: 1e7 })!, slippageBps: slip } : { side, mint, fraction: v.num(b, "pct", { min: 1, max: 100 })! / 100, slippageBps: slip });
});
