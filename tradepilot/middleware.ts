import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Refreshes the Supabase session cookie and requires login on protected paths.
// Role checks happen in pages/API routes (lib/auth.ts) and, ultimately, in database RLS.
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}
export const config = {
  matcher: ["/chat/:path*", "/trade/:path*", "/signals/:path*", "/connectors/:path*", "/api/trades/:path*", "/api/connections/:path*", "/api/risk/:path*", "/api/strategies/:path*", "/api/simulate/:path*", "/teach/:path*", "/admin/:path*", "/api/teach/:path*", "/api/admin/:path*", "/api/chat/:path*"],
};
