import { route, rateLimit, symbol } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { parseAssetClass, parseInterval, withProvider } from "../../../../_shared/server/market.ts";

export const GET = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`mkt:${s.userId}`, 120, 60_000);
  const q = new URL(req.url).searchParams;
  const cls = parseAssetClass(q.get("class") ?? "crypto");
  const sym = symbol(q.get("symbol") ?? "");
  const interval = parseInterval(q.get("interval") ?? "1h");
  const limit = Math.min(1000, Math.max(20, Number(q.get("limit") ?? 300) || 300));
  return withProvider(cls, (p) => p.getCandles(sym, interval, limit));
});
