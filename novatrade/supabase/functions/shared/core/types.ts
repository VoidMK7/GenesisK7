export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type EngineId = "copy" | "algo" | "autonomous" | "hybrid";
export type Direction = "long" | "short" | "neutral";
export type ExecutionMode = "analysis" | "paper" | "live";
export type Side = "buy" | "sell";

export interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  paths: number;
  probTakeProfit: number; // 0..1
  probStop: number;
  probTimeout: number;
  expectedReturnPct: number; // net of fees, simulated
  p5ReturnPct: number;
  p95ReturnPct: number;
  worstReturnPct: number;
}

export interface SimulationSummary {
  kind: "simulation"; // never a forecast
  scenarioCount: number;
  scenarios: ScenarioResult[];
  basis: string;
  seed: number;
  historicalReturnsUsed: number;
  meanScenarioReturnPct: number;
  best: { id: string; expectedReturnPct: number };
  worst: { id: string; expectedReturnPct: number };
  positiveScenarioShare: number; // fraction of scenarios with positive expected net return
  caveats: string[];
}

export interface StrategyProposal {
  name: string;
  symbol: string;
  market: string;
  source: string;
  methodology: string;
  direction: Direction;
  entry: { type: "market" | "limit"; price: number; conditions: string[] };
  stopLoss: number;
  takeProfits: number[];
  riskReward: number;
  timeframe: string;
  simulation: SimulationSummary | null;
  evidence: string[];
  confidence: number | null;
  uncertainty: number | null;
  confidenceBasis: string;
  potentialLossPct: number;
  invalidation: string[];
  disclaimer: string;
}

export interface Signal {
  engine: EngineId;
  symbol: string;
  direction: Direction;
  confidence: number | null; // null = cannot be computed from available data
  uncertainty: number | null;
  confidenceBasis: string;
  rationale: string[];
  missing: string[];
  invalidation: string[];
  strategy?: StrategyProposal;
  alternatives?: StrategyProposal[];
  derivedFrom?: EngineId[]; // set for hybrid
}

export const DISCLAIMER =
  "Simulated or backtested results are not forecasts and do not guarantee future returns. Trading involves risk of loss.";
