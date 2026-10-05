// ============================================================
// Test DB isolation + operational hash guard (test-safety only).
//
// Call isolateTestDatabases() BEFORE dynamically importing any app
// module that resolves a DB path. Every resolver-based DB (AI workspace,
// business, audit, estimation, runtime dir) is pointed at a unique temp
// directory, so tests can never write to repo-local data/*.db or to the
// live runtime folder. assertOperationalDbsUnchanged() proves the
// repo-local operational files are byte-identical after the test.
//
// Only node built-ins are imported here — no app modules.
// ============================================================

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Repo-local operational files guarded by hash (main DB + WAL, which carries un-checkpointed writes). */
export const GUARDED_OPERATIONAL_FILES: ReadonlyArray<string> = [
  "data/ai_workspace.db",
  "data/ai_workspace.db-wal",
  "data/bansil_books.db",
  "data/bansil_books.db-wal",
  "data/audit_workspace.db",
  "data/audit_workspace.db-wal",
];

export type HashSnapshot = Record<string, string | null>;

export function snapshotOperationalHashes(root: string = process.cwd()): HashSnapshot {
  const out: HashSnapshot = {};
  for (const rel of GUARDED_OPERATIONAL_FILES) {
    const p = path.join(root, rel);
    out[rel] = fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null;
  }
  return out;
}

export function diffHashes(before: HashSnapshot, after: HashSnapshot): string[] {
  return Object.keys(before).filter((k) => before[k] !== after[k]);
}

/** Throws if any guarded repo-local operational file changed. */
export function assertOperationalDbsUnchanged(before: HashSnapshot, label: string): void {
  const changed = diffHashes(before, snapshotOperationalHashes());
  if (changed.length) {
    throw new Error(`[${label}] OPERATIONAL DB MUTATED: ${changed.join(", ")}`);
  }
  console.log(`  ✓ [GUARD] ${label}: repo-local operational DB files unchanged (${GUARDED_OPERATIONAL_FILES.length} files hashed)`);
}

export interface IsolatedDbs {
  tmpDir: string;
  aiWorkspaceDbPath: string;
  bansilBooksDbPath: string;
  auditWorkspaceDbPath: string;
  estimationDbPath: string;
  cleanup: () => void;
}

/**
 * Point every DB resolver env var at a fresh temp directory.
 * Must run before any app module that reads these env vars is imported.
 */
export function isolateTestDatabases(label: string): IsolatedDbs {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  const iso: IsolatedDbs = {
    tmpDir,
    aiWorkspaceDbPath: path.join(tmpDir, "ai_workspace.db"),
    bansilBooksDbPath: path.join(tmpDir, "bansil_books.db"),
    auditWorkspaceDbPath: path.join(tmpDir, "audit_workspace.db"),
    estimationDbPath: path.join(tmpDir, "estimation.sqlite"),
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best effort: temp dir only */
      }
    },
  };
  process.env.BANSIL_RUNTIME_DB_DIR = tmpDir;
  process.env.AI_WORKSPACE_DB_PATH = iso.aiWorkspaceDbPath;
  process.env.BANSIL_BOOKS_DB_PATH = iso.bansilBooksDbPath;
  process.env.AUDIT_WORKSPACE_DB_PATH = iso.auditWorkspaceDbPath;
  process.env.ESTIMATION_DB_PATH = iso.estimationDbPath;
  return iso;
}

/** Fails fast if a resolved DB path is not inside the isolated temp directory. */
export function assertPathIsolated(resolvedPath: string, iso: IsolatedDbs, what: string): void {
  const abs = path.resolve(resolvedPath);
  if (!abs.startsWith(path.resolve(iso.tmpDir) + path.sep)) {
    throw new Error(`[ISOLATION] ${what} resolved outside temp dir: ${abs}`);
  }
  console.log(`  ✓ [ISOLATION] ${what} → temp (${path.basename(abs)})`);
}
