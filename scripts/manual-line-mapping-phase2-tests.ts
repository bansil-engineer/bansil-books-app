// ============================================================
// Manual SO↔PO Line Mapping — Phase 2 Test Suite
//
// 20 test cases covering: API route logic, CRUD lifecycle,
// candidate resolution, history, orgId derivation, edge cases,
// operational DB safety, and ZOHO WRITE = 0 compliance.
//
// All tests use an isolated temp DB via openAuditDatabaseAt().
// No Zoho calls. No operational DB mutation.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import {
  computeLineFingerprint,
  createOwnerLineMapping,
  evaluateMappingStaleness,
  revokeOwnerLineMapping,
  reconfirmOwnerLineMapping,
  replaceOwnerLineMapping,
  markMappingReviewRequired,
  getCurrentMappingForPoLine,
  getMappingHistoryForPoLine,
  getHistoryEventsForPoLine,
  isMappingUsable,
} from "../app/lib/audit/manual-line-mapping-service.ts";
import {
  buildGlobalSoLookup,
  resolveUniqueSalesOrder,
} from "../app/lib/audit/so-po-mapping.ts";
import type { DatabaseSync } from "node:sqlite";

const ORG = "org_p2_001";
const SO_ID = "so_p2_100";
const SO_ID_2 = "so_p2_200";
const PO_ID = "po_p2_300";
const PO_ID_2 = "po_p2_400";
const SO_NUM = "SO-2025-001";
const SO_NUM_2 = "SO-2025-002";

let db: DatabaseSync;
let tmpDir: string;
let tmpDbPath: string;
let passed = 0;
let failed = 0;
const failures: string[] = [];

// Capture operational DB hashes BEFORE any tests run
const _opDbPath = path.join(process.cwd(), 'data', 'audit_workspace.db');
const _opWalPath = _opDbPath + '-wal';
const _baselineDbHash = crypto.createHash('sha256').update(fs.readFileSync(_opDbPath)).digest('hex');
const _baselineWalHash = fs.existsSync(_opWalPath)
  ? crypto.createHash('sha256').update(fs.readFileSync(_opWalPath)).digest('hex')
  : null;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

/** Insert prerequisite source_run row. */
function ensureSourceRun(runId: string, orgId: string, type: string) {
  const exists = db.prepare(
    `SELECT 1 FROM audit_zoho_source_runs WHERE source_run_id = ?`
  ).get(runId);
  if (!exists) {
    db.prepare(
      `INSERT INTO audit_zoho_source_runs
         (source_run_id, organization_id, source_type, started_at, status)
       VALUES (?, ?, ?, ?, 'SUCCESS')`
    ).run(runId, orgId, type, new Date().toISOString());
  }
}

/** Seed a SO header. */
function seedSoHeader(
  orgId: string, soId: string, soNumber: string, runId: string
) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_orders
       (organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_id, customer_name, date, status, currency, total, sub_total,
        fetched_at)
     VALUES (?, ?, ?, ?, 'cust_001', 'Test Customer', '2025-06-01', 'confirmed', 'INR', 10000, 10000, ?)`
  ).run(orgId, soId, runId, soNumber, new Date().toISOString());
}

/** Seed a SO line. */
function seedSoLine(
  orgId: string, soId: string, lineItemId: string, runId: string,
  overrides: Partial<{item_id: string; item_name: string; description: string; quantity: number; rate: number; unit: string}> = {}
) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_order_lines
       (organization_id, line_item_id, salesorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId, lineItemId, soId, runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "Widget Alpha",
    overrides.description ?? "Standard widget",
    "SKU-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 50,
    5000,
    overrides.unit ?? "nos"
  );
}

/** Seed a PO header. */
function seedPoHeader(
  orgId: string, poId: string, poNumber: string, runId: string,
  customFieldsJson: string = "[]"
) {
  ensureSourceRun(runId, orgId, "purchase_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_purchase_orders
       (organization_id, purchaseorder_id, source_run_id, purchaseorder_number,
        vendor_id, vendor_name, date, status, currency, total, sub_total,
        custom_fields_json, fetched_at)
     VALUES (?, ?, ?, ?, 'vendor_001', 'Test Vendor', '2025-07-01', 'open', 'INR', 5500, 5500, ?, ?)`
  ).run(orgId, poId, runId, poNumber, customFieldsJson, new Date().toISOString());
}

/** Seed a PO line. */
function seedPoLine(
  orgId: string, poId: string, lineItemId: string, runId: string,
  overrides: Partial<{item_id: string; item_name: string; description: string; quantity: number; rate: number; unit: string}> = {}
) {
  ensureSourceRun(runId, orgId, "purchase_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_purchase_order_lines
       (organization_id, line_item_id, purchaseorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId, lineItemId, poId, runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "Widget Alpha",
    overrides.description ?? "Standard widget",
    "SKU-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 55,
    5500,
    overrides.unit ?? "nos"
  );
}

// ── Setup ──────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════");
console.log("  Manual SO↔PO Line Mapping — Phase 2 Tests");
console.log("═══════════════════════════════════════════════\n");

tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlm-p2-test-"));
tmpDbPath = path.join(tmpDir, "test_phase2.db");
db = openAuditDatabaseAt(tmpDbPath);

// Seed baseline data
const RUN_A = "run_p2_a";
const RUN_B = "run_p2_b";
const RUN_C = "run_p2_c";

// SO header + lines
seedSoHeader(ORG, SO_ID, SO_NUM, RUN_A);
seedSoLine(ORG, SO_ID, "sol_001", RUN_A, { item_id: "item_001", item_name: "Widget Alpha", quantity: 100, rate: 50, unit: "nos" });
seedSoLine(ORG, SO_ID, "sol_002", RUN_A, { item_id: "item_002", item_name: "Widget Beta", quantity: 200, rate: 75, unit: "pcs" });
seedSoLine(ORG, SO_ID, "sol_003", RUN_A, { item_id: "item_001", item_name: "Widget Alpha v2", description: "Variant A", quantity: 50, rate: 55, unit: "nos" });

// Second SO for ambiguity tests
seedSoHeader(ORG, SO_ID_2, SO_NUM_2, RUN_A);
seedSoLine(ORG, SO_ID_2, "sol_201", RUN_A, { item_id: "item_003", item_name: "Widget Gamma", quantity: 300, rate: 30, unit: "kg" });

// PO header with custom field linking to SO_NUM
const cfJson = JSON.stringify([{ label: "Sales Order No", api_name: "cf_sales_order_no", value: SO_NUM }]);
seedPoHeader(ORG, PO_ID, "PO-2025-001", RUN_A, cfJson);
seedPoLine(ORG, PO_ID, "pol_001", RUN_A, { item_id: "item_001", item_name: "Widget Alpha", quantity: 100, rate: 55, unit: "nos" });
seedPoLine(ORG, PO_ID, "pol_002", RUN_A, { item_id: "item_777", item_name: "Unknown Item", quantity: 10, rate: 20, unit: "nos" });

// PO without SO reference
seedPoHeader(ORG, PO_ID_2, "PO-2025-002", RUN_A, "[]");
seedPoLine(ORG, PO_ID_2, "pol_201", RUN_A, { item_id: "item_001", item_name: "Widget Alpha", quantity: 50, rate: 55, unit: "nos" });

// ── Test Cases ─────────────────────────────────────────────

console.log("SECTION 1: Candidate Resolution (SO Lookup from PO)");

test("T01 — buildGlobalSoLookup returns SO entries keyed by normalized number", () => {
  const lookup = buildGlobalSoLookup(db);
  // SO_NUM = "SO-2025-001" should be in the lookup
  assert.ok(lookup.size > 0, "Lookup map should not be empty");
  // Resolve SO_NUM
  const result = resolveUniqueSalesOrder(lookup, SO_NUM);
  assert.strictEqual(result.status, "MATCH", "Should resolve SO reference to MATCH");
  assert.strictEqual((result as any).so.salesorder_id, SO_ID);
  assert.strictEqual((result as any).so.organization_id, ORG);
});

test("T02 — resolveUniqueSalesOrder returns SO_REFERENCE_NOT_FOUND for unknown ref", () => {
  const lookup = buildGlobalSoLookup(db);
  const result = resolveUniqueSalesOrder(lookup, "SO-NONEXISTENT-999");
  assert.strictEqual(result.status, "SO_REFERENCE_NOT_FOUND");
});

test("T03 — resolveUniqueSalesOrder returns UNRESOLVED for null/empty ref", () => {
  const lookup = buildGlobalSoLookup(db);
  assert.strictEqual(resolveUniqueSalesOrder(lookup, null).status, "UNRESOLVED");
  assert.strictEqual(resolveUniqueSalesOrder(lookup, "").status, "UNRESOLVED");
  assert.strictEqual(resolveUniqueSalesOrder(lookup, undefined).status, "UNRESOLVED");
});

console.log("\nSECTION 2: OrgId Derivation from PO Header");

test("T04 — PO header lookup by purchaseorder_id returns organization_id", () => {
  // This mirrors the GET route's orgId derivation logic
  const po = db.prepare(
    `SELECT organization_id FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
  ).get(PO_ID) as any;
  assert.ok(po, "PO header should exist");
  assert.strictEqual(po.organization_id, ORG, "Should derive correct orgId from PO header");
});

test("T05 — PO header lookup returns null for nonexistent PO", () => {
  const po = db.prepare(
    `SELECT organization_id FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
  ).get("po_nonexistent_999") as any;
  assert.strictEqual(po, undefined, "Should return undefined for missing PO");
});

console.log("\nSECTION 3: SO Line Candidates for Manual Mapping");

test("T06 — Latest SO lines returned for resolved SO, ordered by rowid", () => {
  // Mirrors the candidates endpoint getLatestSoLines logic
  const latestHeader = db.prepare(
    `SELECT source_run_id, organization_id FROM audit_zoho_sales_orders WHERE salesorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
  ).get(SO_ID) as any;
  assert.ok(latestHeader, "SO header should exist");
  assert.strictEqual(latestHeader.organization_id, ORG);

  const soLines = db.prepare(
    `SELECT *, ROW_NUMBER() OVER(ORDER BY rowid ASC) as displayLineNumber
     FROM audit_zoho_sales_order_lines
     WHERE salesorder_id = ? AND source_run_id = ? AND organization_id = ?
     ORDER BY rowid ASC`
  ).all(SO_ID, latestHeader.source_run_id, latestHeader.organization_id) as any[];

  assert.strictEqual(soLines.length, 3, "Should return all 3 SO lines");
  assert.strictEqual(soLines[0].line_item_id, "sol_001");
  assert.strictEqual(soLines[0].displayLineNumber, 1);
  assert.strictEqual(soLines[1].line_item_id, "sol_002");
  assert.strictEqual(soLines[1].displayLineNumber, 2);
  assert.strictEqual(soLines[2].line_item_id, "sol_003");
  assert.strictEqual(soLines[2].displayLineNumber, 3);
});

test("T07 — PO without SO reference yields no candidates", () => {
  // PO_ID_2 has no custom field with SO ref
  const po = db.prepare(
    `SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ? ORDER BY fetched_at DESC LIMIT 1`
  ).get(PO_ID_2) as any;
  let soRef: string | null = null;
  try {
    const cf = JSON.parse(po.custom_fields_json || "[]");
    const soField = cf.find((f: any) => (f.label || "").toLowerCase() === "sales order no" || f.api_name === "cf_sales_order_no");
    soRef = soField?.value?.trim() || po.reference_number || null;
  } catch { soRef = po.reference_number || null; }
  assert.strictEqual(soRef, null, "PO_ID_2 should have no SO reference");
});

console.log("\nSECTION 4: API-level CRUD Lifecycle (Create → Read → Reconfirm → Revoke)");

test("T08 — Create mapping returns CREATED with correct fields", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "sol_001",
    purchaseorderId: PO_ID,
    poLineItemId: "pol_001",
    mappingKind: "OWNER_FALLBACK",
    note: "Phase 2 test mapping",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome === "CREATED") {
    assert.ok(result.mapping.mapping_id, "Should return a mapping ID");
  }
});

test("T09 — getCurrentMappingForPoLine returns the created mapping", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mapping, "Mapping should exist");
  assert.strictEqual(mapping!.status, "ACTIVE");
  assert.strictEqual(mapping!.mapping_kind, "OWNER_FALLBACK");
  assert.strictEqual(mapping!.so_line_item_id, "sol_001");
  assert.strictEqual(mapping!.po_line_item_id, "pol_001");
  assert.strictEqual(mapping!.notes, "Phase 2 test mapping");
  assert.strictEqual(mapping!.decision_source, "OWNER");
});

test("T10 — evaluateMappingStaleness returns VALID for fresh mapping", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mapping, "Mapping should exist");
  const staleness = evaluateMappingStaleness(db, mapping!);
  assert.strictEqual(staleness, "VALID", "Fresh mapping should be VALID");
});

test("T11 — Duplicate create returns DUPLICATE, not error", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "sol_001",
    purchaseorderId: PO_ID,
    poLineItemId: "pol_001",
    mappingKind: "OWNER_FALLBACK" as const,
  });
  assert.strictEqual(result.outcome, "DUPLICATE", "Same PO→SO pair should return DUPLICATE");
});

test("T12 — Conflict: same PO line → different SO line returns CONFLICT", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "sol_002",
    purchaseorderId: PO_ID,
    poLineItemId: "pol_001",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "CONFLICT", "Different SO line for same PO line should CONFLICT");
});

console.log("\nSECTION 5: Staleness Detection After Line Data Change");

test("T13 — Staleness becomes REVIEW_REQUIRED after PO line data changes", () => {
  // Change PO line data (different rate).
  // Phase-3: evidence is read from the newest coherent HEADER snapshot, so the
  // newer RUN_B snapshot is seeded as every real writer produces it
  // (header + complete line set in the same source_run_id).
  seedPoHeader(ORG, PO_ID, "PO-2025-001", RUN_B, cfJson);
  seedPoLine(ORG, PO_ID, "pol_002", RUN_B, { item_id: "item_777", item_name: "Unknown Item", quantity: 10, rate: 20, unit: "nos" });
  seedPoLine(ORG, PO_ID, "pol_001", RUN_B, {
    item_id: "item_001", item_name: "Widget Alpha", quantity: 100, rate: 60, unit: "nos"
  });

  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mapping);
  const staleness = evaluateMappingStaleness(db, mapping!);
  assert.strictEqual(staleness, "REVIEW_REQUIRED", "Changed PO line should trigger REVIEW_REQUIRED");
});

test("T14 — markMappingReviewRequired transitions ACTIVE → REVIEW_REQUIRED", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mapping);
  const result = markMappingReviewRequired(db, mapping!.mapping_id, "PO line data changed");
  assert.ok(result, "markMappingReviewRequired should return the updated record");
  assert.strictEqual(result!.status, "REVIEW_REQUIRED");

  const updated = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.strictEqual(updated!.status, "REVIEW_REQUIRED");
});

test("T15 — Reconfirm refreshes fingerprints and returns to ACTIVE", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mapping);
  assert.strictEqual(mapping!.status, "REVIEW_REQUIRED");

  const result = reconfirmOwnerLineMapping(db, mapping!.mapping_id, "Owner confirmed after review");
  assert.strictEqual(result.outcome, "RECONFIRMED");

  const updated = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.strictEqual(updated!.status, "ACTIVE");

  // After reconfirm, staleness should be VALID since fingerprints refreshed
  const staleness = evaluateMappingStaleness(db, updated!);
  assert.strictEqual(staleness, "VALID");
});

console.log("\nSECTION 6: Revoke and Re-create");

test("T16 — Revoke returns REVOKED, mapping status becomes REVOKED", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mapping);
  const result = revokeOwnerLineMapping(db, mapping!.mapping_id, "No longer needed");
  assert.strictEqual(result.outcome, "REVOKED");

  // getCurrentMappingForPoLine should return null (queries non-revoked only)
  const current = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.strictEqual(current, null, "Revoked mapping should not appear as current");
});

test("T17 — After revoke, new mapping can be created to different SO line", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "sol_002",
    purchaseorderId: PO_ID,
    poLineItemId: "pol_001",
    mappingKind: "OWNER_OVERRIDE",
    note: "Remapped after revoke",
  });
  assert.strictEqual(result.outcome, "CREATED");

  const current = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(current);
  assert.strictEqual(current!.so_line_item_id, "sol_002", "New mapping should point to sol_002");
  assert.strictEqual(current!.mapping_kind, "OWNER_OVERRIDE");
});

console.log("\nSECTION 7: History Audit Trail");

test("T18 — getHistoryEventsForPoLine returns full lifecycle events from history table", () => {
  const events = getHistoryEventsForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(events.length >= 5, `Expected at least 5 history events, got ${events.length}`);

  // Verify event types present
  const types = events.map(h => h.event_type);
  assert.ok(types.includes("MAPPING_CREATED"), "Should have CREATED event");
  assert.ok(types.includes("MAPPING_MARKED_REVIEW_REQUIRED"), "Should have MARKED_REVIEW_REQUIRED event");
  assert.ok(types.includes("MAPPING_RECONFIRMED"), "Should have RECONFIRMED event");
  assert.ok(types.includes("MAPPING_REVOKED"), "Should have REVOKED event");

  // Also verify getMappingHistoryForPoLine (mapping records, not events)
  const mappings = getMappingHistoryForPoLine(db, ORG, PO_ID, "pol_001");
  assert.ok(mappings.length >= 2, `Expected at least 2 mapping records (original + re-create), got ${mappings.length}`);

  // Most recent history event should be the second CREATED (re-create after revoke)
  const lastEvent = events[events.length - 1];
  assert.strictEqual(lastEvent.event_type, "MAPPING_CREATED", "Last event should be second CREATED");
  assert.strictEqual(lastEvent.new_status, "ACTIVE");
});

console.log("\nSECTION 8: Validation and Edge Cases");

test("T19 — Validation rejects mapping when SO line does not exist", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "sol_nonexistent_999",
    purchaseorderId: PO_ID,
    poLineItemId: "pol_002",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED", "Should reject non-existent SO line");
});

console.log("\nSECTION 9: Operational DB Safety & ZOHO WRITE = 0");

test("T20 — Operational audit_workspace.db untouched; all Phase 2 ops in temp DB only", () => {
  // Verify we're working in an isolated temp DB
  assert.ok(tmpDbPath.includes("mlm-p2-test-"), "Test DB path should be in temp directory");

  // Verify operational DB file is NOT our test DB
  const operationalPath = path.join(process.cwd(), "data", "audit_workspace.db");
  assert.notStrictEqual(
    path.resolve(tmpDbPath),
    path.resolve(operationalPath),
    "Test DB must not be the operational DB"
  );

  // Verify our test DB has the mapping tables
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'audit_so_po_line_map%'`
  ).all() as any[];
  assert.strictEqual(tables.length, 2, "Test DB should have both mapping tables");
  const tableNames = tables.map((t: any) => t.name).sort();
  assert.deepStrictEqual(tableNames, [
    "audit_so_po_line_mapping_history",
    "audit_so_po_line_mappings",
  ]);

  // Verify operational DB hash unchanged from baseline captured before tests
  const afterDbHash = crypto.createHash('sha256').update(fs.readFileSync(_opDbPath)).digest('hex');
  assert.strictEqual(afterDbHash, _baselineDbHash, 'operational DB hash unchanged after all tests');
  if (fs.existsSync(_opWalPath) && _baselineWalHash !== null) {
    const afterWalHash = crypto.createHash('sha256').update(fs.readFileSync(_opWalPath)).digest('hex');
    assert.strictEqual(afterWalHash, _baselineWalHash, 'operational WAL hash unchanged after all tests');
  }

  // Verify no Zoho API imports in Phase 2 service (spot check)
  const serviceSource = fs.readFileSync(
    path.join(process.cwd(), "app", "lib", "audit", "manual-line-mapping-service.ts"),
    "utf-8"
  );
  assert.ok(!serviceSource.includes("zoho-api"), "Service must not import zoho-api");
  assert.ok(!serviceSource.includes("fetch("), "Service must not make fetch() calls");
});

// ── Cleanup & Summary ──────────────────────────────────────

try {
  // Revoke the mapping created in T17 to leave clean state
  const remaining = getCurrentMappingForPoLine(db, ORG, PO_ID, "pol_001");
  if (remaining) revokeOwnerLineMapping(db, remaining.mapping_id);
} catch { /* ignore cleanup errors */ }

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch { /* ignore cleanup errors */ }

console.log("\n═══════════════════════════════════════════════");
console.log(`  Phase 2 Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("  FAILED:");
  for (const f of failures) console.log(`    ✗ ${f}`);
}
console.log("═══════════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
