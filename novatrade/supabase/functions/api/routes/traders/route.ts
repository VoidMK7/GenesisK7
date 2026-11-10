import { qualifies, QUALIFY } from "../../../_shared/core/engines/copy.ts";
import { body, HttpError, route, v } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { loadTraders } from "../../../_shared/server/traders.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const traders = await loadTraders();
  const { data: subs } = await serviceDb().from("nova_copy_subscriptions").select("id,leader,allocation,status").eq("follower", s.userId).eq("status", "active");
  const { data: mine } = await serviceDb().from("nova_trader_profiles").select("display_name,bio,is_public,allow_copy").eq("user_id", s.userId).maybeSingle();
  return {
    requirements: QUALIFY, mine,
    traders: traders.map((t) => ({ ...t, qualification: qualifies(t), copying: Boolean(subs?.find((x) => x.leader === t.traderId)), isYou: t.traderId === s.userId })),
    note: "Records are computed from this platform's own broker-confirmed fills. Self-reported or hypothetical records are never ranked.",
  };
});

export const PUT = route(async (req: Request) => {
  const s = await requireUser();
  const b = await body(req);
  const name = v.str(b, "displayName", { min: 3, max: 32 });
  const row = { user_id: s.userId, display_name: name, bio: v.str(b, "bio", { optional: true, max: 500 }) || null, is_public: v.bool(b, "isPublic") ?? false, allow_copy: v.bool(b, "allowCopy") ?? false };
  const { error } = await serviceDb().from("nova_trader_profiles").upsert(row);
  if (error) throw new HttpError(409, error.code === "23505" ? "That display name is taken." : "Could not save the profile.");
  return { ok: true };
});
