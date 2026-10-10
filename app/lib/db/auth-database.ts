// ============================================================
// Bansil Books — OA-U2 Authentication Database (auth.db)
//
// Separate SQLite file on the Render persistent disk
// (${BANSIL_RUNTIME_DB_DIR}/auth.db). Never shares a connection with
// bansil_books.db or audit_workspace.db.
//
// Versioned migrations:
//   - each migration runs inside BEGIN IMMEDIATE … COMMIT and is
//     rolled back atomically on any error (no partial schema)
//   - applied migrations are recorded with a SHA-256 checksum; a
//     checksum mismatch (drift/tamper) or a DB newer than this code
//     (downgrade) refuses to open — fail closed.
//
// Opened lazily ONLY when AUTH_USER_STORE=db. In the default env mode
// this file is never created or touched.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface AuthMigration {
  version: number;
  name: string;
  sql: string;
}

export const AUTH_MIGRATIONS: readonly AuthMigration[] = [
  {
    version: 1,
    name: "initial_user_store",
    sql: `
      CREATE TABLE auth_users (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        email               TEXT NOT NULL,
        email_normalized    TEXT NOT NULL UNIQUE,
        name                TEXT NOT NULL,
        role                TEXT NOT NULL CHECK (role IN ('super_admin','admin','viewer')),
        status              TEXT NOT NULL CHECK (status IN ('invited','active','deactivated')),
        is_owner            INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0,1)),
        password_hash       TEXT,
        session_version     INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
        created_at          TEXT NOT NULL,
        created_by          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        last_login_at       TEXT,
        password_changed_at TEXT,
        CHECK (status <> 'active' OR password_hash IS NOT NULL),
        CHECK (is_owner = 0 OR (role = 'super_admin' AND status = 'active')),
        CHECK (role <> 'super_admin' OR is_owner = 1)
      );
      -- Exactly one Owner, and the Owner is the only super_admin.
      CREATE UNIQUE INDEX ux_auth_users_single_owner ON auth_users(is_owner) WHERE is_owner = 1;
      CREATE UNIQUE INDEX ux_auth_users_single_super_admin ON auth_users(role) WHERE role = 'super_admin';

      CREATE TABLE auth_user_permissions (
        user_id   INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
        module    TEXT NOT NULL,
        functions TEXT NOT NULL,
        PRIMARY KEY (user_id, module)
      );

      CREATE TABLE auth_invitations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
        purpose     TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
        token_hash  TEXT NOT NULL UNIQUE,
        created_by  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        used_at     TEXT,
        revoked_at  TEXT
      );
      CREATE INDEX ix_auth_invitations_user ON auth_invitations(user_id);

      CREATE TABLE auth_revoked_tokens (
        jti        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        revoked_at TEXT NOT NULL
      );

      CREATE TABLE auth_audit_log (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id     TEXT NOT NULL,  -- always server-generated
        client_request_id  TEXT,           -- client-supplied id (validated), informational only
        occurred_at        TEXT NOT NULL,
        actor_email        TEXT,
        actor_role         TEXT,
        target_email       TEXT,
        action             TEXT NOT NULL,
        changed_categories TEXT NOT NULL DEFAULT '[]',
        result             TEXT NOT NULL CHECK (result IN ('success','denied','error')),
        detail             TEXT
      );
      CREATE INDEX ix_auth_audit_time ON auth_audit_log(occurred_at);
      CREATE INDEX ix_auth_audit_target ON auth_audit_log(target_email);

      -- Audit history is append-only.
      CREATE TRIGGER trg_auth_audit_no_update BEFORE UPDATE ON auth_audit_log
      BEGIN SELECT RAISE(ABORT, 'auth_audit_log is append-only'); END;
      CREATE TRIGGER trg_auth_audit_no_delete BEFORE DELETE ON auth_audit_log
      BEGIN SELECT RAISE(ABORT, 'auth_audit_log is append-only'); END;

      -- Accounts are deactivated, never hard-deleted (preserves history).
      CREATE TRIGGER trg_auth_users_no_delete BEFORE DELETE ON auth_users
      BEGIN SELECT RAISE(ABORT, 'auth_users rows cannot be deleted; deactivate instead'); END;
    `,
  },
];

export function migrationChecksum(m: AuthMigration): string {
  return createHash("sha256").update(`${m.version}\n${m.name}\n${m.sql}`).digest("hex");
}

export const AUTH_SCHEMA_VERSION = AUTH_MIGRATIONS[AUTH_MIGRATIONS.length - 1].version;

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * Apply pending migrations. Each migration is atomic. Throws (and leaves
 * the DB at the last good version) on any failure, checksum drift, or
 * downgrade. `migrations` is injectable for rollback tests only.
 */
export function migrateAuthDatabase(
  db: DatabaseSync,
  migrations: readonly AuthMigration[] = AUTH_MIGRATIONS,
): { from: number; to: number; applied: number[] } {
  ensureMigrationTable(db);
  const applied = db
    .prepare("SELECT version, checksum FROM auth_schema_migrations ORDER BY version")
    .all() as Array<{ version: number; checksum: string }>;

  const known = new Map(migrations.map((m) => [m.version, m]));
  const maxKnown = migrations.length ? migrations[migrations.length - 1].version : 0;

  for (const row of applied) {
    const m = known.get(row.version);
    if (!m) {
      if (row.version > maxKnown) {
        throw new Error(
          `auth.db schema v${row.version} is newer than this application (max v${maxKnown}); refusing to open`,
        );
      }
      throw new Error(`auth.db has unknown migration v${row.version}; refusing to open`);
    }
    if (migrationChecksum(m) !== row.checksum) {
      throw new Error(`auth.db migration v${row.version} checksum mismatch; refusing to open`);
    }
  }

  const done = new Set(applied.map((r) => r.version));
  const from = applied.length ? applied[applied.length - 1].version : 0;
  const newlyApplied: number[] = [];

  for (const m of migrations) {
    if (done.has(m.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO auth_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(m.version, m.name, migrationChecksum(m), new Date().toISOString());
      db.exec("COMMIT");
      newlyApplied.push(m.version);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `auth.db migration v${m.version} (${m.name}) failed and was rolled back: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const to = newlyApplied.length ? newlyApplied[newlyApplied.length - 1] : from;
  return { from, to, applied: newlyApplied };
}

export function currentAuthSchemaVersion(db: DatabaseSync): number {
  ensureMigrationTable(db);
  const row = db.prepare("SELECT MAX(version) AS v FROM auth_schema_migrations").get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/**
 * Open (creating if needed) an auth DB at an explicit path and migrate it.
 * Used by the runtime singleton, the migration CLI, and isolated tests.
 */
export function openAuthDatabaseAt(filePath: string): DatabaseSync {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = FULL;");
  try {
    migrateAuthDatabase(db);
  } catch (err) {
    db.close(); // never leak a handle on a DB we refuse to use
    throw err;
  }
  return db;
}

/**
 * Consistent, WAL-safe snapshot via VACUUM INTO, followed by an integrity
 * check of the copy. Refuses to overwrite an existing file.
 */
export function backupAuthDatabase(db: DatabaseSync, destPath: string): { path: string; integrity: string } {
  const resolved = path.resolve(destPath);
  if (fs.existsSync(resolved)) {
    throw new Error("Backup destination already exists; refusing to overwrite");
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db.prepare("VACUUM INTO ?").run(resolved);
  const copy = new DatabaseSync(resolved, { readOnly: true });
  try {
    const row = copy.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    const integrity = String(Object.values(row)[0]);
    if (integrity !== "ok") throw new Error(`Backup integrity_check failed: ${integrity}`);
    return { path: resolved, integrity };
  } finally {
    copy.close();
  }
}
