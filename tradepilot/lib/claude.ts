// Thin Anthropic Messages API wrapper with optional server-side web search. UNTESTED.
export type Source = { title: string; url: string };
type Block = {
  type: string; text?: string;
  citations?: { url?: string; title?: string }[];
  content?: { type: string; url?: string; title?: string }[] | unknown;
};

export async function askClaude(opts: {
  system: string; user: string | unknown[]; webSearch?: boolean; maxTokens?: number;
}): Promise<{ text: string; sources: Source[] } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const body = (withSearch: boolean) => JSON.stringify({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    ...(withSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] } : {}),
  });
  const send = (withSearch: boolean) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: body(withSearch),
  });
  let res = await send(!!opts.webSearch);
  if (!res.ok && opts.webSearch) res = await send(false); // web search not enabled for this key: degrade gracefully
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message || `Model error ${res.status}`);
  const j = (await res.json()) as { content?: Block[] };
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const seen = new Map<string, Source>();
  for (const b of j.content || []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content))
      for (const r of b.content as { type: string; url?: string; title?: string }[])
        if (r.type === "web_search_result" && r.url) seen.set(r.url, { title: r.title || r.url, url: r.url });
    for (const c of b.citations || []) if (c.url) seen.set(c.url, { title: c.title || c.url, url: c.url });
  }
  return { text, sources: [...seen.values()].slice(0, 12) };
}
