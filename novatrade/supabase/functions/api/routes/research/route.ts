import { similarSetups } from "../../../_shared/core/research/history.ts";
import { rateLimit, route, symbol } from "../../../_shared/server/http.ts";
import { requireUser } from "../../../_shared/server/auth.ts";
import { parseAssetClass, parseInterval, providerFor } from "../../../_shared/server/market.ts";
import { runResearch } from "../../../_shared/server/research.ts";


export const GET = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`research:${s.userId}`, 20, 60_000);
  const q = new URL(req.url).searchParams;
  const cls = parseAssetClass(q.get("class") ?? "crypto");
  const sym = symbol(q.get("symbol") ?? "BTCUSDT");
  const research = await runResearch(sym);
  let analogue = null as ReturnType<typeof similarSetups> | null;
  let analogueError: string | undefined;
  try {
    const { candles } = await providerFor(cls).getCandles(sym, parseInterval(q.get("interval") ?? "1d"), 1000);
    analogue = similarSetups(candles);
  } catch (e) { analogueError = e instanceof Error ? e.message : "No market data."; }
  return { symbol: sym, ...research, analogue, analogueError, labels: "Sentiment is a keyword heuristic. Provenance labels are rule-based. Historical analogues are descriptive, not predictions." };
});
