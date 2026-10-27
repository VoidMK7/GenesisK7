import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Per-request client that acts AS the logged-in user (row-level security applies).
export function supabaseServer() {
  const store = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component; middleware refreshes the session */ }
      },
    },
  });
}

// Bypasses RLS. SERVER ONLY, never import into client components.
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
