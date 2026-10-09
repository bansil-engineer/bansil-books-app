// ============================================================
// Next.js route-layer enforcement for the OWNER-ONLY session gate.
// Kept separate from owner-auth.ts (which has zero Next.js dependency
// and must stay importable from plain node test scripts).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { isValidOwnerSession, OWNER_ACTOR, OWNER_SESSION_COOKIE } from "./owner-auth.ts";
import { verifyTokenEdge } from "../auth-edge.ts";

/** Cookie name for the general authentication JWT — must match middleware.ts. */
const AUTH_COOKIE = "bansil_auth";

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

/**
 * Stricter gate for Zoho sync / connection management routes.
 *
 * THREE-LAYER defense-in-depth:
 *   1. JWT cookie must be present and cryptographically valid (401 if not).
 *   2. JWT role must be "super_admin" (403 if not — identity binding).
 *   3. Valid Owner session cookie must be present (403 if not — passphrase gate).
 *
 * Returns 401 for unauthenticated requests, 403 for authenticated-but-
 * not-authorized requests, or null when the request may proceed.
 *
 * This function is async because JWT verification uses Web Crypto API.
 */
export async function requireOwnerSessionOrForbid(req: NextRequest): Promise<NextResponse | null> {
  // ---- Layer 1: JWT presence and cryptographic verification ----
  // Middleware has already checked this, but defense-in-depth:
  // if a request somehow bypasses middleware, the guard still rejects.
  const jwt = req.cookies.get(AUTH_COOKIE)?.value;
  if (!jwt) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  const payload = await verifyTokenEdge(jwt);
  if (!payload) {
    return NextResponse.json(
      { success: false, error: "Unauthorized. Invalid or expired credentials." },
      { status: 401 }
    );
  }

  // ---- Layer 2: Role-based identity binding ----
  // Only super_admin users may perform privileged Zoho/sync operations.
  // The role comes from a server-signed HMAC-SHA256 JWT — it is NOT
  // a client-provided value. A forged JWT would fail Layer 1 above.
  if (payload.role !== "super_admin") {
    return NextResponse.json(
      { success: false, error: "Forbidden. Only the Owner can perform this action." },
      { status: 403 }
    );
  }

  // ---- Layer 3: Owner session passphrase gate ----
  // Even a super_admin must hold a valid Owner session (obtained by
  // entering the Owner passphrase). This prevents a super_admin whose
  // session cookie was stolen from being used without re-authentication.
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  if (!isValidOwnerSession(token)) {
    return NextResponse.json(
      { success: false, error: "Forbidden. Only the Owner can perform this action." },
      { status: 403 }
    );
  }

  return null;
}

export { OWNER_ACTOR };
