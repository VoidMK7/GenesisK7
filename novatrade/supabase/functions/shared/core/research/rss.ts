// Dependency-free RSS 2.0 / Atom reader. Fetches only the feed URLs an administrator configured.

export interface FeedItem { title: string; link: string; publishedAt: number | null; summary: string; source: string }

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const strip = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

export function parseFeed(xml: string, source: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = strip(tag(b, "title"));
    let link = strip(tag(b, "link"));
    if (!link) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? decode(href[1]) : "";
    }
    const dateRaw = strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const t = dateRaw ? Date.parse(dateRaw) : NaN;
    const summary = strip(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 500);
    if (title && /^https?:\/\//i.test(link)) out.push({ title, link, publishedAt: Number.isFinite(t) ? t : null, summary, source });
  }
  return out;
}

export async function fetchFeed(url: string, timeoutMs = 12_000): Promise<FeedItem[]> {
  if (!/^https:\/\//i.test(url)) throw new Error("Feeds must use https.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "NovaTradeBot/1.0", accept: "application/rss+xml, application/atom+xml, text/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml.slice(0, 2_000_000), new URL(url).hostname);
  } finally {
    clearTimeout(t);
  }
}
