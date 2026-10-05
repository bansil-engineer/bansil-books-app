import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

// Import all resolvers
import {
  getRuntimeDbDir,
  getBansilBooksDbPath,
  getAuditWorkspaceDbPath,
  getAiWorkspaceDbPath,
  getEstimationDbPath,
  getMasterAuditV2DbPath,
} from "../app/lib/db/db-resolver.ts";

function clearEnvs() {
  delete process.env.BANSIL_RUNTIME_DB_DIR;
  delete process.env.BANSIL_BOOKS_DB_PATH;
  delete process.env.AUDIT_WORKSPACE_DB_PATH;
  delete process.env.AI_WORKSPACE_DB_PATH;
  delete process.env.ESTIMATION_DB_PATH;
}

const originalCwd = process.cwd();

async function runTests() {
  console.log("Running DB path resolution tests...");

  // 1. legacy fallback works when no env set
  clearEnvs();
  assert.equal(getRuntimeDbDir(), path.join(originalCwd, "data"));
  assert.equal(getBansilBooksDbPath(), path.join(originalCwd, "data", "bansil_books.db"));

  // 2. BANSIL_RUNTIME_DB_DIR overrides all live DB roots
  clearEnvs();
  process.env.BANSIL_RUNTIME_DB_DIR = "/tmp/runtime-test";
  assert.equal(getRuntimeDbDir(), "/tmp/runtime-test");
  assert.equal(getBansilBooksDbPath(), "/tmp/runtime-test/bansil_books.db");
  assert.equal(getAuditWorkspaceDbPath(), "/tmp/runtime-test/audit_workspace.db");
  assert.equal(getAiWorkspaceDbPath(), "/tmp/runtime-test/ai_workspace.db");
  assert.equal(getEstimationDbPath(), "/tmp/runtime-test/estimation/estimation.sqlite");
  assert.equal(getMasterAuditV2DbPath(), "/tmp/runtime-test/master-audit-v2/db/master-audit-v2.sqlite");

  // 3. exact per-DB override wins where supported
  process.env.BANSIL_BOOKS_DB_PATH = "/tmp/override-bansil/b.db";
  assert.equal(getBansilBooksDbPath(), "/tmp/override-bansil/b.db");
  
  process.env.AUDIT_WORKSPACE_DB_PATH = "/tmp/override-audit/a.db";
  assert.equal(getAuditWorkspaceDbPath(), "/tmp/override-audit/a.db");

  // 4. AI_WORKSPACE_DB_PATH still works
  process.env.AI_WORKSPACE_DB_PATH = "/tmp/override-ai/ai.db";
  assert.equal(getAiWorkspaceDbPath(), "/tmp/override-ai/ai.db");

  // 5. ESTIMATION_DB_PATH still works
  process.env.ESTIMATION_DB_PATH = "/tmp/override-est/est.db";
  assert.equal(getEstimationDbPath(), "/tmp/override-est/est.db");
  
  // Test AI_WORKSPACE_DB_PATH fallback in estimation-database
  const estLoaderPath = path.join(originalCwd, "app", "lib", "db", "estimation-database.ts");
  const estLoader = fs.readFileSync(estLoaderPath, "utf-8");
  assert.ok(estLoader.includes("let dbPath = getEstimationDbPath();"));
  assert.ok(estLoader.includes("process.env.AI_WORKSPACE_DB_PATH && !process.env.ESTIMATION_DB_PATH"));

  console.log("✅ All DB path tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
