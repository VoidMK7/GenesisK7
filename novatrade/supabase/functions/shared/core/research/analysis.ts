import type { FeedItem } from "./rss.ts";

export type Provenance = "reported" | "opinion" | "speculation" | "ai_interpretation";

export interface ResearchItem {
  title: string;
  url: string;
  source: string;
  publishedAt: number | null;
  provenance: Provenance;
  provenanceBasis: string;
  relevance: number; // 0..1
  relevanceBasis: string;
  sentiment: number | null; // -1..1, keyword heuristic
}

const POS = ["surge", "rally", "gain", "beat", "beats", "record", "upgrade", "growth", "approval", "approved", "bullish", "rises", "jumps", "soars", "strong", "outperform", "adoption", "partnership"];
const NEG = ["plunge", "crash", "drop", "falls", "miss", "misses", "downgrade", "lawsuit", "ban", "hack", "bearish", "slump", "tumbles", "weak", "fraud", "investigation", "recall", "default", "bankruptcy", "selloff", "sell-off"];
const HEDGE = ["may", "might", "could", "expected to", "reportedly", "rumor", "rumour", "speculat", "analysts say", "likely", "poised", "considering", "plans to", "talks"];

const words = (s: string) => s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [];

export function keywordSentiment(text: string): number | null {
  const w = words(text);
  if (!w.length) return null;
  const t = w.join(" ");
  const has = (list: string[]) => list.reduce((n, k) => n + (new RegExp(`\\b${k}`).test(t) ? 1 : 0), 0);
  const p = has(POS), q = has(NEG);
  if (p + q === 0) return 0;
  return (p - q) / (p + q);
}

export function classify(item: { title: string; summary?: string }, isSocial: boolean): { provenance: Provenance; basis: string } {
  if (isSocial) return { provenance: "opinion", basis: "Social post: treated as opinion, not verified fact." };
  const t = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  if (HEDGE.some((h) => t.includes(h))) return { provenance: "speculation", basis: "Contains hedging or forecast language (for example 'could', 'reportedly'). Heuristic." };
  if (/\b(opinion|analysis|commentary|why |what .* means)\b/.test(t)) return { provenance: "opinion", basis: "Looks like commentary. Heuristic." };
  return { provenance: "reported", basis: "News report from the configured feed. NovaTrade has not independently verified it." };
}

export function relevance(item: { title: string; summary?: string; publishedAt: number | null }, terms: string[], now = Date.now()): { score: number; basis: string } {
  const hay = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const clean = terms.map((x) => x.toLowerCase()).filter(Boolean);
  if (!clean.length) return { score: 0, basis: "No search terms." };
  const inTitle = clean.filter((x) => item.title.toLowerCase().includes(x)).length;
  const inBody = clean.filter((x) => hay.includes(x)).length;
  const match = Math.min(1, (inTitle * 2 + (inBody - inTitle)) / (clean.length * 2));
  const ageH = item.publishedAt ? Math.max(0, (now - item.publishedAt) / 3_600_000) : 72;
  const recency = Math.exp(-ageH / 48);
  const score = match * (0.5 + 0.5 * recency);
  return { score, basis: `Term match ${(match * 100).toFixed(0)}% in title/body, recency weight ${recency.toFixed(2)} (half-life about 33h).` };
}

export function analyzeItems(items: FeedItem[], terms: string[], now = Date.now()): ResearchItem[] {
  const seen = new Set<string>();
  const out: ResearchItem[] = [];
  for (const it of items) {
    const key = it.link.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    const rel = relevance(it, terms, now);
    if (rel.score <= 0) continue;
    const cls = classify(it, false);
    out.push({
      title: it.title, url: it.link, source: it.source, publishedAt: it.publishedAt,
      provenance: cls.provenance, provenanceBasis: cls.basis,
      relevance: rel.score, relevanceBasis: rel.basis,
      sentiment: keywordSentiment(`${it.title}. ${it.summary}`),
    });
  }
  return out.sort((a, b) => b.relevance - a.relevance);
}

export interface SentimentSummary { score: number; sampleSize: number; method: string; asOf: string }

/** Aggregates item sentiments. Returns null when there are too few items to say anything. */
export function summarizeSentiment(items: { sentiment: number | null; relevance: number }[], now = Date.now()): SentimentSummary | null {
  const used = items.filter((i) => i.sentiment !== null);
  if (used.length < 5) return null;
  const w = used.reduce((s, i) => s + i.relevance, 0);
  if (w <= 0) return null;
  const score = used.reduce((s, i) => s + (i.sentiment as number) * i.relevance, 0) / w;
  return { score, sampleSize: used.length, method: `relevance-weighted keyword heuristic on ${used.length} headlines (not a trained model)`, asOf: new Date(now).toISOString() };
}

export interface SocialPost { id: string; text: string; createdAt: string | null; author?: string; likes?: number; reposts?: number }

/** X (Twitter) API v2 recent search with the administrator's bearer token. Access depends on your X API plan. */
export async function searchX(query: string, bearer: string, max = 25): Promise<{ ok: true; posts: SocialPost[] } | { ok: false; status?: number; message: string }> {
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query + " -is:retweet lang:en")}&max_results=${Math.min(100, Math.max(10, max))}&tweet.fields=created_at,public_metrics,author_id`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
    const body = (await res.json().catch(() => ({}))) as { data?: { id: string; text: string; created_at?: string; author_id?: string; public_metrics?: { like_count?: number; retweet_count?: number } }[]; title?: string; detail?: string };
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " Your X API plan may not include search access." : res.status === 402 ? " Your X API plan has no credits for this request." : res.status === 429 ? " Rate limited; try later." : "";
      return { ok: false, status: res.status, message: `${body.title ?? `HTTP ${res.status}`}${body.detail ? `: ${body.detail}` : ""}.${hint}` };
    }
    return { ok: true, posts: (body.data ?? []).map((d) => ({ id: d.id, text: d.text, createdAt: d.created_at ?? null, author: d.author_id, likes: d.public_metrics?.like_count, reposts: d.public_metrics?.retweet_count })) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Network error" };
  }
}

export function postsToItems(posts: SocialPost[], terms: string[], now = Date.now()): ResearchItem[] {
  return posts.map((p) => {
    const t = p.createdAt ? Date.parse(p.createdAt) : null;
    const rel = relevance({ title: p.text, publishedAt: t }, terms, now);
    return {
      title: p.text.slice(0, 280), url: `https://x.com/i/web/status/${p.id}`, source: "x.com", publishedAt: t,
      provenance: "opinion" as const, provenanceBasis: "Social post: treated as opinion, not verified fact.",
      relevance: rel.score, relevanceBasis: rel.basis, sentiment: keywordSentiment(p.text),
    };
  }).filter((i) => i.relevance > 0);
}
