// ============================================================
// Bansil Books — OA-U2 Next.js adapters for the auth service
//
// Keeps route handlers to a few lines: build a RequestContext from
// the NextRequest, call the Next-free service, convert the result.
// All responses are `Cache-Control: no-store` and carry
// `x-correlation-id` (matches the auth_audit_log row).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, AUTH_COOKIE_NAME } from "./auth.ts";
import { isAllowed } from "./auth-permissions.ts";
import { getAuthRepository, getUserStoreMode } from "./auth-store.ts";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S, DEVICE_COOKIE_PATH } from "./auth-ratelimit.ts";
import { authorizeAccess, type Principal, type RequestContext, type ServiceResult } from "./auth-service.ts";

export async function contextFromRequest(req: NextRequest, withBody = true): Promise<RequestContext> {
  let parsed: unknown = undefined;
  if (withBody) {
    try {
      parsed = await req.json();
    } catch {
      parsed = undefined;
    }
  }
  return {
    cookie: (name) => req.cookies.get(name)?.value,
    header: (name) => req.headers.get(name),
    body: parsed,
  };
}

export function toNextResponse(result: ServiceResult): NextResponse {
  const res = NextResponse.json(result.body, { status: result.status });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("x-correlation-id", result.correlationId);
  for (const [k, v] of Object.entries(result.headers ?? {})) res.headers.set(k, v);
  if (result.deviceCookie) {
    // Known-device cookie (OA-U2-F): only ever sent back to the login endpoint.
    res.cookies.set(DEVICE_COOKIE, result.deviceCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: DEVICE_COOKIE_PATH,
      maxAge: DEVICE_COOKIE_MAX_AGE_S,
    });
  }
  if (result.cookie?.action === "set") {
    res.cookies.set(AUTH_COOKIE_NAME, result.cookie.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: result.cookie.maxAge,
    });
  } else if (result.cookie?.action === "clear") {
    res.cookies.set(AUTH_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}

/**
 * RBAC Phase-2 guard for data routes (NOT yet wired into any data route —
 * see OA-U2 report). Deny-by-default module/function check.
 *
 *   env store: verifies JWT signature/expiry; permissions from JWT claims.
 *   db store : full live check (active, session version, revocation);
 *              permissions read live from auth.db.
 *
 * Usage:  const g = await requireAccess(req, "inventory", "edit");
 *         if (!g.ok) return g.response;
 */
export async function requireAccess(
  req: NextRequest,
  mod: string,
  fn: string,
): Promise<{ ok: true; principal: Pick<Principal, "email" | "role" | "modules"> } | { ok: false; response: NextResponse }> {
  const mode = getUserStoreMode();
  if (mode === "invalid") return { ok: false, response: misconfigured() };
  if (mode === "db") {
    const ctx = await contextFromRequest(req, false);
    const r = authorizeAccess(getAuthRepository(), ctx, mod, fn);
    return r.ok ? { ok: true, principal: r.principal } : { ok: false, response: toNextResponse(r.result) };
  }
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isAllowed(payload.role, payload.modules, mod, fn)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, principal: { email: payload.sub, role: payload.role, modules: payload.modules } };
}

/**
 * True when the request must NOT use the env store: either the DB store is
 * selected, or AUTH_USER_STORE is misconfigured (runDbHandler then 503s).
 */
export function isDbStore(): boolean {
  return getUserStoreMode() !== "env";
}

function misconfigured(): NextResponse {
  console.error("[auth-store] AUTH_USER_STORE has an unsupported value; failing closed (use 'env' or 'db').");
  const res = NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Run a DB-store handler. Any unexpected failure (e.g. auth.db cannot be
 * opened, migration checksum drift) fails CLOSED with a generic 500. The
 * server log line carries only the error message — never request bodies,
 * tokens, passwords or hashes.
 */
export async function runDbHandler(
  req: NextRequest,
  handler: (repo: ReturnType<typeof getAuthRepository>, ctx: RequestContext) => ServiceResult | Promise<ServiceResult>,
  withBody = true,
): Promise<NextResponse> {
  if (getUserStoreMode() === "invalid") return misconfigured();
  try {
    const ctx = await contextFromRequest(req, withBody);
    return toNextResponse(await handler(getAuthRepository(), ctx));
  } catch (err) {
    console.error("[auth-store] DB-store request failed:", err instanceof Error ? err.message : "unknown error");
    const res = NextResponse.json({ error: "Internal server error" }, { status: 500 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}

export { getAuthRepository };
