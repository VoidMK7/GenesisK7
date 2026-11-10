import { body, HttpError, route, uuid, v } from "../../../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../../../_shared/server/auth.ts";

/** How much of this wallet the AI may use. Applies to paper trades and to approval requests; it never grants spending rights. */
export const PUT = route(async (req: Request, ctx: { params: Record<string, string> }) => {
  const s = await requireUser(); const id = uuid(ctx.params.id); const b = await body(req); const db = serviceDb();
  const { data: w } = await db.from("nova_wallets").select("id").eq("id", id).eq("user_id", s.userId).maybeSingle();
  if (!w) throw new HttpError(404, "Wallet not found.");
  const mode = v.oneOf(b, "mode", ["percent", "fixed"] as const, "percent");
  const row = { wallet_id: id, user_id: s.userId, enabled: v.bool(b, "enabled") ?? false, mode, percent: mode === "percent" ? v.num(b, "percent", { min: 0, max: 100 }) ?? 0 : null, amount_usd: mode === "fixed" ? v.num(b, "amount_usd", { min: 0, max: 1e9 }) ?? 0 : null,
    max_per_trade_usd: v.num(b, "max_per_trade_usd", { min: 1, max: 1e9, optional: true }) ?? null, max_open_positions: Math.floor(v.num(b, "max_open_positions", { min: 1, max: 50, optional: true }) ?? 5),
    copy_buy_usd: v.num(b, "copy_buy_usd", { min: 1, max: 1e9, optional: true }) ?? null, copy_sells: v.bool(b, "copy_sells") ?? true };
  await db.from("nova_allocations").upsert(row);
  return { ok: true, allocation: row };
});
