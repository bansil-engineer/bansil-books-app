import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/setup", "/api/auth/status", "/api/zoho/callback"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function middleware(request: NextRequest) {
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

  // Basic JWT structure + expiration check (Edge Runtime cannot use
  // node:crypto, so full signature verification happens in API routes)
  const parts = token.split(".");
  if (parts.length !== 3) {
    if (!pathname.startsWith("/api/")) {
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.delete("bansil_auth");
      return res;
    }
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      const res = !pathname.startsWith("/api/")
        ? NextResponse.redirect(new URL("/login", request.url))
        : NextResponse.json({ error: "Token expired" }, { status: 401 });
      res.cookies.delete("bansil_auth");
      return res;
    }
  } catch {
    // If payload parse fails, let it through — API route will reject
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
