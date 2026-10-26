import type { Candle } from "./market";
import { INTERVAL_MIN } from "./market";

export type Setup = {
  symbol: string; side: "buy" | "sell"; entry: number; stop: number; target: number;
  horizonMinutes: number; interval: string;
};
export type SimResult = {
  id: number; regime: string; outcome: "target" | "stop" | "timeout";
  exitPrice: number; rMultiple: number; pnlPct: number; minutes: number; path: number[];
};
export type SimSummary = {
  results: SimResult[]; targetHits: number; stopHits: number; timeouts: number;
  avgR: number; avgMinutesToExit: number; note: string;
};

export function validateSetup(s: Setup): string | null {
  if (![s.entry, s.stop, s.target, s.horizonMinutes].every((n) => Number.isFinite(n) && n > 0)) return "Entry, stop, target and horizon must be positive numbers";
  if (s.side === "buy" && !(s.stop < s.entry && s.target > s.entry)) return "For a buy, stop must be below entry and target above";
  if (s.side === "sell" && !(s.stop > s.entry && s.target < s.entry)) return "For a sell, stop must be above entry and target below";
  if (!INTERVAL_MIN[s.interval]) return "Unsupported interval";
  return null;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 12 scenarios = 3 volatility regimes (calm / normal / stressed) x 4 random paths.
// Each step resamples a real historical candle's (open->high, open->low, open->close) moves,
// so the paths reflect recent volatility. There is NO built-in directional edge: this tests how the
// stop/target layout behaves, it is not a price forecast. If stop and target are both touched in
// one candle, the stop is assumed to hit first (conservative).
export function runSimulations(setup: Setup, candles: Candle[], seed = Date.now() % 1e9): SimSummary {
  const err = validateSetup(setup);
  if (err) throw new Error(err);
  if (candles.length < 30) throw new Error("Not enough candle history to simulate");

  const moves = candles.map((c) => ({ h: (c.h - c.o) / c.o, l: (c.l - c.o) / c.o, c: (c.c - c.o) / c.o }));
  const stepMin = INTERVAL_MIN[setup.interval];
  const steps = Math.max(1, Math.min(300, Math.ceil(setup.horizonMinutes / stepMin)));
  const dir = setup.side === "buy" ? 1 : -1;
  const risk = Math.abs(setup.entry - setup.stop);
  const regimes: [string, number][] = [["calm", 0.7], ["normal", 1], ["stressed", 1.5]];

  const results: SimResult[] = [];
  let id = 0;
  for (const [regime, mult] of regimes) {
    for (let k = 0; k < 4; k++) {
      const rnd = mulberry32(seed + id * 7919);
      let p = setup.entry;
      let outcome: SimResult["outcome"] = "timeout";
      let exit = p, minutes = steps * stepMin;
      const path = [p];
      for (let s = 1; s <= steps; s++) {
        const m = moves[Math.floor(rnd() * moves.length)];
        const hi = p * (1 + Math.max(m.h, m.c, 0) * mult);
        const lo = p * (1 + Math.min(m.l, m.c, 0) * mult);
        const close = p * (1 + m.c * mult);
        const stopHit = dir === 1 ? lo <= setup.stop : hi >= setup.stop;
        const targetHit = dir === 1 ? hi >= setup.target : lo <= setup.target;
        if (stopHit) { outcome = "stop"; exit = setup.stop; minutes = s * stepMin; path.push(exit); break; }
        if (targetHit) { outcome = "target"; exit = setup.target; minutes = s * stepMin; path.push(exit); break; }
        p = close; exit = close; path.push(p);
      }
      const pnl = dir * (exit - setup.entry);
      results.push({
        id: ++id, regime, outcome, exitPrice: exit, rMultiple: pnl / risk,
        pnlPct: (pnl / setup.entry) * 100, minutes, path,
      });
    }
  }
  const n = results.length;
  return {
    results,
    targetHits: results.filter((r) => r.outcome === "target").length,
    stopHits: results.filter((r) => r.outcome === "stop").length,
    timeouts: results.filter((r) => r.outcome === "timeout").length,
    avgR: results.reduce((a, r) => a + r.rMultiple, 0) / n,
    avgMinutesToExit: results.reduce((a, r) => a + r.minutes, 0) / n,
    note: "Statistical stress test from recent candle volatility, not a prediction. 12 paths is a small sample.",
  };
}
