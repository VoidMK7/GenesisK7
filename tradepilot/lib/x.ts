// X (Twitter) hype check. Requires a paid X API plan with recent-search access (X_BEARER_TOKEN). UNTESTED.
export type Hype = { query: string; count: number; posts: { text: string; likes: number; reposts: number; at: string }[] } | null;

export async function xHype(symbol: string): Promise<Hype> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return null;
  const coin = symbol.replace(/(USDT|USDC|FDUSD|BUSD)$/, "");
  if (!/^[A-Z0-9]{2,10}$/.test(coin)) return null;
  const query = `($${coin} OR #${coin}) -is:retweet lang:en`;
  const q = new URLSearchParams({ query, max_results: "30", "tweet.fields": "public_metrics,created_at" });
  try {
    const res = await fetch(`https://api.x.com/2/tweets/search/recent?${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { text: string; created_at: string; public_metrics: { like_count: number; retweet_count: number } }[] };
    const posts = (j.data || [])
      .map((p) => ({ text: p.text.slice(0, 240), likes: p.public_metrics.like_count, reposts: p.public_metrics.retweet_count, at: p.created_at }))
      .sort((a, b) => b.likes + b.reposts - (a.likes + a.reposts))
      .slice(0, 8);
    return { query, count: j.data?.length ?? 0, posts };
  } catch {
    return null;
  }
}
