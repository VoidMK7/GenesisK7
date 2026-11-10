import type { Side } from "./types.ts";

export interface RiskLimits {
  requireStopLoss: boolean;
  maxOrderValue?: number;
  maxPositionPct?: number; // one symbol, % of equity
  maxConcentrationPct?: number; // one correlation group, % of equity
  maxLeverage?: number;
  maxRiskPerTradePct?: number; // distance to stop * qty as % of equity
  dailyLossLimit?: number; // currency
  weeklyLossLimit?: number;
  maxDrawdownPct?: number;
  maxVolumeParticipationPct?: number; // order notional vs average daily traded value
}

export interface Position {
  symbol: string;
  value: number;
  group?: string;
}

export interface AccountState {
  equity: number;
  peakEquity: number;
  dailyPnl: number;
  weeklyPnl: number;
  positions: Position[];
  emergencyStop: boolean;
}

export interface ProposedOrder {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  stopLoss?: number;
  leverage?: number;
  reduceOnly?: boolean;
  correlationGroup?: string;
  avgDailyVolumeValue?: number;
}

export interface RiskDecision {
  allowed: boolean;
  violations: { rule: string; message: string }[];
  unverified: { rule: string; reason: string }[];
  notional: number;
}

/** Limits that must be set before live trading can be unlocked. */
export const LIVE_REQUIRED_LIMITS: (keyof RiskLimits)[] = [
  "maxOrderValue",
  "maxPositionPct",
  "dailyLossLimit",
  "maxDrawdownPct",
];

export function missingLiveLimits(l: RiskLimits): string[] {
  return LIVE_REQUIRED_LIMITS.filter((k) => l[k] === undefined || l[k] === null).map(String);
}

export function evaluateOrder(o: ProposedOrder, l: RiskLimits, a: AccountState): RiskDecision {
  const v: RiskDecision["violations"] = [];
  const u: RiskDecision["unverified"] = [];
  const notional = o.quantity * o.price;

  if (!(o.quantity > 0) || !(o.price > 0) || !Number.isFinite(notional)) {
    return { allowed: false, violations: [{ rule: "valid_order", message: "Quantity and price must be positive numbers." }], unverified: [], notional: 0 };
  }

  // Orders that only reduce exposure are never blocked by exposure rules.
  if (o.reduceOnly) return { allowed: true, violations: [], unverified: [], notional };

  if (a.emergencyStop) v.push({ rule: "emergency_stop", message: "Emergency stop is active. New positions are blocked." });

  if (l.requireStopLoss) {
    if (o.stopLoss === undefined) v.push({ rule: "stop_loss_required", message: "A stop-loss is required by your risk settings." });
  }
  if (o.stopLoss !== undefined) {
    const wrongSide = o.side === "buy" ? o.stopLoss >= o.price : o.stopLoss <= o.price;
    if (wrongSide) v.push({ rule: "stop_loss_side", message: "Stop-loss is on the wrong side of the entry price." });
  }

  if (l.maxOrderValue !== undefined && notional > l.maxOrderValue)
    v.push({ rule: "max_order_value", message: `Order value ${notional.toFixed(2)} exceeds the limit ${l.maxOrderValue}.` });

  if (a.equity <= 0) {
    v.push({ rule: "equity", message: "Account equity is zero or unknown." });
  } else {
    if (l.maxPositionPct !== undefined) {
      const existing = a.positions.filter((p) => p.symbol === o.symbol).reduce((s, p) => s + p.value, 0);
      const share = ((existing + notional) / a.equity) * 100;
      if (share > l.maxPositionPct)
        v.push({ rule: "max_position_pct", message: `${o.symbol} would be ${share.toFixed(1)}% of equity (limit ${l.maxPositionPct}%).` });
    }
    if (l.maxConcentrationPct !== undefined) {
      if (!o.correlationGroup) {
        u.push({ rule: "max_concentration_pct", reason: "No correlation group supplied for this symbol." });
      } else {
        const existing = a.positions.filter((p) => p.group === o.correlationGroup).reduce((s, p) => s + p.value, 0);
        const share = ((existing + notional) / a.equity) * 100;
        if (share > l.maxConcentrationPct)
          v.push({ rule: "max_concentration_pct", message: `Group ${o.correlationGroup} would be ${share.toFixed(1)}% of equity (limit ${l.maxConcentrationPct}%).` });
      }
    }
    if (l.maxRiskPerTradePct !== undefined) {
      if (o.stopLoss === undefined) {
        u.push({ rule: "max_risk_per_trade_pct", reason: "No stop-loss, so risk per trade cannot be measured." });
      } else {
        const risk = Math.abs(o.price - o.stopLoss) * o.quantity;
        const riskPct = (risk / a.equity) * 100;
        if (riskPct > l.maxRiskPerTradePct)
          v.push({ rule: "max_risk_per_trade_pct", message: `Risk to stop is ${riskPct.toFixed(2)}% of equity (limit ${l.maxRiskPerTradePct}%).` });
      }
    }
    if (l.maxDrawdownPct !== undefined && a.peakEquity > 0) {
      const dd = ((a.peakEquity - a.equity) / a.peakEquity) * 100;
      if (dd >= l.maxDrawdownPct) v.push({ rule: "max_drawdown_pct", message: `Drawdown ${dd.toFixed(1)}% has reached the limit ${l.maxDrawdownPct}%.` });
    }
  }

  if (l.maxLeverage !== undefined) {
    const lev = o.leverage ?? 1;
    if (lev > l.maxLeverage) v.push({ rule: "max_leverage", message: `Leverage ${lev}x exceeds the limit ${l.maxLeverage}x.` });
  }
  if (l.dailyLossLimit !== undefined && a.dailyPnl <= -l.dailyLossLimit)
    v.push({ rule: "daily_loss_limit", message: `Daily loss ${Math.abs(a.dailyPnl).toFixed(2)} has reached the limit ${l.dailyLossLimit}.` });
  if (l.weeklyLossLimit !== undefined && a.weeklyPnl <= -l.weeklyLossLimit)
    v.push({ rule: "weekly_loss_limit", message: `Weekly loss ${Math.abs(a.weeklyPnl).toFixed(2)} has reached the limit ${l.weeklyLossLimit}.` });

  if (l.maxVolumeParticipationPct !== undefined) {
    if (!o.avgDailyVolumeValue) {
      u.push({ rule: "max_volume_participation_pct", reason: "Average daily traded value is not available for this symbol." });
    } else {
      const share = (notional / o.avgDailyVolumeValue) * 100;
      if (share > l.maxVolumeParticipationPct)
        v.push({ rule: "max_volume_participation_pct", message: `Order is ${share.toFixed(2)}% of average daily volume (limit ${l.maxVolumeParticipationPct}%).` });
    }
  }

  return { allowed: v.length === 0, violations: v, unverified: u, notional };
}

/** Rolls peak / day-start / week-start equity forward. Pure so it can be tested. */
export interface EquityMemory {
  peakEquity: number;
  dayKey: string;
  dayStartEquity: number;
  weekKey: string;
  weekStartEquity: number;
}

const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);
function weekKeyOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

export function rollEquity(prev: EquityMemory | null, equity: number, now: Date): { memory: EquityMemory; dailyPnl: number; weeklyPnl: number } {
  const dk = dayKeyOf(now);
  const wk = weekKeyOf(now);
  const m: EquityMemory = prev
    ? { ...prev }
    : { peakEquity: equity, dayKey: dk, dayStartEquity: equity, weekKey: wk, weekStartEquity: equity };
  if (m.dayKey !== dk) { m.dayKey = dk; m.dayStartEquity = equity; }
  if (m.weekKey !== wk) { m.weekKey = wk; m.weekStartEquity = equity; }
  m.peakEquity = Math.max(m.peakEquity, equity);
  return { memory: m, dailyPnl: equity - m.dayStartEquity, weeklyPnl: equity - m.weekStartEquity };
}
