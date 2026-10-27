import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { logEvent, type Card } from "@/lib/db";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { askClaude } from "@/lib/claude";
import { fetchKlines, isSymbol } from "@/lib/market";
import { atr, ema, rsi } from "@/lib/indicators";
import { runSimulations, validateSetup, type Setup } from "@/lib/sim";
import { xHype } from "@/lib/x";

// UNTESTED end to end. Flow: message (+ optional chart image) -> live market data + X hype + taught cards
// -> Claude (with web search + citations) -> optional trade setup -> 12 simulations.

const SYSTEM = `You are TradePilot, a cautious market-analysis assistant.
- Analyse the chart/question: structure, key levels, indicators, and scenarios with rough likelihoods and rough timeframes.
- Use web search for relevant news and for REAL past examples of similar setups. Only cite what search actually returned. Never invent sources, past trades or statistics. If you cannot find an example, say so.
- Be explicit about uncertainty. Never promise profit. Educational analysis, not financial advice.
- Show your reasoning step by step, including what live data and social data said.
- When "Taught knowledge" is provided, use it and name the card you relied on.
- If (and only if) you can justify a concrete trade idea on a Binance USDT pair, end your reply with a fenced block exactly like:
\`\`\`setup
{"symbol":"BTCUSDT","side":"buy","entry":0,"stop":0,"target":0,"horizon_minutes":240,"interval":"15m"}
\`\`\`
  side is "buy" or "sell"; interval one of 5m,15m,1h,4h. Otherwise omit the block.`;

const COINS = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","LINK","DOT","LTC","TRX","MATIC","ATOM","NEAR","SUI","APT","ARB","OP","PEPE","SHIB","TON"];
function detectSymbol(text: string): string | null {
  const m = text.toUpperCase().match(/\b([A-Z0-9]{2,10}?)(?:\/?USDT)?\b/g) || [];
  for (const w of m) { const c = w.replace(/\/?USDT$/, ""); if (COINS.includes(c)) return c + "USDT"; }
  return null;
}

async function relevantCards(query: string): Promise<Card[]> {
  const words = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const { data } = await supabaseAdmin().from("cards").select("*").limit(500);
  return ((data as Card[]) || [])
    .map((c) => {
      const hay = `${c.title} ${c.notes} ${c.tags.join(" ")} ${c.content_text}`.toLowerCase();
      let score = 0; words.forEach((w) => { if (hay.includes(w)) score++; });
      return { c, score };
    })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.c);
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Chat is not configured (missing ANTHROPIC_API_KEY)" }, { status: 503 });

  const { message, image } = (await req.json().catch(() => ({}))) as { message?: string; image?: { mediaType: string; data: string } };
  if (!message?.trim() && !image) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const warnings: string[] = [];
  const cards = await relevantCards(message || "");
  let context = cards.length ? "\n\nTaught knowledge:\n" + cards.map((c) => `[Card: ${c.title}] ${c.notes}\n${c.content_text.slice(0, 2000)}`).join("\n---\n") : "";

  const sym = detectSymbol(message || "");
  let hype = null;
  if (sym) {
    try {
      const k = await fetchKlines(sym, "15m", 200);
      const closes = k.map((c) => c.c);
      context += `\n\nLive data ${sym} (15m): price ${closes.at(-1)}, EMA20 ${ema(closes, 20).at(-1)?.toFixed(4)}, EMA50 ${ema(closes, 50).at(-1)?.toFixed(4)}, RSI14 ${rsi(closes).toFixed(1)}, ATR14 ${atr(k).toFixed(4)}`;
    } catch { warnings.push("Live market data unavailable"); }
    hype = await xHype(sym);
    if (hype) context += `\n\nX posts about ${sym} (top by engagement, ${hype.count} recent): ${JSON.stringify(hype.posts)}`;
    else warnings.push("X hype data unavailable (no X_BEARER_TOKEN or request failed)");
  }

  const content: unknown[] = [];
  if (image && /^image\/(png|jpeg|webp|gif)$/.test(image.mediaType))
    content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text: message?.trim() || "Analyse this chart." });

  let ai;
  try { ai = await askClaude({ system: SYSTEM + context, user: content, webSearch: true, maxTokens: 2500 }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  if (!ai) return NextResponse.json({ error: "No response" }, { status: 502 });

  let reply = ai.text;
  let setup: Setup | null = null;
  let simulation = null;
  const m = reply.match(/```setup\s*([\s\S]*?)```/);
  if (m) {
    reply = reply.replace(m[0], "").trim();
    try {
      const j = JSON.parse(m[1]);
      const cand: Setup = {
        symbol: String(j.symbol || "").toUpperCase(), side: j.side === "sell" ? "sell" : "buy",
        entry: Number(j.entry), stop: Number(j.stop), target: Number(j.target),
        horizonMinutes: Number(j.horizon_minutes) || 240, interval: String(j.interval || "15m"),
      };
      const bad = validateSetup(cand) || (!isSymbol(cand.symbol) ? "bad symbol" : null);
      if (bad) warnings.push(`Trade idea discarded: ${bad}`);
      else {
        setup = cand;
        simulation = runSimulations(cand, await fetchKlines(cand.symbol, cand.interval, 500));
      }
    } catch { warnings.push("Could not read the trade idea or run simulations"); }
  }
  await logEvent(supabaseServer(), user.id, "chat");
  return NextResponse.json({ reply, sources: ai.sources, setup, simulation, hype, usedCards: cards.map((c) => c.title), warnings });
}
