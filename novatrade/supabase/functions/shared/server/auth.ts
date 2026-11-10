import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { currentRequest } from "./context.ts";
import { HttpError } from "./http.ts";

/** Service-role client. Bypasses RLS: use only for writes the browser must never perform, always scoped by user id. */
export function serviceDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, "The server is not configured for database writes (SUPABASE_SERVICE_ROLE_KEY).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface Session {
  userId: string;
  email: string | null;
  /** Client bound to the user's session; respects RLS. */
  db: SupabaseClient;
}

export async function requireUser(): Promise<Session> {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new HttpError(503, "Supabase is not configured.");
  const header = currentRequest()?.headers.get("authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in required.");
  // A client carrying the caller's JWT, so reads made through it are subject to Row Level Security.
  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Sign in required.");
  return { userId: data.user.id, email: data.user.email ?? null, db };
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireUser();
  // Check with the service client so the answer cannot be influenced by RLS policy gaps.
  const { data, error } = await serviceDb().from("user_roles").select("role").eq("user_id", s.userId).eq("role", "admin").maybeSingle();
  if (error || !data) throw new HttpError(403, "Administrators only.");
  return s;
}

export async function securityEvent(userId: string | null, kind: string, detail: Record<string, unknown> = {}) {
  try {
    await serviceDb().from("nova_security_events").insert({ user_id: userId, kind, detail });
  } catch { /* logging must never break the request */ }
}

export async function notify(userId: string, kind: string, title: string, bodyText?: string) {
  try {
    await serviceDb().from("nova_notifications").insert({ user_id: userId, kind, title, body: bodyText ?? null });
  } catch { /* best effort */ }
}

export async function countApi(provider: string, failed = false) {
  try {
    const db = serviceDb();
    const day = new Date().toISOString().slice(0, 10);
    const { data } = await db.from("nova_api_usage").select("calls,errors").eq("day", day).eq("provider", provider).maybeSingle();
    await db.from("nova_api_usage").upsert({ day, provider, calls: (data?.calls ?? 0) + 1, errors: (data?.errors ?? 0) + (failed ? 1 : 0) });
  } catch { /* best effort */ }
}
