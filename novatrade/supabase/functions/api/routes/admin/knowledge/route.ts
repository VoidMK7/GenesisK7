import { chunkText, diffVersions, evaluateRetrieval, parseYouTubeId, type KnowledgeVersion } from "../../../../_shared/core/knowledge.ts";
import { body, HttpError, route, uuid, v } from "../../../../_shared/server/http.ts";
import { requireAdmin, securityEvent, serviceDb } from "../../../../_shared/server/auth.ts";
import { loadAiClient } from "../../../../_shared/server/ai.ts";
import { currentSnapshot, loadApprovedChunks } from "../../../../_shared/server/knowledge.ts";


export const GET = route(async () => {
  await requireAdmin();
  const db = serviceDb();
  const [sources, collections, links, assignments, versions, cases, runs] = await Promise.all([
    db.from("nova_knowledge_sources").select("id,title,kind,status,source_url,note,created_at,reviewed_at").order("created_at", { ascending: false }).limit(200),
    db.from("nova_knowledge_collections").select("*").order("name"), db.from("nova_collection_sources").select("*"), db.from("nova_engine_assignments").select("*"),
    db.from("nova_knowledge_versions").select("id,note,snapshot,is_active,created_at").order("created_at", { ascending: false }).limit(50),
    db.from("nova_eval_cases").select("*").order("created_at"), db.from("nova_eval_runs").select("id,version_id,report,created_at").order("created_at", { ascending: false }).limit(10),
  ]);
  const vs = (versions.data ?? []) as { id: string; note: string; snapshot: Record<string, string[]>; is_active: boolean; created_at: string }[];
  const kv = (x: (typeof vs)[number]): KnowledgeVersion => ({ id: x.id, createdAt: x.created_at, note: x.note, sourceIdsByEngine: x.snapshot });
  const diffs = vs.slice(0, -1).map((x, i) => ({ from: vs[i + 1].id, to: x.id, diff: diffVersions(kv(vs[i + 1]), kv(x)) }));
  const ai = await loadAiClient(null);
  return { sources: sources.data ?? [], collections: collections.data ?? [], collectionSources: links.data ?? [], assignments: assignments.data ?? [], versions: vs, diffs, cases: cases.data ?? [], evalRuns: runs.data ?? [],
    capabilities: { embeddings: Boolean(ai), pdfText: false, imageOcr: false, transcription: false,
      note: "No model is trained or fine-tuned here. Approved text is retrieved as cited context. PDF text, image OCR, audio/video transcription and YouTube transcripts are not extracted automatically: paste the text into the source so it can be reviewed." } };
});

async function indexSource(id: string, title: string, text: string) {
  const db = serviceDb();
  await db.from("nova_knowledge_chunks").delete().eq("source_id", id);
  const chunks = chunkText(text, id, title);
  if (!chunks.length) return 0;
  let emb: number[][] | null = null;
  const ai = await loadAiClient(null);
  if (ai) { try { emb = await ai.client.embed(chunks.map((c) => c.text)); } catch { emb = null; } }
  await db.from("nova_knowledge_chunks").insert(chunks.map((c, i) => ({ source_id: id, ordinal: c.ordinal, text: c.text, embedding: emb?.[i] ?? null })));
  return chunks.length;
}

export const POST = route(async (req: Request) => {
  const a = await requireAdmin();
  const b = await body(req);
  const db = serviceDb();
  const action = v.str(b, "action");
  switch (action) {
    case "add_text": {
      const { data } = await db.from("nova_knowledge_sources").insert({ title: v.str(b, "title", { max: 200 }), kind: "text", extracted_text: v.str(b, "text", { max: 400_000 }), note: v.str(b, "note", { optional: true, max: 500 }) || null, uploaded_by: a.userId }).select("id").single();
      return { ok: true, id: data?.id };
    }
    case "add_url": {
      const url = v.str(b, "url", { max: 500 });
      if (!/^https:\/\//.test(url)) throw new HttpError(400, "Only https links are accepted.");
      const text = v.str(b, "text", { optional: true, max: 400_000 });
      const { data } = await db.from("nova_knowledge_sources").insert({ title: v.str(b, "title", { max: 200 }), kind: "url", source_url: url, extracted_text: text || null, note: text ? null : "Page text not fetched automatically. Paste the text before approving.", uploaded_by: a.userId }).select("id").single();
      return { ok: true, id: data?.id };
    }
    case "add_youtube": {
      const url = v.str(b, "url", { max: 300 });
      const vid = parseYouTubeId(url);
      if (!vid) throw new HttpError(400, "That is not a recognised YouTube link.");
      const text = v.str(b, "text", { optional: true, max: 400_000 });
      const { data } = await db.from("nova_knowledge_sources").insert({ title: v.str(b, "title", { max: 200 }), kind: "youtube", source_url: `https://www.youtube.com/watch?v=${vid}`, extracted_text: text || null, note: text ? "Transcript pasted by admin." : "Transcript not fetched. Paste the transcript before approving.", uploaded_by: a.userId }).select("id").single();
      return { ok: true, id: data?.id };
    }
    case "set_text": {
      await db.from("nova_knowledge_sources").update({ extracted_text: v.str(b, "text", { max: 400_000 }), status: "pending_review", reviewed_at: null }).eq("id", uuid(v.str(b, "id")));
      return { ok: true };
    }
    case "review": {
      const id = uuid(v.str(b, "id"));
      const decision = v.oneOf(b, "decision", ["approved", "rejected"] as const);
      const { data: src } = await db.from("nova_knowledge_sources").select("id,title,extracted_text").eq("id", id).maybeSingle();
      if (!src) throw new HttpError(404, "Source not found.");
      let chunks = 0;
      if (decision === "approved") {
        if (!src.extracted_text) throw new HttpError(409, "This source has no extracted text yet. Add the text, then approve.");
        chunks = await indexSource(id, src.title as string, src.extracted_text as string);
      } else await db.from("nova_knowledge_chunks").delete().eq("source_id", id);
      await db.from("nova_knowledge_sources").update({ status: decision, reviewed_by: a.userId, reviewed_at: new Date().toISOString() }).eq("id", id);
      await securityEvent(a.userId, "knowledge_reviewed", { id, decision });
      return { ok: true, chunks };
    }
    case "delete": { await db.from("nova_knowledge_sources").delete().eq("id", uuid(v.str(b, "id"))); return { ok: true }; }
    case "create_collection": { const { data } = await db.from("nova_knowledge_collections").insert({ name: v.str(b, "name", { max: 80 }), description: v.str(b, "description", { optional: true, max: 300 }) || null }).select("id").single(); return { ok: true, id: data?.id }; }
    case "add_to_collection": { await db.from("nova_collection_sources").upsert({ collection_id: uuid(v.str(b, "collectionId")), source_id: uuid(v.str(b, "sourceId")) }); return { ok: true }; }
    case "remove_from_collection": { await db.from("nova_collection_sources").delete().eq("collection_id", uuid(v.str(b, "collectionId"))).eq("source_id", uuid(v.str(b, "sourceId"))); return { ok: true }; }
    case "assign": { await db.from("nova_engine_assignments").upsert({ engine: v.oneOf(b, "engine", ["copy", "algo", "autonomous", "hybrid"] as const), collection_id: uuid(v.str(b, "collectionId")) }); return { ok: true }; }
    case "unassign": { await db.from("nova_engine_assignments").delete().eq("engine", v.str(b, "engine")).eq("collection_id", uuid(v.str(b, "collectionId"))); return { ok: true }; }
    case "snapshot": {
      // A new version is only a candidate until activated. Activating it is the explicit, reversible step.
      const { data } = await db.from("nova_knowledge_versions").insert({ note: v.str(b, "note", { max: 300 }), snapshot: await currentSnapshot(), created_by: a.userId }).select("id").single();
      return { ok: true, id: data?.id };
    }
    case "activate": case "rollback": {
      const id = uuid(v.str(b, "id"));
      await db.from("nova_knowledge_versions").update({ is_active: false }).eq("is_active", true);
      const { data } = await db.from("nova_knowledge_versions").update({ is_active: true }).eq("id", id).select("id").maybeSingle();
      if (!data) throw new HttpError(404, "Version not found.");
      await securityEvent(a.userId, `knowledge_${action}`, { id });
      return { ok: true };
    }
    case "add_case": {
      const terms = v.str(b, "expectTerms", { optional: true, max: 300 }).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      const src = v.str(b, "expectSourceId", { optional: true });
      const { data } = await db.from("nova_eval_cases").insert({ question: v.str(b, "question", { max: 300 }), expect_source_id: src ? uuid(src) : null, expect_terms: terms }).select("id").single();
      return { ok: true, id: data?.id };
    }
    case "run_eval": {
      const { data: cases } = await db.from("nova_eval_cases").select("*");
      if (!cases?.length) throw new HttpError(409, "Add at least one evaluation case first.");
      const report = evaluateRetrieval(cases.map((c) => ({ id: c.id as string, question: c.question as string, expectSourceId: (c.expect_source_id as string) ?? undefined, expectTerms: c.expect_terms as string[] })), await loadApprovedChunks());
      const { data: active } = await db.from("nova_knowledge_versions").select("id").eq("is_active", true).maybeSingle();
      await db.from("nova_eval_runs").insert({ version_id: active?.id ?? null, report, created_by: a.userId });
      return { ok: true, report };
    }
    default: throw new HttpError(400, "Unknown action.");
  }
});
