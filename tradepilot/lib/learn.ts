// Turns a teaching video into text the assistant can learn from. UNTESTED.
// Step 1: transcribe audio with OpenAI Whisper (needs OPENAI_API_KEY, file <= 25MB).
// Step 2: have Claude extract concrete trading rules from the transcript.
export async function transcribe(buf: Buffer, filename: string, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || buf.length > 25 * 1024 * 1024) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) return null;
  return ((await res.json()) as { text?: string }).text ?? null;
}

export async function extractLessons(transcript: string, title: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1200,
      messages: [{ role: "user", content: `Trading lesson titled "${title}". From this transcript, list the concrete, testable rules (setup conditions, entries, exits, stops, risk, markets/timeframes) and any claims that are unsupported or too vague to test. Do not add rules the speaker did not state.\n\n${transcript.slice(0, 60000)}` }],
    }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { content?: { type: string; text: string }[] };
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n") || null;
}
