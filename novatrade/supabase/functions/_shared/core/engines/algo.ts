import type { Candle, Signal } from "../types.ts";
import { atr, last } from "../indicators.ts";
import { backtest, DEFAULT_GATE, desiredSeries, passesGate, type StrategyId, type StrategyParams } from "../backtest.ts";
import { buildProposal, insufficientData } from "./shared.ts";

const CANDIDATES: { id: StrategyId; params: StrategyParams; label: string }[] = [
  { id: "sma_cross", params: { fast: 20, slow: 50 }, label: "SMA 20/50 crossover" },
  { id: "sma_cross", params: { fast: 10, slow: 30 }, label: "SMA 10/30 crossover" },
  { id: "rsi_meanrev", params: { period: 14, buyBelow: 30, sellAbove: 55 }, label: "RSI(14) mean reversion 30/55" },
  { id: "rsi_meanrev", params: { period: 14, buyBelow: 25, sellAbove: 50 }, label: "RSI(14) mean reversion 25/50" },
];

/**
 * Algorithmic engine. A strategy must pass the gate on the training segment AND hold up on a held-out
 * validation segment before it is allowed to express a view.
 */
export function runAlgoEngine(symbol: string, market: string, interval: string, candles: Candle[]): Signal {
  const base = { engine: "algo" as const, symbol };
  const short = insufficientData(candles);
  if (short) {
    return { ...base, direction: "neutral", confidence: null, uncertainty: null, confidenceBasis: "No data.", rationale: [], missing: [short], invalidation: [] };
  }

  const split = Math.floor(candles.length * 0.6);
  const train = candles.slice(0, split);
  const valid = candles.slice(Math.max(0, split - 60)); // warm-up included, so indicators exist at the start

  const evaluated = CANDIDATES.map((c) => {
    const tr = backtest(train, { strategy: c.id, params: c.params });
    const va = backtest(valid, { strategy: c.id, params: c.params });
    const trainGate = passesGate(tr);
    const validOk = va.tradeCount >= 3 && (va.profitFactor ?? 0) >= 1 && va.maxDrawdownPct <= DEFAULT_GATE.maxDrawdownPct;
    return { c, tr, va, pass: trainGate.pass && validOk, why: trainGate.reasons };
  });

  const passing = evaluated.filter((e) => e.pass).sort((a, b) => b.va.totalReturnPct - a.va.totalReturnPct);
  if (!passing.length) {
    return {
      ...base,
      direction: "neutral",
      confidence: null,
      uncertainty: null,
      confidenceBasis: "No strategy passed the walk-forward gate, so the engine expresses no view.",
      rationale: evaluated.map((e) => `${e.c.label}: ${e.pass ? "passed" : e.why.join("; ") || "failed validation segment"}`),
      missing: ["No backtested strategy qualified on both training and validation data."],
      invalidation: [],
    };
  }

  const best = passing[0];
  const full = backtest(candles, { strategy: best.c.id, params: best.c.params });
  const want = last(desiredSeries(candles, best.c.id, best.c.params)) === 1;
  const trades = Math.max(1, full.tradeCount);
  const pf = full.profitFactor === null || !Number.isFinite(full.profitFactor) ? 1 : full.profitFactor;
  const score = Math.min(1, trades / 40) * Math.min(1, Math.max(0, (pf - 1) / 1.5));
  const uncertainty = Math.min(1, 1 / Math.sqrt(trades));

  const rationale = [
    `${best.c.label} passed training (${best.tr.tradeCount} trades, PF ${best.tr.profitFactor?.toFixed(2)}) and validation (${best.va.tradeCount} trades, PF ${best.va.profitFactor?.toFixed(2)}).`,
    `Full history: return ${full.totalReturnPct.toFixed(1)}% vs buy-and-hold ${full.buyHoldReturnPct.toFixed(1)}%, max drawdown ${full.maxDrawdownPct.toFixed(1)}%.`,
    full.assumptions,
  ];

  const closes = candles.map((c) => c.c);
  const a = last(atr(candles, 14));
  const px = last(closes);
  const strategy =
    want && Number.isFinite(a)
      ? buildProposal({
          name: best.c.label,
          source: "Algorithmic engine (backtested rule)",
          methodology: "Rule-based entry from a backtested strategy; protective stop at 2 ATR, first target at 3 ATR.",
          symbol,
          market,
          direction: "long",
          entry: px,
          stop: px - 2 * a,
          takeProfits: [px + 3 * a],
          interval,
          horizonBars: 40,
          closes,
          evidence: rationale,
          conditions: ["Strategy signal is currently long"],
          invalidation: ["Strategy signal turns flat", "Price closes below the protective stop", "Volatility regime changes sharply"],
        })
      : undefined;

  return {
    ...base,
    direction: want ? "long" : "neutral",
    confidence: score,
    uncertainty,
    confidenceBasis: "Evidence score: sample size (trades/40, capped) times edge ((profit factor - 1)/1.5, capped). Uncertainty is 1/sqrt(trades). A heuristic, not a probability.",
    rationale,
    missing: [],
    invalidation: ["Strategy signal turns flat", "Out-of-sample performance deteriorates"],
    strategy,
  };
}
