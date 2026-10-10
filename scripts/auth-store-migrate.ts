// ============================================================
// OA-U2 — AUTH_USERS → auth.db migration CLI (staged cutover tool)
//
// NEVER prints AUTH_USERS, hashes, salts or tokens. Output is limited to
// counts, roles, emails and integrity results.
//
//   node --experimental-strip-types scripts/auth-store-migrate.ts plan   [--from-file F]
//       Dry run in an in-memory DB. Validates the source; writes nothing.
//
//   node --experimental-strip-types scripts/auth-store-migrate.ts apply  --db PATH [--from-file F]
//       Imports into an EMPTY auth DB at PATH. If PATH already exists it is
//       backed up first (VACUUM INTO PATH.pre-import-<ts>). Refuses if the
//       DB already contains users. Does NOT change AUTH_USER_STORE.
//
//   node --experimental-strip-types scripts/auth-store-migrate.ts verify --db PATH
//       Schema version, integrity_check, user counts, Owner presence.
//
//   node --experimental-strip-types scripts/auth-store-migrate.ts backup --db PATH --out FILE
//
// Source: AUTH_USERS env var, or --from-file (JSON file) for isolated tests.
// There is no default --db path: production paths must be typed explicitly
// and are only to be used under a separate Owner approval.
// ============================================================

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  backupAuthDatabase,
  currentAuthSchemaVersion,
  migrateAuthDatabase,
  openAuthDatabaseAt,
} from "../app/lib/db/auth-database.ts";
import { AuthRepository } from "../app/lib/auth-repository.ts";

const ACTOR = { email: "migration@local", role: "system", correlationId: `migrate-${Date.now()}` };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function readSource(): string {
  const file = arg("--from-file");
  const raw = file ? fs.readFileSync(file, "utf8") : process.env.AUTH_USERS;
  if (!raw) {
    console.error("No source: set AUTH_USERS or pass --from-file");
    process.exit(2);
  }
  return raw;
}

function printSummary(summary: Array<{ email: string; role: string; modules: number }>): void {
  for (const s of summary) console.log(`  - ${s.email}  role=${s.role}  permission_entries=${s.modules}`);
}

function plan(): number {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrateAuthDatabase(db);
  const res = new AuthRepository(db).importFromAuthUsersJson(readSource(), ACTOR);
  db.close();
  if (!res.ok) {
    console.error(`PLAN FAILED: ${res.error}`);
    return 1;
  }
  console.log(`PLAN OK: ${res.imported} user(s) would be imported; Owner = ${res.owner}`);
  printSummary(res.summary);
  return 0;
}

function apply(): number {
  const dbPath = arg("--db");
  if (!dbPath) {
    console.error("apply requires --db PATH (no default)");
    return 2;
  }
  const source = readSource();
  if (fs.existsSync(dbPath)) {
    const existing = openAuthDatabaseAt(dbPath);
    const bak = `${dbPath}.pre-import-${new Date().toISOString().replace(/[:.]/g, "")}`;
    backupAuthDatabase(existing, bak);
    console.log(`Backup of existing auth DB written: ${bak} (integrity ok)`);
    existing.close();
  }
  const db = openAuthDatabaseAt(dbPath);
  const repo = new AuthRepository(db);
  const res = repo.importFromAuthUsersJson(source, ACTOR);
  if (!res.ok) {
    db.close();
    console.error(`APPLY FAILED (nothing imported): ${res.error}`);
    return 1;
  }
  const ownerOk = repo.hasActiveOwner();
  db.close();
  console.log(`APPLY OK: imported ${res.imported} user(s); Owner = ${res.owner}; active owner check = ${ownerOk}`);
  printSummary(res.summary);
  console.log("AUTH_USER_STORE was NOT changed. Cutover requires separate Owner approval.");
  return ownerOk ? 0 : 1;
}

function verify(): number {
  const dbPath = arg("--db");
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error("verify requires an existing --db PATH");
    return 2;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const integ = String(Object.values(db.prepare("PRAGMA integrity_check").get() as object)[0]);
  const fk = (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
  const version = currentAuthSchemaVersion(db);
  const counts = db
    .prepare("SELECT status, COUNT(*) AS n FROM auth_users GROUP BY status ORDER BY status")
    .all() as Array<{ status: string; n: number }>;
  const owner = db
    .prepare("SELECT email FROM auth_users WHERE is_owner = 1 AND status = 'active'")
    .get() as { email: string } | undefined;
  db.close();
  console.log(`integrity_check=${integ} foreign_key_violations=${fk} schema_version=${version}`);
  console.log(`users: ${counts.map((c) => `${c.status}=${c.n}`).join(" ") || "none"}`);
  console.log(`active owner: ${owner ? owner.email : "MISSING"}`);
  return integ === "ok" && fk === 0 && owner ? 0 : 1;
}

function backup(): number {
  const dbPath = arg("--db");
  const out = arg("--out");
  if (!dbPath || !out || !fs.existsSync(dbPath)) {
    console.error("backup requires an existing --db PATH and --out FILE");
    return 2;
  }
  const db = new DatabaseSync(dbPath);
  const r = backupAuthDatabase(db, out);
  db.close();
  console.log(`Backup written: ${r.path} (integrity ${r.integrity})`);
  return 0;
}

const cmd = process.argv[2] ?? "plan";
const handlers: Record<string, () => number> = { plan, apply, verify, backup };
if (!handlers[cmd]) {
  console.error(`Unknown command "${cmd}". Use plan | apply | verify | backup.`);
  process.exit(2);
}
process.exit(handlers[cmd]());
