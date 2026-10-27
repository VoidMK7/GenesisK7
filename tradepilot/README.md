# TradePilot AI (starter)

Next.js 14 (App Router) + TypeScript + Tailwind. Supabase (Postgres + Auth + Storage) backend.

## Setup (Supabase)
1. Create a Supabase project.
2. SQL editor: run `supabase/migrations/0001_init.sql` (tables, row-level security, private `teaching` storage bucket, admin stats function, new-user trigger).
3. `cp .env.example .env.local` and fill the URL, anon key and service-role key (Project Settings > API).
4. `npm install && npm run dev`, open http://localhost:3000 and sign up.
5. Make yourself admin in the SQL editor: `update public.profiles set role = 'admin' where email = 'you@example.com';`
6. In /admin, promote other users to **teacher** to give them the Teaching space.

If "Confirm email" is on in Supabase Auth settings, new users must click the email link before logging in (the form shows a notice).

## Setup additions (trading)
- Run `supabase/migrations/0002_trading.sql` after `0001_init.sql`.
- Fill in the extra variables in `.env.example` (`ENCRYPTION_KEY` is required for connectors).
- 24/7 signals: `vercel.json` calls `/api/cron/signals` every 15 minutes (needs a Vercel plan that allows it; Hobby only allows daily). Set `CRON_SECRET`. Any other scheduler can call the same URL with `Authorization: Bearer <CRON_SECRET>`.
- Live trading is off until `LIVE_TRADING_ENABLED=true` **and** the user ticks "Allow real-money trading" in Trade > Risk limits. Use a Binance **testnet** key first.

## What works how
- **Chat**: question/chart image -> live candles + indicators, X posts, taught cards -> Claude with web search (sources listed) -> optional trade idea -> **12 simulations** (3 volatility regimes x 4 paths, bootstrapped from real recent candles; stop assumed first if both hit in one candle). Simulations test the stop/target layout under recent volatility. They are not predictions.
- **Paper trading**: fills at live price, sized by your risk %, no leverage, checked against real 1-minute candles since entry. Every trade stores a step-by-step log.
- **Risk limits** (enforced in code on every trade): max risk %, max open trades, daily loss limit, live-trading opt-in, explicit confirmation.
- **Exchange execution** (Binance spot): keys verified on connect (keys that can withdraw are rejected), AES-256-GCM encrypted. A live BUY is followed by an exchange-side OCO stop/target; if that fails the position is closed immediately.
- **Strategies**: name rules, tag trades, see win rate and P/L per strategy.
- **Video learning**: Whisper transcript, then Claude extracts testable rules into memory.

## Status

Tested here (Node, with mocked market data and a fake database): simulation engine, indicators, position sizing, key encryption, and the paper-trading engine (risk-limit rejections, sizing, take-profit/stop detection, stop-wins-ties, manual close, daily loss limit).

**Written but never run against the real services** (this environment could not reach them): Supabase (SQL + queries), Binance (testnet or live), Anthropic API with web search, X API, Whisper, Vercel cron, and the whole React UI. Expect to fix bugs on first run.

| Area | Status |
|---|---|
| Auth, roles, Teaching space, Admin panel | Written, untested (see earlier) |
| Chat + chart upload + sources (web search citations) | Written, untested |
| 12 simulations | **Logic tested**; UI untested |
| Paper trading, risk limits, step logs | **Engine tested** against fakes; UI/DB untested |
| Strategy storage and per-strategy stats | Written, untested |
| Exchange connector (Binance spot) + live execution with OCO | Written, **untested against Binance**. Treat as unsafe until you have run it on testnet |
| X hype check | Written, untested (needs paid X API) |
| Video learning | Written, untested (needs OpenAI key, files <=25MB) |
| 24/7 signals | Written, untested (rule-based; AI note optional) |
| Images from the internet in replies | **Not built** (sources are links only) |
| Other exchanges (Bybit, MT4/MT5, stocks), futures/shorting live | **Not built** |
| Learning from videos longer than 25MB, or YouTube links | **Not built** |
| Vector/semantic memory search | **Not built** (keyword matching) |
| Auto-trading from signals (bot running without a click) | **Not built, on purpose**: every trade needs explicit confirmation |

## Before any real use
- Large video uploads: the upload route passes files through the server (hosting body limits apply, e.g. ~4.5MB on Vercel). Switch to signed direct-to-Storage uploads.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses all security rules: server only, never in client code.
- Add rate limiting; chat memory search is simple keyword matching (upgrade to Postgres full-text or pgvector).
- The SQL migration has not been run against a real database.
- Run `npm run build` first. This code was written without being compiled, so expect to fix type errors.
- Don't give any AI auto-execution on a funded account without hard risk limits and per-trade confirmation. Signals and analysis are not guaranteed to be profitable.
