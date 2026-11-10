import { compileRules } from "../../../_shared/core/memecoin/index.ts";
import { body, HttpError, route, uuid, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";

/** Teaching the AI = saving rules it must follow. Rules we can read unambiguously are enforced as hard filters; the rest are passed to your AI as guidance. */
export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await serviceDb().from("nova_ai_rules").select("id,kind,text,source,active,created_at").eq("user_id", s.userId).order("created_at", { ascending: false }).limit(200);
  const rules = data ?? []; const c = compileRules(rules.filter((r) => r.active).map((r) => ({ id: r.id as string, kind: r.kind as never, text: r.text as string })));
  return { rules: rules.map((r) => ({ ...r, enforced: c.understood[r.id as string] ?? null })),
    note: "'Enforced' rules change what the agents are allowed to buy. Other rules are sent to your AI as context when it explains a trade; they do not change the filters." };
});
export const POST = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req); const db = serviceDb();
  const { count } = await db.from("nova_ai_rules").select("*", { count: "exact", head: true }).eq("user_id", s.userId);
  if ((count ?? 0) >= 100) throw new HttpError(409, "You can keep up to 100 rules. Remove some first.");
  const { data } = await db.from("nova_ai_rules").insert({ user_id: s.userId, kind: v.oneOf(b, "kind", ["prefer", "avoid", "limit", "note"] as const, "note"), text: v.str(b, "text", { min: 3, max: 400 }), source: v.oneOf(b, "source", ["user", "chat", "feedback"] as const, "user") }).select("id,kind,text").single();
  const c = compileRules([data as never]);
  return { rule: data, enforced: c.understood[(data as { id: string }).id] ?? null };
});
export const PUT = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  await serviceDb().from("nova_ai_rules").update({ active: v.bool(b, "active") ?? true }).eq("id", uuid(v.str(b, "id"))).eq("user_id", s.userId);
  return { ok: true };
});
export const DELETE = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  await serviceDb().from("nova_ai_rules").delete().eq("id", uuid(v.str(b, "id"))).eq("user_id", s.userId);
  return { ok: true };
});
