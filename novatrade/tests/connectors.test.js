const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const B = "../.build/core";
const { AlpacaConnector } = require(`${B}/connectors/alpaca`);
const { OandaConnector } = require(`${B}/connectors/oanda`);
const { BinanceConnector } = require(`${B}/connectors/binance`);
const { CONNECTORS, createConnector } = require(`${B}/connectors/registry`);
const { encryptSecret, decryptSecret, maskSecret } = require(`${B}/crypto`);

const realFetch = global.fetch;
let calls = [];
function mockFetch(handler) {
  calls = [];
  global.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(rec);
    const r = await handler(rec);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
}
test.afterEach(() => { global.fetch = realFetch; });

const creds = (extra = {}) => ({ apiKey: "KEY", apiSecret: "SECRET", environment: "paper", ...extra });

test("alpaca: bracket order body, headers and paper endpoint", async () => {
  mockFetch(() => ({ body: { id: "ord1", status: "accepted" } }));
  const a = new AlpacaConnector(creds());
  const r = await a.placeOrder({ symbol: "AAPL", side: "buy", type: "market", quantity: 3, stopLoss: 180, takeProfit: 200, clientOrderId: "cid-1" });
  assert.equal(r.status, "accepted");
  const c = calls[0];
  assert.match(c.url, /^https:\/\/paper-api\.alpaca\.markets\/v2\/orders$/);
  assert.equal(c.headers["APCA-API-KEY-ID"], "KEY");
  assert.equal(c.body.order_class, "bracket");
  assert.equal(c.body.client_order_id, "cid-1");
  assert.deepEqual(c.body.stop_loss, { stop_price: "180" });
});

test("alpaca: stop-only uses oto; crypto rejects attachments; live uses live host", async () => {
  mockFetch(() => ({ body: { id: "o", status: "new" } }));
  const a = new AlpacaConnector(creds({ environment: "live" }));
  await a.placeOrder({ symbol: "AAPL", side: "buy", type: "limit", limitPrice: 190, quantity: 1, stopLoss: 180, clientOrderId: "c2" });
  assert.equal(calls[0].body.order_class, "oto");
  assert.match(calls[0].url, /^https:\/\/api\.alpaca\.markets/);
  await assert.rejects(a.placeOrder({ symbol: "BTC/USD", side: "buy", type: "market", quantity: 1, stopLoss: 1, clientOrderId: "c3" }), /crypto/);
});

test("alpaca: 4xx is a definite rejection; 5xx is thrown (unknown outcome)", async () => {
  mockFetch(() => ({ status: 403, body: { message: "insufficient buying power" } }));
  const a = new AlpacaConnector(creds());
  const r = await a.placeOrder({ symbol: "AAPL", side: "buy", type: "market", quantity: 1, clientOrderId: "c4" });
  assert.equal(r.status, "rejected");
  assert.match(r.reason, /buying power/);
  mockFetch(() => ({ status: 503, body: { message: "down" } }));
  await assert.rejects(a.placeOrder({ symbol: "AAPL", side: "buy", type: "market", quantity: 1, clientOrderId: "c5" }));
});

test("alpaca: filled status maps with price; test() reports no withdrawal", async () => {
  mockFetch((r) => r.url.endsWith("/v2/account") ? { body: { id: "acc", status: "ACTIVE" } } : { body: { id: "o", status: "filled", filled_qty: "3", filled_avg_price: "191.5" } });
  const a = new AlpacaConnector(creds());
  const o = await a.getOrder("o");
  assert.deepEqual([o.status, o.filledQty, o.avgPrice], ["filled", 3, 191.5]);
  const t = await a.test();
  assert.equal(t.ok, true);
  assert.equal(t.withdrawalPermission, false);
  assert.equal(t.tradingPermission, true);
});

test("oanda: sell units negative, price precision, fill transaction => filled", async () => {
  mockFetch(() => ({ body: { orderCreateTransaction: { id: "11" }, orderFillTransaction: { id: "12", price: "1.08512", units: "-1000", commission: "0" } } }));
  const o = new OandaConnector(creds({ accountId: "101-001-1-001" }));
  const r = await o.placeOrder({ symbol: "EUR_USD", side: "sell", type: "market", quantity: 1000, stopLoss: 1.0901234, takeProfit: 1.07, clientOrderId: "c6" });
  assert.equal(r.status, "filled");
  assert.equal(r.avgPrice, 1.08512);
  assert.equal(r.filledQty, 1000);
  const body = calls[0].body.order;
  assert.equal(body.units, "-1000");
  assert.equal(body.stopLossOnFill.price, "1.09012");
  assert.match(calls[0].url, /api-fxpractice\.oanda\.com\/v3\/accounts\/101-001-1-001\/orders/);
  assert.equal(calls[0].headers.authorization, "Bearer KEY");
});

test("oanda: JPY uses 3 decimals; cancel transaction => rejected; account id required", async () => {
  mockFetch(() => ({ body: { orderCreateTransaction: { id: "1" }, orderCancelTransaction: { id: "2", reason: "INSUFFICIENT_MARGIN" } } }));
  const o = new OandaConnector(creds({ accountId: "a" }));
  const r = await o.placeOrder({ symbol: "USD_JPY", side: "buy", type: "limit", limitPrice: 150.12345, quantity: 10, clientOrderId: "c7" });
  assert.equal(calls[0].body.order.price, "150.123");
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "INSUFFICIENT_MARGIN");
  assert.throws(() => new OandaConnector(creds()), /account ID/);
});

test("oanda: FILLED order without fill details is NOT reported as confirmed", async () => {
  mockFetch((r) => r.url.includes("/transactions/") ? { status: 500, body: {} } : { body: { order: { id: "5", state: "FILLED", fillingTransactionID: "9" } } });
  const o = new OandaConnector(creds({ accountId: "a" }));
  const r = await o.getOrder("5");
  assert.equal(r.status, "filled");
  assert.equal(r.avgPrice, undefined); // execution pipeline requires price+qty to confirm
});

test("binance: requests are signed correctly and carry the key header", async () => {
  mockFetch((r) => r.url.includes("exchangeInfo")
    ? { body: { symbols: [{ baseAsset: "BTC", filters: [{ filterType: "LOT_SIZE", stepSize: "0.001" }, { filterType: "PRICE_FILTER", tickSize: "0.01" }] }] } }
    : { body: { orderId: 77, status: "FILLED", executedQty: "0.123", cummulativeQuoteQty: "6150.00" } });
  const b = new BinanceConnector(creds(), () => 1700000000000);
  const r = await b.placeOrder({ symbol: "BTCUSDT", side: "buy", type: "market", quantity: 0.123456, clientOrderId: "cid-abc" });
  const order = calls.find((c) => c.method === "POST");
  assert.equal(order.headers["X-MBX-APIKEY"], "KEY");
  assert.match(order.url, /^https:\/\/testnet\.binance\.vision\/api\/v3\/order\?/);
  const q = new URL(order.url).searchParams;
  assert.equal(q.get("quantity"), "0.123"); // floored to step, never rounded up
  assert.equal(q.get("side"), "BUY");
  const sig = q.get("signature");
  const raw = order.url.split("?")[1].replace(/&signature=.*$/, "");
  assert.equal(sig, crypto.createHmac("sha256", "SECRET").update(raw).digest("hex"));
  assert.equal(r.status, "filled");
  assert.equal(r.avgPrice, 6150 / 0.123);
});

test("binance: refuses stop-loss attachments (documented limitation) and has none advertised", async () => {
  const b = new BinanceConnector(creds());
  assert.equal(b.capabilities.stopLoss, false);
  await assert.rejects(b.placeOrder({ symbol: "BTCUSDT", side: "buy", type: "market", quantity: 1, stopLoss: 1, clientOrderId: "x" }), /cannot attach/);
});

test("binance: withdrawal permission is detected; unverifiable is null", async () => {
  mockFetch((r) => r.url.includes("apiRestrictions") ? { body: { enableWithdrawals: true } } : { body: { canTrade: true, accountType: "SPOT", balances: [] } });
  let t = await new BinanceConnector(creds({ environment: "live" })).test();
  assert.equal(t.withdrawalPermission, true);
  assert.ok(t.permissions.includes("WITHDRAW"));
  mockFetch((r) => r.url.includes("apiRestrictions") ? { status: 403, body: { message: "no" } } : { body: { canTrade: true, balances: [] } });
  t = await new BinanceConnector(creds({ environment: "live" })).test();
  assert.equal(t.withdrawalPermission, null);
});

test("binance: 4xx rejection vs 5xx unknown outcome", async () => {
  const handler = (status) => (r) => r.url.includes("exchangeInfo")
    ? { body: { symbols: [{ baseAsset: "BTC", filters: [] }] } } : { status, body: { message: "x" } };
  mockFetch(handler(400));
  const b = new BinanceConnector(creds());
  assert.equal((await b.placeOrder({ symbol: "BTCUSDT", side: "buy", type: "market", quantity: 1, clientOrderId: "a" })).status, "rejected");
  mockFetch(handler(502));
  await assert.rejects(b.placeOrder({ symbol: "BTCUSDT", side: "buy", type: "market", quantity: 1, clientOrderId: "b" }));
});

test("registry: unsupported platforms are labelled, not faked", () => {
  const mt5 = CONNECTORS.find((c) => c.id === "mt5");
  assert.equal(mt5.support, "not_supported");
  assert.throws(() => createConnector("mt5", creds()), /not supported/);
  assert.throws(() => createConnector("bybit", creds()), /not supported/);
  assert.equal(createConnector("alpaca", creds()).id, "alpaca");
  for (const c of CONNECTORS.filter((x) => x.support === "supported")) assert.ok(c.limitations.length > 0);
});

test("crypto: AES-GCM round trip, tamper and wrong key are rejected, masking", () => {
  const key = crypto.randomBytes(32).toString("base64");
  const blob = encryptSecret("super-secret-key-123", key);
  assert.ok(!blob.includes("super-secret"));
  assert.equal(decryptSecret(blob, key), "super-secret-key-123");
  assert.notEqual(encryptSecret("a", key), encryptSecret("a", key)); // fresh IV each time
  const parts = blob.split(":"); parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(parts.join(":"), key));
  assert.throws(() => decryptSecret(blob, crypto.randomBytes(32).toString("base64")));
  assert.throws(() => encryptSecret("x", "c2hvcnQ="), /32 bytes/);
  assert.throws(() => encryptSecret("x", undefined), /not set/);
  assert.equal(maskSecret("abcdefghijkl"), "••••ijkl");
});
