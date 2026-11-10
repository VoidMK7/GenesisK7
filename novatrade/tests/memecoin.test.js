const test = require("node:test"); const assert = require("node:assert/strict");
const M = require("../.build/core/memecoin/index.js");

const raw = (o = {}) => ({ chainId: "solana", dexId: "pumpswap", url: "https://dexscreener.com/solana/x", pairAddress: "PAIR", baseToken: { address: "MintAAAA", name: "Pepe Two", symbol: "PEPE2" },
  priceUsd: "0.0123", txns: { h24: { buys: 900, sells: 700 }, h1: { buys: 60, sells: 40 } }, volume: { h24: 240000 }, priceChange: { m5: 1, h1: 12, h6: 30, h24: 80 },
  liquidity: { usd: 60000 }, fdv: 900000, pairCreatedAt: Date.now() - 5 * 3600_000, info: { imageUrl: "https://cdn.dexscreener.com/x.png", socials: [{ type: "twitter", url: "https://x.com/p" }], websites: [{ url: "https://p.fun" }] }, ...o });

test("normalizeDexPair keeps real data and rejects incomplete pairs", () => {
  const p = M.normalizeDexPair(raw());
  assert.equal(p.symbol, "PEPE2"); assert.equal(p.priceUsd, 0.0123); assert.equal(p.liquidityUsd, 60000); assert.equal(p.imageUrl, "https://cdn.dexscreener.com/x.png");
  assert.ok(p.ageMinutes >= 299 && p.ageMinutes <= 301); assert.equal(p.socials.twitter, "https://x.com/p");
  assert.equal(M.normalizeDexPair(raw({ priceUsd: undefined })), null);
  assert.equal(M.normalizeDexPair(raw({ chainId: "dogechain" })), null);
  assert.equal(M.normalizeDexPair(raw({ info: { imageUrl: "http://insecure/x.png" } })).imageUrl, undefined);
});
test("bestPairs keeps the deepest pool per token", () => {
  const r = M.bestPairs([raw({ pairAddress: "small", liquidity: { usd: 100 } }), raw({ pairAddress: "big", liquidity: { usd: 99999 } })]);
  assert.equal(r.length, 1); assert.equal(r[0].pairAddress, "big");
});
test("rugScore flags a honeypot-looking token and a clean one differently", () => {
  const clean = M.rugScore(M.normalizeDexPair(raw()));
  assert.ok(clean.score >= 90, String(clean.score)); assert.ok(clean.notChecked.includes("contract code"));
  const bad = M.rugScore(M.normalizeDexPair(raw({ liquidity: { usd: 3000 }, txns: { h24: { buys: 400, sells: 0 }, h1: {} }, info: {} })));
  assert.ok(bad.score < 35, String(bad.score)); assert.ok(bad.flags.some((f) => /honeypot/.test(f)));
});
test("rugScore uses contract facts when given and says what it checked", () => {
  const p = M.normalizeDexPair(raw());
  const r = M.rugScore(p, { mintAuthorityRenounced: false, top10HoldersPct: 62, source: "rugcheck" });
  assert.ok(r.score <= 60); assert.equal(r.notChecked.length, 0); assert.ok(r.flags.some((f) => /Mint authority/.test(f)));
});
test("compileRules understands unambiguous rules and leaves the rest advisory", () => {
  const c = M.compileRules([
    { id: "1", kind: "avoid", text: "Never buy tokens under 1 hour old" }, { id: "2", kind: "avoid", text: "avoid $SCAM" },
    { id: "3", kind: "limit", text: "liquidity over 40k" }, { id: "4", kind: "prefer", text: "I like dog themed coins" }, { id: "5", kind: "limit", text: "market cap under 2m" },
  ]);
  assert.equal(c.minAgeMinutes, 60); assert.deepEqual(c.blockSymbols, ["SCAM"]); assert.equal(c.minLiquidityUsd, 40000); assert.equal(c.maxFdvUsd, 2e6);
  assert.equal(c.advisory.length, 1); assert.equal(c.advisory[0].id, "4");
  assert.ok(!c.blockSymbols.includes("TOKENS"));
});
test("parseStrategyPrompt extracts stated numbers only", () => {
  const { patch, understood } = M.parseStrategyPrompt("Solana only, liquidity over 30k, take profit 3x, stop loss 15%, trailing 10%, max 4 positions, $25 per trade");
  assert.equal(patch.minLiquidityUsd, 30000); assert.equal(patch.takeProfitPct, 200); assert.equal(patch.stopLossPct, 15); assert.equal(patch.trailingStopPct, 10);
  assert.equal(patch.maxOpenPositions, 4); assert.equal(patch.positionUsd, 25); assert.deepEqual(patch.chains, ["solana"]); assert.ok(understood.length >= 7);
  assert.deepEqual(M.parseStrategyPrompt("buy things that go up").patch, {});
});
test("evaluateToken buys a qualifying token with reasons, and skips with the failing numbers", () => {
  const s = { ...M.DEFAULT_STRATEGY, enabled: true }; const rules = M.compileRules([]);
  const d = M.evaluateToken(M.normalizeDexPair(raw()), s, rules, { openAddresses: new Set() });
  assert.equal(d.action, "buy"); assert.ok(d.reasons.length >= 5); assert.equal(d.metrics.liquidityUsd, 60000);
  const skip = M.evaluateToken(M.normalizeDexPair(raw({ liquidity: { usd: 8000 } })), s, rules, { openAddresses: new Set() });
  assert.equal(skip.action, "skip"); assert.ok(skip.failed.some((f) => /Liquidity \$8,000 is below/.test(f)));
  const held = M.evaluateToken(M.normalizeDexPair(raw()), s, rules, { openAddresses: new Set(["MintAAAA"]) });
  assert.ok(held.failed.includes("Already holding this token"));
  const blocked = M.evaluateToken(M.normalizeDexPair(raw()), s, M.compileRules([{ id: "9", kind: "avoid", text: "avoid PEPE2" }]), { openAddresses: new Set() });
  assert.equal(blocked.action, "skip"); assert.deepEqual(blocked.rulesApplied, ["Avoid PEPE2"]);
});
test("tickPosition: hard stop, take profit, trailing arms only after a gain", () => {
  const pos = { entryPrice: 1, peakPrice: 1, stopLossPct: 25, trailingStopPct: 20, takeProfitPct: 100 };
  assert.equal(M.tickPosition(pos, 0.7).exit.reason, "stop_loss");
  assert.equal(M.tickPosition(pos, 2.1).exit.reason, "take_profit");
  assert.equal(M.tickPosition(pos, 0.9).exit, null);                    // below entry but above the stop, peak never exceeded entry: trailing not armed
  const run = M.tickPosition(pos, 1.6); assert.equal(run.exit, null); assert.equal(run.peak, 1.6);
  const after = M.tickPosition({ ...pos, peakPrice: 1.6 }, 1.27); assert.equal(after.exit.reason, "trailing_stop"); assert.ok(Math.abs(after.exit.trigger - 1.28) < 1e-9);
  assert.ok(Math.abs(M.activeStopLine({ ...pos, peakPrice: 1.6 }) - 1.28) < 1e-9); assert.equal(M.activeStopLine(pos), 0.75);
  assert.ok(Math.abs(M.activeStopLine({ ...pos, peakPrice: 1.1 }) - 0.88) < 1e-9);
});
test("paper fills model slippage and fees against the user", () => {
  const b = M.paperBuy(1, 100, 300); assert.ok(b.fillPrice > 1); assert.ok(Math.abs(b.qty * b.fillPrice + b.feeUsd - 100) < 1e-9);
  const s = M.paperSell(1, 10, 300); assert.ok(s.proceedsUsd < 10);
});
test("allocationBudget: never above balance, zero when unknown or off", () => {
  const a = { enabled: true, mode: "percent", percent: 25, maxOpenPositions: 5 };
  assert.equal(M.allocationBudget(400, a).budgetUsd, 100);
  assert.equal(M.allocationBudget(null, a).budgetUsd, 0);
  assert.equal(M.allocationBudget(400, { ...a, enabled: false }).budgetUsd, 0);
  assert.equal(M.allocationBudget(50, { ...a, mode: "fixed", amountUsd: 500 }).budgetUsd, 50);
});
test("riskGate enforces count, budget, daily loss, per-trade cap", () => {
  const strategy = { ...M.DEFAULT_STRATEGY, maxOpenPositions: 2, dailyLossLimitUsd: 30 };
  const base = { strategy, openCount: 0, openCostUsd: 0, budgetUsd: 200, realisedLossTodayUsd: 0, wantUsd: 50 };
  assert.deepEqual(M.riskGate(base), { ok: true, sizeUsd: 50, blockers: [] });
  assert.equal(M.riskGate({ ...base, maxPerTradeUsd: 20 }).sizeUsd, 20);
  assert.ok(M.riskGate({ ...base, openCount: 2 }).blockers[0].includes("open positions"));
  assert.equal(M.riskGate({ ...base, openCostUsd: 180 }).sizeUsd, 20);
  assert.ok(M.riskGate({ ...base, openCostUsd: 200 }).blockers[0].includes("No budget"));
  assert.ok(M.riskGate({ ...base, realisedLossTodayUsd: 31 }).blockers[0].includes("Daily loss"));
});
test("wallet address validation", () => {
  assert.ok(M.validateAddress("solana", "So11111111111111111111111111111111111111112"));
  assert.ok(!M.validateAddress("solana", "0x" + "a".repeat(40))); assert.ok(M.validateAddress("base", "0x" + "aB".repeat(20)));
  assert.ok(!M.validateAddress("base", "0x123"));
});

const OWNER = "OwnerWallet1111111111111111111111111111111111";
const swapTx = (o) => ({ blockTime: 1_700_000_000, transaction: { signatures: ["sigX"], message: { accountKeys: [{ pubkey: OWNER }, { pubkey: "other" }] } },
  meta: { err: null, fee: 5000, preBalances: [5e9, 1e9], postBalances: [3.9999e9 - 0, 2e9], preTokenBalances: [], postTokenBalances: [{ owner: OWNER, mint: "MintAAAA", uiTokenAmount: { uiAmount: 1000000 } }], ...o } });
test("parseSolanaSwap detects a buy and a sell, ignores transfers and failed txs", () => {
  const buy = M.parseSolanaSwap(swapTx({}), OWNER);
  assert.equal(buy.side, "buy"); assert.equal(buy.mint, "MintAAAA"); assert.equal(buy.quote, "SOL"); assert.ok(Math.abs(buy.quoteAmount - 1.0001) < 0.001); assert.equal(buy.signature, "sigX");
  const sell = M.parseSolanaSwap(swapTx({ preBalances: [3e9, 1e9], postBalances: [4e9, 0], preTokenBalances: [{ owner: OWNER, mint: "MintAAAA", uiTokenAmount: { uiAmount: 500 } }], postTokenBalances: [] }), OWNER);
  assert.equal(sell.side, "sell"); assert.equal(sell.tokenAmount, 500);
  assert.equal(M.parseSolanaSwap(swapTx({ preBalances: [5e9, 1e9], postBalances: [5e9, 1e9] }), OWNER), null);   // token arrived, no SOL left: transfer
  assert.equal(M.parseSolanaSwap(swapTx({ err: { InstructionError: 1 } }), OWNER), null);
  assert.equal(M.parseSolanaSwap(swapTx({}), "NotInTx"), null);
});
test("rankTraders qualifies only on real, fresh, sufficient numbers", () => {
  const now = Date.now(); const iso = (h) => new Date(now - h * 3600_000).toISOString();
  const rows = [
    { id: "a", platform: "fomo", handle: "a", walletAddress: "W1", stats: { trades: 120, winRatePct: 64, pnlUsd: 80000 }, fetchedAt: iso(2) },
    { id: "b", platform: "fomo", handle: "b", walletAddress: "W2", stats: { trades: 10, winRatePct: 90, pnlUsd: 99999 }, fetchedAt: iso(2) },
    { id: "c", platform: "x", handle: "c", walletAddress: null, stats: { trades: 500, winRatePct: 70, pnlUsd: 1e6 }, fetchedAt: iso(2) },
    { id: "d", platform: "x", handle: "d", walletAddress: "W4", stats: { trades: 500, winRatePct: 70, pnlUsd: 1e6 }, fetchedAt: iso(100) },
    { id: "e", platform: "x", handle: "e", walletAddress: "W5", stats: {}, fetchedAt: iso(1) },
  ];
  const r = M.rankTraders(rows, M.DEFAULT_FOLLOW, now);
  assert.deepEqual(r.filter((x) => x.qualifies).map((x) => x.trader.id), ["a"]);
  assert.ok(r.find((x) => x.trader.id === "b").why[0].includes("10 trades")); assert.ok(r.find((x) => x.trader.id === "c").why[0].includes("No wallet"));
  assert.ok(r.find((x) => x.trader.id === "d").why[0].includes("100h")); assert.ok(r.find((x) => x.trader.id === "e").why.length >= 3);
  const p = M.pickFollows(r, { ...M.DEFAULT_FOLLOW, maxFollowed: 1 }, new Set(["d"]));
  assert.deepEqual(p.add.map((x) => x.trader.id), ["a"]); assert.deepEqual(p.drop.map((x) => x.trader.id), ["d"]);
});
test("planBatch is time-boxed and fair (stalest first)", () => {
  const t = [{ walletId: "1", lastCheckedAt: "2026-01-01T00:00:10Z" }, { walletId: "2", lastCheckedAt: null }, { walletId: "3", lastCheckedAt: "2026-01-01T00:00:01Z" }];
  assert.deepEqual(M.planBatch(t, 5000, 2000).map((x) => x.walletId), ["2", "3"]);
  assert.equal(M.planBatch(t, 100, 2000).length, 1);
  assert.equal(M.planBatch(t, 1e9, 1, 2).length, 2);
});
