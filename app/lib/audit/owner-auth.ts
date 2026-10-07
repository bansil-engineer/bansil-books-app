// ============================================================
// Bansil Books Analytics — OWNER-ONLY Local Authorization
// (Milestone A fix pass — owner-approved minimal model)
//
// DUAL-MODE: Local (SQLite) + Vercel Production (env-var hash).
//
// This application has exactly one authorizable identity: the local
// owner. There is no cloud identity provider, no OAuth scope change,
// no multi-tenant user model — this is a server-side session gate
// backing every privileged Settings > Skills / audit-workspace-write
// operation, so a disabled button on the client is never the only
// protection.
//
// LOCAL:
// - Passphrase is never stored — only a salted scrypt hash, using
//   Node's built-in crypto (no new dependency).
// - Session token is an opaque random value; the server, not the
//   client, is the source of truth for whether it is valid/expired.
// - "actor"/"approved_by" for every privileged write is always the
//   fixed literal OWNER_ACTOR, derived from a *valid session*, never
//   a client-supplied string — see requireOwnerSession() call sites.
//
// VERCEL PRODUCTION:
// - Owner passphrase hash + salt are provisioned via environment
//   variables (OWNER_PASSPHRASE_HASH, OWNER_PASSPHRASE_SALT).
// - No SQLite database is opened or written.
// - Sessions are held in memory (Map) — ephemeral across cold starts,
//   which is acceptable for serverless (sessions are short-lived and
//   the cost of re-authenticating after a cold start is minimal).
// - Bootstrap ("set one-time") is not available on Vercel — the
//   passphrase must be provisioned through env vars.
// - Changing the passphrase on Vercel is not supported at runtime —
//   the owner must update env vars in Vercel dashboard and redeploy.
// ============================================================

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database";

export const OWNER_SESSION_COOKIE = "bansil_owner_session";
export const OWNER_ACTOR = "OWNER";

const SCRYPT_KEY_LENGTH = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---- Environment detection ----
const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

// ---- Vercel in-memory session store ----
// Map<token, expiresAtMs>. Ephemeral — cleared on cold start.
const vercelSessions = new Map<string, number>();

function hashPassphrase(passphrase: string, salt: string): string {
  return scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH).toString("hex");
}

// ---- Vercel env-var credential helpers ----

function getVercelCredential(): { salt: string; hash: string } | null {
  const hash = process.env.OWNER_PASSPHRASE_HASH;
  const salt = process.env.OWNER_PASSPHRASE_SALT;
  if (!hash || !salt) return null;
  return { hash, salt };
}

function verifyPassphraseAgainstEnv(passphrase: string): boolean {
  const cred = getVercelCredential();
  if (!cred) return false;
  const attemptHash = hashPassphrase(passphrase, cred.salt);
  const expected = Buffer.from(cred.hash, "hex");
  const actual = Buffer.from(attemptHash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function createVercelSession(): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAtMs = now.getTime() + SESSION_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  vercelSessions.set(token, expiresAtMs);
  return { token, expiresAt };
}

function isValidVercelSession(token: string | undefined | null): boolean {
  if (!token) return false;
  const nowMs = Date.now();

  // Opportunistic cleanup of expired sessions
  for (const [t, exp] of vercelSessions) {
    if (exp < nowMs) vercelSessions.delete(t);
  }

  const exp = vercelSessions.get(token);
  if (!exp || exp < nowMs) return false;
  return true;
}

function destroyVercelSession(token: string | undefined | null): void {
  if (token) vercelSessions.delete(token);
}

// ---- Local SQLite helper ----
// Static import is safe: node:sqlite exists on Vercel's Node 22 runtime
// (the production error was ENOENT from mkdirSync, not a missing-module
// error), and audit-database.ts top-level code only computes a path
// string. The crash only happens when getAuditDatabase() is CALLED
// (it does mkdirSync + new DatabaseSync), and every Vercel codepath
// skips that call via IS_VERCEL guards above.

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

// ---- Public API (dual-mode) ----

export function isOwnerBootstrapped(conn?: DatabaseSync): boolean {
  if (IS_VERCEL) {
    return getVercelCredential() !== null;
  }
  const row = resolveDb(conn).prepare(`SELECT id FROM audit_owner_credential WHERE id = 'owner'`).get();
  return Boolean(row);
}

/**
 * Returns true when running on Vercel AND the OWNER_PASSPHRASE_HASH /
 * OWNER_PASSPHRASE_SALT env vars are NOT configured. This tells the UI
 * to show a "setup required" message instead of the broken "set
 * one-time" form.
 */
export function isVercelSetupRequired(): boolean {
  return IS_VERCEL && getVercelCredential() === null;
}

export class OwnerAuthError extends Error {}

/**
 * One-time setup: sets the owner passphrase. Refuses if a credential
 * already exists — rotating an existing passphrase is a separate,
 * already-authenticated operation, not exposed by this function, to
 * keep this bootstrap path from ever being usable as a silent takeover.
 *
 * NOT AVAILABLE ON VERCEL — owner credential must be provisioned
 * through environment variables.
 */
export function bootstrapOwnerPassphrase(passphrase: string, conn?: DatabaseSync): void {
  if (IS_VERCEL) {
    throw new OwnerAuthError(
      "Owner passphrase cannot be set at runtime on Vercel. " +
      "Configure OWNER_PASSPHRASE_HASH and OWNER_PASSPHRASE_SALT as environment variables in the Vercel dashboard."
    );
  }
  if (!passphrase || passphrase.length < 8) {
    throw new OwnerAuthError("Passphrase must be at least 8 characters.");
  }
  const db = resolveDb(conn);
  if (isOwnerBootstrapped(db)) {
    throw new OwnerAuthError("Owner passphrase is already set. Bootstrap can only run once.");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = hashPassphrase(passphrase, salt);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_owner_credential (id, passphrase_salt, passphrase_hash, created_at, updated_at)
     VALUES ('owner', ?, ?, ?, ?)`
  ).run(salt, hash, now, now);
}

/**
 * Verifies a passphrase attempt and, on success, creates a new
 * server-side session row. Returns null on any failure (wrong
 * passphrase, not yet bootstrapped) — callers must treat null as a
 * flat rejection, never distinguishing "no such owner" from "wrong
 * passphrase" to a caller (avoids leaking bootstrap state to guessers).
 */
export function attemptOwnerLogin(passphrase: string, conn?: DatabaseSync): { token: string; expiresAt: string } | null {
  if (IS_VERCEL) {
    if (!verifyPassphraseAgainstEnv(passphrase)) return null;
    return createVercelSession();
  }

  const db = resolveDb(conn);
  const cred = db.prepare(`SELECT passphrase_salt, passphrase_hash FROM audit_owner_credential WHERE id = 'owner'`).get() as
    | { passphrase_salt: string; passphrase_hash: string }
    | undefined;
  if (!cred) return null;

  const attemptHash = hashPassphrase(passphrase, cred.passphrase_salt);
  const expected = Buffer.from(cred.passphrase_hash, "hex");
  const actual = Buffer.from(attemptHash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return createSession(db);
}

function createSession(conn?: DatabaseSync): { token: string; expiresAt: string } {
  const db = resolveDb(conn);
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO audit_sessions (session_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)`
  ).run(token, now.toISOString(), expiresAt, now.toISOString());
  return { token, expiresAt };
}

/**
 * The single server-side gate every privileged audit-module route must
 * call. Returns true only for a session token that exists, is unexpired,
 * AND was issued by this server (never trusts anything the client
 * asserts beyond the opaque cookie value itself). Also opportunistically
 * clears expired sessions so the table does not grow unbounded.
 */
export function isValidOwnerSession(token: string | undefined | null, conn?: DatabaseSync): boolean {
  if (IS_VERCEL) {
    return isValidVercelSession(token);
  }

  if (!token) return false;
  const db = resolveDb(conn);
  const nowIso = new Date().toISOString();

  db.prepare(`DELETE FROM audit_sessions WHERE expires_at < ?`).run(nowIso);

  const row = db.prepare(`SELECT session_token FROM audit_sessions WHERE session_token = ? AND expires_at >= ?`).get(
    token,
    nowIso
  );
  if (!row) return false;

  db.prepare(`UPDATE audit_sessions SET last_seen_at = ? WHERE session_token = ?`).run(nowIso, token);
  return true;
}

export function destroyOwnerSession(token: string | undefined | null, conn?: DatabaseSync): void {
  if (IS_VERCEL) {
    destroyVercelSession(token);
    return;
  }
  if (!token) return;
  resolveDb(conn).prepare(`DELETE FROM audit_sessions WHERE session_token = ?`).run(token);
}

/**
 * Rotates the owner passphrase. Requires the CURRENT passphrase even
 * though the caller must already hold a valid session (defense in depth:
 * a hijacked/left-open session alone can never silently lock the real
 * owner out by rotating the credential without proving knowledge of it).
 * On success, every existing session is invalidated — including the one
 * used to make this request — so the new passphrase must be used to sign
 * in again everywhere.
 *
 * NOT AVAILABLE ON VERCEL — update env vars and redeploy instead.
 */
export function changeOwnerPassphrase(currentPassphrase: string, newPassphrase: string, conn?: DatabaseSync): void {
  if (IS_VERCEL) {
    throw new OwnerAuthError(
      "Passphrase cannot be changed at runtime on Vercel. " +
      "Update OWNER_PASSPHRASE_HASH and OWNER_PASSPHRASE_SALT in the Vercel dashboard and redeploy."
    );
  }
  if (!newPassphrase || newPassphrase.length < 8) {
    throw new OwnerAuthError("New passphrase must be at least 8 characters.");
  }
  const db = resolveDb(conn);
  const cred = db.prepare(`SELECT passphrase_salt, passphrase_hash FROM audit_owner_credential WHERE id = 'owner'`).get() as
    | { passphrase_salt: string; passphrase_hash: string }
    | undefined;
  if (!cred) {
    throw new OwnerAuthError("Owner passphrase is not set up yet.");
  }

  const attemptHash = hashPassphrase(currentPassphrase, cred.passphrase_salt);
  const expected = Buffer.from(cred.passphrase_hash, "hex");
  const actual = Buffer.from(attemptHash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new OwnerAuthError("Current passphrase is incorrect.");
  }

  const newSalt = randomBytes(16).toString("hex");
  const newHash = hashPassphrase(newPassphrase, newSalt);
  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_owner_credential SET passphrase_salt = ?, passphrase_hash = ?, updated_at = ? WHERE id = 'owner'`).run(
    newSalt,
    newHash,
    now
  );

  // Force re-authentication everywhere with the new passphrase.
  db.exec(`DELETE FROM audit_sessions`);
}

// ---- Utility: generate hash + salt for env-var provisioning ----

/**
 * Helper for the super_admin to generate the OWNER_PASSPHRASE_HASH and
 * OWNER_PASSPHRASE_SALT values to set in Vercel environment variables.
 * Called from the setup API route — returns hash and salt strings, never
 * stores them, never logs them. The caller (API route) returns only the
 * hash and salt to the authenticated super_admin in the response body.
 */
export function generateOwnerCredentialForEnv(passphrase: string): { hash: string; salt: string } {
  if (!passphrase || passphrase.length < 8) {
    throw new OwnerAuthError("Passphrase must be at least 8 characters.");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = hashPassphrase(passphrase, salt);
  return { hash, salt };
}
