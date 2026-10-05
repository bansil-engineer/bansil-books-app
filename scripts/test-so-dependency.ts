import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";
import { syncApprovalPendingDocument } from "../app/lib/audit/approval-pending-sync.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";
import { normalizeSoReference, resolveUniqueSalesOrder, buildGlobalSoLookup } from "../app/lib/audit/so-po-mapping.ts";

function setupInMemoryDb(): any {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_zoho_source_runs (
      source_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      api_domain TEXT,
      records_seen INTEGER DEFAULT 0,
      records_written INTEGER DEFAULT 0
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
      reference_number TEXT,
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
      submitted_by_name TEXT,
      submitter_id TEXT,
      source_endpoint TEXT,
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
      currency_code TEXT,
      total REAL,
      balance REAL,
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
  `);
  return db;
}

async function runTests() {
  console.log("============================================================");
  console.log("FOCUSED DETERMINISTIC TESTS: SO DEPENDENCY RESOLUTION");
  console.log("============================================================");

  const orgId = "774390949";

  // ------------------------------------------------------------
  // Test 1: PO custom field changes to SO number; SO already local → resolves
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    // Seed local SO
    db.prepare(`
      INSERT INTO audit_zoho_sales_orders (
        organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_name, date, status, total, fetched_at
      ) VALUES (?, 'so_loc_1', 'ACTIVE', 'SO-2627109', 'Aum Transformer', '2026-09-20', 'confirmed', 50000, '2026-09-20T10:00:00Z')
    `).run(orgId);

    db.prepare(`
      INSERT INTO audit_zoho_sales_order_lines (
        organization_id, line_item_id, salesorder_id, source_run_id,
        item_id, item_name, quantity, rate, amount
      ) VALUES (?, 'sol_1', 'so_loc_1', 'ACTIVE', 'item_1', 'Transformer Part', 10, 5000, 50000)
    `).run(orgId);

    const poData = {
      purchaseorder_id: "po_1",
      purchaseorder_number: "PO-2627277",
      vendor_name: "AKSHAR ELECTRICAL",
      date: "2026-09-21",
      status: "pending_approval",
      total: 50000,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-2627109" }],
      line_items: [{ line_item_id: "pol_1", item_id: "item_1", name: "Transformer Part", quantity: 10, rate: 5000, item_total: 50000 }]
    };

    let soApiCalled = false;
    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrderByNumber: async () => { soApiCalled = true; return null; },
      getSalesOrder: async () => ({ salesorder: null })
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: "po_1", number: "PO-2627277" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(soApiCalled, false, "Local SO should resolve without calling Zoho API");

    const report = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-2627277");
    assert.strictEqual(report.documents[0].relatedDocumentRef, "SO-2627109");
    assert.strictEqual(report.documents[0].verificationStatus, "MATCHED");
    console.log("✓ [PASS] 1. PO custom field changes to SO number; SO already local → resolves (0 Zoho calls)");
  }

  // ------------------------------------------------------------
  // Test 2: PO references SO absent locally but lookup returns exact SO → fetch/persist/resolve
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const poData = {
      purchaseorder_id: "po_1",
      purchaseorder_number: "PO-2627277",
      vendor_name: "AKSHAR ELECTRICAL",
      date: "2026-09-21",
      status: "pending_approval",
      total: 4074.54,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-2627109" }],
      line_items: [{ line_item_id: "pol_1", item_id: "3166667000000107051", name: "ELECTRICAL, INSTALLATION, ERECTION & TESTING", quantity: 1, rate: 3453, item_total: 3453 }]
    };

    const soDetailFromZoho = {
      salesorder_id: "3166667000019369097",
      salesorder_number: "SO-2627109",
      customer_name: "AUM TRANSFORMERS PRIVATE LIMITED",
      date: "2026-09-21",
      status: "draft",
      total: 4074.54,
      line_items: [
        {
          line_item_id: "3166667000019369100",
          item_id: "3166667000000107051",
          name: "ELECTRICAL, INSTALLATION, ERECTION & TESTING",
          quantity: 1,
          rate: 3453,
          item_total: 3453,
          description: "As per the attached\nAnnexure - I"
        }
      ]
    };

    let lookupCount = 0;
    let detailCount = 0;
    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrderByNumber: async (org: string, num: string) => {
        lookupCount++;
        if (num === "SO-2627109") {
          return { salesorder: soDetailFromZoho, salesorder_id: soDetailFromZoho.salesorder_id };
        }
        return { salesorder: null, salesorder_id: null };
      },
      getSalesOrder: async (org: string, id: string) => {
        detailCount++;
        if (id === soDetailFromZoho.salesorder_id) {
          return { salesorder: soDetailFromZoho };
        }
        return { salesorder: null };
      }
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: "po_1", number: "PO-2627277" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(res.referenceDocumentRefreshed, true);
    assert.strictEqual(lookupCount, 1);
    assert.strictEqual(detailCount, 1);

    // Verify SO was persisted into local SQLite
    const savedSo = db.prepare("SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id = ?").get("3166667000019369097") as any;
    assert.ok(savedSo, "SO must be persisted in SQLite");
    assert.strictEqual(savedSo.salesorder_number, "SO-2627109");
    assert.strictEqual(savedSo.customer_name, "AUM TRANSFORMERS PRIVATE LIMITED");

    const savedLines = db.prepare("SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ?").all("3166667000019369097") as any[];
    assert.strictEqual(savedLines.length, 1);
    assert.strictEqual(savedLines[0].rate, 3453);

    // Verify Approval Pending resolves to MATCHED
    const report = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-2627277");
    assert.strictEqual(report.documents[0].relatedDocumentRef, "SO-2627109");
    assert.strictEqual(report.documents[0].referenceCustomer, "AUM TRANSFORMERS PRIVATE LIMITED");
    assert.strictEqual(report.documents[0].verificationStatus, "MATCHED");
    console.log("✓ [PASS] 2. PO references SO absent locally but lookup returns exact SO → fetch/persist/resolve");
  }

  // ------------------------------------------------------------
  // Test 3: Lookup returns no SO → SO_REFERENCE_NOT_FOUND
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const poData = {
      purchaseorder_id: "po_nonexistent",
      purchaseorder_number: "PO-9999999",
      vendor_name: "TEST VENDOR",
      date: "2026-09-21",
      status: "pending_approval",
      total: 1000,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-9999999" }],
      line_items: [{ line_item_id: "pol_1", item_id: "item_x", quantity: 1, rate: 1000, item_total: 1000 }]
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrderByNumber: async () => ({ salesorder: null, salesorder_id: null }),
      getSalesOrder: async () => ({ salesorder: null })
    };

    const res = await syncApprovalPendingDocument({ type: "PO", id: "po_nonexistent", number: "PO-9999999" }, { db, orgId, reader: mockReader });
    assert.strictEqual(res.result, "NEW");
    assert.strictEqual(res.referenceDocumentRefreshed, false);

    const report = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-9999999");
    assert.strictEqual(report.documents[0].verificationStatus, "SO_REFERENCE_NOT_FOUND");
    console.log("✓ [PASS] 3. Lookup returns no SO → SO_REFERENCE_NOT_FOUND");
  }

  // ------------------------------------------------------------
  // Test 4: Duplicate normalized SO → AMBIGUOUS_SO_REFERENCE
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    // Seed two different SOs that normalize to the same 7 digits:
    db.prepare(`
      INSERT INTO audit_zoho_sales_orders (
        organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_name, date, status, total, fetched_at
      ) VALUES
      (?, 'so_a', 'ACTIVE', 'SO-2627109', 'Customer A', '2026-09-20', 'confirmed', 5000, '2026-09-20T10:00:00Z'),
      (?, 'so_b', 'ACTIVE', 'EST-2627109', 'Customer B', '2026-09-20', 'confirmed', 5000, '2026-09-20T10:00:00Z')
    `).run(orgId, orgId);

    const lookup = buildGlobalSoLookup(db);
    const resolution = resolveUniqueSalesOrder(lookup, "SO-2627109");
    assert.strictEqual(resolution.status, "AMBIGUOUS_SO_REFERENCE");
    console.log("✓ [PASS] 4. Duplicate normalized SO → AMBIGUOUS_SO_REFERENCE");
  }

  // ------------------------------------------------------------
  // Test 5: Organization/source snapshot mismatch → newest coherent SO selected safely
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    // Seed older SO snapshot with empty org, newer snapshot with actual org
    db.prepare(`
      INSERT INTO audit_zoho_sales_orders (
        organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_name, date, status, total, fetched_at
      ) VALUES
      ('', 'so_id_1', 'OLD_RUN', 'SO-2627109', 'Old Customer', '2026-09-10', 'draft', 1000, '2026-09-10T10:00:00Z'),
      (?, 'so_id_1', 'NEW_RUN', 'SO-2627109', 'New Correct Customer', '2026-09-21', 'confirmed', 5000, '2026-09-21T10:00:00Z')
    `).run(orgId);

    const lookup = buildGlobalSoLookup(db);
    const resolution = resolveUniqueSalesOrder(lookup, "SO-2627109");
    assert.strictEqual(resolution.status, "MATCH");
    assert.strictEqual(resolution.so.customer_name, "New Correct Customer");
    assert.strictEqual(resolution.so.organization_id, orgId);
    console.log("✓ [PASS] 5. Organization/source snapshot mismatch → newest coherent SO selected safely");
  }

  // ------------------------------------------------------------
  // Test 6: Native PO Ref# differs from Sales Order custom field → provenance preserved
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    const poData = {
      purchaseorder_id: "po_prov",
      purchaseorder_number: "PO-2627277",
      vendor_name: "AKSHAR ELECTRICAL",
      reference_number: "As per rate confirmation by Sanjay Sir",
      date: "2026-09-21",
      status: "pending_approval",
      total: 50000,
      custom_fields: [{ api_name: "cf_sales_order_no", label: "Sales Order No", value: "SO-2627109" }],
      line_items: [{ line_item_id: "pol_1", item_id: "item_1", name: "Transformer Part", quantity: 10, rate: 5000, item_total: 50000 }]
    };

    const mockReader: any = {
      getPurchaseOrder: async () => ({ purchaseorder: poData }),
      getSalesOrderByNumber: async () => ({ salesorder: null, salesorder_id: null }),
      getSalesOrder: async () => ({ salesorder: null })
    };

    await syncApprovalPendingDocument({ type: "PO", id: "po_prov", number: "PO-2627277" }, { db, orgId, reader: mockReader });

    const poRow = db.prepare("SELECT reference_number, custom_fields_json FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ?").get("po_prov") as any;
    assert.strictEqual(poRow.reference_number, "As per rate confirmation by Sanjay Sir");
    assert.ok(poRow.custom_fields_json.includes("SO-2627109"));

    const report = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-2627277");
    assert.strictEqual(report.documents[0].relatedDocumentRef, "SO-2627109");
    assert.strictEqual(report.documents[0].nativeReferenceNumber, "As per rate confirmation by Sanjay Sir");
    console.log("✓ [PASS] 6. Native PO Ref# differs from Sales Order custom field → provenance preserved");
  }

  // ------------------------------------------------------------
  // Test 7: No global pending enumeration during targeted dependency refresh
  // ------------------------------------------------------------
  {
    const db = setupInMemoryDb();
    let listPosCalled = false;
    let listBillsCalled = false;
    let listInvoicesCalled = false;

    const mockReader: any = {
      getPurchaseOrder: async () => ({
        purchaseorder: {
          purchaseorder_id: "po_single",
          purchaseorder_number: "PO-SINGLE",
          vendor_name: "Vendor",
          status: "pending_approval",
          date: "2026-09-21",
          total: 100,
          custom_fields: []
        }
      }),
      listPurchaseOrders: async () => { listPosCalled = true; return { purchaseorders: [] }; },
      listBills: async () => { listBillsCalled = true; return { bills: [] }; },
      listInvoices: async () => { listInvoicesCalled = true; return { invoices: [] }; }
    };

    await syncApprovalPendingDocument({ type: "PO", id: "po_single", number: "PO-SINGLE" }, { db, orgId, reader: mockReader });

    assert.strictEqual(listPosCalled, false, "listPurchaseOrders must not be called during targeted sync");
    assert.strictEqual(listBillsCalled, false, "listBills must not be called during targeted sync");
    assert.strictEqual(listInvoicesCalled, false, "listInvoices must not be called during targeted sync");
    console.log("✓ [PASS] 7. No global pending enumeration during targeted dependency refresh (0 listing calls)");
  }

  console.log("============================================================");
  console.log("ALL 7 SO DEPENDENCY TESTS PASSED SUCCESSFULLY");
  console.log("============================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
