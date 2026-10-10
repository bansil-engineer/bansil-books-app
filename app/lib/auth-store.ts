// ============================================================
// Bansil Books — OA-U2 User Store Selection (controlled cutover)
//
//   AUTH_USER_STORE unset / "" / "env" (DEFAULT) → AUTH_USERS env var is
//       authoritative; existing code paths run unchanged; auth.db is
//       never opened or created.
//   AUTH_USER_STORE = "db"                         → auth.db is authoritative.
//   ANY OTHER VALUE (typo, "database", "true" …)   → "invalid": every
//       auth endpoint fails CLOSED with 503. A typo must never silently
//       revert to AUTH_USERS (which could resurrect deactivated accounts).
//
// There is NO automatic fallback between stores. Rollback = set
// AUTH_USER_STORE back to "env" (AUTH_USERS is never modified by the
// DB store) — and rotate AUTH_SECRET (see OA-U2 report).
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import { openAuthDatabaseAt } from "./db/auth-database.ts";
import { getAuthDbPath } from "./db/db-resolver.ts";
import { AuthRepository } from "./auth-repository.ts";

export type UserStoreMode = "env" | "db" | "invalid";

export function getUserStoreMode(): UserStoreMode {
  const v = (process.env.AUTH_USER_STORE ?? "").trim().toLowerCase();
  if (v === "" || v === "env") return "env";
  if (v === "db") return "db";
  return "invalid";
}

let _db: DatabaseSync | null = null;
let _repo: AuthRepository | null = null;

/** Lazily opens auth.db. Must only be called in DB mode. */
export function getAuthRepository(): AuthRepository {
  const mode = getUserStoreMode();
  if (mode !== "db") {
    throw new Error(`getAuthRepository() called while AUTH_USER_STORE mode is '${mode}'`);
  }
  if (_repo) return _repo;
  _db = openAuthDatabaseAt(getAuthDbPath());
  _repo = new AuthRepository(_db);
  return _repo;
}

/** Test hook: inject an isolated repository (temp DB). */
export function __setAuthRepositoryForTests(repo: AuthRepository | null): void {
  _repo = repo;
  if (!repo && _db) {
    _db.close();
    _db = null;
  }
}
