// Optional Vercel Function (Hobby-friendly): a thin trigger that wakes the Supabase agents. It does almost no work itself
// (two small fetches, well under 1s of CPU), because the heavy, time-boxed work runs inside the Supabase Edge Function.
//
// Env vars (Vercel project settings):  SUPABASE_URL  CRON_SECRET  TICK_TOKEN
//   TICK_TOKEN is a separate secret you give to whatever calls this URL, so CRON_SECRET never leaves your servers.
//
// Hobby plan facts to plan around: Vercel's own cron can run at most ONCE PER DAY on Hobby. For per-minute trader alerts use
// Supabase pg_cron (supabase/optional/cron_schedule.TEMPLATE.sql) or a free external pinger (e.g. cron-job.org) calling
//   GET https://<your-app>.vercel.app/api/tick?token=<TICK_TOKEN>
export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  const { SUPABASE_URL, CRON_SECRET, TICK_TOKEN } = process.env;
  if (!SUPABASE_URL || !CRON_SECRET || !TICK_TOKEN) return res.status(503).json({ error: "Set SUPABASE_URL, CRON_SECRET and TICK_TOKEN." });
  const given = (req.headers.authorization || "").replace(/^Bearer /, "") || req.query.token || "";
  // Vercel's own cron sends  Authorization: Bearer <CRON_SECRET>  automatically when CRON_SECRET is set on the project.
  if (given !== TICK_TOKEN && given !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized." });
  const base = SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/api/cron";
  const call = (path) => fetch(`${base}/${path}`, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(8500) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ error: String(e && e.message || e) }));
  // Run in parallel so total wall time stays inside the 10s default function limit.
  const [watch, agents] = await Promise.all([call("watch?budget=7000"), call("memecoin?budget=7000")]);
  res.status(200).json({ watch, agents });
}
