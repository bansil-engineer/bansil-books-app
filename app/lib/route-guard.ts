// ============================================================
// Bansil Books — OA-RBAC-2a Centralized Server-side Route Guard
//
// One guard for API route handlers. Next.js-free (standard Request /
// Response), so it is testable with plain `node` and works for handlers
// typed with either `Request` or `NextRequest`.
//
// Every guarded request re-checks CURRENT server-side state — it never
// trusts role / module / identity claims carried in the JWT or the body:
//
//   env store (default, AUTH_USERS):
//     1. bansil_auth JWT: HMAC-SHA256 signature + expiry (verifyToken)
//     2. user must still exist in the LIVE AUTH_USERS configuration
//     3. role + module/function grants read from that live record
//   db store (AUTH_USER_STORE=db):
//     1. same JWT checks
//     2. resolvePrincipal(): user exists, status = active, session_version
//        matches the token's `sv` (bumped on deactivation, role/permission
//        change, password change/reset), jti not revoked (logout)
//     3. role + grants read live from auth.db
//   invalid store value → 503 (fail closed)
//
// Responses: 401 = not authenticated / session invalid (auth cookie cleared)
//            403 = authenticated but not permitted
//
// This guard ADDS a layer. It never replaces existing route checks such
// as the Owner passphrase session (requireOwnerSession*), feature flags,
// local-host gates or same-origin checks — those still run afterwards.
// ============================================================

import { AUTH_COOKIE_NAME, findUser, verifyToken } from "./auth.ts";
import { isAllowed } from "./auth-permissions.ts";
import { getAuthRepository, getUserStoreMode } from "./auth-store.ts";
import { resolvePrincipal } from "./auth-service.ts";
import { randomUUID } from "node:crypto";
import { MODULE_FUNCTIONS } from "./auth.ts";

/** Business actions a route can declare. */
export type RouteAction =
  | "view" | "create" | "edit" | "delete" | "export"
  | "approve" | "reject" | "manage" | "sync";

/**
 * Explicit action → approved permission-function mapping. Only actions that
 * map 1:1 to the APPROVED function set (view/add/edit/delete/export) can be
 * delegated through module grants. approve / reject / manage / sync have no
 * approved grant yet: they are Owner-only until the Owner approves them.
 */
export const ACTION_TO_FUNCTION: Readonly<Partial<Record<RouteAction, string>>> = {
  view: "view",
  create: "add",
  edit: "edit",
  delete: "delete",
  export: "export",
};

export type RouteClassification =
  | "PUBLIC"
  | "AUTHENTICATED"
  | "OWNER_ONLY"
  | "MODULE_RESTRICTED"
  | "SPECIAL_GOVERNANCE";

/**
 * An additional grant that also satisfies a MODULE_RESTRICTED route — e.g. the
 * Dashboard reads the reconciliation report, so dashboard:view also opens
 * GET /api/reconciliation. `requireQuery` narrows the alternative to requests
 * whose query parameters EXACTLY match (each key present once, equal value),
 * e.g. dashboard:view may read /api/transactions only with type=recent.
 * `allowQueryKeys` (when set) is an allowlist: the request may carry ONLY
 * these keys plus the `requireQuery` keys — any other parameter (filters,
 * drill-downs) means the alternative does not apply.
 */
export interface AlternativeGrant {
  module: string;
  action: RouteAction;
  requireQuery?: Readonly<Record<string, string>>;
  allowQueryKeys?: readonly string[];
}

export interface GuardPolicy {
  classification: RouteClassification;
  /** MODULE_RESTRICTED only. */
  module?: string;
  /** MODULE_RESTRICTED only. */
  action?: RouteAction;
  /** MODULE_RESTRICTED only: other grants that also satisfy this route. */
  alsoAllow?: readonly AlternativeGrant[];
  /**
   * Optional object/project scope check, evaluated after role/module checks.
   * Return false → 403. (No project-scoped data model exists yet; reserved.)
   */
  scope?: (principal: GuardPrincipal, request: Request) => boolean | Promise<boolean>;
}

export interface GuardPrincipal {
  email: string;
  name: string;
  role: string;
  modules: string[];
  isOwner: boolean;
  store: "env" | "db";
}

export type GuardResult =
  | { ok: true; principal: GuardPrincipal | null }
  | { ok: false; status: 401 | 403 | 503; response: Response };

const FUNCTION_SET = new Set<string>(MODULE_FUNCTIONS);

/**
 * Read one cookie. Returns "AMBIGUOUS" when the cookie appears more than once:
 * different parsers pick different occurrences, so the guard and later code
 * could disagree about the identity — such requests are rejected.
 */
function readCookie(request: Request, name: string): string | undefined | "AMBIGUOUS" {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  let found: string | undefined;
  let count = 0;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      count++;
      const raw = part.slice(i + 1).trim();
      try {
        found = decodeURIComponent(raw);
      } catch {
        found = raw;
      }
    }
  }
  return count > 1 ? "AMBIGUOUS" : found;
}

/** True when AUTH_USERS is present and is a JSON array of objects with string emails. */
function authUsersConfigValid(): boolean {
  const raw = process.env.AUTH_USERS;
  if (!raw) return false;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((u) => u && typeof u === "object" && typeof u.email === "string");
  } catch {
    return false;
  }
}

/** True when the principal holds `alt` and the request matches its query scope. */
function alternativeAllows(principal: GuardPrincipal, alt: AlternativeGrant, request: Request): boolean {
  const fn = ACTION_TO_FUNCTION[alt.action];
  if (!alt.module || !fn || !FUNCTION_SET.has(fn)) return false;
  if (!isAllowed(principal.role, principal.modules, alt.module, fn)) return false;
  if (alt.requireQuery || alt.allowQueryKeys) {
    let params: URLSearchParams;
    try {
      params = new URL(request.url).searchParams;
    } catch {
      return false;
    }
    if (alt.allowQueryKeys) {
      const allowed = new Set<string>([...alt.allowQueryKeys, ...Object.keys(alt.requireQuery ?? {})]);
      for (const k of params.keys()) if (!allowed.has(k)) return false; // extra filter / drill-down → not the Dashboard
      for (const k of alt.allowQueryKeys) if (params.getAll(k).length > 1) return false;
    }
    for (const [k, v] of Object.entries(alt.requireQuery ?? {})) {
      const all = params.getAll(k);
      if (all.length !== 1 || all[0] !== v) return false; // duplicate or different value → not in scope
    }
  }
  return true;
}

function deny(status: 401 | 403 | 503, error: string): GuardResult {
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
  if (status === 401) {
    headers.append(
      "Set-Cookie",
      `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
        process.env.NODE_ENV === "production" ? "; Secure" : ""
      }`,
    );
  }
  return {
    ok: false,
    status,
    response: new Response(JSON.stringify({ success: false, error }), { status, headers }),
  };
}

/** Resolve the CURRENT server-side identity for this request (no authorization yet). */
export function resolveRequestPrincipal(
  request: Request,
): { ok: true; principal: GuardPrincipal } | { ok: false; status: 401 | 503; reason: string } {
  const mode = getUserStoreMode();
  if (mode === "invalid") return { ok: false, status: 503, reason: "user store misconfigured" };
  const token = readCookie(request, AUTH_COOKIE_NAME);
  if (token === "AMBIGUOUS") return { ok: false, status: 401, reason: "duplicate session cookies" };
  if (!token) return { ok: false, status: 401, reason: "no session" };

  if (mode === "db") {
    const pr = resolvePrincipal(getAuthRepository(), token);
    if (!pr.ok) return { ok: false, status: 401, reason: pr.reason };
    const p = pr.principal;
    return {
      ok: true,
      principal: {
        email: p.email,
        name: p.name,
        role: p.role,
        modules: p.modules,
        isOwner: p.role === "super_admin" && p.isOwner,
        store: "db",
      },
    };
  }

  // env store: signature + expiry, then the LIVE AUTH_USERS record.
  // A missing/malformed AUTH_USERS is a server misconfiguration: fail closed
  // with 503 and do NOT clear the caller's cookie (it may be perfectly valid).
  if (!authUsersConfigValid()) return { ok: false, status: 503, reason: "AUTH_USERS misconfigured" };
  const payload = verifyToken(token);
  if (!payload || typeof payload.sub !== "string") {
    return { ok: false, status: 401, reason: "invalid or expired token" };
  }
  const user = findUser(payload.sub);
  if (!user) return { ok: false, status: 401, reason: "user no longer exists" };
  return {
    ok: true,
    principal: {
      email: user.email,
      name: user.name,
      role: user.role, // live — the JWT role claim is NOT used for authorization
      modules: Array.isArray(user.modules) ? user.modules : [],
      isOwner: user.role === "super_admin",
      store: "env",
    },
  };
}

function auditDenial(principal: GuardPrincipal, routeKey: string, detail: string): void {
  if (principal.store !== "db") return;
  try {
    getAuthRepository().audit({
      actor: { email: principal.email, role: principal.role, correlationId: randomUUID() },
      targetEmail: null,
      action: "access.denied",
      result: "denied",
      detail: `${routeKey}: ${detail}`.slice(0, 300),
    });
  } catch {
    /* audit failure must never turn a denial into an allow */
  }
}

/**
 * Authorize a request against a policy. Call at the very top of a route
 * handler, before reading the body or touching any data:
 *
 *   const g = await guardRoute(request, policyFor("audit/cash", "POST"), "audit/cash POST");
 *   if (!g.ok) return g.response;
 */
export async function guardRoute(request: Request, policy: GuardPolicy, routeKey = "route"): Promise<GuardResult> {
  if (policy.classification === "PUBLIC") return { ok: true, principal: null };

  let resolved: ReturnType<typeof resolveRequestPrincipal>;
  try {
    resolved = resolveRequestPrincipal(request);
  } catch (err) {
    // e.g. auth.db cannot be opened: fail closed, never open.
    console.error("[route-guard] principal resolution failed:", err instanceof Error ? err.message : "unknown error");
    return deny(503, "Authorization service unavailable");
  }
  if (!resolved.ok) {
    return resolved.status === 503 ? deny(503, "Authentication is temporarily unavailable") : deny(401, "Unauthorized");
  }
  const principal = resolved.principal;

  switch (policy.classification) {
    case "AUTHENTICATED":
      break;
    case "OWNER_ONLY":
    case "SPECIAL_GOVERNANCE":
      if (!principal.isOwner) {
        auditDenial(principal, routeKey, "owner only");
        return deny(403, "Forbidden. Only the Owner can perform this action.");
      }
      break;
    case "MODULE_RESTRICTED": {
      const fn = policy.action ? ACTION_TO_FUNCTION[policy.action] : undefined;
      // Unmapped action or malformed policy → Owner only (deny by default).
      if (!policy.module || !fn || !FUNCTION_SET.has(fn)) {
        if (!principal.isOwner) {
          auditDenial(principal, routeKey, "unmapped action");
          return deny(403, "Forbidden.");
        }
        break;
      }
      if (
        !principal.isOwner &&
        !isAllowed(principal.role, principal.modules, policy.module, fn) &&
        !(policy.alsoAllow ?? []).some((alt) => alternativeAllows(principal, alt, request))
      ) {
        auditDenial(principal, routeKey, `${policy.module}:${fn}`);
        return deny(403, "Forbidden.");
      }
      break;
    }
    default:
      // Unknown classification: fail closed.
      return deny(403, "Forbidden.");
  }

  if (policy.scope) {
    let inScope = false;
    try {
      inScope = await policy.scope(principal, request);
    } catch {
      inScope = false;
    }
    if (!inScope) {
      auditDenial(principal, routeKey, "out of scope");
      return deny(403, "Forbidden.");
    }
  }
  return { ok: true, principal };
}
