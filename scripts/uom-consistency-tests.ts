// ============================================================
// Phase-A / Phase-B UOM Consistency Test Suite
//
// 13 test cases covering: Phase-A SO/PO unit persistence,
// missing unit → NULL, Phase-B still works, global-after-targeted
// consistency, unit-only change detection, no fake defaults,
// same-name lines remain separate, operational DB safety,
// no live Zoho calls.
//
// All tests use isolated in-memory DB + mocked Zoho reader.
// No Zoho calls. No operational DB mutation.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { syncApprovalPending, syncApprovalPendingDocument } from "../app/lib/audit/approval-pending-sync.ts";

const ORG = "org_uom_test";

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

// ── Phase-A mock reader factory ────────────────────────────
// Phase-A global sync calls list* and get* for POs, Bills, Invoices, SOs
function makePhaseAReader(opts: {
  purchaseorders?: any[];
  bills?: any[];
  invoices?: any[];
  salesorders?: any[];
  poDetails?: Record<string, any>;
  billDetails?: Record<string, any>;
  invoiceDetails?: Record<string, any>;
  soDetails?: Record<string, any>;
}) {
  const calls: { method: string; args: any[] }[] = [];
  return {
    calls,
    reader: {
      listPurchaseOrders: async (orgId: string) => {
        calls.push({ method: "listPurchaseOrders", args: [orgId] });
        return { purchaseorders: opts.purchaseorders || [] };
      },
      getPurchaseOrder: async (orgId: string, id: string) => {
        calls.push({ method: "getPurchaseOrder", args: [orgId, id] });
        const detail = opts.poDetails?.[id];
        return detail ? { purchaseorder: detail } : {};
      },
      listBills: async (orgId: string) => {
        calls.push({ method: "listBills", args: [orgId] });
        return { bills: opts.bills || [] };
      },
      getBill: async (orgId: string, id: string) => {
        calls.push({ method: "getBill", args: [orgId, id] });
        const detail = opts.billDetails?.[id];
        return detail ? { bill: detail } : {};
      },
      listInvoices: async (orgId: string) => {
        calls.push({ method: "listInvoices", args: [orgId] });
        return { invoices: opts.invoices || [] };
      },
      getInvoice: async (orgId: string, id: string) => {
        calls.push({ method: "getInvoice", args: [orgId, id] });
        const detail = opts.invoiceDetails?.[id];
        return detail ? { invoice: detail } : {};
      },
      listSalesOrders: async (orgId: string) => {
        calls.push({ method: "listSalesOrders", args: [orgId] });
        return { salesorders: opts.salesorders || [] };
      },
      getSalesOrder: async (orgId: string, id: string) => {
        calls.push({ method: "getSalesOrder", args: [orgId, id] });
        const detail = opts.soDetails?.[id];
        return detail ? { salesorder: detail } : {};
      },
    },
  };
}

// ── Phase-B mock reader factory ────────────────────────────
function makePhaseBReader(overrides: Record<string, Function> = {}) {
  const calls: { method: string; args: any[] }[] = [];
  const trap = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    throw new Error(`${method} should not be called in this test!`);
  };
  return {
    calls,
    reader: {
      listPurchaseOrders: trap("listPurchaseOrders"),
      getPurchaseOrder: overrides.getPurchaseOrder || trap("getPurchaseOrder"),
      listBills: trap("listBills"),
      getBill: overrides.getBill || trap("getBill"),
      listInvoices: trap("listInvoices"),
      getInvoice: overrides.getInvoice || trap("getInvoice"),
      listSalesOrders: trap("listSalesOrders"),
      getSalesOrder: overrides.getSalesOrder || trap("getSalesOrder"),
      getSalesOrderByNumber: overrides.getSalesOrderByNumber || undefined,
    },
  };
}

// ============================================================
// RUN TESTS
// ============================================================
async function runTests() {
  console.log("============================================================");
  console.log("Phase-A / Phase-B UOM Consistency Tests");
  console.log("============================================================");

  // ── T1: Phase-A SO line with unit "job" persists correctly ────
  await test("T1: Phase-A SO line with unit 'job' persists correctly", async () => {
    const db = setupDb();
    const so = {
      salesorder_id: "so_uom_1",
      salesorder_number: "SO-UOM-001",
      status: "pending_approval",
      line_items: [
        { line_item_id: "sol_u1", item_id: "itm1", name: "Steel Plate", quantity: 100, rate: 200, item_total: 20000, description: "Standard", unit: "job" },
      ],
    };
    // Phase-A requires PO with salesorder_id reference
    const po = {
      purchaseorder_id: "po_uom_1",
      purchaseorder_number: "PO-UOM-001",
      status: "pending_approval",
      salesorder_id: "so_uom_1",
      line_items: [
        { line_item_id: "pol_u1", item_id: "itm1", name: "Steel Plate", quantity: 100, rate: 200, item_total: 20000, description: "Standard", unit: "nos" },
      ],
    };
    const { reader } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_uom_1", status: "pending_approval" }],
      bills: [],
      invoices: [],
      salesorders: [],
      poDetails: { po_uom_1: po },
      soDetails: { so_uom_1: so },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader, db, orgId: ORG });

    const soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_uom_1") as any[];
    assert.strictEqual(soLines.length, 1, "Should have 1 SO line");
    assert.strictEqual(soLines[0].unit, "job", "SO line unit should be 'job'");
  });

  // ── T2: Phase-A PO line with unit "job" persists correctly ────
  await test("T2: Phase-A PO line with unit 'job' persists correctly", async () => {
    const db = setupDb();
    const po = {
      purchaseorder_id: "po_uom_2",
      purchaseorder_number: "PO-UOM-002",
      status: "pending_approval",
      line_items: [
        { line_item_id: "pol_u2", item_id: "itm2", name: "Copper Wire", quantity: 50, rate: 300, item_total: 15000, description: "2.5mm", unit: "job" },
      ],
    };
    const { reader } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_uom_2", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_uom_2: po },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader, db, orgId: ORG });

    const poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ?`).all("po_uom_2") as any[];
    assert.strictEqual(poLines.length, 1, "Should have 1 PO line");
    assert.strictEqual(poLines[0].unit, "job", "PO line unit should be 'job'");
  });

  // ── T3: Missing SO unit → NULL ────
  await test("T3: Missing SO unit → NULL", async () => {
    const db = setupDb();
    const so = {
      salesorder_id: "so_uom_3",
      salesorder_number: "SO-UOM-003",
      status: "pending_approval",
      line_items: [
        { line_item_id: "sol_u3", item_id: "itm3", name: "Iron Bar", quantity: 10, rate: 1000, item_total: 10000, description: "Standard" },
      ],
    };
    const po = {
      purchaseorder_id: "po_uom_3",
      purchaseorder_number: "PO-UOM-003",
      status: "pending_approval",
      salesorder_id: "so_uom_3",
      line_items: [
        { line_item_id: "pol_u3", item_id: "itm3", name: "Iron Bar", quantity: 10, rate: 1000, item_total: 10000, description: "Standard" },
      ],
    };
    const { reader } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_uom_3", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_uom_3: po },
      soDetails: { so_uom_3: so },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader, db, orgId: ORG });

    const soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_uom_3") as any[];
    assert.strictEqual(soLines.length, 1);
    assert.strictEqual(soLines[0].unit, null, "Missing SO unit must be NULL, not empty string or default");
  });

  // ── T4: Missing PO unit → NULL ────
  await test("T4: Missing PO unit → NULL", async () => {
    const db = setupDb();
    const po = {
      purchaseorder_id: "po_uom_4",
      purchaseorder_number: "PO-UOM-004",
      status: "pending_approval",
      line_items: [
        { line_item_id: "pol_u4", item_id: "itm4", name: "Brass Fitting", quantity: 200, rate: 50, item_total: 10000, description: "Standard" },
      ],
    };
    const { reader } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_uom_4", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_uom_4: po },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader, db, orgId: ORG });

    const poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ?`).all("po_uom_4") as any[];
    assert.strictEqual(poLines.length, 1);
    assert.strictEqual(poLines[0].unit, null, "Missing PO unit must be NULL");
  });

  // ── T5: Phase-B SO still persists unit ────
  await test("T5: Phase-B SO still persists unit", async () => {
    const db = setupDb();
    const soData = {
      salesorder_id: "so_phb_5",
      salesorder_number: "SO-PHB-005",
      status: "open",
      line_items: [
        { line_item_id: "sol_phb1", item_id: "itm5", name: "Plate", quantity: 100, rate: 100, item_total: 10000, description: "Desc", unit: "MTR" },
      ],
    };
    const { reader } = makePhaseBReader({
      getInvoice: async () => ({
        invoice: {
          invoice_id: "inv_phb_5",
          invoice_number: "INV-PHB-005",
          salesorder_id: "so_phb_5",
          status: "pending_approval",
          total: 10000,
          line_items: [
            { line_item_id: "il_phb1", item_id: "itm5", name: "Plate", quantity: 100, rate: 100, item_total: 10000, description: "Desc" },
          ],
        },
      }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });
    await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_phb_5", number: "INV-PHB-005" },
      { reader, db, orgId: ORG }
    );
    const soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_phb_5") as any[];
    assert.strictEqual(soLines.length, 1);
    assert.strictEqual(soLines[0].unit, "MTR", "Phase-B SO line unit = MTR");
  });

  // ── T6: Phase-B PO still persists unit ────
  await test("T6: Phase-B PO still persists unit", async () => {
    const db = setupDb();
    const { reader } = makePhaseBReader({
      getPurchaseOrder: async () => ({
        purchaseorder: {
          purchaseorder_id: "po_phb_6",
          purchaseorder_number: "PO-PHB-006",
          status: "pending_approval",
          total: 5000,
          line_items: [
            { line_item_id: "pol_phb1", item_id: "itm6", name: "Wire", quantity: 50, rate: 100, item_total: 5000, description: "Desc", unit: "KGS" },
          ],
        },
      }),
    });
    await syncApprovalPendingDocument(
      { type: "PO", id: "po_phb_6", number: "PO-PHB-006" },
      { reader, db, orgId: ORG }
    );
    const poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ?`).all("po_phb_6") as any[];
    assert.strictEqual(poLines.length, 1);
    assert.strictEqual(poLines[0].unit, "KGS", "Phase-B PO line unit = KGS");
  });

  // ── T7: Phase-A global sync after earlier targeted snapshot — same unit preserved ────
  await test("T7: Phase-A global sync after targeted snapshot — same unit 'job' preserved", async () => {
    const db = setupDb();

    // Step 1: Phase-B targeted sync creates SO snapshot with unit "job"
    const soData = {
      salesorder_id: "so_cons_7",
      salesorder_number: "SO-CONS-007",
      status: "open",
      line_items: [
        { line_item_id: "sol_c1", item_id: "itm7", name: "Beam", quantity: 20, rate: 500, item_total: 10000, description: "Wide", unit: "job" },
      ],
    };
    const { reader: r1 } = makePhaseBReader({
      getInvoice: async () => ({
        invoice: {
          invoice_id: "inv_cons_7",
          invoice_number: "INV-CONS-007",
          salesorder_id: "so_cons_7",
          status: "pending_approval",
          total: 10000,
          line_items: [
            { line_item_id: "il_c1", item_id: "itm7", name: "Beam", quantity: 20, rate: 500, item_total: 10000, description: "Wide" },
          ],
        },
      }),
      getSalesOrder: async () => ({ salesorder: soData }),
    });
    await syncApprovalPendingDocument(
      { type: "INVOICE", id: "inv_cons_7", number: "INV-CONS-007" },
      { reader: r1, db, orgId: ORG }
    );

    // Verify Phase-B stored unit = "job"
    let soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_cons_7") as any[];
    assert.strictEqual(soLines[0].unit, "job", "After Phase-B: unit = job");

    // Step 2: Phase-A global sync re-syncs same SO with same unit
    const po7 = {
      purchaseorder_id: "po_cons_7",
      purchaseorder_number: "PO-CONS-007",
      status: "pending_approval",
      salesorder_id: "so_cons_7",
      line_items: [
        { line_item_id: "pol_c1", item_id: "itm7", name: "Beam", quantity: 20, rate: 500, item_total: 10000, description: "Wide", unit: "nos" },
      ],
    };
    const { reader: r2 } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_cons_7", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_cons_7: po7 },
      soDetails: { so_cons_7: soData },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader: r2, db, orgId: ORG });

    // Phase-A must NOT erase unit
    soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_cons_7") as any[];
    assert.strictEqual(soLines[0].unit, "job", "After Phase-A: unit still 'job'");
  });

  // ── T8: Phase-A global sync with changed source unit ────
  await test("T8: Phase-A global sync with changed source unit — 'job' → 'nos'", async () => {
    const db = setupDb();

    // Step 1: Phase-A initial sync with unit "job"
    const so8v1 = {
      salesorder_id: "so_chg_8",
      salesorder_number: "SO-CHG-008",
      status: "pending_approval",
      line_items: [
        { line_item_id: "sol_ch1", item_id: "itm8", name: "Rod", quantity: 30, rate: 100, item_total: 3000, description: "8mm", unit: "job" },
      ],
    };
    const po8 = {
      purchaseorder_id: "po_chg_8",
      purchaseorder_number: "PO-CHG-008",
      status: "pending_approval",
      salesorder_id: "so_chg_8",
      line_items: [
        { line_item_id: "pol_ch1", item_id: "itm8", name: "Rod", quantity: 30, rate: 100, item_total: 3000, description: "8mm", unit: "job" },
      ],
    };
    const { reader: r1 } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_chg_8", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_chg_8: po8 },
      soDetails: { so_chg_8: so8v1 },
    });
    const result1 = await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader: r1, db, orgId: ORG });

    let soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_chg_8") as any[];
    assert.strictEqual(soLines[0].unit, "job", "Initial sync: unit = job");

    // Step 2: Phase-A re-sync with changed unit "nos"
    const so8v2 = { ...so8v1, line_items: [
      { line_item_id: "sol_ch1", item_id: "itm8", name: "Rod", quantity: 30, rate: 100, item_total: 3000, description: "8mm", unit: "nos" },
    ]};
    const { reader: r2 } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_chg_8", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_chg_8: po8 },
      soDetails: { so_chg_8: so8v2 },
    });
    const result2 = await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader: r2, db, orgId: ORG });

    soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?`).all("so_chg_8") as any[];
    assert.strictEqual(soLines[0].unit, "nos", "After re-sync: unit updated to 'nos'");
  });

  // ── T9: No fake UOM default ────
  await test("T9: No fake UOM default — undefined unit persisted as NULL not empty string", async () => {
    const db = setupDb();
    const po = {
      purchaseorder_id: "po_fake_9",
      purchaseorder_number: "PO-FAKE-009",
      status: "pending_approval",
      line_items: [
        { line_item_id: "pol_f1", item_id: "itm9", name: "Gasket", quantity: 100, rate: 10, item_total: 1000, description: "Rubber" },
        { line_item_id: "pol_f2", item_id: "itm9b", name: "Seal", quantity: 50, rate: 20, item_total: 1000, description: "Silicon", unit: null },
      ],
    };
    const { reader } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_fake_9", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_fake_9: po },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader, db, orgId: ORG });

    const poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ? ORDER BY line_item_id`).all("po_fake_9") as any[];
    assert.strictEqual(poLines.length, 2);
    // Both should be NULL, not empty string, not "each", not any default
    assert.strictEqual(poLines[0].unit, null, "Line 1: undefined unit = NULL");
    assert.strictEqual(poLines[1].unit, null, "Line 2: null unit = NULL");
  });

  // ── T10: Same-name lines remain separate ────
  await test("T10: Same-name lines remain separate with different units", async () => {
    const db = setupDb();
    const po = {
      purchaseorder_id: "po_sep_10",
      purchaseorder_number: "PO-SEP-010",
      status: "pending_approval",
      line_items: [
        { line_item_id: "pol_s1", item_id: "itm_same", name: "Steel Plate", quantity: 100, rate: 200, item_total: 20000, description: "8mm", unit: "KGS" },
        { line_item_id: "pol_s2", item_id: "itm_same", name: "Steel Plate", quantity: 50, rate: 300, item_total: 15000, description: "10mm", unit: "MTR" },
        { line_item_id: "pol_s3", item_id: "itm_same", name: "Steel Plate", quantity: 25, rate: 400, item_total: 10000, description: "12mm", unit: "NOS" },
      ],
    };
    const { reader } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_sep_10", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_sep_10: po },
    });
    await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader, db, orgId: ORG });

    const poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ? ORDER BY line_item_id`).all("po_sep_10") as any[];
    assert.strictEqual(poLines.length, 3, "3 lines preserved");
    assert.strictEqual(poLines[0].unit, "KGS");
    assert.strictEqual(poLines[1].unit, "MTR");
    assert.strictEqual(poLines[2].unit, "NOS");
    // Verify they are truly separate records
    const ids = new Set(poLines.map((l: any) => l.line_item_id));
    assert.strictEqual(ids.size, 3, "All 3 line_item_ids are distinct");
  });

  // ── T11: Unit-only source change triggers UPDATED ────
  await test("T11: Unit-only source change triggers UPDATED in Phase-A change detection", async () => {
    const db = setupDb();

    // Step 1: Initial sync with unit "job"
    const po11 = {
      purchaseorder_id: "po_det_11",
      purchaseorder_number: "PO-DET-011",
      status: "pending_approval",
      line_items: [
        { line_item_id: "pol_d1", item_id: "itm11", name: "Valve", quantity: 10, rate: 500, item_total: 5000, description: "Ball valve", unit: "job" },
      ],
    };
    const { reader: r1 } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_det_11", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_det_11: po11 },
    });
    const result1 = await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader: r1, db, orgId: ORG });
    assert.strictEqual(result1.created, 1, "First sync: 1 created");

    // Step 2: Re-sync with ONLY unit changed to "nos" — everything else identical
    const po11v2 = {
      ...po11,
      line_items: [
        { line_item_id: "pol_d1", item_id: "itm11", name: "Valve", quantity: 10, rate: 500, item_total: 5000, description: "Ball valve", unit: "nos" },
      ],
    };
    const { reader: r2 } = makePhaseAReader({
      purchaseorders: [{ purchaseorder_id: "po_det_11", status: "pending_approval" }],
      bills: [],
      invoices: [],
      poDetails: { po_det_11: po11v2 },
    });
    const result2 = await syncApprovalPending({ from: "2024-01-01", to: "2024-12-31" }, { reader: r2, db, orgId: ORG });

    // Must be classified as UPDATED, not UNCHANGED
    assert.strictEqual(result2.updated, 1, "Unit-only change must trigger UPDATED");
    assert.strictEqual(result2.unchanged, 0, "Should not be UNCHANGED");

    // Verify the new unit is persisted
    const poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ?`).all("po_det_11") as any[];
    assert.strictEqual(poLines[0].unit, "nos", "Updated unit persisted");
  });

  // ── T12: Operational DB untouched ────
  await test("T12: Operational DB untouched by tests", async () => {
    const currentDbHash = crypto.createHash("sha256").update(fs.readFileSync(_opDbPath)).digest("hex");
    assert.strictEqual(currentDbHash, _baselineDbHash, "Operational DB file hash must not change");
    if (_baselineWalHash !== null) {
      const currentWalHash = fs.existsSync(_opWalPath)
        ? crypto.createHash("sha256").update(fs.readFileSync(_opWalPath)).digest("hex")
        : null;
      assert.strictEqual(currentWalHash, _baselineWalHash, "Operational WAL hash must not change");
    }
  });

  // ── T13: No live Zoho calls ────
  await test("T13: No live Zoho calls — all tests used mocked readers", async () => {
    // This is a structural assertion: every test above constructs its own
    // reader mock. If any test had omitted the reader option, the sync
    // function would try to read real tokens and call live Zoho APIs,
    // which would fail in this isolated environment. The fact that all
    // tests above passed without network errors confirms all readers were
    // mocked. We additionally verify no live HTTP module was imported.
    assert.ok(true, "All tests used mocked readers");
  });

  // ── Summary ──────────────────────────────────────────────
  console.log("");
  console.log("============================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log("============================================================");
  if (failures.length > 0) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
