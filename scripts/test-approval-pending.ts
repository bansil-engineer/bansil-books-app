import { normalizeSoReference, resolveUniqueSalesOrder, buildGlobalSoLookup } from "../app/lib/audit/so-po-mapping";
import { getApprovalPendingDocuments } from "../app/lib/audit/approval-pending-service";

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`✅ PASS: ${msg}`);
  } else {
    console.log(`❌ FAIL: ${msg}`);
  }
}

function testSoNormalization() {
  console.log("\n--- SO NORMALIZATION ---");
  const ref1 = "SO-2627005";
  const ref2 = "2627005";
  const ref3 = "SO 2627005";
  
  assert(normalizeSoReference(ref1) === "2627005", "Normalizes SO-2627005");
  assert(normalizeSoReference(ref2) === "2627005", "Normalizes 2627005");
  assert(normalizeSoReference(ref3) === "2627005", "Normalizes SO 2627005");
  
  const lookup = new Map<string, any[]>();
  lookup.set("2627005", [{ salesorder_id: "SO_1", salesorder_number: "SO-2627005" }]);
  
  const r1 = resolveUniqueSalesOrder(lookup, "2627005");
  assert(r1.status === "MATCH", "MATCH via last 7");
  
  const r2 = resolveUniqueSalesOrder(lookup, "SO 2627005");
  assert(r2.status === "MATCH", "MATCH via SO 2627005");
  
  const r3 = resolveUniqueSalesOrder(lookup, "1234567");
  assert(r3.status === "SO_REFERENCE_NOT_FOUND", "Different last 7 -> NO MATCH");
  
  lookup.set("1111111", [{ salesorder_id: "SO_A" }, { salesorder_id: "SO_B" }]);
  const r4 = resolveUniqueSalesOrder(lookup, "1111111");
  assert(r4.status === "AMBIGUOUS_SO_REFERENCE", "Duplicate candidate last-7 -> AMBIGUOUS_SO_REFERENCE");
}

function runTests() {
  testSoNormalization();
  console.log("\n--- The rest of cases are tested functionally in UI / logic ---");
}

runTests();
