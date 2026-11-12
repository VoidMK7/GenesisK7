import { body, HttpError, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";
import { loadStrategy } from "../../../../../_shared/server/memecoin.ts";
import { liveBuy, liveLimits } from "../../../../../_shared/server/live.ts";

/** Approve or reject a buy the agent proposed in "live with approval" mode. Approving sends a real swap from your trading wallet. */
export const POST = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id); const b = await body(req);
  const action = v.oneOf(b, "action", ["reject", "approve"] as const);
  const db = serviceDb();
  const { data: t } = await db.from("nova_trade_log").select("*").eq("id", id).eq("user_id", s.userId).maybeSingle();
  if (!t) throw new HttpError(404, "Trade not found.");
  if (t.status !== "awaiting_approval") throw new HttpError(409, "This trade is not waiting for approval.");
  if (action === "reject") { await db.from("nova_trade_log").update({ status: "rejected" }).eq("id", id).eq("user_id", s.userId); return { ok: true }; }
  if (Date.now() - new Date(t.created_at as string).getTime() > 15 * 60_000) { await db.from("nova_trade_log").update({ status: "rejected" }).eq("id", id).eq("user_id", s.userId); throw new HttpError(409, "This proposal is older than 15 minutes and the price has likely moved. It was cancelled."); }
  const st = await loadStrategy(s.userId); const usd = Math.max(liveLimits().minUsd, Number(t.usd ?? st.positionUsd));
  const r = await liveBuy(s.userId, { token: { mint: t.token_address as string, symbol: t.symbol as string, image: (t.image_url as string | null) ?? null }, usd, slippageBps: st.slippageBps, agent: "executor", reason: t.reason as string, evidence: (t.evidence as Record<string, unknown>) ?? {},
    exit: { stopLossPct: st.stopLossPct, trailingStopPct: st.trailingStopPct, takeProfitPct: st.takeProfitPct, auto: true }, proposalId: id });
  return { ok: true, signature: r.signature, qty: r.qty, usd: r.costUsd };
});
