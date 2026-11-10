// Which integrations are configured. Only booleans ever leave the server; values are never exposed.
export type IntegrationKey = "supabase" | "serviceRole" | "cryptoData" | "equitiesData" | "forexData" | "news" | "social" | "defaultAi" | "credentialVault";
const has = (v: string | undefined) => Boolean(v && v.trim().length > 0);

export function integrationStatus(): Record<IntegrationKey, boolean> {
  const e = process.env;
  const crypto = (e.MARKET_DATA_CRYPTO_PROVIDER ?? "").trim().toLowerCase();
  return {
    supabase: has(e.SUPABASE_URL) && has(e.SUPABASE_ANON_KEY),
    serviceRole: has(e.SUPABASE_SERVICE_ROLE_KEY),
    cryptoData: crypto === "binance" || crypto === "kraken",
    equitiesData: (e.MARKET_DATA_EQUITIES_PROVIDER ?? "").toLowerCase() === "alpaca" && has(e.MARKET_DATA_EQUITIES_API_KEY) && has(e.MARKET_DATA_EQUITIES_API_SECRET),
    forexData: (e.MARKET_DATA_FOREX_PROVIDER ?? "").toLowerCase() === "oanda" && has(e.MARKET_DATA_FOREX_API_KEY),
    news: has(e.NEWS_RSS_FEEDS),
    social: has(e.X_API_BEARER_TOKEN),
    defaultAi: has(e.DEFAULT_AI_PROVIDER) && (has(e.DEFAULT_AI_API_KEY) || (e.DEFAULT_AI_PROVIDER ?? "").toLowerCase() === "ollama"),
    credentialVault: has(e.CREDENTIAL_ENCRYPTION_KEY),
  };
}
