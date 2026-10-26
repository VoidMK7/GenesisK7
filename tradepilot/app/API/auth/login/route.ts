import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { logEvent } from "@/lib/db";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string")
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const sb = supabaseServer();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.user) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  await logEvent(sb, data.user.id, "login");
  return NextResponse.json({ ok: true });
}
