import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";

const db = getAuditDatabase();

// Run the service logic for Approval Pending
const report = getApprovalPendingDocuments(undefined, db);

let pass = true;

// Find PO-2627273 mapped to SO-2627005 (or SO-2526110 if that's what the user asked about)
const poDoc = report.documents.find(d => d.number === 'PO-2627273');

if (poDoc) {
  console.log("Found PO-2627273:");
  const currentLines = poDoc.items.filter(i => i.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT');
  for (const line of currentLines) {
    console.log(`- Line: ${line.itemName}`);
    console.log(`  SourceLineID: ${line.sourceLineId}, RefLineID: ${line.refLineId || "UNMAPPED"}`);
    console.log(`  Result: ${line.mismatchType}`);
    
    // Check if it grouped identical names. It shouldn't group them now, each should have its own sourceLineId
  }
} else {
  console.log("PO-2627273 not found");
}

const targetDoc = report.documents.find(d => d.number === 'SO-2526110' || d.relatedDocumentRef === 'SO-2526110');
if (targetDoc) {
  console.log(`Found target doc related to SO-2526110: ${targetDoc.number}`);
  for (const line of targetDoc.items) {
      if (line.itemName.includes("Distribution Box")) {
         console.log(`- ${line.itemName} -> SourceLineID: ${line.sourceLineId}, RefLineID: ${line.refLineId}`);
      }
  }
}

// Ensure there are no grouped quantities
for (const doc of report.documents) {
  const lineIds = doc.items.map(i => i.sourceLineId);
  const uniqueLineIds = new Set(lineIds);
  if (lineIds.length !== uniqueLineIds.size) {
    console.error(`FAIL: Document ${doc.number} has duplicate line IDs, indicating aggregation!`);
    pass = false;
  }
}

if (pass) {
  console.log("✅ Line-grain verification passed!");
} else {
  console.error("❌ Line-grain verification failed!");
  process.exit(1);
}
