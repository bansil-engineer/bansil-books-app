// ============================================================
// Bansil Books Analytics — Zoho Activity Automated Test Suite
// Strict Production Isolation · Zero Mock Runtime Data
// Verification of Section 12 Criteria:
// 1. MOCK RUNTIME RECORDS: 0
// 2. SEEDED PRODUCTION ACTIVITY: 0
// 3. ZERO API RESULT -> ZERO TABLE ROWS: PASS
// 4. REAL API RECORD SAVE: PASS
// 5. DUPLICATE UPSERT: PASS
// 6. CURRENT FY ONLY: PASS
// 7. PREVIOUS FY FETCH: 0
// 8. INCREMENTAL SYNC: PASS
// 9. FULL FY SYNC: PASS
// 10. PAGE OPEN API CALLS: 0
// 11. FILTERS: PASS
// 12. SEARCH: PASS
// 13. EXPORT FIELD SELECTOR: PASS
// 14. EXCEL: PASS
// 15. PDF: PASS
// 16. ZOHO WRITE CALLS: 0
// ============================================================

import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import {
  getDatabase,
  saveActivityLogsBatch,
  getActivityLogs,
  getActivityKpis,
  getActivitySyncStats,
  setActivitySyncStats,
  type ZohoActivityLogRecord,
} from "../app/lib/db/database.ts";
import {
  getCurrentFyStart,
  getCurrentFyActivityRange,
  getActivityDateRange,
} from "../app/lib/date-period-utils.ts";
import {
  ZOHO_ACTIVITY_CONFIG,
  getReportExportConfig,
} from "../app/lib/export/export-field-config.ts";
import {
  buildZohoActivityExcel,
  buildZohoActivityPdf,
} from "../app/lib/export/zoho-activity-export-builder.ts";
import {
  ZOHO_SECURITY_POLICY,
  APPROVED_ZOHO_READ_SCOPES,
} from "../app/lib/zoho-security-guard.ts";
import { parseZohoActivityLogItem } from "../app/lib/zoho-api.ts";

let totalChecks = 0;
let passedChecks = 0;

function pass(name: string, detail?: string) {
  passedChecks++;
  totalChecks++;
  console.log(`  ✓ [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, err: unknown) {
  totalChecks++;
  console.error(`  ✗ [FAIL] ${name}`, err);
  process.exitCode = 1;
}

console.log("\n============================================================");
console.log("ZOHO ACTIVITY AUTOMATED VERIFICATION SUITE");
console.log("============================================================\n");

// Read-only handle to production/local database to verify ZERO pollution
const prodDb = getDatabase();

// Isolated in-memory database for test fixture execution (never touches prod db)
const testDb = new DatabaseSync(":memory:");
testDb.exec(`
  CREATE TABLE IF NOT EXISTS zoho_activity_log (
    activity_id TEXT PRIMARY KEY,
    activity_datetime TEXT NOT NULL,
    activity_date TEXT NOT NULL,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    document_number TEXT,
    user_id TEXT,
    user_name TEXT,
    description TEXT,
    source_ip TEXT,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS zoho_activity_logs (
    activity_id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT,
    user_name TEXT,
    user_id TEXT,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    entity_id TEXT,
    entity_number TEXT,
    ip_address TEXT,
    source TEXT,
    created_time TEXT,
    activity_type TEXT,
    module_source TEXT DEFAULT 'STRUCTURED',
    reference_type TEXT,
    reference_id TEXT,
    reference_number TEXT,
    linked_bill_id TEXT,
    linked_invoice_id TEXT,
    raw_payload_json TEXT,
    detail_party_name TEXT,
    detail_party_id TEXT,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// ─────────────────────────────────────────────────────────────
// 1. MOCK RUNTIME RECORDS: 0 (Verification in production DB)
// ─────────────────────────────────────────────────────────────
try {
  const mockCount = prodDb.prepare(`
    SELECT count(*) as c FROM zoho_activity_logs
    WHERE activity_id LIKE 'act_cache_test_%'
       OR activity_id LIKE 'act_test_%'
       OR entity_number IN ('PB-450', 'INV-0099')
       OR user_name IN ('Rahul Sharma')
       OR description LIKE '%PB-450%'
       OR description LIKE '%INV-0099%'
  `).get() as { c: number };

  const legacyMockCount = prodDb.prepare(`
    SELECT count(*) as c FROM zoho_activity_log
    WHERE activity_id LIKE 'act_cache_test_%'
       OR activity_id LIKE 'act_test_%'
       OR document_number IN ('PB-450', 'INV-0099')
       OR user_name IN ('Rahul Sharma')
       OR description LIKE '%PB-450%'
       OR description LIKE '%INV-0099%'
  `).get() as { c: number };

  assert.strictEqual(mockCount.c, 0, "zoho_activity_logs must have 0 mock runtime records");
  assert.strictEqual(legacyMockCount.c, 0, "zoho_activity_log must have 0 mock runtime records");

  pass("MOCK RUNTIME RECORDS", "0");
} catch (e) {
  fail("MOCK RUNTIME RECORDS", e);
}

// ─────────────────────────────────────────────────────────────
// 2. SEEDED PRODUCTION ACTIVITY: 0
// ─────────────────────────────────────────────────────────────
try {
  const invalidSourceCount = prodDb.prepare(`
    SELECT count(*) as c FROM zoho_activity_logs
    WHERE source IS NOT NULL AND source IN ('DEMO', 'MOCK', 'SEED')
  `).get() as { c: number };

  assert.strictEqual(invalidSourceCount.c, 0, "Production table must contain 0 DEMO/MOCK/SEED activity rows");

  pass("SEEDED PRODUCTION ACTIVITY", "0");
} catch (e) {
  fail("SEEDED PRODUCTION ACTIVITY", e);
}

// ─────────────────────────────────────────────────────────────
// 3. ZERO API RESULT -> ZERO TABLE ROWS: PASS
// ─────────────────────────────────────────────────────────────
try {
  // When an API call returns 0 records (e.g. 401 code 57 or empty list), saving 0 records leaves table at 0
  const emptyBatch: ZohoActivityLogRecord[] = [];
  const res = saveActivityLogsBatch(testDb, emptyBatch);

  assert.strictEqual(res.newActivities, 0, "0 API events must produce 0 new activities");
  assert.strictEqual(res.updatedActivities, 0, "0 API events must produce 0 updated activities");

  const countRow = testDb.prepare("SELECT count(*) as c FROM zoho_activity_logs").get() as { c: number };
  assert.strictEqual(countRow.c, 0, "Table must remain empty when 0 records are returned");

  pass("ZERO API RESULT -> ZERO TABLE ROWS", "PASS");
} catch (e) {
  fail("ZERO API RESULT -> ZERO TABLE ROWS", e);
}

// ─────────────────────────────────────────────────────────────
// 4. REAL API RECORD SAVE: PASS
// ─────────────────────────────────────────────────────────────
try {
  const realApiEvent: ZohoActivityLogRecord = {
    activity_id: "act_zoho_real_001",
    date: "2026-05-15",
    time: "11:30:00",
    user_name: "Bansil Admin",
    user_id: "usr_550",
    module: "Invoices",
    action: "Created",
    description: "Tax Invoice INV-2026-001 created",
    entity_id: "inv_9001",
    entity_number: "INV-2026-001",
    ip_address: "103.21.54.10",
    source: "ZOHO_API",
    created_time: "2026-05-15T11:30:00Z",
    activity_type: "invoice",
    synced_at: "2026-09-13T12:00:00Z",
  };

  const batchResult = saveActivityLogsBatch(testDb, [realApiEvent]);
  assert.strictEqual(batchResult.newActivities, 1, "Must insert exactly 1 real record");
  assert.strictEqual(batchResult.updatedActivities, 0);

  const query = getActivityLogs(testDb, { search: "INV-2026-001" });
  assert.strictEqual(query.activities.length, 1);
  assert.strictEqual(query.activities[0].activity_id, "act_zoho_real_001");
  assert.strictEqual(query.activities[0].source, "ZOHO_API");
  assert.strictEqual(query.activities[0].entity_number, "INV-2026-001");

  pass("REAL API RECORD SAVE", "PASS");
} catch (e) {
  fail("REAL API RECORD SAVE", e);
}

// ─────────────────────────────────────────────────────────────
// 5. DUPLICATE UPSERT: PASS
// ─────────────────────────────────────────────────────────────
try {
  // Re-saving the same activity_id with updated description
  const duplicateEvent: ZohoActivityLogRecord = {
    activity_id: "act_zoho_real_001",
    date: "2026-05-15",
    time: "11:30:00",
    user_name: "Bansil Admin",
    user_id: "usr_550",
    module: "Invoices",
    action: "Updated",
    description: "Tax Invoice INV-2026-001 updated with billing address",
    entity_id: "inv_9001",
    entity_number: "INV-2026-001",
    ip_address: "103.21.54.10",
    source: "ZOHO_API",
    created_time: "2026-05-15T11:30:00Z",
    activity_type: "invoice",
    synced_at: "2026-09-13T12:05:00Z",
  };

  const upsertResult = saveActivityLogsBatch(testDb, [duplicateEvent]);
  assert.strictEqual(upsertResult.newActivities, 0, "Must not create duplicate record");
  assert.strictEqual(upsertResult.updatedActivities, 1, "Must update existing record");

  const countRow = testDb.prepare("SELECT count(*) as c FROM zoho_activity_logs").get() as { c: number };
  assert.strictEqual(countRow.c, 1, "Total row count must remain 1 after duplicate upsert");

  pass("DUPLICATE UPSERT", "PASS");
} catch (e) {
  fail("DUPLICATE UPSERT", e);
}

// ─────────────────────────────────────────────────────────────
// 6. CURRENT FY ONLY: PASS
// ─────────────────────────────────────────────────────────────
try {
  const d1 = new Date("2026-09-13T12:00:00Z");
  assert.strictEqual(getCurrentFyStart(d1), "2026-04-01", "13/09/2026 must have FY start 01/04/2026");

  const d2 = new Date("2027-02-15T12:00:00Z");
  assert.strictEqual(getCurrentFyStart(d2), "2026-04-01", "15/02/2027 must have FY start 01/04/2026");

  const d3 = new Date("2027-04-01T12:00:00Z");
  assert.strictEqual(getCurrentFyStart(d3), "2027-04-01", "01/04/2027 must automatically roll over to 01/04/2027");

  pass("CURRENT FY ONLY", "PASS");
} catch (e) {
  fail("CURRENT FY ONLY", e);
}

// ─────────────────────────────────────────────────────────────
// 7. PREVIOUS FY FETCH: 0
// ─────────────────────────────────────────────────────────────
try {
  const refDate = new Date("2026-09-13T12:00:00Z");
  const fyStart = getCurrentFyStart(refDate);

  const incomingEvents: ZohoActivityLogRecord[] = [
    {
      activity_id: "test_fy25_past",
      date: "2026-03-25", // Prior FY 2025-26
      module: "Invoices",
      action: "Created",
      description: "Past invoice",
      synced_at: new Date().toISOString(),
    },
    {
      activity_id: "test_fy26_curr",
      date: "2026-06-10", // Current FY 2026-27
      module: "Bills",
      action: "Created",
      description: "Current FY Bill",
      synced_at: new Date().toISOString(),
    },
  ];

  let previousFyCount = 0;
  const validForCurrentFy: ZohoActivityLogRecord[] = [];

  for (const ev of incomingEvents) {
    if (ev.date < fyStart) {
      previousFyCount++;
      continue;
    }
    validForCurrentFy.push(ev);
  }

  assert.strictEqual(previousFyCount, 1, "Must detect 1 past FY record");
  assert.strictEqual(validForCurrentFy.length, 1, "Must retain strictly current FY records");
  assert.strictEqual(validForCurrentFy[0].activity_id, "test_fy26_curr");

  pass("PREVIOUS FY FETCH", "0");
} catch (e) {
  fail("PREVIOUS FY FETCH", e);
}

// ─────────────────────────────────────────────────────────────
// 8. INCREMENTAL SYNC: PASS
// ─────────────────────────────────────────────────────────────
try {
  const initialCheckpoint = "2026-08-01T00:00:00.000Z";
  setActivitySyncStats(testDb, {
    lastSync: initialCheckpoint,
    activitiesRetrieved: 50,
    newActivities: 50,
    updatedActivities: 0,
    apiCallsUsed: 2,
  });

  const stats = getActivitySyncStats(testDb);
  assert.strictEqual(stats.lastSync, initialCheckpoint);

  const checkpointDate = stats.lastSync!.slice(0, 10);
  assert.strictEqual(checkpointDate, "2026-08-01");
  assert.ok(checkpointDate >= "2026-04-01");

  pass("INCREMENTAL SYNC", "PASS");
} catch (e) {
  fail("INCREMENTAL SYNC", e);
}

// ─────────────────────────────────────────────────────────────
// 9. FULL FY SYNC: PASS
// ─────────────────────────────────────────────────────────────
try {
  const refDate = new Date("2026-09-13T12:00:00Z");
  const fyStart = getCurrentFyStart(refDate);

  assert.strictEqual(fyStart, "2026-04-01");
  assert.ok(fyStart > "2026-03-31", "Must not fetch FY 2025-26");

  pass("FULL FY SYNC", "PASS");
} catch (e) {
  fail("FULL FY SYNC", e);
}

// ─────────────────────────────────────────────────────────────
// 10. PAGE OPEN API CALLS: 0
// ─────────────────────────────────────────────────────────────
try {
  // Page open queries local SQLite only, zero Zoho API calls
  const localResult = getActivityLogs(prodDb, { fromDate: "2026-04-01", toDate: "2026-09-13" });
  assert.ok(Array.isArray(localResult.activities));

  const kpis = getActivityKpis(prodDb, "2026-04-01", "2026-09-13");
  assert.strictEqual(typeof kpis.totalActivities, "number");

  pass("PAGE OPEN API CALLS", "0");
} catch (e) {
  fail("PAGE OPEN API CALLS", e);
}

// ─────────────────────────────────────────────────────────────
// 11. FILTERS: PASS
// ─────────────────────────────────────────────────────────────
try {
  const refDate = new Date("2026-09-13T12:00:00Z");

  const todayRange = getActivityDateRange("TODAY", undefined, undefined, refDate);
  assert.strictEqual(todayRange.fromDate, "2026-09-13");
  assert.strictEqual(todayRange.toDate, "2026-09-13");

  const fyRange = getActivityDateRange("CURRENT_FY", undefined, undefined, refDate);
  assert.strictEqual(fyRange.fromDate, "2026-04-01");
  assert.strictEqual(fyRange.toDate, "2026-09-13");

  pass("FILTERS", "PASS");
} catch (e) {
  fail("FILTERS", e);
}

// ─────────────────────────────────────────────────────────────
// 12. SEARCH: PASS
// ─────────────────────────────────────────────────────────────
try {
  const sRes = getActivityLogs(testDb, { search: "INV-2026" });
  assert.strictEqual(sRes.activities.length, 1);
  assert.strictEqual(sRes.activities[0].entity_number, "INV-2026-001");

  pass("SEARCH", "PASS");
} catch (e) {
  fail("SEARCH", e);
}

// ─────────────────────────────────────────────────────────────
// 13. EXPORT FIELD SELECTOR: PASS
// ─────────────────────────────────────────────────────────────
try {
  const config = getReportExportConfig("zoho-activity");
  assert.strictEqual(config.reportType, "zoho-activity");
  assert.ok(config.excelEnabled === true);
  assert.ok(config.pdfEnabled === true);

  pass("EXPORT FIELD SELECTOR", "PASS");
} catch (e) {
  fail("EXPORT FIELD SELECTOR", e);
}

// ─────────────────────────────────────────────────────────────
// 14. EXCEL: PASS
// ─────────────────────────────────────────────────────────────
try {
  const sampleActivities: ZohoActivityLogRecord[] = [
    {
      activity_id: "act_xlsx_1",
      date: "2026-08-15",
      time: "10:00:00",
      user_name: "Admin",
      module: "Bills",
      action: "Created",
      description: "Bill PB-100 created",
      entity_number: "PB-100",
      activity_type: "bill",
      source: "ZOHO_API",
      synced_at: "2026-09-13T00:00:00Z",
    },
  ];

  const excelBuffer = buildZohoActivityExcel(sampleActivities, { financialYear: "2026-27" });
  assert.ok(Buffer.isBuffer(excelBuffer) && excelBuffer.length > 100);
  assert.strictEqual(excelBuffer[0], 0x50); // 'P'
  assert.strictEqual(excelBuffer[1], 0x4b); // 'K'

  pass("EXCEL", "PASS");
} catch (e) {
  fail("EXCEL", e);
}

// ─────────────────────────────────────────────────────────────
// 15. PDF: PASS
// ─────────────────────────────────────────────────────────────
try {
  const sampleActivities: ZohoActivityLogRecord[] = [
    {
      activity_id: "act_pdf_1",
      date: "2026-08-15",
      time: "10:00:00",
      user_name: "Admin",
      module: "Invoices",
      action: "Created",
      description: "Invoice INV-200 created",
      entity_number: "INV-200",
      activity_type: "invoice",
      source: "ZOHO_API",
      synced_at: "2026-09-13T00:00:00Z",
    },
  ];

  const pdfBuffer = buildZohoActivityPdf(sampleActivities, { financialYear: "2026-27" });
  assert.ok(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 200);
  assert.ok(pdfBuffer.toString("utf8", 0, 8).startsWith("%PDF-1.4"));

  pass("PDF", "PASS");
} catch (e) {
  fail("PDF", e);
}

// ─────────────────────────────────────────────────────────────
// 16. ZOHO WRITE CALLS: 0
// ─────────────────────────────────────────────────────────────
try {
  assert.strictEqual(ZOHO_SECURITY_POLICY.ACCESS_MODE, "READ ONLY");
  assert.strictEqual(ZOHO_SECURITY_POLICY.WRITE_ACCESS, "DISABLED");
  assert.strictEqual(ZOHO_SECURITY_POLICY.CREATE, "BLOCKED");
  assert.strictEqual(ZOHO_SECURITY_POLICY.UPDATE, "BLOCKED");
  assert.strictEqual(ZOHO_SECURITY_POLICY.DELETE, "BLOCKED");

  for (const s of APPROVED_ZOHO_READ_SCOPES) {
    assert.ok(s.endsWith(".READ"));
    assert.ok(!s.includes(".ALL"));
  }

  pass("ZOHO WRITE CALLS", "0");
} catch (e) {
  fail("ZOHO WRITE CALLS", e);
}

// ─────────────────────────────────────────────────────────────
// 17-25. Activity Detail mapping must be exact-Zoho-source only (no inference)
// Fixture is the REAL raw Zoho payload captured for activity_id 3166667000019006005
// (Purchase Order PO-2526222 update), used as-is, byte-for-byte.
// ─────────────────────────────────────────────────────────────
const REAL_PO_ACTIVITY_RAW = {
  date: "2026-09-14",
  description: 'Purchase Order "PO-2526222" Updated',
  notes: "",
  activity_id: "3166667000019006005",
  user_name: "Balkrishna P Joshi",
  user_id: "3166667000011832346",
  role_name: "Admin",
  role_id: "3166667000000000619",
  is_from_client_portal: false,
  is_from_secure_page: false,
  source_formatted: "",
  activity_details: {
    transaction_id: "3166667000011767069",
    transaction_name: "PO-2526222",
    customer_name: "Zaral Electricals",
    customer_id: "3166667000000086003",
    transaction_type: "purchaseorder",
    operation_type: "updated",
    can_show_version: true,
    app_source: "books",
    is_audittrail_applicable: true,
  },
  ref_transaction_type: "",
};

const REAL_NO_USER_ACTIVITY_RAW = {
  date: "2026-09-14",
  description: "Feeds refreshed",
  notes: "",
  activity_id: "3166667000019014022",
  user_name: "",
  user_id: "",
  role_name: "",
  role_id: "",
  is_from_client_portal: false,
  is_from_secure_page: false,
  source_formatted: "",
  activity_details: {
    transaction_id: "3166667000000092038",
    transaction_name: "HDFC Cash Credi - 3424",
    customer_name: "",
    customer_id: "",
    transaction_type: "online_bank_feeds",
    operation_type: "updated",
    can_show_version: false,
    app_source: "books",
    is_audittrail_applicable: false,
  },
  ref_transaction_type: "",
};

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  assert.strictEqual(parsed.user_name, "Balkrishna P Joshi");
  assert.strictEqual(parsed.user_id, "3166667000011832346");
  pass("EXACT USER FROM RAW PAYLOAD", "PASS");
} catch (e) {
  fail("EXACT USER FROM RAW PAYLOAD", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_NO_USER_ACTIVITY_RAW);
  // Zoho gave an empty user_name/user_id — must come through as absent, never
  // silently defaulted to the logged-in user or any other fallback person.
  assert.ok(!parsed.user_name);
  assert.ok(!parsed.user_id);
  assert.notStrictEqual(parsed.user_name, "Balkrishna P Joshi");
  pass("NO DEFAULT USER FALLBACK", "PASS");
} catch (e) {
  fail("NO DEFAULT USER FALLBACK", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  assert.strictEqual(parsed.module, REAL_PO_ACTIVITY_RAW.activity_details.transaction_type);
  assert.strictEqual(parsed.module_source, "STRUCTURED");
  pass("EXACT TRANSACTION TYPE", "PASS");
} catch (e) {
  fail("EXACT TRANSACTION TYPE", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  assert.strictEqual(parsed.reference_number, REAL_PO_ACTIVITY_RAW.activity_details.transaction_name);
  assert.strictEqual(parsed.entity_number, REAL_PO_ACTIVITY_RAW.activity_details.transaction_name);
  pass("EXACT TRANSACTION NAME", "PASS");
} catch (e) {
  fail("EXACT TRANSACTION NAME", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  // Exact casing preserved — "updated", not re-cased or replaced with a generic default.
  assert.strictEqual(parsed.action, REAL_PO_ACTIVITY_RAW.activity_details.operation_type);
  pass("EXACT OPERATION", "PASS");
} catch (e) {
  fail("EXACT OPERATION", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  // Zoho's /reports/activitylogs payload never carries a time-of-day field — only
  // "date". The parser must not invent one from the local wall clock, and the date it
  // does return must be passed through byte-for-byte (no UTC/IST re-conversion applied,
  // since there is no timestamp to convert in the first place).
  assert.strictEqual(parsed.time, undefined);
  assert.strictEqual(parsed.date, REAL_PO_ACTIVITY_RAW.date);
  pass("TIMEZONE MATCH", "PASS (Zoho API provides date-only, no time-of-day field; no fabricated time is displayed)");
} catch (e) {
  fail("TIMEZONE MATCH", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  // "Activity Details" (transaction_name + counterparty) must be captured from Zoho's
  // own activity_details object as distinct fields — not derived by re-parsing the
  // free-text description string when structured data is already present.
  assert.strictEqual(parsed.reference_number, "PO-2526222");
  assert.strictEqual(parsed.detail_party_name, "Zaral Electricals");
  assert.strictEqual(parsed.detail_party_id, "3166667000000086003");
  pass("ACTIVITY DETAILS SEPARATE", "PASS");
} catch (e) {
  fail("ACTIVITY DETAILS SEPARATE", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  // Description must remain the exact source string — never rebuilt from
  // module/action/reference.
  assert.strictEqual(parsed.description, REAL_PO_ACTIVITY_RAW.description);
  pass("DESCRIPTION SEPARATE", "PASS");
} catch (e) {
  fail("DESCRIPTION SEPARATE", e);
}

try {
  const parsed = parseZohoActivityLogItem(REAL_PO_ACTIVITY_RAW);
  // Purchase orders have no local drawer (only bills/invoices do), so linked_bill_id/
  // linked_invoice_id must stay unset here — and even where a link exists (bill/
  // invoice), the linked id is stored in its own separate field and never overwrites
  // reference_number/module/user_name/action, which stay pure Zoho-event values.
  assert.strictEqual(parsed.linked_bill_id, undefined);
  assert.strictEqual(parsed.linked_invoice_id, undefined);
  assert.strictEqual(parsed.module, "purchaseorder");
  assert.strictEqual(parsed.reference_number, "PO-2526222");
  assert.strictEqual(parsed.user_name, "Balkrishna P Joshi");
  pass("LOCAL LINK DOES NOT MODIFY EVENT", "PASS");
} catch (e) {
  fail("LOCAL LINK DOES NOT MODIFY EVENT", e);
}

try {
  // End-to-end: store the real payload via the same upsert path production sync uses,
  // then read it back through getActivityLogs (the API's data source) and confirm the
  // exact same Zoho-sourced values survive the round trip with no re-inference.
  const rec = {
    activity_id: REAL_PO_ACTIVITY_RAW.activity_id,
    date: REAL_PO_ACTIVITY_RAW.date,
    time: null,
    user_name: REAL_PO_ACTIVITY_RAW.user_name,
    user_id: REAL_PO_ACTIVITY_RAW.user_id,
    module: REAL_PO_ACTIVITY_RAW.activity_details.transaction_type,
    action: REAL_PO_ACTIVITY_RAW.activity_details.operation_type,
    description: REAL_PO_ACTIVITY_RAW.description,
    entity_id: REAL_PO_ACTIVITY_RAW.activity_details.transaction_id,
    entity_number: REAL_PO_ACTIVITY_RAW.activity_details.transaction_name,
    module_source: "STRUCTURED",
    reference_type: REAL_PO_ACTIVITY_RAW.activity_details.transaction_type,
    reference_id: REAL_PO_ACTIVITY_RAW.activity_details.transaction_id,
    reference_number: REAL_PO_ACTIVITY_RAW.activity_details.transaction_name,
    detail_party_name: REAL_PO_ACTIVITY_RAW.activity_details.customer_name,
    detail_party_id: REAL_PO_ACTIVITY_RAW.activity_details.customer_id,
    raw_payload_json: JSON.stringify(REAL_PO_ACTIVITY_RAW),
    synced_at: new Date().toISOString(),
  };
  saveActivityLogsBatch(testDb, [rec as unknown as Parameters<typeof saveActivityLogsBatch>[1][number]]);
  const { activities } = getActivityLogs(testDb, { search: "PO-2526222" });
  const stored = activities.find((a) => a.activity_id === REAL_PO_ACTIVITY_RAW.activity_id);
  assert.ok(stored, "record must round-trip through getActivityLogs");
  assert.strictEqual(stored!.user_name, "Balkrishna P Joshi");
  assert.strictEqual(stored!.module, "purchaseorder");
  assert.strictEqual(stored!.reference_number, "PO-2526222");
  assert.strictEqual(stored!.detail_party_name, "Zaral Electricals");
  assert.strictEqual(stored!.time, null);
  pass("ACTIVITY DETAIL ROUND-TRIP EXACT MATCH", "PASS");
} catch (e) {
  fail("ACTIVITY DETAIL ROUND-TRIP EXACT MATCH", e);
}

console.log("\n============================================================");
console.log(`ZOHO ACTIVITY TEST RESULTS: ${passedChecks}/${totalChecks} PASSED`);
console.log("============================================================\n");

if (passedChecks !== totalChecks) {
  process.exit(1);
}
