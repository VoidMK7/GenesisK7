import { body, HttpError, route, v } from "../../../../_shared/server/http.ts";
import { requireAdmin, securityEvent, serviceDb } from "../../../../_shared/server/auth.ts";

// Non-secret platform switches only. Secrets are environment variables and are never stored or shown here.
const ALLOWED_KEYS = ["maintenance_banner", "signups_open", "copy_trading_enabled", "marketplace_enabled"] as const;

export const GET = route(async () => {
  await requireAdmin();
  const { data } = await serviceDb().from("nova_platform_config").select("key,value,updated_at");
  return { config: data ?? [], allowedKeys: ALLOWED_KEYS };
});
export const PUT = route(async (req: Request) => {
  const a = await requireAdmin();
  const b = await body(req);
  const key = v.oneOf(b, "key", ALLOWED_KEYS);
  if (!("value" in b)) throw new HttpError(400, "value is required.");
  if (JSON.stringify(b.value).length > 2000) throw new HttpError(400, "value is too large.");
  await serviceDb().from("nova_platform_config").upsert({ key, value: b.value, updated_by: a.userId, updated_at: new Date().toISOString() });
  await securityEvent(a.userId, "config_changed", { key });
  return { ok: true };
});
