/**
 * SO ↔ PO Custom-Field Deterministic Mapping — Unit Tests
 *
 * Tests the classifyMapping() and normalizeName() functions directly.
 * No Zoho API calls. No network. No database. Pure logic verification.
 *
 * ZOHO WRITE: 0
 */

import { classifyMapping, normalizeName } from "../app/lib/audit/so-po-mapping.ts";
import type { LinkEvidence, SoPoMappingStatus } from "../app/lib/audit/so-po-mapping.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function assertStatus(evidence: LinkEvidence, expected: SoPoMappingStatus, label: string): void {
  assert(evidence.mappingStatus === expected, `${label} → ${expected} (got ${evidence.mappingStatus})`);
}

// ──────────────────────────────────────────────────────────────
// Test 1: PO has Sales Order No = SO-2627053, SO exists,
//         customer names match except case → EXACT_CUSTOMER_VERIFIED
// ──────────────────────────────────────────────────────────────
console.log("\nTest 1: Exact link + customer verified (case-insensitive)");
{
  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053"],
    customerFieldRaw: "Bhavani Control System Private Limited",
    checkAndVerifyRaw: "Approved By Vipul Patel",
    deliveryCustomerRaw: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED",
    linkedSalesOrder: { party: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED" },
    soLookupError: false,
  });
  assertStatus(evidence, "EXACT_CUSTOMER_VERIFIED", "Mapping status");
  assert(evidence.soReference === "SO-2627053", "SO reference preserved");
  assert(evidence.soLookupResult === "FOUND", "SO lookup found");
  assert(evidence.customerVerification === "EXACT_MATCH", "Customer verified exact");
  assert(evidence.deliveryVerification === "EXACT_MATCH", "Delivery verified exact");
  assert(evidence.checkAndVerifyRaw === "Approved By Vipul Patel", "Check and verify preserved");
  assert(evidence.mappingSource === "PO Custom Field — Sales Order No", "Mapping source label");
}

// ──────────────────────────────────────────────────────────────
// Test 2: SO reference exists, customer names differ
//         → CUSTOMER_NAME_MISMATCH
// ──────────────────────────────────────────────────────────────
console.log("\nTest 2: Customer name mismatch");
{
  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053"],
    customerFieldRaw: "Bhavani Electrical Works",
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: { party: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED" },
    soLookupError: false,
  });
  assertStatus(evidence, "CUSTOMER_NAME_MISMATCH", "Mapping status");
  assert(evidence.customerVerification === "MISMATCH", "Customer verification mismatch");
  assert(evidence.soLookupResult === "FOUND", "SO was found");
}

// ──────────────────────────────────────────────────────────────
// Test 3: Sales Order No missing from PO custom fields
//         → SO_REFERENCE_MISSING
// ──────────────────────────────────────────────────────────────
console.log("\nTest 3: SO reference missing");
{
  const evidence = classifyMapping({
    soReferenceValues: [],
    customerFieldRaw: "Some Customer",
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: null,
    soLookupError: false,
  });
  assertStatus(evidence, "SO_REFERENCE_MISSING", "Mapping status");
  assert(evidence.soReference === null, "No SO reference");
  assert(evidence.soLookupResult === "NOT_ATTEMPTED", "Lookup not attempted");
  assert(evidence.mappingSource === "Not available", "Mapping source absent");
}

// ──────────────────────────────────────────────────────────────
// Test 4: Sales Order No points to nonexistent SO
//         → SO_REFERENCE_NOT_FOUND
// ──────────────────────────────────────────────────────────────
console.log("\nTest 4: SO reference not found");
{
  const evidence = classifyMapping({
    soReferenceValues: ["SO-9999999"],
    customerFieldRaw: null,
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: null,
    soLookupError: true,
  });
  assertStatus(evidence, "SO_REFERENCE_NOT_FOUND", "Mapping status");
  assert(evidence.soReference === "SO-9999999", "SO reference preserved");
  assert(evidence.soLookupResult === "NOT_FOUND", "Lookup result NOT_FOUND");
}

// ──────────────────────────────────────────────────────────────
// Test 5: Whitespace/case normalization → exact match
// ──────────────────────────────────────────────────────────────
console.log("\nTest 5: Whitespace and case normalization");
{
  // normalizeName tests
  assert(normalizeName("  Bhavani   Control  ") === "bhavani control", "normalizeName collapses whitespace");
  assert(normalizeName("BHAVANI CONTROL") === "bhavani control", "normalizeName lowercases");
  assert(normalizeName("   ") === "", "normalizeName trims empty");

  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053"],
    customerFieldRaw: "  Bhavani   Control   System   Private   Limited  ",
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: { party: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED" },
    soLookupError: false,
  });
  assertStatus(evidence, "EXACT_CUSTOMER_VERIFIED", "Whitespace-normalized match");
  assert(evidence.customerVerification === "EXACT_MATCH", "Customer exact after normalization");
}

// ──────────────────────────────────────────────────────────────
// Test 6: Similar but NOT exact customer names
//         → Does NOT auto-verify
// ──────────────────────────────────────────────────────────────
console.log("\nTest 6: Similar names do NOT auto-verify");
{
  // "Pvt Ltd" vs "Private Limited" are similar but not the same after normalization
  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053"],
    customerFieldRaw: "Bhavani Control System Pvt Ltd",
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: { party: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED" },
    soLookupError: false,
  });
  assertStatus(evidence, "CUSTOMER_NAME_MISMATCH", "Similar name NOT auto-verified");
  assert(evidence.customerVerification === "MISMATCH", "Not fuzzy matched");
}

// ──────────────────────────────────────────────────────────────
// Test 7: Amount/quantity happen to match but Sales Order No missing
//         → SO_REFERENCE_MISSING (no inferred relationship)
// ──────────────────────────────────────────────────────────────
console.log("\nTest 7: No inference from amount/quantity when SO ref missing");
{
  // Even if amounts/items would match, without Sales Order No the status must be MISSING
  const evidence = classifyMapping({
    soReferenceValues: [],
    customerFieldRaw: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED",
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED",
    linkedSalesOrder: null,
    soLookupError: false,
  });
  assertStatus(evidence, "SO_REFERENCE_MISSING", "No inference — reference is missing");
  assert(evidence.mappingSource === "Not available", "No mapping source");
}

// ──────────────────────────────────────────────────────────────
// Test 8: Multiple/ambiguous SO references → MULTIPLE_SO_REFERENCE
// ──────────────────────────────────────────────────────────────
console.log("\nTest 8: Multiple SO references — ambiguous");
{
  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053", "SO-2627099"],
    customerFieldRaw: null,
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: null,
    soLookupError: false,
  });
  assertStatus(evidence, "MULTIPLE_SO_REFERENCE", "Multiple references flagged");
  assert(evidence.soReference === "SO-2627053, SO-2627099", "All references listed");
  assert(evidence.soLookupResult === "NOT_ATTEMPTED", "Lookup not attempted for ambiguous");
}

// ──────────────────────────────────────────────────────────────
// Test 9: All Zoho calls in this feature are GET-only
// ──────────────────────────────────────────────────────────────
console.log("\nTest 9: Read-only verification (static analysis)");
{
  const fs = await import("node:fs");
  const routeCode = fs.readFileSync(
    new URL("../app/api/audit/order-comparison/route.ts", import.meta.url),
    "utf-8"
  );

  // The route must use secureZohoFetch (which enforces read-only)
  assert(routeCode.includes("secureZohoFetch"), "Route uses secureZohoFetch");

  // The route must not contain any POST/PUT/PATCH/DELETE method strings
  // (outside of comments/error messages)
  const codeLines = routeCode.split("\n").filter(
    (line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")
  );
  const codeBody = codeLines.join("\n");

  assert(!codeBody.includes('method: "POST"'), "No POST method in route code");
  assert(!codeBody.includes('method: "PUT"'), "No PUT method in route code");
  assert(!codeBody.includes('method: "PATCH"'), "No PATCH method in route code");
  assert(!codeBody.includes('method: "DELETE"'), "No DELETE method in route code");

  // All fetch calls use method: "GET"
  assert(codeBody.includes('method: "GET"'), "Route explicitly uses GET");

  // classifyMapping is a pure function — no fetch, no Zoho calls
  const classifyStr = classifyMapping.toString();
  assert(!classifyStr.includes("fetch"), "classifyMapping has no fetch calls");
  assert(!classifyStr.includes("secureZohoFetch"), "classifyMapping has no Zoho calls");
}

// ──────────────────────────────────────────────────────────────
// Additional edge cases
// ──────────────────────────────────────────────────────────────
console.log("\nAdditional: SO found but customer field absent → EXACT_CUSTOM_FIELD_LINK");
{
  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053"],
    customerFieldRaw: null,
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: null,
    linkedSalesOrder: { party: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED" },
    soLookupError: false,
  });
  assertStatus(evidence, "EXACT_CUSTOM_FIELD_LINK", "Link without customer field");
  assert(evidence.customerVerification === "NOT_AVAILABLE", "Customer verification not available");
  assert(evidence.soLookupResult === "FOUND", "SO was found");
}

console.log("\nAdditional: Delivery customer mismatch does not affect mapping status");
{
  const evidence = classifyMapping({
    soReferenceValues: ["SO-2627053"],
    customerFieldRaw: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED",
    checkAndVerifyRaw: null,
    deliveryCustomerRaw: "Some Other Delivery Address",
    linkedSalesOrder: { party: "BHAVANI CONTROL SYSTEM PRIVATE LIMITED" },
    soLookupError: false,
  });
  assertStatus(evidence, "EXACT_CUSTOMER_VERIFIED", "Primary mapping uses customer field not delivery");
  assert(evidence.deliveryVerification === "MISMATCH", "Delivery mismatch is separate evidence");
  assert(evidence.customerVerification === "EXACT_MATCH", "Customer field match drives status");
}

// ──────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`SO ↔ PO MAPPING TESTS: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}`);

if (failed > 0) {
  console.error("\nFAILED — see above for details.");
  process.exit(1);
}
console.log("\nPASS — all deterministic mapping tests verified.");
console.log("ZOHO WRITE: 0");
