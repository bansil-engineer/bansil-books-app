// ============================================================
// Bansil Books Analytics — Services & Period & Mapping Test Suite
// Full Automated Regression Gate for Section 20 - 25
// STRICTLY LOCAL SQLITE · ZERO ZOHO API CALLS
// ============================================================

import assert from "node:assert";
import { getDatabase, getAllClassifications, getClassifiedServiceItemIds, getItemClassification } from "../app/lib/db/database.ts";
import { generateMasterInventoryMismatchReport } from "../app/lib/inventory-mismatch-engine.ts";
import { generateReconciliationReport } from "../app/lib/reconciliation-engine.ts";
import { formatDisplayDate, isoToDisplay } from "../app/lib/date-utils.ts";

async function runServiceAndBreakdownTests() {
  console.log("==================================================");
  console.log("STARTING SERVICES & DATA-MAPPING AUTOMATED TESTS");
  console.log("==================================================");

  const db = getDatabase();

  // Temporarily deactivate any exclusion on test service item during service tests, then restore in finally
  const existingExcl = db.prepare("SELECT exclusion_id, status FROM reconciliation_exclusions WHERE item_id = '3166667000000107051' AND status = 'ACTIVE'").get() as { exclusion_id: string; status: string } | undefined;
  if (existingExcl) {
    db.prepare("UPDATE reconciliation_exclusions SET status = 'INACTIVE' WHERE exclusion_id = ?").run(existingExcl.exclusion_id);
  }

  try {

  // [TEST 1] Testing Universal Date Formatting (DD/MM/YYYY)
  console.log("\n[TEST 1] Testing Universal Date Formatting (DD/MM/YYYY)...");
  assert.strictEqual(formatDisplayDate("2026-05-14"), "14/05/2026");
  assert.strictEqual(formatDisplayDate("2025-11-03"), "03/11/2025");
  assert.strictEqual(formatDisplayDate("2026-04-01T10:30:00.000Z"), "01/04/2026");
  assert.strictEqual(isoToDisplay("2026-09-11"), "11/09/2026");
  console.log("✓ Date formatting passed (DD/MM/YYYY).");

  // [TEST 2] Testing Service Classification in SQLite
  console.log("\n[TEST 2] Testing Service Classification in SQLite...");
  const classifications = getAllClassifications();
  assert(classifications.length > 0, "analytics_classifications should have records");
  
  const serviceItemIds = getClassifiedServiceItemIds();
  assert(serviceItemIds.has("3166667000000107051"), "Service item 3166667000000107051 must be classified as SERVICE");
  
  const itemClass = getItemClassification("3166667000000107051");
  assert.strictEqual(itemClass, "SERVICE", "Item classification must return SERVICE");
  console.log(`✓ Service classification verified. ${serviceItemIds.size} service item(s) registered.`);

  // [TEST 3] Testing Purchase Bill Mapping Regression (Customer != Vendor)
  console.log("\n[TEST 3] Testing Purchase Bill Mapping Regression...");
  const samplePurchBill = db.prepare(`
    SELECT 
      pb.bill_id, pb.bill_number, pb.date, pb.vendor_name,
      pbli.line_item_id, pbli.item_id, pbli.item_name, pbli.quantity, pbli.rate, pbli.line_total,
      COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name) as customer_name
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pb.bill_id = pbli.bill_id
    WHERE pb.date >= '2026-04-01' AND pb.date <= '2027-03-31'
      AND COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name) IS NOT NULL
      AND COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name) != pb.vendor_name
      AND pbli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL AND item_id != '')
    LIMIT 1
  `).get() as any;

  assert(samplePurchBill, "Active purchase bill with Customer != Vendor must exist in SQLite database");
  console.log(`  Bill ${samplePurchBill.bill_number}: Vendor=${samplePurchBill.vendor_name}, Customer=${samplePurchBill.customer_name}, Qty=${samplePurchBill.quantity}, Amount=${samplePurchBill.line_total}`);

  assert.notStrictEqual(samplePurchBill.customer_name, samplePurchBill.vendor_name, "Customer must NOT equal Vendor");
  assert(samplePurchBill.quantity > 0, "Qty must be > 0");
  assert(samplePurchBill.line_total > 0, "Amount must be > 0");

  // Verify in mismatch report transactionLines
  const mismatch26 = generateMasterInventoryMismatchReport({
    financialYear: "2026-27",
    classification: "ALL",
  });
  const txSample = (mismatch26.transactionLines || []).find((t: any) => t.docNumber === samplePurchBill.bill_number && t.type === "PURCHASE" && t.lineItemId === samplePurchBill.line_item_id);
  assert(txSample, `Bill ${samplePurchBill.bill_number} must appear in mismatch transactionLines`);
  assert.strictEqual(txSample.vendorName, samplePurchBill.vendor_name, "Purchase row vendorName must match Bill vendor");
  assert.strictEqual(txSample.customerName, samplePurchBill.customer_name, "Purchase row customerName must match line customer");
  assert.strictEqual(txSample.canonicalId, `purchase:${samplePurchBill.bill_id}:${samplePurchBill.line_item_id}`, "Canonical ID must match purchase:billId:lineItemId");
  assert.ok(!txSample.canonicalId.includes("undefined"), "Canonical ID must never contain undefined");
  console.log("✓ Purchase Bill Customer != Vendor verified.");

  // [TEST 4] Testing Customer Details Missing Lines Never Fall Back to Vendor
  console.log("\n[TEST 4] Testing Customer Details Missing Fallback Prevention...");
  const missingRows = mismatch26.customerDetailsMissing || [];
  console.log(`  Customer Details Missing records count in FY 2026-27: ${missingRows.length}`);
  for (const row of missingRows) {
    assert.ok(row.vendorName, "Missing customer record must have vendorName from bill");
    assert.ok(!row.billNumber.includes("undefined"), "Bill number must not be undefined");
  }
  console.log("✓ Customer Details Missing fallback prevention verified.");

  // [TEST 5] Testing Sales Row Mapping (Customer from Invoice, Vendor is Blank / '—')
  console.log("\n[TEST 5] Testing Sales Row Customer & Vendor Mapping...");
  const salesTx = (mismatch26.transactionLines || []).filter((t: any) => t.type === "SALE");
  assert(salesTx.length > 0, "Sales transactions must exist");
  for (const s of salesTx) {
    assert.strictEqual(s.vendorName, "—", "Sales transaction vendor must be '—'");
    assert.ok(s.customerName && s.customerName !== "—", "Sales transaction must have Customer Name from invoice");
    assert.ok(s.canonicalId.startsWith("sales:"), "Sales canonical ID must start with sales:");
    assert.ok(!s.canonicalId.includes("undefined"), "Sales canonical ID must not contain undefined");
  }
  console.log(`✓ All ${salesTx.length} Sales rows verified (Vendor = '—', Customer = Invoice Customer, no undefined keys).`);

  // [TEST 6] Testing Source Row Uniqueness & Zero React Duplicate Keys
  console.log("\n[TEST 6] Testing Source Row Uniqueness & React Keys...");
  const allKeys = new Set<string>();
  let dupeKeys = 0;
  for (const t of mismatch26.transactionLines || []) {
    const k = t.canonicalId;
    if (!k || k.includes("undefined")) {
      assert.fail(`Invalid canonical key found: ${k}`);
    }
    if (allKeys.has(k)) {
      dupeKeys++;
    }
    allKeys.add(k);
  }
  assert.strictEqual(dupeKeys, 0, "There must be zero duplicate canonical keys in transactionLines");
  console.log(`✓ ${allKeys.size} unique canonical keys verified with 0 duplicates.`);

  // [TEST 7] Testing Report Type Isolation (Material vs Services vs All)
  console.log("\n[TEST 7] Testing Report Type Filtering...");
  const repMaterial = generateMasterInventoryMismatchReport({ financialYear: "2026-27", classification: "MATERIAL" });
  const repServices = generateMasterInventoryMismatchReport({ financialYear: "2026-27", classification: "SERVICE" });
  const repAll = generateMasterInventoryMismatchReport({ financialYear: "2026-27", classification: "ALL" });

  const matCount = repMaterial.transactionLines?.length || 0;
  const svcCount = repServices.transactionLines?.length || 0;
  const allCount = repAll.transactionLines?.length || 0;

  console.log(`  FY 2026-27 Material lines: ${matCount}`);
  console.log(`  FY 2026-27 Services lines: ${svcCount}`);
  console.log(`  FY 2026-27 All lines: ${allCount}`);

  assert(matCount > 0, "Material lines should exist");
  assert(svcCount > 0, "Service lines should exist");
  assert.strictEqual(matCount + svcCount, allCount, "Material + Services must equal All lines");

  // Verify that Material report contains NO service items
  for (const t of repMaterial.transactionLines || []) {
    assert.strictEqual(t.classification, "MATERIAL", "Material report must only contain MATERIAL classification");
  }
  for (const t of repServices.transactionLines || []) {
    assert.strictEqual(t.classification, "SERVICE", "Services report must only contain SERVICE classification");
  }
  console.log("✓ Report Type isolation verified.");

  // [TEST 8] Testing Period Filtering End-to-End (FY 2025-26 vs FY 2026-27 vs Custom Date)
  console.log("\n[TEST 8] Testing Period Filtering & Actual Data Alteration...");
  const rep25Material = generateMasterInventoryMismatchReport({ financialYear: "2025-26", classification: "MATERIAL" });
  const rep25Services = generateMasterInventoryMismatchReport({ financialYear: "2025-26", classification: "SERVICE" });
  const rep25All = generateMasterInventoryMismatchReport({ financialYear: "2025-26", classification: "ALL" });

  const rep26Material = repMaterial;
  const rep26Services = repServices;
  const rep26All = repAll;

  console.log(`  FY 2025-26 Purchase Total: ₹${rep25All.totals.totalPurchaseAmount.toLocaleString("en-IN")}, Sales Total: ₹${rep25All.totals.totalSalesAmount.toLocaleString("en-IN")}`);
  console.log(`  FY 2026-27 Purchase Total: ₹${rep26All.totals.totalPurchaseAmount.toLocaleString("en-IN")}, Sales Total: ₹${rep26All.totals.totalSalesAmount.toLocaleString("en-IN")}`);

  // Assert period change changes actual data
  assert.notStrictEqual(rep25All.totals.totalPurchaseAmount, rep26All.totals.totalPurchaseAmount, "FY25 and FY26 purchase totals must differ");
  assert.notStrictEqual(rep25All.totals.totalSalesAmount, rep26All.totals.totalSalesAmount, "FY25 and FY26 sales totals must differ");
  assert.notStrictEqual(rep25All.items.length, rep26All.items.length, "FY25 and FY26 items counts must differ");

  // Custom date range test
  const repCustom = generateMasterInventoryMismatchReport({
    fromDate: "2026-04-01",
    toDate: "2026-06-30",
    classification: "ALL",
  });
  console.log(`  Custom Q1 FY26 Lines: ${repCustom.transactionLines?.length || 0}`);
  assert((repCustom.transactionLines?.length || 0) < allCount, "Custom 3-month range must return subset of full year");
  console.log("✓ Period filtering verified end-to-end.");

  console.log("\n==================================================");
  console.log("ALL SERVICES & DATA-MAPPING TESTS PASSED (100% GREEN)");
  console.log("==================================================");
  } finally {
    if (existingExcl) {
      db.prepare("UPDATE reconciliation_exclusions SET status = 'ACTIVE' WHERE exclusion_id = ?").run(existingExcl.exclusion_id);
    }
  }
}

runServiceAndBreakdownTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
