import type { Chunk } from "../core/knowledge.ts";
import { serviceDb } from "./auth.ts";

/** Chunks of APPROVED sources only. With an engine, limited to the active version's snapshot for that engine (if one is active). */
export async function loadApprovedChunks(engine?: string): Promise<Chunk[]> {
  const db = serviceDb();
  let allowed: string[] | null = null;
  if (engine) {
    const { data: v } = await db.from("nova_knowledge_versions").select("snapshot").eq("is_active", true).maybeSingle();
    const snap = (v?.snapshot ?? null) as Record<string, string[]> | null;
    if (snap) allowed = snap[engine] ?? [];
  }
  let q = db.from("nova_knowledge_sources").select("id,title").eq("status", "approved");
  if (allowed) q = q.in("id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
  const { data: sources } = await q;
  if (!sources?.length) return [];
  const { data: rows } = await db.from("nova_knowledge_chunks").select("id,source_id,ordinal,text,embedding").in("source_id", sources.map((s) => s.id as string)).limit(5000);
  const title = new Map(sources.map((s) => [s.id as string, s.title as string]));
  return (rows ?? []).map((r) => ({ id: r.id as string, sourceId: r.source_id as string, sourceTitle: title.get(r.source_id as string) ?? "", ordinal: r.ordinal as number, text: r.text as string, embedding: (r.embedding as number[] | null) ?? null }));
}

export async function currentSnapshot(): Promise<Record<string, string[]>> {
  const db = serviceDb();
  const { data: assign } = await db.from("nova_engine_assignments").select("engine,collection_id");
  const out: Record<string, string[]> = { copy: [], algo: [], autonomous: [], hybrid: [] };
  for (const a of assign ?? []) {
    const { data: cs } = await db.from("nova_collection_sources").select("source_id").eq("collection_id", a.collection_id);
    const ids = (cs ?? []).map((c) => c.source_id as string);
    if (ids.length) {
      const { data: ok } = await db.from("nova_knowledge_sources").select("id").eq("status", "approved").in("id", ids);
      out[a.engine as string] = [...new Set([...(out[a.engine as string] ?? []), ...(ok ?? []).map((o) => o.id as string)])];
    }
  }
  return out;
}
