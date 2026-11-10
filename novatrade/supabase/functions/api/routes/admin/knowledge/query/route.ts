import { retrieve, toCitations } from "../../../../../_shared/core/knowledge.ts";
import { groundedPrompt } from "../../../../../_shared/core/ai/providers.ts";
import { body, rateLimit, route, v } from "../../../../../_shared/server/http.ts";
import { requireAdmin, serviceDb } from "../../../../../_shared/server/auth.ts";
import { loadAiClient } from "../../../../../_shared/server/ai.ts";
import { loadApprovedChunks } from "../../../../../_shared/server/knowledge.ts";


/** Retrieval with citations. If an AI provider is connected it also writes an answer grounded only in those citations. */
export const POST = route(async (req: Request) => {
  const a = await requireAdmin();
  rateLimit(`kq:${a.userId}`, 30, 60_000);
  const b = await body(req);
  const q = v.str(b, "question", { max: 500 });
  const engine = v.str(b, "engine", { optional: true });
  const chunks = await loadApprovedChunks(engine || undefined);
  const ai = await loadAiClient(null);
  let qEmb: number[] | null = null;
  if (ai && chunks.some((c) => c.embedding)) { try { qEmb = (await ai.client.embed([q]))?.[0] ?? null; } catch { qEmb = null; } }
  const hits = retrieve(q, chunks, { k: 5, queryEmbedding: qEmb });
  const citations = toCitations(hits);
  await serviceDb().from("nova_retrieval_log").insert({ engine: engine || null, query: q, source_ids: [...new Set(hits.map((h) => h.chunk.sourceId))] });
  let answer: string | null = null;
  let answerNote = "requires configuration: connect an AI provider to generate an answer. Retrieved passages are shown below.";
  if (ai && hits.length) {
    try {
      answer = (await ai.client.chat(groundedPrompt(q, hits.map((h, i) => ({ n: i + 1, title: h.chunk.sourceTitle, text: h.chunk.text }))), { maxTokens: 600, temperature: 0.1 })).text;
      answerNote = "AI interpretation grounded in the cited passages.";
    } catch (e) { answerNote = `AI provider error: ${e instanceof Error ? e.message : "failed"}`; }
  }
  return { answer, answerNote, citations, retrieval: hits.length ? (qEmb ? "BM25 + embeddings" : "BM25") : "no approved sources matched" };
});
