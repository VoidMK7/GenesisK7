// Runs on Vercel at build time. Publishes ONLY index.html (never supabase/, tests/ etc.) and writes your PUBLIC Supabase values into it.
import fs from "node:fs";
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel > Project > Settings > Environment Variables."); process.exit(1); }
try { const p = key.split("."); if (p.length === 3 && JSON.parse(Buffer.from(p[1], "base64url").toString()).role === "service_role") { console.error("That is a service-role key. Use the anon/publishable key only."); process.exit(1); } } catch { /* not a JWT: fine */ }
let h = fs.readFileSync("index.html", "utf8"); const before = 'supabaseUrl: "", supabaseAnonKey: ""';
if (!h.includes(before)) { console.error("Config line not found in index.html"); process.exit(1); }
fs.rmSync("dist", { recursive: true, force: true }); fs.mkdirSync("dist");
for (const f of ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png"]) if (fs.existsSync(f)) fs.copyFileSync(f, "dist/" + f);
fs.writeFileSync("dist/index.html", h.replace(before, `supabaseUrl: ${JSON.stringify(url)}, supabaseAnonKey: ${JSON.stringify(key)}`)); console.log("dist/index.html configured for", new URL(url).host);
