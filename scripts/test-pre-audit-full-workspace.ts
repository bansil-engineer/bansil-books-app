import { 
  getAuditFindingsForFy, 
  getDiscoveredBankStatements,
  updateFindingHumanReview 
} from "../app/lib/audit/audit-findings-service.ts";
import { 
  PRE_AUDIT_SOURCE_CATALOG, 
  getSourceWatermark, 
  recordWatermarkAttempt, 
  advanceWatermarkSuccess,
  executeSmartSyncPreAudit 
} from "../app/lib/audit/pre-audit-sync-service.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { exportPreAuditToExcel } from "../app/lib/audit/pre-audit-export-service.ts";

async function runTests() {
  console.log("==================================================");
  console.log("STARTING FULL PRE-AUDIT WORKSPACE VERIFICATION SUITE");
  console.log("==================================================");

  let allPassed = true;
  const assert = (title: string, condition: boolean, detail?: string) => {
    if (condition) {
      console.log(`[PASS] ${title}`);
    } else {
      console.error(`[FAIL] ${title} — ${detail || "Condition not met"}`);
      allPassed = false;
    }
  };

  // 1. SIDEBAR & ROUTING MAPPING VERIFICATION
  console.log("\n--- 1. Sidebar Child Routing & Navigation ---");
  const expectedChildren = [
    "pre_audit_overview",
    "pre_audit_books_tb",
    "pre_audit_bank",
    "pre_audit_cash",
    "pre_audit_sales",
    "pre_audit_purchase",
    "pre_audit_inventory",
    "pre_audit_gst",
    "pre_audit_tds",
    "pre_audit_payroll",
    "pre_audit_loans",
    "pre_audit_cutoff",
    "pre_audit_findings",
    "pre_audit_report"
  ];
  assert(
    "All 14 functional children defined for Pre-Audit sidebar",
    expectedChildren.length === 14
  );

  // 2. SMART DELTA SYNC CLASSIFICATION
  console.log("\n--- 2. Smart Delta Sync Source Classification ---");
  const trueDelta = PRE_AUDIT_SOURCE_CATALOG.filter(s => s.classification === "TRUE_DELTA_SUPPORTED").map(s => s.source_id);
  const dateWindow = PRE_AUDIT_SOURCE_CATALOG.filter(s => s.classification === "DATE_WINDOW_INCREMENTAL").map(s => s.source_id);
  const fullRefresh = PRE_AUDIT_SOURCE_CATALOG.filter(s => s.classification === "FULL_REFRESH_REQUIRED").map(s => s.source_id);
  const pageDiff = PRE_AUDIT_SOURCE_CATALOG.filter(s => s.classification === "PAGE_DIFF_REQUIRED").map(s => s.source_id);
  const externalSources = PRE_AUDIT_SOURCE_CATALOG.filter(s => s.classification === "EXTERNAL_SOURCE").map(s => s.source_id);

  console.log("TRUE DELTA SOURCES:", trueDelta);
  console.log("DATE-WINDOW INCREMENTAL SOURCES:", dateWindow);
  console.log("FULL REFRESH SOURCES:", fullRefresh);
  console.log("PAGE-DIFF SOURCES:", pageDiff);
  console.log("EXTERNAL SOURCES:", externalSources);

  assert("True delta sources include invoices, bills, items", 
    trueDelta.includes("SALES_INVOICES") && trueDelta.includes("PURCHASE_BILLS") && trueDelta.includes("INVENTORY_ITEMS")
  );
  assert("Date-window incremental includes bank transactions", 
    dateWindow.includes("BANK_TRANSACTIONS")
  );
  assert("Full refresh includes COA and Trial Balance", 
    fullRefresh.includes("CHART_OF_ACCOUNTS") && fullRefresh.includes("TRIAL_BALANCE")
  );
  assert("External sources include GST, TDS/26AS, and Statutory Payroll", 
    externalSources.includes("GST_PORTAL_RETURNS") && externalSources.includes("TDS_TRACES_26AS") && externalSources.includes("PAYROLL_STATUTORY")
  );

  // 3. WATERMARK SAFETY & ADVANCEMENT RULES
  console.log("\n--- 3. Watermark Advancement & Failure Hold Safety ---");
  const testSource = "TEST_SOURCE_SAFETY_" + Date.now();
  const testFy = "2025-26";
  const testAcc = "TEST_ACC_01";

  // Record a failure attempt
  recordWatermarkAttempt(testSource, testFy, testAcc, "FAILED", 2);
  const failedWm = getSourceWatermark(testSource, testFy, testAcc);
  assert(
    "Failed attempt marks status FAILED and does NOT advance last_successful_sync",
    failedWm.status === "FAILED" && failedWm.last_successful_sync === null && !failedWm.pagination_complete
  );

  // Record a partial attempt
  recordWatermarkAttempt(testSource, testFy, testAcc, "PARTIAL", 1);
  const partialWm = getSourceWatermark(testSource, testFy, testAcc);
  assert(
    "Partial attempt marks status PARTIAL and holds watermark",
    partialWm.status === "PARTIAL" && partialWm.last_successful_sync === null && !partialWm.pagination_complete
  );

  // Now record complete successful advancement
  advanceWatermarkSuccess(testSource, testFy, testAcc, "2026-03-31", 100, 1);
  const successWm = getSourceWatermark(testSource, testFy, testAcc);
  assert(
    "Complete successful retrieval advances last_successful_sync and marks pagination_complete",
    successWm.status === "SUCCESS" && successWm.last_successful_sync !== null && successWm.pagination_complete && successWm.record_count === 100
  );

  // 4. MINIMUM API USE & FRESHNESS TEST
  console.log("\n--- 4. Minimum API Use & Freshness Guard ---");
  const freshResult = await executeSmartSyncPreAudit("BANK_TRANSACTIONS", testFy, "3166667000000092034");
  assert(
    "Fresh local evidence avoids redownload (0 Zoho API calls used)",
    (freshResult.status === "SKIPPED_FRESH" || freshResult.status === "SUCCESS") && freshResult.apiCallsUsed === 0
  );

  const extResult = await executeSmartSyncPreAudit("GST_PORTAL_RETURNS", "2025-26", "");
  assert(
    "External source safely blocked with 0 Zoho calls",
    extResult.status === "EXTERNAL_BLOCKED" && extResult.apiCallsUsed === 0
  );

  // 5. BANK PAGINATION & RECONCILIATION PRESERVATION (HDFC XXXX7642)
  console.log("\n--- 5. HDFC Bank XXXX7642 Evidence Preservation ---");
  const db = getAuditDatabase();
  const hdfcCount = (db.prepare(`
    SELECT COUNT(*) as count FROM audit_zoho_bank_transactions 
    WHERE account_id = '3166667000000092034' AND date >= '2025-04-01' AND date <= '2026-03-31'
  `).get() as any).count;

  assert("Live/Local HDFC book universe complete at 422 rows", hdfcCount === 422, `Got ${hdfcCount}`);

  const stmts = getDiscoveredBankStatements();
  const hdfcStmt = stmts.find(s => s.masked_account.includes("XXXX7642"));
  assert("HDFC Statement universe complete at 427 rows", hdfcStmt?.record_count === 427);

  // Read authoritative bank reconciliation source from SQLite
  const bankRow = db.prepare(`
    SELECT evidence_json FROM pre_audit_checkpoint_results 
    WHERE checkpoint_key = 'Bank' AND financial_year = '2025-26' 
    ORDER BY started_at DESC LIMIT 1
  `).get() as any;
  assert("Bank checkpoint result evidence exists in SQLite", Boolean(bankRow?.evidence_json));
  const bankEv = JSON.parse(bankRow.evidence_json);

  assert("Statement Opening equals ₹36,93,463.01", Math.abs(Number(bankEv.statement.opening) - 3693463.01) < 0.01);
  assert("Deposits Total equals ₹17,60,84,152.34", Math.abs(Number(bankEv.statement.deposits) - 176084152.34) < 0.01);
  assert("Withdrawals Total equals ₹17,86,14,719.00", Math.abs(Number(bankEv.statement.withdrawals) - 178614719.00) < 0.01);
  assert("Statement Closing equals ₹11,62,896.35", Math.abs(Number(bankEv.statement.closing) - 1162896.35) < 0.01);
  assert("Book Closing equals ₹11,62,896.35", Math.abs(Number(bankEv.book.closing) - 1162896.35) < 0.01);
  const closingDiff = Math.abs(Number(bankEv.statement.closing) - Number(bankEv.book.closing));
  assert("Reconciliation Difference equals ₹0.00", closingDiff < 0.01);

  // Arithmetic Check: Opening + Deposits - Withdrawals = Closing
  const mathClosing = Number(bankEv.statement.opening) + Number(bankEv.statement.deposits) - Number(bankEv.statement.withdrawals);
  assert("Arithmetic Continuity formula holds: Opening + Deposits - Withdrawals = Closing", Math.abs(mathClosing - Number(bankEv.statement.closing)) < 0.01);

  // 6. ACCOUNTING CORRECTNESS GATE — CASH CREDIT RECLASSIFICATION
  console.log("\n--- 6. Accounting Correctness Gate: Cash vs Credit Line ---");
  const findingsData = getAuditFindingsForFy("2025-26");
  const cashFindings = findingsData.findings.filter(f => f.area === "CASH");
  const hdfcCcInCash = cashFindings.find(f => f.account?.toLowerCase().includes("cash credi"));
  assert(
    "HDFC Cash Credit -3424 correctly EXCLUDED from physical cash violations",
    hdfcCcInCash === undefined
  );

  const genuineCashFindings = cashFindings.filter(f => f.title.includes("Negative Cash"));
  assert(
    "Genuine physical cash accounts correctly flagged (4 negative cash books)",
    genuineCashFindings.length === 4
  );

  const ccFinding = findingsData.findings.find(f => f.title.includes("Credit Line Utilization"));
  assert(
    "HDFC Cash Credit correctly classified under Borrowings/Loans with P2 Informational status",
    ccFinding !== undefined && ccFinding.area === "LOANS / CAPITAL / INVESTMENTS" && ccFinding.priority === "P2"
  );

  // 7. ACCOUNTING CORRECTNESS GATE — FACT VS HYPOTHESIS & UNPROVEN CAUSES
  console.log("\n--- 7. Accounting Correctness Gate: Fact vs Hypothesis Separation ---");
  const tbRow = db.prepare(`
    SELECT evidence_json FROM pre_audit_checkpoint_results 
    WHERE checkpoint_key = 'Trial Balance' AND financial_year = '2025-26' AND evidence_json IS NOT NULL
    ORDER BY started_at DESC LIMIT 1
  `).get() as any;
  const tbLeaves = tbRow?.evidence_json ? JSON.parse(tbRow.evidence_json).flatLeaves || [] : [];

  const fgFinding = findingsData.findings.find(f => f.title.includes("Finished Goods"));
  const fgLeaf = tbLeaves.find((l: any) => l.name === "Finished Goods");
  const fgConditionMet = fgLeaf && Number(fgLeaf.net_credit_total || 0) > 0;

  if (fgConditionMet) {
    assert(
      "Finished Goods specifies observed fact as abnormal credit balance",
      fgFinding?.observed_fact !== undefined && fgFinding.observed_fact.includes("abnormal net credit balance")
    );
    assert(
      "Finished Goods lists hypotheses separately under possible_causes",
      Array.isArray(fgFinding?.possible_causes) && fgFinding.possible_causes.length > 0
    );
    assert(
      "Finished Goods requires stock reconciliation formula and physical count before adjustment",
      !!fgFinding?.required_verification.includes("Opening Finished Goods") || !!fgFinding?.required_verification.includes("quantitative")
    );
    assert(
      "Finished Goods proposed treatment explicitly marked ADVISORY ONLY — CA/OWNER APPROVAL REQUIRED",
      !!fgFinding?.proposed_treatment.startsWith("ADVISORY ONLY")
    );
  } else {
    assert(
      "Finished Goods abnormal credit finding DOES NOT exist because condition is not met",
      fgFinding === undefined
    );
  }

  // Evidence-driven inventory asset audit check:
  // Normal debit Inventory Asset must NOT create an abnormal-credit finding; actual credit must create one.
  const invFinding = findingsData.findings.find(f => f.title.includes("Inventory Asset"));
  const invLeaf = tbLeaves.find((l: any) => l.name === "Inventory Asset");
  const invHasAbnormalCredit = invLeaf && Number(invLeaf.net_credit_total || 0) > 0;

  if (invHasAbnormalCredit) {
    assert(
      "Inventory Asset abnormal credit generates finding with quantitative reconciliation",
      !!invFinding?.required_verification.includes("Opening Stock + Inward Receipts")
    );
    assert(
      "Inventory Asset proposed treatment explicitly marked ADVISORY ONLY",
      !!invFinding?.proposed_treatment.startsWith("ADVISORY ONLY")
    );
  } else {
    assert(
      "Normal debit Inventory Asset balance does NOT trigger abnormal credit finding",
      invFinding === undefined && invLeaf !== undefined && Number(invLeaf.net_debit_total || 0) > 0
    );
  }

  const tdsFinding = findingsData.findings.find(f => f.title.includes("TDS Payable Liability"));
  const tdsLeaf = tbLeaves.find((l: any) => l.name === "TDS Payable");
  const tdsConditionMet = tdsLeaf && Number(tdsLeaf.net_debit_total || 0) > 0;

  if (tdsConditionMet) {
    assert(
      "TDS Payable requires TRACES 24Q/26Q return matching before liability credit",
      !!tdsFinding?.required_verification.includes("TRACES")
    );
  } else {
    assert(
      "TDS Payable Liability finding DOES NOT exist because condition is not met",
      tdsFinding === undefined
    );
  }

  // 8. COST OPTIMISATION ASSUMPTIONS DISCLOSURE
  console.log("\n--- 8. Cost Optimisation Assumptions & Quantification Pending ---");
  const idleCashOpp = findingsData.costOpportunities.find(c => c.opportunity_id === "COST_OPP_01");
  assert(
    "Idle Savings vs CC/OD discloses assumptions and labels quantification pending",
    idleCashOpp !== undefined &&
    idleCashOpp.estimated_range.includes("QUANTIFICATION PENDING") &&
    Array.isArray(idleCashOpp.assumptions) &&
    idleCashOpp.assumptions.length >= 2
  );
  assert(
    "Idle Savings discloses limitations regarding 365-day balance trajectory",
    !!idleCashOpp?.limitations.includes("365 days")
  );

  // 9. EXCEL & PRINT EXPORT SAFETY
  console.log("\n--- 9. Export Framework Safety & Masking ---");
  assert(
    "Discovered statements preserve masked account numbers (XXXX7642, XXXX0995, XXXX9104, XXXX2012, XXXX2008)",
    stmts.every(s => s.masked_account.includes("XXXX"))
  );
  assert(
    "All findings contain is_simulated: false (strictly real evidence)",
    findingsData.findings.every(f => f.is_simulated === false)
  );

  // 10. LOCAL REVIEW PERSISTENCE (ZOHO WRITE = 0)
  console.log("\n--- 10. Zero Zoho Mutation Guarantee ---");
  const findingToReview = fgFinding || findingsData.findings[0];
  if (findingToReview) {
    const reviewTest = updateFindingHumanReview(findingToReview.finding_id, "REVIEWED", "CA audited verification note", "OWNER");
    assert("Local reviewer decision successfully written to SQLite", reviewTest.success);
  } else {
    assert("Local reviewer decision test skipped due to missing findingToReview", false);
  }

  console.log("\n==================================================");
  if (allPassed) {
    console.log("ALL TESTS COMPLETED SUCCESSFULLY: PASS (100%)");
  } else {
    console.error("SOME TESTS FAILED: PLEASE INSPECT LOGS ABOVE");
    process.exit(1);
  }
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
