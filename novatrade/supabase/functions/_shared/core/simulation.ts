import type { ScenarioResult, SimulationSummary } from "./types.ts";
import { mean, stdev } from "./indicators.ts";

export interface TradeSetup {
  direction: "long" | "short";
  entry: number;
  stop: number;
  takeProfit: number;
  horizonBars: number;
  feeBps?: number; // per side
}

interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  volMult: number;
  driftSigma: number; // added drift per bar, in units of historical sigma
  blockLen: number; // 1 = iid bootstrap
  gap: number; // price gap applied at bar 0 (fraction)
  meanRevert: number; // fraction of previous return reversed
  extraCostBps: number; // per side
  shockProb: number; // per path probability of one random shock bar
  shockSize: number; // fraction, e.g. -0.12
}

const SCENARIOS: ScenarioDef[] = [
  { id: "baseline", name: "Baseline", description: "Resampled historical returns, unchanged.", volMult: 1, driftSigma: 0, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "high_vol", name: "Higher volatility", description: "Historical returns scaled by 1.5.", volMult: 1.5, driftSigma: 0, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "low_vol", name: "Lower volatility", description: "Historical returns scaled by 0.7.", volMult: 0.7, driftSigma: 0, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "bull_drift", name: "Bullish drift", description: "Adds upward drift of 0.1 sigma per bar.", volMult: 1, driftSigma: 0.1, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "bear_drift", name: "Bearish drift", description: "Adds downward drift of 0.1 sigma per bar.", volMult: 1, driftSigma: -0.1, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "gap_down", name: "Gap down", description: "Price gaps down 6% right after entry.", volMult: 1, driftSigma: 0, blockLen: 1, gap: -0.06, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "gap_up", name: "Gap up", description: "Price gaps up 6% right after entry.", volMult: 1, driftSigma: 0, blockLen: 1, gap: 0.06, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "vol_cluster", name: "Volatility clustering", description: "Block bootstrap (10 bars) keeps calm and turbulent stretches together.", volMult: 1, driftSigma: 0, blockLen: 10, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "trend_persist", name: "Trend persistence", description: "Block bootstrap (25 bars) preserves trending behaviour.", volMult: 1, driftSigma: 0, blockLen: 25, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "mean_revert", name: "Mean reversion", description: "Each bar reverses 30% of the previous bar's move.", volMult: 1, driftSigma: 0, blockLen: 1, gap: 0, meanRevert: 0.3, extraCostBps: 0, shockProb: 0, shockSize: 0 },
  { id: "liquidity_stress", name: "Liquidity stress", description: "Volatility x1.3 and 30 bps extra cost per side.", volMult: 1.3, driftSigma: 0, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 30, shockProb: 0, shockSize: 0 },
  { id: "tail_shock", name: "Tail shock", description: "5% of paths include a single -12% bar.", volMult: 1, driftSigma: 0, blockLen: 1, gap: 0, meanRevert: 0, extraCostBps: 0, shockProb: 0.05, shockSize: -0.12 },
];

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function runScenario(
  sc: ScenarioDef,
  rets: number[],
  mu: number,
  sigma: number,
  setup: TradeSetup,
  paths: number,
  seed: number,
): ScenarioResult {
  const rng = mulberry32(seed);
  const dir = setup.direction === "long" ? 1 : -1;
  const fee = setup.feeBps ?? 10;
  const costPct = (2 * (fee + sc.extraCostBps)) / 100;
  const H = setup.horizonBars;
  const results: number[] = [];
  let tp = 0;
  let stop = 0;
  let timeout = 0;

  for (let p = 0; p < paths; p++) {
    const seq: number[] = [];
    if (sc.blockLen > 1) {
      while (seq.length < H) {
        const s = Math.floor(rng() * rets.length);
        for (let k = 0; k < sc.blockLen && seq.length < H; k++) seq.push(rets[(s + k) % rets.length]);
      }
    } else {
      for (let i = 0; i < H; i++) seq.push(rets[Math.floor(rng() * rets.length)]);
    }
    // transform
    let prev = 0;
    for (let i = 0; i < H; i++) {
      let r = mu + (seq[i] - mu) * sc.volMult + sc.driftSigma * sigma;
      if (sc.meanRevert) r -= sc.meanRevert * prev;
      prev = seq[i] - mu;
      seq[i] = r;
    }
    if (sc.shockProb && rng() < sc.shockProb) seq[Math.floor(rng() * H)] += Math.log(1 + sc.shockSize);

    let price = setup.entry;
    if (sc.gap) price *= 1 + sc.gap;
    const res: { exit: number; kind: "tp" | "stop" | "timeout" } = { exit: NaN, kind: "timeout" };

    const check = (px: number): boolean => {
      if (dir === 1) {
        if (px <= setup.stop) { res.exit = px; res.kind = "stop"; return true; }
        if (px >= setup.takeProfit) { res.exit = setup.takeProfit; res.kind = "tp"; return true; }
      } else {
        if (px >= setup.stop) { res.exit = px; res.kind = "stop"; return true; }
        if (px <= setup.takeProfit) { res.exit = setup.takeProfit; res.kind = "tp"; return true; }
      }
      return false;
    };

    let done = sc.gap ? check(price) : false;
    for (let i = 0; i < H && !done; i++) {
      price *= Math.exp(seq[i]);
      done = check(price);
    }
    if (!done) { res.exit = price; res.kind = "timeout"; }
    if (res.kind === "tp") tp++;
    else if (res.kind === "stop") stop++;
    else timeout++;
    results.push(dir * ((res.exit - setup.entry) / setup.entry) * 100 - costPct);
  }

  const sorted = [...results].sort((a, b) => a - b);
  return {
    id: sc.id,
    name: sc.name,
    description: sc.description,
    paths,
    probTakeProfit: tp / paths,
    probStop: stop / paths,
    probTimeout: timeout / paths,
    expectedReturnPct: mean(results),
    p5ReturnPct: pct(sorted, 0.05),
    p95ReturnPct: pct(sorted, 0.95),
    worstReturnPct: sorted[0],
  };
}

export type SimulationOutcome =
  | { ok: true; summary: SimulationSummary }
  | { ok: false; reason: string };

/**
 * Runs 12 scenario simulations for one setup. Needs enough history to resample from;
 * otherwise it refuses instead of inventing results.
 */
export function runScenarios(
  logReturns: number[],
  setup: TradeSetup,
  opts: { paths?: number; seed?: number } = {},
): SimulationOutcome {
  if (logReturns.length < 60) {
    return { ok: false, reason: `Need at least 60 historical returns to simulate; have ${logReturns.length}.` };
  }
  const risky =
    setup.direction === "long"
      ? setup.stop < setup.entry && setup.takeProfit > setup.entry
      : setup.stop > setup.entry && setup.takeProfit < setup.entry;
  if (!risky) return { ok: false, reason: "Stop and take-profit are on the wrong side of the entry for this direction." };

  const paths = opts.paths ?? 400;
  const seed = opts.seed ?? 1337;
  const mu = mean(logReturns);
  const sigma = stdev(logReturns);
  const scenarios = SCENARIOS.map((sc, i) => runScenario(sc, logReturns, mu, sigma, setup, paths, seed + i * 7919));
  const exp = scenarios.map((s) => s.expectedReturnPct);
  const bestIdx = exp.indexOf(Math.max(...exp));
  const worstIdx = exp.indexOf(Math.min(...exp));

  return {
    ok: true,
    summary: {
      kind: "simulation",
      scenarioCount: scenarios.length,
      scenarios,
      basis: `${paths} resampled paths per scenario over ${setup.horizonBars} bars, from ${logReturns.length} historical returns. Barriers are checked at bar closes.`,
      seed,
      historicalReturnsUsed: logReturns.length,
      meanScenarioReturnPct: mean(exp),
      best: { id: scenarios[bestIdx].id, expectedReturnPct: exp[bestIdx] },
      worst: { id: scenarios[worstIdx].id, expectedReturnPct: exp[worstIdx] },
      positiveScenarioShare: exp.filter((v) => v > 0).length / exp.length,
      caveats: [
        "Simulations resample the past; they cannot anticipate regime changes, news or liquidity gaps.",
        "Results are net of the stated fees only. Real slippage and funding costs can be higher.",
        "This is a simulation, not a forecast or a promise of profit.",
      ],
    },
  };
}
