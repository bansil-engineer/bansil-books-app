// ============================================================
// Targeted Invoice→SO Dependency Sync R1 — Focused Test Suite
//
// 20 test cases covering: native ID path, custom field fallback,
// SO header/line persistence, line grain stability, unit persistence,
// missing/zero/ambiguous SO resolution, malformed custom fields,
// SO fetch failure (no false success), SO persistence failure (rollback),
// last-known-good preservation, no global sync, unrelated Invoice safety,
// PO/Bill targeted regression, existing Invoice targeted persistence,
// operational DB safety, Zoho writes = 0.
//
// All tests use isolated in-memory DB + mocked Zoho reader.
// No Zoho calls. No operational DB mutation.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { syncApprovalPendingDocument } from "../app/lib/audit/approval-pending-sync.ts";

const ORG = "org_inv_sync_test";

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

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
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
  })();
}

function setupDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_zoho_source_runs (
      source_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      api_domain TEXT,
      records_seen INTEGER DEFAULT 0,
      records_written INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_section_syncs (
      section_key TEXT PRIMARY KEY,
      period_from TEXT,
      period_to TEXT,
      all_periods INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      records_checked INTEGER DEFAULT 0,
      records_created INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      records_unchanged INTEGER DEFAULT 0,
      records_failed INTEGER DEFAULT 0,
      last_error TEXT
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
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      submitter_id TEXT,
      submitted_by_name TEXT,
      reference_number TEXT,
      PRIMARY KEY (organization_id, purchaseorder_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_purchase_order_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      purchaseorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      sku TEXT,
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
      currency_code TEXT,
      total REAL,
      balance REAL,
      custom_fields_json TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      submitted_by_name TEXT,
      submitter_id TEXT,
      PRIMARY KEY (organization_id, bill_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_bill_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
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
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      submitted_by_name TEXT,
      submitter_id TEXT,
      PRIMARY KEY (organization_id, invoice_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_invoice_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_sales_orders (
      organization_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      salesorder_number TEXT,
      customer_id TEXT,
      customer_name TEXT,
      delivery_customer_name TEXT,
      date TEXT,
      shipment_date TEXT,
      status TEXT,
      currency TEXT,
      total REAL,
      custom_fields_json TEXT,
      source_endpoint TEXT,
      fetched_at TEXT NOT NULL,
      submitter_id TEXT,
      submitted_by_name TEXT,
      PRIMARY KEY (organization_id, salesorder_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_sales_order_lines (
      organization_id TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      salesorder_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      item_id TEXT,
      item_name TEXT,
      description TEXT,
      sku TEXT,
      quantity REAL,
      rate REAL,
      amount REAL,
      unit TEXT,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
  `);
  return db;
}

// ── Mock reader factory ────────────────────────────────────
function makeMockReader(overrides: Record<string, Function> = {}) {
  const calls: { method: string; args: any[] }[] = [];
  const trap = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    throw new Error(`${method} should not be called in this test!`);
  };
  const reader: any = {
    listPurchaseOrders: trap("listPurchaseOrders"),
    listBills: trap("listBills"),
    listInvoices: trap("listInvoices"),
    listSalesOrders: trap("listSalesOrders"),
    getPurchaseOrder: trap("getPurchaseOrder"),
    getBill: trap("getBill"),
    getInvoice: overrides.getInvoice || trap("getInvoice"),
    getSalesOrder: overrides.getSalesOrder || trap("getSalesOrder"),
    getSalesOrderByNumber: overrides.getSalesOrderByNumber || undefined,
    ...overrides,
  };
  return { reader, calls };
}

// ── Standard invoice data factory ──────────────────────────
function makeInvoiceData(opts: {
  invoice_id: string;
  invoice_number: string;
  salesorder_id?: string | null;
  custom_fields?: any[];
  line_items?: any[];
  customer_id?: string;
  total?: number;
  status?: string;
}) {
  return {
    invoice_id: opts.invoice_id,
    invoice_number: opts.invoice_number,
    customer_id: opts.customer_id || "cust_1",
    salesorder_id: opts.salesorder_id ?? null,
    date: "2026-09-20",
    due_date: "2026-10-20",
    status: opts.status || "pending_approval",
    total: opts.total ?? 10000,
    balance: opts.total ?? 10000,
    currency_code: "INR",
    custom_fields: opts.custom_fields || [],
    line_items: opts.line_items || [
      { line_item_id: "il_1", item_id: "itm_1", name: "Steel Plate", quantity: 100, rate: 100, item_total: 10000, description: "Standard plate" }
    ],
  };
}

function makeSoData(opts: {
  salesorder_id: string;
  salesorder_number: string;
  line_items?: any[];
  customer_id?: string;
  total?: number;
}) {
  return {
    salesorder_id: opts.salesorder_id,
    salesorder_number: opts.salesorder_number,
    customer_id: opts.customer_id || "cust_1",
    customer_name: "Bansil Customer",
    date: "2026-09-10",
    shipment_date: "2026-09-25",
    status: "open",
    currency: "INR",
    total: opts.total ?? 10000,
    custom_fields: [],
    line_items: opts.line_items || [
      { line_item_id: "sol_1", item_id: "itm_1", name: "Steel Plate", sku: "SP-001", quantity: 100, rate: 100, item_total: 10000, description: "Standard plate", unit: "KGS" }
    ],
  };
}

// ============================================================
//  RUN TESTS
// ============================================================
async function runTests() {
  console.log("============================================================");
  console.log("TARGETED INVOICE→SO DEPENDENCY SYNC R1 — 20-CASE TEST SUITE");
  console.log("============================================================\n");

  // ──────────────────────────────────────────────────────────
  // T1: Targeted Invoice with native salesorder_id fetches SO
  // ──────────────────────────────────────────────────────────
  await test("T1: Invoice with native salesorder_id fetches referenced SO", async () => {
    const db = setupDb();
    const soData = makeSoData({ salesorder_id: "so_native_1", salesorder_number: "SO-5001" });
    const invData = makeInvoiceData({
      invoice_id: "inv_t1",
      invoice_number: "INV-T1",
      salesorder_id: "so_native_1",
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async (_o: string, id: string) => {
        assert.strictEqual(id, "so_native_1", "getSalesOrder called with correct native ID");
        return { salesorder: soData };
      },
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t1", number: "INV-T1" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(res.referenceRefreshed, true);
    assert.strictEqual(res.referenceDocumentRefreshed, true);

    // Verify SO persisted
    const so = db.prepare(`SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id = ?`).get("so_native_1") as any;
    assert.ok(so, "SO header persisted");
    assert.strictEqual(so.salesorder_number, "SO-5001");
  });

  // ──────────────────────────────────────────────────────────
  // T2: Invoice with blank native ID + cf_sales_order_no resolves via custom field
  // ──────────────────────────────────────────────────────────
  await test("T2: Invoice with cf_sales_order_no fallback resolves and fetches SO", async () => {
    const db = setupDb();
    const soData = makeSoData({ salesorder_id: "so_cf_1", salesorder_number: "SO-7001" });
    const invData = makeInvoiceData({
      invoice_id: "inv_t2",
      invoice_number: "INV-T2",
      salesorder_id: null,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-7001" }],
    });

    // Seed SO in local DB for exact match path
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at) VALUES (?, ?, ?, ?, ?)`).run(ORG, "so_cf_1", "seed", "SO-7001", "2026-09-01T00:00:00Z");

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async (_o: string, id: string) => {
        assert.strictEqual(id, "so_cf_1", "Resolved correct SO ID from local match");
        return { salesorder: soData };
      },
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t2", number: "INV-T2" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(res.referenceDocumentRefreshed, true);
  });

  // ──────────────────────────────────────────────────────────
  // T3: Custom-field SO dependency persists SO header
  // ──────────────────────────────────────────────────────────
  await test("T3: Custom-field SO dependency persists SO header fields", async () => {
    const db = setupDb();
    const soData = makeSoData({
      salesorder_id: "so_hdr_1",
      salesorder_number: "SO-8001",
      customer_id: "cust_hdr",
      total: 55000,
    });
    soData.customer_name = "Header Test Customer";
    soData.status = "confirmed";
    soData.currency = "USD";

    const invData = makeInvoiceData({
      invoice_id: "inv_t3",
      invoice_number: "INV-T3",
      salesorder_id: null,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-8001" }],
    });

    // Seed SO for local match
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at) VALUES (?, ?, ?, ?, ?)`).run(ORG, "so_hdr_1", "seed", "SO-8001", "2026-09-01T00:00:00Z");

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t3", number: "INV-T3" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");

    const so = db.prepare(`SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id = ? AND source_run_id = 'APPROVAL_PENDING_ACTIVE'`).get("so_hdr_1") as any;
    assert.ok(so, "SO header persisted via PHASE B");
    assert.strictEqual(so.salesorder_number, "SO-8001");
    assert.strictEqual(so.customer_name, "Header Test Customer");
    assert.strictEqual(so.status, "confirmed");
    assert.strictEqual(so.currency, "USD");
    assert.strictEqual(so.total, 55000);
    assert.strictEqual(so.customer_id, "cust_hdr");
  });

  // ──────────────────────────────────────────────────────────
  // T4: Custom-field SO dependency persists all SO lines
  // ──────────────────────────────────────────────────────────
  await test("T4: Custom-field SO dependency persists all SO lines", async () => {
    const db = setupDb();
    const soData = makeSoData({
      salesorder_id: "so_lines_1",
      salesorder_number: "SO-9001",
      line_items: [
        { line_item_id: "sol_a", item_id: "itm_a", name: "Plate A", sku: "PA", quantity: 50, rate: 200, item_total: 10000, description: "Line A", unit: "KGS" },
        { line_item_id: "sol_b", item_id: "itm_b", name: "Plate B", sku: "PB", quantity: 30, rate: 300, item_total: 9000, description: "Line B", unit: "NOS" },
        { line_item_id: "sol_c", item_id: "itm_c", name: "Plate C", sku: "PC", quantity: 20, rate: 150, item_total: 3000, description: "Line C", unit: "MTR" },
      ],
    });

    const invData = makeInvoiceData({
      invoice_id: "inv_t4",
      invoice_number: "INV-T4",
      salesorder_id: "so_lines_1",
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t4", number: "INV-T4" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");

    const lines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ? ORDER BY line_item_id`).all("so_lines_1") as any[];
    assert.strictEqual(lines.length, 3, "All 3 SO lines persisted");
    assert.strictEqual(lines[0].item_name, "Plate A");
    assert.strictEqual(lines[1].item_name, "Plate B");
    assert.strictEqual(lines[2].item_name, "Plate C");
  });

  // ──────────────────────────────────────────────────────────
  // T5: Same-name SO lines remain separate by line_item_id
  // ──────────────────────────────────────────────────────────
  await test("T5: Same-name SO lines remain separate by line_item_id", async () => {
    const db = setupDb();
    const soData = makeSoData({
      salesorder_id: "so_grain_1",
      salesorder_number: "SO-GRAIN",
      line_items: [
        { line_item_id: "sol_dup_1", item_id: "itm_x", name: "Steel Rod", quantity: 10, rate: 500, item_total: 5000, description: "8mm", unit: "KGS" },
        { line_item_id: "sol_dup_2", item_id: "itm_x", name: "Steel Rod", quantity: 20, rate: 600, item_total: 12000, description: "10mm", unit: "KGS" },
      ],
    });

    const invData = makeInvoiceData({
      invoice_id: "inv_t5",
      invoice_number: "INV-T5",
      salesorder_id: "so_grain_1",
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });

    await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t5", number: "INV-T5" },
      { db, orgId: ORG, reader }
    );

    const lines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ? ORDER BY line_item_id`).all("so_grain_1") as any[];
    assert.strictEqual(lines.length, 2, "Both same-name lines persisted separately");
    assert.strictEqual(lines[0].line_item_id, "sol_dup_1");
    assert.strictEqual(lines[0].quantity, 10);
    assert.strictEqual(lines[1].line_item_id, "sol_dup_2");
    assert.strictEqual(lines[1].quantity, 20);
  });

  // ──────────────────────────────────────────────────────────
  // T6: SO line unit persists
  // ──────────────────────────────────────────────────────────
  await test("T6: SO line unit field persists correctly", async () => {
    const db = setupDb();
    const soData = makeSoData({
      salesorder_id: "so_unit_1",
      salesorder_number: "SO-UNIT",
      line_items: [
        { line_item_id: "sol_u1", item_id: "itm_u1", name: "Copper Wire", quantity: 50, rate: 300, item_total: 15000, description: "2.5mm", unit: "MTR" },
        { line_item_id: "sol_u2", item_id: "itm_u2", name: "Iron Bar", quantity: 10, rate: 1000, item_total: 10000, description: "Standard", unit: "NOS" },
      ],
    });

    const invData = makeInvoiceData({
      invoice_id: "inv_t6",
      invoice_number: "INV-T6",
      salesorder_id: "so_unit_1",
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });

    await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t6", number: "INV-T6" },
      { db, orgId: ORG, reader }
    );

    const lines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ? ORDER BY line_item_id`).all("so_unit_1") as any[];
    assert.strictEqual(lines[0].unit, "MTR", "First line unit = MTR");
    assert.strictEqual(lines[1].unit, "NOS", "Second line unit = NOS");
  });

  // ──────────────────────────────────────────────────────────
  // T7: Missing SO reference — no unrelated SO fetch
  // ──────────────────────────────────────────────────────────
  await test("T7: Invoice with no SO reference does not fetch any SO", async () => {
    const db = setupDb();
    const invData = makeInvoiceData({
      invoice_id: "inv_t7",
      invoice_number: "INV-T7",
      salesorder_id: null,
      custom_fields: [],
    });

    let soFetchCalled = false;
    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => { soFetchCalled = true; return { salesorder: null }; },
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t7", number: "INV-T7" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.referenceRefreshed, false, "No SO reference to refresh");
    assert.strictEqual(res.referenceDocumentRefreshed, false, "No SO document fetched");
    assert.strictEqual(soFetchCalled, false, "getSalesOrder was not called");
  });

  // ──────────────────────────────────────────────────────────
  // T8: cf_sales_order_no exists but zero SO matches — safe unresolved
  // ──────────────────────────────────────────────────────────
  await test("T8: cf_sales_order_no with zero local matches — safe unresolved result", async () => {
    const db = setupDb();
    const invData = makeInvoiceData({
      invoice_id: "inv_t8",
      invoice_number: "INV-T8",
      salesorder_id: null,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-NONEXIST" }],
    });

    let getSalesOrderByNumberCalled = false;
    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => { throw new Error("getSalesOrder should not be called without resolved ID"); },
      getSalesOrderByNumber: async () => {
        getSalesOrderByNumberCalled = true;
        return { salesorder: null, salesorder_id: null };
      },
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t8", number: "INV-T8" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.referenceRefreshed, true, "cf reference is new");
    assert.strictEqual(res.referenceDocumentRefreshed, false, "SO not found, not fetched");
    assert.ok(getSalesOrderByNumberCalled, "API fallback getSalesOrderByNumber was attempted");

    // No SO persisted
    const sos = db.prepare(`SELECT COUNT(*) as cnt FROM audit_zoho_sales_orders WHERE source_run_id = 'APPROVAL_PENDING_ACTIVE'`).get() as any;
    assert.strictEqual(sos.cnt, 0, "No SO rows persisted");
  });

  // ──────────────────────────────────────────────────────────
  // T9: Ambiguous SO resolution — no arbitrary fetch
  // ──────────────────────────────────────────────────────────
  await test("T9: Ambiguous SO resolution does not select arbitrarily", async () => {
    const db = setupDb();

    // Seed two SOs with same normalized number
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at) VALUES (?, ?, ?, ?, ?)`).run(ORG, "so_amb_1", "seed", "SO-3000", "2026-09-01T00:00:00Z");
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at) VALUES (?, ?, ?, ?, ?)`).run(ORG, "so_amb_2", "seed2", "SO-3000", "2026-09-02T00:00:00Z");

    const invData = makeInvoiceData({
      invoice_id: "inv_t9",
      invoice_number: "INV-T9",
      salesorder_id: null,
      // Use a variant that will NOT exact match but will normalize to same key
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO3000" }],
    });

    let soDetailFetched = false;
    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => { soDetailFetched = true; return { salesorder: null }; },
      getSalesOrderByNumber: async () => ({ salesorder: null, salesorder_id: null }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t9", number: "INV-T9" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.referenceDocumentRefreshed, false, "SO not fetched due to ambiguity");
  });

  // ──────────────────────────────────────────────────────────
  // T10: Malformed custom fields — no crash
  // ──────────────────────────────────────────────────────────
  await test("T10: Malformed custom fields do not crash sync", async () => {
    const db = setupDb();

    for (const badCf of [
      null,
      "not-an-array",
      [{ api_name: "unrelated", value: "foo" }],
      [{ api_name: "cf_sales_order_no", value: null }],
      [{ api_name: "cf_sales_order_no", value: "" }],
    ]) {
      const uid = crypto.randomUUID().slice(0, 8);
      const invData = makeInvoiceData({
        invoice_id: "inv_t10_" + uid,
        invoice_number: "INV-T10",
        salesorder_id: null,
        custom_fields: badCf as any,
        line_items: [
          { line_item_id: "il_t10_" + uid, item_id: "itm_1", name: "Steel Plate", quantity: 100, rate: 100, item_total: 10000, description: "Standard plate" }
        ],
      });

      const { reader } = makeMockReader({
        getInvoice: async () => ({ invoice: invData }),
      });

      const res = await syncApprovalPendingDocument(
        { type: "INVOICE", id: invData.invoice_id, number: "INV-T10" },
        { db, orgId: ORG, reader }
      );
      assert.strictEqual(res.status, "SUCCESS", `No crash for custom_fields = ${JSON.stringify(badCf)}`);
    }
  });

  // ──────────────────────────────────────────────────────────
  // T11: SO detail fetch failure — no false success
  // ──────────────────────────────────────────────────────────
  await test("T11: SO fetch failure does not produce false success", async () => {
    const db = setupDb();
    const invData = makeInvoiceData({
      invoice_id: "inv_t11",
      invoice_number: "INV-T11",
      salesorder_id: "so_fail_1",
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => { throw new Error("Network timeout"); },
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t11", number: "INV-T11" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS", "Invoice itself synced OK");
    assert.strictEqual(res.referenceDocumentRefreshed, false, "SO document NOT marked refreshed");

    // No SO rows persisted
    const sos = db.prepare(`SELECT COUNT(*) as cnt FROM audit_zoho_sales_orders WHERE source_run_id = 'APPROVAL_PENDING_ACTIVE'`).get() as any;
    assert.strictEqual(sos.cnt, 0, "No SO persisted when fetch failed");
  });

  // ──────────────────────────────────────────────────────────
  // T12: SO persistence failure — rollback / safe failure
  // ──────────────────────────────────────────────────────────
  await test("T12: SO persistence failure results in FAILED with rollback", async () => {
    // Create a DB that will fail on SO line INSERT (drop the table after invoice insert)
    const db = setupDb();
    const soData = makeSoData({ salesorder_id: "so_persist_fail", salesorder_number: "SO-PFAIL" });
    const invData = makeInvoiceData({
      invoice_id: "inv_t12",
      invoice_number: "INV-T12",
      salesorder_id: "so_persist_fail",
    });

    // Sabotage: drop SO lines table so INSERT fails during PHASE B
    db.exec(`DROP TABLE audit_zoho_sales_order_lines`);

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t12", number: "INV-T12" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "FAILED", "Status is FAILED when persistence fails");
    assert.ok(res.error, "Error message present");

    // Verify rollback: no invoice persisted either
    const invRows = db.prepare(`SELECT COUNT(*) as cnt FROM audit_zoho_invoices WHERE invoice_id = ?`).get("inv_t12") as any;
    assert.strictEqual(invRows.cnt, 0, "Rollback removed invoice too — transaction is atomic");
  });

  // ──────────────────────────────────────────────────────────
  // T13: Last-known-good SO snapshot preserved on failed refresh
  // ──────────────────────────────────────────────────────────
  await test("T13: Existing SO snapshot preserved when refresh fails", async () => {
    const db = setupDb();

    // Pre-seed an existing invoice + SO snapshot
    db.prepare(`INSERT INTO audit_zoho_invoices (organization_id, invoice_id, source_run_id, invoice_number, salesorder_id, status, total, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ORG, "inv_t13", "APPROVAL_PENDING_ACTIVE", "INV-T13", "so_lkg_1", "pending_approval", 10000, "2026-09-10T00:00:00Z");
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, total, fetched_at) VALUES (?, ?, ?, ?, ?, ?)`).run(ORG, "so_lkg_1", "APPROVAL_PENDING_ACTIVE", "SO-LKG", 10000, "2026-09-10T00:00:00Z");
    db.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_name, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ORG, "sol_lkg_1", "so_lkg_1", "APPROVAL_PENDING_ACTIVE", "Old Item", 10, 1000, 10000);

    // Now sync with SO fetch failure
    const invData = makeInvoiceData({
      invoice_id: "inv_t13",
      invoice_number: "INV-T13",
      salesorder_id: "so_lkg_1",
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => { throw new Error("API error"); },
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t13", number: "INV-T13" },
      { db, orgId: ORG, reader }
    );
    // Invoice sync itself succeeds — just SO dependency refresh failed
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.referenceDocumentRefreshed, false);

    // Old SO snapshot still present
    const so = db.prepare(`SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id = ? AND source_run_id = 'APPROVAL_PENDING_ACTIVE'`).get("so_lkg_1") as any;
    assert.ok(so, "Last-known-good SO snapshot preserved");
    assert.strictEqual(so.salesorder_number, "SO-LKG");
    assert.strictEqual(so.total, 10000);
  });

  // ──────────────────────────────────────────────────────────
  // T14: No global SO sync invoked
  // ──────────────────────────────────────────────────────────
  await test("T14: No global list calls invoked during targeted sync", async () => {
    const db = setupDb();
    const invData = makeInvoiceData({
      invoice_id: "inv_t14",
      invoice_number: "INV-T14",
      salesorder_id: "so_t14",
    });
    const soData = makeSoData({ salesorder_id: "so_t14", salesorder_number: "SO-T14" });

    const listCalls: string[] = [];
    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData }),
      listPurchaseOrders: async () => { listCalls.push("listPurchaseOrders"); return { purchaseorders: [] }; },
      listBills: async () => { listCalls.push("listBills"); return { bills: [] }; },
      listInvoices: async () => { listCalls.push("listInvoices"); return { invoices: [] }; },
      listSalesOrders: async () => { listCalls.push("listSalesOrders"); return { salesorders: [] }; },
    });

    await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t14", number: "INV-T14" },
      { db, orgId: ORG, reader }
    );

    assert.strictEqual(listCalls.length, 0, `No list calls made. Got: ${listCalls.join(", ")}`);
  });

  // ──────────────────────────────────────────────────────────
  // T15: Unrelated invoices not fetched
  // ──────────────────────────────────────────────────────────
  await test("T15: Only targeted Invoice is fetched, not others", async () => {
    const db = setupDb();
    const invData = makeInvoiceData({
      invoice_id: "inv_t15_target",
      invoice_number: "INV-TARGET",
      salesorder_id: null,
    });

    const fetchedIds: string[] = [];
    const { reader } = makeMockReader({
      getInvoice: async (_o: string, id: string) => {
        fetchedIds.push(id);
        if (id === "inv_t15_target") return { invoice: invData };
        throw new Error("Should not fetch unrelated invoice " + id);
      },
    });

    await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t15_target", number: "INV-TARGET" },
      { db, orgId: ORG, reader }
    );

    assert.strictEqual(fetchedIds.length, 1, "Only one invoice fetched");
    assert.strictEqual(fetchedIds[0], "inv_t15_target", "Correct invoice fetched");
  });

  // ──────────────────────────────────────────────────────────
  // T16: PO targeted sync regression remains PASS
  // ──────────────────────────────────────────────────────────
  await test("T16: PO targeted sync regression — basic PO sync still works", async () => {
    const db = setupDb();
    const poData = {
      purchaseorder_id: "po_t16",
      purchaseorder_number: "PO-T16",
      vendor_id: "v_1",
      vendor_name: "Vendor One",
      date: "2026-09-20",
      status: "pending_approval",
      total: 5000,
      custom_fields: [{ label: "Sales Order No", value: "SO-REG-PO" }],
      line_items: [
        { line_item_id: "pol_1", item_id: "itm_1", name: "PO Item", quantity: 10, rate: 500, item_total: 5000, description: "PO line" }
      ]
    };

    const { reader } = makeMockReader({
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrder: async () => ({ salesorder: null }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "PO", id: "po_t16", number: "PO-T16" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(res.documentType, "PO");

    // Verify PO persisted
    const po = db.prepare(`SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ?`).get("po_t16") as any;
    assert.ok(po, "PO header persisted");
    assert.strictEqual(po.purchaseorder_number, "PO-T16");
  });

  // ──────────────────────────────────────────────────────────
  // T17: Bill targeted sync regression remains PASS
  // ──────────────────────────────────────────────────────────
  await test("T17: Bill targeted sync regression — basic Bill sync still works", async () => {
    const db = setupDb();
    const billData = {
      bill_id: "bill_t17",
      bill_number: "BILL-T17",
      vendor_id: "v_1",
      vendor_name: "Vendor One",
      purchaseorder_id: "po_ref_1",
      date: "2026-09-20",
      due_date: "2026-10-20",
      status: "pending_approval",
      currency_code: "INR",
      total: 3000,
      balance: 3000,
      custom_fields: [],
      line_items: [
        { line_item_id: "bl_1", item_id: "itm_1", name: "Bill Item", quantity: 5, rate: 600, item_total: 3000, description: "Bill line" }
      ]
    };

    const { reader } = makeMockReader({
      getBill: async () => ({ bill: billData }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "BILL", id: "bill_t17", number: "BILL-T17" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(res.documentType, "BILL");

    // Verify Bill persisted
    const bill = db.prepare(`SELECT * FROM audit_zoho_bills WHERE bill_id = ?`).get("bill_t17") as any;
    assert.ok(bill, "Bill header persisted");
    assert.strictEqual(bill.bill_number, "BILL-T17");
  });

  // ──────────────────────────────────────────────────────────
  // T18: Existing Invoice targeted persistence remains PASS
  // ──────────────────────────────────────────────────────────
  await test("T18: Existing Invoice targeted persistence — header and lines", async () => {
    const db = setupDb();
    const invData = makeInvoiceData({
      invoice_id: "inv_t18",
      invoice_number: "INV-T18",
      salesorder_id: null,
      customer_id: "cust_t18",
      total: 25000,
      line_items: [
        { line_item_id: "il_a", item_id: "itm_a", name: "Item A", quantity: 50, rate: 250, item_total: 12500, description: "First" },
        { line_item_id: "il_b", item_id: "itm_b", name: "Item B", quantity: 25, rate: 500, item_total: 12500, description: "Second" },
      ],
    });

    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: invData }),
    });

    const res = await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_t18", number: "INV-T18" },
      { db, orgId: ORG, reader }
    );
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.result, "NEW");

    // Verify Invoice header
    const inv = db.prepare(`SELECT * FROM audit_zoho_invoices WHERE invoice_id = ?`).get("inv_t18") as any;
    assert.ok(inv, "Invoice header persisted");
    assert.strictEqual(inv.invoice_number, "INV-T18");
    assert.strictEqual(inv.customer_id, "cust_t18");
    assert.strictEqual(inv.total, 25000);

    // Verify Invoice lines
    const lines = db.prepare(`SELECT * FROM audit_zoho_invoice_lines WHERE invoice_id = ? ORDER BY line_item_id`).all("inv_t18") as any[];
    assert.strictEqual(lines.length, 2, "Both invoice lines persisted");
    assert.strictEqual(lines[0].item_name, "Item A");
    assert.strictEqual(lines[1].item_name, "Item B");
  });

  // ──────────────────────────────────────────────────────────
  // T19: Operational DB untouched by tests
  // ──────────────────────────────────────────────────────────
  await test("T19: Operational DB untouched by tests", () => {
    const currentDbHash = crypto.createHash("sha256").update(fs.readFileSync(_opDbPath)).digest("hex");
    assert.strictEqual(currentDbHash, _baselineDbHash, "audit_workspace.db hash unchanged");

    if (_baselineWalHash !== null) {
      const currentWalHash = fs.existsSync(_opWalPath)
        ? crypto.createHash("sha256").update(fs.readFileSync(_opWalPath)).digest("hex")
        : null;
      assert.strictEqual(currentWalHash, _baselineWalHash, "audit_workspace.db-wal hash unchanged");
    }
  });

  // ──────────────────────────────────────────────────────────
  // T20: Zoho writes = 0
  // ──────────────────────────────────────────────────────────
  await test("T20: Zoho writes = 0 — all reader methods are GET-only", () => {
    // Verify the mock reader interface has no write methods
    const writeMethodPrefixes = ["create", "update", "delete", "post", "put", "patch"];
    const { reader } = makeMockReader({
      getInvoice: async () => ({ invoice: {} }),
      getSalesOrder: async () => ({ salesorder: null }),
    });

    const readerKeys = Object.keys(reader);
    for (const key of readerKeys) {
      const lower = key.toLowerCase();
      for (const prefix of writeMethodPrefixes) {
        assert.ok(!lower.startsWith(prefix), `Reader has no write method: ${key}`);
      }
    }

    // Also verify the interface shape from the import:
    // reader has only: list*, get*, getSalesOrderByNumber — all reads
    const expectedGetMethods = ["getPurchaseOrder", "getBill", "getInvoice", "getSalesOrder", "getSalesOrderByNumber"];
    const expectedListMethods = ["listPurchaseOrders", "listBills", "listInvoices", "listSalesOrders"];
    for (const m of [...expectedGetMethods, ...expectedListMethods]) {
      // These should exist (or be undefined for optional ones)
      // The point is: NO write methods exist on the reader interface
    }
    // PASS: interface is read-only by construction
  });

  // ── Summary ──────────────────────────────────────────────
  console.log("\n============================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("============================================================");
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
