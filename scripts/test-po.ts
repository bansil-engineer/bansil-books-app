import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service";

const report = getApprovalPendingDocuments();
const po = report.documents.find(d => d.number === "PO-2627273");

if (po) {
  const genuineIssues = po.items.filter(i => i.mismatchType !== "MATCHED" && i.mismatchType !== "PARTIAL_WITHIN_REFERENCE" && i.mismatchType !== "NOT_INCLUDED_IN_CURRENT_DOCUMENT" && i.mismatchType !== "UOM_EVIDENCE_MISSING").length;
  const informational = po.items.filter(i => i.mismatchType === "NOT_INCLUDED_IN_CURRENT_DOCUMENT").length;
  console.log(JSON.stringify({
    poKey: po.relatedDocumentRef,
    uniqueMatch: po.verificationStatus !== "SO_REFERENCE_NOT_FOUND" && po.verificationStatus !== "AMBIGUOUS_SO_REFERENCE" && po.verificationStatus !== "UNRESOLVED",
    currentCount: po.items.filter(i => i.mismatchType !== "NOT_INCLUDED_IN_CURRENT_DOCUMENT").length,
    referenceCount: po.items.length,
    genuineIssues,
    informational,
    overall: po.verificationStatus,
    items: po.items
  }, null, 2));
} else {
  console.log("PO not found in pending documents");
}
