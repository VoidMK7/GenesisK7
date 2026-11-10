import type { Side } from "./types.ts";

export interface LeaderTrade {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  leaderEquity: number;
}

export interface CopySubscription {
  allocation: number; // currency the follower assigned to this leader
  maxTradePct: number; // max single trade as % of allocation
  stopLossPct: number; // protective stop distance applied to every copied buy, % below the follower's entry
}

export type CopyPlan =
  | { copy: true; side: Side; quantity: number; notional: number; capped: boolean; stopLoss?: number; reduceOnly: boolean }
  | { copy: false; reason: string };

/**
 * Scales a leader's trade to the follower's allocation, then applies the follower's per-trade cap.
 * Buys get a protective stop; sells only ever reduce an existing position.
 */
export function planCopyOrder(t: LeaderTrade, s: CopySubscription): CopyPlan {
  if (!(t.leaderEquity > 0) || !(t.price > 0) || !(t.quantity > 0)) return { copy: false, reason: "Leader trade data is incomplete." };
  if (!(s.allocation > 0)) return { copy: false, reason: "No allocation set." };
  const ratio = s.allocation / t.leaderEquity;
  let qty = t.quantity * ratio;
  const cap = (s.maxTradePct / 100) * s.allocation;
  let notional = qty * t.price;
  let capped = false;
  if (notional > cap) {
    qty = cap / t.price;
    notional = cap;
    capped = true;
  }
  if (!(qty > 0)) return { copy: false, reason: "Scaled quantity is zero." };
  return {
    copy: true,
    side: t.side,
    quantity: qty,
    notional,
    capped,
    stopLoss: t.side === "buy" ? t.price * (1 - s.stopLossPct / 100) : undefined,
    reduceOnly: t.side === "sell",
  };
}
