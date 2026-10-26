export function sizePosition(p: { balance: number; riskPct: number; entry: number; stop: number }): number {
  const dist = Math.abs(p.entry - p.stop);
  if (!(dist > 0) || !(p.balance > 0) || !(p.riskPct > 0)) throw new Error("Cannot size position: check entry, stop, balance and risk");
  const qty = (p.balance * (p.riskPct / 100)) / dist;
  // No leverage: notional cannot exceed balance.
  return Math.min(qty, p.balance / p.entry);
}
export const RISK_PROFILES = { low: 0.5, medium: 1, high: 2 } as const;
