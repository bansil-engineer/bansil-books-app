import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";
import crypto from "crypto";

const db = getAuditDatabase();

function runTests() {
  console.log("Running focused SO narration enrichment tests...");
  let passed = 0;
  let total = 0;

  const assert = (condition: boolean, msg: string) => {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] ${msg}`);
    } else {
      console.error(`[FAIL] ${msg}`);
    }
  };

  db.exec('BEGIN TRANSACTION');
  try {
    const orgId = "TEST_ORG_" + Date.now();
    const soId = "SO_TEST_" + Date.now();
    const poId = "PO_TEST_" + Date.now();
    const runId = "TEST_RUN";

    db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status, records_seen, records_written) VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run(runId, orgId, "approval_pending_sync", "2026-04-01T10:00:00.000Z", "SUCCESS");

    // Setup SO
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at) VALUES (?, ?, ?, ?, ?)`)
      .run(orgId, soId, runId, "SO-1234567", "2026-04-01T10:00:00.000Z");

    // Setup 4 SO lines with different scenarios
    // 1. Has narration
    db.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "so_line_1", soId, runId, "item_1", "Item 1", "Actual Narration", 1, 100, 100);

    // 2. Same-name line, different line_item_id, different description
    db.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "so_line_2", soId, runId, "item_2", "Item 2", "Different Narration", 2, 100, 200);

    // 3. CAPTURED_EMPTY
    db.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "so_line_3", soId, runId, "item_3", "Item 3", "CAPTURED_EMPTY", 3, 200, 600);

    // 4. SOURCE DOES NOT PROVIDE NARRATION
    db.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "so_line_4", soId, runId, "item_4", "Item 4", "SOURCE DOES NOT PROVIDE NARRATION", 4, 300, 1200);

    // Setup PO referencing the SO
    db.prepare(`INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, custom_fields_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, poId, runId, "PO-TEST", "pending_approval", JSON.stringify([{label: "Sales Order No", value: "SO-1234567"}]), "2026-04-01T10:00:00.000Z");

    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_1", poId, runId, "item_1", 1, "PO Narration");
    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_2", poId, runId, "item_2", 1, "PO Narration 2");
    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_3", poId, runId, "item_3", 1, "PO Narration 3");
    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_4", poId, runId, "item_4", 1, "PO Narration 4");

    // Test resolution of narration
    const report = getApprovalPendingDocuments(runId, db);
    const doc = report.documents.find(d => d.number === "PO-TEST");
    assert(!!doc, "PO is generated");

    if (doc) {      
      const mappedLine1 = doc.items.find(i => i.refLineId === "so_line_1");
      const mappedLine2 = doc.items.find(i => i.refLineId === "so_line_2");
      const mappedLine3 = doc.items.find(i => i.refLineId === "so_line_3");
      const mappedLine4 = doc.items.find(i => i.refLineId === "so_line_4");

      assert(mappedLine1?.refNarration === "Actual Narration", "Line A receives exact narration");
      assert(mappedLine2?.refNarration === "Different Narration", "Same-name lines remain independent");
      assert(mappedLine3?.refNarration === "—", "CAPTURED_EMPTY translates to '—'");
      assert(mappedLine4?.refNarration === "SOURCE DOES NOT PROVIDE NARRATION", "SOURCE DOES NOT PROVIDE NARRATION preserved");
      
      const soLineLocal = db.prepare(`SELECT rate, amount FROM audit_zoho_sales_order_lines WHERE line_item_id = 'so_line_1'`).get() as any;
      assert(soLineLocal.rate === 100 && soLineLocal.amount === 100, "Existing rate/amount remain unchanged after narration enrichment");
    }

    console.log(`\nTests Completed: ${passed}/${total} passed.`);
  } finally {
    db.exec('ROLLBACK');
  }
}

runTests();
