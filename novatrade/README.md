# NovaTrade frontend — one file

`dist/index.html` is the whole app. Open it, or host it anywhere static (Vercel Hobby is fine).
Edit the two public values near the top of the file:

```js
window.NOVATRADE_CONFIG = { supabaseUrl: "https://xxxx.supabase.co", supabaseAnonKey: "<anon key>" };
```
Never put a service-role key here. With them empty the app still opens and shows live market data from DexScreener.

Rebuild from source (needs esbuild; React is bundled in, only supabase-js loads from a CDN):
`NM_DIR=/path/to/node_modules node tools/build.mjs dist/index.html`

Screens: Home, Agents (+ Top traders / auto-follow), Activity (trade log with reasons), Token detail, Market, Social (Feed, Community, Chat, People), Profile (edit picture + 1–10 s banner), Wallets, Teach your AI, Copy terminal (light theme), My AI model, Notifications, Account.
`src/core` is a copy of the backend's memecoin logic so the browser and server agree.
