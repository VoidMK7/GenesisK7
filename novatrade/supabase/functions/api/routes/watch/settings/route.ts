import { body, route, v } from "../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../_shared/server/auth.ts";
import { refreshAutoFollow } from "../../../../_shared/server/watch.ts";

export const PUT = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  const row = { user_id: s.userId, enabled: v.bool(b, "enabled") ?? false, min_trades: v.num(b, "min_trades", { min: 1, max: 100000, optional: true }) ?? 30, min_win_rate_pct: v.num(b, "min_win_rate_pct", { min: 0, max: 100, optional: true }) ?? 55,
    min_pnl_usd: v.num(b, "min_pnl_usd", { min: -1e9, max: 1e9, optional: true }) ?? 5000, max_stale_hours: v.num(b, "max_stale_hours", { min: 1, max: 720, optional: true }) ?? 48, max_followed: v.num(b, "max_followed", { min: 1, max: 25, optional: true }) ?? 5,
    on_trade: v.oneOf(b, "on_trade", ["notify", "notify_and_mirror"] as const, "notify") };
  await serviceDb().from("nova_autofollow").upsert(row);
  const r = await refreshAutoFollow(s.userId);
  return { ok: true, ...r };
});
