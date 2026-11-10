// Builds ONE self-contained index.html: React + the app are bundled in (no CDN for them); only supabase-js loads from a CDN.
// Usage: node tools/build.mjs [out.html]       (needs esbuild; React/ReactDOM resolved from node_modules)
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, "..");
const out = path.resolve(process.argv[2] || path.join(root, "dist/index.html"));
const NM = process.env.NM_DIR || (fs.existsSync("/opt/npm-tools/node_modules/esbuild") ? "/opt/npm-tools/node_modules" : path.join(root, "node_modules"));
const { build } = createRequire(NM + "/x.js")("esbuild");
const r = await build({ entryPoints: [path.join(root, "src/main.jsx")], bundle: true, write: false, minify: true, format: "iife", target: "es2020", jsx: "transform", loader: { ".css": "css" }, nodePaths: [NM], define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", outdir: path.join(root, ".esb") });
const js = r.outputFiles.find((f) => f.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script"); const css = r.outputFiles.find((f) => f.path.endsWith(".css"))?.text || "";
const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07111B">
<title>NovaTrade</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<!-- =====================  CONFIGURATION (public values only)  =====================
     Supabase > Project Settings > API: paste the Project URL and the ANON / publishable key.
     NEVER put a service-role key or any secret here. Leave empty and the app still opens (market data only). -->
<script>window.NOVATRADE_CONFIG = { supabaseUrl: "", supabaseAnonKey: "" };</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
<style>${css}</style>
</head>
<body><div id="root"><p style="padding:24px;font-family:sans-serif;color:#8FA3B5">Loading NovaTrade…</p></div>
<noscript><p style="padding:24px">NovaTrade needs JavaScript.</p></noscript>
<script>${js}</script>
</body></html>`;
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html); fs.rmSync(path.join(root, ".esb"), { recursive: true, force: true });
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB)`);
