import type { Direction, Signal } from "../types.ts";

export type RecordSource = "broker_verified" | "self_reported" | "hypothetical";

export interface TraderRecord {
  traderId: string;
  name: string;
  source: RecordSource;
  trades: number;
  days: number;
  winRatePct: number;
  maxDrawdownPct: number;
  returnPct: number;
  openPositions?: { symbol: string; direction: "long" | "short" }[];
}

export const QUALIFY = { minTrades: 30, minDays: 90, maxDrawdownPct: 35 };

export function qualifies(t: TraderRecord): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (t.source !== "broker_verified") reasons.push(`record is ${t.source.replace("_", " ")}, not broker-verified`);
  if (t.trades < QUALIFY.minTrades) reasons.push(`${t.trades} trades (need ${QUALIFY.minTrades})`);
  if (t.days < QUALIFY.minDays) reasons.push(`${t.days} days of history (need ${QUALIFY.minDays})`);
  if (t.maxDrawdownPct > QUALIFY.maxDrawdownPct) reasons.push(`max drawdown ${t.maxDrawdownPct}% above ${QUALIFY.maxDrawdownPct}%`);
  return { ok: reasons.length === 0, reasons };
}

/** Copy engine: only broker-verified, sufficiently long, drawdown-limited traders count as evidence. */
export function runCopyEngine(symbol: string, traders: TraderRecord[] | undefined): Signal {
  const base = { engine: "copy" as const, symbol };
  if (!traders || traders.length === 0) {
    return { ...base, direction: "neutral", confidence: null, uncertainty: null, confidenceBasis: "No trader data.", rationale: [], missing: ["No trader records are available."], invalidation: [] };
  }
  const evals = traders.map((t) => ({ t, q: qualifies(t) }));
  const good = evals.filter((e) => e.q.ok);
  const rationale = evals.map((e) => `${e.t.name}: ${e.q.ok ? "qualifies" : `excluded (${e.q.reasons.join("; ")})`}`);
  if (!good.length) {
    return { ...base, direction: "neutral", confidence: null, uncertainty: null, confidenceBasis: "No trader met the verified-record standard.", rationale, missing: ["No qualifying verified traders."], invalidation: [] };
  }

  const holders = good.flatMap((e) => (e.t.openPositions ?? []).filter((p) => p.symbol === symbol).map((p) => ({ name: e.t.name, dir: p.direction })));
  if (!holders.length) {
    return { ...base, direction: "neutral", confidence: 0, uncertainty: 1 / Math.sqrt(good.length), confidenceBasis: "No qualifying trader currently holds this symbol.", rationale: [...rationale, `${good.length} qualifying trader(s), none holding ${symbol}.`], missing: [], invalidation: [] };
  }
  const longs = holders.filter((h) => h.dir === "long").length;
  const shorts = holders.length - longs;
  const dir: Direction = longs === shorts ? "neutral" : longs > shorts ? "long" : "short";
  const share = Math.max(longs, shorts) / good.length;
  return {
    ...base,
    direction: dir,
    confidence: dir === "neutral" ? 0 : share,
    uncertainty: 1 / Math.sqrt(good.length),
    confidenceBasis: "Share of qualifying traders positioned this way. Uncertainty is 1/sqrt(number of qualifying traders). Not a probability.",
    rationale: [...rationale, `${longs} long, ${shorts} short among qualifying traders holding ${symbol}.`],
    missing: [],
    invalidation: ["Followed traders close the position", "A followed trader's drawdown breaches your stop-copy limit"],
  };
}
