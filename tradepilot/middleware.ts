import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Coarse gate: must hold a valid session cookie. Role checks happen server-side
// in pages and API routes (lib/auth.ts), because roles are stored in the database.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("tp_session")?.value;
  const secret = process.env.AUTH_SECRET;
  let ok = false;
  if (token && secret) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      ok = true;
    } catch {}
  }
  if (!ok) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}
export const config = {
  matcher: ["/chat/:path*", "/teach/:path*", "/admin/:path*", "/api/teach/:path*", "/api/admin/:path*", "/api/chat/:path*"],
};
