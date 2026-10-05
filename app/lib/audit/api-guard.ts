// ============================================================
// Next.js route-layer enforcement for the OWNER-ONLY session gate.
// Kept separate from owner-auth.ts (which has zero Next.js dependency
// and must stay importable from plain node test scripts).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { isValidOwnerSession, OWNER_ACTOR, OWNER_SESSION_COOKIE } from "./owner-auth.ts";

/**
 * Default-deny gate for every privileged audit-module mutation route.
 * Returns a 401 NextResponse to send back immediately when unauthorized;
 * returns null when the request may proceed. The caller must always use
 * OWNER_ACTOR (not any client-supplied body field) as the actor/approver
 * identity for the resulting write — this function's only job is to
 * decide whether that identity is even allowed to act right now.
 */
export function requireOwnerSession(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  if (!isValidOwnerSession(token)) {
    return NextResponse.json(
      { success: false, error: "Not authorized. Sign in as the local owner to perform this action." },
      { status: 401 }
    );
  }
  return null;
}

export { OWNER_ACTOR };
