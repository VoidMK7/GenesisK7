import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export async function PATCH(req: Request) {
  const me = await getUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { userId, role } = await req.json().catch(() => ({}));
  if (!["user", "teacher", "admin"].includes(role)) return NextResponse.json({ error: "Bad role" }, { status: 400 });
  if (userId === me.id) return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  const { data, error } = await supabaseServer().from("profiles").update({ role }).eq("id", userId).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
