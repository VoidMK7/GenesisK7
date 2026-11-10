import { body, HttpError, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb, securityEvent } from "../../../_shared/server/auth.ts";
import { loadRiskLimits, loadSettings } from "../../../_shared/server/account.ts";
import { LIVE_REQUIRED_LIMITS, missingLiveLimits } from "../../../_shared/core/risk.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const [settings, limits] = await Promise.all([loadSettings(s.userId), loadRiskLimits(s.userId)]);
  return { settings, limits, liveRequiredLimits: LIVE_REQUIRED_LIMITS, missingForLive: missingLiveLimits(limits), email: s.email };
});

const LIMIT_COLS: Record<string, { col: string; max?: number }> = {
  maxOrderValue: { col: "max_order_value" }, maxPositionPct: { col: "max_position_pct", max: 100 }, maxConcentrationPct: { col: "max_concentration_pct", max: 100 },
  maxLeverage: { col: "max_leverage" }, maxRiskPerTradePct: { col: "max_risk_per_trade_pct", max: 100 }, dailyLossLimit: { col: "daily_loss_limit" },
  weeklyLossLimit: { col: "weekly_loss_limit" }, maxDrawdownPct: { col: "max_drawdown_pct", max: 100 }, maxVolumeParticipationPct: { col: "max_volume_participation_pct", max: 100 },
};

export const PUT = route(async (req: Request) => {
  const s = await requireUser();
  const b = await body(req);
  const db = serviceDb();
  const cur = await loadSettings(s.userId);

  const patch: Record<string, unknown> = { user_id: s.userId, updated_at: new Date().toISOString() };
  const mode = v.str(b, "executionMode", { optional: true });
  if (mode) {
    if (!["analysis", "paper", "live"].includes(mode)) throw new HttpError(400, "executionMode must be analysis, paper or live.");
    if (mode === "live" && !(cur.liveEnabled && cur.liveUnlockedAt)) throw new HttpError(409, "Live trading is locked. Complete the live unlock steps in Settings first.");
    patch.execution_mode = mode;
  }
  const stop = v.bool(b, "emergencyStop");
  if (stop !== undefined) { patch.emergency_stop = stop; await securityEvent(s.userId, stop ? "emergency_stop_on" : "emergency_stop_off"); }
  if (Object.keys(patch).length > 2) {
    const { error } = await db.from("nova_user_settings").upsert(patch);
    if (error) throw new HttpError(500, "Could not save settings.");
  }

  const r = b.limits;
  if (r && typeof r === "object") {
    const lim = r as Record<string, unknown>;
    const row: Record<string, unknown> = { user_id: s.userId, updated_at: new Date().toISOString() };
    const rsl = v.bool(lim, "requireStopLoss");
    if (rsl !== undefined) row.require_stop_loss = rsl;
    for (const [k, def] of Object.entries(LIMIT_COLS)) {
      if (!(k in lim)) continue;
      if (lim[k] === null || lim[k] === "") { row[def.col] = null; continue; }
      const n = v.num(lim, k, { min: 0.0000001, max: def.max });
      row[def.col] = n;
    }
    const { error } = await db.from("nova_risk_limits").upsert(row);
    if (error) throw new HttpError(400, "Those limits were rejected (values must be positive; percentages at most 100).");
    // Loosening or removing a required limit silently relocks live trading.
    const limits = await loadRiskLimits(s.userId);
    if (missingLiveLimits(limits).length && cur.liveUnlockedAt) {
      await db.from("nova_user_settings").update({ live_unlocked_at: null, execution_mode: cur.executionMode === "live" ? "analysis" : cur.executionMode }).eq("user_id", s.userId);
      await securityEvent(s.userId, "live_relocked_missing_limits");
    }
  }
  const [settings, limits] = await Promise.all([loadSettings(s.userId), loadRiskLimits(s.userId)]);
  return { settings, limits, missingForLive: missingLiveLimits(limits) };
});
