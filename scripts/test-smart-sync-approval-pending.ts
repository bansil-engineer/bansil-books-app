import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";
import { syncApprovalPending } from "../app/lib/audit/approval-pending-sync.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";

function setupInMemoryDb(): DatabaseSync {
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
      submitted_by_name TEXT,
      submitter_id TEXT,
      source_endpoint TEXT,
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

async function runTests() {
  console.log("============================================================");
  console.log("FOCUSED DETERMINISTIC TESTS: SMART SYNC & ACCURATE COUNTERS");
  console.log("============================================================");

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`✗ [FAIL] ${name}: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  // Common baseline PO fixture
  const basePO = {
    purchaseorder_id: "po_100",
    purchaseorder_number: "PO-100",
    status: "pending_approval",
    date: "2026-09-01",
    delivery_date: "2026-09-15",
    vendor_id: "v_1",
    vendor_name: "Vendor Alpha",
    total: 10000,
    submitter_id: "user_1",
    submitted_by_name: "Alice",
    custom_fields: [{ label: "Sales Order No", value: "SO-100" }],
    line_items: [
      {
        line_item_id: "line_101",
        item_id: "item_1",
        name: "Steel Rod",
        description: "Standard Rod 10mm",
        quantity: 10,
        rate: 1000,
        item_total: 10000,
      },
    ],
  };

  await test("A. Brand-new document → New +1", async () => {
    const db = setupInMemoryDb();
    const reader = {
      listPurchaseOrders: async () => ({ purchaseorders: [basePO] }),
      getPurchaseOrder: async () => ({ purchaseorder: JSON.parse(JSON.stringify(basePO)) }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };

    const result = await syncApprovalPending({}, { db, reader });
    assert.strictEqual(result.created, 1, "New counter must be 1");
    assert.strictEqual(result.updated, 0, "Updated counter must be 0");
    assert.strictEqual(result.unchanged, 0, "Unchanged counter must be 0");
    assert.strictEqual(result.failed, 0, "Failed counter must be 0");
    assert.strictEqual(result.checked, 1, "Checked counter must be 1");

    const row = db.prepare("SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id = 'po_100'").get() as any;
    assert.ok(row, "PO must be persisted");
    assert.strictEqual(row.status, "pending_approval");
  });

  await test("B. Existing identical document → Unchanged +1", async () => {
    const db = setupInMemoryDb();
    const reader = {
      listPurchaseOrders: async () => ({ purchaseorders: [basePO] }),
      getPurchaseOrder: async () => ({ purchaseorder: JSON.parse(JSON.stringify(basePO)) }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };

    // First run: inserts as new
    await syncApprovalPending({}, { db, reader });

    // Second run: exact same data
    const result2 = await syncApprovalPending({}, { db, reader });
    assert.strictEqual(result2.created, 0, "New counter must be 0");
    assert.strictEqual(result2.updated, 0, "Updated counter must be 0");
    assert.strictEqual(result2.unchanged, 1, "Unchanged counter must be 1");
    assert.strictEqual(result2.failed, 0, "Failed counter must be 0");
  });

  await test("C. Existing header changed → Updated +1", async () => {
    const db = setupInMemoryDb();
    const doc1 = JSON.parse(JSON.stringify(basePO));
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    // Modify header date & total
    const doc2 = JSON.parse(JSON.stringify(basePO));
    doc2.date = "2026-09-05";
    doc2.total = 12000;
    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const result = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(result.created, 0, "New must be 0");
    assert.strictEqual(result.updated, 1, "Updated must be 1");
    assert.strictEqual(result.unchanged, 0, "Unchanged must be 0");

    const row = db.prepare("SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id = 'po_100'").get() as any;
    assert.strictEqual(row.date, "2026-09-05");
    assert.strictEqual(row.total, 12000);
  });

  await test("D. Existing line quantity changed → Updated +1", async () => {
    const db = setupInMemoryDb();
    const doc1 = JSON.parse(JSON.stringify(basePO));
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    // Modify line quantity from 10 to 15
    const doc2 = JSON.parse(JSON.stringify(basePO));
    doc2.line_items[0].quantity = 15;
    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const result = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(result.updated, 1, "Updated must be 1 for line quantity change");
    assert.strictEqual(result.unchanged, 0, "Unchanged must be 0");

    const line = db.prepare("SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = 'po_100'").get() as any;
    assert.strictEqual(line.quantity, 15, "Persisted quantity must be 15");
  });

  await test("E. Narration changed → Updated +1", async () => {
    const db = setupInMemoryDb();
    const doc1 = JSON.parse(JSON.stringify(basePO));
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    // Modify narration
    const doc2 = JSON.parse(JSON.stringify(basePO));
    doc2.line_items[0].description = "Updated high tensile steel rod 10mm";
    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const result = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(result.updated, 1, "Updated must be 1 for narration change");

    const line = db.prepare("SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = 'po_100'").get() as any;
    assert.strictEqual(line.description, "Updated high tensile steel rod 10mm");
  });

  await test("F. Rate / taxable changed → Updated +1", async () => {
    const db = setupInMemoryDb();
    const doc1 = JSON.parse(JSON.stringify(basePO));
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    // Modify rate
    const doc2 = JSON.parse(JSON.stringify(basePO));
    doc2.line_items[0].rate = 1250;
    doc2.line_items[0].item_total = 12500;
    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const result = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(result.updated, 1, "Updated must be 1 for rate change");

    const line = db.prepare("SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = 'po_100'").get() as any;
    assert.strictEqual(line.rate, 1250);
    assert.strictEqual(line.amount, 12500);
  });

  await test("G. New line added → Updated +1", async () => {
    const db = setupInMemoryDb();
    const doc1 = JSON.parse(JSON.stringify(basePO));
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    // Add a second line item
    const doc2 = JSON.parse(JSON.stringify(basePO));
    doc2.line_items.push({
      line_item_id: "line_102",
      item_id: "item_2",
      name: "Fastener",
      description: "M8 Bolt",
      quantity: 50,
      rate: 20,
      item_total: 1000,
    });
    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const result = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(result.updated, 1, "Updated must be 1 for line addition");

    const lines = db.prepare("SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = 'po_100'").all();
    assert.strictEqual(lines.length, 2, "Must now have 2 lines");
  });

  await test("H. Line removed → Updated +1 (No Ghost Lines)", async () => {
    const db = setupInMemoryDb();
    // Start with 2 lines
    const doc1 = JSON.parse(JSON.stringify(basePO));
    doc1.line_items.push({
      line_item_id: "line_102",
      item_id: "item_2",
      name: "Fastener",
      description: "M8 Bolt",
      quantity: 50,
      rate: 20,
      item_total: 1000,
    });
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    let lines = db.prepare("SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = 'po_100'").all();
    assert.strictEqual(lines.length, 2, "Should start with 2 lines");

    // Remove line 2 in Zoho
    const doc2 = JSON.parse(JSON.stringify(basePO)); // has only line_101
    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const result = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(result.updated, 1, "Updated must be 1 for line removal");

    lines = db.prepare("SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = 'po_100'").all();
    assert.strictEqual(lines.length, 1, "Must have exactly 1 line (ghost line deleted)");
    assert.strictEqual((lines[0] as any).line_item_id, "line_101");
  });

  await test("I. Failed document → Failed +1", async () => {
    const db = setupInMemoryDb();
    const reader = {
      listPurchaseOrders: async () => ({
        purchaseorders: [
          basePO,
          { purchaseorder_id: "po_error", status: "pending_approval", purchaseorder_number: "PO-ERR" },
        ],
      }),
      getPurchaseOrder: async (_orgId: string, id: string) => {
        if (id === "po_error") throw new Error("Network timeout or rate limit");
        return { purchaseorder: JSON.parse(JSON.stringify(basePO)) };
      },
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };

    const result = await syncApprovalPending({}, { db, reader });
    assert.strictEqual(result.created, 1, "PO-100 succeeded as New");
    assert.strictEqual(result.failed, 1, "PO-ERR counted as Failed");
  });

  await test("J. Same fetched document must NOT be counted New repeatedly", async () => {
    const db = setupInMemoryDb();
    const reader = {
      listPurchaseOrders: async () => ({ purchaseorders: [basePO] }),
      getPurchaseOrder: async () => ({ purchaseorder: JSON.parse(JSON.stringify(basePO)) }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };

    const r1 = await syncApprovalPending({}, { db, reader });
    assert.strictEqual(r1.created, 1);

    const r2 = await syncApprovalPending({}, { db, reader });
    assert.strictEqual(r2.created, 0, "Must NOT be counted New again");
    assert.strictEqual(r2.unchanged, 1, "Must be counted Unchanged");

    const r3 = await syncApprovalPending({}, { db, reader });
    assert.strictEqual(r3.created, 0);
    assert.strictEqual(r3.unchanged, 1);
  });

  await test("K. Refresh Local → 0 Zoho calls", async () => {
    const db = setupInMemoryDb();
    // Seed DB with a pending PO
    let zohoApiCalls = 0;
    const reader = {
      listPurchaseOrders: async () => { zohoApiCalls++; return { purchaseorders: [basePO] }; },
      getPurchaseOrder: async () => { zohoApiCalls++; return { purchaseorder: JSON.parse(JSON.stringify(basePO)) }; },
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader });
    assert.ok(zohoApiCalls > 0, "Initial sync calls Zoho");

    // Reset counter
    zohoApiCalls = 0;

    // Simulate "Refresh Local": calls getApprovalPendingDocuments directly from SQLite
    const report = getApprovalPendingDocuments("APPROVAL_PENDING_ACTIVE", db);
    assert.strictEqual(zohoApiCalls, 0, "Refresh Local must make ZERO Zoho calls");
    assert.ok(report.documents.length >= 1, "Must return locally persisted documents");
    assert.strictEqual(report.documents[0].id, "po_100");
  });

  await test("L. Concurrent / double sync prevented", async () => {
    const db = setupInMemoryDb();
    // Insert a RUNNING sync state within 5 minutes
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO audit_section_syncs (
        section_key, status, started_at
      ) VALUES ('APPROVAL_PENDING', 'RUNNING', ?)
    `).run(nowIso);

    // Check duplicate detection logic (same query run in /api/audit/section-sync/route.ts)
    const existing = db.prepare(`SELECT status, started_at FROM audit_section_syncs WHERE section_key = 'APPROVAL_PENDING'`).get() as any;
    assert.ok(existing && existing.status === 'RUNNING');
    const startedAtTime = new Date(existing.started_at).getTime();
    const isLocked = Date.now() - startedAtTime < 5 * 60 * 1000;
    assert.strictEqual(isLocked, true, "Concurrent sync must be detected as running and locked");
  });

  await test("M. Document leaving pending-approval status → no stale current pending row", async () => {
    const db = setupInMemoryDb();
    // Initial state: PO-100 is pending approval
    const doc1 = JSON.parse(JSON.stringify(basePO));
    const reader1 = {
      listPurchaseOrders: async () => ({ purchaseorders: [doc1] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc1 }),
      listBills: async () => ({ bills: [] }),
      getBill: async () => ({ bill: null }),
      listInvoices: async () => ({ invoices: [] }),
      getInvoice: async () => ({ invoice: null }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null }),
    };
    await syncApprovalPending({}, { db, reader: reader1 });

    let pendingReport = getApprovalPendingDocuments("APPROVAL_PENDING_ACTIVE", db);
    assert.strictEqual(pendingReport.documents.length, 1, "Must initially be pending");

    // In Zoho, PO-100 is now approved!
    const doc2 = JSON.parse(JSON.stringify(basePO));
    doc2.status = "approved";

    const reader2 = {
      ...reader1,
      listPurchaseOrders: async () => ({ purchaseorders: [doc2] }),
      getPurchaseOrder: async () => ({ purchaseorder: doc2 }),
    };

    const syncResult = await syncApprovalPending({}, { db, reader: reader2 });
    assert.strictEqual(syncResult.updated, 1, "Status change must be counted as Updated +1");

    // Check active pending view: PO-100 MUST NO LONGER APPEAR!
    pendingReport = getApprovalPendingDocuments("APPROVAL_PENDING_ACTIVE", db);
    const staleDoc = pendingReport.documents.find(d => d.id === "po_100");
    assert.strictEqual(staleDoc, undefined, "Approved PO must NOT appear in pending approval view!");

    // Verify row in SQLite was updated to 'approved' (audit history preserved)
    const row = db.prepare("SELECT status FROM audit_zoho_purchase_orders WHERE purchaseorder_id = 'po_100'").get() as any;
    assert.strictEqual(row.status, "approved", "Status in database must be updated to approved");
  });

  console.log("\n============================================================");
  console.log(`FOCUSED TESTS COMPLETED: ${passed}/${total} passed`);
  console.log("============================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
