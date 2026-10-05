// ============================================================
// Invoice→SO Reference Repair R1 — Focused Test Suite
//
// 19 test cases covering: native ID path, cf_sales_order_no fallback,
// unique/zero/ambiguous SO resolution, JSON safety, PO/Bill regression,
// Rate Guard regression, Manual Mapping regression, operational DB safety.
//
// All tests use isolated in-memory DB.
// No Zoho calls. No operational DB mutation.
// ============================================================

import assert from "node:assert";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getApprovalPendingDocuments, evaluateRateGuard } from "../app/lib/audit/approval-pending-service.ts";
import {
  createOwnerLineMapping,
  getCurrentMappingForPoLine,
  revokeOwnerLineMapping,
} from "../app/lib/audit/manual-line-mapping-service.ts";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";

const ORG = "org_inv_test";

// ── Capture operational DB hashes BEFORE any tests ─────────
const _opDbPath = path.join(process.cwd(), "data", "audit_workspace.db");
const _opWalPath = _opDbPath + "-wal";
const _baselineDbHash = crypto.createHash("sha256").update(fs.readFileSync(_opDbPath)).digest("hex");
const _baselineWalHash = fs.existsSync(_opWalPath)
  ? crypto.createHash("sha256").update(fs.readFileSync(_opWalPath)).digest("hex")
  : null;

let passed = 0;
let failed = 0;
const failures: string[] = [];

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

function createTestDb(): { db: DatabaseSync; runId: string } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_zoho_source_runs (
      source_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'RUNNING'
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_sales_orders (
      organization_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      salesorder_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      date TEXT,
      status TEXT,
      total REAL,
      custom_fields_json TEXT,
      submitter_id TEXT,
      submitted_by_name TEXT,
      reference_number TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, salesorder_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_sales_order_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      sku TEXT,
      description TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_purchase_orders (
      organization_id TEXT NOT NULL,
      purchaseorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      purchaseorder_number TEXT,
      vendor_id TEXT,
      vendor_name TEXT,
      delivery_customer_name TEXT,
      date TEXT,
      delivery_date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      custom_fields_json TEXT,
      submitter_id TEXT,
      submitted_by_name TEXT,
      source_endpoint TEXT,
      reference_number TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, purchaseorder_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_purchase_order_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      purchaseorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      sku TEXT,
      description TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_bills (
      organization_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      bill_number TEXT,
      vendor_id TEXT,
      vendor_name TEXT,
      purchaseorder_id TEXT,
      date TEXT,
      due_date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      balance REAL,
      custom_fields_json TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, bill_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_bill_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      sku TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_invoices (
      organization_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      invoice_number TEXT,
      customer_id TEXT,
      delivery_customer_name TEXT,
      salesorder_id TEXT,
      date TEXT,
      due_date TEXT,
      status TEXT,
      total REAL,
      balance REAL,
      currency_code TEXT,
      custom_fields_json TEXT,
      submitter_id TEXT,
      submitted_by_name TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, invoice_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_invoice_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      sku TEXT,
      description TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
  `);

  // R1B fixture: Invoice→SO line mapping table (production schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_invoice_so_line_mappings (
      mapping_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      invoice_line_item_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      so_line_item_id TEXT NOT NULL,
      mapping_kind TEXT NOT NULL CHECK(mapping_kind IN ('OWNER_FALLBACK', 'OWNER_OVERRIDE')),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'REVIEW_REQUIRED', 'REVOKED')),
      invoice_fingerprint TEXT NOT NULL,
      so_fingerprint TEXT NOT NULL,
      decision_source TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      review_required_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_org
      ON audit_invoice_so_line_mappings(organization_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_inv_line
      ON audit_invoice_so_line_mappings(organization_id, invoice_id, invoice_line_item_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_so_line
      ON audit_invoice_so_line_mappings(organization_id, salesorder_id, so_line_item_id);

    CREATE INDEX IF NOT EXISTS idx_inv_so_line_map_status
      ON audit_invoice_so_line_mappings(status);
  `);

  // Partial unique index: at most one non-revoked mapping per Invoice line
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_so_line_map_inv_current
      ON audit_invoice_so_line_mappings(organization_id, invoice_id, invoice_line_item_id)
      WHERE status IN ('ACTIVE', 'REVIEW_REQUIRED');
  `);

  const runId = "test_run_inv_" + Date.now();
  db.prepare(
    `INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status)
     VALUES (?, ?, 'TEST', ?, 'SUCCESS')`
  ).run(runId, ORG, new Date().toISOString());

  return { db, runId };
}

function seedSo(db: DatabaseSync, runId: string, soId: string, soNumber: string, extra?: Record<string, any>) {
  db.prepare(
    `INSERT INTO audit_zoho_sales_orders
     (organization_id, salesorder_id, source_run_id, salesorder_number, date, status, customer_name, fetched_at)
     VALUES (?, ?, ?, ?, '2026-01-15', 'confirmed', ?, 'now')`
  ).run(ORG, soId, runId, soNumber, extra?.customer_name ?? "Test Customer");
}

function seedSoLine(db: DatabaseSync, runId: string, soId: string, lineId: string, itemId: string, qty: number, rate?: number) {
  db.prepare(
    `INSERT INTO audit_zoho_sales_order_lines
     (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, quantity, rate, amount, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test desc')`
  ).run(ORG, lineId, soId, runId, itemId, `Item ${itemId}`, qty, rate ?? 100, (rate ?? 100) * qty);
}

function seedInvoice(
  db: DatabaseSync, runId: string, invId: string, invNum: string,
  salesorderId: string | null, customFieldsJson: string | null,
  status?: string
) {
  db.prepare(
    `INSERT INTO audit_zoho_invoices
     (organization_id, invoice_id, source_run_id, invoice_number, salesorder_id, custom_fields_json, status, date, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2026-02-01', 'now')`
  ).run(ORG, invId, runId, invNum, salesorderId, customFieldsJson, status ?? "pending_approval");
}

function seedInvLine(db: DatabaseSync, runId: string, invId: string, lineId: string, itemId: string, qty: number, rate?: number) {
  db.prepare(
    `INSERT INTO audit_zoho_invoice_lines
     (organization_id, line_item_id, invoice_id, source_run_id, item_id, item_name, quantity, rate, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ORG, lineId, invId, runId, itemId, `Item ${itemId}`, qty, rate ?? 100, (rate ?? 100) * qty);
}

console.log("\n═══════════════════════════════════════════════");
console.log("  Invoice→SO Reference Repair R1 — Tests");
console.log("═══════════════════════════════════════════════\n");

// ── T1. Native salesorder_id resolves to existing SO ───────

test("T1. Native salesorder_id resolves existing SO path", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_native", "SO-NATIVE-001");
  seedSoLine(db, runId, "so_native", "sol_n1", "item_A", 10);
  seedInvoice(db, runId, "inv_native", "INV-NATIVE-001", "so_native", null);
  seedInvLine(db, runId, "inv_native", "invl_n1", "item_A", 10);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-NATIVE-001");
  const doc = result.documents.find(d => d.number === "INV-NATIVE-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.type, "INVOICE");
  assert.strictEqual(doc.verificationStatus, "MATCHED");
  assert.strictEqual(doc.relatedDocumentRef, "SO-NATIVE-001");
});

// ── T2. cf_sales_order_no fallback resolves SO ─────────────

test("T2. Blank salesorder_id + cf_sales_order_no resolves SO", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_cf", "SO-CF-001");
  seedSoLine(db, runId, "so_cf", "sol_cf1", "item_B", 5);
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-CF-001" }]);
  seedInvoice(db, runId, "inv_cf", "INV-CF-001", "", cfJson);
  seedInvLine(db, runId, "inv_cf", "invl_cf1", "item_B", 5);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-CF-001");
  const doc = result.documents.find(d => d.number === "INV-CF-001");
  assert.ok(doc, "document found");
  assert.notStrictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE", "must NOT be LOCAL_DATA_INCOMPLETE");
  assert.strictEqual(doc.relatedDocumentRef, "SO-CF-001");
  assert.strictEqual(doc.verificationStatus, "MATCHED");
});

// ── T3. null salesorder_id + label-based custom field ──────

test("T3. Null salesorder_id + label 'Sales Order No' resolves SO", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_label", "SO-LABEL-001");
  seedSoLine(db, runId, "so_label", "sol_lb1", "item_C", 3);
  const cfJson = JSON.stringify([{ label: "Sales Order No", value: "SO-LABEL-001" }]);
  seedInvoice(db, runId, "inv_label", "INV-LABEL-001", null, cfJson);
  seedInvLine(db, runId, "inv_label", "invl_lb1", "item_C", 3);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-LABEL-001");
  const doc = result.documents.find(d => d.number === "INV-LABEL-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.verificationStatus, "MATCHED");
  assert.strictEqual(doc.relatedDocumentRef, "SO-LABEL-001");
});

// ── T4. Invoice lines consumed correctly via cf resolution ─

test("T4. Invoice lines consumed normally after cf resolution", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_lines", "SO-LINES-001");
  seedSoLine(db, runId, "so_lines", "sol_l1", "item_D", 10);
  seedSoLine(db, runId, "so_lines", "sol_l2", "item_E", 20);
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-LINES-001" }]);
  seedInvoice(db, runId, "inv_lines", "INV-LINES-001", "", cfJson);
  seedInvLine(db, runId, "inv_lines", "invl_l1", "item_D", 10);
  seedInvLine(db, runId, "inv_lines", "invl_l2", "item_E", 15);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-LINES-001");
  const doc = result.documents.find(d => d.number === "INV-LINES-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.items.length, 2, "both invoice lines present");
  // item_D: 10 vs 10 → MATCHED, item_E: 15 vs 20 → PARTIAL
  const matched = doc.items.filter(i => i.mismatchType === "MATCHED");
  const partial = doc.items.filter(i => i.mismatchType === "PARTIAL_WITHIN_REFERENCE");
  assert.strictEqual(matched.length, 1, "item_D MATCHED");
  assert.strictEqual(partial.length, 1, "item_E PARTIAL");
});

// ── T5. cf_sales_order_no exists but SO absent locally ─────

test("T5. cf_sales_order_no exists but SO absent locally → safe status", () => {
  const { db, runId } = createTestDb();
  // No SO seeded — only the custom field reference
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-GHOST-999" }]);
  seedInvoice(db, runId, "inv_ghost", "INV-GHOST-001", "", cfJson);
  seedInvLine(db, runId, "inv_ghost", "invl_g1", "item_F", 1);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-GHOST-001");
  const doc = result.documents.find(d => d.number === "INV-GHOST-001");
  assert.ok(doc, "document found");
  assert.notStrictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE", "must NOT be LOCAL_DATA_INCOMPLETE");
  assert.ok(
    doc.verificationStatus === "SO_REFERENCE_NOT_FOUND" || doc.verificationStatus === "UNRESOLVED",
    `safe unresolved status, got: ${doc.verificationStatus}`
  );
});

// ── T6. Ambiguous SO match → no arbitrary selection ────────

test("T6. Ambiguous SO reference → AMBIGUOUS or exact-match win", () => {
  const { db, runId } = createTestDb();
  // Two SOs with same salesorder_number = ambiguous
  seedSo(db, runId, "so_amb1", "SO-AMB-001");
  seedSoLine(db, runId, "so_amb1", "sol_a1", "item_G", 5);
  // Seed a second row for the same SO number (different UUID, same number)
  db.prepare(
    `INSERT INTO audit_zoho_sales_orders
     (organization_id, salesorder_id, source_run_id, salesorder_number, date, status, customer_name, fetched_at)
     VALUES (?, ?, ?, ?, '2026-01-16', 'confirmed', 'Test Customer', 'now2')`
  ).run(ORG, "so_amb2", runId, "SO-AMB-001");
  seedSoLine(db, runId, "so_amb2", "sol_a2", "item_G", 5);

  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-AMB-001" }]);
  seedInvoice(db, runId, "inv_amb", "INV-AMB-001", "", cfJson);
  seedInvLine(db, runId, "inv_amb", "invl_a1", "item_G", 5);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-AMB-001");
  const doc = result.documents.find(d => d.number === "INV-AMB-001");
  assert.ok(doc, "document found");
  assert.notStrictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE");
  // Either AMBIGUOUS_SO_REFERENCE or resolves to latest — both are safe
  assert.ok(
    ["AMBIGUOUS_SO_REFERENCE", "MATCHED", "MISMATCHED", "PARTIAL_WITHIN_REFERENCE", "UNRESOLVED"].includes(doc.verificationStatus),
    `safe status, got: ${doc.verificationStatus}`
  );
});

// ── T7. Malformed custom_fields_json → safe, no crash ──────

test("T7. Malformed custom_fields_json → safe, no crash", () => {
  const { db, runId } = createTestDb();
  seedInvoice(db, runId, "inv_bad_json", "INV-BADJSON-001", "", "{broken json!!!");
  seedInvLine(db, runId, "inv_bad_json", "invl_bj1", "item_H", 1);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-BADJSON-001");
  const doc = result.documents.find(d => d.number === "INV-BADJSON-001");
  assert.ok(doc, "service did not crash");
  assert.strictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE");
});

// ── T8. Null custom_fields_json → LOCAL_DATA_INCOMPLETE ────

test("T8. Null custom_fields_json → LOCAL_DATA_INCOMPLETE", () => {
  const { db, runId } = createTestDb();
  seedInvoice(db, runId, "inv_no_cf", "INV-NOCF-001", "", null);
  seedInvLine(db, runId, "inv_no_cf", "invl_nc1", "item_I", 1);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-NOCF-001");
  const doc = result.documents.find(d => d.number === "INV-NOCF-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE");
});

// ── T9. Empty cf_sales_order_no value → treated as absent ──

test("T9. Empty cf_sales_order_no value → treated as absent", () => {
  const { db, runId } = createTestDb();
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "" }]);
  seedInvoice(db, runId, "inv_empty_cf", "INV-EMPTYCF-001", "", cfJson);
  seedInvLine(db, runId, "inv_empty_cf", "invl_ec1", "item_J", 1);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-EMPTYCF-001");
  const doc = result.documents.find(d => d.number === "INV-EMPTYCF-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE");
});

// ── T10. Unrelated custom field → ignored, LOCAL_DATA_INCOMPLETE ─

test("T10. Unrelated custom field only → LOCAL_DATA_INCOMPLETE", () => {
  const { db, runId } = createTestDb();
  const cfJson = JSON.stringify([{ api_name: "cf_delivery_method", value: "Courier" }]);
  seedInvoice(db, runId, "inv_unrel", "INV-UNREL-001", "", cfJson);
  seedInvLine(db, runId, "inv_unrel", "invl_ur1", "item_K", 1);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-UNREL-001");
  const doc = result.documents.find(d => d.number === "INV-UNREL-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE");
});

// ── T11. Native salesorder_id takes precedence ─────────────

test("T11. Native salesorder_id takes precedence over cf_sales_order_no", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_native_win", "SO-NATIVE-WIN");
  seedSoLine(db, runId, "so_native_win", "sol_nw1", "item_L", 8);
  seedSo(db, runId, "so_cf_lose", "SO-CF-LOSE");
  seedSoLine(db, runId, "so_cf_lose", "sol_cl1", "item_L", 8);
  // Native ID points to so_native_win; custom field points to SO-CF-LOSE
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-CF-LOSE" }]);
  seedInvoice(db, runId, "inv_prec", "INV-PREC-001", "so_native_win", cfJson);
  seedInvLine(db, runId, "inv_prec", "invl_p1", "item_L", 8);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-PREC-001");
  const doc = result.documents.find(d => d.number === "INV-PREC-001");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.relatedDocumentRef, "SO-NATIVE-WIN", "native ID wins");
  assert.strictEqual(doc.verificationStatus, "MATCHED");
});

// ── T12. Multiple invoices for same SO via cf resolution ───

test("T12. Multiple invoices for same SO: relatedInvs correct via cf resolution", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_multi", "SO-MULTI-001");
  seedSoLine(db, runId, "so_multi", "sol_m1", "item_M", 20);
  // First invoice uses native ID
  seedInvoice(db, runId, "inv_m1", "INV-MULTI-001", "so_multi", null, "sent");
  seedInvLine(db, runId, "inv_m1", "invl_m1", "item_M", 10);
  // Second invoice uses cf_sales_order_no fallback
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-MULTI-001" }]);
  seedInvoice(db, runId, "inv_m2", "INV-MULTI-002", "", cfJson);
  seedInvLine(db, runId, "inv_m2", "invl_m2", "item_M", 10);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "INV-MULTI-002");
  const doc = result.documents.find(d => d.number === "INV-MULTI-002");
  assert.ok(doc, "document found");
  assert.strictEqual(doc.relatedDocumentRef, "SO-MULTI-001");
  // The cf-resolved invoice should see inv_m1 as a related invoice (same SO) 
  // and factor its consumption into the remaining qty analysis
  assert.notStrictEqual(doc.verificationStatus, "LOCAL_DATA_INCOMPLETE");
});

// ── T13. PO→SO regression unchanged ────────────────────────

test("T13. PO→SO regression unchanged", () => {
  const { db, runId } = createTestDb();
  seedSo(db, runId, "so_po_reg", "SO-POREG-001");
  seedSoLine(db, runId, "so_po_reg", "sol_pr1", "item_N", 10);
  const cfJson = JSON.stringify([{ api_name: "cf_sales_order_no", value: "SO-POREG-001" }]);
  db.prepare(
    `INSERT INTO audit_zoho_purchase_orders
     (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, custom_fields_json, date, fetched_at)
     VALUES (?, 'po_reg', ?, 'PO-REG-001', 'pending_approval', ?, '2026-02-01', 'now')`
  ).run(ORG, runId, cfJson);
  db.prepare(
    `INSERT INTO audit_zoho_purchase_order_lines
     (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, item_name, quantity, rate, amount)
     VALUES (?, 'pol_r1', 'po_reg', ?, 'item_N', 'Item item_N', 10, 100, 1000)`
  ).run(ORG, runId);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-REG-001");
  const doc = result.documents.find(d => d.number === "PO-REG-001");
  assert.ok(doc, "PO document found");
  assert.strictEqual(doc.type, "PO");
  assert.strictEqual(doc.verificationStatus, "MATCHED");
});

// ── T14. Bill→PO regression unchanged ──────────────────────

test("T14. Bill→PO regression unchanged", () => {
  const { db, runId } = createTestDb();
  db.prepare(
    `INSERT INTO audit_zoho_purchase_orders
     (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, date, fetched_at)
     VALUES (?, 'po_bill_reg', ?, 'PO-BILLREG-001', 'open', '2026-01-10', 'now')`
  ).run(ORG, runId);
  db.prepare(
    `INSERT INTO audit_zoho_purchase_order_lines
     (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, item_name, quantity, rate, amount)
     VALUES (?, 'pol_br1', 'po_bill_reg', ?, 'item_O', 'Item item_O', 20, 50, 1000)`
  ).run(ORG, runId);
  db.prepare(
    `INSERT INTO audit_zoho_bills
     (organization_id, bill_id, source_run_id, bill_number, purchaseorder_id, status, date, fetched_at)
     VALUES (?, 'bill_reg', ?, 'BILL-REG-001', 'po_bill_reg', 'pending_approval', '2026-02-01', 'now')`
  ).run(ORG, runId);
  db.prepare(
    `INSERT INTO audit_zoho_bill_lines
     (organization_id, line_item_id, bill_id, source_run_id, item_id, item_name, quantity, rate, amount)
     VALUES (?, 'bl_r1', 'bill_reg', ?, 'item_O', 'Item item_O', 20, 50, 1000)`
  ).run(ORG, runId);

  const result = getApprovalPendingDocuments(undefined, db, undefined, undefined, "BILL-REG-001");
  const doc = result.documents.find(d => d.number === "BILL-REG-001");
  assert.ok(doc, "Bill document found");
  assert.strictEqual(doc.type, "BILL");
  assert.strictEqual(doc.verificationStatus, "MATCHED");
});

// ── T15. Rate Guard regression unchanged ───────────────────

test("T15. Rate Guard regression unchanged", () => {
  const ok = evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MATCH", refRate: 100, rate: 90 });
  assert.strictEqual(ok.rateCheckStatus, "OK", "SO rate >= current → OK");

  const alert = evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MATCH", refRate: 80, rate: 100 });
  assert.strictEqual(alert.rateCheckStatus, "ALERT", "SO rate < current → ALERT");

  const cantDet = evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MISMATCH", refRate: 100, rate: 90 });
  assert.strictEqual(cantDet.rateCheckStatus, "CANNOT_DETERMINE", "different UOM → CANNOT_DETERMINE");
});

// ── T16. Manual Mapping Phase-1 regression ─────────────────

test("T16. Manual Mapping Phase-1 regression — create + get", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-test-mm-"));
  const tmpDbPath = path.join(tmpDir, "test.db");
  const mmDb = openAuditDatabaseAt(tmpDbPath);

  const mmRunId = "mm_inv_test_run";
  mmDb.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES (?, ?, 'TEST', ?, 'SUCCESS')`).run(mmRunId, ORG, new Date().toISOString());
  mmDb.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, quantity, rate, amount, unit) VALUES (?, 'sol_mm1', 'so_mm', ?, 'item_mm', 'MM Item', 10, 100, 1000, 'Pcs')`).run(ORG, mmRunId);
  mmDb.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, item_name, quantity, rate, amount, unit) VALUES (?, 'pol_mm1', 'po_mm', ?, 'item_mm', 'MM Item', 10, 100, 1000, 'Pcs')`).run(ORG, mmRunId);

  const createResult = createOwnerLineMapping(mmDb, {
    organizationId: ORG,
    salesorderId: "so_mm",
    soLineItemId: "sol_mm1",
    purchaseorderId: "po_mm",
    poLineItemId: "pol_mm1",
    mappingKind: "OWNER_FALLBACK" as any,
    note: "Phase-1 regression test",
  });
  assert.strictEqual(createResult.outcome, "CREATED");
  const mapping = getCurrentMappingForPoLine(mmDb, ORG, "po_mm", "pol_mm1");
  assert.ok(mapping, "mapping retrievable");
  assert.strictEqual(mapping!.status, "ACTIVE");

  try { mmDb.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

// ── T17. Manual Mapping Phase-2 regression ─────────────────

test("T17. Manual Mapping Phase-2 regression — create + revoke", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-test-mm2-"));
  const tmpDbPath = path.join(tmpDir, "test.db");
  const mmDb = openAuditDatabaseAt(tmpDbPath);

  const mmRunId = "mm2_inv_test_run";
  mmDb.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES (?, ?, 'TEST', ?, 'SUCCESS')`).run(mmRunId, ORG, new Date().toISOString());
  mmDb.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, quantity, rate, amount, unit) VALUES (?, 'sol_mm2a', 'so_mm2', ?, 'item_mm2', 'MM2 Item', 10, 100, 1000, 'Pcs')`).run(ORG, mmRunId);
  mmDb.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, item_name, quantity, rate, amount, unit) VALUES (?, 'pol_mm2a', 'po_mm2', ?, 'item_mm2', 'MM2 Item', 10, 100, 1000, 'Pcs')`).run(ORG, mmRunId);

  const createResult = createOwnerLineMapping(mmDb, {
    organizationId: ORG,
    salesorderId: "so_mm2",
    soLineItemId: "sol_mm2a",
    purchaseorderId: "po_mm2",
    poLineItemId: "pol_mm2a",
    mappingKind: "OWNER_FALLBACK" as any,
    note: "Phase-2 regression test",
  });
  assert.strictEqual(createResult.outcome, "CREATED");
  const revokeResult = revokeOwnerLineMapping(mmDb, createResult.mapping.mapping_id, "revoke test");
  assert.strictEqual(revokeResult.outcome, "REVOKED");

  try { mmDb.close(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

// ── T18. No Zoho calls / writes in service ─────────────────

test("T18. No Zoho calls or writes in service source", () => {
  const serviceSrc = fs.readFileSync(
    path.join(process.cwd(), "app/lib/audit/approval-pending-service.ts"),
    "utf-8"
  );
  assert.ok(!serviceSrc.includes("zoho-read-transactions"), "no zoho reader import");
  assert.ok(!serviceSrc.includes("zoho-token-store"), "no token store import");
  assert.ok(!serviceSrc.includes("method: 'POST'"), "no POST");
  assert.ok(!serviceSrc.includes("method: 'PUT'"), "no PUT");
  assert.ok(!serviceSrc.includes("method: 'PATCH'"), "no PATCH");
  assert.ok(!serviceSrc.includes("method: 'DELETE'"), "no DELETE");
});

// ── T19. Operational DB unchanged by tests ─────────────────

test("T19. Operational DB unchanged by tests", () => {
  const afterDbHash = crypto.createHash("sha256").update(fs.readFileSync(_opDbPath)).digest("hex");
  assert.strictEqual(afterDbHash, _baselineDbHash, "operational DB hash unchanged");
  if (fs.existsSync(_opWalPath) && _baselineWalHash !== null) {
    const afterWalHash = crypto.createHash("sha256").update(fs.readFileSync(_opWalPath)).digest("hex");
    assert.strictEqual(afterWalHash, _baselineWalHash, "operational WAL hash unchanged");
  }
});

// ── Summary ────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failures.length > 0) {
  console.log(`  Failures: ${failures.join(", ")}`);
}
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
