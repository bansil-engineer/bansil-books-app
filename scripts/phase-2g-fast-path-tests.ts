import * as assert from 'assert';
import {
  assertOperationalDbsUnchanged,
  assertPathIsolated,
  isolateTestDatabases,
  snapshotOperationalHashes,
} from './test-db-isolation';

// Test isolation: fast-path execution opens the business DB through the writable
// getDatabase() (initDatabase + seed). Every DB resolver points at a unique temp
// dir BEFORE app modules are imported (loaded dynamically in runSuite).
const ISO = isolateTestDatabases('phase2g');
const OPERATIONAL_BEFORE = snapshotOperationalHashes();
process.on('exit', () => ISO.cleanup());

let classifyIntent: typeof import('../app/lib/ai/ceo/planning-engine').classifyIntent;
let executeFastPathQuery: typeof import('../app/lib/ai/ceo/fast-path-tools').executeFastPathQuery;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
  } catch (e: any) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`    Error: ${e.message}`);
    process.exit(1);
  }
}

async function runSuite() {
  ({ classifyIntent } = await import('../app/lib/ai/ceo/planning-engine'));
  ({ executeFastPathQuery } = await import('../app/lib/ai/ceo/fast-path-tools'));
  const { getBansilBooksDbPath, getAiWorkspaceDbPath } = await import('../app/lib/db/db-resolver');
  assertPathIsolated(getBansilBooksDbPath(), ISO, 'Business DB');
  assertPathIsolated(getAiWorkspaceDbPath(), ISO, 'AI workspace DB');

  console.log("==================================================");
  console.log("PHASE 2G: FAST PATH INTENT & EXECUTION TESTS");
  console.log("==================================================\n");

  await runTest("1. Intent Precedence: Customer queries win over Sales", () => {
    assert.strictEqual(classifyIntent("top 5 customers last month"), "CUSTOMER_QUERY");
    assert.strictEqual(classifyIntent("top customers by sales last month"), "CUSTOMER_QUERY");
    assert.strictEqual(classifyIntent("customer sales ranking last month"), "CUSTOMER_QUERY");
  });

  await runTest("2. Intent Precedence: Vendor queries win over Purchase", () => {
    assert.strictEqual(classifyIntent("top 5 vendors last month"), "VENDOR_QUERY");
    assert.strictEqual(classifyIntent("top vendors by purchase last month"), "VENDOR_QUERY");
  });

  await runTest("3. Intent Precedence: Standard Sales/Purchase", () => {
    assert.strictEqual(classifyIntent("last month sales"), "SALES_QUERY");
    assert.strictEqual(classifyIntent("last month purchase"), "PURCHASE_QUERY");
  });

  await runTest("4. Execution: Sales Query", async () => {
    const res = await executeFastPathQuery("SALES_QUERY", "last month sales");
    assert.ok(res.includes("Sales Summary"), "Missing header");
    assert.ok(res.includes("Gross Sales"), "Missing Gross Sales");
  });

  await runTest("5. Execution: Purchase Query", async () => {
    const res = await executeFastPathQuery("PURCHASE_QUERY", "last month purchase");
    assert.ok(res.includes("Purchase Summary"), "Missing header");
  });

  await runTest("6. Execution: Receivable Query", async () => {
    const res = await executeFastPathQuery("RECEIVABLE_QUERY", "how much receivable");
    assert.ok(res.includes("Receivables Summary"), "Missing header");
  });

  await runTest("7. Execution: Payable Query", async () => {
    const res = await executeFastPathQuery("PAYABLE_QUERY", "how much payable");
    assert.ok(res.includes("Payables Summary"), "Missing header");
  });

  await runTest("8. Operational DB guard: repo-local data/*.db unchanged", () => {
    assertOperationalDbsUnchanged(OPERATIONAL_BEFORE, "phase-2g");
  });

  console.log("\n==================================================");
  console.log("ALL TESTS PASSED.");
  console.log("==================================================");
}

runSuite().catch((e) => {
  console.error("Suite failed:", e);
  process.exit(1);
});
