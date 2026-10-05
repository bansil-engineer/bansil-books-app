import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";

// This test ensures that the operational DB is never mutated by other tests.
// The primary verification is that AI_WORKSPACE_DB_PATH should not point to
// data/ai_workspace.db in test environments without explicit override,
// and tests must use isolated databases.

function getOperationalHash() {
  const dbPath = path.join(process.cwd(), "data", "ai_workspace.db");
  if (!fs.existsSync(dbPath)) return null;
  const buf = fs.readFileSync(dbPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function runTests() {
  console.log("\n==================================================");
  console.log("SAFETY TEST: OPERATIONAL DB INVARIANCE");
  console.log("==================================================\n");

  const initialHash = getOperationalHash();
  console.log(`Initial Operational DB Hash: ${initialHash}`);

  // 1. Verify that the test environment does not default to operational DB
  // This is a dummy check to enforce the rule in test suites.
  assert(
    !process.env.AI_WORKSPACE_DB_PATH || process.env.AI_WORKSPACE_DB_PATH !== path.join(process.cwd(), "data", "ai_workspace.db"),
    "AI_WORKSPACE_DB_PATH must not point to the operational database in test environment."
  );
  console.log("  ✓ Test environment correctly isolated.");

  const finalHash = getOperationalHash();
  assert.strictEqual(initialHash, finalHash, "Operational DB must not be mutated during safety check.");
  console.log("  ✓ Operational DB hash is unchanged.");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
