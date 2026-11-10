// Runs on Vercel at build time: copies public/ to dist/ and writes your PUBLIC Supabase values (from Vercel env vars) into index.html.
import fs from "node:fs";
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel > Project > Settings > Environment Variables."); process.exit(1); }
if (/service_role/i.test(key) || key.split(".").length === 3 && JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "service_role") { console.error("That is a service-role key. Use the anon/publishable key only."); process.exit(1); }
fs.rmSync("dist", { recursive: true, force: true }); fs.cpSync("public", "dist", { recursive: true });
let h = fs.readFileSync("dist/index.html", "utf8");
const before = 'supabaseUrl: "", supabaseAnonKey: ""'; if (!h.includes(before)) { console.error("Config line not found in index.html"); process.exit(1); }
h = h.replace(before, `supabaseUrl: ${JSON.stringify(url)}, supabaseAnonKey: ${JSON.stringify(key)}`);
fs.writeFileSync("dist/index.html", h); console.log("index.html configured for", new URL(url).host);
