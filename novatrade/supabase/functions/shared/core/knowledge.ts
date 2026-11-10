// Knowledge pipeline helpers: chunking, retrieval (BM25 + optional embeddings), evaluation, versioning.
// Nothing here changes any model. Approved text is only ever retrieved as cited context.

export interface Chunk { id: string; sourceId: string; sourceTitle: string; ordinal: number; text: string; embedding?: number[] | null }

export function chunkText(text: string, sourceId: string, sourceTitle: string, opts: { size?: number; overlap?: number } = {}): Chunk[] {
  const size = opts.size ?? 900;
  const overlap = Math.min(opts.overlap ?? 150, Math.floor(size / 3));
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\n+/);
  const out: Chunk[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ id: `${sourceId}:${out.length}`, sourceId, sourceTitle, ordinal: out.length, text: t });
  };
  for (const p of paras) {
    if (p.length > size) {
      if (buf) { flush(); buf = ""; }
      for (let i = 0; i < p.length; i += size - overlap) {
        buf = p.slice(i, i + size);
        flush();
        buf = "";
        if (i + size >= p.length) break;
      }
      continue;
    }
    if (buf.length + p.length + 2 > size) {
      flush();
      buf = buf.slice(Math.max(0, buf.length - overlap)) + "\n\n" + p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  flush();
  return out;
}

const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with not but if then than so such into about over under".split(" "));
export const tokenize = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9'.-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

export interface Hit { chunk: Chunk; score: number; bm25: number; vector: number | null }

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return NaN;
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : NaN;
}

export function retrieve(query: string, chunks: Chunk[], opts: { k?: number; queryEmbedding?: number[] | null; minScore?: number } = {}): Hit[] {
  const k = opts.k ?? 5;
  const q = tokenize(query);
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => tokenize(c.text));
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.5, b = 0.75;

  const bm = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of new Set(q)) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return s;
  });
  const maxBm = Math.max(...bm, 1e-9);

  const hits: Hit[] = chunks.map((chunk, i) => {
    const nb = bm[i] / maxBm;
    let v: number | null = null;
    if (opts.queryEmbedding && chunk.embedding) {
      const c = cosine(opts.queryEmbedding, chunk.embedding);
      v = Number.isFinite(c) ? Math.max(0, c) : null;
    }
    return { chunk, bm25: bm[i], vector: v, score: v === null ? nb : 0.5 * nb + 0.5 * v };
  });
  return hits.filter((h) => h.score > (opts.minScore ?? 0) && (h.bm25 > 0 || (h.vector ?? 0) > 0)).sort((a, b2) => b2.score - a.score).slice(0, k);
}

export interface Citation { n: number; sourceId: string; sourceTitle: string; excerpt: string }

export function toCitations(hits: Hit[]): Citation[] {
  return hits.map((h, i) => ({ n: i + 1, sourceId: h.chunk.sourceId, sourceTitle: h.chunk.sourceTitle, excerpt: h.chunk.text.slice(0, 280) }));
}

export interface EvalCase { id: string; question: string; expectSourceId?: string; expectTerms?: string[] }
export interface EvalCaseResult { id: string; passed: boolean; reason: string; topSources: string[] }
export interface EvalReport { total: number; passed: number; passRate: number | null; results: EvalCaseResult[] }

/** Retrieval evaluation: a case passes if an expected source or all expected terms appear in the top-k. No model needed. */
export function evaluateRetrieval(cases: EvalCase[], chunks: Chunk[], k = 3): EvalReport {
  const results: EvalCaseResult[] = cases.map((c) => {
    const hits = retrieve(c.question, chunks, { k });
    const tops = [...new Set(hits.map((h) => h.chunk.sourceId))];
    const joined = hits.map((h) => h.chunk.text.toLowerCase()).join("\n");
    const srcOk = c.expectSourceId ? tops.includes(c.expectSourceId) : true;
    const termsOk = (c.expectTerms ?? []).every((t) => joined.includes(t.toLowerCase()));
    const hasExpectation = Boolean(c.expectSourceId) || Boolean(c.expectTerms?.length);
    const passed = hasExpectation && srcOk && termsOk && hits.length > 0;
    return { id: c.id, passed, reason: !hasExpectation ? "no expectation defined" : !hits.length ? "nothing retrieved" : !srcOk ? "expected source not retrieved" : !termsOk ? "expected terms missing" : "ok", topSources: tops };
  });
  const passed = results.filter((r) => r.passed).length;
  return { total: cases.length, passed, passRate: cases.length ? passed / cases.length : null, results };
}

export interface KnowledgeVersion { id: string; createdAt: string; note: string; sourceIdsByEngine: Record<string, string[]> }

export function diffVersions(a: KnowledgeVersion, b: KnowledgeVersion) {
  const engines = new Set([...Object.keys(a.sourceIdsByEngine), ...Object.keys(b.sourceIdsByEngine)]);
  const out: Record<string, { added: string[]; removed: string[] }> = {};
  for (const e of engines) {
    const x = new Set(a.sourceIdsByEngine[e] ?? []), y = new Set(b.sourceIdsByEngine[e] ?? []);
    out[e] = { added: [...y].filter((s) => !x.has(s)), removed: [...x].filter((s) => !y.has(s)) };
  }
  return out;
}

export const TEXT_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json"];
export const ALLOWED_UPLOAD = [...TEXT_TYPES, "application/pdf", "image/png", "image/jpeg", "audio/mpeg", "audio/wav", "audio/mp4", "video/mp4"];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type SourceKind = "text" | "pdf" | "image" | "audio_video" | "youtube" | "url" | "trade_records";

export function kindFromMime(mime: string): SourceKind | null {
  if (TEXT_TYPES.includes(mime)) return "text";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "audio_video";
  return null;
}

export function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]{6,})/);
      return m ? m[2] : null;
    }
  } catch { /* not a URL */ }
  return null;
}
