import type { MemeStrategy } from "./types.ts";

export const PAPER_FEE_BPS = 30;   // typical DEX swap fee; paper fills are modelled, never real

export function paperBuy(priceUsd: number, usd: number, slippageBps: number) {
  const fill = priceUsd * (1 + slippageBps / 10_000);
  const fee = usd * PAPER_FEE_BPS / 10_000;
  return { fillPrice: fill, qty: (usd - fee) / fill, feeUsd: fee };
}
export function paperSell(priceUsd: number, qty: number, slippageBps: number) {
  const fill = priceUsd * (1 - slippageBps / 10_000);
  const gross = fill * qty; const fee = gross * PAPER_FEE_BPS / 10_000;
  return { fillPrice: fill, proceedsUsd: gross - fee, feeUsd: fee };
}

export interface OpenPos { entryPrice: number; peakPrice: number; stopLossPct: number; trailingStopPct: number; takeProfitPct: number }
export interface TickResult { peak: number; exit: null | { reason: "stop_loss" | "take_profit" | "trailing_stop"; trigger: number } }

/**
 * Evaluates one open position against the latest price.
 * Order matters when several trigger in the same tick: the stop loss wins, then take profit, then the trailing stop.
 * The trailing stop only arms once price has been above entry, so it cannot fire below the hard stop's intent.
 */
export function tickPosition(pos: OpenPos, price: number): TickResult {
  const peak = Math.max(pos.peakPrice, price);
  const stop = pos.entryPrice * (1 - pos.stopLossPct / 100);
  const tp = pos.entryPrice * (1 + pos.takeProfitPct / 100);
  const trail = peak * (1 - pos.trailingStopPct / 100);
  if (price <= stop) return { peak, exit: { reason: "stop_loss", trigger: stop } };
  if (price >= tp) return { peak, exit: { reason: "take_profit", trigger: tp } };
  if (peak > pos.entryPrice && price <= trail) return { peak, exit: { reason: "trailing_stop", trigger: trail } };
  return { peak, exit: null };
}

/** The line drawn on a token page: where the trailing stop sits right now (never below the hard stop). */
export function activeStopLine(pos: OpenPos): number {
  const hard = pos.entryPrice * (1 - pos.stopLossPct / 100);
  return pos.peakPrice > pos.entryPrice ? Math.max(hard, pos.peakPrice * (1 - pos.trailingStopPct / 100)) : hard;
}

export interface WalletAllocation { enabled: boolean; mode: "percent" | "fixed"; amountUsd?: number; percent?: number; maxPerTradeUsd?: number; maxOpenPositions: number }

/** How many dollars the AI may deploy from a wallet. Never more than the balance, and zero when the balance is unknown. */
export function allocationBudget(balanceUsd: number | null, a: WalletAllocation): { budgetUsd: number; why: string } {
  if (!a.enabled) return { budgetUsd: 0, why: "Allocation is switched off for this wallet" };
  if (balanceUsd === null || !(balanceUsd > 0)) return { budgetUsd: 0, why: "Wallet balance has not been read (or is empty)" };
  const raw = a.mode === "percent" ? balanceUsd * ((a.percent ?? 0) / 100) : a.amountUsd ?? 0;
  const b = Math.max(0, Math.min(balanceUsd, raw));
  return { budgetUsd: b, why: a.mode === "percent" ? `${a.percent ?? 0}% of $${balanceUsd.toFixed(2)}` : `Fixed $${(a.amountUsd ?? 0).toFixed(2)} (capped at the balance)` };
}

export interface RiskInput { strategy: MemeStrategy; openCount: number; openCostUsd: number; budgetUsd: number; realisedLossTodayUsd: number; wantUsd: number; maxPerTradeUsd?: number }
export function riskGate(i: RiskInput): { ok: boolean; sizeUsd: number; blockers: string[] } {
  const blockers: string[] = [];
  let size = i.wantUsd;
  if (i.maxPerTradeUsd !== undefined) size = Math.min(size, i.maxPerTradeUsd);
  if (i.openCount >= i.strategy.maxOpenPositions) blockers.push(`Already ${i.openCount} open positions (limit ${i.strategy.maxOpenPositions})`);
  const room = i.budgetUsd - i.openCostUsd;
  if (room < size) { if (room >= 1) size = Math.min(size, room); else blockers.push(`No budget left ($${Math.max(0, room).toFixed(2)} of $${i.budgetUsd.toFixed(2)} free)`); }
  if (i.strategy.dailyLossLimitUsd !== undefined && i.realisedLossTodayUsd >= i.strategy.dailyLossLimitUsd) blockers.push(`Daily loss limit reached ($${i.realisedLossTodayUsd.toFixed(2)} of $${i.strategy.dailyLossLimitUsd})`);
  if (!(size >= 1)) blockers.push("Trade size would be under $1");
  return { ok: blockers.length === 0, sizeUsd: blockers.length ? 0 : size, blockers };
}
