import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByEmail, logEvent, uid, update, type Role } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { name, email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string")
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const em = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(em)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  if (findUserByEmail(em)) return NextResponse.json({ error: "Email already registered" }, { status: 409 });

  const isAdmin = !!process.env.ADMIN_EMAIL && em === process.env.ADMIN_EMAIL.trim().toLowerCase();
  const role: Role = isAdmin ? "admin" : "user";
  const id = uid();
  const passwordHash = await bcrypt.hash(password, 10);
  update((d) => {
    d.users.push({ id, email: em, name: name.trim().slice(0, 80), passwordHash, role, createdAt: new Date().toISOString() });
  });
  logEvent(id, "register");
  await createSession(id);
  return NextResponse.json({ ok: true });
}
