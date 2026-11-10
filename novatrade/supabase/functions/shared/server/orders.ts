import { checkLiveUnlock, submitOrder, type ExecutionResult, type OrderRequest, type PipelineContext } from "../core/execution.ts";
import { applyPaperFill } from "../core/paper.ts";
import type { AccountState } from "../core/risk.ts";
import type { AssetClass } from "../core/market/types.ts";
import { notify, securityEvent, serviceDb } from "./auth.ts";
import { connectorFor } from "./connections.ts";
import { loadRiskLimits, loadSettings, paperAccountState, savePaperAccount, trackEquity } from "./account.ts";
import { HttpError } from "./http.ts";
import { providerFor } from "./market.ts";
import { SupabaseOrderStore } from "./store.ts";

export interface OrderInput {
  assetClass: AssetClass;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  idempotencyKey: string;
  engine?: "copy" | "algo" | "autonomous" | "hybrid";
  strategyId?: string;
  connectionId?: string;
  reduceOnly?: boolean;
  /** Overrides the user's saved mode. Used by the copy job, never by request bodies. */
  forceMode?: "analysis" | "paper" | "live";
  meta?: Record<string, unknown>;
}

export interface OrderOutcome extends ExecutionResult { unlock?: ReturnType<typeof checkLiveUnlock>["checks"] }

/** The single path every order takes, from any engine or from the user. */
export async function executeOrder(userId: string, o: OrderInput): Promise<OrderOutcome> {
  const settings = await loadSettings(userId);
  const limits = await loadRiskLimits(userId);
  const mode = o.forceMode ?? settings.executionMode;
  const db = serviceDb();

  // Reference price: needed for risk checks and paper fills. Analysis Only needs none.
  let referencePrice = o.limitPrice ?? 0;
  if (mode !== "analysis") {
    try {
      referencePrice = (await providerFor(o.assetClass).getQuote(o.symbol)).price;
    } catch (e) {
      if (!(o.type === "limit" && o.limitPrice)) throw new HttpError(503, `No price available for ${o.symbol}: ${e instanceof Error ? e.message : "provider error"}. Orders need a price source.`);
      referencePrice = o.limitPrice;
    }
  }

  let account: AccountState = { equity: 0, peakEquity: 0, dailyPnl: 0, weeklyPnl: 0, positions: [], emergencyStop: settings.emergencyStop };
  let connectionId: string | null = null;
  let connector: Awaited<ReturnType<typeof connectorFor>>["connector"] | undefined;
  let liveUnlocked = false;
  let withdrawalSafe = false;
  let unlockChecks: OrderOutcome["unlock"];
  let paperCtx: Awaited<ReturnType<typeof paperAccountState>> | undefined;

  if (mode === "paper") {
    paperCtx = await paperAccountState(userId, settings.emergencyStop, { [o.symbol]: referencePrice });
    account = paperCtx.state;
    // Check feasibility before the pipeline records anything.
    const est = applyPaperFill(paperCtx.loaded.account, { symbol: o.symbol, side: o.side, quantity: o.quantity, price: referencePrice * (o.side === "buy" ? 1.002 : 0.998), fee: referencePrice * o.quantity * 0.002 });
    if (!est.ok) throw new HttpError(409, est.reason ?? "Paper order is not possible.");
  }

  if (mode === "live") {
    if (!o.connectionId) throw new HttpError(400, "connectionId is required for live orders.");
    const c = await connectorFor(userId, o.connectionId);
    if (c.row.environment !== "live") throw new HttpError(409, "Live mode needs a live-environment connection. This one is a paper/practice connection.");
    connector = c.connector;
    connectionId = c.row.id;
    const unlock = checkLiveUnlock({
      connection: { status: c.row.status, permissionsVerified: c.row.permissions_verified, withdrawalPermission: c.row.withdrawal_permission },
      limits, userEnabledLive: settings.liveEnabled && Boolean(settings.liveUnlockedAt), executionTestPassedAt: c.row.execution_test_passed_at,
    });
    unlockChecks = unlock.checks;
    liveUnlocked = unlock.unlocked && settings.executionMode === "live";
    withdrawalSafe = c.row.withdrawal_permission === false && c.row.permissions_verified;
    if (liveUnlocked) {
      const acct = await c.connector.getAccount();
      const positions = await c.connector.getPositions();
      const eq = await trackEquity(userId, c.row.id, acct.equity);
      account = {
        equity: acct.equity, peakEquity: eq.memory.peakEquity, dailyPnl: eq.dailyPnl, weeklyPnl: eq.weeklyPnl, emergencyStop: settings.emergencyStop,
        positions: positions.map((p) => ({ symbol: p.symbol, value: Number.isFinite(p.marketValue) ? Math.abs(p.marketValue) : Math.abs(p.quantity * p.avgPrice) || 0 })),
      };
    }
  } else if (o.connectionId) {
    connectionId = o.connectionId;
  }

  const store = new SupabaseOrderStore(connectionId);
  const ctx: PipelineContext = { userId, mode, limits, account, liveUnlocked, connectorWithdrawalSafe: withdrawalSafe };
  const req: OrderRequest = {
    symbol: o.symbol, side: o.side, type: o.type, quantity: o.quantity, limitPrice: o.limitPrice, stopLoss: o.stopLoss, takeProfit: o.takeProfit,
    referencePrice, reduceOnly: o.reduceOnly, engine: o.engine, idempotencyKey: o.idempotencyKey,
    meta: { ...(o.meta ?? {}), equity: account.equity || null, assetClass: o.assetClass, strategyId: o.strategyId ?? null },
  };

  const result = await submitOrder({ store, connector, paper: { feeBps: 20, slippageBps: 20 }, pollAttempts: 6, pollDelayMs: 700 }, ctx, req);

  // Side effects after the pipeline has decided.
  if (result.status === "paper_filled" && paperCtx && result.fill) {
    const applied = applyPaperFill(paperCtx.loaded.account, { symbol: o.symbol, side: o.side, quantity: result.fill.quantity, price: result.fill.price, fee: result.fill.fee });
    if (applied.ok) await savePaperAccount(userId, applied.account, { ...paperCtx.loaded.classes, [o.symbol]: o.assetClass });
  }
  if (result.status === "filled" && mode === "live") await refreshTraderStatus(userId);
  if (o.strategyId) {
    await db.from("nova_strategy_events").insert({
      strategy_id: o.strategyId, user_id: userId, kind: result.status === "filled" || result.status === "paper_filled" ? "filled" : result.status === "blocked" ? "blocked" : "order_" + result.status,
      message: result.message, detail: { mode, fill: result.fill ?? null, blockers: result.blockers ?? null, simulated: result.simulated },
    });
    if (result.status === "filled" || result.status === "paper_filled") await db.from("nova_strategies").update({ status: "executed" }).eq("id", o.strategyId).eq("user_id", userId);
  }
  if (result.status === "blocked") await notify(userId, "risk", `Order blocked: ${o.side} ${o.symbol}`, (result.blockers ?? []).slice(0, 3).join(" "));
  if (result.status === "filled") await notify(userId, "order", `Filled: ${o.side} ${o.symbol}`, `Confirmed by the broker at ${result.fill?.price}.`);
  if (result.status === "error") await securityEvent(userId, "order_unknown_outcome", { symbol: o.symbol, connectionId });
  return { ...result, unlock: unlockChecks };
}

/** Keeps the public trader record and open positions in step with broker-confirmed live fills only. */
async function refreshTraderStatus(userId: string) {
  const db = serviceDb();
  const { data } = await db.from("nova_order_audit").select("detail,created_at").eq("user_id", userId).eq("mode", "live").eq("event", "filled").order("id", { ascending: true }).limit(5000);
  const fills = (data ?? []) as { detail: { symbol: string; side: "buy" | "sell"; price: number; quantity: number; fee: number | null }; created_at: string }[];
  if (!fills.length) return;
  // FIFO-free, average-cost round trips per symbol.
  const book = new Map<string, { qty: number; cost: number }>();
  const closed: number[] = [];
  const equity: number[] = [0];
  for (const f of fills) {
    const d = f.detail;
    const b = book.get(d.symbol) ?? { qty: 0, cost: 0 };
    if (d.side === "buy") { b.qty += d.quantity; b.cost += d.quantity * d.price + (d.fee ?? 0); }
    else if (b.qty > 0) {
      const q = Math.min(b.qty, d.quantity), avg = b.cost / b.qty;
      const pnl = q * d.price - (d.fee ?? 0) - q * avg;
      closed.push(pnl); equity.push(equity[equity.length - 1] + pnl);
      b.qty -= q; b.cost -= q * avg;
    }
    book.set(d.symbol, b);
  }
  let peak = 0, maxDd = 0;
  for (const e of equity) { peak = Math.max(peak, e); if (peak > 0) maxDd = Math.max(maxDd, ((peak - e) / peak) * 100); }
  const first = new Date(fills[0].created_at).getTime();
  await db.from("nova_trader_stats").upsert({
    user_id: userId, record_source: "broker_verified", trades: closed.length, days: Math.floor((Date.now() - first) / 86_400_000),
    win_rate_pct: closed.length ? (closed.filter((p) => p > 0).length / closed.length) * 100 : null,
    max_drawdown_pct: closed.length ? maxDd : null, return_pct: null, computed_at: new Date().toISOString(),
  });
  await db.from("nova_trader_open_positions").delete().eq("user_id", userId);
  const open = [...book.entries()].filter(([, b]) => b.qty > 1e-12).map(([symbol, b]) => ({ user_id: userId, symbol, direction: "long", qty: b.qty }));
  if (open.length) await db.from("nova_trader_open_positions").insert(open);
}
