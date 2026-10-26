import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUser, canTeach } from "@/lib/auth";
import { UPLOAD_DIR, logEvent, uid, update, type Card } from "@/lib/db";

const MAX_BYTES = 200 * 1024 * 1024;
const TEXT_EXT = [".txt", ".csv", ".md", ".json"];

export async function POST(req: Request) {
  const user = await getUser();
  if (!user || !canTeach(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const title = String(form.get("title") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const tags = String(form.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const file = form.get("file");
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

  let kind: Card["kind"] = "note";
  let filename: string | undefined;
  let text = "";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 200MB)" }, { status: 413 });
    const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "");
    filename = uid() + ext;
    const buf = Buffer.from(await file.arrayBuffer());
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    if (file.type.startsWith("video/")) kind = "video";
    else if (file.type.startsWith("image/")) kind = "image";
    else kind = "data";
    if (TEXT_EXT.includes(ext)) text = buf.toString("utf8").slice(0, 20000);
  } else if (!notes) {
    return NextResponse.json({ error: "Add a file or notes" }, { status: 400 });
  }

  const card: Card = {
    id: uid(), title: title.slice(0, 120), kind, notes: notes.slice(0, 5000), text, tags,
    filename, createdBy: user.id, createdAt: new Date().toISOString(),
  };
  update((d) => { d.cards.push(card); });
  logEvent(user.id, "teach_upload");
  return NextResponse.json({ ok: true, id: card.id });
}
