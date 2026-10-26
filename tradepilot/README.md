# TradePilot AI (starter)

Next.js 14 (App Router) + TypeScript + Tailwind. File-based JSON storage (no database setup).

## Run
```bash
cp .env.example .env.local     # set AUTH_SECRET and ADMIN_EMAIL
npm install
npm run dev                    # http://localhost:3000
```
Register using the email in `ADMIN_EMAIL` to become the first admin. Admins promote others to **teacher** in /admin.

## Status

| Area | Status |
|---|---|
| Sign up / log in / log out (bcrypt + signed JWT cookie, 7 days) | Written, **untested** |
| Roles: user / teacher / admin, checked server-side on pages and APIs | Written, **untested** |
| Teaching space (teacher+admin only): upload notes, CSV/TXT/JSON, images, videos as learning cards | Written, **untested** |
| Admin panel: usage stats, 14-day chart, promote/demote users | Written, **untested** |
| Chat + chart image upload via Anthropic API, grounded in taught cards (keyword match) | Written, **untested**, needs `ANTHROPIC_API_KEY` |
| Video learning: transcription/frame analysis | **Not built.** Videos are stored only; put lessons in the notes |
| Live web search with cited sources, images from the internet | **Not built** |
| X / social-hype checking | **Not built** |
| 12-scenario simulations | **Not built** |
| Exchange connector space (API keys, encrypted storage) | **Not built** |
| Paper trading + trade step logs, risk limits | **Not built** |
| Live trade execution | **Not built** (build paper trading first) |
| 24/7 signals and market analysis (needs a background worker) | **Not built** |
| Strategy storage / trade history | **Not built** |

## Before any real use
- Replace `lib/db.ts` with a real database (JSON file is not safe for concurrent writes).
- Store uploads in object storage; add rate limiting and login throttling.
- Run `npm run build` first. This code was written without being compiled, so expect to fix type errors.
- Don't give any AI auto-execution on a funded account without hard risk limits and per-trade confirmation. Signals and analysis are not guaranteed to be profitable.
