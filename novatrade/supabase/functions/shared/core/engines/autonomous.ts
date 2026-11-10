import type { Candle, Signal, StrategyProposal } from "../types.ts";
import { atr, bollinger, ema, last, rsi, sma } from "../indicators.ts";
import { buildProposal, insufficientData } from "./shared.ts";

/**
 * Autonomous engine: finds setups, builds alternative strategies, runs 12 scenario simulations on each,
 * ranks them and explains the choice. Execution is NOT done here; orders go through the pipeline and risk gate.
 */
export function runAutonomousEngine(
  symbol: string,
  market: string,
  interval: string,
  candles: Candle[],
  opts: { allowShort?: boolean } = {},
): Signal {
  const base = { engine: "autonomous" as const, symbol };
  const short = insufficientData(candles);
  if (short) {
    return { ...base, direction: "neutral", confidence: null, uncertainty: null, confidenceBasis: "No data.", rationale: [], missing: [short], invalidation: [] };
  }

  const closes = candles.map((c) => c.c);
  const px = last(closes);
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const r = last(rsi(closes, 14));
  const a = last(atr(candles, 14));
  const m20 = last(sma(closes, 20));
  const bb = bollinger(closes, 20, 2);
  const lowerBand = last(bb.lower);

  if (![px, e20, e50, r, a, m20, lowerBand].every(Number.isFinite)) {
    return { ...base, direction: "neutral", confidence: null, uncertainty: null, confidenceBasis: "Indicators could not be computed.", rationale: [], missing: ["Indicator warm-up incomplete."], invalidation: [] };
  }

  const found: StrategyProposal[] = [];
  const common = { symbol, market, interval, closes, horizonBars: 40, source: "Autonomous engine (rule-derived setup)" };

  if (e20 > e50 && px > e50 && r >= 45 && r <= 75) {
    found.push(buildProposal({
      ...common, name: "Trend continuation", direction: "long", entry: px, stop: px - 2 * a, takeProfits: [px + 3 * a],
      methodology: "Enter with an established uptrend (EMA20 above EMA50, price above EMA50, RSI not overheated). Stop 2 ATR, target 3 ATR.",
      conditions: ["EMA20 > EMA50", "Price > EMA50", "RSI between 45 and 75"],
      evidence: [`EMA20 ${e20.toFixed(4)} > EMA50 ${e50.toFixed(4)}`, `RSI ${r.toFixed(1)}`, `ATR ${a.toFixed(4)}`],
      invalidation: ["Close below EMA50", "RSI above 80 with falling momentum", "Stop-loss reached"], seed: 11,
    }));
  }
  if (r < 30 && px <= lowerBand * 1.01) {
    const target = Math.max(m20, px + 1.5 * a);
    found.push(buildProposal({
      ...common, name: "Oversold bounce", direction: "long", entry: px, stop: px - 1.5 * a, takeProfits: [target],
      methodology: "Buy a stretched move (RSI below 30, price at the lower Bollinger band) aiming for the 20-bar mean.",
      conditions: ["RSI < 30", "Price at or below lower Bollinger band"],
      evidence: [`RSI ${r.toFixed(1)}`, `Lower band ${lowerBand.toFixed(4)}`, `20-bar mean ${m20.toFixed(4)}`],
      invalidation: ["Close below 1.5 ATR stop", "Breakdown continues with rising volume"], seed: 23,
    }));
  }
  if (opts.allowShort && e20 < e50 && px < e50 && r >= 25 && r <= 55) {
    found.push(buildProposal({
      ...common, name: "Downtrend continuation (short)", direction: "short", entry: px, stop: px + 2 * a, takeProfits: [px - 3 * a],
      methodology: "Short an established downtrend. Requires a venue and account that allow shorting.",
      conditions: ["EMA20 < EMA50", "Price < EMA50", "RSI between 25 and 55"],
      evidence: [`EMA20 ${e20.toFixed(4)} < EMA50 ${e50.toFixed(4)}`, `RSI ${r.toFixed(1)}`],
      invalidation: ["Close above EMA50", "Stop-loss reached"], seed: 37,
    }));
  }

  if (!found.length) {
    return {
      ...base, direction: "neutral", confidence: null, uncertainty: null,
      confidenceBasis: "No qualifying setup, so there is nothing to score.",
      rationale: ["No trend-continuation, oversold-bounce or (if enabled) short setup is present on the latest data."],
      missing: [], invalidation: [],
    };
  }

  const score = (s: StrategyProposal) => (s.simulation ? s.simulation.meanScenarioReturnPct * s.simulation.positiveScenarioShare : -Infinity);
  const ranked = [...found].sort((x, y) => score(y) - score(x));
  const top = ranked[0];
  const sim = top.simulation;
  const supported = Boolean(sim && sim.meanScenarioReturnPct > 0 && sim.positiveScenarioShare >= 0.5);

  const rationale = [
    ...ranked.map((s, i) => `#${i + 1} ${s.name}: ${s.simulation ? `mean simulated net return ${s.simulation.meanScenarioReturnPct.toFixed(2)}%, ${(s.simulation.positiveScenarioShare * 100).toFixed(0)}% of 12 scenarios positive, R:R ${s.riskReward.toFixed(2)}` : "simulation unavailable"}`),
    supported
      ? `Preferred: ${top.name}, because it ranks highest on mean simulated net return weighted by the share of positive scenarios.`
      : "No setup was supported by its simulations (mean return not above zero or fewer than half the scenarios positive), so no direction is proposed.",
  ];

  return {
    ...base,
    direction: supported ? top.direction : "neutral",
    confidence: top.confidence,
    uncertainty: top.uncertainty,
    confidenceBasis: top.confidenceBasis,
    rationale,
    missing: sim ? [] : ["Simulation could not run."],
    invalidation: top.invalidation,
    strategy: top,
    alternatives: ranked.slice(1),
  };
}
