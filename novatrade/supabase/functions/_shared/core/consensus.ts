import type { Direction, EngineId, Signal } from "./types.ts";

export interface ConsensusReport {
  symbol: string;
  engines: { engine: EngineId; direction: Direction; confidence: number | null; hasData: boolean; derived: boolean }[];
  agreement: { level: "full" | "majority" | "split" | "insufficient"; direction: Direction | null; engines: EngineId[] };
  conflicts: { a: EngineId; b: EngineId; detail: string }[];
  missingEngines: { engine: EngineId; reasons: string[] }[];
  strongest: { engine: EngineId; name: string; score: number } | null;
  weakest: { engine: EngineId; name: string; score: number } | null;
  risks: string[];
  invalidation: string[];
  combined: { direction: Direction | null; confidence: number | null; uncertainty: number | null; basis: string };
  assessment: string;
}

const INDEPENDENT: EngineId[] = ["copy", "algo", "autonomous"];

export function buildConsensus(symbol: string, signals: Signal[]): ConsensusReport {
  const engines = signals.map((s) => ({
    engine: s.engine,
    direction: s.direction,
    confidence: s.confidence,
    hasData: s.confidence !== null,
    derived: s.engine === "hybrid",
  }));
  const missingEngines = signals.filter((s) => s.confidence === null).map((s) => ({ engine: s.engine, reasons: s.missing.length ? s.missing : ["No view available."] }));

  // Agreement is judged on the independent engines only; hybrid is derived from them.
  const indep = signals.filter((s) => INDEPENDENT.includes(s.engine) && s.confidence !== null);
  const dirs = indep.map((s) => s.direction);
  const conflicts: ConsensusReport["conflicts"] = [];
  for (let i = 0; i < indep.length; i++) {
    for (let j = i + 1; j < indep.length; j++) {
      const a = indep[i], b = indep[j];
      if ((a.direction === "long" && b.direction === "short") || (a.direction === "short" && b.direction === "long")) {
        conflicts.push({ a: a.engine, b: b.engine, detail: `${a.engine} says ${a.direction}, ${b.engine} says ${b.direction}.` });
      }
    }
  }

  let level: ConsensusReport["agreement"]["level"] = "insufficient";
  let direction: Direction | null = null;
  let agreeing: EngineId[] = [];
  if (indep.length >= 2) {
    const counts = (["long", "short", "neutral"] as Direction[]).map((d) => ({ d, n: dirs.filter((x) => x === d).length }));
    counts.sort((x, y) => y.n - x.n);
    const top = counts[0];
    direction = top.d;
    agreeing = indep.filter((s) => s.direction === top.d).map((s) => s.engine);
    if (top.n === indep.length) level = "full";
    else if (top.n > indep.length / 2) level = "majority";
    else { level = "split"; direction = null; agreeing = []; }
  }

  const scored = signals
    .filter((s) => s.strategy && s.strategy.confidence !== null)
    .map((s) => ({ engine: s.engine, name: s.strategy!.name, score: (s.strategy!.confidence as number) * Math.max(0, s.strategy!.riskReward) }));
  scored.sort((a, b) => b.score - a.score);
  const strongest = scored[0] ?? null;
  const weakest = scored.length > 1 ? scored[scored.length - 1] : null;

  const risks = new Set<string>();
  const invalidation = new Set<string>();
  for (const s of signals) {
    s.invalidation.forEach((i) => invalidation.add(i));
    if (s.strategy) risks.add(`${s.strategy.name}: potential loss to stop ${s.strategy.potentialLossPct.toFixed(2)}% of position value.`);
    if (s.uncertainty !== null && s.uncertainty > 0.6) risks.add(`${s.engine} engine reports high uncertainty (${s.uncertainty.toFixed(2)}).`);
  }
  if (conflicts.length) risks.add("Engines disagree on direction.");
  if (missingEngines.length) risks.add(`${missingEngines.length} engine(s) had no usable data.`);

  const agreeSignals = indep.filter((s) => agreeing.includes(s.engine));
  const combinedConf = agreeSignals.length ? agreeSignals.reduce((s, x) => s + (x.confidence as number), 0) / agreeSignals.length : null;
  const combinedUnc = agreeSignals.length ? Math.max(...agreeSignals.map((x) => x.uncertainty ?? 1)) : null;

  let assessment: string;
  if (level === "insufficient") {
    assessment = `Insufficient evidence for ${symbol}: fewer than two independent engines produced a usable view. No combined direction is given.`;
  } else if (level === "split") {
    assessment = `The engines are split on ${symbol}. No combined direction is given; review the conflicts and risks.`;
  } else {
    assessment = `${level === "full" ? "All" : "A majority of"} independent engines with data (${agreeing.join(", ")}) lean ${direction} on ${symbol}. This is a research view, not advice or a prediction, and it still has to pass the risk gate.`;
  }

  return {
    symbol,
    engines,
    agreement: { level, direction, engines: agreeing },
    conflicts,
    missingEngines,
    strongest,
    weakest,
    risks: [...risks],
    invalidation: [...invalidation],
    combined: {
      direction,
      confidence: combinedConf,
      uncertainty: combinedUnc,
      basis: "Mean confidence of the agreeing independent engines; uncertainty is the largest among them. Not a probability of profit.",
    },
    assessment,
  };
}
