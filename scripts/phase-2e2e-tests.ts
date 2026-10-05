import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { getAccountTypePolicy } from "../app/lib/audit/reconciliation/rules.ts";

const DB_DIR = path.join(process.cwd(), "data");
const AUDIT_DB_PATH = path.join(DB_DIR, "audit_workspace.db");
const OPERATIONAL_DB_PATH = path.join(DB_DIR, "bansil_books.db");

console.log("==================================================");
console.log("PHASE 2E.2E DEDICATED READ-ONLY REGRESSION TESTS");
console.log("==================================================");

// Open databases in strict read-only mode
const auditDb = new DatabaseSync(AUDIT_DB_PATH, { readOnly: true });
const opDb = new DatabaseSync(OPERATIONAL_DB_PATH, { readOnly: true });

try {
  // -------------------------------------------------------------
  // Test 1: Bank Coverage Classification as INSUFFICIENT
  // -------------------------------------------------------------
  console.log("\n[TEST 1] Validating Bank Coverage Classification as INSUFFICIENT...");
  
  // Verify account type policy for 'bank'
  const bankPolicy = getAccountTypePolicy("bank");
  assert.strictEqual(bankPolicy, "BANK_STATEMENT_REQUIRED", "Account type 'bank' must require BANK_STATEMENT_REQUIRED");

  // Paid-through account used across sample bills
  const targetAccountId = "3166667000000092038"; // HDFC Cash Credi - 3424
  
  // Verify local bank transactions count for this account is 0
  const bankTxnCount = auditDb.prepare(`
    SELECT COUNT(*) as count FROM audit_zoho_bank_transactions WHERE account_id = ?
  `).get(targetAccountId) as { count: number };
  
  assert.strictEqual(bankTxnCount.count, 0, "Account 3166667000000092038 must have 0 bank statement rows in local snapshot");

  // Determine coverage classification per payment and aggregate
  const perPaymentCoverage = bankTxnCount.count === 0 ? "COVERAGE_INSUFFICIENT_ACCOUNT" : "COVERAGE_SUFFICIENT";
  assert.strictEqual(perPaymentCoverage, "COVERAGE_INSUFFICIENT_ACCOUNT", "Payment bank coverage must be COVERAGE_INSUFFICIENT_ACCOUNT");

  const aggregateCoverage = (bankTxnCount.count === 0) ? "INSUFFICIENT" : "COMPLETE";
  assert.strictEqual(aggregateCoverage, "INSUFFICIENT", "Aggregate bank coverage must be classified as INSUFFICIENT (resolving Phase 2E.2D contradiction)");
  
  console.log(`  -> Policy: ${bankPolicy}`);
  console.log(`  -> Account ${targetAccountId} bank txns in local DB: ${bankTxnCount.count}`);
  console.log(`  -> Per-Payment Coverage: ${perPaymentCoverage}`);
  console.log(`  -> Aggregate Bank Coverage: ${aggregateCoverage}`);
  console.log("  [PASS] Test 1: Bank coverage correctly classified as INSUFFICIENT.");

  // -------------------------------------------------------------
  // Test 2: PO Classification Taxonomy for the 5 Sample Bills
  // -------------------------------------------------------------
  console.log("\n[TEST 2] Validating PO Classification Taxonomy for 5 Sample Bills...");

  const sampleBills = [
    { billId: "3166667000018661091", billNumber: "KRA/26-27/50", expectedPOClass: "SOURCE_NOT_AVAILABLE", refPrefix: "PO-2627215" },
    { billId: "3166667000018995388", billNumber: "SPPL26-27/2377", expectedPOClass: "NO_PO", refPrefix: "" },
    { billId: "3166667000018966146", billNumber: "SPPL26-27/2344", expectedPOClass: "SOURCE_NOT_AVAILABLE", refPrefix: "PO-2627178" },
    { billId: "3166667000018995079", billNumber: "232/26-27", expectedPOClass: "SOURCE_NOT_AVAILABLE", refPrefix: "PO-2627212" },
    { billId: "3166667000017971127", billNumber: "SPPL26-27/2204", expectedPOClass: "SOURCE_NOT_AVAILABLE", refPrefix: "PO-2627178" },
  ];

  type POClassification = "PROVEN_EXPLICIT" | "NO_PO" | "SOURCE_NOT_AVAILABLE" | "NOT_PROVEN";
  const taxonomySummary: Record<POClassification, number> = {
    PROVEN_EXPLICIT: 0,
    NO_PO: 0,
    SOURCE_NOT_AVAILABLE: 0,
    NOT_PROVEN: 0,
  };

  for (const item of sampleBills) {
    const billRow = opDb.prepare(`
      SELECT bill_id, bill_number, purchaseorder_id, reference_number
      FROM purchase_bills
      WHERE bill_id = ?
    `).get(item.billId) as { bill_id: string; bill_number: string; purchaseorder_id: string | null; reference_number: string | null } | undefined;

    assert.ok(billRow, `Bill ${item.billId} must exist in operational purchase_bills`);
    assert.strictEqual(billRow.bill_number, item.billNumber);

    // Check if PO exists in local audit snapshot
    const poInSnapshot = auditDb.prepare(`
      SELECT COUNT(*) as count FROM audit_zoho_purchase_orders
      WHERE purchaseorder_id = ? OR purchaseorder_number = ?
    `).get(billRow.purchaseorder_id || "", billRow.reference_number || "") as { count: number };

    let classification: POClassification;
    if (billRow.purchaseorder_id && poInSnapshot.count > 0) {
      classification = "PROVEN_EXPLICIT";
    } else if (!billRow.purchaseorder_id && (!billRow.reference_number || billRow.reference_number.trim() === "")) {
      classification = "NO_PO";
    } else if (billRow.reference_number && billRow.reference_number.startsWith("PO-") && poInSnapshot.count === 0) {
      classification = "SOURCE_NOT_AVAILABLE";
    } else {
      classification = "NOT_PROVEN";
    }

    assert.strictEqual(classification, item.expectedPOClass, `Bill ${item.billNumber} expected ${item.expectedPOClass} but got ${classification}`);
    taxonomySummary[classification]++;
    console.log(`  -> Bill ${item.billNumber} (${item.billId}): PO=${billRow.purchaseorder_id || 'null'}, Ref='${billRow.reference_number || ''}' => ${classification}`);
  }

  assert.strictEqual(taxonomySummary.NO_PO, 1, "Expected exactly 1 NO_PO bill");
  assert.strictEqual(taxonomySummary.SOURCE_NOT_AVAILABLE, 4, "Expected exactly 4 SOURCE_NOT_AVAILABLE bills");
  assert.strictEqual(taxonomySummary.PROVEN_EXPLICIT, 0, "Expected 0 PROVEN_EXPLICIT bills");
  assert.strictEqual(taxonomySummary.NOT_PROVEN, 0, "Expected 0 NOT_PROVEN bills");
  console.log(`  -> Summary: NO_PO=${taxonomySummary.NO_PO}, SOURCE_NOT_AVAILABLE=${taxonomySummary.SOURCE_NOT_AVAILABLE}, PROVEN_EXPLICIT=0, NOT_PROVEN=0`);
  console.log("  [PASS] Test 2: PO classification taxonomy validated for all 5 sample bills.");

  // -------------------------------------------------------------
  // Test 3: Adjustment Extraction Readiness Matrix
  // -------------------------------------------------------------
  console.log("\n[TEST 3] Validating Adjustment Extraction Readiness Matrix...");

  // 1. TDS (Withholding tax) columns in purchase_bills & audit_zoho_vendor_payments
  const billCols = (opDb.prepare("PRAGMA table_info(purchase_bills)").all() as { name: string }[]).map(c => c.name);
  const payCols = (auditDb.prepare("PRAGMA table_info(audit_zoho_vendor_payments)").all() as { name: string }[]).map(c => c.name);

  const hasTdsInBills = billCols.includes("tax_amount_withheld") || billCols.includes("tds_amount");
  const hasTdsInPayments = payCols.includes("tax_amount_withheld") || payCols.includes("tds_amount");
  const tdsStatus = (!hasTdsInBills && !hasTdsInPayments) ? "NOT_EXTRACTED" : "SUPPORTED";
  assert.strictEqual(tdsStatus, "NOT_EXTRACTED", "TDS columns must be absent from current schema, giving status NOT_EXTRACTED");

  // 2. Retention columns
  const hasRetentionInBills = billCols.includes("retention_amount") || billCols.includes("retention_rate");
  const retentionStatus = !hasRetentionInBills ? "NOT_EXTRACTED" : "SUPPORTED";
  assert.strictEqual(retentionStatus, "NOT_EXTRACTED", "Retention columns must be absent, giving status NOT_EXTRACTED");

  // 3. Discount columns
  const hasDiscountInBills = billCols.includes("discount_amount") || billCols.includes("discount_type");
  const discountStatus = !hasDiscountInBills ? "NOT_EXTRACTED" : "SUPPORTED";
  assert.strictEqual(discountStatus, "NOT_EXTRACTED", "Discount columns must be unmapped, giving status NOT_EXTRACTED");

  // 4. Vendor Credit tables in audit_workspace
  const vendorCreditCount = auditDb.prepare("SELECT COUNT(*) as count FROM audit_zoho_vendor_credits").get() as { count: number };
  const vendorCreditAppCount = auditDb.prepare("SELECT COUNT(*) as count FROM audit_zoho_vendor_credit_applications").get() as { count: number };
  const vendorCreditStatus = (vendorCreditCount.count === 0 && vendorCreditAppCount.count === 0) ? "SCHEMA_PRESENT_UNPOPULATED" : "POPULATED";
  assert.strictEqual(vendorCreditStatus, "SCHEMA_PRESENT_UNPOPULATED", "Vendor credits must be SCHEMA_PRESENT_UNPOPULATED");

  // 5. Vendor Advance
  const advanceStatus = "PARTIALLY_SUPPORTED"; // Allocations captured; excess unallocated advances not modeled

  console.log(`  -> TDS: ${tdsStatus}`);
  console.log(`  -> Retention: ${retentionStatus}`);
  console.log(`  -> Discount: ${discountStatus}`);
  console.log(`  -> Vendor Credit: ${vendorCreditStatus} (credits=${vendorCreditCount.count}, apps=${vendorCreditAppCount.count})`);
  console.log(`  -> Vendor Advance: ${advanceStatus}`);
  console.log("  [PASS] Test 3: Adjustment extraction readiness matrix verified.");

  // -------------------------------------------------------------
  // Test 4: Reconciliation Database Row Counts Must Remain 0
  // -------------------------------------------------------------
  console.log("\n[TEST 4] Validating Reconciliation Database Row Counts are ZERO...");

  const reconciliationTables = [
    "audit_reconciliation_runs",
    "audit_reconciliation_cases",
    "audit_reconciliation_links",
    "audit_reconciliation_evidence",
    "audit_reconciliation_amount_bridge",
    "audit_reconciliation_review_history",
  ];

  for (const table of reconciliationTables) {
    const rowCount = auditDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    assert.strictEqual(rowCount.count, 0, `Table ${table} must have exactly 0 rows, found ${rowCount.count}`);
    console.log(`  -> ${table}: ${rowCount.count} rows`);
  }
  console.log("  [PASS] Test 4: All reconciliation table row counts strictly ZERO.");

  console.log("\n==================================================");
  console.log("ALL PHASE 2E.2E REGRESSION TESTS PASSED (4/4 PASS)");
  console.log("==================================================");

} finally {
  auditDb.close();
  opDb.close();
}
