# NovaTrade

A memecoin copy-trading app. Four agents (Scanner, Analyst, Executor, Risk) find tokens, judge them, trade on **paper (simulated)**, and protect each position with stops. Every decision is logged with its reason. You teach the AI in plain English, connect your own AI model, follow top traders, and use the social, chat and community pages.

```
index.html, build.mjs, vercel.json, api/   the app (Vercel publishes only index.html)
supabase/                                  database migrations + API function (you put these on Supabase)
tests/, scripts/, package.json             tests and tools
```

## Set it up (in this order)

### 1. Supabase (backend)
1. Create a Supabase project.
2. In the SQL editor, run these files from `supabase/migrations/` **in order**: `0001`, `0002`, `0003`, `0004`, `0005`.
3. Deploy the function in `supabase/functions/api` (name it `api`, JWT verification **off**: `supabase functions deploy api --no-verify-jwt`).
4. Add function secrets (Supabase > Edge Functions > Secrets). Use `.env.example` as the list. Required: `CREDENTIAL_ENCRYPTION_KEY` (32 random bytes, base64) and `CRON_SECRET` (any long random string). Set `ALLOWED_ORIGINS` to your Vercel address once you have it.
5. Optional, for per-minute trader alerts and agent runs: edit and run `supabase/optional/cron_schedule.TEMPLATE.sql`.

### 2. Vercel (web)
1. Import this GitHub repo. Leave Root Directory empty (the project is already flat).
2. Environment variables: `SUPABASE_URL` (Project URL) and `SUPABASE_ANON_KEY` (anon/publishable key). Public values only. Never the service-role key.
3. Deploy. Build settings are already in `vercel.json`.
4. Optional (only for the trigger in `api/tick.js`): `CRON_SECRET` (same as Supabase) and `TICK_TOKEN` (any long random string).

### 3. Use it
Open your Vercel address, create an account, then **Account > Teach your AI** to write your strategy. It starts on paper.

## What it does
- **Memecoin agents** driven by a plain-English strategy turned into hard limits. Market data from DexScreener's public API. Fills are simulated with modelled slippage and fees.
- **Trade log**: append-only, every buy, sell and pass with its reason and the numbers used.
- **Teachable AI**: rules, thumbs on trades, chat with your own model (OpenAI, Anthropic, Gemini, Ollama, or any OpenAI-compatible endpoint). Clear rules are enforced as filters; the rest guide your AI.
- **Wallets (read-only)**: balance reading and how much the AI may use. No keys, signatures or spending approval, ever.
- **Follow top traders**: ranked on published win rate, profit, trade count and freshness, using thresholds you set. Auto-follow, a notification for every swap a followed Solana wallet makes, optional paper mirroring.
- **Social**: profiles (picture, 1-10 second banner), posts, likes, comments, follows, communities, direct messages.

## Running on Vercel Hobby
Heavy work runs in the Supabase function and is time-boxed, so any short run is safe. Vercel Hobby crons fire at most once a day, so use Supabase `pg_cron` (template provided) or a free external pinger calling `/api/tick?token=<TICK_TOKEN>` for per-minute alerts.

## Tests
`npm test` (logic) and `npm run test:sql` (needs local Postgres). Last run: 82 logic tests and 178 database checks passing.

## Not verified / not included
- Not yet run against real Supabase, DexScreener, RugCheck or Solana RPC. Logic and SQL are tested; those connections are type-checked only. Expect to debug first-run issues.
- **No real on-chain trading.** Approving a real swap returns "requires configuration": it needs a wallet-signing adapter you add and audit.
- Alerts and token balances cover Solana only; other chains show native balance.
- FOMO and pump.fun have no open leaderboard API, so Top traders stays empty until you supply a feed (`TRADER_FEED_URL`) or import rows as an admin. You can still follow any wallet by address.
- Trader stats are as published by the source, unverified, and do not predict results. Memecoins can go to zero. This is not financial advice.
- Never commit real secrets. Only `.env.example` is safe.
