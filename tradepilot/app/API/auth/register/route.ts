import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { logEvent } from "@/lib/db";

export async function POST(req: Request) {
  const { name, email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string")
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

  const sb = supabaseServer();
  const { data, error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(), password, options: { data: { name: name.trim().slice(0, 80) } },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // If "Confirm email" is on in Supabase, there is no session until the user clicks the email link.
  if (!data.session || !data.user) return NextResponse.json({ ok: true, confirm: true });
  await logEvent(sb, data.user.id, "register");
  return NextResponse.json({ ok: true });
}
