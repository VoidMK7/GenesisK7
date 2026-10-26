import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { openTrade, syncLiveTrade, syncPaperTrade } from "@/lib/trading";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = supabaseServer();
  const { data } = await sb.from("trades").select("*").order("opened_at", { ascending: false }).limit(200);
  let trades = data || [];
  // refresh open trades against market data / exchange before returning
  const errors: string[] = [];
  for (const t of trades.filter((x) => x.status === "open").slice(0, 10)) {
    try {
      const upd = t.mode === "paper" ? await syncPaperTrade(sb, t) : await syncLiveTrade(sb, t);
      if (upd) trades = trades.map((x) => (x.id === upd.id ? upd : x));
    } catch (e) { errors.push(`${t.symbol}: ${(e as Error).message}`); }
  }
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => Number(t.pnl) > 0).length;
  const stats = {
    total: trades.length, open: trades.length - closed.length, closed: closed.length,
    winRate: closed.length ? wins / closed.length : null,
    totalPnl: closed.reduce((a, t) => a + Number(t.pnl || 0), 0),
  };
  return NextResponse.json({ trades, stats, errors });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  try {
    const trade = await openTrade(supabaseServer(), user.id, {
      mode: b.mode === "live" ? "live" : "paper", symbol: String(b.symbol || "").toUpperCase(),
      side: b.side === "sell" ? "sell" : "buy", stop: Number(b.stop), target: Number(b.target), riskPct: Number(b.riskPct),
      strategyId: b.strategyId || null, connectionId: b.connectionId || null, confirm: b.confirm === true,
    });
    return NextResponse.json({ trade });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
