import { planCopyOrder } from "../../../../_shared/core/copy.ts";
import type { AssetClass } from "../../../../_shared/core/market/types.ts";
import { HttpError, route } from "../../../../_shared/server/http.ts";
import { notify, serviceDb } from "../../../../_shared/server/auth.ts";
import { cronAuthorized } from "../../../../_shared/server/cron.ts";
import { loadSettings } from "../../../../_shared/server/account.ts";
import { executeOrder } from "../../../../_shared/server/orders.ts";


/** Replicates each leader's NEW broker-confirmed live fills for active followers. Idempotent per (subscription, leader fill). */
export const GET = route(async (req: Request) => {
  cronAuthorized(req);
  const db = serviceDb();
  const { data: subs } = await db.from("nova_copy_subscriptions").select("*").eq("status", "active").limit(500);
  const summary = { subscriptions: subs?.length ?? 0, copied: 0, skipped: 0, failed: 0 };
  for (const sub of subs ?? []) {
    const { data: fills } = await db.from("nova_order_audit").select("id,detail,created_at").eq("user_id", sub.leader).eq("mode", "live").eq("event", "filled")
      .or("engine.is.null,engine.neq.copy").gt("id", sub.cursor_audit_id).order("id").limit(25);
    const settings = await loadSettings(sub.follower as string);
    let cursor = Number(sub.cursor_audit_id);
    for (const f of fills ?? []) {
      cursor = Number(f.id);
      const d = f.detail as { symbol: string; side: "buy" | "sell"; price: number; quantity: number; meta?: { equity?: number; assetClass?: AssetClass } };
      const equity = Number(d.meta?.equity), cls = d.meta?.assetClass;
      if (!cls || !(equity > 0)) { summary.skipped++; continue; }
      const plan = planCopyOrder({ symbol: d.symbol, side: d.side, quantity: d.quantity, price: d.price, leaderEquity: equity }, { allocation: Number(sub.allocation), maxTradePct: Number(sub.max_trade_pct), stopLossPct: Number(sub.stop_loss_pct) });
      if (!plan.copy) { summary.skipped++; continue; }
      try {
        await executeOrder(sub.follower as string, {
          assetClass: cls, symbol: d.symbol, side: plan.side, type: "market", quantity: plan.quantity, stopLoss: plan.stopLoss, reduceOnly: plan.reduceOnly,
          idempotencyKey: `copy:${sub.id}:${f.id}`, engine: "copy", connectionId: settings.executionMode === "live" ? (sub.connection_id as string | undefined) : undefined,
          meta: { copiedFrom: sub.leader, leaderAuditId: f.id, capped: plan.capped },
        });
        summary.copied++;
      } catch (e) {
        summary.failed++;
        await notify(sub.follower as string, "copy", `Copied trade not placed: ${d.side} ${d.symbol}`, e instanceof HttpError || e instanceof Error ? e.message : "Unknown error.");
      }
    }
    if (cursor !== Number(sub.cursor_audit_id)) await db.from("nova_copy_subscriptions").update({ cursor_audit_id: cursor }).eq("id", sub.id);
  }
  return summary;
});
