import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { getSettings } from "@/lib/trading";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ settings: await getSettings(supabaseServer(), user.id) });
}
export async function PUT(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const row = {
    user_id: user.id,
    max_risk_pct: Number(b.max_risk_pct), max_open_trades: Math.floor(Number(b.max_open_trades)),
    daily_loss_limit_pct: Number(b.daily_loss_limit_pct), paper_balance: Number(b.paper_balance), live_enabled: b.live_enabled === true,
  };
  const { error } = await supabaseServer().from("risk_settings").upsert(row); // DB check constraints enforce ranges
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
