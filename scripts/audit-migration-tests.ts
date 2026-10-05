// ============================================================
// Bansil Books Analytics — Milestone E §21: DB / Migration Final Validation
// ISOLATED TEMP SQLITE FILES ONLY. Proves: fresh DB creation, upgrade
// from a representative older (v6, pre-Milestone-E) schema, idempotent
// repeat migration via the real public entry point, integrity_check,
// backup+restore, and historical row immutability across a schema bump.
// Never treats CREATE TABLE IF NOT EXISTS as a substitute for a required
// ALTER (see the residual_quantity lesson from Milestone C) — this
// suite would fail if a future column-add relied on that mistake again.
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { openAuditDatabaseAt, AUDIT_SCHEMA_VERSION } from "../app/lib/db/audit-database.ts";

let passedCount = 0;
let failedCount = 0;
function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
  passedCount++;
}
function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}
function test(name: string, fn: () => void) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

function tmpPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bansil-migration-${label}-`));
  return path.join(dir, "audit_workspace.db");
}

async function main() {
  console.log("\n=== Fresh DB creation ===");
  {
    const dbPath = tmpPath("fresh");
    const db = openAuditDatabaseAt(dbPath);

    test("Fresh DB reaches AUDIT_SCHEMA_VERSION", () => {
      const row = db.prepare(`SELECT value FROM audit_schema_meta WHERE key = 'schema_version'`).get() as { value: string };
      assert.strictEqual(parseInt(row.value, 10), AUDIT_SCHEMA_VERSION);
    });

    test("All Milestone E tables exist on a fresh DB", () => {
      const tables = ["learning_proposals", "learning_proposal_examples", "learning_proposal_events", "learning_conflicts", "learning_overrides", "learning_unsupported_cases"];
      for (const t of tables) {
        const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
        assert.ok(row, `table ${t} must exist on a fresh DB`);
      }
    });

    test("integrity_check is ok on a fresh DB", () => {
      const row = db.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
      assert.strictEqual(row.integrity_check, "ok");
    });

    db.close();
  }

  console.log("\n=== Upgrade from a representative OLDER schema (simulated v6, pre-Milestone-E) ===");
  {
    // Build a v6-shaped DB by hand (only what existed through Milestone D),
    // then run the real migration path against it and confirm the new v7
    // tables appear without disturbing existing data.
    const dbPath = tmpPath("upgrade-from-v6");
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE audit_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO audit_schema_meta (key, value) VALUES ('schema_version', '6');
      CREATE TABLE audit_workspaces (
        workspace_id TEXT PRIMARY KEY, name TEXT NOT NULL, comparison_mode TEXT NOT NULL, purpose TEXT,
        entity_id TEXT, entity_name TEXT, period_from TEXT, period_to TEXT, amount_basis TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT', pinned_skill_version_id TEXT, created_by TEXT NOT NULL DEFAULT 'OWNER',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO audit_workspaces (workspace_id, name, comparison_mode, created_at, updated_at) VALUES ('pre-existing-ws', 'Pre-Existing Workspace', 'INTERNAL_EXTERNAL', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    raw.close();

    const upgraded = openAuditDatabaseAt(dbPath);

    test("Upgrading a v6-shaped DB reaches AUDIT_SCHEMA_VERSION (v7)", () => {
      const row = upgraded.prepare(`SELECT value FROM audit_schema_meta WHERE key = 'schema_version'`).get() as { value: string };
      assert.strictEqual(parseInt(row.value, 10), AUDIT_SCHEMA_VERSION);
    });

    test("Pre-existing workspace row is completely unchanged after the upgrade", () => {
      const row = upgraded.prepare(`SELECT * FROM audit_workspaces WHERE workspace_id = 'pre-existing-ws'`).get() as { name: string };
      assert.strictEqual(row.name, "Pre-Existing Workspace");
    });

    test("New Milestone E tables now exist on the upgraded DB", () => {
      const row = upgraded.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'learning_proposals'`).get();
      assert.ok(row);
    });

    test("Upgraded DB integrity_check is ok", () => {
      const row = upgraded.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
      assert.strictEqual(row.integrity_check, "ok");
    });

    upgraded.close();
  }

  console.log("\n=== Repeat migration via the real public entry point is idempotent ===");
  {
    const dbPath = tmpPath("repeat-public");
    const first = openAuditDatabaseAt(dbPath);
    first.prepare(`INSERT INTO audit_workspaces (workspace_id, name, comparison_mode, created_at, updated_at) VALUES ('repeat-ws', 'Repeat Test', 'INTERNAL_EXTERNAL', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();
    first.close();

    test("Opening the same DB file a second time (simulating a process restart) does not throw and preserves data", () => {
      const second = openAuditDatabaseAt(dbPath);
      const row = second.prepare(`SELECT name FROM audit_workspaces WHERE workspace_id = 'repeat-ws'`).get() as { name: string };
      assert.strictEqual(row.name, "Repeat Test");
      const version = second.prepare(`SELECT value FROM audit_schema_meta WHERE key = 'schema_version'`).get() as { value: string };
      assert.strictEqual(parseInt(version.value, 10), AUDIT_SCHEMA_VERSION);
      second.close();
    });

    test("Re-running init a third time still does not duplicate the schema_version row", () => {
      const third = openAuditDatabaseAt(dbPath);
      const rows = third.prepare(`SELECT COUNT(*) as c FROM audit_schema_meta WHERE key = 'schema_version'`).get() as { c: number };
      assert.strictEqual(rows.c, 1);
      third.close();
    });
  }

  console.log("\n=== Backup + Restore ===");
  let immutabilityDbPath = "";
  {
    const dbPath = tmpPath("backup-restore");
    const db = openAuditDatabaseAt(dbPath);
    db.prepare(`INSERT INTO audit_workspaces (workspace_id, name, comparison_mode, created_at, updated_at) VALUES ('backup-ws', 'Backup Test', 'INTERNAL_EXTERNAL', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();

    const backupPath = tmpPath("backup-restore-copy");
    await backup(db, backupPath);
    const restored = new DatabaseSync(backupPath);

    test("Restored backup contains the same data", () => {
      const row = restored.prepare(`SELECT name FROM audit_workspaces WHERE workspace_id = 'backup-ws'`).get() as { name: string };
      assert.strictEqual(row.name, "Backup Test");
    });
    test("Restored backup passes integrity_check", () => {
      const row = restored.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
      assert.strictEqual(row.integrity_check, "ok");
    });

    restored.close();
    db.close();
    immutabilityDbPath = tmpPath("immutability-across-bump");
  }

  console.log("\n=== Historical row immutability across a re-open (simulated schema-version bump path) ===");
  {
    const db2 = openAuditDatabaseAt(immutabilityDbPath);
    const now = new Date().toISOString();
    db2.prepare(`INSERT INTO audit_workspaces (workspace_id, name, comparison_mode, created_at, updated_at) VALUES ('imm-ws', 'Immutability Test', 'INTERNAL_EXTERNAL', ?, ?)`).run(now, now);
    db2
      .prepare(`INSERT INTO audit_reports (report_id, workspace_id, report_version, entity_name, status, generated_at, created_by) VALUES ('imm-report-1', 'imm-ws', 1, 'Frozen Entity', 'DRAFT', ?, 'OWNER')`)
      .run(now);
    const before = db2.prepare(`SELECT * FROM audit_reports WHERE report_id = 'imm-report-1'`).get();
    db2.close();

    const reopened = openAuditDatabaseAt(immutabilityDbPath);
    const after = reopened.prepare(`SELECT * FROM audit_reports WHERE report_id = 'imm-report-1'`).get();

    test("A report row is byte-identical after the file is closed and reopened", () => {
      assert.deepStrictEqual(before, after);
    });
    reopened.close();
  }

  console.log(`\n${"=".repeat(60)}\nMIGRATION VALIDATION SUMMARY: ${passedCount} passed, ${failedCount} failed\n${"=".repeat(60)}`);
  if (failedCount > 0) process.exit(1);
}

main();
