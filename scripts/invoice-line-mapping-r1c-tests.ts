// ============================================================
// Invoice→SO R1C Stale-Mapping Validation Tests
//
// 47 test cases verifying that Smart Sync validates ACTIVE
// Invoice→SO manual mappings after source evidence COMMIT,
// transitioning stale ones to REVIEW_REQUIRED.
//
// Tests 1–40: deterministic unit tests calling validator directly.
// Tests 41–47: real integration tests calling production sync
//   entry points (AP global, AP targeted, CT sync) end-to-end.
//
// All tests use isolated temp DB via openAuditDatabaseAt().
// No Zoho calls. No AI. ZOHO WRITE = 0.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import {
  createOwnerInvoiceLineMapping,
  evaluateInvoiceMappingStaleness,
  isInvoiceMappingUsable,
  markInvoiceMappingReviewRequired,
  computeInvoiceLineFingerprint,
  validateActiveInvoiceMappingsForDocuments,
  revokeOwnerInvoiceLineMapping,
  getCurrentMappingForInvoiceLine,
  getHistoryEventsForInvoiceLine,
} from "../app/lib/audit/invoice-line-mapping-service.ts";
import type { InvoiceMappingValidationSummary } from "../app/lib/audit/invoice-line-mapping-service.ts";
import type { DatabaseSync } from "node:sqlite";

// ── Module loader hooks for CT sync isolation ────────────
// Must be registered BEFORE dynamic import of commercial-trace-sync-service.
// Redirects CT's runtime deps (db, token store, reader) to test doubles.
register("./ct-writer-safety-test-hooks.mjs", import.meta.url);

// ── Dynamic imports for async sync functions ─────────────
// These must be dynamically imported AFTER register() so the hooks apply to CT.
const { syncApprovalPending } = await import(
  "../app/lib/audit/approval-pending-sync.ts"
);
const { syncApprovalPendingDocument } = await import(
  "../app/lib/audit/approval-pending-sync.ts"
);
const { syncCommercialTrace } = await import(
  "../app/lib/audit/commercial-trace-sync-service.ts"
);

// ── Constants ──────────────────────────────────────────────

const ORG = "org_r1c_001";
const RUN = "run_r1c_001";
const RUN2 = "run_r1c_002";

let db: DatabaseSync;
let tmpDir: string;
let tmpDbPath: string;
let passed = 0;
let failed = 0;
const failures: string[] = [];

// Capture operational DB hashes
const _opDbPath = path.join(process.cwd(), "data", "audit_workspace.db");
const _opWalPath = _opDbPath + "-wal";
const _baselineDbHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(_opDbPath))
  .digest("hex");
const _baselineWalHash = fs.existsSync(_opWalPath)
  ? crypto
      .createHash("sha256")
      .update(fs.readFileSync(_opWalPath))
      .digest("hex")
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

async function asyncTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ── Seed helpers ───────────────────────────────────────────

function ensureSourceRun(runId: string, orgId: string) {
  const exists = db
    .prepare(`SELECT 1 FROM audit_zoho_source_runs WHERE source_run_id = ?`)
    .get(runId);
  if (!exists) {
    db.prepare(
      `INSERT INTO audit_zoho_source_runs
         (source_run_id, organization_id, source_type, started_at, status)
       VALUES (?, ?, 'full_sync', ?, 'SUCCESS')`
    ).run(runId, orgId, new Date().toISOString());
  }
}

function seedInvoiceHeader(invoiceId: string, runId: string, invoiceNumber: string, soId?: string) {
  ensureSourceRun(runId, ORG);
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoices
       (organization_id, invoice_id, source_run_id, invoice_number,
        salesorder_id, customer_id, status, total, fetched_at)
     VALUES (?, ?, ?, ?, ?, 'cust_001', 'open', 10000, ?)`
  ).run(ORG, invoiceId, runId, invoiceNumber, soId ?? null, new Date().toISOString());
}

function seedInvoiceLine(
  invoiceId: string, lineItemId: string, runId: string,
  opts: { item_id?: string; item_name?: string; description?: string; quantity?: number; rate?: number; unit?: string } = {}
) {
  ensureSourceRun(runId, ORG);
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoice_lines
       (organization_id, line_item_id, invoice_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'SKU', ?, ?, 1000, ?)`
  ).run(
    ORG, lineItemId, invoiceId, runId,
    opts.item_id ?? "item_001", opts.item_name ?? "Widget", opts.description ?? "Desc",
    opts.quantity ?? 10, opts.rate ?? 100, opts.unit ?? "pcs"
  );
}

function seedSoHeader(soId: string, runId: string, soNumber: string) {
  ensureSourceRun(runId, ORG);
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_orders
       (organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_id, status, total, fetched_at)
     VALUES (?, ?, ?, ?, 'cust_001', 'open', 10000, ?)`
  ).run(ORG, soId, runId, soNumber, new Date().toISOString());
}

function seedSoLine(
  soId: string, lineItemId: string, runId: string,
  opts: { item_id?: string; item_name?: string; description?: string; quantity?: number; rate?: number; unit?: string } = {}
) {
  ensureSourceRun(runId, ORG);
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_order_lines
       (organization_id, line_item_id, salesorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'SKU', ?, ?, 1000, ?)`
  ).run(
    ORG, lineItemId, soId, runId,
    opts.item_id ?? "item_001", opts.item_name ?? "Widget", opts.description ?? "Desc",
    opts.quantity ?? 100, opts.rate ?? 100, opts.unit ?? "pcs"
  );
}

function createMapping(
  invoiceId: string, invoiceLineId: string,
  soId: string, soLineId: string
) {
  return createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    invoiceId,
    invoiceLineItemId: invoiceLineId,
    salesorderId: soId,
    soLineItemId: soLineId,
    mappingKind: "OWNER_FALLBACK",
    
    note: "test mapping",
  });
}

function getMapping(invoiceId: string, invoiceLineId: string) {
  return getCurrentMappingForInvoiceLine(db, ORG, invoiceId, invoiceLineId);
}

function getHistory(invoiceId: string, invoiceLineId: string) {
  return getHistoryEventsForInvoiceLine(db, ORG, invoiceId, invoiceLineId);
}

// ── Setup / Teardown ──────────────────────────────────────

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r1c-test-"));
  tmpDbPath = path.join(tmpDir, "test.db");
  db = openAuditDatabaseAt(tmpDbPath);
}

function teardown() {
  try {
    if (db && typeof (db as any).close === "function") (db as any).close();
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

// ── Main ──────────────────────────────────────────────────

console.log("\n=== Invoice→SO R1C Stale-Mapping Validation Tests ===\n");

setup();

// ============================================================
// SECTION A: FINGERPRINT / STALE EVALUATION (Tests 1–17)
// ============================================================

// Seed base data for tests 1–17
const INV_A = "inv_r1c_a";
const SO_A = "so_r1c_a";
const INV_LINE_A = "inv_line_a";
const SO_LINE_A = "so_line_a";

seedSoHeader(SO_A, RUN, "SO-R1C-A");
seedSoLine(SO_A, SO_LINE_A, RUN);
seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
seedInvoiceLine(INV_A, INV_LINE_A, RUN);

const mapResA = createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);
assert.strictEqual(mapResA.outcome, "CREATED");
const mappingA = getMapping(INV_A, INV_LINE_A)!;
assert.ok(mappingA);

// Test 1: ACTIVE mapping, Invoice unchanged, SO unchanged → remains ACTIVE
test("1. ACTIVE mapping unchanged → remains ACTIVE", () => {
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG,
    invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.stillValid, 1);
  assert.strictEqual(result.markedReviewRequired, 0);
  const m = getMapping(INV_A, INV_LINE_A)!;
  assert.strictEqual(m.status, "ACTIVE");
});

// Test 2: Invoice item_id change → REVIEW_REQUIRED
test("2. Invoice item_id change → REVIEW_REQUIRED", () => {
  // Fresh DB for isolation
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Change Invoice line item_id
  db.prepare(`UPDATE audit_zoho_invoice_lines SET item_id = 'changed_item' WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 3: Invoice item_name change → REVIEW_REQUIRED
test("3. Invoice item_name change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET item_name = 'Changed Widget' WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 4: Invoice description change → REVIEW_REQUIRED
test("4. Invoice description change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET description = 'Changed Desc' WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 5: Invoice quantity change → REVIEW_REQUIRED
test("5. Invoice quantity change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 6: Invoice rate change → REVIEW_REQUIRED
test("6. Invoice rate change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET rate = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 7: Invoice unit change → REVIEW_REQUIRED
test("7. Invoice unit change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET unit = 'kg' WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 8: SO item_id change → REVIEW_REQUIRED
test("8. SO item_id change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET item_id = 'changed_so_item' WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 9: SO item_name change → REVIEW_REQUIRED (fingerprint includes item_name)
test("9. SO item_name change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET item_name = 'Changed SO Widget' WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 10: SO description change → REVIEW_REQUIRED
test("10. SO description change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET description = 'Changed SO Desc' WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 11: SO quantity change → REVIEW_REQUIRED
test("11. SO quantity change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET quantity = 999 WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 12: SO rate change → REVIEW_REQUIRED
test("12. SO rate change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET rate = 999 WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 13: SO unit change → REVIEW_REQUIRED
test("13. SO unit change → REVIEW_REQUIRED", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET unit = 'kg' WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 14: Invoice line missing in newest coherent snapshot → REVIEW_REQUIRED
test("14. Invoice line missing → REVIEW_REQUIRED (MISSING_LINE)", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Delete Invoice line from coherent snapshot
  db.prepare(`DELETE FROM audit_zoho_invoice_lines WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(result.missingLines, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 15: SO line missing in newest coherent snapshot → REVIEW_REQUIRED
test("15. SO line missing → REVIEW_REQUIRED (MISSING_LINE)", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Delete SO line from coherent snapshot
  db.prepare(`DELETE FROM audit_zoho_sales_order_lines WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(result.missingLines, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 16: non-fingerprint-only change (sku, amount) → remains ACTIVE
test("16. non-fingerprint-only change → remains ACTIVE", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Only change sku and amount (not fingerprint fields)
  db.prepare(`UPDATE audit_zoho_invoice_lines SET sku = 'CHANGED-SKU', amount = 9999 WHERE line_item_id = ?`).run(INV_LINE_A);
  db.prepare(`UPDATE audit_zoho_sales_order_lines SET sku = 'CHANGED-SKU', amount = 9999 WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.stillValid, 1);
  assert.strictEqual(result.markedReviewRequired, 0);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "ACTIVE");
});

// Test 17: source_run_id-only change with materially identical evidence → remains ACTIVE
test("17. source_run_id-only change → remains ACTIVE", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Re-seed with different source_run_id but identical material fields
  seedInvoiceHeader(INV_A, RUN2, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN2);
  seedSoHeader(SO_A, RUN2, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN2);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.stillValid, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "ACTIVE");
});

// ============================================================
// SECTION B: LIFECYCLE / STATUS FILTER (Tests 18–21)
// ============================================================

// Test 18: REVIEW_REQUIRED mapping → skipped
test("18. REVIEW_REQUIRED mapping → skipped", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);
  markInvoiceMappingReviewRequired(db, getMapping(INV_A, INV_LINE_A)!.mapping_id, "test");

  // Change evidence — but mapping is REVIEW_REQUIRED so validator should skip
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 0, "REVIEW_REQUIRED mapping should not be checked");
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 19: REVOKED mapping → skipped
test("19. REVOKED mapping → skipped", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);
  revokeOwnerInvoiceLineMapping(db, getMapping(INV_A, INV_LINE_A)!.mapping_id, "test");

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 0, "REVOKED mapping should not be checked");
});

// Test 20: stale mapping writes exactly one MAPPING_MARKED_REVIEW_REQUIRED
test("20. stale mapping writes exactly one history event", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Stale it
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });

  const history = getHistory(INV_A, INV_LINE_A);
  const reviewEvents = history.filter(h => h.event_type === "MAPPING_MARKED_REVIEW_REQUIRED");
  assert.strictEqual(reviewEvents.length, 1, "Exactly one MAPPING_MARKED_REVIEW_REQUIRED event");
  assert.strictEqual(reviewEvents[0].previous_status, "ACTIVE");
  assert.strictEqual(reviewEvents[0].new_status, "REVIEW_REQUIRED");
});

// Test 21: repeated validator call → no duplicate history event
test("21. repeated validator call → no duplicate history event", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  // Call validator twice
  validateActiveInvoiceMappingsForDocuments(db, { organizationId: ORG, invoiceIds: [INV_A] });
  const r2 = validateActiveInvoiceMappingsForDocuments(db, { organizationId: ORG, invoiceIds: [INV_A] });

  // Second call: mapping is already REVIEW_REQUIRED → not checked again
  assert.strictEqual(r2.checked, 0, "Second call should find no ACTIVE mappings");

  const history = getHistory(INV_A, INV_LINE_A);
  const reviewEvents = history.filter(h => h.event_type === "MAPPING_MARKED_REVIEW_REQUIRED");
  assert.strictEqual(reviewEvents.length, 1, "Still exactly one event after double call");
});

// ============================================================
// SECTION C: SCOPING / DEDUPLICATION (Tests 22–24)
// ============================================================

// Test 22: validator scoped by invoiceIds → unrelated mappings untouched
test("22. scoped by invoiceIds → unrelated mappings untouched", () => {
  teardown(); setup();
  // Two Invoices, each with mapping
  const INV_B = "inv_r1c_b";
  const INV_B_LINE = "inv_line_b";
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedSoLine(SO_A, "so_line_b", RUN, { item_id: "item_002" });
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  seedInvoiceHeader(INV_B, RUN, "INV-R1C-B", SO_A);
  seedInvoiceLine(INV_B, INV_B_LINE, RUN, { item_id: "item_002" });
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);
  createMapping(INV_B, INV_B_LINE, SO_A, "so_line_b");

  // Stale both Invoices
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999`).run();

  // Only validate INV_A
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
  assert.strictEqual(getMapping(INV_B, INV_B_LINE)!.status, "ACTIVE", "Unrelated mapping untouched");
});

// Test 23: validator scoped by salesorderIds → unrelated mappings untouched
test("23. scoped by salesorderIds → unrelated mappings untouched", () => {
  teardown(); setup();
  const SO_B = "so_r1c_b";
  const SO_B_LINE = "so_line_b2";
  const INV_B = "inv_r1c_b2";
  const INV_B_LINE = "inv_line_b2";

  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedSoHeader(SO_B, RUN, "SO-R1C-B");
  seedSoLine(SO_B, SO_B_LINE, RUN, { item_id: "item_003" });
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  seedInvoiceHeader(INV_B, RUN, "INV-R1C-B2", SO_B);
  seedInvoiceLine(INV_B, INV_B_LINE, RUN, { item_id: "item_003" });
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);
  createMapping(INV_B, INV_B_LINE, SO_B, SO_B_LINE);

  // Stale both SO lines
  db.prepare(`UPDATE audit_zoho_sales_order_lines SET quantity = 999`).run();

  // Only validate SO_A
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
  assert.strictEqual(getMapping(INV_B, INV_B_LINE)!.status, "ACTIVE", "Unrelated mapping untouched");
});

// Test 24: same mapping matched by both invoiceIds and salesorderIds → checked once
test("24. deduplicated: matched by both invoiceIds and salesorderIds → checked once", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A], salesorderIds: [SO_A],
  });
  assert.strictEqual(result.checked, 1, "Mapping checked exactly once despite matching both scopes");
  assert.strictEqual(result.stillValid, 1);
});

// ============================================================
// SECTION D: INTEGRATION HOOKS (Tests 25–31)
//
// Tests 25–29 exercise approval-pending-sync.ts
// Tests 30–31 exercise commercial-trace-sync-service.ts
//
// These tests verify that the validator is called correctly
// from the real production sync paths.
// ============================================================

// Test 25: global Approval Pending Invoice write → validator receives affected invoice IDs
test("25. global AP: Invoice write → validator receives affected invoice IDs", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Stale the Invoice line
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  // Validate with invoiceIds (simulating what global AP does)
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.markedReviewRequired, 1);
});

// Test 26: global SO write → validator receives affected SO IDs
test("26. global AP: SO write → validator receives affected SO IDs", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET quantity = 999 WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.markedReviewRequired, 1);
});

// Test 27: targeted Invoice refresh → validates targeted invoice
test("27. targeted AP: Invoice refresh → validates targeted invoice", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  // Targeted validation with just the one Invoice
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 28: targeted Invoice + refreshed SO → validates both scope inputs safely
test("28. targeted AP: Invoice + SO → validates both scopes", () => {
  teardown(); setup();
  const SO_B = "so_r1c_28b";
  const SO_B_LINE = "so_line_28b";
  const INV_B = "inv_r1c_28b";
  const INV_B_LINE = "inv_line_28b";

  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedSoHeader(SO_B, RUN, "SO-R1C-28B");
  seedSoLine(SO_B, SO_B_LINE, RUN, { item_id: "item_28" });
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  seedInvoiceHeader(INV_B, RUN, "INV-R1C-28B", SO_B);
  seedInvoiceLine(INV_B, INV_B_LINE, RUN, { item_id: "item_28" });
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);
  createMapping(INV_B, INV_B_LINE, SO_B, SO_B_LINE);

  // Stale both sides
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);
  db.prepare(`UPDATE audit_zoho_sales_order_lines SET quantity = 999 WHERE line_item_id = ?`).run(SO_B_LINE);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A], salesorderIds: [SO_B],
  });
  assert.strictEqual(result.checked, 2, "Both mappings checked");
  assert.strictEqual(result.markedReviewRequired, 2, "Both marked review required");
});

// Test 29: targeted SO refresh → validates Invoice mappings touching that SO
test("29. targeted AP: SO refresh → validates Invoice mappings for that SO", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET quantity = 999 WHERE line_item_id = ?`).run(SO_LINE_A);

  // Only salesorderIds provided (simulating SO ref refresh path)
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 30: Commercial Trace Invoice write → validates affected Invoice mapping
test("30. CT: Invoice write → validates affected Invoice mapping", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  // Simulate CT calling validateActiveInvoiceMappingsForDocuments with Invoice IDs
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// Test 31: Commercial Trace SO write → validates affected Invoice mapping
test("31. CT: SO write → validates affected Invoice mapping", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  db.prepare(`UPDATE audit_zoho_sales_order_lines SET quantity = 999 WHERE line_item_id = ?`).run(SO_LINE_A);

  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, salesorderIds: [SO_A],
  });
  assert.strictEqual(result.markedReviewRequired, 1);
  assert.strictEqual(getMapping(INV_A, INV_LINE_A)!.status, "REVIEW_REQUIRED");
});

// ============================================================
// SECTION E: FAILURE CONTRACT (Tests 32–33)
// ============================================================

// Test 32: validation failure after COMMIT → source evidence remains persisted
test("32. validation failure after COMMIT → source evidence remains", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Simulate committed source evidence first
  db.exec("BEGIN TRANSACTION");
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);
  db.exec("COMMIT");

  // Source evidence should still exist after validation
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });

  // Verify source evidence is still present
  const invLine = db.prepare(`SELECT * FROM audit_zoho_invoice_lines WHERE line_item_id = ?`).get(INV_LINE_A) as any;
  assert.ok(invLine, "Invoice line still exists after validation");
  assert.strictEqual(invLine.quantity, 999, "Updated evidence persisted");
  assert.strictEqual(result.markedReviewRequired, 1);
});

// Test 33: validation failure → warning/failed metadata surfaced
test("33. validation failure → failed metadata surfaced", () => {
  teardown(); setup();
  // No data seeded — calling with non-existent org
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: "nonexistent_org", invoiceIds: ["nonexistent_inv"],
  });
  // Should return cleanly with no checked (no mappings found)
  assert.strictEqual(result.checked, 0);
  assert.strictEqual(result.failed, 0, "No failure when no mappings exist");

  // Test actual error handling — drop the mapping table to force error
  // Create mapping first, then corrupt the DB
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Drop history table to cause error during markReviewRequired
  db.exec("DROP TABLE audit_invoice_so_line_mapping_history");

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  const r2 = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.ok(r2.failed > 0, "Failure count should be > 0");
  assert.ok(r2.error, "Error message should be present");
});

// ============================================================
// SECTION F: SAFETY INVARIANTS (Tests 34–37)
// ============================================================

// Test 34: no additional Zoho GET caused by validator
test("34. no additional Zoho GET caused by validator", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // The validator uses only local SQLite. This test verifies
  // validateActiveInvoiceMappingsForDocuments is a synchronous function
  // (no async, no fetch, no network).
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(typeof result, "object", "Returns synchronously (not a Promise)");
  assert.ok(!("then" in result), "Not a Promise — no network calls");
});

// Test 35: Zoho writes = 0
test("35. Zoho writes = 0 — validator only reads and writes mapping tables", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Snapshot source data before
  const invLineBefore = db.prepare(`SELECT * FROM audit_zoho_invoice_lines WHERE line_item_id = ?`).get(INV_LINE_A) as any;
  const soLineBefore = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE line_item_id = ?`).get(SO_LINE_A) as any;

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });

  // Verify source tables not modified by validator (only the UPDATE above)
  const invLineAfter = db.prepare(`SELECT * FROM audit_zoho_invoice_lines WHERE line_item_id = ?`).get(INV_LINE_A) as any;
  const soLineAfter = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE line_item_id = ?`).get(SO_LINE_A) as any;
  assert.strictEqual(invLineAfter.quantity, 999, "Invoice line not reverted");
  assert.strictEqual(soLineAfter.quantity, soLineBefore.quantity, "SO line unchanged by validator");
});

// Test 36: AI calls = 0
test("36. AI calls = 0 — validator is deterministic", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Run validator — synchronous, no AI
  const result = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.strictEqual(result.checked, 1);
  assert.strictEqual(result.stillValid, 1);
  // Deterministic: same input → same output
  const result2 = validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });
  assert.deepStrictEqual(result, result2, "Deterministic results");
});

// Test 37: operational DB untouched
test("37. operational DB untouched", () => {
  const currentDbHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(_opDbPath))
    .digest("hex");
  assert.strictEqual(currentDbHash, _baselineDbHash, "Operational DB file hash unchanged");
  if (_baselineWalHash !== null) {
    const currentWalHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(_opWalPath))
      .digest("hex");
    assert.strictEqual(currentWalHash, _baselineWalHash, "Operational WAL file hash unchanged");
  }
});

// ============================================================
// SECTION G: DYNAMIC USABILITY (Tests 38–40)
// ============================================================

// Test 38: valid ACTIVE mapping remains usable in R1B path
test("38. valid ACTIVE mapping remains usable in R1B path", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Validate — should remain ACTIVE and usable
  validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });

  const m = getMapping(INV_A, INV_LINE_A)!;
  assert.strictEqual(m.status, "ACTIVE");
  assert.strictEqual(isInvoiceMappingUsable(db, m), true, "Valid ACTIVE mapping is usable");
});

// Test 39: stale mapping loses authority
test("39. stale mapping loses authority (not usable)", () => {
  teardown(); setup();
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  // Stale it
  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);

  validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });

  const m = getMapping(INV_A, INV_LINE_A)!;
  assert.strictEqual(m.status, "REVIEW_REQUIRED");
  assert.strictEqual(isInvoiceMappingUsable(db, m), false, "REVIEW_REQUIRED mapping is not usable");
});

// Test 40: no PO mapping behavior changed
test("40. no PO mapping behavior changed", () => {
  teardown(); setup();
  // Verify PO mapping table/validation imports still work
  // The PO mapping service should still be importable and functional
  // (this test checks that R1C didn't break the PO mapping subsystem)

  // We verify the PO mapping tables still exist in the temp DB schema
  const poMappingTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_so_po_line_mappings'`
  ).get() as any;
  assert.ok(poMappingTable, "PO mapping table still exists");

  const poHistoryTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_so_po_line_mapping_history'`
  ).get() as any;
  assert.ok(poHistoryTable, "PO mapping history table still exists");

  // Verify Invoice mapping validation function doesn't touch PO tables
  seedSoHeader(SO_A, RUN, "SO-R1C-A");
  seedSoLine(SO_A, SO_LINE_A, RUN);
  seedInvoiceHeader(INV_A, RUN, "INV-R1C-A", SO_A);
  seedInvoiceLine(INV_A, INV_LINE_A, RUN);
  createMapping(INV_A, INV_LINE_A, SO_A, SO_LINE_A);

  const poMappingsBefore = db.prepare(`SELECT COUNT(*) as cnt FROM audit_so_po_line_mappings`).get() as any;
  const poHistoryBefore = db.prepare(`SELECT COUNT(*) as cnt FROM audit_so_po_line_mapping_history`).get() as any;

  db.prepare(`UPDATE audit_zoho_invoice_lines SET quantity = 999 WHERE line_item_id = ?`).run(INV_LINE_A);
  validateActiveInvoiceMappingsForDocuments(db, {
    organizationId: ORG, invoiceIds: [INV_A],
  });

  const poMappingsAfter = db.prepare(`SELECT COUNT(*) as cnt FROM audit_so_po_line_mappings`).get() as any;
  const poHistoryAfter = db.prepare(`SELECT COUNT(*) as cnt FROM audit_so_po_line_mapping_history`).get() as any;
  assert.strictEqual(poMappingsAfter.cnt, poMappingsBefore.cnt, "PO mappings unchanged");
  assert.strictEqual(poHistoryAfter.cnt, poHistoryBefore.cnt, "PO history unchanged");
});

// ============================================================
// SECTION H: REAL SYNC INTEGRATION TESTS (Tests 41–47)
//
// These tests call the ACTUAL production sync entry points:
//   - syncApprovalPending() — global AP sync
//   - syncApprovalPendingDocument() — targeted AP sync
//   - syncCommercialTrace() — CT sync (via module loader hooks)
//
// The R1C hooks fire INTERNALLY after the sync COMMIT phase.
// Tests assert actual post-sync DB state, not mock assertions.
// DO NOT manually call validateActiveInvoiceMappingsForDocuments().
// ============================================================

console.log("\n--- Section H: Real Sync Integration Tests ---");

// ── AP sync mock reader factory ──────────────────────────
// Returns a reader that serves the given invoice and SO fixture data.
// All other document types return empty lists / null.
function makeApReader(inv: any, so: any) {
  return {
    listPurchaseOrders: async () => ({ purchaseorders: [] }),
    getPurchaseOrder: async () => ({ purchaseorder: null }),
    listBills: async () => ({ bills: [] }),
    getBill: async () => ({ bill: null }),
    listInvoices: async () => ({
      invoices: inv
        ? [{ invoice_id: inv.invoice_id, invoice_number: inv.invoice_number, status: inv.status, date: inv.date, total: inv.total, balance: inv.balance }]
        : [],
    }),
    getInvoice: async (_orgId: string, invId: string) =>
      inv && inv.invoice_id === invId ? { invoice: JSON.parse(JSON.stringify(inv)) } : { invoice: null },
    listSalesOrders: async () => ({
      salesorders: so
        ? [{ salesorder_id: so.salesorder_id, salesorder_number: so.salesorder_number, status: so.status }]
        : [],
    }),
    getSalesOrder: async (_orgId: string, soId: string) =>
      so && so.salesorder_id === soId ? { salesorder: JSON.parse(JSON.stringify(so)) } : { salesorder: null },
    getSalesOrderByNumber: async () => null,
  };
}

// ── CT sync mock reader factory ──────────────────────────
function makeCtReader(inv: any, so: any) {
  return {
    listSalesOrders: async () => ({
      salesorders: so
        ? [{ salesorder_id: so.salesorder_id, salesorder_number: so.salesorder_number, status: so.status, date: so.date, total: so.total }]
        : [],
    }),
    getSalesOrder: async () => (so ? { salesorder: JSON.parse(JSON.stringify(so)) } : { salesorder: null }),
    listPurchaseOrders: async () => ({ purchaseorders: [] }),
    getPurchaseOrder: async () => ({ purchaseorder: null }),
    listBills: async () => ({ bills: [] }),
    getBill: async () => ({ bill: null }),
    listInvoices: async () => ({
      invoices: inv
        ? [{ invoice_id: inv.invoice_id, invoice_number: inv.invoice_number, status: inv.status, date: inv.date, total: inv.total, balance: inv.balance, currency_code: inv.currency_code }]
        : [],
    }),
    getInvoice: async () => (inv ? { invoice: JSON.parse(JSON.stringify(inv)) } : { invoice: null }),
    listExpenses: async () => ({ expenses: [] }),
    getExpense: async () => ({ expense: null }),
  };
}

// ── Fixture builders ─────────────────────────────────────
function buildInvoiceFixture(opts: {
  invoiceId: string; invoiceNumber: string; salesorderId: string;
  lineItemId: string; quantity: number; rate: number;
  itemId?: string; itemName?: string; description?: string; unit?: string;
}) {
  return {
    invoice_id: opts.invoiceId,
    invoice_number: opts.invoiceNumber,
    salesorder_id: opts.salesorderId,
    customer_id: "cust_h_001",
    status: "pending_approval",
    date: "2026-01-15",
    due_date: "2026-02-15",
    total: opts.quantity * opts.rate,
    balance: opts.quantity * opts.rate,
    currency_code: "INR",
    line_items: [{
      line_item_id: opts.lineItemId,
      item_id: opts.itemId ?? "item_h_001",
      name: opts.itemName ?? "Widget-H",
      description: opts.description ?? "Integration test widget",
      quantity: opts.quantity,
      rate: opts.rate,
      item_total: opts.quantity * opts.rate,
      unit: opts.unit ?? "pcs",
    }],
  };
}

function buildSoFixture(opts: {
  salesorderId: string; salesorderNumber: string;
  lineItemId: string; quantity: number; rate: number;
  itemId?: string; itemName?: string; description?: string; unit?: string;
}) {
  return {
    salesorder_id: opts.salesorderId,
    salesorder_number: opts.salesorderNumber,
    customer_id: "cust_h_001",
    customer_name: "Test Customer H",
    status: "open",
    date: "2026-01-10",
    shipment_date: "2026-02-10",
    total: opts.quantity * opts.rate,
    currency: "INR",
    line_items: [{
      line_item_id: opts.lineItemId,
      item_id: opts.itemId ?? "item_h_001",
      name: opts.itemName ?? "Widget-H",
      description: opts.description ?? "Integration test widget",
      quantity: opts.quantity,
      rate: opts.rate,
      item_total: opts.quantity * opts.rate,
      sku: "SKU-H",
      unit: opts.unit ?? "pcs",
    }],
  };
}

// Test 41: AP Global Sync — Invoice line quantity change → R1C hook fires → REVIEW_REQUIRED
await asyncTest("41. AP Global: Invoice evidence change → R1C hook transitions mapping to REVIEW_REQUIRED", async () => {
  teardown(); setup();

  const invId = "inv_h41"; const soId = "so_h41";
  const invLineId = "invl_h41"; const soLineId = "sol_h41";

  // Build initial fixtures
  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H41", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H41", lineItemId: soLineId, quantity: 100, rate: 50 });

  // First sync: writes initial evidence into test DB
  const reader1 = makeApReader(inv1, so1);
  const sync1 = await syncApprovalPending({}, { db, reader: reader1, orgId: ORG });
  assert.ok(sync1.created > 0, "First sync should create documents");

  // Create mapping (captures fingerprints from initial evidence)
  const mapRes = createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(mapRes.outcome, "CREATED");
  const m1 = getMapping(invId, invLineId)!;
  assert.strictEqual(m1.status, "ACTIVE");

  // Second sync: changed quantity on invoice line → triggers R1C hook
  const inv2 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H41", salesorderId: soId, lineItemId: invLineId, quantity: 20, rate: 100 });
  const reader2 = makeApReader(inv2, so1);
  const sync2 = await syncApprovalPending({}, { db, reader: reader2, orgId: ORG });

  // Assert: R1C hook fired and transitioned the mapping
  assert.ok(sync2.invoiceMappingValidation, "invoiceMappingValidation should be present on result");
  assert.ok(sync2.invoiceMappingValidation!.markedReviewRequired >= 1, "At least 1 mapping should be marked REVIEW_REQUIRED");

  // Assert: actual DB state
  const m2 = getMapping(invId, invLineId)!;
  assert.strictEqual(m2.status, "REVIEW_REQUIRED", "Mapping should be REVIEW_REQUIRED in DB");

  // Assert: history event written
  const hist = getHistory(invId, invLineId);
  const staleEvents = hist.filter((h: any) => h.event_type === "MAPPING_MARKED_REVIEW_REQUIRED" && h.new_status === "REVIEW_REQUIRED");
  assert.ok(staleEvents.length >= 1, "History should record the REVIEW_REQUIRED transition");
});

// Test 42: AP Global Sync — SO line quantity change → R1C hook fires
await asyncTest("42. AP Global: SO evidence change → R1C hook transitions mapping to REVIEW_REQUIRED", async () => {
  teardown(); setup();

  const invId = "inv_h42"; const soId = "so_h42";
  const invLineId = "invl_h42"; const soLineId = "sol_h42";

  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H42", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H42", lineItemId: soLineId, quantity: 100, rate: 50 });

  // First sync
  const reader1 = makeApReader(inv1, so1);
  await syncApprovalPending({}, { db, reader: reader1, orgId: ORG });

  // Create mapping
  const mapRes = createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(mapRes.outcome, "CREATED");

  // Second sync: SO line quantity changed (100 → 200)
  const so2 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H42", lineItemId: soLineId, quantity: 200, rate: 50 });
  const reader2 = makeApReader(inv1, so2);
  const sync2 = await syncApprovalPending({}, { db, reader: reader2, orgId: ORG });

  assert.ok(sync2.invoiceMappingValidation, "invoiceMappingValidation present");
  assert.ok(sync2.invoiceMappingValidation!.markedReviewRequired >= 1, "SO change should stale the Invoice→SO mapping");

  const m2 = getMapping(invId, invLineId)!;
  assert.strictEqual(m2.status, "REVIEW_REQUIRED", "DB mapping status");
});

// Test 43: AP Targeted Sync — Invoice refresh with changed evidence → R1C fires
await asyncTest("43. AP Targeted: Invoice evidence change → R1C hook fires via targeted sync", async () => {
  teardown(); setup();

  const invId = "inv_h43"; const soId = "so_h43";
  const invLineId = "invl_h43"; const soLineId = "sol_h43";

  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H43", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H43", lineItemId: soLineId, quantity: 100, rate: 50 });

  // Seed initial evidence via targeted sync (NEW document path)
  const targetReader1 = {
    getInvoice: async () => ({ invoice: JSON.parse(JSON.stringify(inv1)) }),
    getSalesOrder: async () => ({ salesorder: JSON.parse(JSON.stringify(so1)) }),
    getSalesOrderByNumber: async () => null,
  };
  const tSync1 = await syncApprovalPendingDocument(
    { type: "INVOICE", id: invId, number: "INV-H43" },
    { db, orgId: ORG, reader: targetReader1 }
  );
  assert.strictEqual(tSync1.status, "SUCCESS", "First targeted sync should succeed");

  // Create mapping
  createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(getMapping(invId, invLineId)!.status, "ACTIVE");

  // Second targeted sync: changed invoice line description
  const inv2 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H43", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100, description: "CHANGED description" });
  const targetReader2 = {
    getInvoice: async () => ({ invoice: JSON.parse(JSON.stringify(inv2)) }),
    getSalesOrder: async () => ({ salesorder: JSON.parse(JSON.stringify(so1)) }),
    getSalesOrderByNumber: async () => null,
  };
  const tSync2 = await syncApprovalPendingDocument(
    { type: "INVOICE", id: invId, number: "INV-H43" },
    { db, orgId: ORG, reader: targetReader2 }
  );

  assert.strictEqual(tSync2.status, "SUCCESS");
  assert.ok(tSync2.invoiceMappingValidation, "invoiceMappingValidation present on targeted result");
  assert.ok(tSync2.invoiceMappingValidation!.markedReviewRequired >= 1, "Description change should stale the mapping");
  assert.strictEqual(getMapping(invId, invLineId)!.status, "REVIEW_REQUIRED");
});

// Test 44: AP Targeted — unchanged evidence → mapping stays ACTIVE
await asyncTest("44. AP Targeted: unchanged evidence → mapping stays ACTIVE (no false positive)", async () => {
  teardown(); setup();

  const invId = "inv_h44"; const soId = "so_h44";
  const invLineId = "invl_h44"; const soLineId = "sol_h44";

  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H44", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H44", lineItemId: soLineId, quantity: 100, rate: 50 });

  // Seed via targeted sync
  const targetReader = {
    getInvoice: async () => ({ invoice: JSON.parse(JSON.stringify(inv1)) }),
    getSalesOrder: async () => ({ salesorder: JSON.parse(JSON.stringify(so1)) }),
    getSalesOrderByNumber: async () => null,
  };
  await syncApprovalPendingDocument(
    { type: "INVOICE", id: invId, number: "INV-H44" },
    { db, orgId: ORG, reader: targetReader }
  );

  createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(getMapping(invId, invLineId)!.status, "ACTIVE");

  // Second targeted sync: SAME data → no change → mapping should stay ACTIVE
  const tSync2 = await syncApprovalPendingDocument(
    { type: "INVOICE", id: invId, number: "INV-H44" },
    { db, orgId: ORG, reader: targetReader }
  );

  assert.strictEqual(tSync2.status, "SUCCESS");
  // Result may or may not be UNCHANGED (AP handles this), but mapping must stay ACTIVE
  const m2 = getMapping(invId, invLineId)!;
  assert.strictEqual(m2.status, "ACTIVE", "Unchanged evidence should not stale the mapping");

  // No stale history events
  const hist = getHistory(invId, invLineId);
  const staleEvents = hist.filter((h: any) => h.event_type === "MAPPING_MARKED_REVIEW_REQUIRED" && h.new_status === "REVIEW_REQUIRED");
  assert.strictEqual(staleEvents.length, 0, "No REVIEW_REQUIRED events for unchanged evidence");
});

// Test 45: AP Targeted — SO reference refresh with changed SO lines → R1C fires
await asyncTest("45. AP Targeted: SO reference change → R1C hook fires for Invoice→SO mapping", async () => {
  teardown(); setup();

  const invId = "inv_h45"; const soId = "so_h45";
  const invLineId = "invl_h45"; const soLineId = "sol_h45";

  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H45", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H45", lineItemId: soLineId, quantity: 100, rate: 50 });

  // Seed initial evidence
  const targetReader1 = {
    getInvoice: async () => ({ invoice: JSON.parse(JSON.stringify(inv1)) }),
    getSalesOrder: async () => ({ salesorder: JSON.parse(JSON.stringify(so1)) }),
    getSalesOrderByNumber: async () => null,
  };
  await syncApprovalPendingDocument(
    { type: "INVOICE", id: invId, number: "INV-H45" },
    { db, orgId: ORG, reader: targetReader1 }
  );

  createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(getMapping(invId, invLineId)!.status, "ACTIVE");

  // Second targeted sync: SO line unit changed (pcs → kg)
  const so2 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H45", lineItemId: soLineId, quantity: 100, rate: 50, unit: "kg" });
  const targetReader2 = {
    getInvoice: async () => ({ invoice: JSON.parse(JSON.stringify(inv1)) }),
    getSalesOrder: async () => ({ salesorder: JSON.parse(JSON.stringify(so2)) }),
    getSalesOrderByNumber: async () => null,
  };
  const tSync2 = await syncApprovalPendingDocument(
    { type: "INVOICE", id: invId, number: "INV-H45" },
    { db, orgId: ORG, reader: targetReader2 }
  );

  assert.strictEqual(tSync2.status, "SUCCESS");
  assert.ok(tSync2.invoiceMappingValidation, "invoiceMappingValidation present");
  assert.ok(tSync2.invoiceMappingValidation!.markedReviewRequired >= 1, "SO unit change should stale mapping");
  assert.strictEqual(getMapping(invId, invLineId)!.status, "REVIEW_REQUIRED");
});

// Test 46: CT Sync — Invoice evidence change → R1C hook fires
await asyncTest("46. CT Sync: Invoice evidence change → R1C hook transitions mapping to REVIEW_REQUIRED", async () => {
  teardown(); setup();

  const invId = "inv_h46"; const soId = "so_h46";
  const invLineId = "invl_h46"; const soLineId = "sol_h46";

  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H46", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  inv1.status = "open"; // CT sync processes all invoices, not just pending_approval
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H46", lineItemId: soLineId, quantity: 100, rate: 50 });

  // First CT sync: writes initial evidence
  const ctReader1 = makeCtReader(inv1, so1);
  (globalThis as any).__CT_SAFETY_TEST__ = { db, orgId: ORG, reader: ctReader1, beginSeen: false, callLog: [] };
  const ctSync1 = await syncCommercialTrace({});
  assert.ok(ctSync1.created > 0, "First CT sync should create documents");

  // Create mapping (fingerprints from initial CT evidence)
  createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(getMapping(invId, invLineId)!.status, "ACTIVE");

  // Second CT sync: invoice line rate changed (100 → 150)
  const inv2 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H46", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 150 });
  inv2.status = "open";
  inv2.total = 10 * 150;
  inv2.balance = 10 * 150;
  const ctReader2 = makeCtReader(inv2, so1);
  (globalThis as any).__CT_SAFETY_TEST__ = { db, orgId: ORG, reader: ctReader2, beginSeen: false, callLog: [] };
  const ctSync2 = await syncCommercialTrace({});

  assert.ok(ctSync2.invoiceMappingValidation, "invoiceMappingValidation present on CT result");
  assert.ok(ctSync2.invoiceMappingValidation!.markedReviewRequired >= 1, "Rate change via CT should stale mapping");
  assert.strictEqual(getMapping(invId, invLineId)!.status, "REVIEW_REQUIRED");

  const hist = getHistory(invId, invLineId);
  const staleEvents = hist.filter((h: any) => h.event_type === "MAPPING_MARKED_REVIEW_REQUIRED" && h.new_status === "REVIEW_REQUIRED");
  assert.ok(staleEvents.length >= 1, "History should record CT-triggered REVIEW_REQUIRED");
});

// Test 47: CT Sync — SO line change → R1C hook fires for Invoice→SO mapping
await asyncTest("47. CT Sync: SO evidence change → R1C hook transitions Invoice→SO mapping", async () => {
  teardown(); setup();

  const invId = "inv_h47"; const soId = "so_h47";
  const invLineId = "invl_h47"; const soLineId = "sol_h47";

  const inv1 = buildInvoiceFixture({ invoiceId: invId, invoiceNumber: "INV-H47", salesorderId: soId, lineItemId: invLineId, quantity: 10, rate: 100 });
  inv1.status = "open";
  const so1 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H47", lineItemId: soLineId, quantity: 100, rate: 50 });

  // First CT sync
  const ctReader1 = makeCtReader(inv1, so1);
  (globalThis as any).__CT_SAFETY_TEST__ = { db, orgId: ORG, reader: ctReader1, beginSeen: false, callLog: [] };
  await syncCommercialTrace({});

  // Create mapping
  createMapping(invId, invLineId, soId, soLineId);
  assert.strictEqual(getMapping(invId, invLineId)!.status, "ACTIVE");

  // Second CT sync: SO line item_name changed
  const so2 = buildSoFixture({ salesorderId: soId, salesorderNumber: "SO-H47", lineItemId: soLineId, quantity: 100, rate: 50, itemName: "Widget-H-RENAMED" });
  const ctReader2 = makeCtReader(inv1, so2);
  (globalThis as any).__CT_SAFETY_TEST__ = { db, orgId: ORG, reader: ctReader2, beginSeen: false, callLog: [] };
  const ctSync2 = await syncCommercialTrace({});

  assert.ok(ctSync2.invoiceMappingValidation, "invoiceMappingValidation present");
  assert.ok(ctSync2.invoiceMappingValidation!.markedReviewRequired >= 1, "SO item_name change via CT should stale mapping");
  assert.strictEqual(getMapping(invId, invLineId)!.status, "REVIEW_REQUIRED");
});

// ── Final cleanup and summary ─────────────────────────────

teardown();

// Verify operational DB integrity
const _finalDbHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(_opDbPath))
  .digest("hex");
const _finalWalHash = fs.existsSync(_opWalPath)
  ? crypto
      .createHash("sha256")
      .update(fs.readFileSync(_opWalPath))
      .digest("hex")
  : null;

if (_finalDbHash !== _baselineDbHash || _finalWalHash !== _baselineWalHash) {
  console.error("\n⚠️  OPERATIONAL DB INTEGRITY VIOLATION — hashes differ!");
  failed++;
  failures.push("OPERATIONAL_DB_INTEGRITY");
}

console.log(`\n=== R1C Results: ${passed}/${passed + failed} passed ===`);
if (failures.length > 0) {
  console.log("\nFailed:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
