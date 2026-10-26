import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchKlines } from "@/lib/market";
import { atr, ema, rsi } from "@/lib/indicators";
import { xHype } from "@/lib/x";
import { askClaude } from "@/lib/claude";

// 24/7 signals: call on a schedule (vercel.json cron or any scheduler) with
// `Authorization: Bearer $CRON_SECRET`. Rule-based (EMA trend + RSI + ATR levels), with an optional
// AI note that uses web search and X posts for context. Signals are NOT financial advice.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const symbols = (process.env.WATCHLIST || "BTCUSDT,ETHUSDT,SOLUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const timeframe = process.env.SIGNAL_TIMEFRAME || "15m";
  const sb = supabaseAdmin();
  const made: string[] = [];
  const errors: string[] = [];

  for (const symbol of symbols) {
    try {
      const candles = await fetchKlines(symbol, timeframe, 200);
      const closes = candles.map((c) => c.c);
      const e20 = ema(closes, 20).at(-1)!, e50 = ema(closes, 50).at(-1)!;
      const r = rsi(closes, 14), a = atr(candles, 14), price = closes.at(-1)!;
      let direction: "buy" | "sell" | "neutral" = "neutral";
      let strength = 0;
      if (e20 > e50 && price > e20) { strength += 1; if (r >= 50 && r <= 70) strength += 1; if (price > e50 * 1.002) strength += 1; if (strength >= 2) direction = "buy"; }
      else if (e20 < e50 && price < e20) { strength += 1; if (r <= 50 && r >= 30) strength += 1; if (price < e50 * 0.998) strength += 1; if (strength >= 2) direction = "sell"; }
      if (direction === "neutral") strength = 0;
      const stop = direction === "buy" ? price - 1.5 * a : direction === "sell" ? price + 1.5 * a : null;
      const target = direction === "buy" ? price + 3 * a : direction === "sell" ? price - 3 * a : null;

      let context = "", sources: { title: string; url: string }[] = [];
      if (direction !== "neutral" && process.env.ANTHROPIC_API_KEY) {
        const hype = await xHype(symbol);
        const ai = await askClaude({
          system: "You write a 2-3 sentence market-context note for a trading signal. Use web search for recent news. Be neutral, flag uncertainty, never invent facts or sources.",
          user: `Signal: ${direction.toUpperCase()} ${symbol} ${timeframe} at ${price}. EMA20 ${e20.toFixed(2)}, EMA50 ${e50.toFixed(2)}, RSI ${r.toFixed(1)}.\nX posts (top by engagement): ${hype ? JSON.stringify(hype.posts.slice(0, 5)) : "unavailable"}`,
          webSearch: true, maxTokens: 400,
        });
        if (ai) { context = ai.text; sources = ai.sources; }
      }
      await sb.from("signals").insert({
        symbol, timeframe, direction, strength, price, stop, target,
        indicators: { ema20: e20, ema50: e50, rsi: r, atr: a }, context, sources,
      });
      made.push(`${symbol}:${direction}`);
    } catch (e) { errors.push(`${symbol}: ${(e as Error).message}`); }
  }
  return NextResponse.json({ made, errors });
}
