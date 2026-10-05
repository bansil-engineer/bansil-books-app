import { syncApprovalPending } from "../app/lib/audit/approval-pending-sync.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";

async function main() {
  console.log("==================================================");
  console.log("RUNNING LIVE SMART SYNC ALL CHANGED");
  console.log("==================================================");

  const db = getAuditDatabase();
  const beforePOs = db.prepare("SELECT purchaseorder_id, purchaseorder_number, status, date, total FROM audit_zoho_purchase_orders WHERE source_run_id = 'APPROVAL_PENDING_ACTIVE'").all() as any[];
  console.log(`Pre-sync PO count: ${beforePOs.length}`);

  const startTime = Date.now();
  const result = await syncApprovalPending({});
  const duration = Date.now() - startTime;

  console.log("Sync Execution Completed in " + duration + "ms");
  console.log("Result:", JSON.stringify(result, null, 2));

  // Check updated sync state
  const syncRow = db.prepare("SELECT * FROM audit_section_syncs WHERE section_key = 'APPROVAL_PENDING'").get();
  console.log("audit_section_syncs row:", JSON.stringify(syncRow, null, 2));

  // Check which documents are in the report now
  const report = getApprovalPendingDocuments("APPROVAL_PENDING_ACTIVE", db);
  console.log("Total pending documents in local view:", report.documents.length);
  console.log("Summary:", JSON.stringify(report.summary, null, 2));

  // Check any updated POs / Bills / Invoices
  console.log("\nSample pending documents:");
  for (const doc of report.documents.slice(0, 5)) {
    console.log(`- ${doc.type} ${doc.number} (${doc.id}): status=${doc.zohoStatus}, verif=${doc.verificationStatus}, customer/vendor=${doc.customerOrVendor}, items=${doc.items.length}`);
  }
}

main().catch(err => {
  console.error("Live sync error:", err);
  process.exit(1);
});
