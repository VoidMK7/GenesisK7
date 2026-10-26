import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUser, canTeach } from "@/lib/auth";
import { UPLOAD_DIR, read, update } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user || !canTeach(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ cards: read().cards.map(({ text, ...c }) => c) });
}

export async function DELETE(req: Request) {
  const user = await getUser();
  if (!user || !canTeach(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  const card = read().cards.find((c) => c.id === id);
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (card.filename) fs.rmSync(path.join(UPLOAD_DIR, path.basename(card.filename)), { force: true });
  update((d) => { d.cards = d.cards.filter((c) => c.id !== id); });
  return NextResponse.json({ ok: true });
}
