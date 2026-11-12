import { validateAddress, type MemeChain } from "../../../../_shared/core/memecoin/index.ts";
import { body, HttpError, rateLimit, route, v } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { buyPaper, closePaper, loadStrategy, tokenPair } from "../../../../_shared/server/memecoin.ts";
import { liveBuy, liveSell } from "../../../../_shared/server/live.ts";

/**
 * Buy or sell a coin by hand, in paper or live mode.
 * live buy: { mode:"live", side:"buy", mint, usd, slippageBps?, expectOutRaw?, autoExit? }   live sell: { mode:"live", side:"sell", mint, pct }
 * paper buy: { mode:"paper", side:"buy", mint, usd }                                         paper sell: closes the open paper position in that coin
 */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`swap:${s.userId}`, 10, 60_000); const b = await body(req);
  const mode = v.oneOf(b, "mode", ["paper", "live"] as const); const side = v.oneOf(b, "side", ["buy", "sell"] as const); const mint = v.str(b, "mint", { max: 60 });
  if (!validateAddress("solana", mint)) throw new HttpError(400, "That is not a Solana token address.");
  const st = await loadStrategy(s.userId);
  const pair = await tokenPair("solana" as MemeChain, mint).catch(() => null);
  const token = { mint, symbol: pair?.symbol ?? mint.slice(0, 4), name: pair?.name, image: pair?.imageUrl ?? null };
  const autoExit = v.bool(b, "autoExit") ?? true;
  if (mode === "paper") {
    const db = serviceDb();
    if (side === "buy") {
      if (!pair) throw new HttpError(404, "No trading pair was found for this coin, so a paper price is not available.");
      const usd = v.num(b, "usd", { min: 1, max: 1e7 })!;
      await buyPaper(s.userId, { ...st, ...(autoExit ? {} : { stopLossPct: 99.9, trailingStopPct: 99.9, takeProfitPct: 100000 }) }, pair, usd, "You bought this by hand (paper).", { manual: true, price: pair.priceUsd }, [], "user");
      return { ok: true, mode, side, simulated: true };
    }
    const { data: open } = await db.from("nova_meme_positions").select("*").eq("user_id", s.userId).eq("mode", "paper").eq("status", "open").eq("token_address", mint);
    if (!open?.length) throw new HttpError(409, "You have no open paper position in this coin.");
    if (!pair) throw new HttpError(502, "No current price is available, so nothing was closed.");
    let pnl = 0; for (const p of open) pnl += await closePaper(s.userId, p, pair.priceUsd, "manual", "You sold this by hand (paper).", st.slippageBps, "user");
    return { ok: true, mode, side, simulated: true, pnlUsd: pnl };
  }
  if (side === "buy") {
    const usd = v.num(b, "usd", { min: 0.01, max: 1e7 })!; const slip = v.num(b, "slippageBps", { min: 10, max: 5000, optional: true });
    const expect = typeof b.expectOutRaw === "string" && /^\d{1,30}$/.test(b.expectOutRaw) ? BigInt(b.expectOutRaw) : undefined;
    const r = await liveBuy(s.userId, { token, usd, slippageBps: slip, agent: "user", reason: "You bought this by hand.", evidence: { manual: true }, expectOutRaw: expect, exit: { stopLossPct: st.stopLossPct, trailingStopPct: st.trailingStopPct, takeProfitPct: st.takeProfitPct, auto: autoExit } });
    return { ok: true, mode, side, simulated: false, signature: r.signature, qty: r.qty, usd: r.costUsd, entryPrice: r.entryPrice };
  }
  const pct = v.num(b, "pct", { min: 1, max: 100 })!; const slip = v.num(b, "slippageBps", { min: 10, max: 5000, optional: true });
  const r = await liveSell(s.userId, { mint, fraction: pct / 100, slippageBps: slip, agent: "user", reason: "You sold this by hand.", exitReason: "manual" });
  return { ok: true, mode, side, simulated: false, signature: r.signature, usd: r.proceedsUsd, pnlUsd: r.pnlUsd, closed: r.closed };
});
