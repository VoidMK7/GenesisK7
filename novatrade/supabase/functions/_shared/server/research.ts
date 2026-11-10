import { analyzeItems, postsToItems, searchX, summarizeSentiment, type ResearchItem, type SentimentSummary } from "../core/research/analysis.ts";
import { fetchFeed, type FeedItem } from "../core/research/rss.ts";

export interface ResearchResult {
  items: ResearchItem[];
  sentiment: SentimentSummary | null;
  sources: { feeds: { url: string; ok: boolean; error?: string }[]; social: { configured: boolean; ok?: boolean; message?: string } };
  configured: { news: boolean; social: boolean };
}

export function feedUrls(): string[] {
  return (process.env.NEWS_RSS_FEEDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^https:\/\//.test(s)).slice(0, 12);
}

/** Terms used to decide whether an item is about a symbol. Kept simple and visible rather than clever. */
export function termsFor(symbol: string): string[] {
  const base = symbol.toUpperCase().replace(/[-/:_].*$/, "").replace(/(USDT|USDC|USD|EUR|GBP|JPY)$/, "");
  const t = new Set([symbol.toLowerCase(), base.toLowerCase()]);
  const names: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", DOGE: "dogecoin", ADA: "cardano", BNB: "binance" };
  if (names[base]) t.add(names[base]);
  return [...t].filter((x) => x.length >= 2);
}

export async function runResearch(symbol: string): Promise<ResearchResult> {
  const urls = feedUrls();
  const terms = termsFor(symbol);
  const feeds: ResearchResult["sources"]["feeds"] = [];
  const collected: FeedItem[] = [];
  await Promise.all(urls.map(async (url) => {
    try { collected.push(...(await fetchFeed(url))); feeds.push({ url, ok: true }); }
    catch (e) { feeds.push({ url, ok: false, error: e instanceof Error ? e.message : "failed" }); }
  }));
  let items = analyzeItems(collected, terms);

  const bearer = process.env.X_API_BEARER_TOKEN;
  const social: ResearchResult["sources"]["social"] = { configured: Boolean(bearer) };
  if (bearer) {
    const r = await searchX(`(${terms.slice(0, 3).join(" OR ")}) -is:retweet lang:en`, bearer, 25);
    social.ok = r.ok;
    if (r.ok) items = items.concat(postsToItems(r.posts, terms));
    else social.message = r.message;
  }
  items.sort((a, b) => b.relevance - a.relevance);
  items = items.slice(0, 60);
  return { items, sentiment: summarizeSentiment(items), sources: { feeds, social }, configured: { news: urls.length > 0, social: Boolean(bearer) } };
}
