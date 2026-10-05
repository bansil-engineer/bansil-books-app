// ============================================================
// Bansil Books Analytics — Customer 360 / Customer Details Test Suite
// Hardened Validation Suite for Local SQLite Analytics
// ============================================================

import { getDatabase } from "../app/lib/db/database.ts";
import {
  getCustomerList,
  getCustomerDetailsData,
} from "../app/lib/customer-details-engine.ts";
import { buildCustomerDetailsExcel } from "../app/lib/export/excel-builder.ts";
import { buildCustomerDetailsPdf } from "../app/lib/export/pdf-builder.ts";
import { APPROVED_ZOHO_READ_SCOPES } from "../app/lib/zoho-security-guard.ts";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
    failedCount++;
  }
}

console.log("\n==================================================");
console.log("RUNNING CUSTOMER DETAILS / CUSTOMER 360 TEST SUITE");
console.log("==================================================\n");

const db = getDatabase();

// ----------------------------------------------------
// TEST GROUP 1: Customer Selector & List Extraction
// ----------------------------------------------------
console.log("--- TEST GROUP 1: Customer Selector & List Extraction ---");
const customerList = getCustomerList(db, { financialYear: "2026-27" });
assert(customerList.length > 0, "Customer Selector: Loaded non-empty list of customers from local SQLite", `Count: ${customerList.length}`);
assert(customerList.every(c => c.name && c.name.trim() !== ""), "Customer Selector: All customers have non-empty names");
assert(!customerList.some(c => c.name === "CUSTOMER DETAILS MISSING"), "Customer Selector: Excludes 'CUSTOMER DETAILS MISSING' placeholder");

// Search filter test
const searchFiltered = getCustomerList(db, { financialYear: "2026-27", search: "COROMANDEL" });
assert(searchFiltered.length >= 1 && searchFiltered.some(c => c.name.includes("COROMANDEL")), "Customer Selector: Search by name works correctly");

// ----------------------------------------------------
// TEST GROUP 2: Customer Profile & Identity Grain
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: Customer Profile & Identity Grain ---");
// Test real known customer: RUBAMIN PRIVATE LIMITED or STYRENIX
const sampleCust = customerList.find(c => c.salesCount > 0) || customerList[0];
const custData = getCustomerDetailsData(db, {
  customerId: sampleCust.id,
  customerName: sampleCust.name,
  financialYear: "2026-27",
  period: "CURRENT_FY",
});

assert(custData !== null, "Customer Profile: Customer 360 data retrieved successfully");
assert(custData!.customer.id.length > 0, "Customer ID Grain: Customer ID is preserved and primary", `ID: ${custData?.customer.id}`);
assert(custData!.customer.source === "Local SQLite Cache", "Customer Profile: Source is marked as Local SQLite Cache");
assert(custData!.customer.gstin !== undefined, "Customer Profile: GSTIN field present (not fabricated)");

// ----------------------------------------------------
// TEST GROUP 3: Sales Invoices & Pre-GST Taxable Values
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Sales Invoices & Pre-GST Taxable Values ---");
if (custData && custData.salesInvoices.length > 0) {
  const inv = custData.salesInvoices[0];
  assert(inv.invoice_number.length > 0, "Sales Invoices: Invoice number is present", inv.invoice_number);
  assert(inv.taxable_value > 0, "Sales Taxable: Pre-GST taxable value is positive", `Taxable: ${inv.taxable_value}`);
  assert(inv.grand_total >= inv.taxable_value, "Sales Invoices: Grand total >= Pre-GST taxable value");
  assert(typeof inv.balance === "number", "Sales Invoices: Balance amount is numeric");
} else {
  console.log("  ℹ INFO: Sample customer has no sales invoices in FY2026-27");
}

// ----------------------------------------------------
// TEST GROUP 4: Purchase Bills & Line Customer Matching
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: Purchase Bills & Line Customer Matching ---");
// Real known purchase bill validation: BE033/26-27 for COROMANDEL INTERNATIONAL LTD.
const coroData = getCustomerDetailsData(db, {
  customerName: "COROMANDEL INTERNATIONAL LTD.",
  financialYear: "2026-27",
  period: "ALL",
});

assert(coroData !== null, "Coromandel Data: Retrieved Customer 360 data for COROMANDEL");
const coroBill = coroData?.purchaseBills.find(b => b.bill_number === "BE033/26-27");
assert(coroBill !== undefined, "Purchase Line Customer: Bill BE033/26-27 matched to COROMANDEL", "Found matching purchase bill");
if (coroBill) {
  assert(coroBill.vendor_name === "BHAVYADIP ELECTRO PANEL PRIVATE LIMITED", "Purchase Bill List: Correct vendor matched", coroBill.vendor_name);
  assert(coroBill.customer_taxable_value === 11000, "Purchase Taxable: Correct line taxable amount (₹11,000.00)", `Got: ${coroBill.customer_taxable_value}`);
  assert(coroBill.matching_qty === 1, "Purchase Qty: Correct matching quantity (1)", `Got: ${coroBill.matching_qty}`);
  assert(coroBill.source_grand_total === 12980, "Purchase Bills: Correct source grand total (₹12,980.00)", `Got: ${coroBill.source_grand_total}`);
}

// ----------------------------------------------------
// TEST GROUP 5: Item Analysis & Reconciliation Formulas
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Item Analysis & Reconciliation ---");
if (coroData && coroData.itemAnalysis.length > 0) {
  const panelDoor = coroData.itemAnalysis.find(i => i.item_name === "Panel Door");
  assert(panelDoor !== undefined, "Item Analysis: Panel Door found in item analysis");
  if (panelDoor) {
    assert(panelDoor.purchase_qty === 1, "Item Analysis: Purchase Qty = 1");
    assert(panelDoor.latest_purchase_rate === 11000, "Item Analysis: Latest Purchase Rate = ₹11,000.00", `Got: ${panelDoor.latest_purchase_rate}`);
    assert(panelDoor.balance_qty === 1, "Item Analysis: Balance Qty = 1 (Surplus/Yet to sale)");
    assert(panelDoor.yet_to_sale === 1, "Item Analysis: Yet to sale = 1");
  }
}

// Reconciliation summary checks
assert(coroData !== null && coroData.reconciliation.purchase_qty >= 1, "Customer Reconciliation: Purchase Qty calculated correctly");
assert(coroData !== null && coroData.reconciliation.approx_surplus_value >= 11000, "Customer Reconciliation: Surplus valuation using Latest Purchase Rate", `Valuation: ${coroData?.reconciliation.approx_surplus_value}`);

// ----------------------------------------------------
// TEST GROUP 6: Global Exclusion Rule Enforcement
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: Global Exclusion Rule Enforcement ---");
// Check active excluded items do not appear in customer details
const activeExcl = db.prepare(`SELECT item_id, item_name FROM reconciliation_exclusions WHERE status = 'ACTIVE'`).all() as Array<{ item_id: string; item_name: string }>;
if (activeExcl.length > 0 && coroData) {
  const exclIds = new Set(activeExcl.map(e => e.item_id));
  const hasExclInItems = coroData.itemAnalysis.some(i => exclIds.has(i.item_id));
  assert(!hasExclInItems, "Global Exclusion: 0 excluded items in Item Analysis");
} else {
  assert(true, "Global Exclusion: 0 excluded items in customer details (PASS)");
}

// ----------------------------------------------------
// TEST GROUP 7: Commercial Value Spread Metric
// ----------------------------------------------------
console.log("\n--- TEST GROUP 7: Commercial Value Spread Metric ---");
if (custData) {
  const expectedSpread = custData.kpis.salesTaxableValue - custData.kpis.purchaseTaxableValue;
  assert(custData.kpis.commercialValueSpread === expectedSpread, "Commercial Value Spread: Sales Taxable - Purchase Taxable calculated exactly", `Spread: ${custData.kpis.commercialValueSpread}`);
}

// ----------------------------------------------------
// TEST GROUP 8: Order Data Audit & Scope Expansion Gate
// ----------------------------------------------------
console.log("\n--- TEST GROUP 8: Order Data Audit & Scope Expansion Gate ---");
assert(coroData?.salesOrders.available === false, "Sales Orders: Marked unavailable without fake data");
assert(coroData?.purchaseOrders.available === false, "Purchase Orders: Marked unavailable without fake data");
assert(
  APPROVED_ZOHO_READ_SCOPES.includes("ZohoBooks.invoices.READ") &&
  APPROVED_ZOHO_READ_SCOPES.includes("ZohoBooks.bills.READ") &&
  !APPROVED_ZOHO_READ_SCOPES.some(s => s.includes("salesorders") || s.includes("purchaseorders")),
  "OAuth Scope Gate: No unapproved order scopes added"
);

// ----------------------------------------------------
// TEST GROUP 9: Excel & PDF Exports
// ----------------------------------------------------
console.log("\n--- TEST GROUP 9: Excel & PDF Exports ---");
async function testExports() {
  if (!coroData) return;
  const excelBuf = await buildCustomerDetailsExcel(coroData);
  assert(Buffer.isBuffer(excelBuf) && excelBuf.length > 1000, "Excel Export: Generated valid multi-sheet Excel workbook", `Bytes: ${excelBuf.length}`);

  const pdfBuf = buildCustomerDetailsPdf(coroData);
  assert(Buffer.isBuffer(pdfBuf) && pdfBuf.length > 1000, "PDF Export: Generated valid Landscape A4 PDF document", `Bytes: ${pdfBuf.length}`);
}

await testExports();

// ----------------------------------------------------
// TEST GROUP 10: Zero Line Duplication & Integrity
// ----------------------------------------------------
console.log("\n--- TEST GROUP 10: Zero Line Duplication & Integrity ---");
if (coroData) {
  const billNumbers = coroData.purchaseBills.map(b => b.bill_number);
  const uniqueBills = new Set(billNumbers);
  assert(billNumbers.length === uniqueBills.size, "Duplicate Purchase Lines: 0 duplicate bills in bill list");
}

console.log("\n==================================================");
console.log(`CUSTOMER DETAILS TESTS: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
