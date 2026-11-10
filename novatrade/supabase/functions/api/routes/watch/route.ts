import { DEFAULT_FOLLOW, rankTraders } from "../../../_shared/core/memecoin/index.ts";
import { route } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { criteriaFromRow, loadTraderRows } from "../../../_shared/server/watch.ts";

/** Who the AI follows for you, what they did lately, your thresholds, and who would qualify right now (with the reasons for those who do not). */
export const GET = route(async () => {
  const s = await requireUser(); const db = serviceDb();
  const [{ data: cfg }, { data: following }, rows] = await Promise.all([
    db.from("nova_autofollow").select("*").eq("user_id", s.userId).maybeSingle(),
    db.from("nova_followed_traders").select("chain,wallet_address,handle,platform,source,reason,followed_at").eq("user_id", s.userId).order("followed_at", { ascending: false }),
    loadTraderRows(),
  ]);
  const wallets = (following ?? []).map((f) => f.wallet_address as string);
  const { data: trades } = wallets.length ? await s.db.from("nova_observed_trades").select("id,chain,wallet_address,signature,side,token_address,token_amount,quote,quote_amount,usd,block_time,detected_at").in("wallet_address", wallets).order("id", { ascending: false }).limit(60) : { data: [] };
  const { data: cursors } = wallets.length ? await db.from("nova_watch_cursors").select("wallet_address,last_checked_at,last_error").in("wallet_address", wallets) : { data: [] };
  const ranked = rankTraders(rows, criteriaFromRow(cfg)).slice(0, 40).map((r) => ({ id: r.trader.id, platform: r.trader.platform, handle: r.trader.handle, wallet: r.trader.walletAddress, stats: r.trader.stats, score: r.score, qualifies: r.qualifies, why: r.why }));
  return { settings: cfg ?? { enabled: false, min_trades: DEFAULT_FOLLOW.minTrades, min_win_rate_pct: DEFAULT_FOLLOW.minWinRatePct, min_pnl_usd: DEFAULT_FOLLOW.minPnlUsd, max_stale_hours: DEFAULT_FOLLOW.maxStaleHours, max_followed: DEFAULT_FOLLOW.maxFollowed, on_trade: "notify" },
    following: following ?? [], trades: trades ?? [], cursors: cursors ?? [], ranked,
    notes: ["Only Solana wallets are watched in this version. EVM chains need a transaction indexer.", "Rankings use the numbers each source published; the AI does not verify them and past results do not predict future ones."] };
});
