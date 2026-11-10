const test = require("node:test");
const assert = require("node:assert/strict");
const { applyPaperFill, paperEquity } = require("../.build/core/paper");

const acct = { cash: 1000, positions: [] };

test("paper: buy reduces cash by cost plus fee and opens a position", () => {
  const r = applyPaperFill(acct, { symbol: "BTCUSDT", side: "buy", quantity: 2, price: 100, fee: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.account.cash, 799);
  assert.deepEqual(r.account.positions, [{ symbol: "BTCUSDT", qty: 2, avgPrice: 100 }]);
});
test("paper: refuses to spend more cash than available", () => {
  const r = applyPaperFill(acct, { symbol: "X", side: "buy", quantity: 11, price: 100, fee: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.account.cash, 1000);
});
test("paper: averages entry price across buys", () => {
  const a = applyPaperFill(acct, { symbol: "X", side: "buy", quantity: 1, price: 100, fee: 0 }).account;
  const b = applyPaperFill(a, { symbol: "X", side: "buy", quantity: 1, price: 200, fee: 0 }).account;
  assert.equal(b.positions[0].avgPrice, 150);
  assert.equal(b.positions[0].qty, 2);
});
test("paper: sell realises P/L net of fee and removes a fully closed position", () => {
  const a = applyPaperFill(acct, { symbol: "X", side: "buy", quantity: 2, price: 100, fee: 0 }).account;
  const r = applyPaperFill(a, { symbol: "X", side: "sell", quantity: 2, price: 110, fee: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.realizedPnl, 18);
  assert.equal(r.account.positions.length, 0);
  assert.equal(r.account.cash, 1000 + 18);
});
test("paper: long-only, cannot sell what is not held or more than held", () => {
  assert.equal(applyPaperFill(acct, { symbol: "X", side: "sell", quantity: 1, price: 1, fee: 0 }).ok, false);
  const a = applyPaperFill(acct, { symbol: "X", side: "buy", quantity: 1, price: 10, fee: 0 }).account;
  assert.equal(applyPaperFill(a, { symbol: "X", side: "sell", quantity: 2, price: 10, fee: 0 }).ok, false);
});
test("paper: does not mutate the input account", () => {
  const a = applyPaperFill(acct, { symbol: "X", side: "buy", quantity: 1, price: 10, fee: 0 }).account;
  applyPaperFill(a, { symbol: "X", side: "sell", quantity: 1, price: 10, fee: 0 });
  assert.equal(a.positions.length, 1);
});
test("paper equity: values at live price, and at cost (reported as unpriced) when no price exists", () => {
  const a = { cash: 100, positions: [{ symbol: "A", qty: 2, avgPrice: 10 }, { symbol: "B", qty: 1, avgPrice: 50 }] };
  const r = paperEquity(a, { A: 20 });
  assert.equal(r.equity, 100 + 40 + 50);
  assert.deepEqual(r.unpriced, ["B"]);
});
