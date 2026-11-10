import { AI_PROVIDERS, AiClient, getProviderInfo, TASKS, validateBaseUrl, type AiTask, type ProviderId } from "../../../_shared/core/ai/providers.ts";
import { encryptSecret, maskSecret } from "../../../_shared/core/crypto.ts";
import { body, HttpError, rateLimit, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { loadAiClient } from "../../../_shared/server/ai.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await serviceDb().from("nova_ai_providers").select("provider,model,base_url,tasks,last_tested_at,last_test_ok,secret_id").eq("user_id", s.userId).maybeSingle();
  let hint: string | null = null;
  if (data?.secret_id) { const { data: sec } = await serviceDb().from("nova_secrets").select("hint").eq("id", data.secret_id).maybeSingle(); hint = (sec?.hint as string) ?? null; }
  const platform = await loadAiClient(null);
  return { providers: AI_PROVIDERS, tasks: TASKS, connection: data ? { ...data, secret_id: undefined, keyHint: hint } : null, platformDefault: platform ? platform.provider : null,
    note: "AI providers are optional and separate from broker credentials. Without one, AI explanations show 'requires configuration'." };
});

export const PUT = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`ai:${s.userId}`, 6, 60_000);
  const b = await body(req);
  const provider = v.str(b, "provider") as ProviderId;
  const info = getProviderInfo(provider);
  if (!info) throw new HttpError(400, "Unknown provider.");
  const apiKey = v.str(b, "apiKey", { optional: true, max: 400 });
  if (info.needsKey && !apiKey) throw new HttpError(400, "An API key is required for this provider.");
  const baseUrl = v.str(b, "baseUrl", { optional: true, max: 300 });
  if (baseUrl) { const err = validateBaseUrl(baseUrl, provider); if (err) throw new HttpError(400, err); }
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) throw new HttpError(503, "CREDENTIAL_ENCRYPTION_KEY is not set on the server.");
  const tasks = (Array.isArray(b.tasks) ? b.tasks : []).filter((t): t is AiTask => typeof t === "string" && (TASKS as readonly string[]).includes(t));
  const model = v.str(b, "model", { optional: true, max: 100 });

  const db = serviceDb();
  const { data: old } = await db.from("nova_ai_providers").select("secret_id").eq("user_id", s.userId).maybeSingle();
  let secretId: string | null = null;
  if (apiKey) {
    const { data: sec } = await db.from("nova_secrets").insert({ user_id: s.userId, kind: "ai_provider", ciphertext: encryptSecret(apiKey), hint: maskSecret(apiKey) }).select("id").single();
    secretId = (sec?.id as string) ?? null;
  }
  const test = await new AiClient({ provider, apiKey: apiKey || undefined, model: model || undefined, baseUrl: baseUrl || undefined }).test();
  await db.from("nova_ai_providers").upsert({
    user_id: s.userId, provider, model: model || null, base_url: baseUrl || null, secret_id: secretId, tasks, last_tested_at: new Date().toISOString(), last_test_ok: test.ok, updated_at: new Date().toISOString(),
  });
  if (old?.secret_id && old.secret_id !== secretId) await db.from("nova_secrets").delete().eq("id", old.secret_id).eq("user_id", s.userId);
  return { ok: true, test };
});

export const POST = route(async () => {
  const s = await requireUser();
  rateLimit(`aitest:${s.userId}`, 6, 60_000);
  const c = await loadAiClient(s.userId);
  if (!c) throw new HttpError(404, "No AI provider is connected.");
  const test = await c.client.test();
  await serviceDb().from("nova_ai_providers").update({ last_tested_at: new Date().toISOString(), last_test_ok: test.ok }).eq("user_id", s.userId);
  return test;
});

export const DELETE = route(async () => {
  const s = await requireUser();
  const db = serviceDb();
  const { data } = await db.from("nova_ai_providers").select("secret_id").eq("user_id", s.userId).maybeSingle();
  await db.from("nova_ai_providers").delete().eq("user_id", s.userId);
  if (data?.secret_id) await db.from("nova_secrets").delete().eq("id", data.secret_id).eq("user_id", s.userId);
  return { ok: true };
});
