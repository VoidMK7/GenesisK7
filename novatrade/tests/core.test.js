const test = require("node:test");
const assert = require("node:assert/strict");
const B = "../.build/core";
const ind = require(`${B}/indicators`);
const { backtest, passesGate } = require(`${B}/backtest`);
const { runScenarios, mulberry32 } = require(`${B}/simulation`);
const risk = require(`${B}/risk`);
const exec = require(`${B}/execution`);
const { analyze } = require(`${B}/orchestrator`);
const { planCopyOrder } = require(`${B}/copy`);
const { runCopyEngine } = require(`${B}/engines/copy`);
const { runHybridEngine } = require(`${B}/engines/hybrid`);
const { buildConsensus } = require(`${B}/consensus`);

// deterministic synthetic candles (test fixtures only; never used by the app)
function synth(n, { drift = 0.0005, vol = 0.01, seed = 7, start = 100 } = {}) {
  const rng = mulberry32(seed);
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-9), u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const o = p;
    p = p * Math.exp(drift + vol * z);
    const h = Math.max(o, p) * (1 + 0.002 * rng());
    const l = Math.min(o, p) * (1 - 0.002 * rng());
    out.push({ t: i * 3600_000, o, h, l, c: p, v: 1000 });
  }
  return out;
}

test("sma / ema / rsi basic correctness", () => {
  assert.deepEqual(ind.sma([1, 2, 3, 4, 5], 3).slice(2), [2, 3, 4]);
  const e = ind.ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2);
  assert.ok(Math.abs(e[3] - 3) < 1e-9);
  const up = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(ind.rsi(up, 14)[29], 100);
  const down = Array.from({ length: 30 }, (_, i) => 30 - i);
  assert.equal(ind.rsi(down, 14)[29], 0);
});

test("atr positive and macd finite on long series", () => {
  const c = synth(200);
  const a = ind.atr(c, 14);
  assert.ok(a[199] > 0);
  const m = ind.macd(c.map((x) => x.c));
  assert.ok(Number.isFinite(m.hist[199]));
});

test("backtest has no look-ahead: buys at the NEXT open", () => {
  const c = synth(300, { drift: 0.002 });
  const r = backtest(c, { strategy: "sma_cross", params: { fast: 5, slow: 20 }, feeBps: 0, slippageBps: 0 });
  assert.ok(r.tradeCount > 0);
  const t = r.trades[0];
  assert.equal(t.entryPrice, c[t.entryIndex].o);
});

test("backtest fees reduce returns", () => {
  const c = synth(400, { drift: 0.001 });
  const free = backtest(c, { strategy: "sma_cross", feeBps: 0, slippageBps: 0 });
  const costly = backtest(c, { strategy: "sma_cross", feeBps: 50, slippageBps: 20 });
  assert.ok(costly.totalReturnPct < free.totalReturnPct);
});

test("gate rejects too few trades", () => {
  const c = synth(150);
  const r = backtest(c, { strategy: "sma_cross" });
  const g = passesGate({ ...r, tradeCount: 2 });
  assert.equal(g.pass, false);
});

test("simulation: 12 scenarios, deterministic, refuses thin data and bad levels", () => {
  const rets = ind.logReturns(synth(300).map((x) => x.c));
  const setup = { direction: "long", entry: 100, stop: 97, takeProfit: 106, horizonBars: 30 };
  const a = runScenarios(rets, setup, { seed: 5, paths: 200 });
  const b = runScenarios(rets, setup, { seed: 5, paths: 200 });
  assert.ok(a.ok);
  assert.equal(a.summary.scenarioCount, 12);
  assert.deepEqual(a.summary, b.summary);
  for (const s of a.summary.scenarios) {
    assert.ok(Math.abs(s.probTakeProfit + s.probStop + s.probTimeout - 1) < 1e-9);
  }
  assert.equal(runScenarios(rets.slice(0, 20), setup).ok, false);
  assert.equal(runScenarios(rets, { ...setup, stop: 105 }).ok, false);
});

test("simulation: stress scenarios are worse than baseline for a long", () => {
  const rets = ind.logReturns(synth(400, { drift: 0.0003 }).map((x) => x.c));
  const out = runScenarios(rets, { direction: "long", entry: 100, stop: 95, takeProfit: 110, horizonBars: 30 }, { paths: 600 });
  const by = Object.fromEntries(out.summary.scenarios.map((s) => [s.id, s]));
  assert.ok(by.liquidity_stress.expectedReturnPct < by.baseline.expectedReturnPct);
  assert.ok(by.bear_drift.expectedReturnPct < by.bull_drift.expectedReturnPct);
  assert.ok(by.gap_down.probStop > by.gap_up.probStop);
});

const limits = { requireStopLoss: true, maxOrderValue: 1000, maxPositionPct: 20, dailyLossLimit: 100, maxDrawdownPct: 15 };
const acct = { equity: 10000, peakEquity: 10000, dailyPnl: 0, weeklyPnl: 0, positions: [], emergencyStop: false };
const order = { symbol: "BTCUSD", side: "buy", quantity: 0.01, price: 50000, stopLoss: 48000 };

test("risk: allows a compliant order, blocks each violation", () => {
  assert.equal(risk.evaluateOrder({ ...order, quantity: 0.01 }, limits, acct).allowed, true);
  assert.equal(risk.evaluateOrder({ ...order, quantity: 0.1 }, limits, acct).allowed, false); // 5000 > 1000
  assert.equal(risk.evaluateOrder({ ...order, stopLoss: undefined }, limits, acct).allowed, false);
  assert.equal(risk.evaluateOrder({ ...order, stopLoss: 51000 }, limits, acct).allowed, false); // wrong side
  assert.equal(risk.evaluateOrder(order, limits, { ...acct, emergencyStop: true }).allowed, false);
  assert.equal(risk.evaluateOrder(order, limits, { ...acct, dailyPnl: -150 }).allowed, false);
  assert.equal(risk.evaluateOrder(order, limits, { ...acct, equity: 8000, peakEquity: 10000 }).allowed, false); // 20% dd
  assert.equal(risk.evaluateOrder(order, limits, { ...acct, equity: 0 }).allowed, false);
  assert.equal(risk.evaluateOrder({ ...order, quantity: -1 }, limits, acct).allowed, false);
});

test("risk: position cap counts existing holdings; reduce-only always allowed", () => {
  const held = { ...acct, positions: [{ symbol: "BTCUSD", value: 1800 }] };
  assert.equal(risk.evaluateOrder({ ...order, quantity: 0.01 }, { ...limits, maxOrderValue: 5000 }, held).allowed, false); // 2300 > 20%
  assert.equal(risk.evaluateOrder({ ...order, side: "sell", reduceOnly: true, stopLoss: undefined }, limits, { ...acct, emergencyStop: true }).allowed, true);
});

test("risk: unmeasurable rules are reported as unverified, not passed", () => {
  const d = risk.evaluateOrder({ ...order, correlationGroup: undefined }, { ...limits, maxConcentrationPct: 30 }, acct);
  assert.equal(d.unverified.length, 1);
});

test("risk: equity memory rolls day and week", () => {
  const a = risk.rollEquity(null, 1000, new Date("2026-11-02T10:00:00Z"));
  const b = risk.rollEquity(a.memory, 900, new Date("2026-11-02T20:00:00Z"));
  assert.equal(b.dailyPnl, -100);
  const c = risk.rollEquity(b.memory, 950, new Date("2026-11-03T01:00:00Z"));
  assert.equal(c.dailyPnl, 0);
  assert.equal(c.weeklyPnl, -50);
  assert.equal(c.memory.peakEquity, 1000);
});

test("live unlock needs all five conditions", () => {
  const full = {
    connection: { status: "connected", permissionsVerified: true, withdrawalPermission: false },
    limits: { requireStopLoss: true, maxOrderValue: 1, maxPositionPct: 1, dailyLossLimit: 1, maxDrawdownPct: 1 },
    userEnabledLive: true,
    executionTestPassedAt: "2026-11-07T00:00:00Z",
  };
  assert.equal(exec.checkLiveUnlock(full).unlocked, true);
  assert.equal(exec.checkLiveUnlock({ ...full, connection: null }).unlocked, false);
  assert.equal(exec.checkLiveUnlock({ ...full, connection: { ...full.connection, withdrawalPermission: true } }).unlocked, false);
  assert.equal(exec.checkLiveUnlock({ ...full, connection: { ...full.connection, withdrawalPermission: null } }).unlocked, false);
  assert.equal(exec.checkLiveUnlock({ ...full, limits: { requireStopLoss: true } }).unlocked, false);
  assert.equal(exec.checkLiveUnlock({ ...full, userEnabledLive: false }).unlocked, false);
  assert.equal(exec.checkLiveUnlock({ ...full, executionTestPassedAt: null }).unlocked, false);
});

function fakeConnector(over = {}) {
  const calls = { place: 0 };
  return {
    calls,
    id: "fake",
    capabilities: { assetClasses: ["crypto"], orderTypes: ["market", "limit"], stopLoss: true, takeProfit: true, modifyOrder: true, shorting: false, paperEnvironment: true },
    async placeOrder() { calls.place++; return over.placed ?? { brokerOrderId: "B1", status: "accepted" }; },
    async getOrder() { return over.polled ?? { brokerOrderId: "B1", status: "filled", filledQty: 0.01, avgPrice: 50010, fee: 0.5 }; },
  };
}
const req = (k = "key-12345678") => ({ symbol: "BTCUSD", side: "buy", type: "market", quantity: 0.01, referencePrice: 50000, stopLoss: 48000, idempotencyKey: k });
const ctx = (mode, extra = {}) => ({ userId: "u1", mode, limits, account: acct, liveUnlocked: true, connectorWithdrawalSafe: true, ...extra });
const deps = (store, connector) => ({ store, connector, paper: { feeBps: 10, slippageBps: 5 }, pollAttempts: 2, pollDelayMs: 0, sleep: async () => {} });

test("execution: analysis mode never creates an order", async () => {
  const s = new exec.MemoryOrderStore(); const c = fakeConnector();
  const r = await exec.submitOrder(deps(s, c), ctx("analysis"), req());
  assert.equal(r.status, "analysis_only");
  assert.equal(c.calls.place, 0);
});

test("execution: paper fill is labelled simulated and never touches the connector", async () => {
  const s = new exec.MemoryOrderStore(); const c = fakeConnector();
  const r = await exec.submitOrder(deps(s, c), ctx("paper"), req());
  assert.equal(r.status, "paper_filled");
  assert.equal(r.simulated, true);
  assert.ok(r.fill.price > 50000);
  assert.equal(c.calls.place, 0);
});

test("execution: risk engine blocks in paper and live, and is audited", async () => {
  const s = new exec.MemoryOrderStore(); const c = fakeConnector();
  const r = await exec.submitOrder(deps(s, c), ctx("live"), { ...req(), quantity: 1 });
  assert.equal(r.status, "blocked");
  assert.equal(c.calls.place, 0);
  assert.ok(s.entries.some((e) => e.event === "blocked_by_risk"));
});

test("execution: duplicate idempotency key does not place a second order", async () => {
  const s = new exec.MemoryOrderStore(); const c = fakeConnector();
  const first = await exec.submitOrder(deps(s, c), ctx("live"), req("same-key-1"));
  const second = await exec.submitOrder(deps(s, c), ctx("live"), req("same-key-1"));
  assert.equal(first.status, "filled");
  assert.equal(second.status, "duplicate");
  assert.equal(c.calls.place, 1);
});

test("execution: live is only 'filled' when the broker confirms", async () => {
  const s = new exec.MemoryOrderStore();
  const pending = fakeConnector({ polled: { brokerOrderId: "B1", status: "accepted" } });
  const r1 = await exec.submitOrder(deps(s, pending), ctx("live"), req("k-pending-1"));
  assert.equal(r1.status, "pending_confirmation");
  assert.equal(r1.fill, undefined);
  const ok = fakeConnector();
  const r2 = await exec.submitOrder(deps(s, ok), ctx("live"), req("k-filled-01"));
  assert.equal(r2.status, "filled");
  assert.equal(r2.fill.price, 50010);
});

test("execution: live is refused unless every gate holds", async () => {
  const s = new exec.MemoryOrderStore(); const c = fakeConnector();
  assert.equal((await exec.submitOrder(deps(s, c), ctx("live", { liveUnlocked: false }), req("k-locked-01"))).status, "blocked");
  assert.equal((await exec.submitOrder(deps(s, c), ctx("live", { connectorWithdrawalSafe: false }), req("k-wd-000001"))).status, "blocked");
  assert.equal((await exec.submitOrder(deps(s, undefined), ctx("live"), req("k-noconn-01"))).status, "blocked");
  const noStop = fakeConnector(); noStop.capabilities.stopLoss = false;
  assert.equal((await exec.submitOrder(deps(s, noStop), ctx("live"), req("k-nostop-01"))).status, "blocked");
  assert.equal(c.calls.place, 0);
});

test("execution: a thrown broker error is reported as unknown outcome, not success", async () => {
  const s = new exec.MemoryOrderStore();
  const c = fakeConnector(); c.placeOrder = async () => { throw new Error("timeout"); };
  const r = await exec.submitOrder(deps(s, c), ctx("live"), req("k-throw-001"));
  assert.equal(r.status, "error");
  assert.match(r.message, /may or may not exist/);
});

test("execution: short idempotency key is rejected", async () => {
  const s = new exec.MemoryOrderStore();
  assert.equal((await exec.submitOrder(deps(s), ctx("paper"), req("x"))).status, "rejected");
});

test("copy planner scales to allocation, caps trade size, adds a stop to buys, sells only reduce", () => {
  const sub = { allocation: 5000, maxTradePct: 10, stopLossPct: 5 };
  const p = planCopyOrder({ symbol: "X", side: "buy", quantity: 1000, price: 100, leaderEquity: 100000 }, sub);
  assert.equal(p.copy, true);
  assert.equal(p.capped, true);
  assert.ok(Math.abs(p.notional - 500) < 1e-9);
  assert.ok(Math.abs(p.stopLoss - 95) < 1e-9);
  assert.equal(p.reduceOnly, false);
  const sell = planCopyOrder({ symbol: "X", side: "sell", quantity: 1, price: 100, leaderEquity: 100000 }, sub);
  assert.equal(sell.reduceOnly, true);
  assert.equal(sell.stopLoss, undefined);
  assert.equal(planCopyOrder({ symbol: "X", side: "buy", quantity: 0, price: 100, leaderEquity: 1 }, sub).copy, false);
});

test("copy engine ignores self-reported and thin records", () => {
  const traders = [
    { traderId: "a", name: "A", source: "self_reported", trades: 500, days: 400, winRatePct: 90, maxDrawdownPct: 5, returnPct: 300, openPositions: [{ symbol: "X", direction: "long" }] },
    { traderId: "b", name: "B", source: "broker_verified", trades: 10, days: 20, winRatePct: 80, maxDrawdownPct: 5, returnPct: 20, openPositions: [{ symbol: "X", direction: "long" }] },
  ];
  const s = runCopyEngine("X", traders);
  assert.equal(s.confidence, null);
  assert.equal(runCopyEngine("X", undefined).confidence, null);
  const good = [{ traderId: "c", name: "C", source: "broker_verified", trades: 80, days: 200, winRatePct: 55, maxDrawdownPct: 12, returnPct: 40, openPositions: [{ symbol: "X", direction: "long" }] }];
  assert.equal(runCopyEngine("X", good).direction, "long");
});

test("hybrid refuses to invent a view from fewer than two inputs", () => {
  const none = { engine: "copy", symbol: "X", direction: "neutral", confidence: null, uncertainty: null, confidenceBasis: "", rationale: [], missing: ["x"], invalidation: [] };
  assert.equal(runHybridEngine("X", [none]).confidence, null);
});

test("orchestrator: with no data every engine says so and consensus is insufficient", () => {
  const r = analyze({ symbol: "X", market: "crypto", interval: "1h", candles: [] });
  assert.equal(r.signals.length, 4);
  assert.equal(r.consensus.agreement.level, "insufficient");
  assert.equal(r.consensus.combined.direction, null);
  assert.ok(r.consensus.missingEngines.length >= 3);
});

test("orchestrator: on a long uptrend produces proposals with simulations and disclaimers", () => {
  const candles = synth(500, { drift: 0.0015, vol: 0.006 });
  const r = analyze({ symbol: "X", market: "crypto", interval: "1h", candles });
  const auto = r.signals.find((s) => s.engine === "autonomous");
  if (auto.strategy) {
    assert.equal(auto.strategy.simulation.scenarioCount, 12);
    assert.match(auto.strategy.disclaimer, /not forecasts/);
    assert.ok(auto.strategy.stopLoss < auto.strategy.entry.price);
  }
  assert.match(r.disclaimer, /risk of loss/);
  for (const s of r.signals) {
    if (s.confidence !== null) assert.ok(s.confidence >= 0 && s.confidence <= 1);
  }
});

test("consensus flags conflicts instead of averaging them away", () => {
  const mk = (engine, direction) => ({ engine, symbol: "X", direction, confidence: 0.6, uncertainty: 0.3, confidenceBasis: "", rationale: [], missing: [], invalidation: [] });
  const c = buildConsensus("X", [mk("copy", "long"), mk("algo", "short"), mk("autonomous", "neutral")]);
  assert.equal(c.agreement.level, "split");
  assert.equal(c.combined.direction, null);
  assert.ok(c.conflicts.length >= 1);
});
