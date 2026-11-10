import { HttpError, route } from "../../../../_shared/server/http.ts";
import { serviceDb } from "../../../../_shared/server/auth.ts";
import { cronAuthorized } from "../../../../_shared/server/cron.ts";
import { MEME_CHAINS, validateAddress, type MemeChain } from "../../../../_shared/core/memecoin/index.ts";

/**
 * Pulls top-trader stats from a feed YOU configure (TRADER_FEED_URL, optional TRADER_FEED_KEY). Nothing is scraped and nothing is invented.
 * Expected JSON: an array of { platform, handle, chain, wallet, avatar?, url?, pnl_usd?, win_rate_pct?, trades?, period_days? }.
 * Apps like FOMO or pump.fun publish no open leaderboard API, so this needs a data provider you have access to, or use the admin import.
 */
async function run(req: Request) {
  cronAuthorized(req);
  const url = process.env.TRADER_FEED_URL;
  if (!url || !/^https:\/\//.test(url)) throw new HttpError(503, "TRADER_FEED_URL is not configured.");
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json", ...(process.env.TRADER_FEED_KEY ? { authorization: `Bearer ${process.env.TRADER_FEED_KEY}` } : {}) } });
  if (!r.ok) throw new HttpError(502, `The trader feed answered ${r.status}.`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new HttpError(502, "The trader feed did not return a list.");
  const rows: Record<string, unknown>[] = []; let rejected = 0;
  for (const t of list.slice(0, 500)) {
    const chain = String(t?.chain ?? "solana") as MemeChain; const platform = String(t?.platform ?? "").toLowerCase(); const handle = String(t?.handle ?? "").slice(0, 60);
    const wallet = typeof t?.wallet === "string" ? t.wallet : null;
    if (!MEME_CHAINS.includes(chain) || !/^[a-z0-9_-]{2,24}$/.test(platform) || !handle || (wallet && !validateAddress(chain, wallet))) { rejected++; continue; }
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
    rows.push({ platform, handle, chain, wallet_address: wallet, avatar_url: typeof t.avatar === "string" && /^https:\/\//.test(t.avatar) ? t.avatar : null, profile_url: typeof t.url === "string" && /^https:\/\//.test(t.url) ? t.url : null,
      stats: { pnl_usd: n(t.pnl_usd), win_rate_pct: n(t.win_rate_pct), trades: n(t.trades), period_days: n(t.period_days) }, source: new URL(url).host, fetched_at: new Date().toISOString() });
  }
  if (rows.length) await serviceDb().from("nova_external_traders").upsert(rows, { onConflict: "platform,handle" });
  return { imported: rows.length, rejected };
}
export const GET = route(run);
export const POST = route(run);
