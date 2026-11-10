import { marketEnvFromProcess, resolveProvider } from "../core/market/providers.ts";
import { INTERVALS, ProviderError, type AssetClass, type Interval, type MarketProvider } from "../core/market/types.ts";
import { HttpError } from "./http.ts";
import { countApi } from "./auth.ts";

export const ASSET_CLASSES: AssetClass[] = ["crypto", "stocks", "etf", "forex", "commodities", "indices", "futures"];

export function parseAssetClass(s: string): AssetClass {
  if (!ASSET_CLASSES.includes(s as AssetClass)) throw new HttpError(400, `class must be one of: ${ASSET_CLASSES.join(", ")}.`);
  return s as AssetClass;
}
export function parseInterval(s: string): Interval {
  if (!INTERVALS.includes(s as Interval)) throw new HttpError(400, `interval must be one of: ${INTERVALS.join(", ")}.`);
  return s as Interval;
}

export function providerFor(cls: AssetClass): MarketProvider {
  const r = resolveProvider(cls, marketEnvFromProcess());
  if (!r.ok) throw new HttpError(r.reason === "not_configured" ? 503 : 400, r.message, { code: r.reason });
  return r.provider;
}

/** Runs a provider call, counts usage, and turns provider failures into clear 502s. */
export async function withProvider<T>(cls: AssetClass, fn: (p: MarketProvider) => Promise<T>): Promise<T> {
  const p = providerFor(cls);
  try {
    const out = await fn(p);
    void countApi(p.id);
    return out;
  } catch (e) {
    void countApi(p.id, true);
    if (e instanceof ProviderError) throw new HttpError(502, `${p.id}: ${e.message}`);
    throw e;
  }
}
