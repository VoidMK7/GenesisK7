# NovaTrade AI — all-market analysis-first foundation

This is an integration-ready Next.js foundation. It is **not yet a complete production AI analyst**. Live execution is disabled by design.

## Implemented in this package
- Server-side quote adapter for CoinGecko (crypto) and Twelve Data (stocks, forex, indices, commodities and supported crypto pairs).
- Historical candle adapter through Twelve Data.
- Twelve transparent deterministic stress scenarios computed from historical log returns/volatility. These are explicitly not probability forecasts.
- API responses that disclose provider/setup failures instead of inventing live values.
- Analysis API that fails closed until a validated AI model adapter is configured.
- Hardcoded `liveExecutionEnabled: false` in API outputs.

## Not yet implemented / not to be represented as working
- Vision model chart reading, web/news/social/X research, source-grounded LLM synthesis, embeddings/semantic memory, calibrated forecast probabilities, scheduled evaluation, broker connectors or execution.
- Screenshot upload is not interpreted by the analysis route yet.
- Twelve scenario outputs are stress cases, not 12 independent simulations or price predictions. Do not display them as likely outcomes.

## Setup
1. Install Node.js 20+ and run `npm install`, then `npm run build`.
2. Copy `.env.example` to `.env.local`.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for client auth/data only. Never use service-role keys in browser variables.
4. Add provider keys as server-only environment variables in Vercel: `COINGECKO_DEMO_API_KEY`, `TWELVEDATA_API_KEY`, `ALPHAVANTAGE_API_KEY`, `FINNHUB_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY` as needed. Do not prefix secret keys with `NEXT_PUBLIC_`.
5. Redeploy and verify `/api/market/quote?market=crypto&symbol=bitcoin`, `/api/market/quote?market=stocks&symbol=AAPL`, and `/api/market/candles?symbol=AAPL&interval=1min`.

## Provider limitations
- Provider coverage, licensing, quotas, exchange delays and supported symbols depend on the provider/account plan. Quote timestamps are provider timestamps where available; Twelve Data quote endpoint currently uses request time and is marked `delayed: true`, so it must not be treated as an exchange timestamp.
- CoinGecko symbol input is a CoinGecko asset ID (e.g. `bitcoin`), not arbitrary ticker text.
- Twelve Data errors are surfaced; no provider fallback is silently invented.

## Safety and release gates
- Analysis-only is the only supported mode. No order-placement SDK or trading credentials are present.
- Keep `NOVATRADE_LIVE_EXECUTION_ENABLED=false`; this package ignores attempts to enable it.
- Before calling anything a forecast: require timestamped source data, citations for news/research, clear assumptions, uncertainty, out-of-sample validation, and outcome tracking.
- Before any future execution feature: separate branch, explicit user authorization, least-privilege API keys, paper trading, kill switch, order limits, audit logs, security review and legal/compliance review.

## Build status
A dependency lockfile and successful production build must be generated and verified in the target environment before deployment. This package has not been deployed by this workflow.
