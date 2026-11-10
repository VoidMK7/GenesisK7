import type { Direction, EngineId, Signal } from "../types.ts";

export interface SentimentInput {
  score: number; // -1 (bearish) .. +1 (bullish)
  source: string;
  asOf: string;
  method: string; // how the score was produced, e.g. "keyword heuristic on N headlines"
}

export interface HumanView {
  direction: Direction;
  by: string;
  note?: string;
}

const val = (d: Direction) => (d === "long" ? 1 : d === "short" ? -1 : 0);

/**
 * Hybrid engine: second pass. Weighs the other engines' findings with optional sentiment and a human view.
 * Needs at least two informative inputs; otherwise it says so.
 */
export function runHybridEngine(
  symbol: string,
  others: Signal[],
  sentiment?: SentimentInput,
  human?: HumanView,
): Signal {
  const base = { engine: "hybrid" as const, symbol, derivedFrom: others.map((o) => o.engine) as EngineId[] };
  const inputs: { label: string; v: number; w: number; unc: number }[] = [];

  for (const s of others) {
    if (s.confidence === null) continue;
    inputs.push({ label: `${s.engine} engine (${s.direction})`, v: val(s.direction), w: Math.max(0.05, s.confidence), unc: s.uncertainty ?? 1 });
  }
  if (sentiment) {
    const dir = sentiment.score > 0.15 ? 1 : sentiment.score < -0.15 ? -1 : 0;
    inputs.push({ label: `sentiment ${sentiment.score.toFixed(2)} (${sentiment.source})`, v: dir, w: Math.min(0.5, Math.abs(sentiment.score)) || 0.05, unc: 0.7 });
  }
  if (human) inputs.push({ label: `human view by ${human.by} (${human.direction})`, v: val(human.direction), w: 0.6, unc: 0.5 });

  if (inputs.length < 2) {
    return {
      ...base, direction: "neutral", confidence: null, uncertainty: null,
      confidenceBasis: "Fewer than two informative inputs.",
      rationale: [], missing: ["Needs at least two informative inputs (engines with data, sentiment, or a human view)."], invalidation: [],
    };
  }

  const totalW = inputs.reduce((s, i) => s + i.w, 0);
  const net = inputs.reduce((s, i) => s + i.v * i.w, 0) / totalW; // -1..1
  const direction: Direction = net > 0.25 ? "long" : net < -0.25 ? "short" : "neutral";
  const agree = inputs.filter((i) => Math.sign(i.v) === Math.sign(net) && i.v !== 0).length;
  const uncertainty = Math.min(1, inputs.reduce((s, i) => s + i.unc * i.w, 0) / totalW);

  return {
    ...base,
    direction,
    confidence: direction === "neutral" ? 0 : Math.min(1, Math.abs(net)),
    uncertainty,
    confidenceBasis: "Weighted agreement of the inputs (|net weighted vote|). Uncertainty is the weighted mean of input uncertainties. A heuristic, not a probability.",
    rationale: [
      ...inputs.map((i) => `${i.label}: weight ${i.w.toFixed(2)}`),
      `Net weighted vote ${net.toFixed(2)}; ${agree} of ${inputs.length} inputs point the same way.`,
      ...(sentiment ? [`Sentiment method: ${sentiment.method} (as of ${sentiment.asOf}). Treat as opinion, not fact.`] : []),
    ],
    missing: [],
    invalidation: ["Any contributing engine flips direction", "Sentiment reverses materially"],
  };
}
