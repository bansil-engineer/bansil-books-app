import { NextRequest, NextResponse } from "next/server";
import { verifyTokenEdge } from "@/app/lib/auth-edge";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/status",
  "/api/zoho/callback",
  // OA-U2: invitation/reset acceptance (token-authenticated; 404 unless AUTH_USER_STORE=db)
  "/invite",
  "/api/auth/invitations/accept",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public auth paths
  if (isPublicPath(pathname)) return NextResponse.next();

  // Allow Next.js internals and static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".woff2")
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const token = request.cookies.get("bansil_auth")?.value;

  if (!token) {
    if (!pathname.startsWith("/api/")) {
      const url = new URL("/login", request.url);
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ================================================================
  // P0 SECURITY FIX: Full HMAC-SHA256 signature verification
  //
  // Previously this block only checked JWT structure and expiration,
  // allowing forged tokens with valid structure to pass through.
  // Now uses Web Crypto API (Edge-compatible) to cryptographically
  // verify the signature before allowing any request through.
  //
  // FAIL CLOSED: any verification failure → reject immediately.
  // ================================================================
  const payload = await verifyTokenEdge(token);

  if (!payload) {
    // Token is invalid: malformed, expired, forged, or bad signature.
    // Clear the cookie so the browser doesn't keep sending it.
    if (!pathname.startsWith("/api/")) {
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.delete("bansil_auth");
      return res;
    }
    const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    res.cookies.delete("bansil_auth");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
