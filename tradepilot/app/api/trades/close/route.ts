import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { closeTradeNow } from "@/lib/trading";

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ trade: await closeTradeNow(supabaseServer(), user.id, String(id)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
