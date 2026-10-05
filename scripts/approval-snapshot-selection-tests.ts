import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";
import crypto from "crypto";

const db = getAuditDatabase();

function runTests() {
  console.log("Running focused Approval snapshot-selection tests...");
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
    const poId = "PO_TEST_" + Date.now();
    const soId = "SO_TEST_" + Date.now();
    
    // Setup SO
    db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status, records_seen, records_written) VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run("RUN_OLD", orgId, "approval_pending_sync", "2026-01-01T10:00:00.000Z", "SUCCESS");
    
    db.prepare(`INSERT INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, fetched_at) VALUES (?, ?, ?, ?, ?)`)
      .run(orgId, soId, "RUN_OLD", "SO-9999", "2026-01-01T10:00:00.000Z");
      
    db.prepare(`INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "so_line_1", soId, "RUN_OLD", "item_1", 10, null);

    // Setup PO: 
    // older snapshot without narration (RUN_OLD)
    // newer snapshot with narration (RUN_NEW)
    db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status, records_seen, records_written) VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run("RUN_NEW", orgId, "approval_pending_sync", "2026-02-01T10:00:00.000Z", "SUCCESS");

    db.prepare(`INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, custom_fields_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, poId, "RUN_OLD", "PO-9999", "pending_approval", JSON.stringify([{label: "Sales Order No", value: "SO-9999"}]), "2026-01-01T10:00:00.000Z");

    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_1", poId, "RUN_OLD", "item_1", 10, null);

    db.prepare(`INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, custom_fields_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, poId, "RUN_NEW", "PO-9999", "pending_approval", JSON.stringify([{label: "Sales Order No", value: "SO-9999"}]), "2026-02-01T10:00:00.000Z");

    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_1", poId, "RUN_NEW", "item_1", 10, "Narration from NEW run");

    // Test A & C: Service selects newer successful snapshot and coherent lines
    const report = getApprovalPendingDocuments("RUN_NEW", db);
    const doc = report.documents.find(d => d.number === "PO-9999");
    assert(!!doc, "PO-9999 is in pending report");
    if (doc) {
      assert(doc.items.length === 1, "Should have 1 item");
      assert(doc.items[0].narration === "Narration from NEW run", "Selected newer narration");
      assert(doc.items[0].refNarration === "EVIDENCE NOT SYNCHRONIZED", "SO narration was null, so EVIDENCE NOT SYNCHRONIZED");
    }

    // Test B: Chronological successful run wins even if lexical order conflicts
    // Let's add RUN_Z_OLD (lexically higher but chronologically older)
    db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status, records_seen, records_written) VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run("RUN_Z_OLD", orgId, "approval_pending_sync", "2026-01-15T10:00:00.000Z", "SUCCESS");
    db.prepare(`INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, custom_fields_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, poId, "RUN_Z_OLD", "PO-9999", "pending_approval", JSON.stringify([{label: "Sales Order No", value: "SO-9999"}]), "2026-01-15T10:00:00.000Z");
    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_1", poId, "RUN_Z_OLD", "item_1", 10, "Narration from Z_OLD run");

    const report2 = getApprovalPendingDocuments("RUN_NEW", db);
    const doc2 = report2.documents.find(d => d.number === "PO-9999");
    assert(doc2?.items[0].narration === "Narration from NEW run", "Chronological run wins over lexical RUN_Z_OLD");

    // Test D: New snapshot has description empty (""). UI state = "—"
    db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status, records_seen, records_written) VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run("RUN_NEWEST", orgId, "approval_pending_sync", "2026-03-01T10:00:00.000Z", "SUCCESS");
    db.prepare(`INSERT INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, custom_fields_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, poId, "RUN_NEWEST", "PO-9999", "pending_approval", JSON.stringify([{label: "Sales Order No", value: "SO-9999"}]), "2026-03-01T10:00:00.000Z");
    db.prepare(`INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, "po_line_1", poId, "RUN_NEWEST", "item_1", 10, "");

    const report3 = getApprovalPendingDocuments("RUN_NEWEST", db);
    const doc3 = report3.documents.find(d => d.number === "PO-9999");
    assert(doc3?.items[0].narration === "—", "Empty string description maps to '—'");

    console.log(`\nTests Completed: ${passed}/${total} passed.`);
  } finally {
    db.exec('ROLLBACK');
  }
}

runTests();
