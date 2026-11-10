import type { Candle, Signal } from "./types.ts";
import { DISCLAIMER } from "./types.ts";
import { buildConsensus, type ConsensusReport } from "./consensus.ts";
import { runAlgoEngine } from "./engines/algo.ts";
import { runAutonomousEngine } from "./engines/autonomous.ts";
import { runCopyEngine, type TraderRecord } from "./engines/copy.ts";
import { runHybridEngine, type HumanView, type SentimentInput } from "./engines/hybrid.ts";

export interface AnalyzeInput {
  symbol: string;
  market: string;
  interval: string;
  candles: Candle[];
  traders?: TraderRecord[];
  sentiment?: SentimentInput;
  human?: HumanView;
  allowShort?: boolean;
}

export interface AnalysisResult {
  symbol: string;
  asOf: number | null;
  signals: Signal[];
  consensus: ConsensusReport;
  disclaimer: string;
}

/**
 * Pass 1: copy, algorithmic and autonomous engines analyse independently.
 * Pass 2: hybrid weighs their findings. Then the consensus report is built.
 */
export function analyze(i: AnalyzeInput): AnalysisResult {
  const independent: Signal[] = [
    runCopyEngine(i.symbol, i.traders),
    runAlgoEngine(i.symbol, i.market, i.interval, i.candles),
    runAutonomousEngine(i.symbol, i.market, i.interval, i.candles, { allowShort: i.allowShort }),
  ];
  const hybrid = runHybridEngine(i.symbol, independent, i.sentiment, i.human);
  const signals = [...independent, hybrid];
  return {
    symbol: i.symbol,
    asOf: i.candles.length ? i.candles[i.candles.length - 1].t : null,
    signals,
    consensus: buildConsensus(i.symbol, signals),
    disclaimer: DISCLAIMER,
  };
}
