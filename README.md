# NovaTrade AI — Frontend Starter

This is a static HTML/CSS/JavaScript frontend starter using the requested midnight navy and electric teal palette.

## Run locally
Open `index.html` in a browser, or serve the folder with any static web server.

## Important status
- This package is a frontend starter, not a complete trading application.
- All displayed sample figures are illustrative placeholders.
- No broker connection, AI provider, Supabase project, market feed, or live execution is configured.
- Live trading is deliberately disabled.
- Never place broker credentials or AI API keys in browser JavaScript, HTML, local storage, or public environment variables.

## Backend integration plan
1. Create Supabase Auth, PostgreSQL tables, RLS policies, and Storage buckets.
2. Add Supabase Edge Functions or a separate secure server for AI provider calls and credential handling.
3. Add market-data adapters with source timestamps and delayed/live status.
4. Add broker-specific connectors with least-privilege credentials.
5. Add paper execution and verified order-state reconciliation.
6. Add admin-only document ingestion, extraction, review, embeddings, and evaluation.
7. Enable live execution only after explicit user authorization, broker capability checks, and server-side risk controls.

## Suggested deployment
Deploy this folder as a static site on Vercel, Netlify, or another static host. The backend can be hosted separately on Supabase and other secure compute services.
