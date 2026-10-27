import { NextResponse } from "next/server";
import { getUser, canTeach } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const user = await getUser();
  if (!user || !canTeach(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await supabaseServer().from("cards")
    .select("id,title,kind,notes,tags,file_path,created_at").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cards: data });
}

export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user || !canTeach(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const sb = supabaseServer();
  const { data: card } = await sb.from("cards").select("file_path").eq("id", id).single();
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (card.file_path) await sb.storage.from("teaching").remove([card.file_path]);
  const { error } = await sb.from("cards").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
