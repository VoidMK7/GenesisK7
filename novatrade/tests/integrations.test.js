const test = require("node:test");
const assert = require("node:assert/strict");
const B = "../.build/core";
const P = require(`${B}/market/providers`);
const T = require(`${B}/market/types`);
const rss = require(`${B}/research/rss`);
const an = require(`${B}/research/analysis`);
const hist = require(`${B}/research/history`);
const K = require(`${B}/knowledge`);
const AI = require(`${B}/ai/providers`);
const { mulberry32 } = require(`${B}/simulation`);

const realFetch = global.fetch;
let calls = [];
function mockFetch(handler) {
  calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const r = await handler(String(url), init);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
}
test.afterEach(() => { global.fetch = realFetch; });

test("market: provider resolution is honest about missing configuration", () => {
  assert.equal(P.resolveProvider("crypto", {}).ok, false);
  assert.equal(P.resolveProvider("crypto", { cryptoProvider: "binance" }).ok, true);
  assert.equal(P.resolveProvider("stocks", { equitiesProvider: "alpaca" }).ok, false); // missing keys
  assert.equal(P.resolveProvider("stocks", { equitiesProvider: "alpaca", equitiesKey: "k", equitiesSecret: "s" }).ok, true);
  assert.equal(P.resolveProvider("forex", { forexProvider: "oanda", forexKey: "t" }).ok, true);
  assert.equal(P.resolveProvider("commodities", { forexProvider: "oanda", forexKey: "t" }).ok, true);
  const f = P.resolveProvider("futures", { cryptoProvider: "binance" });
  assert.equal(f.ok, false);
  assert.equal(f.reason, "unsupported");
});

test("market: binance candles parse, clean and carry freshness metadata", async () => {
  mockFetch(() => ({ body: [
    [3000, "10", "12", "9", "11", "5"], [1000, "8", "9", "7", "8.5", "4"], [1000, "8", "9", "7", "8.5", "4"], // duplicate + unsorted
    [2000, "0", "0", "0", "0", "0"], // malformed (zero price)
  ] }));
  const r = await new P.BinancePublic().getCandles("BTCUSDT", "1h", 100);
  assert.deepEqual(r.candles.map((c) => c.t), [1000, 3000]);
  assert.equal(r.meta.freshness, "realtime");
  assert.equal(r.meta.provider, "binance");
  assert.match(calls[0].url, /klines\?symbol=BTCUSDT&interval=1h&limit=100/);
});

test("market: a 451 region block produces a clear message", async () => {
  mockFetch(() => ({ status: 451, body: { msg: "Service unavailable from a restricted location" } }));
  await assert.rejects(new P.BinancePublic().getQuote("BTCUSDT"), /restricted|blocks your server's region/);
});

test("market: alpaca free feed is labelled IEX-only; sip is not claimed real-time", async () => {
  mockFetch(() => ({ body: { bars: [{ t: "2026-11-02T14:30:00Z", o: 1, h: 2, l: 1, c: 1.5, v: 10 }] } }));
  const iex = await new P.AlpacaData("k", "s", "iex").getCandles("AAPL", "1h", 10);
  assert.equal(iex.meta.freshness, "realtime");
  assert.match(iex.meta.note, /IEX/);
  assert.equal(calls[0].headers["APCA-API-KEY-ID"], "k");
  const sip = await new P.AlpacaData("k", "s", "sip").getCandles("AAPL", "1h", 10);
  assert.equal(sip.meta.freshness, "unknown");
});

test("market: oanda uses mid prices and labels volume as tick count", async () => {
  mockFetch(() => ({ body: { candles: [{ time: "2026-11-02T10:00:00Z", volume: 120, complete: true, mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.15" } }] } }));
  const r = await new P.OandaData("tok").getCandles("EUR_USD", "1h", 5);
  assert.equal(r.candles[0].c, 1.15);
  assert.match(r.meta.note, /tick count/);
});

test("market: kraken parses nested result", async () => {
  mockFetch(() => ({ body: { error: [], result: { XXBTZUSD: [[1700000000, "1", "2", "0.5", "1.5", "1.4", "10", 5]], last: 1 } } }));
  const r = await new P.KrakenPublic().getCandles("XBTUSD", "1h", 10);
  assert.equal(r.candles[0].t, 1700000000000);
  assert.equal(r.candles[0].c, 1.5);
});

const SAMPLE_RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bitcoin surges to record as ETF inflows jump]]></title><link>https://news.example.com/a?utm=1</link><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Strong demand&lt;/p&gt;</description></item>
<item><title>Ether could fall if rates rise, analysts say</title><link>https://news.example.com/b</link><pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate><description>Speculation</description></item>
<item><title>Bitcoin surges to record as ETF inflows jump</title><link>https://news.example.com/a?utm=2</link><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Unrelated cooking tips</title><link>https://news.example.com/c</link></item>
<item><title>Bad link item</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test("research: rss parsing handles CDATA/entities and rejects non-http links", () => {
  const items = rss.parseFeed(SAMPLE_RSS, "news.example.com");
  assert.equal(items.length, 4);
  assert.equal(items[0].title, "Bitcoin surges to record as ETF inflows jump");
  assert.equal(items[0].summary, "Strong demand");
  assert.ok(!items.some((i) => i.link.startsWith("javascript")));
});

test("research: atom feeds parse", () => {
  const atom = `<feed><entry><title>Gold steadies</title><link href="https://x.example.com/g"/><updated>2026-11-06T09:00:00Z</updated><summary>flat</summary></entry></feed>`;
  const items = rss.parseFeed(atom, "x");
  assert.equal(items[0].link, "https://x.example.com/g");
  assert.ok(items[0].publishedAt > 0);
});

test("research: dedupes, ranks by relevance, classifies provenance honestly", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const items = an.analyzeItems(rss.parseFeed(SAMPLE_RSS, "n"), ["bitcoin", "ether"], now);
  assert.equal(items.filter((i) => i.title.startsWith("Bitcoin surges")).length, 1); // dedupe ignoring query string
  assert.ok(!items.some((i) => i.title.includes("cooking")));
  const eth = items.find((i) => i.title.startsWith("Ether"));
  assert.equal(eth.provenance, "speculation");
  const btc = items.find((i) => i.title.startsWith("Bitcoin"));
  assert.equal(btc.provenance, "reported");
  assert.ok(btc.sentiment > 0);
  assert.ok(items[0].relevance >= items[items.length - 1].relevance);
  assert.match(btc.provenanceBasis, /not independently verified/);
});

test("research: social posts are always opinion; sentiment needs enough samples", () => {
  const posts = [{ id: "1", text: "BTC to the moon, surge incoming", createdAt: "2026-11-06T11:00:00Z" }];
  const it = an.postsToItems(posts, ["btc"], Date.parse("2026-11-06T12:00:00Z"));
  assert.equal(it[0].provenance, "opinion");
  assert.equal(an.summarizeSentiment(it), null); // 1 sample is not enough
  const many = Array.from({ length: 6 }, () => ({ sentiment: 0.5, relevance: 0.8 }));
  const s = an.summarizeSentiment(many);
  assert.ok(Math.abs(s.score - 0.5) < 1e-9);
  assert.match(s.method, /not a trained model/);
});

test("research: X API failures are explained, not hidden", async () => {
  mockFetch(() => ({ status: 403, body: { title: "Forbidden", detail: "Not enough access" } }));
  const r = await an.searchX("btc", "tok");
  assert.equal(r.ok, false);
  assert.match(r.message, /plan/i);
  assert.equal(calls[0].headers.authorization, "Bearer tok");
});

function synth(n, seed = 3) {
  const rng = mulberry32(seed); const out = []; let p = 100;
  for (let i = 0; i < n; i++) { const o = p; p *= Math.exp((rng() - 0.48) * 0.02); out.push({ t: i, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p, v: 1 }); }
  return out;
}

test("history: analogues need data, report distribution, and are labelled as not a forecast", () => {
  assert.equal(hist.similarSetups(synth(100)).ok, false);
  const r = hist.similarSetups(synth(800));
  assert.equal(r.ok, true);
  assert.ok(r.matches >= 10 && r.matches <= 30);
  assert.ok(r.p10Pct <= r.p90Pct);
  assert.match(r.note, /not a forecast/);
});

const DOC = `Risk management basics.\n\nNever risk more than one percent of equity on a single trade. Position size equals risk amount divided by stop distance.\n\nTrend following.\n\nMoving average crossovers lag but capture large trends. Whipsaws are the main cost in ranging markets.\n\nPsychology.\n\nDiscipline matters more than prediction.`;

test("knowledge: chunking is bounded, overlapping, and lossless on content", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about trading discipline and position sizing.`).join(" ");
  const chunks = K.chunkText(long, "s1", "Doc", { size: 400, overlap: 80 });
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.text.length <= 400 + 100));
  assert.ok(chunks.some((c) => c.text.includes("Sentence number 59")));
  assert.deepEqual(K.chunkText("   ", "s", "t"), []);
});

test("knowledge: BM25 retrieves the right chunk and cites it", () => {
  const chunks = [...K.chunkText(DOC, "risk-book", "Risk Book", { size: 160, overlap: 20 }), ...K.chunkText("Bananas are yellow fruit grown in the tropics.", "fruit", "Fruit")];
  const hits = K.retrieve("how much equity to risk per trade and position size", chunks, { k: 2 });
  assert.equal(hits[0].chunk.sourceId, "risk-book");
  const cites = K.toCitations(hits);
  assert.equal(cites[0].n, 1);
  assert.equal(cites[0].sourceTitle, "Risk Book");
  assert.deepEqual(K.retrieve("zzzz qqqq", chunks), []); // nothing relevant => nothing returned
});

test("knowledge: embeddings blend with keyword score when present", () => {
  const chunks = [
    { id: "a:0", sourceId: "a", sourceTitle: "A", ordinal: 0, text: "alpha beta", embedding: [1, 0] },
    { id: "b:0", sourceId: "b", sourceTitle: "B", ordinal: 0, text: "alpha beta", embedding: [0, 1] },
  ];
  const hits = K.retrieve("alpha", chunks, { queryEmbedding: [1, 0] });
  assert.equal(hits[0].chunk.sourceId, "a");
  assert.ok(Math.abs(K.cosine([1, 0], [1, 0]) - 1) < 1e-12);
});

test("knowledge: retrieval evaluation passes and fails correctly; versions diff", () => {
  const chunks = K.chunkText(DOC, "risk-book", "Risk Book", { size: 160, overlap: 20 });
  const rep = K.evaluateRetrieval([
    { id: "1", question: "what percent of equity to risk per trade", expectTerms: ["one percent"] },
    { id: "2", question: "how to cook pasta", expectSourceId: "risk-book" },
    { id: "3", question: "anything" },
  ], chunks);
  assert.equal(rep.results[0].passed, true);
  assert.equal(rep.results[1].passed, false);
  assert.equal(rep.results[2].reason, "no expectation defined");
  assert.equal(rep.passRate, 1 / 3);
  const d = K.diffVersions({ id: "1", createdAt: "", note: "", sourceIdsByEngine: { algo: ["a", "b"] } }, { id: "2", createdAt: "", note: "", sourceIdsByEngine: { algo: ["b", "c"] } });
  assert.deepEqual(d.algo, { added: ["c"], removed: ["a"] });
});

test("knowledge: mime and youtube helpers", () => {
  assert.equal(K.kindFromMime("application/pdf"), "pdf");
  assert.equal(K.kindFromMime("application/x-msdownload"), null);
  assert.equal(K.parseYouTubeId("https://www.youtube.com/watch?v=abc123XYZ"), "abc123XYZ");
  assert.equal(K.parseYouTubeId("https://youtu.be/abc123XYZ"), "abc123XYZ");
  assert.equal(K.parseYouTubeId("https://evil.example.com/watch?v=abc"), null);
});

test("ai: openai-compatible chat request shape and optional key behaviour", async () => {
  mockFetch(() => ({ body: { choices: [{ message: { content: "ok" } }], model: "gpt-4o-mini", usage: { prompt_tokens: 3, completion_tokens: 1 } } }));
  const c = new AI.AiClient({ provider: "openai", apiKey: "sk-test" });
  const r = await c.chat([{ role: "user", content: "hi" }]);
  assert.equal(r.text, "ok");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer sk-test");
  assert.throws(() => new AI.AiClient({ provider: "openai" }), /API key/);
  assert.doesNotThrow(() => new AI.AiClient({ provider: "ollama" })); // key optional for Ollama
});

test("ai: anthropic and gemini shapes", async () => {
  mockFetch(() => ({ body: { content: [{ type: "text", text: "hello" }], model: "m", usage: { input_tokens: 1, output_tokens: 1 } } }));
  const a = await new AI.AiClient({ provider: "anthropic", apiKey: "k" }).chat([{ role: "system", content: "S" }, { role: "user", content: "U" }]);
  assert.equal(a.text, "hello");
  assert.equal(calls[0].headers["x-api-key"], "k");
  assert.equal(calls[0].body.system, "S");
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "U" }]);
  mockFetch(() => ({ body: { candidates: [{ content: { parts: [{ text: "g" }] } }] } }));
  const g = await new AI.AiClient({ provider: "gemini", apiKey: "gk" }).chat([{ role: "user", content: "U" }]);
  assert.equal(g.text, "g");
  assert.equal(calls[0].headers["x-goog-api-key"], "gk");
  assert.ok(!calls[0].url.includes("gk")); // key is never put in the URL
});

test("ai: SSRF guard blocks private endpoints except for Ollama; test() reports failures", async () => {
  assert.throws(() => new AI.AiClient({ provider: "openai_compatible", apiKey: "k", model: "m", baseUrl: "http://169.254.169.254/v1" }), /https/);
  assert.throws(() => new AI.AiClient({ provider: "openai_compatible", apiKey: "k", model: "m", baseUrl: "https://192.168.1.5/v1" }), /Private/);
  assert.throws(() => new AI.AiClient({ provider: "openai_compatible", apiKey: "k", model: "m", baseUrl: "https://localhost/v1" }), /Private/);
  assert.doesNotThrow(() => new AI.AiClient({ provider: "ollama", baseUrl: "http://localhost:11434" }));
  mockFetch(() => ({ status: 401, body: { error: { message: "Invalid API key" } } }));
  const t = await new AI.AiClient({ provider: "openai", apiKey: "bad" }).test();
  assert.equal(t.ok, false);
  assert.match(t.message, /Invalid API key/);
});

test("ai: anthropic has no embeddings so retrieval falls back; grounded prompt demands citations", async () => {
  assert.equal(await new AI.AiClient({ provider: "anthropic", apiKey: "k" }).embed(["x"]), null);
  const msgs = AI.groundedPrompt("q", [{ n: 1, title: "T", text: "body" }]);
  assert.match(msgs[0].content, /ONLY from the numbered sources/);
  assert.match(msgs[1].content, /\[1\] \(T\) body/);
});
