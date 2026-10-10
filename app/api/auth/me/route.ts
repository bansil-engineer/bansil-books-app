import { NextRequest, NextResponse } from "next/server";
import { verifyToken, AUTH_COOKIE_NAME } from "../../../lib/auth.ts";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbMe } from "../../../lib/auth-service.ts";

export async function GET(request: NextRequest) {
  // OA-U2: DB store returns LIVE role/modules and rejects revoked sessions.
  if (isDbStore()) return runDbHandler(request, dbMe, false);

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const payload = verifyToken(token);
  if (!payload) {
    const res = NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    res.cookies.set(AUTH_COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return res;
  }

  return NextResponse.json({
    email: payload.sub,
    name: payload.name,
    role: payload.role,
    modules: payload.modules,
  });
}
