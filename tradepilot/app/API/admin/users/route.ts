import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { update, read, type Role } from "@/lib/db";

export async function PATCH(req: Request) {
  const me = await getUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { userId, role } = await req.json().catch(() => ({}));
  if (!["user", "teacher", "admin"].includes(role)) return NextResponse.json({ error: "Bad role" }, { status: 400 });
  if (userId === me.id) return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  if (!read().users.some((u) => u.id === userId)) return NextResponse.json({ error: "User not found" }, { status: 404 });
  update((d) => { const u = d.users.find((x) => x.id === userId)!; u.role = role as Role; });
  return NextResponse.json({ ok: true });
}
