const test = require("node:test"); const assert = require("node:assert/strict");
const S = require("../.build/core/memecoin/survival.js");
const pair = (o = {}) => ({ chain: "solana", tokenAddress: "M", pairAddress: "P", symbol: "T", name: "T", dex: "raydium", priceUsd: 1, liquidityUsd: 50000, volume24hUsd: 100000, ageMinutes: 20, buys24h: 300, sells24h: 200, buys1h: 60, sells1h: 30, change: { h1: 5, h6: 10, h24: 20 }, socials: {}, ...o });
const clean = { mintAuthorityRenounced: true, freezeAuthorityRenounced: true, top10HoldersPct: 20, source: "t" };

test("goal plan tells the truth about extreme targets", () => {
  const a = S.goalPlan({ startUsd: 10, targetUsd: 1000, days: 30 }); assert.equal(a.verdict, "unrealistic"); assert.ok(a.requiredDailyPct > 15);
  assert.equal(S.goalPlan({ startUsd: 100, targetUsd: 110, days: 30 }).verdict, "realistic");
  assert.equal(S.goalPlan({ startUsd: 0, targetUsd: 10, days: 5 }).verdict, "invalid");
  assert.equal(S.goalPlan({ startUsd: 100, targetUsd: 100, days: 5 }).verdict, "realistic");
});

test("survival: normal, cautious, cooldown, preserve", () => {
  const now = 1e12;
  assert.equal(S.survivalStatus({ startUsd: 100, closedPnlUsd: [], now }).mode, "normal");
  const c = S.survivalStatus({ startUsd: 100, closedPnlUsd: [10, -9], now }); assert.equal(c.mode, "cautious"); assert.equal(c.sizeMultiplier, 0.5);
  const cd = S.survivalStatus({ startUsd: 100, closedPnlUsd: [2, -1, -1, -1], lastClosedAt: now - 60_000, now }); assert.equal(cd.mode, "cooldown"); assert.equal(cd.allowEntries, false);
  const after = S.survivalStatus({ startUsd: 100, closedPnlUsd: [2, -1, -1, -1], lastClosedAt: now - 3600_000, now }); assert.notEqual(after.mode, "cooldown");
  const p = S.survivalStatus({ startUsd: 100, closedPnlUsd: [-25], now }); assert.equal(p.mode, "preserve"); assert.equal(p.allowEntries, false);
  assert.equal(S.survivalStatus({ startUsd: 100, closedPnlUsd: [20, -25], now }).mode, "preserve");      // 20.8% off the peak
  assert.equal(S.entrySize(10, p, 5), 0); assert.equal(S.entrySize(10, c, 3), 3); assert.equal(S.entrySize(10, S.survivalStatus({ startUsd: 100, closedPnlUsd: [], now }), 25), 10);
});

test("a loss never makes the next entry bigger", () => {
  const now = 1e12; const before = S.survivalStatus({ startUsd: 100, closedPnlUsd: [], now }), after = S.survivalStatus({ startUsd: 100, closedPnlUsd: [-9], now });
  assert.ok(S.entrySize(10, after, 50) <= S.entrySize(10, before, 50));
});

test("momentum score ranks stronger flow higher and punishes extreme pumps", () => {
  const strong = S.momentumScore(pair()), weak = S.momentumScore(pair({ buys1h: 10, sells1h: 60, change: { h1: -20, h6: -30 } }));
  assert.ok(strong > weak + 15); const pumped = S.momentumScore(pair({ change: { h1: 300, h6: 400 } })); assert.ok(pumped < S.momentumScore(pair({ change: { h1: 40, h6: 60 } })));
  for (const v of [strong, weak, pumped]) assert.ok(v >= 0 && v <= 100);
});

test("researcher: unknown counts against a coin, active authorities fail it", () => {
  const good = S.researchCoin({ pair: pair({ socials: { website: "x" } }), facts: clean, holders: 2000, devPct: 2, organicScore: 70 });
  const blind = S.researchCoin({ pair: pair(), facts: undefined }); assert.ok(good.score > blind.score + 20); assert.ok(blind.unknown.length >= 3); assert.equal(good.pass, true);
  const mintable = S.researchCoin({ pair: pair(), facts: { ...clean, mintAuthorityRenounced: false } }); assert.equal(mintable.pass, false); assert.ok(mintable.flags[0].includes("Mint"));
});

test("sniper only passes verified-clean fresh launches and uses a small probe", () => {
  const r = S.sniperCheck(pair({ ageMinutes: 12 }), clean, 10); assert.equal(r.ok, true); assert.equal(r.probeUsd, 3);
  assert.equal(S.sniperCheck(pair({ ageMinutes: 12 }), undefined, 10).ok, false);                     // unknown = no
  assert.equal(S.sniperCheck(pair({ ageMinutes: 1 }), clean, 10).ok, false);                          // too early
  assert.equal(S.sniperCheck(pair({ ageMinutes: 600 }), clean, 10).ok, false);                        // not fresh
  assert.equal(S.sniperCheck(pair({ ageMinutes: 12, liquidityUsd: 3000 }), clean, 10).ok, false);
  assert.equal(S.sniperCheck(pair({ ageMinutes: 12 }), { ...clean, top10HoldersPct: 60 }, 10).ok, false);
  assert.equal(S.sniperCheck(pair({ ageMinutes: 12, buys1h: 5, sells1h: 40 }), clean, 10).ok, false);
});

test("rotation needs a real gap, a weak holding, time held and stays under the hourly cap", () => {
  const base = { positions: [{ id: "1", mint: "A", symbol: "A", score: 40, valueUsd: 5, costUsd: 5, heldMinutes: 60 }, { id: "2", mint: "B", symbol: "B", score: 70, valueUsd: 5, costUsd: 5, heldMinutes: 60 }], candidates: [{ mint: "C", symbol: "C", score: 75 }], feeBps: 30, slippageBps: 100, minEdge: 15, holdFloor: 55, minHoldMinutes: 10, maxPerHour: 3, doneLastHour: 0 };
  const ok = S.rotationPlan(base); assert.equal(ok.rotate, true); assert.equal(ok.sell.symbol, "A"); assert.equal(ok.buy.symbol, "C");
  assert.equal(S.rotationPlan({ ...base, doneLastHour: 3 }).rotate, false);
  assert.equal(S.rotationPlan({ ...base, candidates: [{ mint: "C", symbol: "C", score: 50 }] }).rotate, false);          // gap too small
  assert.equal(S.rotationPlan({ ...base, positions: [{ ...base.positions[0], score: 60 }] }).rotate, false);          // holding is healthy
  assert.equal(S.rotationPlan({ ...base, positions: [{ ...base.positions[0], heldMinutes: 2 }] }).rotate, false);     // too soon
  assert.equal(S.rotationPlan({ ...base, candidates: [{ mint: "A", symbol: "A", score: 99 }] }).rotate, false);       // already held
});

test("lessons only adjust after enough recorded outcomes", () => {
  const few = S.lessonStats([{ agent: "sniper", actualPct: 10 }, { agent: "sniper", actualPct: -5 }]); assert.equal(few[0].adjust, 0);
  const many = S.lessonStats(Array.from({ length: 10 }, (_, i) => ({ agent: "sniper", actualPct: i < 8 ? 10 : -10 }))); assert.ok(many[0].adjust > 0 && many[0].adjust <= 5);
});

test("AI verdict parsing is strict and never trusts malformed output", () => {
  const P = require("../.build/core/memecoin/prompt.js");
  assert.equal(P.parseVerdict("no json here"), null); assert.equal(P.parseVerdict('{"decision":"buy more"}'), null);
  const v = P.parseVerdict('Sure! {"decision":"reduce","confidence":140,"reasons":["thin liquidity",5],"unknowns":["dev wallet"]}'); assert.equal(v.decision, "reduce"); assert.equal(v.confidence, 100); assert.deepEqual(v.reasons, ["thin liquidity"]);
  assert.ok(P.SURVIVAL_CHARTER.includes("capital preservation"));
});
