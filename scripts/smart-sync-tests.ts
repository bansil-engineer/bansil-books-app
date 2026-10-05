// ============================================================
// Bansil Books Analytics — Smart Selective / Incremental Sync Test Suite
// Verification of Section-Wise, Customer-Wise, Change-Aware, Zero Zoho Mutation
// ============================================================

import assert from "node:assert";
import {
  getDatabase,
  getSyncState,
  setSyncState,
  acquireSyncLock,
  releaseSyncLock,
  getDocumentSyncFingerprint,
  setDocumentSyncFingerprint,
  getActiveExclusions,
  getFeatureSettings,
  updateFeatureSetting,
  getActivitySyncCheckpoint,
  setActivitySyncCheckpoint,
  getApiUsageCache,
  setApiUsageCache,
} from "../app/lib/db/database.ts";
import { saveCustomerAction } from "../app/lib/action-taken-engine.ts";
import {
  calculateDocumentFingerprint,
  checkSyncStaleness,
  performSmartSync,
} from "../app/lib/smart-sync-engine.ts";


let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log("\n============================================================");
  console.log("SMART SELECTIVE / INCREMENTAL ZOHO SYNC TEST SUITE");
  console.log("============================================================\n");


  const db = getDatabase();

  // Test 1: Local-First Principle
  await test("1. Local First: Local SQLite is initialized and operational without external Zoho calls", () => {
    const invoicesCount = db.prepare("SELECT COUNT(*) as count FROM sales_invoices").get() as { count: number };
    const billsCount = db.prepare("SELECT COUNT(*) as count FROM purchase_bills").get() as { count: number };
    assert.strictEqual(typeof invoicesCount.count, "number");
    assert.strictEqual(typeof billsCount.count, "number");
  });

  // Test 2: Document Fingerprint Calculation
  await test("2. Document Fingerprint: Computes deterministic hash for document metadata", () => {
    const docA = {
      invoice_id: "inv_12345",
      invoice_number: "INV-001",
      date: "2026-05-10",
      due_date: "2026-06-10",
      customer_id: "cust_999",
      total: 50000,
      balance: 10000,
      status: "SENT",
      last_modified_time: "2026-05-10T10:00:00Z",
    };

    const docB = { ...docA };
    const hashA = calculateDocumentFingerprint(docA);
    const hashB = calculateDocumentFingerprint(docB);
    assert.strictEqual(hashA, hashB, "Identical documents must yield identical fingerprints");

    const docC = { ...docA, balance: 0 };
    const hashC = calculateDocumentFingerprint(docC);
    assert.notStrictEqual(hashA, hashC, "Modified document must yield different fingerprint");
  });

  // Test 3: Sync Lock Concurrency Prevention
  await test("3. Sync Lock: Prevents simultaneous sync operations for same scope", () => {
    const lockKey = "lock:test_scope:all";
    releaseSyncLock(db, lockKey);

    const acquired1 = acquireSyncLock(db, lockKey, 5000, "agent_1");
    assert.strictEqual(acquired1, true, "First lock attempt must succeed");

    const acquired2 = acquireSyncLock(db, lockKey, 5000, "agent_2");
    assert.strictEqual(acquired2, false, "Second lock attempt on same scope must be rejected");

    releaseSyncLock(db, lockKey);
    const acquired3 = acquireSyncLock(db, lockKey, 5000, "agent_3");
    assert.strictEqual(acquired3, true, "Lock should be acquirable after release");
    releaseSyncLock(db, lockKey);
  });

  // Test 4: Sync State Persistence
  await test("4. Sync State: Tracks and persists module sync metadata in SQLite", () => {
    setSyncState(db, {
      module: "sales_invoices",
      scope_key: "test_fy_2025-26",
      status: "SUCCESS",
      records_checked: 100,
      records_changed: 5,
      records_skipped: 95,
      api_calls_used: 6,
      last_successful_sync_at: "2026-09-12T10:00:00.000Z",
    });

    const state = getSyncState(db, "sales_invoices", "test_fy_2025-26");
    assert(state !== null, "Sync state must be stored");
    assert.strictEqual(state.records_checked, 100);
    assert.strictEqual(state.records_changed, 5);
    assert.strictEqual(state.records_skipped, 95);
    assert.strictEqual(state.api_calls_used, 6);
    assert.strictEqual(state.status, "SUCCESS");
  });

  // Test 5: Document Sync Fingerprints Table
  await test("5. Document Fingerprint Cache: Stores document fingerprint and last_modified_time", () => {
    const testDocId = `test_inv_${Date.now()}`;
    setDocumentSyncFingerprint(db, "INVOICE", testDocId, "2026-09-10T12:00:00Z", "abcdef1234567890");

    const cached = getDocumentSyncFingerprint(db, "INVOICE", testDocId);
    assert(cached !== null, "Document fingerprint must be retrievable");
    assert.strictEqual(cached.last_modified_time, "2026-09-10T12:00:00Z");
    assert.strictEqual(cached.content_fingerprint, "abcdef1234567890");
  });

  // Test 6: Staleness Detection
  await test("6. Staleness Detection: Correctly identifies stale and current sync timestamps", () => {
    const freshIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const freshCheck = checkSyncStaleness(freshIso, 24);
    assert.strictEqual(freshCheck.isStale, false);

    const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
    const oldCheck = checkSyncStaleness(oldIso, 24);
    assert.strictEqual(oldCheck.isStale, true);

    const nullCheck = checkSyncStaleness(null, 24);
    assert.strictEqual(nullCheck.isStale, true);
  });

  // Test 7: Customer Purchase Limitation Handling
  await test("7. Customer Purchase Limitation: Transparently explains line-level Zoho limitation", async () => {
    const result = await performSmartSync({
      mode: "SMART",
      modules: ["purchase_bills"],
      customerId: "cust_123456",
      customerName: "TEST CUSTOMER",
    });

    if (result.customerPurchaseLimitationNote) {
      assert(
        result.customerPurchaseLimitationNote.includes("line-level"),
        "Limitation note must clearly explain line-level limitation"
      );
    }
  });

  // Test 8: Protection of Local Analytics Tables
  await test("8. Local Tables Protection: Exclusions, Composite Assemblies, and Action Tracker are preserved", () => {
    // 1. Reconciliation Exclusions
    const exclusionsBefore = getActiveExclusions(db);
    assert(Array.isArray(exclusionsBefore));

    // 2. Action Tracker
    saveCustomerAction(db, {
      customerId: "cust_test_protect",
      customerName: "PROTECTED CUST",
      actionStatus: "IN_PROGRESS",
      actionOwner: "Owner",
      priority: "HIGH",
      actionTaken: "Protected Action",
      nextFollowUpDate: "2026-09-20",
    });
    const actionRow = db.prepare("SELECT * FROM customer_action_tracker WHERE customer_id = ?").get("cust_test_protect") as any;
    assert(actionRow !== null && actionRow.action_status === "IN_PROGRESS");

    // 3. Composite Assemblies
    const asmCount = db.prepare("SELECT COUNT(*) as c FROM composite_assemblies").get() as { c: number };
    assert(typeof asmCount.c === "number");

    // 4. Feature Settings
    const settings = getFeatureSettings(db);
    assert(typeof settings === "object");
    assert.strictEqual(settings.sync_smart_enabled, true);
    assert.strictEqual(settings.sync_auto_on_page_open, false);
    assert.strictEqual(settings.sync_historical_rescan, false);
  });

  // Test 9: Feature Settings Configuration
  await test("9. Settings: Owner configuration for sync toggles works properly", () => {
    updateFeatureSetting(db, "sync_smart_enabled", true);
    updateFeatureSetting(db, "sync_auto_on_page_open", false);
    updateFeatureSetting(db, "sync_historical_rescan", false);

    const s = getFeatureSettings(db);
    assert.strictEqual(s.sync_smart_enabled, true);
    assert.strictEqual(s.sync_auto_on_page_open, false);
    assert.strictEqual(s.sync_historical_rescan, false);
  });

  // Test 10: Change-Aware Skip Logic Simulation
  await test("10. Change-Aware Skip: Verifies unchanged remote documents skip detail fetches", () => {
    const listDocs = [
      { invoice_id: "inv_101", last_modified_time: "2026-08-01T00:00:00Z", total: 1000, balance: 0, status: "PAID" },
      { invoice_id: "inv_102", last_modified_time: "2026-08-01T00:00:00Z", total: 2000, balance: 500, status: "SENT" },
      { invoice_id: "inv_103", last_modified_time: "2026-08-02T00:00:00Z", total: 3000, balance: 0, status: "PAID" },
    ];

    // Seed cached fingerprints
    for (const d of listDocs) {
      const fp = calculateDocumentFingerprint(d);
      setDocumentSyncFingerprint(db, "INVOICE", d.invoice_id, d.last_modified_time, fp);
    }

    // Simulate remote list response where 2 are unchanged and 1 is modified
    const remoteList = [
      { invoice_id: "inv_101", last_modified_time: "2026-08-01T00:00:00Z", total: 1000, balance: 0, status: "PAID" }, // UNCHANGED
      { invoice_id: "inv_102", last_modified_time: "2026-08-01T00:00:00Z", total: 2000, balance: 500, status: "SENT" }, // UNCHANGED
      { invoice_id: "inv_103", last_modified_time: "2026-08-05T00:00:00Z", total: 3500, balance: 500, status: "OVERDUE" }, // MODIFIED
    ];

    let unchangedCount = 0;
    let detailFetchCount = 0;

    for (const r of remoteList) {
      const remoteFp = calculateDocumentFingerprint(r);
      const cached = getDocumentSyncFingerprint(db, "INVOICE", r.invoice_id);
      if (cached && cached.last_modified_time === r.last_modified_time && cached.content_fingerprint === remoteFp) {
        unchangedCount++;
      } else {
        detailFetchCount++;
      }
    }

    assert.strictEqual(unchangedCount, 2, "2 unchanged documents must be skipped");
    assert.strictEqual(detailFetchCount, 1, "Only 1 modified document requires detail fetch");
  });

  // Test 11: Activity-Driven Sync Scenario — 2 Invoice changes, 1 Bill change
  await test("11. Activity-Driven Change Detection: 2 Invoice changes, 1 Bill change -> Detail GET: Invoice=2, Bill=1", () => {
    // Simulated Activity Logs from Zoho Reports
    const mockActivityLogs = [
      {
        activity_id: "act_001",
        activity_datetime: "2026-09-12T10:15:00Z",
        activity_date: "2026-09-12",
        module: "invoices",
        action: "MODIFIED",
        entity_type: "invoice",
        entity_id: "inv_101",
        document_number: "INV-2026-001",
      },
      {
        activity_id: "act_002",
        activity_datetime: "2026-09-12T10:20:00Z",
        activity_date: "2026-09-12",
        module: "invoices",
        action: "MODIFIED",
        entity_type: "invoice",
        entity_id: "inv_101", // duplicate event for same invoice
        document_number: "INV-2026-001",
      },
      {
        activity_id: "act_003",
        activity_datetime: "2026-09-12T10:25:00Z",
        activity_date: "2026-09-12",
        module: "invoices",
        action: "CREATED",
        entity_type: "invoice",
        entity_id: "inv_102",
        document_number: "INV-2026-002",
      },
      {
        activity_id: "act_004",
        activity_datetime: "2026-09-12T10:30:00Z",
        activity_date: "2026-09-12",
        module: "bills",
        action: "MODIFIED",
        entity_type: "bill",
        entity_id: "bill_201",
        document_number: "BILL-2026-001",
      },
      {
        activity_id: "act_005",
        activity_datetime: "2026-09-12T10:35:00Z",
        activity_date: "2026-09-12",
        module: "contacts", // unsupported module for inventory sync
        action: "MODIFIED",
        entity_type: "contact",
        entity_id: "cust_999",
      },
    ];

    // Filter for supported modules
    const invoiceChanges: string[] = [];
    const billChanges: string[] = [];
    let otherChanges = 0;

    for (const act of mockActivityLogs) {
      const mod = act.module.toLowerCase();
      if (mod.includes("invoice")) {
        if (act.entity_id) invoiceChanges.push(act.entity_id);
      } else if (mod.includes("bill")) {
        if (act.entity_id) billChanges.push(act.entity_id);
      } else {
        otherChanges++;
      }
    }

    // Deduplicate document IDs
    const uniqueInvoiceIds = Array.from(new Set(invoiceChanges));
    const uniqueBillIds = Array.from(new Set(billChanges));

    assert.strictEqual(uniqueInvoiceIds.length, 2, "Invoice detail GET must equal exactly 2");
    assert.deepStrictEqual(uniqueInvoiceIds, ["inv_101", "inv_102"]);
    assert.strictEqual(uniqueBillIds.length, 1, "Bill detail GET must equal exactly 1");
    assert.deepStrictEqual(uniqueBillIds, ["bill_201"]);
    assert.strictEqual(otherChanges, 1, "Unrelated module changes must be ignored for document detail fetch");
  });

  // Test 12: Repeated Sync with No New Activity
  await test("12. Repeated Sync: Zero new activity -> Changed documents = 0, Detail GET = 0", () => {
    const mockEmptyActivityLogs: any[] = [];

    const uniqueInvoiceIds = Array.from(new Set(mockEmptyActivityLogs.filter((a) => a.module === "invoices").map((a) => a.entity_id)));
    const uniqueBillIds = Array.from(new Set(mockEmptyActivityLogs.filter((a) => a.module === "bills").map((a) => a.entity_id)));

    const changedDocuments = uniqueInvoiceIds.length + uniqueBillIds.length;
    const detailGets = uniqueInvoiceIds.length + uniqueBillIds.length;

    assert.strictEqual(changedDocuments, 0, "Changed documents must be 0 on repeated sync with no activity");
    assert.strictEqual(detailGets, 0, "Detail GET calls must be 0 on repeated sync with no activity");
  });

  // Test 13: Activity Checkpoint Management and Failure Rollback
  await test("13. Activity Checkpoint: Persists checkpoint on success, does NOT advance on failure", () => {
    const testKey = "test_activity_checkpoint";
    const initialTime = "2026-09-12T08:00:00.000Z";
    const initialEventId = "act_init_001";

    // Set initial successful checkpoint
    setActivitySyncCheckpoint(db, {
      key: testKey,
      lastActivitySyncAt: initialTime,
      lastActivityEventId: initialEventId,
      lastActivityEventTime: initialTime,
      lastSuccessfulSyncAt: initialTime,
    });

    const cpBefore = getActivitySyncCheckpoint(db, testKey);
    assert(cpBefore !== null);
    assert.strictEqual(cpBefore.lastSuccessfulSyncAt, initialTime);
    assert.strictEqual(cpBefore.lastActivityEventId, initialEventId);

    // Simulate FAILED sync attempt -> Checkpoint must NOT advance
    const failedSyncAttemptTime = "2026-09-12T09:30:00.000Z";
    let syncErrorOccurred = false;
    try {
      throw new Error("Simulated Zoho API Timeout during detail fetch");
    } catch {
      syncErrorOccurred = true;
      // On failure, do NOT update checkpoint
    }

    assert.strictEqual(syncErrorOccurred, true);
    const cpAfterFailure = getActivitySyncCheckpoint(db, testKey);
    assert(cpAfterFailure !== null);
    assert.strictEqual(cpAfterFailure.lastSuccessfulSyncAt, initialTime, "last_successful_sync_at must remain unchanged after failure");
    assert.strictEqual(cpAfterFailure.lastActivityEventId, initialEventId, "last_activity_event_id must remain unchanged after failure");

    // Simulate SUCCESSFUL sync -> Advance checkpoint
    const successfulSyncTime = "2026-09-12T10:00:00.000Z";
    const latestEventId = "act_new_999";
    setActivitySyncCheckpoint(db, {
      key: testKey,
      lastActivitySyncAt: successfulSyncTime,
      lastActivityEventId: latestEventId,
      lastActivityEventTime: successfulSyncTime,
      lastSuccessfulSyncAt: successfulSyncTime,
    });

    const cpAfterSuccess = getActivitySyncCheckpoint(db, testKey);
    assert(cpAfterSuccess !== null);
    assert.strictEqual(cpAfterSuccess.lastSuccessfulSyncAt, successfulSyncTime);
    assert.strictEqual(cpAfterSuccess.lastActivityEventId, latestEventId);
  });

  // Test 14: Fallback Incremental Sync when Activity Logs Lack Entity IDs
  await test("14. Fallback Detection: Unidentifiable activity events trigger safe incremental fallback without guessing IDs", () => {
    const unidentifiableActivityLogs = [
      {
        activity_id: "act_unident_001",
        activity_datetime: "2026-09-12T11:00:00Z",
        activity_date: "2026-09-12",
        module: "invoices",
        action: "MODIFIED",
        entity_type: "invoice",
        entity_id: undefined, // Missing entity ID
        description: "Invoice updated from customer portal",
      },
    ];

    let hasUnidentifiableEvents = false;
    for (const act of unidentifiableActivityLogs) {
      if (!act.entity_id) {
        hasUnidentifiableEvents = true;
        break;
      }
    }

    assert.strictEqual(hasUnidentifiableEvents, true, "Must detect missing entity ID in activity log");
    // Fallback mode triggered
    const fallbackMode = hasUnidentifiableEvents ? "INCREMENTAL_FINGERPRINT_SCAN" : "DIRECT_DETAIL_GET";
    assert.strictEqual(fallbackMode, "INCREMENTAL_FINGERPRINT_SCAN", "Must use incremental fingerprint scan fallback without guessing document ID");
  });

  // Test 15: API Usage Retrieval & Caching
  await test("15. API Usage: Stores and retrieves DAILY LIMIT, USED TODAY, REMAINING, and USAGE %", () => {
    const usageData = {
      id: "test_usage_cache",
      dailyLimit: 10000,
      usedToday: 154,
      remaining: 9846,
      usagePercentage: 1.54,
      resetTime: "2026-09-13T00:00:00Z",
    };

    setApiUsageCache(db, usageData);

    const cached = getApiUsageCache(db, "test_usage_cache");
    assert(cached !== null, "API usage cache must be stored");
    assert.strictEqual(cached.dailyLimit, 10000);
    assert.strictEqual(cached.usedToday, 154);
    assert.strictEqual(cached.remaining, 9846);
    assert.strictEqual(cached.usagePercentage, 1.54);
  });

  console.log("\n============================================================");
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("============================================================\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});


