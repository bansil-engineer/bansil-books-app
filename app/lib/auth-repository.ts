// ============================================================
// Bansil Books — OA-U2 Auth Repository (DB-backed user store)
//
// All mutations:
//   - run inside BEGIN IMMEDIATE … COMMIT (atomic, serialized)
//   - write their audit row in the SAME transaction (no orphan
//     changes without history, no history without the change)
//   - bump session_version whenever role, permissions, status or
//     credentials change → every previously issued JWT for that user
//     is rejected by resolvePrincipal() on its next server check.
//
// Never returns, logs or audits passwords, hashes, salts or raw
// invitation tokens. The only place a raw invitation token leaves
// this module is the return value of issueInvitation()/createUser(),
// which the Owner-only API hands back ONCE for out-of-band delivery.
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import {
  checkPasswordPolicy,
  dummyVerifyAsync,
  hashPasswordAsync,
  needsRehash,
  verifyPasswordAsync,
  wrapLegacyHash,
} from "./auth-password.ts";
import {
  ASSIGNABLE_ROLES,
  capToViewerCeiling,
  diffPermissionCategories,
  grantsToModuleStrings,
  parsePermissions,
  type PermissionGrant,
  type Role,
} from "./auth-permissions.ts";

export const INVITE_TTL_HOURS = 72;
export const RESET_TTL_HOURS = 24;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserStatus = "invited" | "active" | "deactivated";

/** Safe projection — contains NO credential material. */
export interface PublicUser {
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  isOwner: boolean;
  modules: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  pendingInvitation: { purpose: "invite" | "reset"; expiresAt: string } | null;
}

/** Internal record used for session checks. Not exported to clients. */
export interface UserRecord {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  isOwner: boolean;
  sessionVersion: number;
  modules: string[];
}

export interface ActorContext {
  email: string;
  role: string;
  /** Server-generated; never taken from the client. */
  correlationId: string;
  /** Optional validated client-supplied request id (informational). */
  clientRequestId?: string | null;
}

export type RepoError = {
  ok: false;
  code: "invalid" | "not_found" | "conflict" | "forbidden" | "expired";
  error: string;
};
export type RepoResult<T> = ({ ok: true } & T) | RepoError;

const fail = (code: RepoError["code"], error: string): RepoError => ({ ok: false, code, error });

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

interface UserRow {
  id: number;
  email: string;
  email_normalized: string;
  name: string;
  role: Role;
  status: UserStatus;
  is_owner: number;
  password_hash: string | null;
  session_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export class AuthRepository {
  // Explicit fields (not constructor parameter properties) so this file runs
  // under `node --experimental-strip-types`, the repo's test runner.
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  // ---------------------------------------------------------------- utils

  private iso(): string {
    return this.now().toISOString();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Append an audit row. Callers inside tx() get atomicity for free. */
  audit(entry: {
    actor: ActorContext | null;
    targetEmail: string | null;
    action: string;
    categories?: string[];
    result: "success" | "denied" | "error";
    detail?: string | null;
    correlationId?: string;
    clientRequestId?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO auth_audit_log
           (correlation_id, client_request_id, occurred_at, actor_email, actor_role, target_email, action,
            changed_categories, result, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.actor?.correlationId ?? entry.correlationId ?? "none",
        entry.actor?.clientRequestId ?? entry.clientRequestId ?? null,
        this.iso(),
        entry.actor ? normalizeEmail(entry.actor.email) : null,
        entry.actor?.role ?? null,
        entry.targetEmail ? normalizeEmail(entry.targetEmail) : null,
        entry.action,
        JSON.stringify(entry.categories ?? []),
        entry.result,
        entry.detail ? String(entry.detail).slice(0, 300) : null,
      );
  }

  private row(email: string): UserRow | undefined {
    return this.db
      .prepare("SELECT * FROM auth_users WHERE email_normalized = ?")
      .get(normalizeEmail(email)) as unknown as UserRow | undefined;
  }

  private grants(userId: number): PermissionGrant[] {
    const rows = this.db
      .prepare("SELECT module, functions FROM auth_user_permissions WHERE user_id = ? ORDER BY module")
      .all(userId) as Array<{ module: string; functions: string }>;
    return rows.map((r) => ({
      module: r.module,
      functions: r.functions === "*" ? "*" : r.functions.split(","),
    }));
  }

  private writeGrants(userId: number, grants: PermissionGrant[]): void {
    this.db.prepare("DELETE FROM auth_user_permissions WHERE user_id = ?").run(userId);
    const ins = this.db.prepare(
      "INSERT INTO auth_user_permissions (user_id, module, functions) VALUES (?, ?, ?)",
    );
    for (const g of grants) {
      ins.run(userId, g.module, g.functions === "*" ? "*" : g.functions.join(","));
    }
  }

  private bumpSession(userId: number): void {
    this.db
      .prepare("UPDATE auth_users SET session_version = session_version + 1, updated_at = ? WHERE id = ?")
      .run(this.iso(), userId);
  }

  private pendingInvitation(userId: number): PublicUser["pendingInvitation"] {
    const r = this.db
      .prepare(
        `SELECT purpose, expires_at FROM auth_invitations
          WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(userId, this.iso()) as { purpose: "invite" | "reset"; expires_at: string } | undefined;
    return r ? { purpose: r.purpose, expiresAt: r.expires_at } : null;
  }

  private toPublic(r: UserRow): PublicUser {
    return {
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status,
      isOwner: r.is_owner === 1,
      modules: r.role === "super_admin" ? ["*"] : grantsToModuleStrings(this.grants(r.id)),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastLoginAt: r.last_login_at,
      pendingInvitation: this.pendingInvitation(r.id),
    };
  }

  private toRecord(r: UserRow): UserRecord {
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status,
      isOwner: r.is_owner === 1,
      sessionVersion: r.session_version,
      modules: r.role === "super_admin" ? ["*"] : grantsToModuleStrings(this.grants(r.id)),
    };
  }

  private newInvitation(userId: number, purpose: "invite" | "reset", createdBy: string) {
    // Any outstanding token for this user is revoked — at most one live link.
    this.db
      .prepare(
        "UPDATE auth_invitations SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
      )
      .run(this.iso(), userId);
    const raw = randomBytes(32).toString("base64url");
    const ttl = purpose === "invite" ? INVITE_TTL_HOURS : RESET_TTL_HOURS;
    const expiresAt = new Date(this.now().getTime() + ttl * 3600_000).toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_invitations (user_id, purpose, token_hash, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, purpose, hashInvitationToken(raw), normalizeEmail(createdBy), this.iso(), expiresAt);
    return { token: raw, expiresAt };
  }

  // ---------------------------------------------------------------- reads

  hasActiveOwner(): boolean {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM auth_users WHERE is_owner = 1 AND status = 'active'")
      .get() as { n: number };
    return r.n === 1;
  }

  countUsers(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM auth_users").get() as { n: number }).n;
  }

  listUsers(): PublicUser[] {
    const rows = this.db
      .prepare("SELECT * FROM auth_users ORDER BY is_owner DESC, email_normalized")
      .all() as unknown as UserRow[];
    return rows.map((r) => this.toPublic(r));
  }

  getUser(email: string): PublicUser | null {
    const r = this.row(email);
    return r ? this.toPublic(r) : null;
  }

  getUserRecord(email: string): UserRecord | null {
    const r = this.row(email);
    return r ? this.toRecord(r) : null;
  }

  listAudit(limit = 200): Array<Record<string, unknown>> {
    const n = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT id, correlation_id, client_request_id, occurred_at, actor_email, actor_role, target_email, action,
                changed_categories, result, detail
           FROM auth_audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(n) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...r, changed_categories: JSON.parse(String(r.changed_categories)) }));
  }

  // ---------------------------------------------------------------- authentication

  /**
   * Verify credentials. Only ACTIVE users with a password can log in.
   * Upgrades legacy hash parameters transparently on success.
   */
  async authenticate(email: unknown, password: unknown, correlationId: string): Promise<UserRecord | null> {
    if (typeof email !== "string" || typeof password !== "string" || password.length > 1024) {
      return null;
    }
    const r = this.row(email);
    if (!r || r.status !== "active" || !r.password_hash) {
      await dummyVerifyAsync(password);
      this.audit({
        actor: null,
        correlationId,
        targetEmail: r ? r.email : null,
        action: "auth.login",
        result: "denied",
        detail: r ? `account ${r.status}` : "unknown account",
      });
      return null;
    }
    if (!(await verifyPasswordAsync(password, r.password_hash))) {
      this.audit({
        actor: null,
        correlationId,
        targetEmail: r.email,
        action: "auth.login",
        result: "denied",
        detail: "bad credentials",
      });
      return null;
    }
    const upgrade = needsRehash(r.password_hash) ? await hashPasswordAsync(password) : null;
    let committed = false;
    this.tx(() => {
      // Conditional on the state we verified against: if the account was
      // deactivated or its password changed while hashing ran, login fails.
      const res = this.db
        .prepare(
          `UPDATE auth_users SET last_login_at = ?, password_hash = COALESCE(?, password_hash)
            WHERE id = ? AND status = 'active' AND password_hash = ?`,
        )
        .run(this.iso(), upgrade, r.id, r.password_hash);
      committed = Number(res.changes) === 1;
      this.audit({
        actor: committed ? { email: r.email, role: r.role, correlationId } : null,
        correlationId,
        targetEmail: r.email,
        action: "auth.login",
        categories: committed && upgrade ? ["credential_parameters_upgraded"] : [],
        result: committed ? "success" : "denied",
        detail: committed ? null : "account changed during login",
      });
    });
    return committed ? this.toRecord(this.row(email)!) : null;
  }

  revokeToken(jti: string, expUnix: number, actor: ActorContext): void {
    this.tx(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO auth_revoked_tokens (jti, expires_at, revoked_at) VALUES (?, ?, ?)")
        .run(jti, expUnix, this.iso());
      // Opportunistic purge of revocations that can no longer matter.
      this.db
        .prepare("DELETE FROM auth_revoked_tokens WHERE expires_at < ?")
        .run(Math.floor(this.now().getTime() / 1000) - 60);
      this.audit({ actor, targetEmail: actor.email, action: "auth.logout", result: "success" });
    });
  }

  isTokenRevoked(jti: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM auth_revoked_tokens WHERE jti = ?").get(jti);
  }

  // ---------------------------------------------------------------- management (Owner-only callers)

  async createUser(
    actor: ActorContext,
    input: { email: unknown; name: unknown; role: unknown; modules: unknown; password?: unknown },
  ): Promise<RepoResult<{ user: PublicUser; invitation: { token: string; expiresAt: string } | null }>> {
    const email = typeof input.email === "string" ? input.email.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) return fail("invalid", "A valid email is required");
    if (!name || name.length > 120) return fail("invalid", "Name is required (max 120 characters)");
    if (typeof input.role !== "string" || !ASSIGNABLE_ROLES.includes(input.role as Role)) {
      // Covers any attempt to create a second super_admin.
      this.audit({ actor, targetEmail: email, action: "user.create", result: "denied", detail: "role not assignable" });
      return fail("forbidden", `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`);
    }
    const role = input.role as Role;
    const parsed = parsePermissions(input.modules ?? [], role);
    if (!parsed.ok) return fail("invalid", parsed.error);

    let passwordHash: string | null = null;
    if (input.password !== undefined && input.password !== null && input.password !== "") {
      const policy = checkPasswordPolicy(input.password, email);
      if (!policy.ok) return fail("invalid", policy.error);
      passwordHash = await hashPasswordAsync(input.password as string);
    }

    if (this.row(email)) {
      this.audit({ actor, targetEmail: email, action: "user.create", result: "denied", detail: "duplicate email" });
      return fail("conflict", "User with this email already exists");
    }

    const now = this.iso();
    const status: UserStatus = passwordHash ? "active" : "invited";
    let invitation: { token: string; expiresAt: string } | null = null;
    try {
      invitation = this.createTx(actor, { email, name, role, status, passwordHash, now, grants: parsed.grants });
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        this.audit({ actor, targetEmail: email, action: "user.create", result: "denied", detail: "duplicate email" });
        return fail("conflict", "User with this email already exists");
      }
      throw err;
    }
    return { ok: true, user: this.getUser(email)!, invitation };
  }

  private createTx(
    actor: ActorContext,
    v: { email: string; name: string; role: Role; status: UserStatus; passwordHash: string | null; now: string;
         grants: PermissionGrant[] },
  ): { token: string; expiresAt: string } | null {
    const { email, name, role, status, passwordHash, now } = v;
    let invitation: { token: string; expiresAt: string } | null = null;
    this.tx(() => {
      const res = this.db
        .prepare(
          `INSERT INTO auth_users
             (email, email_normalized, name, role, status, is_owner, password_hash, session_version,
              created_at, created_by, updated_at, password_changed_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?)`,
        )
        .run(email, normalizeEmail(email), name, role, status, passwordHash, now, normalizeEmail(actor.email), now,
          passwordHash ? now : null);
      const id = Number(res.lastInsertRowid);
      this.writeGrants(id, v.grants);
      if (!passwordHash) invitation = this.newInvitation(id, "invite", actor.email);
      this.audit({
        actor,
        targetEmail: email,
        action: "user.create",
        categories: ["identity", "role", "module_permissions", "function_permissions", "status",
          passwordHash ? "credentials" : "invitation"],
        result: "success",
        detail: `role=${role}; status=${status}`,
      });
    });
    return invitation;
  }

  updateUser(
    actor: ActorContext,
    input: { email: unknown; name?: unknown; role?: unknown; modules?: unknown },
  ): RepoResult<{ user: PublicUser; changed: string[] }> {
    if (typeof input.email !== "string") return fail("invalid", "email is required");
    const r = this.row(input.email);
    if (!r) return fail("not_found", "User not found");

    const changed: string[] = [];
    let name = r.name;
    if (input.name !== undefined) {
      const n = typeof input.name === "string" ? input.name.trim() : "";
      if (!n || n.length > 120) return fail("invalid", "Name is required (max 120 characters)");
      if (n !== r.name) {
        name = n;
        changed.push("identity");
      }
    }

    const wantsRole = input.role !== undefined && input.role !== r.role;
    const wantsPerms = input.modules !== undefined;

    if (r.is_owner === 1 && (wantsRole || wantsPerms)) {
      this.audit({ actor, targetEmail: r.email, action: "user.update", result: "denied", detail: "owner is protected" });
      return fail("forbidden", "The Owner account's role and permissions cannot be changed");
    }
    if (normalizeEmail(actor.email) === r.email_normalized && (wantsRole || wantsPerms)) {
      this.audit({ actor, targetEmail: r.email, action: "user.update", result: "denied", detail: "self-elevation" });
      return fail("forbidden", "You cannot change your own role or permissions");
    }

    let role = r.role;
    if (wantsRole) {
      if (typeof input.role !== "string" || !ASSIGNABLE_ROLES.includes(input.role as Role)) {
        this.audit({ actor, targetEmail: r.email, action: "user.update", result: "denied", detail: "role not assignable" });
        return fail("forbidden", `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`);
      }
      role = input.role as Role;
      changed.push("role");
    }

    const before = this.grants(r.id);
    let after = before;
    if (wantsPerms || wantsRole) {
      // Re-validate permissions against the (possibly new) role so a role
      // change can never leave out-of-ceiling grants behind.
      const parsed = parsePermissions(
        wantsPerms ? input.modules : grantsToModuleStrings(before),
        role,
      );
      if (!parsed.ok) return fail("invalid", parsed.error);
      after = parsed.grants;
      changed.push(...diffPermissionCategories(before, after));
    }

    if (changed.length === 0) return { ok: true, user: this.toPublic(r), changed };

    const rightsChanged = changed.some((c) => c !== "identity");
    this.tx(() => {
      this.db
        .prepare("UPDATE auth_users SET name = ?, role = ?, updated_at = ? WHERE id = ?")
        .run(name, role, this.iso(), r.id);
      if (wantsPerms || wantsRole) this.writeGrants(r.id, after);
      if (rightsChanged) this.bumpSession(r.id);
      this.audit({ actor, targetEmail: r.email, action: "user.update", categories: changed, result: "success" });
    });
    return { ok: true, user: this.getUser(r.email)!, changed };
  }

  setActive(actor: ActorContext, email: unknown, active: boolean): RepoResult<{ user: PublicUser }> {
    if (typeof email !== "string") return fail("invalid", "email is required");
    const r = this.row(email);
    const action = active ? "user.activate" : "user.deactivate";
    if (!r) return fail("not_found", "User not found");
    if (r.is_owner === 1) {
      this.audit({ actor, targetEmail: r.email, action, result: "denied", detail: "owner is protected" });
      return fail("forbidden", "The Owner account cannot be deactivated");
    }
    if (normalizeEmail(actor.email) === r.email_normalized) {
      this.audit({ actor, targetEmail: r.email, action, result: "denied", detail: "self" });
      return fail("forbidden", "You cannot change your own account status");
    }
    if (active) {
      if (r.status === "active") return { ok: true, user: this.toPublic(r) };
      if (!r.password_hash) {
        return fail("conflict", "User has not set a password yet; issue an invitation instead");
      }
    } else if (r.status === "deactivated") {
      return { ok: true, user: this.toPublic(r) };
    }

    this.tx(() => {
      this.db
        .prepare("UPDATE auth_users SET status = ?, updated_at = ? WHERE id = ?")
        .run(active ? "active" : "deactivated", this.iso(), r.id);
      if (!active) {
        this.db
          .prepare(
            "UPDATE auth_invitations SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
          )
          .run(this.iso(), r.id);
      }
      this.bumpSession(r.id); // revokes every outstanding session immediately
      this.audit({ actor, targetEmail: r.email, action, categories: ["status"], result: "success" });
    });
    return { ok: true, user: this.getUser(r.email)! };
  }

  issueInvitation(
    actor: ActorContext,
    email: unknown,
    purpose: "invite" | "reset",
  ): RepoResult<{ token: string; expiresAt: string; resent: boolean }> {
    if (typeof email !== "string") return fail("invalid", "email is required");
    if (purpose !== "invite" && purpose !== "reset") return fail("invalid", "purpose must be invite or reset");
    const r = this.row(email);
    if (!r) return fail("not_found", "User not found");
    if (r.is_owner === 1) {
      this.audit({ actor, targetEmail: r.email, action: `invitation.${purpose}`, result: "denied", detail: "owner is protected" });
      return fail("forbidden", "Owner credentials cannot be reset through user management");
    }
    if (purpose === "invite" && r.status !== "invited") {
      return fail("conflict", "User has already accepted an invitation; use a password reset instead");
    }
    if (purpose === "reset" && r.status !== "active") {
      return fail("conflict", "Password resets can only be issued for active users");
    }
    const resent = this.pendingInvitation(r.id) !== null;
    let out = { token: "", expiresAt: "" };
    this.tx(() => {
      out = this.newInvitation(r.id, purpose, actor.email);
      this.audit({
        actor,
        targetEmail: r.email,
        action: resent ? "invitation.resend" : "invitation.issue",
        categories: ["invitation"],
        result: "success",
        detail: `purpose=${purpose}; expires=${out.expiresAt}`,
      });
    });
    return { ok: true, ...out, resent };
  }

  cancelInvitations(actor: ActorContext, email: unknown): RepoResult<{ cancelled: number }> {
    if (typeof email !== "string") return fail("invalid", "email is required");
    const r = this.row(email);
    if (!r) return fail("not_found", "User not found");
    let cancelled = 0;
    this.tx(() => {
      const res = this.db
        .prepare(
          "UPDATE auth_invitations SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
        )
        .run(this.iso(), r.id);
      cancelled = Number(res.changes);
      this.audit({
        actor,
        targetEmail: r.email,
        action: "invitation.cancel",
        categories: ["invitation"],
        result: "success",
        detail: `cancelled=${cancelled}`,
      });
    });
    return { ok: true, cancelled };
  }

  /**
   * Public, token-authenticated: set a password from an invitation or
   * reset link. Single-use; expired/used/revoked tokens are rejected.
   */
  async acceptInvitation(rawToken: unknown, password: unknown, correlationId: string): Promise<RepoResult<{ email: string }>> {
    if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 200) {
      return fail("invalid", "Invalid or expired link");
    }
    const inv = this.db
      .prepare(
        `SELECT i.id, i.user_id, i.purpose, i.expires_at, i.used_at, i.revoked_at, u.email, u.status
           FROM auth_invitations i JOIN auth_users u ON u.id = i.user_id
          WHERE i.token_hash = ?`,
      )
      .get(hashInvitationToken(rawToken)) as
      | { id: number; user_id: number; purpose: string; expires_at: string; used_at: string | null;
          revoked_at: string | null; email: string; status: UserStatus }
      | undefined;

    const deny = (detail: string, target: string | null): RepoError => {
      this.audit({ actor: null, correlationId, targetEmail: target, action: "invitation.accept", result: "denied", detail });
      return fail("expired", "Invalid or expired link");
    };
    if (!inv) return deny("unknown token", null);
    if (inv.used_at) return deny("already used", inv.email);
    if (inv.revoked_at) return deny("revoked", inv.email);
    if (inv.expires_at <= this.iso()) return deny("expired", inv.email);
    if (inv.status === "deactivated") return deny("account deactivated", inv.email);
    if (inv.purpose === "invite" && inv.status !== "invited") return deny("state mismatch", inv.email);
    if (inv.purpose === "reset" && inv.status !== "active") return deny("state mismatch", inv.email);

    const policy = checkPasswordPolicy(password, inv.email);
    if (!policy.ok) return fail("invalid", policy.error);
    const hash = await hashPasswordAsync(password as string);

    try {
      this.acceptTx(inv, hash, correlationId);
    } catch {
      return deny("lost race / already consumed", inv.email);
    }
    return { ok: true, email: inv.email };
  }

  private acceptTx(
    inv: { id: number; user_id: number; purpose: string; email: string },
    hash: string,
    correlationId: string,
  ): void {
    this.tx(() => {
      // Re-check single-use inside the write lock (race-safe).
      const claim = this.db
        .prepare("UPDATE auth_invitations SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL")
        .run(this.iso(), inv.id);
      if (Number(claim.changes) !== 1) throw new Error("invitation already consumed");
      // Conditional on the account state this link was issued for (it may
      // have been deactivated while the password was being hashed).
      const expected = inv.purpose === "invite" ? "invited" : "active";
      const upd = this.db
        .prepare(
          `UPDATE auth_users SET password_hash = ?, status = 'active', password_changed_at = ?, updated_at = ?
            WHERE id = ? AND status = ?`,
        )
        .run(hash, this.iso(), this.iso(), inv.user_id, expected);
      if (Number(upd.changes) !== 1) throw new Error("account state changed");
      this.db
        .prepare(
          "UPDATE auth_invitations SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
        )
        .run(this.iso(), inv.user_id);
      this.bumpSession(inv.user_id);
      this.audit({
        actor: { email: inv.email, role: "self", correlationId },
        targetEmail: inv.email,
        action: inv.purpose === "invite" ? "invitation.accept" : "password.reset",
        categories: inv.purpose === "invite" ? ["credentials", "status"] : ["credentials"],
        result: "success",
      });
    });
  }

  async changeOwnPassword(
    actor: ActorContext,
    currentPassword: unknown,
    newPassword: unknown,
  ): Promise<RepoResult<{ user: UserRecord }>> {
    const r = this.row(actor.email);
    if (!r || r.status !== "active" || !r.password_hash) return fail("forbidden", "Account is not active");
    if (typeof currentPassword !== "string" || currentPassword.length > 1024 ||
        !(await verifyPasswordAsync(currentPassword, r.password_hash))) {
      this.audit({ actor, targetEmail: r.email, action: "password.change", result: "denied", detail: "bad current password" });
      return fail("forbidden", "Current password is incorrect");
    }
    const policy = checkPasswordPolicy(newPassword, r.email);
    if (!policy.ok) return fail("invalid", policy.error);
    if (newPassword === currentPassword) {
      return fail("invalid", "New password must differ from the current password");
    }
    const hash = await hashPasswordAsync(newPassword as string);
    let committed = false;
    this.tx(() => {
      // Conditional: nobody else changed the password / status meanwhile.
      const res = this.db
        .prepare(
          `UPDATE auth_users SET password_hash = ?, password_changed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active' AND password_hash = ?`,
        )
        .run(hash, this.iso(), this.iso(), r.id, r.password_hash);
      committed = Number(res.changes) === 1;
      if (!committed) return;
      this.bumpSession(r.id);
      this.audit({ actor, targetEmail: r.email, action: "password.change", categories: ["credentials"], result: "success" });
    });
    if (!committed) return fail("conflict", "Account changed during the request; please try again");
    return { ok: true, user: this.getUserRecord(r.email)! };
  }

  // ---------------------------------------------------------------- migration

  /**
   * Import the AUTH_USERS JSON (env store) into an EMPTY auth DB.
   * Fails closed — imports nothing — on any invalid record. Hashes are
   * carried over verbatim (legacy params) so existing passwords keep
   * working; they are upgraded on first DB-mode login.
   */
  importFromAuthUsersJson(
    raw: string,
    actor: ActorContext,
  ): RepoResult<{
    imported: number;
    owner: string;
    summary: Array<{ email: string; role: string; modules: number; cappedToViewerCeiling: boolean }>;
  }> {
    if (this.countUsers() > 0) return fail("conflict", "auth.db already contains users; refusing to import");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail("invalid", "AUTH_USERS is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return fail("invalid", "AUTH_USERS must be a non-empty array");

    type Prepared = { email: string; name: string; role: Role; hash: string; grants: PermissionGrant[]; capped: boolean };
    const prepared: Prepared[] = [];
    const seen = new Set<string>();
    for (const [i, u] of parsed.entries()) {
      const rec = u as Record<string, unknown>;
      const where = `record #${i + 1}`;
      if (typeof rec.email !== "string" || !EMAIL_RE.test(rec.email.trim())) return fail("invalid", `${where}: invalid email`);
      const email = rec.email.trim();
      if (seen.has(normalizeEmail(email))) return fail("invalid", `${where}: duplicate email`);
      seen.add(normalizeEmail(email));
      if (typeof rec.name !== "string" || !rec.name.trim()) return fail("invalid", `${where}: missing name`);
      if (rec.role !== "super_admin" && rec.role !== "admin" && rec.role !== "viewer") {
        return fail("invalid", `${where}: unsupported role`);
      }
      const hash = wrapLegacyHash(String(rec.salt ?? ""), String(rec.hash ?? ""));
      if (!hash) return fail("invalid", `${where}: malformed credential fields`);
      let grants: PermissionGrant[] = [];
      let capped = false;
      if (rec.role !== "super_admin") {
        // Legacy viewers may hold whole-module grants. Narrow them to the
        // viewer ceiling (never widen) and report it, rather than failing
        // the import and pressuring an operator to promote them to admin.
        let modules: unknown = rec.modules ?? [];
        if (rec.role === "viewer") {
          const c = capToViewerCeiling(modules);
          modules = c.modules;
          capped = c.capped;
        }
        const p = parsePermissions(modules, rec.role as Role);
        if (!p.ok) return fail("invalid", `${where}: ${p.error}`);
        grants = p.grants;
      }
      prepared.push({ email, name: rec.name.trim(), role: rec.role as Role, hash, grants, capped });
    }
    const owners = prepared.filter((p) => p.role === "super_admin");
    if (owners.length !== 1) {
      return fail("invalid", `AUTH_USERS must contain exactly one super_admin (found ${owners.length})`);
    }

    const now = this.iso();
    this.tx(() => {
      for (const p of prepared) {
        const res = this.db
          .prepare(
            `INSERT INTO auth_users
               (email, email_normalized, name, role, status, is_owner, password_hash, session_version,
                created_at, created_by, updated_at)
             VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, 'migration:AUTH_USERS', ?)`,
          )
          .run(p.email, normalizeEmail(p.email), p.name, p.role, p.role === "super_admin" ? 1 : 0, p.hash, now, now);
        this.writeGrants(Number(res.lastInsertRowid), p.grants);
        this.audit({
          actor,
          targetEmail: p.email,
          action: "store.migrate_user",
          categories: ["identity", "role", "module_permissions", "function_permissions", "credentials"],
          result: "success",
          detail: `source=AUTH_USERS; role=${p.role}${p.capped ? "; viewer grants capped to view/export" : ""}`,
        });
      }
    });
    return {
      ok: true,
      imported: prepared.length,
      owner: owners[0].email,
      summary: prepared.map((p) => ({
        email: p.email,
        role: p.role,
        modules: p.grants.length,
        cappedToViewerCeiling: p.capped,
      })),
    };
  }
}
