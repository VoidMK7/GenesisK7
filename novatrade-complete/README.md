# NovaTrade — Research-first trading workspace

A responsive Next.js dashboard starter with dark terminal styling, market filtering, an illustrative 10,000-path stress-test UI, Supabase email-link sign-in, and user-owned research notes protected by Row Level Security.

## Important status
This is a polished frontend foundation, **not a production trading engine**. Portfolio totals, prices, news, and the chart are sample/illustrative values. The scenario lab uses arbitrary toy assumptions to exercise the UI; it is not a forecast, a strategy backtest, or evidence of a profitable edge. No live orders, wallet transfers, or exchange connections are implemented.

## Quick start
1. Install Node.js 20.9+.
2. Copy `.env.example` to `.env.local`.
3. For a visual demo, leave Supabase values blank. To enable email sign-in and cloud notes, fill in the project URL and publishable key from Supabase Dashboard → Connect.
4. Run:
   ```bash
   npm install
   npm run dev
   ```
5. Open http://localhost:3000.

## Supabase setup
1. Open your intended Supabase project's SQL Editor.
2. Run `supabase/migrations/202610240001_novatrade_core.sql`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` and in your hosting provider's environment variables.
4. Configure Supabase Auth Site URL and redirect URLs for local and production domains. Configure email delivery before launch.
5. Use **Set up account** to request a secure email sign-in link. Notes are saved only for an authenticated user.

The migration creates `research_notes`, `strategy_runs`, and `watchlist_items`, all with RLS and per-user ownership. It does not store API keys or credentials.

## Deploy
Upload the folder contents to GitHub, import the repository into Vercel or another Next.js host, set the two public Supabase environment variables, and deploy. Do not commit `.env.local`, service-role keys, secret keys, exchange API secrets, or credentials.

## Wired vs. scaffolded
- **Wired:** responsive dashboard UI, navigation state, market filtering, repeatable illustrative 10,000-scenario simulation, Supabase email OTP, authenticated research-note insert.
- **Scaffolded UI only:** trade, markets, memecoins, stocks, AI autopilot, strategy lab, learning center, portfolio, bots, wallet, transactions, analytics, settings. Real data providers and server-side features are still required.
- **Not included:** live trading, exchange API integration, AI training, YouTube ingestion, current news feed, real portfolio sync, production backtesting.

## Verification checklist
- [ ] `npm install`
- [ ] `npm run build`
- [ ] Verify desktop, tablet, and mobile widths
- [ ] Run SQL migration and review Supabase security advisors
- [ ] Test sign-in and test note isolation with two accounts
- [ ] Add market data adapters and source timestamps
- [ ] Implement backtests with fees, slippage, out-of-sample data, and drawdown limits
- [ ] Keep paper trading separate from live execution; require explicit approval before any real order
