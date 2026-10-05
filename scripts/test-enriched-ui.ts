import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

const db = getAuditDatabase();
const report = getApprovalPendingDocuments("APPROVAL_PENDING_ACTIVE", db);

const po = report.documents.find(d => d.number === "PO-2627289");
if (po) {
  console.log("PO ITEMS:", JSON.stringify(po.items.slice(0, 3), null, 2));
} else {
  console.log("PO-2627289 NOT FOUND IN REPORT");
}
