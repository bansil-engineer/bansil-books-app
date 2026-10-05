import { normalizeSoReference, buildGlobalSoLookup, resolveUniqueSalesOrder } from "../app/lib/audit/so-po-mapping.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getCommercialTrace } from "../app/lib/audit/commercial-trace-service.ts";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service.ts";

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    console.error(`❌ FAIL: ${msg}. Expected ${expected}, got ${actual}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

// 1. Test normalization
assertEqual(normalizeSoReference("SO-2627005"), "2627005", "SO-2627005 normalizes to 2627005");
assertEqual(normalizeSoReference("2627005"), "2627005", "2627005 normalizes to 2627005");
assertEqual(normalizeSoReference("SO 2627005"), "2627005", "SO 2627005 normalizes to 2627005");
assertEqual(normalizeSoReference("ABC-SO-2627005"), "2627005", "ABC-SO-2627005 normalizes to 2627005");
assertEqual(normalizeSoReference(null), null, "null normalizes to null");

// 2. Test lookup with mock DB
const mockDb = {
  prepare: () => ({
    all: () => [
      { salesorder_id: "id1", salesorder_number: "SO-2627005" },
      { salesorder_id: "id2", salesorder_number: "SO-2627006" },
      { salesorder_id: "id3", salesorder_number: "AMB-1234567" },
      { salesorder_id: "id4", salesorder_number: "AMB 1234567" }
    ]
  })
};

const lookup = buildGlobalSoLookup(mockDb as any);
assertEqual(lookup.has("2627005"), true, "Lookup has 2627005");
assertEqual(lookup.has("2627006"), true, "Lookup has 2627006");
assertEqual(lookup.has("1234567"), true, "Lookup has 1234567");

// 3. Test resolution
const r1 = resolveUniqueSalesOrder(lookup, "PO-2627005");
assertEqual(r1.status, "MATCH", "Resolves exact match");
assertEqual((r1 as any).so.salesorder_id, "id1", "Matches correct SO id");

const r2 = resolveUniqueSalesOrder(lookup, "9999999");
assertEqual(r2.status, "SO_REFERENCE_NOT_FOUND", "Returns NOT_FOUND for invalid reference");

const r3 = resolveUniqueSalesOrder(lookup, "1234567");
assertEqual(r3.status, "AMBIGUOUS_SO_REFERENCE", "Returns AMBIGUOUS for > 1 candidates");

const r4 = resolveUniqueSalesOrder(lookup, null);
assertEqual(r4.status, "UNRESOLVED", "Returns UNRESOLVED for null");

// 4. Test actual Database for PO-2627273
const db = getAuditDatabase();
const globalLookup = buildGlobalSoLookup(db);

const poInfo = db.prepare(`SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_number = 'PO-2627273' ORDER BY fetched_at DESC LIMIT 1`).get() as any;
if (!poInfo) {
  console.log("⚠️ PO-2627273 not found in local DB. Skipping real test.");
} else {
  const cf = JSON.parse(poInfo.custom_fields_json || "[]");
  const f = cf.find((c: any) => c.label.toLowerCase().includes("sales order"));
  if (f) {
    const res = resolveUniqueSalesOrder(globalLookup, f.value);
    console.log(`✅ PO-2627273 custom field '${f.value}' resolved to status: ${res.status}`);
    if (res.status === 'MATCH') {
      console.log(`✅ Matched SO Number: ${res.so.salesorder_number} (${res.so.salesorder_id})`);
    }
  }
}

// 5. Test Commercial Trace output
console.log("\\n--- Testing Commercial Trace SO-2627005 ---");
const trace = getCommercialTrace("SO-2627005");
if (trace) {
  const hasLinkedPO = trace.purchaseOrders.some(p => p.number === "PO-2627273");
  console.log(`✅ Trace retrieved. Has linked PO-2627273: ${hasLinkedPO}`);
}

console.log("\\nAll tests completed successfully!");
