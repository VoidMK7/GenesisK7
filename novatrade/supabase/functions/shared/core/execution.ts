import type { ExecutionMode, Side } from "./types.ts";
import { evaluateOrder, missingLiveLimits, type AccountState, type RiskDecision, type RiskLimits } from "./risk.ts";
import type { BrokerConnector, PlacedOrder } from "./connectors/types.ts";

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  referencePrice: number; // latest known price, used for risk checks and paper fills
  reduceOnly?: boolean;
  engine?: "copy" | "algo" | "autonomous" | "hybrid";
  idempotencyKey: string;
  correlationGroup?: string;
  avgDailyVolumeValue?: number;
  /** Free-form context recorded with the fill (account equity, strategy id, copy source...). */
  meta?: Record<string, unknown>;
}

export type AuditEvent =
  | "analysis_only"
  | "submitted"
  | "accepted"
  | "rejected"
  | "modified"
  | "cancelled"
  | "filled"
  | "blocked_by_risk"
  | "blocked_by_gate";

export interface AuditEntry {
  userId: string;
  mode: ExecutionMode;
  engine?: string;
  idempotencyKey: string;
  event: AuditEvent;
  brokerOrderId?: string;
  detail: Record<string, unknown>;
}

export type ExecutionStatus =
  | "analysis_only"
  | "blocked"
  | "paper_filled"
  | "paper_open"
  | "rejected"
  | "pending_confirmation"
  | "filled"
  | "error"
  | "duplicate";

export interface ExecutionResult {
  status: ExecutionStatus;
  mode: ExecutionMode;
  message: string;
  simulated: boolean;
  brokerOrderId?: string;
  fill?: { price: number; quantity: number; fee: number };
  risk?: RiskDecision;
  blockers?: string[];
}

export interface OrderStore {
  /** Atomically claims a key. Returns false if it was already claimed. */
  claim(userId: string, key: string): Promise<{ fresh: boolean; existing?: ExecutionResult }>;
  complete(userId: string, key: string, result: ExecutionResult): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface LiveUnlockInput {
  connection: { status: string; permissionsVerified: boolean; withdrawalPermission: boolean | null } | null;
  limits: RiskLimits;
  userEnabledLive: boolean;
  executionTestPassedAt: string | null;
}

export interface UnlockCheck {
  id: string;
  label: string;
  met: boolean;
  detail?: string;
}

export function checkLiveUnlock(i: LiveUnlockInput): { unlocked: boolean; checks: UnlockCheck[] } {
  const missing = missingLiveLimits(i.limits);
  const checks: UnlockCheck[] = [
    {
      id: "connection",
      label: "A valid broker or exchange connection exists",
      met: Boolean(i.connection && i.connection.status === "connected"),
    },
    {
      id: "permissions",
      label: "Required trading permissions are verified (and no withdrawal permission)",
      met: Boolean(i.connection && i.connection.permissionsVerified && i.connection.withdrawalPermission === false),
      detail: i.connection?.withdrawalPermission === true ? "This key can withdraw funds. Create a trade-only key." : undefined,
    },
    {
      id: "risk",
      label: "Risk controls are configured",
      met: missing.length === 0,
      detail: missing.length ? `Missing: ${missing.join(", ")}` : undefined,
    },
    { id: "enabled", label: "You explicitly enabled live trading", met: i.userEnabledLive },
    { id: "test", label: "A successful execution test has completed", met: Boolean(i.executionTestPassedAt) },
  ];
  return { unlocked: checks.every((c) => c.met), checks };
}

export interface PipelineDeps {
  store: OrderStore;
  /** Resolve the user's connector. Only called in live mode. */
  connector?: BrokerConnector;
  paper: { feeBps: number; slippageBps: number };
  /** Poll attempts for broker confirmation after placing a live order. */
  pollAttempts?: number;
  pollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PipelineContext {
  userId: string;
  mode: ExecutionMode;
  limits: RiskLimits;
  account: AccountState;
  liveUnlocked: boolean;
  /** Pre-trade validated cap on connector abilities. */
  connectorWithdrawalSafe: boolean;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function submitOrder(deps: PipelineDeps, ctx: PipelineContext, req: OrderRequest): Promise<ExecutionResult> {
  const base = { userId: ctx.userId, mode: ctx.mode, engine: req.engine, idempotencyKey: req.idempotencyKey };

  if (!req.idempotencyKey || req.idempotencyKey.length < 8) {
    return { status: "rejected", mode: ctx.mode, simulated: ctx.mode !== "live", message: "An idempotency key of at least 8 characters is required." };
  }

  // 1. Idempotency: never process the same key twice.
  const claim = await deps.store.claim(ctx.userId, req.idempotencyKey);
  if (!claim.fresh) {
    return { ...(claim.existing ?? { status: "duplicate" as const, mode: ctx.mode, simulated: ctx.mode !== "live", message: "" }), status: "duplicate", message: "This order was already processed. No new order was created." };
  }

  const finish = async (r: ExecutionResult) => {
    await deps.store.complete(ctx.userId, req.idempotencyKey, r);
    return r;
  };

  // 2. Analysis only: nothing is ever sent anywhere.
  if (ctx.mode === "analysis") {
    await deps.store.audit({ ...base, event: "analysis_only", detail: { request: redact(req) } });
    return finish({ status: "analysis_only", mode: "analysis", simulated: true, message: "Analysis Only mode: no order was created. Switch to Paper to simulate." });
  }

  // 3. Independent risk engine runs for every engine and every mode that creates orders.
  const risk = evaluateOrder(
    {
      symbol: req.symbol, side: req.side, quantity: req.quantity, price: req.limitPrice ?? req.referencePrice,
      stopLoss: req.stopLoss, leverage: req.leverage, reduceOnly: req.reduceOnly,
      correlationGroup: req.correlationGroup, avgDailyVolumeValue: req.avgDailyVolumeValue,
    },
    ctx.limits,
    ctx.account,
  );
  if (!risk.allowed) {
    await deps.store.audit({ ...base, event: "blocked_by_risk", detail: { symbol: req.symbol, side: req.side, violations: risk.violations } });
    return finish({ status: "blocked", mode: ctx.mode, simulated: ctx.mode !== "live", risk, message: "Blocked by the risk engine.", blockers: risk.violations.map((v) => v.message) });
  }

  // 4. Paper: simulated fill, clearly labelled.
  if (ctx.mode === "paper") {
    const slip = deps.paper.slippageBps / 1e4;
    const marketable =
      req.type === "market" ||
      (req.limitPrice !== undefined && (req.side === "buy" ? req.limitPrice >= req.referencePrice : req.limitPrice <= req.referencePrice));
    if (!marketable) {
      await deps.store.audit({ ...base, event: "accepted", detail: { simulated: true, resting: true } });
      return finish({ status: "paper_open", mode: "paper", simulated: true, risk, message: "Simulated limit order is resting (not filled). No real funds are involved." });
    }
    const px = req.referencePrice * (req.side === "buy" ? 1 + slip : 1 - slip);
    const fee = px * req.quantity * (deps.paper.feeBps / 1e4);
    await deps.store.audit({ ...base, event: "submitted", detail: { simulated: true } });
    await deps.store.audit({ ...base, event: "filled", detail: { simulated: true, symbol: req.symbol, side: req.side, price: px, quantity: req.quantity, fee, meta: req.meta ?? null } });
    return finish({ status: "paper_filled", mode: "paper", simulated: true, risk, fill: { price: px, quantity: req.quantity, fee }, message: "Simulated fill. No real funds were used." });
  }

  // 5. Live: every gate must hold. Refuse rather than guess.
  const blockers: string[] = [];
  if (!ctx.liveUnlocked) blockers.push("Live trading is not unlocked for this account.");
  if (!deps.connector) blockers.push("No connector is available for this account.");
  if (!ctx.connectorWithdrawalSafe) blockers.push("The connection is not verified as withdrawal-free.");
  if (risk.unverified.length) blockers.push(...risk.unverified.map((u) => `Cannot verify ${u.rule}: ${u.reason}`));
  if (deps.connector && ctx.limits.requireStopLoss) {
    if (!deps.connector.capabilities.stopLoss) blockers.push("This connector cannot attach a protective stop to the order, and your settings require one.");
    if (req.takeProfit !== undefined && !deps.connector.capabilities.takeProfit) blockers.push("This connector cannot attach a take-profit.");
  }
  if (deps.connector && !deps.connector.capabilities.orderTypes.includes(req.type)) blockers.push(`This connector does not support ${req.type} orders.`);
  if (blockers.length) {
    await deps.store.audit({ ...base, event: "blocked_by_gate", detail: { symbol: req.symbol, side: req.side, blockers } });
    return finish({ status: "blocked", mode: "live", simulated: false, risk, blockers, message: "Live order blocked before submission." });
  }

  const connector = deps.connector!;
  await deps.store.audit({ ...base, event: "submitted", detail: { request: redact(req) } });

  let placed: PlacedOrder;
  try {
    placed = await connector.placeOrder({
      symbol: req.symbol, side: req.side, type: req.type, quantity: req.quantity,
      limitPrice: req.limitPrice, stopLoss: req.stopLoss, takeProfit: req.takeProfit,
      clientOrderId: req.idempotencyKey,
    });
  } catch (e) {
    // Unknown outcome: the order may or may not exist. Never retry blindly.
    await deps.store.audit({ ...base, event: "rejected", detail: { error: e instanceof Error ? e.message : String(e), outcomeUnknown: true } });
    return finish({ status: "error", mode: "live", simulated: false, risk, message: "The broker did not confirm this order. It may or may not exist. Check your broker account before trying again." });
  }

  if (placed.status === "rejected") {
    await deps.store.audit({ ...base, event: "rejected", brokerOrderId: placed.brokerOrderId, detail: { reason: placed.reason } });
    return finish({ status: "rejected", mode: "live", simulated: false, risk, brokerOrderId: placed.brokerOrderId, message: `Rejected by the broker${placed.reason ? `: ${placed.reason}` : "."}` });
  }

  await deps.store.audit({ ...base, event: "accepted", brokerOrderId: placed.brokerOrderId, detail: { status: placed.status } });

  // Poll for confirmation. Only a broker-reported fill counts as executed.
  const sleep = deps.sleep ?? sleepDefault;
  let latest = placed;
  for (let i = 0; i < (deps.pollAttempts ?? 0) && latest.status !== "filled" && latest.status !== "rejected" && latest.status !== "cancelled"; i++) {
    await sleep(deps.pollDelayMs ?? 500);
    try { latest = await connector.getOrder(placed.brokerOrderId, req.symbol); } catch { break; }
  }

  if (latest.status === "filled" && latest.filledQty !== undefined && latest.avgPrice !== undefined) {
    await deps.store.audit({ ...base, event: "filled", brokerOrderId: placed.brokerOrderId, detail: { simulated: false, symbol: req.symbol, side: req.side, price: latest.avgPrice, quantity: latest.filledQty, fee: latest.fee ?? null, meta: req.meta ?? null } });
    return finish({ status: "filled", mode: "live", simulated: false, risk, brokerOrderId: placed.brokerOrderId, fill: { price: latest.avgPrice, quantity: latest.filledQty, fee: latest.fee ?? 0 }, message: "Filled. Confirmed by the broker." });
  }
  if (latest.status === "rejected" || latest.status === "cancelled") {
    await deps.store.audit({ ...base, event: latest.status === "rejected" ? "rejected" : "cancelled", brokerOrderId: placed.brokerOrderId, detail: { reason: latest.reason } });
    return finish({ status: "rejected", mode: "live", simulated: false, risk, brokerOrderId: placed.brokerOrderId, message: `Order ${latest.status} by the broker.` });
  }
  return finish({ status: "pending_confirmation", mode: "live", simulated: false, risk, brokerOrderId: placed.brokerOrderId, message: "Accepted by the broker but not yet confirmed as filled. It will not be treated as executed until the broker confirms." });
}

function redact(r: OrderRequest) {
  const { idempotencyKey: _k, ...rest } = r;
  return rest;
}

/** In-memory store used for tests and local development. */
export class MemoryOrderStore implements OrderStore {
  readonly entries: AuditEntry[] = [];
  private keys = new Map<string, ExecutionResult | null>();
  async claim(userId: string, key: string) {
    const k = `${userId}:${key}`;
    if (this.keys.has(k)) return { fresh: false, existing: this.keys.get(k) ?? undefined };
    this.keys.set(k, null);
    return { fresh: true };
  }
  async complete(userId: string, key: string, result: ExecutionResult) {
    this.keys.set(`${userId}:${key}`, result);
  }
  async audit(entry: AuditEntry) {
    this.entries.push(entry);
  }
}
