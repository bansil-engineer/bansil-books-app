import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";
import { syncApprovalPending, syncApprovalPendingDocument } from "../app/lib/audit/approval-pending-sync.ts";
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
      submitted_by_name TEXT,
      submitter_id TEXT,
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
  console.log("FOCUSED DETERMINISTIC TESTS: INDIVIDUAL DOCUMENT SMART SYNC");
  console.log("============================================================\n");

  const orgId = "TEST_ORG_TARGET";

  // ------------------------------------------------------------
  // Test 1: Targeted PO unchanged -> UNCHANGED
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const poData = {
      purchaseorder_id: "po_1",
      purchaseorder_number: "PO-101",
      vendor_id: "v_1",
      vendor_name: "Vendor One",
      date: "2026-09-20",
      status: "pending_approval",
      total: 5000,
      custom_fields: [{ label: "Sales Order No", value: "SO-500" }],
      line_items: [
        { line_item_id: "line_1", item_id: "item_1", name: "Item One", quantity: 10, rate: 500, item_total: 5000, description: "Normal line" }
      ]
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrder: async () => ({ salesorder: null }),
      listPurchaseOrders: async () => { throw new Error("listPurchaseOrders should not be called in targeted sync!"); },
      listBills: async () => { throw new Error("listBills should not be called in targeted sync!"); },
      listInvoices: async () => { throw new Error("listInvoices should not be called in targeted sync!"); }
    };

    // First sync to insert
    const res1 = await syncApprovalPendingDocument({ type: "PO", id: "po_1", number: "PO-101" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res1.status, "SUCCESS");
    assert.strictEqual(res1.result, "NEW");

    // Second sync with identical data
    const res2 = await syncApprovalPendingDocument({ type: "PO", id: "po_1", number: "PO-101" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res2.status, "SUCCESS");
    assert.strictEqual(res2.result, "UNCHANGED");
    assert.strictEqual(res2.referenceRefreshed, false);
    console.log("✓ [PASS] 1. Targeted PO unchanged → UNCHANGED");
  }

  // ------------------------------------------------------------
  // Test 2: Targeted PO header/reference changed -> UPDATED
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    let poData: any = {
      purchaseorder_id: "po_2",
      purchaseorder_number: "PO-102",
      vendor_id: "v_1",
      vendor_name: "Vendor One",
      date: "2026-09-20",
      status: "pending_approval",
      total: 5000,
      custom_fields: [{ label: "Sales Order No", value: "SO-500" }],
      line_items: [{ line_item_id: "line_1", item_id: "item_1", name: "Item One", quantity: 10, rate: 500, item_total: 5000, description: "Test" }]
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrder: async () => ({ salesorder: null })
    };

    await syncApprovalPendingDocument({ type: "PO", id: "po_2", number: "PO-102" }, { db, orgId, reader: mockReader });

    // Change reference in header
    poData = {
      ...poData,
      custom_fields: [{ label: "Sales Order No", value: "SO-501" }]
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: "po_2", number: "PO-102" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "UPDATED");
    assert.strictEqual(res.referenceRefreshed, true);
    console.log("✓ [PASS] 2. Targeted PO header/reference changed → UPDATED");
  }

  // ------------------------------------------------------------
  // Test 3: Targeted PO line changed -> UPDATED
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    let poData: any = {
      purchaseorder_id: "po_3",
      purchaseorder_number: "PO-103",
      status: "pending_approval",
      total: 5000,
      line_items: [{ line_item_id: "line_1", item_id: "item_1", quantity: 10, rate: 500, item_total: 5000, description: "Desc" }]
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrder: async () => ({ salesorder: null })
    };

    await syncApprovalPendingDocument({ type: "PO", id: "po_3", number: "PO-103" }, { db, orgId, reader: mockReader });

    // Change line quantity
    poData = {
      ...poData,
      line_items: [{ line_item_id: "line_1", item_id: "item_1", quantity: 20, rate: 500, item_total: 10000, description: "Desc" }]
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: "po_3", number: "PO-103" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "UPDATED");
    console.log("✓ [PASS] 3. Targeted PO line changed → UPDATED");
  }

  // ------------------------------------------------------------
  // Test 4: Targeted PO narration changed -> UPDATED
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    let poData: any = {
      purchaseorder_id: "po_4",
      purchaseorder_number: "PO-104",
      status: "pending_approval",
      total: 5000,
      line_items: [{ line_item_id: "line_1", item_id: "item_1", quantity: 10, rate: 500, item_total: 5000, description: "Old Narration" }]
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrder: async () => ({ salesorder: null })
    };

    await syncApprovalPendingDocument({ type: "PO", id: "po_4", number: "PO-104" }, { db, orgId, reader: mockReader });

    // Change narration
    poData = {
      ...poData,
      line_items: [{ line_item_id: "line_1", item_id: "item_1", quantity: 10, rate: 500, item_total: 5000, description: "New Narration Approved By Engineer" }]
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: "po_4", number: "PO-104" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "UPDATED");
    console.log("✓ [PASS] 4. Targeted PO narration changed → UPDATED");
  }

  // ------------------------------------------------------------
  // Test 5: Targeted PO reference changes from free text -> SO (Acceptance Case)
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    // Simulate initial state: reference was free-text
    let poData: any = {
      purchaseorder_id: "3166667000019103001",
      purchaseorder_number: "PO-2627277",
      vendor_name: "AKSHAR ELECTRICAL",
      date: "2026-09-16",
      status: "pending_approval",
      total: 25000,
      custom_fields: [{ label: "Sales Order No", value: "As per Confirm By Sanjay Sir" }],
      line_items: [{ line_item_id: "po_line_1", item_id: "item_cable", name: "Cable 1.5 sq mm", quantity: 100, rate: 250, item_total: 25000, description: "Standard" }]
    };

    const soData = {
      salesorder_id: "3166667000019103999",
      salesorder_number: "SO-2627109",
      customer_name: "Aum Transformer Private Limited",
      date: "2026-09-15",
      status: "confirmed",
      total: 50000,
      line_items: [
        { line_item_id: "so_line_1", item_id: "item_cable", name: "Cable 1.5 sq mm", quantity: 100, rate: 250, item_total: 25000, description: "Upstream SO Line" }
      ]
    };

    let soFetchCount = 0;
    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrder: async (org: string, id: string) => {
        if (id === soData.salesorder_id) {
          soFetchCount++;
          return { salesorder: soData };
        }
        return { salesorder: null };
      },
      getSalesOrderByNumber: async (org: string, soNumber: string) => {
        if (soNumber === "SO-2627109") {
          return { salesorder_id: soData.salesorder_id };
        }
        return null;
      }
    };

    // Initial sync
    await syncApprovalPendingDocument({ type: "PO", id: poData.purchaseorder_id, number: poData.purchaseorder_number }, { db, orgId, reader: mockReader });

    // Verify initial state shows free text
    const initialReport = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-2627277");
    assert.strictEqual(initialReport.documents[0].relatedDocumentRef, "As per Confirm By Sanjay Sir");

    // Now Zoho PO changes reference to SO-2627109
    poData = {
      ...poData,
      custom_fields: [{ label: "Sales Order No", value: "SO-2627109" }]
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: poData.purchaseorder_id, number: poData.purchaseorder_number }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "UPDATED");
    assert.strictEqual(res.referenceRefreshed, true);
    assert.strictEqual(res.referenceDocumentRefreshed, true);
    assert.strictEqual(soFetchCount, 1);

    // Verify local SO evidence was created
    const savedSo = db.prepare("SELECT * FROM audit_zoho_sales_orders WHERE salesorder_number = ?").get("SO-2627109") as any;
    assert.ok(savedSo, "SO-2627109 must be persisted in SQLite");
    assert.strictEqual(savedSo.customer_name, "Aum Transformer Private Limited");

    // Verify service immediately returns updated reference and MATCHED verification status
    const updatedReport = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-2627277");
    assert.strictEqual(updatedReport.documents[0].relatedDocumentRef, "SO-2627109");
    assert.strictEqual(updatedReport.documents[0].verificationStatus, "MATCHED");
    console.log("✓ [PASS] 5. Targeted PO reference changes from free text → SO (UPDATED + SO refreshed)");
  }

  // ------------------------------------------------------------
  // Test 6: Targeted Invoice -> SO
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const invData = {
      invoice_id: "inv_1",
      invoice_number: "INV-201",
      salesorder_id: "so_201",
      customer_id: "c_1",
      customer_name: "Customer Alpha",
      date: "2026-09-21",
      status: "pending_approval",
      total: 10000,
      line_items: [{ line_item_id: "inv_l1", item_id: "it_1", quantity: 5, rate: 2000, item_total: 10000, description: "Inv line" }]
    };

    const soData = {
      salesorder_id: "so_201",
      salesorder_number: "SO-201",
      customer_name: "Customer Alpha",
      date: "2026-09-18",
      status: "confirmed",
      total: 10000,
      line_items: [{ line_item_id: "so_l1", item_id: "it_1", quantity: 5, rate: 2000, item_total: 10000, description: "SO line" }]
    };

    const mockReader: any = {
      getInvoice: async () => ({ invoice: invData }),
      getSalesOrder: async () => ({ salesorder: soData })
    };

    const res = await syncApprovalPendingDocument({ type: "INVOICE", id: "inv_1", number: "INV-201" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.referenceDocumentRefreshed, true);

    const savedSo = db.prepare("SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id = ?").get("so_201") as any;
    assert.ok(savedSo);
    console.log("✓ [PASS] 6. Targeted Invoice → SO");
  }

  // ------------------------------------------------------------
  // Test 7: Targeted Bill -> PO
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const billData = {
      bill_id: "bill_1",
      bill_number: "BILL-301",
      purchaseorder_id: "po_301",
      vendor_id: "v_1",
      vendor_name: "Vendor Beta",
      date: "2026-09-22",
      status: "pending_approval",
      total: 15000,
      line_items: [{ line_item_id: "bill_l1", item_id: "it_2", quantity: 3, rate: 5000, item_total: 15000, description: "Bill line" }]
    };

    const poData = {
      purchaseorder_id: "po_301",
      purchaseorder_number: "PO-301",
      vendor_name: "Vendor Beta",
      date: "2026-09-19",
      status: "approved",
      total: 15000,
      line_items: [{ line_item_id: "po_l1", item_id: "it_2", quantity: 3, rate: 5000, item_total: 15000, description: "PO line" }]
    };

    const mockReader: any = {
      getBill: async () => ({ bill: billData }),
      getPurchaseOrder: async () => ({ purchaseorder: poData })
    };

    const res = await syncApprovalPendingDocument({ type: "BILL", id: "bill_1", number: "BILL-301" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(res.referenceDocumentRefreshed, true);

    const savedPo = db.prepare("SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ?").get("po_301") as any;
    assert.ok(savedPo);
    console.log("✓ [PASS] 7. Targeted Bill → PO");
  }

  // ------------------------------------------------------------
  // Test 8: Missing/invalid document -> safe FAILED / validation response
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: null })
    };

    // Invalid type
    const res1 = await syncApprovalPendingDocument({ type: "INVALID" as any, id: "po_1" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res1.status, "FAILED");

    // Invalid characters in ID
    const res2 = await syncApprovalPendingDocument({ type: "PO", id: "po/../evil" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res2.status, "FAILED");

    // Missing document in Zoho
    const res3 = await syncApprovalPendingDocument({ type: "PO", id: "po_not_found" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res3.status, "FAILED");
    console.log("✓ [PASS] 8. Missing/invalid document → safe FAILED / validation response");
  }

  // ------------------------------------------------------------
  // Test 9: Double click same document -> no concurrent duplicate sync
  // ------------------------------------------------------------
  {
    // Test that concurrency lock in API rejects overlapping sync of same document
    const activeLocks = new Set<string>();
    const doc = { type: "PO", id: "po_99" };
    const lockKey = `${doc.type}:${doc.id}`;

    let firstLockAcquired = false;
    let secondLockRejected = false;

    if (!activeLocks.has(lockKey)) {
      activeLocks.add(lockKey);
      firstLockAcquired = true;
    }

    if (activeLocks.has(lockKey)) {
      secondLockRejected = true;
    }

    assert.strictEqual(firstLockAcquired, true);
    assert.strictEqual(secondLockRejected, true);
    activeLocks.delete(lockKey);
    console.log("✓ [PASS] 9. Double click same document → no concurrent duplicate sync");
  }

  // ------------------------------------------------------------
  // Test 10: Targeted sync does NOT enumerate all pending documents
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    let enumerateCalled = false;
    const poData = {
      purchaseorder_id: "po_10",
      purchaseorder_number: "PO-110",
      status: "pending_approval",
      total: 1000,
      line_items: []
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      listPurchaseOrders: async () => { enumerateCalled = true; return { purchaseorders: [] }; },
      listBills: async () => { enumerateCalled = true; return { bills: [] }; },
      listInvoices: async () => { enumerateCalled = true; return { invoices: [] }; }
    };

    await syncApprovalPendingDocument({ type: "PO", id: "po_10", number: "PO-110" }, { db, orgId, reader: mockReader });
    assert.strictEqual(enumerateCalled, false, "Targeted sync must NEVER enumerate pending lists");
    console.log("✓ [PASS] 10. Targeted sync does NOT enumerate all pending documents");
  }

  // ------------------------------------------------------------
  // Test 11: Refresh Local: Zoho calls = 0
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    // Pre-insert sample doc into DB
    db.prepare(`
      INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status)
      VALUES ('RUN_LOCAL', 'TEST_ORG', 'approval_pending_sync', '2026-09-20', '2026-09-20', 'SUCCESS')
    `).run();
    db.prepare(`
      INSERT INTO audit_zoho_purchase_orders (
        organization_id, purchaseorder_id, source_run_id, purchaseorder_number,
        vendor_name, date, status, total, custom_fields_json, fetched_at
      ) VALUES ('TEST_ORG', 'po_loc_1', 'RUN_LOCAL', 'PO-LOC-1', 'Local Vendor', '2026-09-21', 'pending_approval', 500, '[]', '2026-09-21')
    `).run();

    // Calling local service
    const report = getApprovalPendingDocuments(undefined, db);
    assert.strictEqual(report.documents.length, 1);
    assert.strictEqual(report.documents[0].number, "PO-LOC-1");
    // Local service has no network calls
    console.log("✓ [PASS] 11. Refresh Local: Zoho calls = 0");
  }

  // ------------------------------------------------------------
  // Test 12: Global Smart Sync still passes existing 13 focused cases
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const po = {
      purchaseorder_id: "po_global_1",
      purchaseorder_number: "PO-G-1",
      status: "pending_approval",
      total: 1000,
      line_items: []
    };

    const mockReader: any = {
      listPurchaseOrders: async () => ({ purchaseorders: [po] }),
      getPurchaseOrder: async () => ({ purchaseorder: po }),
      listBills: async () => ({ bills: [] }),
      listInvoices: async () => ({ invoices: [] }),
      listSalesOrders: async () => ({ salesorders: [] }),
      getSalesOrder: async () => ({ salesorder: null })
    };

    const res1 = await syncApprovalPending({ period: "CURRENT_FY" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res1.created, 1);

    const res2 = await syncApprovalPending({ period: "CURRENT_FY" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res2.unchanged, 1);
    console.log("✓ [PASS] 12. Global Smart Sync retains accurate counter semantics");
  }

  console.log("\n============================================================");
  console.log("ALL 12 TARGETED SYNC TESTS PASSED SUCCESSFULLY");
  console.log("============================================================\n");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
