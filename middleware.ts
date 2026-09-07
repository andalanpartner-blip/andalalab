import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/cookie-name";

/**
 * Edge middleware (P2.20-B/L).
 *
 * Two jobs:
 *   1. Fast redirect to /login when there is NO session cookie at all (the
 *      cryptographic check happens server-side in the routes/pages, which run
 *      on Node). This only prunes obviously-unauthenticated page loads.
 *   2. Security headers on every response.
 *
 * It never trusts the cookie's contents — only its presence.
 */

// `/` is the public marketing page; the private product lives at /dashboard,
// /project/* and /login (all still guarded below).
const PUBLIC_PATHS = ["/", "/login", "/api/auth/login"];
const PUBLIC_PREFIXES = ["/_next/", "/favicon", "/api/auth/", "/opengraph-image", "/robots", "/sitemap"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return res;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return withSecurityHeaders(NextResponse.next());

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasCookie) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ status: "ERROR", message: "Sign in to continue." }, { status: 401 })
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
