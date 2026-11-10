import { MEME_CHAINS, validateAddress, type MemeChain } from "../../../../_shared/core/memecoin/index.ts";
import { body, HttpError, route } from "../../../../_shared/server/http.ts";
import { requireAdmin, serviceDb } from "../../../../_shared/server/auth.ts";

/** Admin import of traders (e.g. pasted from a data export you are entitled to use). Same shape as the feed. */
export const POST = route(async (req: Request) => {
  const s = await requireAdmin(); const b = await body(req);
  const list = Array.isArray(b.traders) ? b.traders.slice(0, 500) : [];
  if (!list.length) throw new HttpError(400, "Send { traders: [...] }.");
  const rows: Record<string, unknown>[] = []; let rejected = 0;
  for (const t of list as Record<string, any>[]) {
    const chain = String(t.chain ?? "solana") as MemeChain; const platform = String(t.platform ?? "").toLowerCase(); const handle = String(t.handle ?? "").slice(0, 60); const wallet = typeof t.wallet === "string" ? t.wallet : null;
    if (!MEME_CHAINS.includes(chain) || !/^[a-z0-9_-]{2,24}$/.test(platform) || !handle || (wallet && !validateAddress(chain, wallet))) { rejected++; continue; }
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
    rows.push({ platform, handle, chain, wallet_address: wallet, avatar_url: typeof t.avatar === "string" && /^https:\/\//.test(t.avatar) ? t.avatar : null, profile_url: typeof t.url === "string" && /^https:\/\//.test(t.url) ? t.url : null,
      stats: { pnl_usd: n(t.pnl_usd), win_rate_pct: n(t.win_rate_pct), trades: n(t.trades), period_days: n(t.period_days) }, source: `admin:${s.userId.slice(0, 8)}`, fetched_at: new Date().toISOString() });
  }
  if (rows.length) await serviceDb().from("nova_external_traders").upsert(rows, { onConflict: "platform,handle" });
  return { imported: rows.length, rejected };
});
