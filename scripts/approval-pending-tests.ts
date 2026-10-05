import { DatabaseSync } from "node:sqlite";
import * as path from "path";
import * as fs from "fs";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";

const DB_DIR = path.join(process.cwd(), "data");
const AUDIT_DB_FILE = ":memory:";

function setupTestDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new DatabaseSync(AUDIT_DB_FILE);

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
      quantity REAL,
      rate REAL,
      amount REAL,
      PRIMARY KEY (organization_id, line_item_id, source_run_id)
    );
  `);

  const runId = "test_run_" + Date.now();
  db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES (?, 'ORG', 'TEST', ?, ?)`).run(runId, new Date().toISOString(), 'SUCCESS');

  return { db, runId };
}

async function runTests() {
  const { db, runId } = setupTestDb();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) { passed++; console.log(`[PASS] ${msg}`); }
    else { failed++; console.error(`[FAIL] ${msg}`); }
  }

  // Insert SO
  db.exec(`
    INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at)
    VALUES ('ORG', 'so_1', '${runId}', 'SO-001', 'now');
    
    INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, quantity)
    VALUES ('ORG', 'line_1', 'so_1', '${runId}', 'item_1', 10);
    
    INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, quantity)
    VALUES ('ORG', 'line_2', 'so_1', '${runId}', 'item_2', 5);
  `);

  // Test 1: PO pending approval, exact match
  db.exec(`
    INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, status, custom_fields_json, fetched_at)
    VALUES ('ORG', 'po_1', '${runId}', 'pending_approval', '[{"label":"Sales Order No", "value":"SO-001"}]', 'now');
    
    INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity)
    VALUES ('ORG', 'po_line_1', 'po_1', '${runId}', 'item_1', 10);
  `);
  
  let report = getApprovalPendingDocuments(runId, db);
  let doc = report.documents.find(d => d.id === 'po_1');
  assert(doc?.verificationStatus === 'PARTIAL_WITHIN_REFERENCE', 'PO exact match on one line, missing other line (PARTIAL_WITHIN_REFERENCE)');

  // Test 2: PO missing SO reference
  db.exec(`
    INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, status, custom_fields_json, fetched_at)
    VALUES ('ORG', 'po_2', '${runId}', 'pending_approval', '[]', 'now');
  `);
  report = getApprovalPendingDocuments(runId, db);
  doc = report.documents.find(d => d.id === 'po_2');
  assert(doc?.verificationStatus === 'LOCAL_DATA_INCOMPLETE', 'PO with missing SO Ref shows LOCAL_DATA_INCOMPLETE');

  // Test 3: PO qty exceeded
  db.exec(`
    INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, status, custom_fields_json, fetched_at)
    VALUES ('ORG', 'po_3', '${runId}', 'pending_approval', '[{"label":"Sales Order No", "value":"SO-001"}]', 'now');
    
    INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity)
    VALUES ('ORG', 'po_line_3', 'po_3', '${runId}', 'item_1', 11);
  `);
  report = getApprovalPendingDocuments(runId, db);
  doc = report.documents.find(d => d.id === 'po_3');
  assert(doc?.items.find(i => i.itemId === 'item_1')?.mismatchType === 'CUMULATIVE_QTY_EXCEEDED', 'PO exceeding cumulative qty (10 + 11 = 21 > 10)');

  // Test 4: Bill exact match
  db.exec(`
    INSERT INTO audit_zoho_bills (organization_id, bill_id, source_run_id, status, purchaseorder_id, fetched_at)
    VALUES ('ORG', 'bill_1', '${runId}', 'pending_approval', 'po_1', 'now');
    
    INSERT INTO audit_zoho_bill_lines (organization_id, line_item_id, bill_id, source_run_id, item_id, quantity)
    VALUES ('ORG', 'b_line_1', 'bill_1', '${runId}', 'item_1', 10);
  `);
  report = getApprovalPendingDocuments(runId, db);
  doc = report.documents.find(d => d.id === 'bill_1');
  assert(doc?.verificationStatus === 'MATCHED', 'Bill perfectly matching PO qty is MATCHED');

  // Test 5: Invoice missing item
  db.exec(`
    INSERT INTO audit_zoho_invoices (organization_id, invoice_id, source_run_id, status, salesorder_id, fetched_at)
    VALUES ('ORG', 'inv_1', '${runId}', 'pending_approval', 'so_1', 'now');
    
    INSERT INTO audit_zoho_invoice_lines (organization_id, line_item_id, invoice_id, source_run_id, item_id, quantity)
    VALUES ('ORG', 'inv_line_1', 'inv_1', '${runId}', 'item_3', 5);
  `);
  report = getApprovalPendingDocuments(runId, db);
  doc = report.documents.find(d => d.id === 'inv_1');
  assert(doc?.items.find(i => i.itemId === 'item_3')?.mismatchType === 'ITEM_MAPPING_REQUIRED', 'Invoice with extra item shows ITEM_MAPPING_REQUIRED');

  // Test 6: Date filtering
  db.exec(`
    INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, status, date, custom_fields_json, fetched_at)
    VALUES ('ORG', 'po_date_1', '${runId}', 'pending_approval', '2023-01-15', '[{"label":"Sales Order No", "value":"SO-001"}]', 'now');
    
    INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, status, date, custom_fields_json, fetched_at)
    VALUES ('ORG', 'po_date_2', '${runId}', 'pending_approval', '2023-03-20', '[{"label":"Sales Order No", "value":"SO-001"}]', 'now');
  `);
  
  report = getApprovalPendingDocuments(runId, db, '2023-02-01', '2023-04-01');
  assert(!report.documents.find(d => d.id === 'po_date_1'), 'PO before fromDate should be filtered out');
  assert(!!report.documents.find(d => d.id === 'po_date_2'), 'PO within date range should be included');

  // Test 7: Narration and Submitted By (Regression)
  db.exec(`
    INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, status, submitter_id, submitted_by_name, custom_fields_json, fetched_at)
    VALUES ('ORG', 'po_reg_1', '${runId}', 'pending_approval', 'user_123', 'Nirali Chauhan', '[{"label":"Sales Order No", "value":"SO-9999999"}]', 'now');
    
    INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, description, quantity)
    VALUES ('ORG', 'po_reg_line_1', 'po_reg_1', '${runId}', 'item_1', 'Sample Narration with details', 10);
    
    -- Insert reference SO to get MATCHED / PARTIAL status to ensure it's evaluated properly
    INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, status, fetched_at)
    VALUES ('ORG', 'so_reg_1', '${runId}', 'SO-9999999', 'confirmed', 'now');
    
    INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, description, quantity)
    VALUES ('ORG', 'so_reg_line_1', 'so_reg_1', '${runId}', 'item_1', 'Ref Narration', 10);
  `);
  
  // Set up mock user cache or rely on service using submitted_by_name directly from DB
  const cachePath = path.join(DB_DIR, "zoho-users-cache.json");
  if (!fs.existsSync(cachePath)) {
    fs.writeFileSync(cachePath, JSON.stringify({ "user_123": "Nirali Chauhan" }));
  }

  report = getApprovalPendingDocuments(runId, db);
  let regDoc = report.documents.find(d => d.id === 'po_reg_1');
  
  assert(regDoc?.submittedBy === 'Nirali Chauhan', 'PO preserves submittedBy properly (A, B, C, D)');
  
  const regItem = regDoc?.items.find(i => i.itemId === 'item_1');
  if (!regItem) console.log('regDoc items:', JSON.stringify(regDoc?.items, null, 2));
  
  assert(regItem?.narration === 'Sample Narration with details', 'PO line preserves narration properly (A, C, D)');
  assert(regItem?.refNarration === 'Ref Narration', 'Reference line preserves refNarration properly (A, C, D)');

  // Simulate UI refresh bug (E: local refresh re-resolves selected document)
  let selectedDoc: any = { id: 'po_reg_1', submittedBy: 'Old Submitter', items: [{ narration: 'Old Narration' }] };
  
  // DB update
  db.exec(`
    UPDATE audit_zoho_purchase_orders SET submitted_by_name = 'Nirali Chauhan Updated' WHERE purchaseorder_id = 'po_reg_1';
    UPDATE audit_zoho_purchase_order_lines SET description = 'Sample Narration Updated' WHERE line_item_id = 'po_reg_line_1';
  `);
  
  // Refresh data
  const freshReport = getApprovalPendingDocuments(runId, db);
  
  // Re-resolve logic (similar to UI)
  selectedDoc = freshReport.documents.find(d => d.id === selectedDoc.id) || selectedDoc;
  
  assert(selectedDoc.submittedBy === 'Nirali Chauhan Updated', 'UI re-resolves selectedDoc and gets fresh submittedBy (E)');
  assert(selectedDoc.items.find((i: any) => i.itemId === 'item_1').narration === 'Sample Narration Updated', 'UI re-resolves selectedDoc and gets fresh narration (E)');

  console.log(`\nTests completed. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
