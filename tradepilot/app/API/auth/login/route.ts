import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByEmail, logEvent } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string")
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const u = findUserByEmail(email.trim());
  const ok = u ? await bcrypt.compare(password, u.passwordHash) : false;
  if (!u || !ok) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  logEvent(u.id, "login");
  await createSession(u.id);
  return NextResponse.json({ ok: true });
}
