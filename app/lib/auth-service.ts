// ============================================================
// Bansil Books — OA-U2 Auth Service (Next.js-free request handlers)
//
// Every DB-store endpoint is implemented here as a pure function of
// (repository, request context) → ServiceResult, so it can be tested
// with plain `node` against isolated temp databases. The route files
// under app/api/auth/** are thin adapters (see auth-guard.ts).
//
// Security invariants enforced here:
//   - JWT signature + expiry verified (verifyToken, timing-safe)
//   - DB-store tokens must carry sv + jti; sv must equal the user's
//     current session_version; jti must not be revoked
//   - user must exist and be ACTIVE on every request (live DB read)
//   - permissions are read live from the DB, never trusted from the JWT
//   - management endpoints: Owner only (super_admin AND is_owner)
//   - responses never contain hashes, salts or AUTH_USERS JSON
// ============================================================

import { randomUUID } from "node:crypto";
import { createToken, verifyToken, type JWTPayload } from "./auth.ts";
import { isAllowed } from "./auth-permissions.ts";
import { KdfBusyError } from "./auth-password.ts";
import type { ActorContext, AuthRepository, RepoError, UserRecord } from "./auth-repository.ts";

/** DB-store sessions are shorter than env-store ones (24h) to bound exposure. */
export const DB_SESSION_TTL_HOURS = 8;

export interface RequestContext {
  cookie(name: string): string | undefined;
  header(name: string): string | null;
  body?: unknown;
}

export type CookieOp = { action: "set"; value: string; maxAge: number } | { action: "clear" };

export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
  cookie?: CookieOp;
  correlationId: string;
}

export interface Principal {
  email: string;
  name: string;
  role: string;
  modules: string[];
  isOwner: boolean;
  jti: string;
  exp: number;
  user: UserRecord;
}

export const AUTH_COOKIE = "bansil_auth";
const CID_RE = /^[A-Za-z0-9._:-]{8,80}$/;

/**
 * Correlation IDs are ALWAYS server-generated, so a client cannot make an
 * unrelated audit row share an Owner action's ID. The context is accepted
 * for call-site symmetry only.
 */
export function correlationIdFrom(_ctx: RequestContext): string {
  return randomUUID();
}

/** Client-supplied request id (validated) — stored separately, informational. */
export function clientRequestIdFrom(ctx: RequestContext): string | null {
  for (const h of ["x-correlation-id", "x-request-id", "rndr-id"]) {
    const v = ctx.header(h);
    if (v && CID_RE.test(v)) return v;
  }
  return null;
}

/**
 * CSRF defence-in-depth for state-changing endpoints (beyond SameSite=Lax):
 *   - reject cross-site browser requests (Sec-Fetch-Site / Origin vs Host)
 *   - require application/json for body-bearing requests, so a plain HTML
 *     form (text/plain, x-www-form-urlencoded) can never reach the handler.
 */
export function csrfReject(ctx: RequestContext, cid: string, requireJson: boolean): ServiceResult | null {
  const sfs = ctx.header("sec-fetch-site");
  if (sfs) {
    // Browser-asserted provenance (all current browsers send it). Preferred
    // over Origin-vs-Host, which depends on proxy header behaviour.
    if (sfs !== "same-origin" && sfs !== "none") return json(403, { error: "Cross-site request rejected" }, cid);
    return requireJson && !(ctx.header("content-type") ?? "").toLowerCase().startsWith("application/json")
      ? json(415, { error: "Content-Type must be application/json" }, cid)
      : null;
  }
  const origin = ctx.header("origin");
  const host = ctx.header("x-forwarded-host") ?? ctx.header("host");
  if (origin && origin !== "null" && host) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return json(403, { error: "Cross-site request rejected" }, cid);
    }
    if (originHost.toLowerCase() !== host.split(",")[0].trim().toLowerCase()) {
      return json(403, { error: "Cross-site request rejected" }, cid);
    }
  } else if (origin === "null") {
    return json(403, { error: "Cross-site request rejected" }, cid);
  }
  if (requireJson) {
    const ct = (ctx.header("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) {
      return json(415, { error: "Content-Type must be application/json" }, cid);
    }
  }
  return null;
}

const busy = (cid: string): ServiceResult =>
  json(429, { error: "Too many sign-in requests right now. Please retry in a few seconds." }, cid);

const json = (status: number, body: Record<string, unknown>, cid: string, cookie?: CookieOp): ServiceResult => ({
  status,
  body,
  correlationId: cid,
  cookie,
});

const repoErrorStatus: Record<RepoError["code"], number> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  expired: 400,
};

function fromRepoError(e: RepoError, cid: string): ServiceResult {
  return json(repoErrorStatus[e.code], { error: e.error }, cid);
}

// ------------------------------------------------------------------ session

export type PrincipalResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401; reason: string };

/** Full server-side session check against the live DB. */
export function resolvePrincipal(repo: AuthRepository, token: string | undefined): PrincipalResult {
  if (!token) return { ok: false, status: 401, reason: "no token" };
  const payload: JWTPayload | null = verifyToken(token);
  if (!payload) return { ok: false, status: 401, reason: "invalid or expired token" };
  if (typeof payload.sv !== "number" || typeof payload.jti !== "string") {
    // Env-store token presented to the DB store → must log in again.
    return { ok: false, status: 401, reason: "token not issued by DB store" };
  }
  if (repo.isTokenRevoked(payload.jti)) return { ok: false, status: 401, reason: "token revoked" };
  const user = repo.getUserRecord(payload.sub);
  if (!user) return { ok: false, status: 401, reason: "unknown user" };
  if (user.status !== "active") return { ok: false, status: 401, reason: "account not active" };
  if (user.sessionVersion !== payload.sv) return { ok: false, status: 401, reason: "session superseded" };
  return {
    ok: true,
    principal: {
      email: user.email,
      name: user.name,
      role: user.role,
      modules: user.modules, // LIVE from DB, not from the JWT
      isOwner: user.isOwner,
      jti: payload.jti,
      exp: payload.exp,
      user,
    },
  };
}

function issueSession(user: UserRecord): CookieOp {
  const token = createToken(
    { email: user.email, name: user.name, role: user.role, modules: user.modules },
    DB_SESSION_TTL_HOURS,
    { sv: user.sessionVersion, jti: randomUUID() },
  );
  return { action: "set", value: token, maxAge: DB_SESSION_TTL_HOURS * 3600 };
}

// Per-request values are passed explicitly (no module-level state), so
// concurrent async requests can never mix up audit attribution.
const actorOf = (p: Principal, cid: string, ctx: RequestContext): ActorContext => ({
  email: p.email,
  role: p.role,
  correlationId: cid,
  clientRequestId: clientRequestIdFrom(ctx),
});

/** Owner-only gate for user management. Denials are audited. */
function requireOwner(
  repo: AuthRepository,
  ctx: RequestContext,
  cid: string,
  action: string,
): { ok: true; principal: Principal } | { ok: false; result: ServiceResult } {
  const pr = resolvePrincipal(repo, ctx.cookie(AUTH_COOKIE));
  if (!pr.ok) {
    return { ok: false, result: json(401, { error: "Unauthorized" }, cid, { action: "clear" }) };
  }
  if (pr.principal.role !== "super_admin" || !pr.principal.isOwner) {
    repo.audit({
      actor: actorOf(pr.principal, cid, ctx),
      targetEmail: null,
      action,
      result: "denied",
      detail: "not owner",
    });
    return { ok: false, result: json(403, { error: "Forbidden" }, cid) };
  }
  return { ok: true, principal: pr.principal };
}

/** Generic deny-by-default module/function check for data routes (RBAC Phase 2). */
export function authorizeAccess(
  repo: AuthRepository,
  ctx: RequestContext,
  mod: string,
  fn: string,
): { ok: true; principal: Principal } | { ok: false; result: ServiceResult } {
  const cid = correlationIdFrom(ctx);
  const pr = resolvePrincipal(repo, ctx.cookie(AUTH_COOKIE));
  if (!pr.ok) return { ok: false, result: json(401, { error: "Unauthorized" }, cid, { action: "clear" }) };
  if (!isAllowed(pr.principal.role, pr.principal.modules, mod, fn)) {
    repo.audit({
      actor: actorOf(pr.principal, cid, ctx),
      targetEmail: null,
      action: "access.denied",
      result: "denied",
      detail: `${mod}:${fn}`,
    });
    return { ok: false, result: json(403, { error: "Forbidden" }, cid) };
  }
  return { ok: true, principal: pr.principal };
}

function body(ctx: RequestContext): Record<string, unknown> {
  return ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
}

const publicSession = (u: { email: string; name: string; role: string; modules: string[] }) => ({
  email: u.email,
  name: u.name,
  role: u.role,
  modules: u.modules,
});

// ------------------------------------------------------------------ endpoints

export async function dbLogin(repo: AuthRepository, ctx: RequestContext): Promise<ServiceResult> {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true); // also blocks login-CSRF
  if (csrf) return csrf;
  const { email, password } = body(ctx);
  if (!email || !password) return json(400, { error: "Email and password are required" }, cid);
  if (!repo.hasActiveOwner()) {
    // Fail closed — never fall back to AUTH_USERS silently.
    return json(503, { error: "User store is not initialized. Contact the Owner." }, cid);
  }
  let user: UserRecord | null;
  try {
    user = await repo.authenticate(email, password, cid);
  } catch (err) {
    if (err instanceof KdfBusyError) return busy(cid);
    throw err;
  }
  if (!user) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    return json(401, { error: "Invalid email or password" }, cid);
  }
  return json(200, { ok: true, user: publicSession(user) }, cid, issueSession(user));
}

export function dbLogout(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, false);
  if (csrf) return csrf;
  const pr = resolvePrincipal(repo, ctx.cookie(AUTH_COOKIE));
  if (pr.ok) repo.revokeToken(pr.principal.jti, pr.principal.exp, actorOf(pr.principal, cid, ctx));
  return json(200, { ok: true }, cid, { action: "clear" });
}

export function dbMe(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const pr = resolvePrincipal(repo, ctx.cookie(AUTH_COOKIE));
  if (!pr.ok) return json(401, { error: "Not authenticated" }, cid, { action: "clear" });
  return json(200, publicSession(pr.principal), cid);
}

export function dbStatus(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const pr = resolvePrincipal(repo, ctx.cookie(AUTH_COOKIE));
  if (!pr.ok) return json(200, { authenticated: false }, cid);
  const p = pr.principal;
  return json(200, { authenticated: true, user: { email: p.email, name: p.name, role: p.role } }, cid);
}

export async function dbChangePassword(repo: AuthRepository, ctx: RequestContext): Promise<ServiceResult> {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true);
  if (csrf) return csrf;
  const pr = resolvePrincipal(repo, ctx.cookie(AUTH_COOKIE));
  if (!pr.ok) return json(401, { error: "Not authenticated" }, cid, { action: "clear" });
  const { currentPassword, newPassword } = body(ctx);
  if (!currentPassword || !newPassword) {
    return json(400, { error: "Both current and new password are required" }, cid);
  }
  let res;
  try {
    res = await repo.changeOwnPassword(actorOf(pr.principal, cid, ctx), currentPassword, newPassword);
  } catch (err) {
    if (err instanceof KdfBusyError) return busy(cid);
    throw err;
  }
  if (!res.ok) return fromRepoError(res, cid);
  // All other sessions are revoked (session_version bumped); re-issue this one.
  return json(200, { ok: true, message: "Password changed. Other sessions have been signed out." }, cid,
    issueSession(res.user));
}

export function dbUsersGet(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const g = requireOwner(repo, ctx, cid, "user.list");
  if (!g.ok) return g.result;
  return json(200, { store: "db", users: repo.listUsers() }, cid);
}

export async function dbUsersPost(repo: AuthRepository, ctx: RequestContext): Promise<ServiceResult> {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true);
  if (csrf) return csrf;
  const g = requireOwner(repo, ctx, cid, "user.create");
  if (!g.ok) return g.result;
  const b = body(ctx);
  let res;
  try {
    res = await repo.createUser(actorOf(g.principal, cid, ctx), {
      email: b.email,
      name: b.name,
      role: b.role,
      modules: b.modules,
      password: b.password,
    });
  } catch (err) {
    if (err instanceof KdfBusyError) return busy(cid);
    throw err;
  }
  if (!res.ok) return fromRepoError(res, cid);
  return json(201, {
    ok: true,
    store: "db",
    user: res.user,
    // Returned ONCE for out-of-band delivery; only its hash is stored.
    invitation: res.invitation
      ? { path: `/invite#token=${res.invitation.token}`, expiresAt: res.invitation.expiresAt }
      : null,
  }, cid);
}

export function dbUsersPatch(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true);
  if (csrf) return csrf;
  const g = requireOwner(repo, ctx, cid, "user.update");
  if (!g.ok) return g.result;
  const b = body(ctx);
  const actor = actorOf(g.principal, cid, ctx);
  if (b.action === "activate" || b.action === "deactivate") {
    const res = repo.setActive(actor, b.email, b.action === "activate");
    if (!res.ok) return fromRepoError(res, cid);
    return json(200, { ok: true, user: res.user }, cid);
  }
  if (b.action !== undefined && b.action !== "update") return json(400, { error: "Unknown action" }, cid);
  const res = repo.updateUser(actor, { email: b.email, name: b.name, role: b.role, modules: b.modules });
  if (!res.ok) return fromRepoError(res, cid);
  return json(200, { ok: true, user: res.user, changed: res.changed }, cid);
}

export function dbUsersDelete(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, false);
  if (csrf) return csrf;
  const g = requireOwner(repo, ctx, cid, "user.delete");
  if (!g.ok) return g.result;
  return json(405, {
    error: "Users are never deleted in the database store (history is preserved). Deactivate the user instead.",
  }, cid);
}

export function dbInvitationsPost(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true);
  if (csrf) return csrf;
  const g = requireOwner(repo, ctx, cid, "invitation.issue");
  if (!g.ok) return g.result;
  const b = body(ctx);
  const res = repo.issueInvitation(actorOf(g.principal, cid, ctx), b.email, b.purpose === "reset" ? "reset" : "invite");
  if (!res.ok) return fromRepoError(res, cid);
  return json(201, {
    ok: true,
    resent: res.resent,
    invitation: { path: `/invite#token=${res.token}`, expiresAt: res.expiresAt },
  }, cid);
}

export function dbInvitationsDelete(repo: AuthRepository, ctx: RequestContext): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true);
  if (csrf) return csrf;
  const g = requireOwner(repo, ctx, cid, "invitation.cancel");
  if (!g.ok) return g.result;
  const res = repo.cancelInvitations(actorOf(g.principal, cid, ctx), body(ctx).email);
  if (!res.ok) return fromRepoError(res, cid);
  return json(200, { ok: true, cancelled: res.cancelled }, cid);
}

/** PUBLIC (token-authenticated). */
export async function dbInvitationAccept(repo: AuthRepository, ctx: RequestContext): Promise<ServiceResult> {
  const cid = correlationIdFrom(ctx);
  const csrf = csrfReject(ctx, cid, true);
  if (csrf) return csrf;
  const { token, password } = body(ctx);
  let res;
  try {
    res = await repo.acceptInvitation(token, password, cid);
  } catch (err) {
    if (err instanceof KdfBusyError) return busy(cid);
    throw err;
  }
  if (!res.ok) {
    if (res.code === "expired") await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    return fromRepoError(res, cid);
  }
  return json(200, { ok: true, message: "Password set. You can now sign in." }, cid);
}

export function dbAuditGet(repo: AuthRepository, ctx: RequestContext, limit: number): ServiceResult {
  const cid = correlationIdFrom(ctx);
  const g = requireOwner(repo, ctx, cid, "audit.read");
  if (!g.ok) return g.result;
  return json(200, { entries: repo.listAudit(limit) }, cid);
}
