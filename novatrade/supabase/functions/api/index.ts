import "../_shared/server/env.ts";
import { HttpError, json } from "../_shared/server/http.ts";
import { requestContext } from "../_shared/server/context.ts";
import { ROUTES } from "./routes.generated.ts";

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  // Auth is a bearer token in a header (no cookies), so a wildcard is safe when no allow-list is configured.
  const allow = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Supabase passes /api/... (or /functions/v1/api/... behind some proxies). Strip the function prefix.
  const path = ("/" + url.pathname.replace(/^\/(functions\/v1\/)?api(?=\/|$)/, "").replace(/^\/+/, "")).replace(/\/+$/, "") || "/";
  for (const r of ROUTES) {
    const params = match(r.pattern, path);
    if (!params) continue;
    const h = r.module[req.method as "GET"];
    if (!h) return json({ error: "Method not allowed." }, 405);
    return await requestContext.run({ req }, () => h(req, { params }));
  }
  return json({ error: "Not found." }, 404);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  let res: Response;
  try { res = await handle(req); }
  catch (e) { res = e instanceof HttpError ? json({ error: e.message }, e.status) : json({ error: "Something went wrong on the server." }, 500); }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});
