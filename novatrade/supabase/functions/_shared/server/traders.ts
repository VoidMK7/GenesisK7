import type { TraderRecord } from "../core/engines/copy.ts";
import { serviceDb } from "./auth.ts";

/** Public, copy-enabled traders with their platform-computed records. Nothing here is typed in by the trader. */
export async function loadTraders(): Promise<TraderRecord[]> {
  const db = serviceDb();
  const { data: profiles } = await db.from("nova_trader_profiles").select("user_id,display_name").eq("is_public", true).eq("allow_copy", true).limit(200);
  if (!profiles?.length) return [];
  const ids = profiles.map((p) => p.user_id as string);
  const [{ data: stats }, { data: open }] = await Promise.all([
    db.from("nova_trader_stats").select("*").in("user_id", ids),
    db.from("nova_trader_open_positions").select("user_id,symbol,direction").in("user_id", ids),
  ]);
  const out: TraderRecord[] = [];
  for (const p of profiles) {
    const s = stats?.find((x) => x.user_id === p.user_id);
    if (!s) continue; // no record yet: nothing to rank
    out.push({
      traderId: p.user_id as string, name: p.display_name as string, source: s.record_source, trades: Number(s.trades), days: Number(s.days),
      winRatePct: Number(s.win_rate_pct ?? 0), maxDrawdownPct: Number(s.max_drawdown_pct ?? 100), returnPct: Number(s.return_pct ?? 0),
      openPositions: (open ?? []).filter((o) => o.user_id === p.user_id).map((o) => ({ symbol: o.symbol as string, direction: o.direction as "long" | "short" })),
    });
  }
  return out;
}
