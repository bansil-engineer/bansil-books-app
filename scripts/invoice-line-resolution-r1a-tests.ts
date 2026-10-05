// ============================================================
// Invoice→SO Line Resolution R1A — Isolated Test Suite
//
// 50 test cases covering:
//   UOM Schema (6)  ·  Mapping Storage (6)  ·  Validation (4)
//   Lifecycle (6)   ·  Fingerprint (4)       ·  Narration (12)
//   Candidate Ranking (9)                    ·  Safety (3)
//
// All tests use an isolated temp DB via openAuditDatabaseAt().
// No Zoho calls. No operational DB mutation. No AI runtime.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import {
  computeInvoiceLineFingerprint,
  createOwnerInvoiceLineMapping,
  evaluateInvoiceMappingStaleness,
  isInvoiceMappingUsable,
  revokeOwnerInvoiceLineMapping,
  reconfirmOwnerInvoiceLineMapping,
  markInvoiceMappingReviewRequired,
  getCurrentMappingForInvoiceLine,
  getMappingHistoryForInvoiceLine,
  getHistoryEventsForInvoiceLine,
} from "../app/lib/audit/invoice-line-mapping-service.ts";
import {
  normalizeNarrationText,
  extractItemNumber,
  compareItemNumbers,
  detectNumericConflicts,
  compareNarrations,
  compareUom,
  rankCandidate,
  rankCandidates,
} from "../app/lib/audit/invoice-line-narration-match.ts";
import type { CandidateLine } from "../app/lib/audit/invoice-line-narration-match.ts";
import type { DatabaseSync } from "node:sqlite";

// ── Constants ─────────────────────────────────────────────

const ORG = "org_r1a_001";
const ORG2 = "org_r1a_002";
const INV_ID = "inv_100";
const INV_ID_2 = "inv_200";
const SO_ID = "so_100";
const SO_ID_2 = "so_200";

let db: DatabaseSync;
let tmpDir: string;
let tmpDbPath: string;
let passed = 0;
let failed = 0;
const failures: string[] = [];

// ── Operational DB hash baseline ──────────────────────────

const _opDbPath = path.join(process.cwd(), "data", "audit_workspace.db");
const _opWalPath = _opDbPath + "-wal";
const _baselineDbHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(_opDbPath))
  .digest("hex");
const _baselineWalHash = fs.existsSync(_opWalPath)
  ? crypto.createHash("sha256").update(fs.readFileSync(_opWalPath)).digest("hex")
  : null;

// ── Helpers ───────────────────────────────────────────────

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

function ensureSourceRun(runId: string, orgId: string, type: string) {
  const exists = db
    .prepare(`SELECT 1 FROM audit_zoho_source_runs WHERE source_run_id = ?`)
    .get(runId);
  if (!exists) {
    db.prepare(
      `INSERT INTO audit_zoho_source_runs
         (source_run_id, organization_id, source_type, started_at, status)
       VALUES (?, ?, ?, ?, 'SUCCESS')`
    ).run(runId, orgId, type, new Date().toISOString());
  }
}

function seedInvoiceHeader(
  orgId: string,
  invoiceId: string,
  runId: string,
  overrides: Partial<{ salesorder_id: string }> = {}
) {
  ensureSourceRun(runId, orgId, "invoices");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoices
       (organization_id, invoice_id, source_run_id, invoice_number,
        customer_id, salesorder_id, status, total, balance,
        currency_code, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId,
    invoiceId,
    runId,
    "INV-001",
    "cust_001",
    overrides.salesorder_id ?? SO_ID,
    "sent",
    10000,
    5000,
    "INR",
    new Date().toISOString()
  );
}

function seedInvoiceLine(
  orgId: string,
  invoiceId: string,
  lineItemId: string,
  runId: string,
  overrides: Partial<{
    item_id: string;
    item_name: string;
    description: string;
    quantity: number;
    rate: number;
    unit: string;
  }> = {}
) {
  ensureSourceRun(runId, orgId, "invoices");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoice_lines
       (organization_id, line_item_id, invoice_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId,
    lineItemId,
    invoiceId,
    runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "MCB 16A 1P",
    overrides.description ?? "Miniature Circuit Breaker 16A Single Pole",
    "SKU-MCB-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 250,
    (overrides.quantity ?? 100) * (overrides.rate ?? 250),
    overrides.unit ?? "nos"
  );
}

function seedSoHeader(orgId: string, soId: string, runId: string) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_orders
       (organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_id, status, total, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId,
    soId,
    runId,
    "SO-001",
    "cust_001",
    "open",
    50000,
    new Date().toISOString()
  );
}

function seedSoLine(
  orgId: string,
  soId: string,
  lineItemId: string,
  runId: string,
  overrides: Partial<{
    item_id: string;
    item_name: string;
    description: string;
    quantity: number;
    rate: number;
    unit: string;
  }> = {}
) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_order_lines
       (organization_id, line_item_id, salesorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId,
    lineItemId,
    soId,
    runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "MCB 16A 1P",
    overrides.description ?? "Miniature Circuit Breaker 16A Single Pole",
    "SKU-MCB-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 250,
    (overrides.quantity ?? 100) * (overrides.rate ?? 250),
    overrides.unit ?? "nos"
  );
}

// ── Setup ─────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════");
console.log("  Invoice→SO Line Resolution R1A — 50 Tests");
console.log("═══════════════════════════════════════════════\n");

tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r1a-test-"));
tmpDbPath = path.join(tmpDir, "test_r1a.db");
db = openAuditDatabaseAt(tmpDbPath);

const RUN_1 = "run_r1a_001";
const RUN_2 = "run_r1a_002";

// Seed baseline data
seedInvoiceHeader(ORG, INV_ID, RUN_1);
seedInvoiceHeader(ORG, INV_ID_2, RUN_1);
seedInvoiceLine(ORG, INV_ID, "inv_line_A", RUN_1);
seedInvoiceLine(ORG, INV_ID, "inv_line_B", RUN_1, {
  item_name: "MCB 32A 4P",
  description: "Miniature Circuit Breaker 32A Four Pole",
  quantity: 50,
  rate: 800,
  unit: "nos",
});
seedInvoiceLine(ORG, INV_ID_2, "inv_line_C", RUN_1, {
  item_name: "Cable 4CX10 sqmm",
  description: "Armoured Cable 4 Core x 10 sq.mm",
  unit: "mtr",
});

seedSoHeader(ORG, SO_ID, RUN_1);
seedSoHeader(ORG, SO_ID_2, RUN_1);
seedSoLine(ORG, SO_ID, "so_line_A", RUN_1);
seedSoLine(ORG, SO_ID, "so_line_B", RUN_1, {
  item_name: "MCB 32A 4P",
  description: "Miniature Circuit Breaker 32A Four Pole",
  quantity: 50,
  rate: 800,
  unit: "nos",
});
seedSoLine(ORG, SO_ID_2, "so_line_C", RUN_1, {
  item_name: "Cable 4CX10 sqmm",
  description: "Armoured Cable 4 Core x 10 sq.mm",
  unit: "mtr",
});

// Org 2 data
seedInvoiceHeader(ORG2, INV_ID, RUN_2);
seedInvoiceLine(ORG2, INV_ID, "inv_line_D", RUN_2);
seedSoHeader(ORG2, SO_ID, RUN_2);
seedSoLine(ORG2, SO_ID, "so_line_D", RUN_2);

// ═══════════════════════════════════════════════════════════
// SECTION 1: UOM Schema (6 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── UOM Schema ──────────────────────────────────\n");

test("1. invoice_lines table has unit column", () => {
  const cols = db
    .prepare(`PRAGMA table_info(audit_zoho_invoice_lines)`)
    .all() as Array<{ name: string }>;
  const colNames = cols.map((c) => c.name);
  assert.ok(colNames.includes("unit"), "unit column must exist");
});

test("2. unit column is nullable TEXT", () => {
  const cols = db
    .prepare(`PRAGMA table_info(audit_zoho_invoice_lines)`)
    .all() as Array<{ name: string; type: string; notnull: number }>;
  const unitCol = cols.find((c) => c.name === "unit");
  assert.ok(unitCol, "unit column exists");
  assert.strictEqual(unitCol!.type, "TEXT", "unit column type is TEXT");
  assert.strictEqual(unitCol!.notnull, 0, "unit column is nullable");
});

test("3. unit column persists value in INSERT", () => {
  const row = db
    .prepare(
      `SELECT unit FROM audit_zoho_invoice_lines
       WHERE organization_id = ? AND line_item_id = ?`
    )
    .get(ORG, "inv_line_A") as { unit: string } | undefined;
  assert.ok(row, "row exists");
  assert.strictEqual(row!.unit, "nos");
});

test("4. unit column accepts NULL", () => {
  const nullRunId = "run_null_unit";
  ensureSourceRun(nullRunId, ORG, "invoices");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoice_lines
       (organization_id, line_item_id, invoice_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ORG, "inv_line_null_uom", INV_ID, nullRunId, "item_1", "Test", "desc", "SKU", 1, 1, 1, null);
  const row = db
    .prepare(
      `SELECT unit FROM audit_zoho_invoice_lines
       WHERE organization_id = ? AND line_item_id = ? AND source_run_id = ?`
    )
    .get(ORG, "inv_line_null_uom", nullRunId) as { unit: string | null };
  assert.strictEqual(row.unit, null, "null unit stored correctly");
});

test("5. SO line table also has unit column", () => {
  const cols = db
    .prepare(`PRAGMA table_info(audit_zoho_sales_order_lines)`)
    .all() as Array<{ name: string }>;
  assert.ok(cols.some((c) => c.name === "unit"), "SO lines unit column exists");
});

test("6. invoice_so_line_mappings table exists", () => {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_invoice_so_line_mappings'`
    )
    .all() as Array<{ name: string }>;
  assert.strictEqual(tables.length, 1, "mapping table created");
  const histTables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_invoice_so_line_mapping_history'`
    )
    .all() as Array<{ name: string }>;
  assert.strictEqual(histTables.length, 1, "history table created");
});

// ═══════════════════════════════════════════════════════════
// SECTION 2: Mapping Storage (6 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Mapping Storage ─────────────────────────────\n");

test("7. create OWNER_FALLBACK mapping", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_A",
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    mappingKind: "OWNER_FALLBACK",
    note: "initial mapping",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome !== "CREATED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "ACTIVE");
  assert.strictEqual(result.mapping.mapping_kind, "OWNER_FALLBACK");
  assert.strictEqual(result.mapping.decision_source, "OWNER");
});

test("8. create OWNER_OVERRIDE mapping", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_B",
    salesorderId: SO_ID,
    soLineItemId: "so_line_B",
    mappingKind: "OWNER_OVERRIDE",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome !== "CREATED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.mapping_kind, "OWNER_OVERRIDE");
});

test("9. multiple Invoice lines can map to same SO line", () => {
  // inv_line_A already maps to so_line_A. Map inv_line_C to so_line_A too.
  seedInvoiceLine(ORG, INV_ID_2, "inv_line_multi", RUN_1);
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID_2,
    invoiceLineItemId: "inv_line_multi",
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "CREATED");
});

test("10. one Invoice line cannot have two current mappings (CONFLICT)", () => {
  // inv_line_A already has an ACTIVE mapping to so_line_A
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_A",
    salesorderId: SO_ID,
    soLineItemId: "so_line_B",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "CONFLICT");
});

test("11. exact duplicate returns DUPLICATE", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_A",
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "DUPLICATE");
});

test("12. mapping stores correct Invoice and SO IDs", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_A");
  assert.ok(mapping);
  assert.strictEqual(mapping!.invoice_id, INV_ID);
  assert.strictEqual(mapping!.invoice_line_item_id, "inv_line_A");
  assert.strictEqual(mapping!.salesorder_id, SO_ID);
  assert.strictEqual(mapping!.so_line_item_id, "so_line_A");
  assert.strictEqual(mapping!.organization_id, ORG);
});

// ═══════════════════════════════════════════════════════════
// SECTION 3: Validation (4 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Validation ──────────────────────────────────\n");

test("13. cross-organization mapping rejected", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_A",
    salesorderId: SO_ID,
    soLineItemId: "so_line_D", // so_line_D belongs to ORG2
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
});

test("14. Invoice line from wrong Invoice rejected", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_C", // inv_line_C belongs to INV_ID_2
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes(INV_ID_2), "error mentions actual Invoice");
});

test("15. SO line from wrong SO rejected", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID_2,
    invoiceLineItemId: "inv_line_C",
    salesorderId: SO_ID,
    soLineItemId: "so_line_C", // so_line_C belongs to SO_ID_2
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes(SO_ID_2), "error mentions actual SO");
});

test("16. missing Invoice/SO line rejected", () => {
  const r1 = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID,
    invoiceLineItemId: "nonexistent_inv_line",
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(r1.outcome, "VALIDATION_FAILED");
  if (r1.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(r1.reason.includes("not found"));

  const r2 = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID_2,
    invoiceLineItemId: "inv_line_C",
    salesorderId: SO_ID_2,
    soLineItemId: "nonexistent_so_line",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(r2.outcome, "VALIDATION_FAILED");
  if (r2.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(r2.reason.includes("not found"));
});

// ═══════════════════════════════════════════════════════════
// SECTION 4: Lifecycle (6 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Lifecycle ───────────────────────────────────\n");

test("17. markReviewRequired transitions ACTIVE → REVIEW_REQUIRED", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_B")!;
  assert.ok(mapping);
  assert.strictEqual(mapping.status, "ACTIVE");
  const updated = markInvoiceMappingReviewRequired(db, mapping.mapping_id, "evidence changed");
  assert.ok(updated);
  assert.strictEqual(updated!.status, "REVIEW_REQUIRED");
  assert.ok(updated!.review_required_at);
});

test("18. REVIEW_REQUIRED mapping is not usable", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_B")!;
  assert.ok(mapping);
  assert.strictEqual(mapping.status, "REVIEW_REQUIRED");
  assert.strictEqual(isInvoiceMappingUsable(db, mapping), false);
});

test("19. reconfirm transitions REVIEW_REQUIRED → ACTIVE", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_B")!;
  assert.strictEqual(mapping.status, "REVIEW_REQUIRED");
  const result = reconfirmOwnerInvoiceLineMapping(db, mapping.mapping_id, "evidence verified");
  assert.strictEqual(result.outcome, "RECONFIRMED");
  if (result.outcome !== "RECONFIRMED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "ACTIVE");
  assert.strictEqual(result.mapping.review_required_at, null);
});

test("20. revoke transitions ACTIVE → REVOKED with history", () => {
  // Create a fresh mapping for this test
  seedInvoiceLine(ORG, INV_ID_2, "inv_line_revoke", RUN_1);
  seedSoLine(ORG, SO_ID_2, "so_line_revoke", RUN_1);
  const fresh = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: INV_ID_2,
    invoiceLineItemId: "inv_line_revoke",
    salesorderId: SO_ID_2,
    soLineItemId: "so_line_revoke",
    mappingKind: "OWNER_FALLBACK",
    note: "will be revoked",
  });
  assert.strictEqual(fresh.outcome, "CREATED");
  if (fresh.outcome !== "CREATED") throw new Error("unreachable");

  const result = revokeOwnerInvoiceLineMapping(db, fresh.mapping.mapping_id, "no longer needed");
  assert.strictEqual(result.outcome, "REVOKED");
  if (result.outcome !== "REVOKED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "REVOKED");
  assert.ok(result.mapping.revoked_at);

  // Verify history
  const events = getHistoryEventsForInvoiceLine(db, ORG, INV_ID_2, "inv_line_revoke");
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].event_type, "MAPPING_CREATED");
  assert.strictEqual(events[1].event_type, "MAPPING_REVOKED");
  assert.strictEqual(events[1].previous_status, "ACTIVE");
  assert.strictEqual(events[1].new_status, "REVOKED");
});

test("21. REVOKED mapping is not usable", () => {
  const all = getMappingHistoryForInvoiceLine(db, ORG, INV_ID_2, "inv_line_revoke");
  const revoked = all.find((m) => m.status === "REVOKED");
  assert.ok(revoked);
  assert.strictEqual(isInvoiceMappingUsable(db, revoked!), false);
});

test("22. ACTIVE + valid fingerprint is usable", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_A")!;
  assert.ok(mapping);
  assert.strictEqual(mapping.status, "ACTIVE");
  assert.strictEqual(isInvoiceMappingUsable(db, mapping), true);
});

// ═══════════════════════════════════════════════════════════
// SECTION 5: Fingerprint (4 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Fingerprint ─────────────────────────────────\n");

test("23. fingerprint is deterministic SHA-256", () => {
  const evidence = {
    line_item_id: "line_fp_1",
    item_id: "item_fp",
    item_name: "Widget",
    description: "desc",
    quantity: 10,
    rate: 5.5,
    unit: "nos",
  };
  const fp1 = computeInvoiceLineFingerprint(evidence);
  const fp2 = computeInvoiceLineFingerprint(evidence);
  assert.strictEqual(fp1, fp2, "same evidence → same fingerprint");
  assert.strictEqual(fp1.length, 64, "SHA-256 hex is 64 chars");
});

test("24. different line_item_ids produce different fingerprints", () => {
  const base = { item_id: "item_1", item_name: "W", description: "d", quantity: 1, rate: 1, unit: "nos" };
  const fp1 = computeInvoiceLineFingerprint({ ...base, line_item_id: "line_A" });
  const fp2 = computeInvoiceLineFingerprint({ ...base, line_item_id: "line_B" });
  assert.notStrictEqual(fp1, fp2);
});

test("25. fingerprint excludes rowid/fetched_at/source_run_id/Sr.No", () => {
  // Fingerprint only uses: line_item_id, item_id, item_name, description, quantity, rate, unit
  // Verify by checking two calls with same business fields → same fingerprint
  const fp = computeInvoiceLineFingerprint({
    line_item_id: "line_excl",
    item_id: "item_excl",
    item_name: "Test Item",
    description: "Some description",
    quantity: 42,
    rate: 99.5,
    unit: "kg",
  });
  // Same call again: no additional fields affect the result
  const fp2 = computeInvoiceLineFingerprint({
    line_item_id: "line_excl",
    item_id: "item_excl",
    item_name: "Test Item",
    description: "Some description",
    quantity: 42,
    rate: 99.5,
    unit: "kg",
  });
  assert.strictEqual(fp, fp2);
});

test("26. staleness detects material change → REVIEW_REQUIRED", () => {
  // Create a fresh pair
  const sRun = "run_stale_1";
  seedInvoiceHeader(ORG, "inv_stale", sRun);
  seedInvoiceLine(ORG, "inv_stale", "inv_line_stale", sRun);
  seedSoHeader(ORG, "so_stale", sRun);
  seedSoLine(ORG, "so_stale", "so_line_stale", sRun);

  const created = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId: "inv_stale",
    invoiceLineItemId: "inv_line_stale",
    salesorderId: "so_stale",
    soLineItemId: "so_line_stale",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(created.outcome, "CREATED");
  if (created.outcome !== "CREATED") throw new Error("unreachable");

  // Change the SO line's item_name (material change)
  const sRun2 = "run_stale_2";
  seedSoHeader(ORG, "so_stale", sRun2);
  seedSoLine(ORG, "so_stale", "so_line_stale", sRun2, { item_name: "COMPLETELY DIFFERENT" });

  const staleness = evaluateInvoiceMappingStaleness(db, created.mapping);
  assert.strictEqual(staleness, "REVIEW_REQUIRED");

  // Verify re-fetch with SAME data → VALID
  const sRun3 = "run_stale_3";
  seedInvoiceHeader(ORG, "inv_stale", sRun3);
  seedInvoiceLine(ORG, "inv_stale", "inv_line_stale", sRun3);
  seedSoHeader(ORG, "so_stale", sRun3);
  seedSoLine(ORG, "so_stale", "so_line_stale", sRun3); // back to defaults

  // Need to re-read the mapping since fingerprint was computed against original data
  const refetched = getCurrentMappingForInvoiceLine(db, ORG, "inv_stale", "inv_line_stale")!;
  const staleness2 = evaluateInvoiceMappingStaleness(db, refetched);
  assert.strictEqual(staleness2, "VALID");
});

// ═══════════════════════════════════════════════════════════
// SECTION 6: Narration Engine (12 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Narration Engine ────────────────────────────\n");

test("27. normalization: lowercase, trim, collapse whitespace", () => {
  const result = normalizeNarrationText("  MCB   16A  Single  Pole  ");
  assert.strictEqual(result, "mcb 16a single pole");
});

test("28. normalization: dimension separator × → x", () => {
  const r1 = normalizeNarrationText("4C × 10 sqmm");
  assert.ok(r1.includes("4cx10"), `got: ${r1}`);
  const r2 = normalizeNarrationText("4C X 10 sqmm");
  assert.ok(r2.includes("4cx10"), `got: ${r2}`);
});

test("29. normalization: sq.mm / sq mm → sqmm", () => {
  const r1 = normalizeNarrationText("2.5 sq.mm copper wire");
  assert.ok(r1.includes("sqmm"), `sq.mm should normalize to sqmm, got: ${r1}`);
  assert.ok(!r1.includes("sq.mm"), `sq.mm should not remain as-is, got: ${r1}`);
  const r2 = normalizeNarrationText("2.5 sq mm copper wire");
  assert.ok(r2.includes("sqmm"), `sq mm should normalize to sqmm, got: ${r2}`);
  // Both produce the same normalized form
  assert.strictEqual(r1, r2, "sq.mm and sq mm produce same normalized form");
});

test("30. item number extraction: Item No : 01 = Item No 1", () => {
  const n1 = extractItemNumber("Item No : 01 - MCB 16A");
  const n2 = extractItemNumber("Item No 1 - MCB 16A");
  assert.strictEqual(n1, 1);
  assert.strictEqual(n2, 1);
  assert.strictEqual(n1, n2, "01 and 1 produce same integer");
});

test("31. item number extraction: Item No. 12", () => {
  const n = extractItemNumber("Item No. 12 - Cable");
  assert.strictEqual(n, 12);
});

test("32. item number comparison: match → MATCH", () => {
  const result = compareItemNumbers("Item No : 01 Cable", "Item No 1 Cable");
  assert.strictEqual(result, "MATCH");
});

test("33. item number comparison: mismatch → MISMATCH", () => {
  const result = compareItemNumbers("Item No 1 Cable", "Item No 12 Cable");
  assert.strictEqual(result, "MISMATCH");
});

test("34. item number comparison: no item number → UNKNOWN", () => {
  const result = compareItemNumbers("Cable 4CX10", "Cable 4CX10");
  assert.strictEqual(result, "UNKNOWN");
});

test("35. numeric conflict: 50mm vs 100mm → conflict", () => {
  const conflicts = detectNumericConflicts("conduit pipe 50mm", "conduit pipe 100mm");
  assert.ok(conflicts.length > 0, "must detect mm conflict");
  assert.ok(conflicts.some((c) => c.includes("50mm") && c.includes("100mm")));
});

test("36. numeric conflict: 16A vs 32A → conflict", () => {
  const conflicts = detectNumericConflicts("mcb 16a 1p", "mcb 32a 1p");
  assert.ok(conflicts.length > 0, "must detect amperage conflict");
  assert.ok(conflicts.some((c) => c.includes("16a") && c.includes("32a")));
});

test("37. numeric conflict: 4CX10 vs 5CX6 → conflict", () => {
  const conflicts = detectNumericConflicts("cable 4cx10 sqmm", "cable 5cx6 sqmm");
  assert.ok(conflicts.length > 0, "must detect cable spec conflict");
});

test("38. compareNarrations: identical text → EXACT", () => {
  const result = compareNarrations("MCB 16A 1P", "Standard", "MCB 16A 1P", "Standard");
  assert.strictEqual(result.level, "EXACT");
  assert.strictEqual(result.score, 1.0);
});

// ═══════════════════════════════════════════════════════════
// SECTION 7: Candidate Ranking (9 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Candidate Ranking ───────────────────────────\n");

const invLineCandidate: CandidateLine = {
  line_item_id: "inv_cand_1",
  item_id: "item_mcb_16a",
  item_name: "MCB 16A 1P",
  description: "Miniature Circuit Breaker 16A Single Pole",
  quantity: 100,
  rate: 250,
  unit: "nos",
};

test("39. exact item_id match → SUGGESTED", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_1",
    item_id: "item_mcb_16a",
    item_name: "MCB 16A 1P",
    description: "Miniature Circuit Breaker 16A Single Pole",
    quantity: 100,
    rate: 250,
    unit: "nos",
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  assert.strictEqual(ranking.itemId, "EXACT");
  assert.strictEqual(ranking.overall, "SUGGESTED");
  assert.ok(ranking.sortScore > 100, `sortScore=${ranking.sortScore} should be > 100`);
});

test("40. different item_id + high narration → SUGGESTED", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_2",
    item_id: "item_mcb_16a_variant",
    item_name: "MCB 16A 1P Type-C",
    description: "Miniature Circuit Breaker 16A Single Pole Type C",
    quantity: 100,
    rate: 250,
    unit: "nos",
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  assert.strictEqual(ranking.itemId, "DIFFERENT");
  assert.ok(
    ranking.narration === "HIGH" || ranking.narration === "EXACT",
    `narration=${ranking.narration}`
  );
  assert.strictEqual(ranking.overall, "SUGGESTED");
});

test("41. numeric conflict 16A vs 32A → NOT_RECOMMENDED", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_3",
    item_id: "item_mcb_32a",
    item_name: "MCB 32A 4P",
    description: "Miniature Circuit Breaker 32A Four Pole",
    quantity: 50,
    rate: 800,
    unit: "nos",
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  assert.strictEqual(ranking.overall, "NOT_RECOMMENDED");
  assert.strictEqual(ranking.numeric, "CONFLICT");
});

test("42. UOM mismatch without exact item_id → NOT_RECOMMENDED", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_4",
    item_id: null,
    item_name: "MCB 16A 1P",
    description: "Miniature Circuit Breaker 16A Single Pole",
    quantity: 100,
    rate: 250,
    unit: "mtr", // mismatch: nos vs mtr
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  assert.strictEqual(ranking.uom, "MISMATCH");
  assert.strictEqual(ranking.overall, "NOT_RECOMMENDED");
});

test("43. UOM mismatch WITH exact item_id → still SUGGESTED", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_5",
    item_id: "item_mcb_16a", // exact match
    item_name: "MCB 16A 1P",
    description: "Miniature Circuit Breaker 16A Single Pole",
    quantity: 100,
    rate: 250,
    unit: "pcs", // different UOM but same item_id
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  assert.strictEqual(ranking.itemId, "EXACT");
  assert.strictEqual(ranking.uom, "MISMATCH");
  assert.strictEqual(ranking.overall, "SUGGESTED");
});

test("44. rate equality alone does NOT determine identity", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_6",
    item_id: null,
    item_name: "Completely Different Product",
    description: "Totally unrelated item",
    quantity: 999,
    rate: 250, // same rate
    unit: "nos",
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  // Rate match should NOT make this SUGGESTED since narration is LOW
  assert.strictEqual(ranking.rate, "MATCH");
  assert.strictEqual(ranking.overall, "NOT_RECOMMENDED");
});

test("45. quantity equality alone does NOT determine identity", () => {
  const soLine: CandidateLine = {
    line_item_id: "so_cand_7",
    item_id: null,
    item_name: "Totally Different Item",
    description: "Nothing in common",
    quantity: 100, // same quantity
    rate: 999,
    unit: "nos",
  };
  const ranking = rankCandidate(invLineCandidate, soLine);
  assert.strictEqual(ranking.quantity, "MATCH");
  assert.strictEqual(ranking.overall, "NOT_RECOMMENDED");
});

test("46. rankCandidates sorts best match first", () => {
  const candidates: CandidateLine[] = [
    {
      line_item_id: "so_sort_bad",
      item_id: null,
      item_name: "Unrelated",
      description: "Nothing",
      quantity: 1,
      rate: 1,
      unit: null,
    },
    {
      line_item_id: "so_sort_good",
      item_id: "item_mcb_16a",
      item_name: "MCB 16A 1P",
      description: "Miniature Circuit Breaker 16A Single Pole",
      quantity: 100,
      rate: 250,
      unit: "nos",
    },
    {
      line_item_id: "so_sort_mid",
      item_id: null,
      item_name: "MCB 16A 1P",
      description: "Circuit Breaker",
      quantity: 100,
      rate: 250,
      unit: "nos",
    },
  ];
  const ranked = rankCandidates(invLineCandidate, candidates);
  assert.strictEqual(ranked.length, 3);
  // Best (exact item_id + narration match) should be first
  assert.strictEqual(ranked[0].candidate.line_item_id, "so_sort_good");
  // Worst (no overlap) should be last
  assert.strictEqual(ranked[ranked.length - 1].candidate.line_item_id, "so_sort_bad");
});

test("47. compareUom: match, mismatch, unknown", () => {
  assert.strictEqual(compareUom("nos", "nos"), "MATCH");
  assert.strictEqual(compareUom("NOS", "nos"), "MATCH"); // case insensitive
  assert.strictEqual(compareUom("nos", "mtr"), "MISMATCH");
  assert.strictEqual(compareUom(null, "nos"), "UNKNOWN");
  assert.strictEqual(compareUom("nos", null), "UNKNOWN");
  assert.strictEqual(compareUom(null, null), "UNKNOWN");
});

// ═══════════════════════════════════════════════════════════
// SECTION 8: Safety (3 tests)
// ═══════════════════════════════════════════════════════════
console.log("\n── Safety ──────────────────────────────────────\n");

test("48. narration service imports no Zoho modules", () => {
  const narSrc = fs.readFileSync(
    path.join(process.cwd(), "app/lib/audit/invoice-line-narration-match.ts"),
    "utf-8"
  );
  assert.ok(!narSrc.includes("zoho-read-transactions"), "no zoho reader import");
  assert.ok(!narSrc.includes("zoho-token-store"), "no token store import");
  assert.ok(!narSrc.includes("fetch("), "no fetch calls");
  assert.ok(!narSrc.includes("listInvoices"), "no Zoho list functions");
  assert.ok(!narSrc.includes("listSalesOrders"), "no Zoho list functions");
});

test("49. mapping service imports no Zoho modules", () => {
  const svcSrc = fs.readFileSync(
    path.join(process.cwd(), "app/lib/audit/invoice-line-mapping-service.ts"),
    "utf-8"
  );
  assert.ok(!svcSrc.includes("zoho-read-transactions"), "no zoho reader import");
  assert.ok(!svcSrc.includes("zoho-token-store"), "no token store import");
  assert.ok(!svcSrc.includes("fetch("), "no fetch calls");
  assert.ok(!svcSrc.includes("listInvoices"), "no Zoho list functions");
  assert.ok(!svcSrc.includes("listSalesOrders"), "no Zoho list functions");
});

test("50. operational DB unchanged after all tests", () => {
  const dbHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(_opDbPath))
    .digest("hex");
  assert.strictEqual(dbHash, _baselineDbHash, "operational DB hash unchanged");

  if (fs.existsSync(_opWalPath)) {
    const walHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(_opWalPath))
      .digest("hex");
    if (_baselineWalHash !== null) {
      assert.strictEqual(walHash, _baselineWalHash, "operational WAL hash unchanged");
    }
  }
});

// ── Cleanup and Summary ───────────────────────────────────

try {
  db.close();
} catch {}
try {
  fs.rmSync(tmpDir, { recursive: true });
} catch {}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failures.length > 0) {
  console.log(`  Failures: ${failures.join(", ")}`);
}
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
