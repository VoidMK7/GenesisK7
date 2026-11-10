import type { Candle } from "../types.ts";
import { atr, ema, mean, rsi, stdev } from "../indicators.ts";

export interface AnalogueResult {
  ok: boolean;
  reason?: string;
  horizonBars: number;
  matches: number;
  meanForwardReturnPct?: number;
  positiveShare?: number;
  p10Pct?: number;
  p90Pct?: number;
  currentFeatures?: { rsi: number; trendAtr: number; momentum20Pct: number };
  note: string;
}

const NOTE = "Historical analogues describe what followed similar conditions in this instrument's own history. They are not a forecast.";

/**
 * Finds past bars whose (RSI, trend distance in ATR, 20-bar momentum) are closest to the latest bar,
 * and reports what happened over the next `horizon` bars. Overlapping matches are thinned so one episode is not counted many times.
 */
export function similarSetups(candles: Candle[], horizon = 10, k = 30): AnalogueResult {
  const base = { horizonBars: horizon, matches: 0, note: NOTE };
  if (candles.length < 200) return { ...base, ok: false, reason: `Need at least 200 candles; have ${candles.length}.` };
  const closes = candles.map((c) => c.c);
  const r = rsi(closes, 14), e = ema(closes, 50), a = atr(candles, 14);
  const feat = (i: number) => {
    if (![r[i], e[i], a[i]].every(Number.isFinite) || i < 20) return null;
    return [r[i], (closes[i] - e[i]) / a[i], ((closes[i] / closes[i - 20]) - 1) * 100];
  };
  const lastI = candles.length - 1;
  const cur = feat(lastI);
  if (!cur) return { ...base, ok: false, reason: "Indicators not warmed up." };

  const rows: { i: number; f: number[] }[] = [];
  for (let i = 0; i + horizon < lastI; i++) {
    const f = feat(i);
    if (f) rows.push({ i, f });
  }
  if (rows.length < 60) return { ...base, ok: false, reason: "Not enough usable history." };

  const sd = [0, 1, 2].map((d) => stdev(rows.map((x) => x.f[d])) || 1);
  const dist = (f: number[]) => Math.sqrt(f.reduce((s, v, d) => s + ((v - cur[d]) / sd[d]) ** 2, 0));
  const ranked = rows.map((x) => ({ ...x, d: dist(x.f) })).sort((p, q) => p.d - q.d);

  const picked: typeof ranked = [];
  for (const c of ranked) {
    if (picked.every((p) => Math.abs(p.i - c.i) > horizon)) picked.push(c);
    if (picked.length >= k) break;
  }
  if (picked.length < 10) return { ...base, ok: false, reason: `Only ${picked.length} distinct analogues found (need 10).` };

  const fwd = picked.map((p) => ((closes[p.i + horizon] / closes[p.i]) - 1) * 100).sort((x, y) => x - y);
  const q = (p: number) => fwd[Math.min(fwd.length - 1, Math.floor(p * (fwd.length - 1)))];
  return {
    ok: true,
    horizonBars: horizon,
    matches: picked.length,
    meanForwardReturnPct: mean(fwd),
    positiveShare: fwd.filter((v) => v > 0).length / fwd.length,
    p10Pct: q(0.1),
    p90Pct: q(0.9),
    currentFeatures: { rsi: cur[0], trendAtr: cur[1], momentum20Pct: cur[2] },
    note: NOTE,
  };
}
