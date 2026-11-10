import { parseStrategyPrompt, MEME_CHAINS, type MemeChain } from "../../../../_shared/core/memecoin/index.ts";
import { body, route, v } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { loadStrategy } from "../../../../_shared/server/memecoin.ts";

export const GET = route(async () => { const s = await requireUser(); return { strategy: await loadStrategy(s.userId) }; });

/** Saves the plain-English strategy. Numbers stated in the prompt are extracted and shown back; explicit fields in the body win. Mode can be analysis or paper only: live needs the approval flow. */
export const PUT = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  const prompt = v.str(b, "prompt", { optional: true, max: 2000 });
  const { patch, understood } = parseStrategyPrompt(prompt);
  const cur = await loadStrategy(s.userId);
  const f = (k: string, o: { min?: number; max?: number }) => v.num(b, k, { ...o, optional: true });
  const merged = { ...cur, ...patch,
    ...(f("min_liquidity_usd", { min: 0 }) !== undefined && { minLiquidityUsd: f("min_liquidity_usd", { min: 0 }) }), ...(f("min_volume_24h_usd", { min: 0 }) !== undefined && { minVolume24hUsd: f("min_volume_24h_usd", { min: 0 }) }),
    ...(f("position_usd", { min: 1, max: 1e7 }) !== undefined && { positionUsd: f("position_usd", { min: 1, max: 1e7 }) }), ...(f("max_open_positions", { min: 1, max: 50 }) !== undefined && { maxOpenPositions: Math.floor(f("max_open_positions", { min: 1, max: 50 })!) }),
    ...(f("take_profit_pct", { min: 1, max: 100000 }) !== undefined && { takeProfitPct: f("take_profit_pct", { min: 1, max: 100000 }) }), ...(f("stop_loss_pct", { min: 1, max: 99 }) !== undefined && { stopLossPct: f("stop_loss_pct", { min: 1, max: 99 }) }),
    ...(f("trailing_stop_pct", { min: 1, max: 99 }) !== undefined && { trailingStopPct: f("trailing_stop_pct", { min: 1, max: 99 }) }), ...(f("min_rug_score", { min: 0, max: 100 }) !== undefined && { minRugScore: Math.floor(f("min_rug_score", { min: 0, max: 100 })!) }),
    ...(f("slippage_bps", { min: 0, max: 5000 }) !== undefined && { slippageBps: Math.floor(f("slippage_bps", { min: 0, max: 5000 })!) }) };
  const chains = Array.isArray(b.chains) ? (b.chains as unknown[]).filter((c): c is MemeChain => (MEME_CHAINS as string[]).includes(String(c))) : merged.chains;
  const mode = v.oneOf(b, "mode", ["analysis", "paper"] as const, (cur.mode === "live_approval" ? "paper" : cur.mode) as "analysis" | "paper");
  const enabled = v.bool(b, "enabled") ?? cur.enabled;
  await serviceDb().from("nova_meme_strategy").upsert({ user_id: s.userId, prompt: prompt || cur.prompt, enabled, mode, chains: chains.length ? chains : ["solana"], min_liquidity_usd: merged.minLiquidityUsd, min_volume_24h_usd: merged.minVolume24hUsd,
    min_age_minutes: merged.minAgeMinutes, max_age_hours: merged.maxAgeHours, min_buy_sell_ratio: merged.minBuySellRatio, min_rug_score: merged.minRugScore, position_usd: merged.positionUsd, max_open_positions: merged.maxOpenPositions,
    take_profit_pct: merged.takeProfitPct, stop_loss_pct: merged.stopLossPct, trailing_stop_pct: merged.trailingStopPct, slippage_bps: merged.slippageBps });
  return { ok: true, understood, strategy: await loadStrategy(s.userId), note: understood.length ? "These phrases were turned into settings." : prompt ? "No numbers were recognised in the text, so the text is saved as guidance only; the numeric settings are what the agents enforce." : undefined };
});
