import { HttpError, rateLimit, route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { loadStrategy, runUserCycle } from "../../../../_shared/server/memecoin.ts";

/** Runs one cycle for the signed-in user now (also what the cron does on a schedule). */
export const POST = route(async () => {
  const s = await requireUser(); rateLimit(`meme-run:${s.userId}`, 4, 60_000);
  const st = await loadStrategy(s.userId);
  if (!st.enabled) throw new HttpError(409, "Switch the strategy on first.");
  return runUserCycle(s.userId);
});
