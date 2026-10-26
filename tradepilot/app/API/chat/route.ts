import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { logEvent, read } from "@/lib/db";

// UNTESTED. Basic Q&A + chart-image analysis grounded in teaching cards.
// Not yet built: live web search/sources, X sentiment, simulations, trade execution.

const SYSTEM = `You are TradePilot, a cautious market-analysis assistant.
- Analyse charts and questions; describe what you see, key levels, and scenarios with rough likelihoods.
- Be explicit about uncertainty. Never promise profit or give guaranteed outcomes.
- Never invent sources, past trades, or statistics. If you cannot cite something, say so.
- You cannot execute trades. This is educational analysis, not financial advice.
- When "Taught knowledge" is provided, use it and say which card you relied on.`;

function relevantCards(query: string) {
  const words = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  return read().cards
    .map((c) => {
      const hay = `${c.title} ${c.notes} ${c.tags.join(" ")} ${c.text}`.toLowerCase();
      let score = 0;
      words.forEach((w) => { if (hay.includes(w)) score++; });
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.c);
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Chat is not configured (missing ANTHROPIC_API_KEY)" }, { status: 503 });

  const { message, image } = (await req.json().catch(() => ({}))) as {
    message?: string; image?: { mediaType: string; data: string };
  };
  if (!message?.trim() && !image) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const cards = relevantCards(message || "");
  const knowledge = cards.length
    ? "\n\nTaught knowledge:\n" + cards.map((c) => `[Card: ${c.title}] ${c.notes}\n${c.text.slice(0, 2000)}`).join("\n---\n")
    : "";

  const content: unknown[] = [];
  if (image && /^image\/(png|jpeg|webp|gif)$/.test(image.mediaType)) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  }
  content.push({ type: "text", text: message?.trim() || "Analyse this chart." });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1500,
      system: SYSTEM + knowledge,
      messages: [{ role: "user", content }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: j?.error?.message || "Model request failed" }, { status: 502 });
  logEvent(user.id, "chat");
  const reply = (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  return NextResponse.json({ reply, usedCards: cards.map((c) => c.title) });
}
