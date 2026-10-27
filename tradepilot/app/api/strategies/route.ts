import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabaseServer().from("strategies").select("*").order("created_at", { ascending: false });
  return NextResponse.json({ strategies: data || [] });
}
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name, description } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const { error } = await supabaseServer().from("strategies").insert({ user_id: user.id, name: name.trim().slice(0, 80), description: String(description || "").slice(0, 2000) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await supabaseServer().from("strategies").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
