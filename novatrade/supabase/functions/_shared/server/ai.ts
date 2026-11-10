import { AiClient, getProviderInfo, type ProviderConfig, type ProviderId } from "../core/ai/providers.ts";
import { decryptSecret } from "../core/crypto.ts";
import { serviceDb } from "./auth.ts";

/** The user's own AI provider if they connected one, else the platform default from env, else null (feature "requires configuration"). */
export async function loadAiClient(userId: string | null): Promise<{ client: AiClient; source: "user" | "platform"; provider: string } | null> {
  if (userId) {
    const db = serviceDb();
    const { data: p } = await db.from("nova_ai_providers").select("*").eq("user_id", userId).maybeSingle();
    if (p) {
      let apiKey: string | undefined;
      if (p.secret_id) {
        const { data: s } = await db.from("nova_secrets").select("ciphertext").eq("id", p.secret_id).eq("user_id", userId).maybeSingle();
        if (s) { try { apiKey = decryptSecret(s.ciphertext as string); } catch { return null; } }
      }
      const cfg: ProviderConfig = { provider: p.provider as ProviderId, apiKey, model: p.model ?? undefined, baseUrl: p.base_url ?? undefined };
      return { client: new AiClient(cfg), source: "user", provider: p.provider as string };
    }
  }
  const e = process.env;
  const id = (e.DEFAULT_AI_PROVIDER ?? "").toLowerCase();
  if (id && getProviderInfo(id) && (e.DEFAULT_AI_API_KEY || id === "ollama")) {
    return { client: new AiClient({ provider: id as ProviderId, apiKey: e.DEFAULT_AI_API_KEY, model: e.DEFAULT_AI_MODEL, baseUrl: e.DEFAULT_AI_BASE_URL }), source: "platform", provider: id };
  }
  return null;
}
