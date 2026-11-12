import { HttpError, route, uuid } from "../../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../../_shared/server/auth.ts";
import { liveSell } from "../../../../../../_shared/server/live.ts";
import { closePaper, loadStrategy, tokenPair } from "../../../../../../_shared/server/memecoin.ts";
import type { MemeChain } from "../../../../../../_shared/core/memecoin/index.ts";

export const POST = route(async (_req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id);
  const { data: pos } = await serviceDb().from("nova_meme_positions").select("*").eq("id", id).eq("user_id", s.userId).eq("status", "open").maybeSingle();
  if (!pos) throw new HttpError(404, "Open position not found.");
  if (pos.mode === "live") {
    const r = await liveSell(s.userId, { mint: pos.token_address as string, fraction: 1, slippageBps: 500, agent: "user", reason: "You closed this position.", exitReason: "manual" });
    return { ok: true, pnlUsd: r.pnlUsd, simulated: false, signature: r.signature };
  }
  const p = await tokenPair(pos.chain as MemeChain, pos.token_address as string);
  if (!p) throw new HttpError(502, "No current price is available, so the position was not closed.");
  const st = await loadStrategy(s.userId);
  const pnl = await closePaper(s.userId, pos, p.priceUsd, "manual", "You closed this position.", st.slippageBps, "user");
  return { ok: true, pnlUsd: pnl, simulated: true };
});
