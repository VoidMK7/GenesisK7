import { route, rateLimit, symbol, HttpError } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { parseAssetClass, withProvider } from "../../../../_shared/server/market.ts";

export const GET = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`mkt:${s.userId}`, 120, 60_000);
  const q = new URL(req.url).searchParams;
  const cls = parseAssetClass(q.get("class") ?? "crypto");
  const sym = symbol(q.get("symbol") ?? "");
  return withProvider(cls, async (p) => {
    if (!p.getOrderBook) throw new HttpError(501, `${p.id} does not provide an order book.`);
    return p.getOrderBook(sym, 20);
  });
});
