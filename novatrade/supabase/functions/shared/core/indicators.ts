import type { Candle } from "./types.ts";

const nanArray = (n: number) => new Array<number>(n).fill(NaN);

export function sma(x: number[], n: number): number[] {
  const out = nanArray(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= n) sum -= x[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** EMA seeded with the SMA of the first n consecutive finite values. Tolerates a NaN prefix. */
export function ema(x: number[], n: number): number[] {
  const out = nanArray(x.length);
  const k = 2 / (n + 1);
  let run = 0;
  let start = -1;
  for (let i = 0; i < x.length; i++) {
    run = Number.isFinite(x[i]) ? run + 1 : 0;
    if (run === n) {
      start = i;
      break;
    }
  }
  if (start < 0) return out;
  let sum = 0;
  for (let j = start - n + 1; j <= start; j++) sum += x[j];
  out[start] = sum / n;
  for (let i = start + 1; i < x.length; i++) out[i] = x[i] * k + out[i - 1] * (1 - k);
  return out;
}

/** Wilder's RSI. */
export function rsi(x: number[], n = 14): number[] {
  const out = nanArray(x.length);
  if (x.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = x[i] - x[i - 1];
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }
  let avgG = gain / n;
  let avgL = loss / n;
  out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = n + 1; i < x.length; i++) {
    const d = x[i] - x[i - 1];
    avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function macd(x: number[], fast = 12, slow = 26, signalN = 9) {
  const f = ema(x, fast);
  const s = ema(x, slow);
  const line = x.map((_, i) => (Number.isFinite(f[i]) && Number.isFinite(s[i]) ? f[i] - s[i] : NaN));
  const signal = ema(line, signalN);
  const hist = line.map((v, i) => (Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN));
  return { line, signal, hist };
}

/** Wilder's ATR. */
export function atr(candles: Candle[], n = 14): number[] {
  const out = nanArray(candles.length);
  if (candles.length <= n) return out;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  });
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += tr[i];
  out[n] = sum / n;
  for (let i = n + 1; i < candles.length; i++) out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
  return out;
}

export function bollinger(x: number[], n = 20, k = 2) {
  const mid = sma(x, n);
  const upper = nanArray(x.length);
  const lower = nanArray(x.length);
  for (let i = n - 1; i < x.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (x[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

export function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}

export function stdev(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export const last = <T>(a: T[]): T => a[a.length - 1];
