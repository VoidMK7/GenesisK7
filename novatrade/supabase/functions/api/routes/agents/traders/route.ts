import { route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";

/** Top traders from other apps, exactly as a configured feed or an admin supplied them. Empty until one is. */
export const GET = route(async () => {
  const s = await requireUser();
  const { data } = await s.db.from("nova_external_traders").select("id,platform,handle,chain,wallet_address,avatar_url,profile_url,stats,source,fetched_at").order("fetched_at", { ascending: false }).limit(300);
  const platforms = [...new Set((data ?? []).map((t) => t.platform as string))];
  return { traders: data ?? [], platforms, feedConfigured: Boolean(process.env.TRADER_FEED_URL),
    note: data?.length ? "Figures are as published by each source and are not verified by NovaTrade." : "No traders yet. Configure TRADER_FEED_URL (a data feed you have access to) or have an admin import traders. Apps such as FOMO and pump.fun do not publish an open leaderboard API." };
});
