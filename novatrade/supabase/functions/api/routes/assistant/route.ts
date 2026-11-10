import { body, HttpError, rateLimit, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { loadAiClient } from "../../../_shared/server/ai.ts";
import { loadRules, loadStrategy } from "../../../_shared/server/memecoin.ts";

export const GET = route(async () => {
  const s = await requireUser(); const ai = await loadAiClient(s.userId).catch(() => null);
  const { data } = await s.db.from("nova_ai_messages").select("id,role,body,suggested_rules,created_at").order("id", { ascending: false }).limit(60);
  return { messages: (data ?? []).reverse(), ai: ai ? { provider: ai.provider, source: ai.source } : null, requiresConfiguration: !ai };
});

/** Chat with YOUR connected AI model. It can propose rules; nothing is saved as a rule until you tap Teach. */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); rateLimit(`assist:${s.userId}`, 20, 60_000); const b = await body(req); const text = v.str(b, "message", { max: 2000 });
  const ai = await loadAiClient(s.userId);
  if (!ai) throw new HttpError(503, "Connect your AI model first (Account > AI model). Until then the assistant requires configuration.", { code: "requires_configuration" });
  const db = serviceDb();
  const [strategy, rules, { data: hist }, { data: recent }] = await Promise.all([loadStrategy(s.userId), loadRules(s.userId),
    db.from("nova_ai_messages").select("role,body").eq("user_id", s.userId).order("id", { ascending: false }).limit(12),
    db.from("nova_trade_log").select("side,symbol,status,reason,created_at").eq("user_id", s.userId).order("created_at", { ascending: false }).limit(8)]);
  await db.from("nova_ai_messages").insert({ user_id: s.userId, role: "user", body: text });
  const system = `You are the assistant inside NovaTrade, a memecoin copy-trading app. The user tells you what they want; you help them set rules and understand the agents' decisions.
Rules you must follow: never promise or imply profit; never claim a trade is safe; say plainly that memecoins can go to zero; never ask for private keys or seed phrases; you cannot move funds.
Current strategy: mode=${strategy.mode}, enabled=${strategy.enabled}, position $${strategy.positionUsd}, take profit ${strategy.takeProfitPct}%, stop ${strategy.stopLossPct}%, trailing ${strategy.trailingStopPct}%, min liquidity $${strategy.minLiquidityUsd}.
Taught rules: ${rules.map((r) => `[${r.kind}] ${r.text}`).join("; ") || "none"}.
Recent decisions: ${(recent ?? []).map((t) => `${t.side} ${t.symbol} (${t.status}): ${String(t.reason).slice(0, 100)}`).join(" | ") || "none"}.
If the user states a preference you could save as a rule, end your reply with a line exactly like: RULES: [{"kind":"avoid","text":"..."}] (kind is prefer, avoid, limit or note; max 3). Only include it when the user clearly expressed the preference.`;
  const messages = [{ role: "system" as const, content: system }, ...(hist ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.body) })), { role: "user" as const, content: text }];
  let reply; try { reply = await ai.client.chat(messages, { maxTokens: 600, temperature: 0.3 }); } catch (e) { throw new HttpError(502, `Your AI provider returned an error: ${e instanceof Error ? e.message : "failed"}`); }
  let out = reply.text.trim(); let suggested: { kind: string; text: string }[] = [];
  const m = out.match(/\n?RULES:\s*(\[[\s\S]*\])\s*$/);
  if (m) { try { const arr = JSON.parse(m[1]); suggested = (Array.isArray(arr) ? arr : []).filter((r) => r && ["prefer", "avoid", "limit", "note"].includes(r.kind) && typeof r.text === "string").slice(0, 3).map((r) => ({ kind: r.kind, text: String(r.text).slice(0, 400) })); out = out.slice(0, m.index).trim(); } catch { /* keep text as is */ } }
  const { data } = await db.from("nova_ai_messages").insert({ user_id: s.userId, role: "assistant", body: out.slice(0, 8000), suggested_rules: suggested, provider: ai.provider }).select("id,role,body,suggested_rules,created_at").single();
  return { message: data };
});
export const DELETE = route(async () => { const s = await requireUser(); await serviceDb().from("nova_ai_messages").delete().eq("user_id", s.userId); return { ok: true }; });
