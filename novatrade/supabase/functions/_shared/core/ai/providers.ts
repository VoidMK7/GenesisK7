// Optional AI provider layer. Engines in NovaTrade do not need it: the quantitative engines are rule-based.
// It is used only for: plain-language explanations, research summaries (always labelled "AI interpretation"),
// optional embeddings for retrieval, and audio transcription for the Training Centre.
// Costs are billed by the provider to the owner of the key.

export type ProviderId = "openai" | "anthropic" | "gemini" | "ollama" | "openai_compatible";

export interface ProviderConfig { provider: ProviderId; apiKey?: string; model?: string; baseUrl?: string }
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface Completion { text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number } }

export interface ProviderInfo {
  id: ProviderId; name: string; needsKey: boolean; defaultModel: string; defaultBaseUrl: string; editableBaseUrl: boolean;
  supports: { chat: boolean; embeddings: boolean; transcription: boolean };
  costNote: string;
}

export const AI_PROVIDERS: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", needsKey: true, defaultModel: "gpt-4o-mini", defaultBaseUrl: "https://api.openai.com/v1", editableBaseUrl: false, supports: { chat: true, embeddings: true, transcription: true }, costNote: "Billed per token by OpenAI to the key owner." },
  { id: "anthropic", name: "Anthropic Claude", needsKey: true, defaultModel: "claude-sonnet-4-5", defaultBaseUrl: "https://api.anthropic.com", editableBaseUrl: false, supports: { chat: true, embeddings: false, transcription: false }, costNote: "Billed per token by Anthropic to the key owner." },
  { id: "gemini", name: "Google Gemini", needsKey: true, defaultModel: "gemini-2.0-flash", defaultBaseUrl: "https://generativelanguage.googleapis.com", editableBaseUrl: false, supports: { chat: true, embeddings: true, transcription: false }, costNote: "Free tier limits and paid pricing set by Google." },
  { id: "ollama", name: "Ollama (local or hosted)", needsKey: false, defaultModel: "llama3.1", defaultBaseUrl: "http://localhost:11434", editableBaseUrl: true, supports: { chat: true, embeddings: true, transcription: false }, costNote: "No per-token fee, but your own hardware or host. A cloud-hosted NovaTrade cannot reach localhost." },
  { id: "openai_compatible", name: "Other OpenAI-compatible", needsKey: true, defaultModel: "", defaultBaseUrl: "", editableBaseUrl: true, supports: { chat: true, embeddings: true, transcription: false }, costNote: "Pricing set by the provider you choose." },
];

export const getProviderInfo = (id: string) => AI_PROVIDERS.find((p) => p.id === id);

/** Blocks server-side requests to private networks unless the provider is Ollama (explicitly local). Reduces SSRF risk. */
export function validateBaseUrl(url: string, provider: ProviderId): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "Endpoint is not a valid URL."; }
  if (u.protocol !== "https:" && !(provider === "ollama" && u.protocol === "http:")) return "Endpoint must use https.";
  if (provider !== "ollama") {
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd)/.test(h)) return "Private or local addresses are only allowed for Ollama.";
  }
  return null;
}

async function call<T>(url: string, init: RequestInit, timeoutMs = 60_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(text); msg = j.error?.message ?? j.error ?? j.message ?? msg; } catch { /* keep */ }
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return JSON.parse(text) as T;
  } finally { clearTimeout(t); }
}

export class AiClient {
  private info: ProviderInfo;
  private base: string;
  private model: string;
  constructor(private cfg: ProviderConfig) {
    const info = getProviderInfo(cfg.provider);
    if (!info) throw new Error(`Unknown provider ${cfg.provider}`);
    this.info = info;
    this.base = (cfg.baseUrl || info.defaultBaseUrl).replace(/\/+$/, "");
    this.model = cfg.model || info.defaultModel;
    if (!this.model) throw new Error("A model name is required for this provider.");
    if (info.needsKey && !cfg.apiKey) throw new Error("An API key is required for this provider.");
    const bad = info.editableBaseUrl || cfg.baseUrl ? validateBaseUrl(this.base, cfg.provider) : null;
    if (bad) throw new Error(bad);
  }

  async chat(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<Completion> {
    const max = opts.maxTokens ?? 800;
    const temp = opts.temperature ?? 0.2;
    switch (this.cfg.provider) {
      case "anthropic": {
        const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        const r = await call<{ content: { type: string; text?: string }[]; model: string; usage?: { input_tokens: number; output_tokens: number } }>(`${this.base}/v1/messages`, {
          method: "POST",
          headers: { "x-api-key": this.cfg.apiKey!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, max_tokens: max, temperature: temp, ...(sys ? { system: sys } : {}), messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })) }),
        });
        return { text: r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), model: r.model, usage: { inputTokens: r.usage?.input_tokens, outputTokens: r.usage?.output_tokens } };
      }
      case "gemini": {
        const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        const r = await call<{ candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }>(
          `${this.base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": this.cfg.apiKey!, "content-type": "application/json" },
            body: JSON.stringify({
              ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
              contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
              generationConfig: { maxOutputTokens: max, temperature: temp },
            }),
          });
        return { text: r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", model: this.model, usage: { inputTokens: r.usageMetadata?.promptTokenCount, outputTokens: r.usageMetadata?.candidatesTokenCount } };
      }
      case "ollama": {
        const r = await call<{ message?: { content: string }; prompt_eval_count?: number; eval_count?: number }>(`${this.base}/api/chat`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, stream: false, options: { temperature: temp, num_predict: max }, messages }),
        });
        return { text: r.message?.content ?? "", model: this.model, usage: { inputTokens: r.prompt_eval_count, outputTokens: r.eval_count } };
      }
      default: {
        const r = await call<{ choices: { message: { content: string } }[]; model: string; usage?: { prompt_tokens: number; completion_tokens: number } }>(`${this.base}/chat/completions`, {
          method: "POST", headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, messages, max_tokens: max, temperature: temp }),
        });
        return { text: r.choices?.[0]?.message?.content ?? "", model: r.model ?? this.model, usage: { inputTokens: r.usage?.prompt_tokens, outputTokens: r.usage?.completion_tokens } };
      }
    }
  }

  /** Embeddings, where the provider offers them. Returns null when unsupported (retrieval falls back to keyword search). */
  async embed(texts: string[], embeddingModel?: string): Promise<number[][] | null> {
    if (!this.info.supports.embeddings) return null;
    switch (this.cfg.provider) {
      case "gemini": {
        const model = embeddingModel ?? "text-embedding-004";
        const r = await call<{ embeddings: { values: number[] }[] }>(`${this.base}/v1beta/models/${model}:batchEmbedContents`, {
          method: "POST", headers: { "x-goog-api-key": this.cfg.apiKey!, "content-type": "application/json" },
          body: JSON.stringify({ requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) }),
        });
        return r.embeddings.map((e) => e.values);
      }
      case "ollama": {
        const r = await call<{ embeddings: number[][] }>(`${this.base}/api/embed`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: embeddingModel ?? this.model, input: texts }),
        });
        return r.embeddings;
      }
      default: {
        const r = await call<{ data: { embedding: number[] }[] }>(`${this.base}/embeddings`, {
          method: "POST", headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: embeddingModel ?? (this.cfg.provider === "openai" ? "text-embedding-3-small" : this.model), input: texts }),
        });
        return r.data.map((d) => d.embedding);
      }
    }
  }

  /** Lightweight connectivity test: one tiny completion. Costs a few tokens. */
  async test(): Promise<{ ok: boolean; model: string; message: string }> {
    try {
      const r = await this.chat([{ role: "user", content: "Reply with the single word: ok" }], { maxTokens: 8, temperature: 0 });
      return { ok: true, model: r.model, message: `Connected. Model replied: ${r.text.trim().slice(0, 40)}` };
    } catch (e) {
      return { ok: false, model: this.model, message: e instanceof Error ? e.message : String(e) };
    }
  }
}

export const TASKS = ["explanations", "research_summaries", "embeddings", "transcription"] as const;
export type AiTask = (typeof TASKS)[number];

/** Prompt that keeps the model inside the retrieved, cited evidence. */
export function groundedPrompt(question: string, context: { n: number; title: string; text: string }[]): ChatMessage[] {
  const ctx = context.map((c) => `[${c.n}] (${c.title}) ${c.text}`).join("\n\n");
  return [
    { role: "system", content: "You are a research assistant for a trading platform. Answer ONLY from the numbered sources. Cite as [n]. If the sources do not contain the answer, say so. Never promise profits or give personalised financial advice. Label your answer as an AI interpretation." },
    { role: "user", content: `Sources:\n${ctx || "(none)"}\n\nQuestion: ${question}` },
  ];
}
