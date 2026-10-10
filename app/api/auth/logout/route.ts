import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "../../../lib/auth.ts";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbLogout } from "../../../lib/auth-service.ts";

export async function POST(request: NextRequest) {
  // OA-U2: DB store also revokes this token's jti server-side.
  if (isDbStore()) return runDbHandler(request, dbLogout, false);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
