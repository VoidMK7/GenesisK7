import { NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { getUser, canTeach } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { logEvent, type Card } from "@/lib/db";
import { extractLessons, transcribe } from "@/lib/learn";

// NOTE: hosting platforms cap request bodies (Vercel ~4.5MB). For large videos, switch to
// direct browser-to-Storage signed uploads (createSignedUploadUrl). Not implemented yet.
const MAX_BYTES = 200 * 1024 * 1024;
const TEXT_EXT = [".txt", ".csv", ".md", ".json"];

export async function POST(req: Request) {
  const user = await getUser();
  if (!user || !canTeach(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sb = supabaseServer();

  const form = await req.formData();
  const title = String(form.get("title") || "").trim();
  const notes = String(form.get("notes") || "").trim();
  const tags = String(form.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const file = form.get("file");
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

  let kind: Card["kind"] = "note";
  let file_path: string | null = null;
  let content_text = "";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 200MB)" }, { status: 413 });
    const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "");
    file_path = `${crypto.randomUUID()}${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await sb.storage.from("teaching").upload(file_path, buf, { contentType: file.type || undefined });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (file.type.startsWith("video/")) kind = "video";
    else if (file.type.startsWith("image/")) kind = "image";
    else kind = "data";
    if (TEXT_EXT.includes(ext)) content_text = buf.toString("utf8").slice(0, 20000);
    if (kind === "video") {
      // Needs OPENAI_API_KEY (Whisper, max 25MB). Falls back to notes-only if unavailable.
      const transcript = await transcribe(buf, file.name, file.type);
      if (transcript) {
        const lessons = await extractLessons(transcript, title);
        content_text = `${lessons ? "EXTRACTED RULES:\n" + lessons + "\n\n" : ""}TRANSCRIPT:\n${transcript}`.slice(0, 60000);
      }
    }
  } else if (!notes) {
    return NextResponse.json({ error: "Add a file or notes" }, { status: 400 });
  }

  const { data, error } = await sb.from("cards").insert({
    title: title.slice(0, 120), kind, notes: notes.slice(0, 5000), content_text, tags, file_path, created_by: user.id,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(sb, user.id, "teach_upload");
  return NextResponse.json({ ok: true, id: data.id });
}
