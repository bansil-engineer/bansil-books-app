import { NextRequest, NextResponse } from "next/server";
import { verifyToken, AUTH_COOKIE_NAME } from "../../../lib/auth.ts";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbStatus } from "../../../lib/auth-service.ts";

export async function GET(request: NextRequest) {
  if (isDbStore()) return runDbHandler(request, dbStatus, false);

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ authenticated: false });

  const payload = verifyToken(token);
  if (!payload) return NextResponse.json({ authenticated: false });

  return NextResponse.json({
    authenticated: true,
    user: {
      email: payload.sub,
      name: payload.name,
      role: payload.role,
    },
  });
}
