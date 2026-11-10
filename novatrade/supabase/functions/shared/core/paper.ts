import type { Side } from "./types.ts";

export interface PaperPosition { symbol: string; qty: number; avgPrice: number }
export interface PaperAccount { cash: number; positions: PaperPosition[] }
export interface PaperFill { symbol: string; side: Side; quantity: number; price: number; fee: number }

export interface PaperApplyResult {
  ok: boolean;
  reason?: string;
  account: PaperAccount;
  realizedPnl: number;
}

/** Applies a simulated fill to a long-only paper account. Refuses overspending and overselling. */
export function applyPaperFill(acct: PaperAccount, f: PaperFill): PaperApplyResult {
  const positions = acct.positions.map((p) => ({ ...p }));
  let cash = acct.cash;
  let realized = 0;
  const idx = positions.findIndex((p) => p.symbol === f.symbol);

  if (f.side === "buy") {
    const cost = f.quantity * f.price + f.fee;
    if (cost > cash + 1e-9) return { ok: false, reason: `Insufficient paper cash: need ${cost.toFixed(2)}, have ${cash.toFixed(2)}.`, account: acct, realizedPnl: 0 };
    cash -= cost;
    if (idx >= 0) {
      const p = positions[idx];
      const q = p.qty + f.quantity;
      p.avgPrice = (p.avgPrice * p.qty + f.price * f.quantity) / q;
      p.qty = q;
    } else positions.push({ symbol: f.symbol, qty: f.quantity, avgPrice: f.price });
  } else {
    if (idx < 0 || positions[idx].qty + 1e-12 < f.quantity) return { ok: false, reason: "Paper account is long-only: cannot sell more than you hold.", account: acct, realizedPnl: 0 };
    const p = positions[idx];
    realized = (f.price - p.avgPrice) * f.quantity - f.fee;
    cash += f.quantity * f.price - f.fee;
    p.qty -= f.quantity;
    if (p.qty <= 1e-12) positions.splice(idx, 1);
  }
  return { ok: true, account: { cash, positions }, realizedPnl: realized };
}

export function paperEquity(acct: PaperAccount, prices: Record<string, number>): { equity: number; unpriced: string[] } {
  let eq = acct.cash;
  const unpriced: string[] = [];
  for (const p of acct.positions) {
    const px = prices[p.symbol];
    if (Number.isFinite(px)) eq += p.qty * px;
    else { eq += p.qty * p.avgPrice; unpriced.push(p.symbol); } // valued at cost when no live price; reported to caller
  }
  return { equity: eq, unpriced };
}
