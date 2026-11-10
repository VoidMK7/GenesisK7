# Deploy on Vercel
1. Put this folder in a GitHub repo (or run `vercel` from it).
2. Vercel > Project > Settings > Environment Variables:
   - SUPABASE_URL       = https://xxxx.supabase.co            (public)
   - SUPABASE_ANON_KEY  = anon / publishable key              (public, NOT service-role)
   Optional, only for the /api/tick trigger: CRON_SECRET (same as your Supabase function secret) and TICK_TOKEN (any long random string).
3. Deploy. Build command and output folder are already set in vercel.json.
Also add your Vercel URL to ALLOWED_ORIGINS in your Supabase function secrets so the browser is allowed to call it.
