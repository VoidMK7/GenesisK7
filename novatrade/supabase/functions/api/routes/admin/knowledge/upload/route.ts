import { ALLOWED_UPLOAD, kindFromMime, MAX_UPLOAD_BYTES, TEXT_TYPES } from "../../../../../_shared/core/knowledge.ts";
import { HttpError, route } from "../../../../../_shared/server/http.ts";
import { requireAdmin, serviceDb } from "../../../../../_shared/server/auth.ts";


/** Stores the original file privately. Only plain-text types are read automatically; everything else waits for pasted text. */
export const POST = route(async (req: Request) => {
  const a = await requireAdmin();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File is larger than 25 MB.");
  if (!ALLOWED_UPLOAD.includes(file.type)) throw new HttpError(415, "That file type is not allowed.");
  const kind = kindFromMime(file.type)!;
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const path = `${Date.now()}-${safe}`;
  const db = serviceDb();
  const { error } = await db.storage.from("nova-training").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new HttpError(502, "Could not store the file.");
  const text = TEXT_TYPES.includes(file.type) ? (await file.text()).slice(0, 400_000) : null;
  const note = text ? null : kind === "pdf" ? "PDF text is not extracted automatically. Paste the text to proceed." : kind === "image" ? "Image text/description not extracted automatically. Paste a description." : "Audio/video is not transcribed automatically. Paste a transcript.";
  const { data } = await db.from("nova_knowledge_sources").insert({ title: String(form?.get("title") || file.name).slice(0, 200), kind, storage_path: path, extracted_text: text, note, uploaded_by: a.userId }).select("id").single();
  return { ok: true, id: data?.id, needsText: !text, note };
});
