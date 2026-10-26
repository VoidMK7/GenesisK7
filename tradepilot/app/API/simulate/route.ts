import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { fetchKlines, isSymbol } from "@/lib/market";
import { runSimulations, type Setup } from "@/lib/sim";

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const setup: Setup = {
    symbol: String(b.symbol || "").toUpperCase(), side: b.side === "sell" ? "sell" : "buy",
    entry: Number(b.entry), stop: Number(b.stop), target: Number(b.target),
    horizonMinutes: Number(b.horizonMinutes) || 240, interval: String(b.interval || "15m"),
  };
  if (!isSymbol(setup.symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  try {
    const candles = await fetchKlines(setup.symbol, setup.interval, 500);
    return NextResponse.json({ simulation: runSimulations(setup, candles) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
