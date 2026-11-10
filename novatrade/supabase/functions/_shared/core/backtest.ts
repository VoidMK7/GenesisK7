import type { Candle } from "./types.ts";
import { ema, mean, rsi, sma, stdev } from "./indicators.ts";

export type StrategyId = "sma_cross" | "rsi_meanrev";

export interface StrategyParams {
  fast?: number;
  slow?: number;
  period?: number;
  buyBelow?: number;
  sellAbove?: number;
}

export interface BacktestOptions {
  strategy: StrategyId;
  params?: StrategyParams;
  feeBps?: number; // per side
  slippageBps?: number; // per side
  initialCash?: number;
}

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
}

export interface BacktestResult {
  strategy: StrategyId;
  params: StrategyParams;
  bars: number;
  trades: BacktestTrade[];
  tradeCount: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number | null;
  profitFactor: number | null;
  barSharpe: number | null; // per-bar, not annualised
  exposurePct: number;
  equity: number[];
  assumptions: string;
}

/** Desired position (0 flat, 1 long) at the CLOSE of each bar. Executed at the next bar's open. */
export function desiredSeries(candles: Candle[], strategy: StrategyId, p: StrategyParams = {}): number[] {
  const closes = candles.map((c) => c.c);
  const out = new Array<number>(candles.length).fill(0);
  if (strategy === "sma_cross") {
    const fast = sma(closes, p.fast ?? 20);
    const slow = sma(closes, p.slow ?? 50);
    for (let i = 0; i < closes.length; i++) {
      out[i] = Number.isFinite(fast[i]) && Number.isFinite(slow[i]) && fast[i] > slow[i] ? 1 : 0;
    }
    return out;
  }
  const r = rsi(closes, p.period ?? 14);
  const buyBelow = p.buyBelow ?? 30;
  const sellAbove = p.sellAbove ?? 55;
  let pos = 0;
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(r[i])) {
      if (pos === 0 && r[i] < buyBelow) pos = 1;
      else if (pos === 1 && r[i] > sellAbove) pos = 0;
    }
    out[i] = pos;
  }
  return out;
}

export function backtest(candles: Candle[], opts: BacktestOptions): BacktestResult {
  const feeBps = opts.feeBps ?? 10;
  const slipBps = opts.slippageBps ?? 5;
  const initial = opts.initialCash ?? 10_000;
  const params = opts.params ?? {};
  const desired = desiredSeries(candles, opts.strategy, params);

  let cash = initial;
  let units = 0;
  let entryIdx = -1;
  let entryPx = 0;
  let entryCost = 0;
  const trades: BacktestTrade[] = [];
  const equity: number[] = [];
  let barsInMarket = 0;

  for (let i = 0; i < candles.length; i++) {
    // Execute the decision made at the previous close, at this bar's open (no look-ahead).
    if (i > 0) {
      const want = desired[i - 1];
      if (want === 1 && units === 0) {
        const px = candles[i].o * (1 + slipBps / 1e4);
        const spend = cash / (1 + feeBps / 1e4);
        units = spend / px;
        entryCost = cash;
        cash = 0;
        entryIdx = i;
        entryPx = px;
      } else if (want === 0 && units > 0) {
        const px = candles[i].o * (1 - slipBps / 1e4);
        const proceeds = units * px * (1 - feeBps / 1e4);
        trades.push({
          entryIndex: entryIdx,
          exitIndex: i,
          entryPrice: entryPx,
          exitPrice: px,
          pnl: proceeds - entryCost,
          returnPct: ((proceeds - entryCost) / entryCost) * 100,
        });
        cash = proceeds;
        units = 0;
      }
    }
    if (units > 0) barsInMarket++;
    equity.push(cash + units * candles[i].c);
  }

  // Close any open position at the final close so the trade counts in the statistics.
  if (units > 0) {
    const px = candles[candles.length - 1].c * (1 - slipBps / 1e4);
    const proceeds = units * px * (1 - feeBps / 1e4);
    trades.push({
      entryIndex: entryIdx,
      exitIndex: candles.length - 1,
      entryPrice: entryPx,
      exitPrice: px,
      pnl: proceeds - entryCost,
      returnPct: ((proceeds - entryCost) / entryCost) * 100,
    });
    equity[equity.length - 1] = proceeds;
  }

  let peak = equity[0] ?? initial;
  let maxDd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDd = Math.max(maxDd, ((peak - e) / peak) * 100);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  const barRets = equity.slice(1).map((e, i) => e / equity[i] - 1);
  const sd = stdev(barRets);

  const finalEq = equity[equity.length - 1] ?? initial;
  const first = candles[0]?.c ?? 1;
  const lastC = candles[candles.length - 1]?.c ?? 1;

  return {
    strategy: opts.strategy,
    params,
    bars: candles.length,
    trades,
    tradeCount: trades.length,
    totalReturnPct: ((finalEq - initial) / initial) * 100,
    buyHoldReturnPct: ((lastC - first) / first) * 100,
    maxDrawdownPct: maxDd,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor: trades.length ? (grossLoss === 0 ? (grossWin > 0 ? Infinity : null) : grossWin / grossLoss) : null,
    barSharpe: Number.isFinite(sd) && sd > 0 ? mean(barRets) / sd : null,
    exposurePct: candles.length ? (barsInMarket / candles.length) * 100 : 0,
    equity,
    assumptions: `Long-only, fully invested, signals on close and fills at next open. Fees ${feeBps} bps and slippage ${slipBps} bps per side. Historical result, not a forecast.`,
  };
}

export interface Gate {
  minTrades: number;
  minProfitFactor: number;
  maxDrawdownPct: number;
}
export const DEFAULT_GATE: Gate = { minTrades: 8, minProfitFactor: 1.1, maxDrawdownPct: 30 };

export function passesGate(r: BacktestResult, g: Gate = DEFAULT_GATE): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.tradeCount < g.minTrades) reasons.push(`only ${r.tradeCount} trades (need ${g.minTrades})`);
  if (r.profitFactor === null || r.profitFactor < g.minProfitFactor)
    reasons.push(`profit factor ${r.profitFactor === null ? "n/a" : r.profitFactor.toFixed(2)} below ${g.minProfitFactor}`);
  if (r.maxDrawdownPct > g.maxDrawdownPct) reasons.push(`max drawdown ${r.maxDrawdownPct.toFixed(1)}% above ${g.maxDrawdownPct}%`);
  return { pass: reasons.length === 0, reasons };
}

export { ema };
