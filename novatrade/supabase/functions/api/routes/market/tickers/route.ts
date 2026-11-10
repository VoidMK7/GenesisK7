import { HttpError, rateLimit, route } from "../../../../_shared/server/http.ts";
import { requireUser } from "../../../../_shared/server/auth.ts";
import { parseAssetClass, withProvider } from "../../../../_shared/server/market.ts";

// Which symbols to list. This is only a choice of what to ask the exchange for; every price and change comes from the exchange.
const MAJOR_USDT = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "AVAX", "TRX", "LINK", "DOT", "MATIC", "LTC", "BCH", "ATOM", "UNI", "NEAR", "APT", "ARB", "OP", "FIL", "ETC", "XLM", "INJ", "SUI", "AAVE", "SHIB", "PEPE", "TON", "HBAR"].map((b) => `${b}USDT`);

export const GET = route(async (req: Request) => {
  const s = await requireUser();
  rateLimit(`tick:${s.userId}`, 60, 60_000);
  const q = new URL(req.url).searchParams;
  const cls = parseAssetClass(q.get("class") ?? "crypto");
  const custom = (q.get("symbols") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9]{3,20}$/.test(x)).slice(0, 60);
  const symbols = custom.length ? custom : MAJOR_USDT;
  return withProvider(cls, async (p) => {
    if (!p.getTickers) throw new HttpError(501, `${p.id} does not offer a market list. Use the Binance crypto provider for this view.`);
    const r = await p.getTickers(symbols);
    return { tickers: r.tickers.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)), meta: r.meta };
  });
});
