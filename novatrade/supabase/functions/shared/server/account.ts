import type { RiskLimits, AccountState, EquityMemory } from "../core/risk.ts";
import { rollEquity } from "../core/risk.ts";
import type { PaperAccount } from "../core/paper.ts";
import { paperEquity } from "../core/paper.ts";
import type { AssetClass } from "../core/market/types.ts";
import { serviceDb } from "./auth.ts";
import { providerFor } from "./market.ts";

export const PAPER_START_CASH = 10_000;

export async function loadRiskLimits(userId: string): Promise<RiskLimits> {
  const { data } = await serviceDb().from("nova_risk_limits").select("*").eq("user_id", userId).maybeSingle();
  const n = (x: unknown) => (x === null || x === undefined ? undefined : Number(x));
  return {
    requireStopLoss: data ? Boolean(data.require_stop_loss) : true, // safe default when nothing is configured
    maxOrderValue: n(data?.max_order_value), maxPositionPct: n(data?.max_position_pct), maxConcentrationPct: n(data?.max_concentration_pct),
    maxLeverage: n(data?.max_leverage), maxRiskPerTradePct: n(data?.max_risk_per_trade_pct), dailyLossLimit: n(data?.daily_loss_limit),
    weeklyLossLimit: n(data?.weekly_loss_limit), maxDrawdownPct: n(data?.max_drawdown_pct), maxVolumeParticipationPct: n(data?.max_volume_participation_pct),
  };
}

export async function loadSettings(userId: string) {
  const { data } = await serviceDb().from("nova_user_settings").select("*").eq("user_id", userId).maybeSingle();
  return {
    executionMode: (data?.execution_mode ?? "analysis") as "analysis" | "paper" | "live",
    liveEnabled: Boolean(data?.live_enabled),
    liveUnlockedAt: (data?.live_unlocked_at as string | null) ?? null,
    emergencyStop: Boolean(data?.emergency_stop),
  };
}

export interface PaperLoaded { account: PaperAccount; classes: Record<string, AssetClass> }

export async function ensurePaperAccount(userId: string): Promise<PaperLoaded> {
  const db = serviceDb();
  let { data: acct } = await db.from("nova_paper_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (!acct) {
    await db.from("nova_paper_accounts").upsert({ user_id: userId, cash: PAPER_START_CASH, start_cash: PAPER_START_CASH });
    acct = { cash: PAPER_START_CASH };
  }
  const { data: pos } = await db.from("nova_paper_positions").select("symbol,qty,avg_price,asset_class").eq("user_id", userId);
  const rows = pos ?? [];
  return {
    account: { cash: Number(acct.cash), positions: rows.map((p) => ({ symbol: p.symbol as string, qty: Number(p.qty), avgPrice: Number(p.avg_price) })) },
    classes: Object.fromEntries(rows.map((p) => [p.symbol as string, p.asset_class as AssetClass])),
  };
}

export async function savePaperAccount(userId: string, a: PaperAccount, classes: Record<string, AssetClass>) {
  const db = serviceDb();
  await db.from("nova_paper_accounts").update({ cash: Math.max(0, a.cash), updated_at: new Date().toISOString() }).eq("user_id", userId);
  await db.from("nova_paper_positions").delete().eq("user_id", userId);
  if (a.positions.length) {
    await db.from("nova_paper_positions").insert(a.positions.map((p) => ({ user_id: userId, symbol: p.symbol, asset_class: classes[p.symbol] ?? "crypto", qty: p.qty, avg_price: p.avgPrice })));
  }
}

/** Reads, rolls and saves the peak / day-start / week-start equity, and returns the P/L the risk engine needs. */
export async function trackEquity(userId: string, scope: string, equity: number) {
  const db = serviceDb();
  const { data } = await db.from("nova_equity_memory").select("memory").eq("user_id", userId).eq("scope", scope).maybeSingle();
  const r = rollEquity((data?.memory as EquityMemory | undefined) ?? null, equity, new Date());
  await db.from("nova_equity_memory").upsert({ user_id: userId, scope, memory: r.memory, updated_at: new Date().toISOString() });
  return r;
}

/** Latest prices for the paper positions, from whichever provider covers each asset class. Symbols that cannot be priced are returned in `unpriced`. */
export async function priceSymbols(classes: Record<string, AssetClass>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(Object.entries(classes).map(async ([sym, cls]) => {
    try { out[sym] = (await providerFor(cls).getQuote(sym)).price; } catch { /* left unpriced on purpose */ }
  }));
  return out;
}

export async function paperAccountState(userId: string, emergencyStop: boolean, extraPrices: Record<string, number> = {}): Promise<{ state: AccountState; unpriced: string[]; loaded: PaperLoaded }> {
  const loaded = await ensurePaperAccount(userId);
  const prices = { ...(await priceSymbols(loaded.classes)), ...extraPrices };
  const { equity, unpriced } = paperEquity(loaded.account, prices);
  const r = await trackEquity(userId, "paper", equity);
  return {
    loaded,
    unpriced,
    state: {
      equity, peakEquity: r.memory.peakEquity, dailyPnl: r.dailyPnl, weeklyPnl: r.weeklyPnl, emergencyStop,
      positions: loaded.account.positions.map((p) => ({ symbol: p.symbol, value: p.qty * (prices[p.symbol] ?? p.avgPrice) })),
    },
  };
}
