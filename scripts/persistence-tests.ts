// ============================================================
// AI CEO conversation persistence tests
//
// ISOLATION: runs ONLY against a unique temporary SQLite file.
// AI_WORKSPACE_DB_PATH is set BEFORE any project module is loaded
// (ai-database is imported dynamically below, never statically), and the
// run aborts if the resolved path is the operational data/ai_workspace.db.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";

const OPERATIONAL_DB_PATH = path.resolve(process.cwd(), "data", "ai_workspace.db");

function sha256OrNull(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const TEMP_PREFIX = "ai-ceo-persistence-";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
const TEST_DB_PATH = path.join(tempDir, "ai_workspace.db");

// Hard guard BEFORE anything can open a database.
assert.notStrictEqual(
  path.resolve(TEST_DB_PATH),
  OPERATIONAL_DB_PATH,
  "FATAL: test DB path equals the operational DB path"
);
process.env.AI_WORKSPACE_DB_PATH = TEST_DB_PATH;

const hashBefore = sha256OrNull(OPERATIONAL_DB_PATH);

let passed = 0;
function check(name: string, fn: () => void) {
  fn(); // throws on failure; PASS is only printed after the assertions ran
  passed++;
  console.log(`  PASS  ${name}`);
}

type Row = Record<string, any>;

const MARKDOWN_TABLE = [
  "| Month | Sales (₹) | Purchases (₹) |",
  "|:------|----------:|--------------:|",
  "| Aug   | 12,34,567 | 9,87,654      |",
  "| Sep   | 15,00,000 | 11,25,000     |",
  "",
  "**Net:** positive — *verify* `GST`",
].join("\n");

async function runTests() {
  console.log("=== PERSISTENCE TESTS (isolated temp DB) ===");
  console.log(`  test DB: ${TEST_DB_PATH}`);

  // Import only now that the env var is set.
  const aiDb = await import("../app/lib/db/ai-database");
  const { assertZohoReadOnlyRequest } = await import("../app/lib/zoho-security-guard");

  check("M. resolved AI DB path is the temp DB, not the operational DB", () => {
    assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(TEST_DB_PATH));
    assert.notStrictEqual(path.resolve(aiDb.getDbFilePath()), OPERATIONAL_DB_PATH);
    assert.ok(path.resolve(TEST_DB_PATH).startsWith(fs.realpathSync(os.tmpdir()) + path.sep) ||
              path.resolve(TEST_DB_PATH).startsWith(os.tmpdir() + path.sep), "test DB must live under os.tmpdir()");
  });

  // Normal source-controlled init path creates the schema.
  let db = aiDb.getAiDatabase();
  check("schema initialised by the real init path", () => {
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Row[]).map(r => r.name);
    assert.ok(names.includes("ai_conversations"), "ai_conversations table missing");
    assert.ok(names.includes("ai_messages"), "ai_messages table missing");
    assert.ok(fs.existsSync(TEST_DB_PATH), "temp DB file should exist on disk");
  });

  const convA = crypto.randomUUID();
  const convB = crypto.randomUUID();
  const t0 = Date.parse("2026-01-01T00:00:00.000Z");
  const ts = (n: number) => new Date(t0 + n * 1000).toISOString();
  const addConv = (id: string, title: string, n: number) =>
    db.prepare(`INSERT INTO ai_conversations (id, title, user_identifier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, title, "test-user", ts(n), ts(n));
  const addMsg = (id: string, conv: string, role: string, content: string, n: number) =>
    db.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, conv, role, content, role === "assistant" ? "CEO" : null, ts(n));

  const idU1 = crypto.randomUUID(), idA1 = crypto.randomUUID();
  const idU2 = crypto.randomUUID(), idA2 = crypto.randomUUID();

  addConv(convA, "Quarterly sales review", 1);
  check("A. new conversation is created", () => {
    const c = db.prepare(`SELECT * FROM ai_conversations WHERE id = ?`).get(convA) as Row;
    assert.ok(c, "conversation row must exist");
    assert.strictEqual(c.id, convA);
  });

  addMsg(idU1, convA, "user", "Show me sales for August", 2);
  check("B. user message persists", () => {
    const m = db.prepare(`SELECT * FROM ai_messages WHERE id = ?`).get(idU1) as Row;
    assert.strictEqual(m.role, "user");
    assert.strictEqual(m.content, "Show me sales for August");
  });

  addMsg(idA1, convA, "assistant", MARKDOWN_TABLE, 3);
  check("C. assistant message persists", () => {
    const m = db.prepare(`SELECT * FROM ai_messages WHERE id = ?`).get(idA1) as Row;
    assert.strictEqual(m.role, "assistant");
    assert.ok(m.content.length > 0);
  });

  check("D. both messages belong to the same conversation id", () => {
    const rows = db.prepare(`SELECT conversation_id FROM ai_messages WHERE id IN (?, ?)`).all(idU1, idA1) as Row[];
    assert.strictEqual(rows.length, 2);
    for (const r of rows) assert.strictEqual(r.conversation_id, convA);
  });

  check("E. message order is correct (user then assistant)", () => {
    const rows = db.prepare(`SELECT id, role FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(convA) as Row[];
    assert.deepStrictEqual(rows.map(r => r.id), [idU1, idA1]);
    assert.deepStrictEqual(rows.map(r => r.role), ["user", "assistant"]);
  });

  check("F. conversation title persists (including after an update)", () => {
    assert.strictEqual((db.prepare(`SELECT title FROM ai_conversations WHERE id = ?`).get(convA) as Row).title, "Quarterly sales review");
    db.prepare(`UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?`).run("Renamed review", ts(4), convA);
    assert.strictEqual((db.prepare(`SELECT title FROM ai_conversations WHERE id = ?`).get(convA) as Row).title, "Renamed review");
  });

  const snapshot = (d: DatabaseSync, conv: string) => ({
    conv: d.prepare(`SELECT id, title, user_identifier, created_at, updated_at FROM ai_conversations WHERE id = ?`).get(conv),
    msgs: d.prepare(`SELECT id, conversation_id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(conv),
  });
  const before = JSON.parse(JSON.stringify(snapshot(db, convA)));

  // Close the handle entirely and reopen: simulates a fresh process reading the file.
  aiDb.closeAiDatabase();
  db = aiDb.getAiDatabase();
  check("G. reload through a fresh DB handle returns the same rows", () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot(db, convA))), before);
    const raw = new DatabaseSync(TEST_DB_PATH, { readOnly: true }); // independent second reader
    try {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot(raw, convA))), before);
    } finally {
      raw.close();
    }
  });

  addMsg(idU2, convA, "user", "And for September?", 5);
  addMsg(idA2, convA, "assistant", "September sales were higher.", 6);
  check("H. a second exchange stays in the same conversation", () => {
    const rows = db.prepare(`SELECT id, role FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(convA) as Row[];
    assert.deepStrictEqual(rows.map(r => r.id), [idU1, idA1, idU2, idA2]);
    assert.deepStrictEqual(rows.map(r => r.role), ["user", "assistant", "user", "assistant"]);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations WHERE id = ?`).get(convA) as Row).c, 1);
  });

  check("I. reload does not duplicate messages", () => {
    const n1 = (db.prepare(`SELECT count(*) c FROM ai_messages WHERE conversation_id = ?`).get(convA) as Row).c;
    aiDb.closeAiDatabase();
    db = aiDb.getAiDatabase();
    aiDb.closeAiDatabase();
    db = aiDb.getAiDatabase();
    const n2 = (db.prepare(`SELECT count(*) c FROM ai_messages WHERE conversation_id = ?`).get(convA) as Row).c;
    assert.strictEqual(n1, 4);
    assert.strictEqual(n2, 4);
    const ids = (db.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ?`).all(convA) as Row[]).map(r => r.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  const idUB = crypto.randomUUID(), idAB = crypto.randomUUID();
  addConv(convB, "Project A profitability", 10);
  addMsg(idUB, convB, "user", "Check profitability of Project A", 11);
  addMsg(idAB, convB, "assistant", "Project A margin is healthy.", 12);

  check("J. a second conversation is isolated from the first", () => {
    const a = db.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ? ORDER BY created_at`).all(convA) as Row[];
    const b = db.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ? ORDER BY created_at`).all(convB) as Row[];
    assert.deepStrictEqual(a.map(r => r.id), [idU1, idA1, idU2, idA2]);
    assert.deepStrictEqual(b.map(r => r.id), [idUB, idAB]);
    assert.strictEqual((db.prepare(`SELECT title FROM ai_conversations WHERE id = ?`).get(convB) as Row).title, "Project A profitability");
  });

  check("K. a new conversation does not delete the old one", () => {
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations WHERE id IN (?, ?)`).get(convA, convB) as Row).c, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot(db, convA).conv)),
      { ...before.conv, title: "Renamed review", updated_at: ts(4) });
  });

  check("L. Markdown table text round-trips exactly", () => {
    const m = db.prepare(`SELECT content FROM ai_messages WHERE id = ?`).get(idA1) as Row;
    assert.strictEqual(m.content, MARKDOWN_TABLE);
    assert.ok(m.content.includes("\n"));
    assert.ok(m.content.includes("|:------|----------:|--------------:|"));
  });

  check("N. ZOHO WRITE guard (zoho-security-guard) rejects every write method and allows GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.throws(
        () => assertZohoReadOnlyRequest("https://www.zohoapis.com/books/v3/invoices", method),
        /ZOHO READ-ONLY SECURITY POLICY/,
        `${method} must be blocked`
      );
    }
    assert.doesNotThrow(() => assertZohoReadOnlyRequest("https://www.zohoapis.com/books/v3/invoices", "GET"));
  });

  check("M2. test DB is still the only DB in use at the end", () => {
    assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(TEST_DB_PATH));
  });

  aiDb.closeAiDatabase();
  return passed;
}

function cleanupTempDir() {
  // Only ever remove the unique temp directory created by this run.
  const real = path.resolve(tempDir);
  assert.ok(path.basename(real).startsWith(TEMP_PREFIX), "refusing to delete non-test directory");
  assert.ok(real !== path.resolve(process.cwd(), "data"), "refusing to delete data directory");
  assert.ok(!OPERATIONAL_DB_PATH.startsWith(real + path.sep), "operational DB is inside cleanup dir");
  fs.rmSync(real, { recursive: true, force: true });
}

(async () => {
  let failed = 0;
  try {
    await runTests();
  } catch (err) {
    failed = 1;
    console.error("Test failed:", err);
  } finally {
    try { cleanupTempDir(); } catch (e) { failed = 1; console.error("Cleanup failed:", e); }
  }

  const hashAfter = sha256OrNull(OPERATIONAL_DB_PATH);
  console.log(`  operational DB: ${OPERATIONAL_DB_PATH}`);
  console.log(`  SHA256 before : ${hashBefore ?? "(file does not exist)"}`);
  console.log(`  SHA256 after  : ${hashAfter ?? "(file does not exist)"}`);
  if (hashBefore !== hashAfter) {
    failed = 1;
    console.error("FAIL: operational DB hash changed during persistence tests");
  } else {
    console.log("  PASS  operational DB hash unchanged");
  }
  console.log(`  temp dir removed: ${!fs.existsSync(tempDir)}`);
  console.log(failed ? `PERSISTENCE TESTS FAILED (${passed} passed)` : `ALL PERSISTENCE TESTS PASSED (${passed} assertions groups)`);
  process.exit(failed);
})();
