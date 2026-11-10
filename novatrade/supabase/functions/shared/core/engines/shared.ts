import type { Candle, StrategyProposal } from "../types.ts";
import { DISCLAIMER } from "../types.ts";
import { logReturns } from "../indicators.ts";
import { runScenarios } from "../simulation.ts";

export const MIN_CANDLES = 120;

export function insufficientData(candles: Candle[]): string | null {
  return candles.length < MIN_CANDLES ? `Only ${candles.length} candles available; at least ${MIN_CANDLES} are needed.` : null;
}

export interface ProposalInput {
  name: string;
  source: string;
  methodology: string;
  symbol: string;
  market: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  takeProfits: number[];
  interval: string;
  horizonBars: number;
  closes: number[];
  evidence: string[];
  conditions: string[];
  invalidation: string[];
  seed?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildProposal(a: ProposalInput): StrategyProposal {
  const risk = Math.abs(a.entry - a.stop);
  const reward = Math.abs(a.takeProfits[0] - a.entry);
  const potentialLossPct = (risk / a.entry) * 100;
  const out = runScenarios(logReturns(a.closes), {
    direction: a.direction,
    entry: a.entry,
    stop: a.stop,
    takeProfit: a.takeProfits[0],
    horizonBars: a.horizonBars,
  }, { seed: a.seed });

  let confidence: number | null = null;
  let uncertainty: number | null = null;
  let basis = `Not computed: ${out.ok ? "" : out.reason}`;
  if (out.ok) {
    const s = out.summary;
    confidence = s.positiveScenarioShare;
    const spread = s.best.expectedReturnPct - s.worst.expectedReturnPct;
    uncertainty = clamp(spread / (2 * Math.max(potentialLossPct, 0.01)), 0, 1);
    basis = `Share of the ${s.scenarioCount} simulated scenarios with positive expected net return. Uncertainty is the spread between best and worst scenario relative to the stop distance. Neither is a probability of profit.`;
  }

  return {
    name: a.name,
    symbol: a.symbol,
    market: a.market,
    source: a.source,
    methodology: a.methodology,
    direction: a.direction,
    entry: { type: "market", price: a.entry, conditions: a.conditions },
    stopLoss: a.stop,
    takeProfits: a.takeProfits,
    riskReward: risk > 0 ? reward / risk : 0,
    timeframe: `up to ${a.horizonBars} x ${a.interval} bars`,
    simulation: out.ok ? out.summary : null,
    evidence: out.ok ? a.evidence : [...a.evidence, `Simulation not run: ${out.reason}`],
    confidence,
    uncertainty,
    confidenceBasis: basis,
    potentialLossPct,
    invalidation: a.invalidation,
    disclaimer: DISCLAIMER,
  };
}
