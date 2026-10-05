import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import type { AuthoritativeHdfcSource } from "../app/lib/audit/authoritative-hdfc-source.ts";
import { 
  getAuthoritativeHdfcSource, 
  getAuthoritativeEntityContext, 
  formatINR 
} from "../app/lib/audit/authoritative-hdfc-source.ts";
import { 
  createBankReconciliationWorkbook, 
  createPreAuditWorkbook 
} from "../app/lib/audit/pre-audit-export-service.ts";
import { buildPreAuditReportPdf } from "../app/lib/audit/export/pre-audit-pdf-builder.ts";
import { getAuditFindingsForFy } from "../app/lib/audit/audit-findings-service.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

async function runStage4IntegrityGate() {
  console.log("==================================================");
  console.log("FINAL STAGE-4 REPORT INTEGRITY GATE — VERIFICATION");
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

  // ---------------------------------------------------------
  // 1. AUTHORITATIVE HDFC BASELINE & ARITHMETIC ASSERTIONS
  // ---------------------------------------------------------
  console.log("\n--- 1. HDFC Pilot Baseline & Arithmetic Assertions ---");
  const hdfc = getAuthoritativeHdfcSource("2025-26");

  assert("Statement transaction count equals 427", hdfc.statementRows === 427, `Got ${hdfc.statementRows}`);
  assert("Book transaction count equals 422", hdfc.bookRows === 422, `Got ${hdfc.bookRows}`);
  assert("Statement Opening equals ₹36,93,463.01", Math.abs(hdfc.openingBalance - 3693463.01) < 0.01, `Got ${hdfc.openingBalance}`);
  assert("Deposits Total equals ₹17,60,84,152.34", Math.abs(hdfc.depositsTotal - 176084152.34) < 0.01, `Got ${hdfc.depositsTotal}`);
  assert("Withdrawals Total equals ₹17,86,14,719.00", Math.abs(hdfc.withdrawalsTotal - 178614719.00) < 0.01, `Got ${hdfc.withdrawalsTotal}`);
  assert("Statement Closing equals ₹11,62,896.35", Math.abs(hdfc.statementClosingBalance - 1162896.35) < 0.01, `Got ${hdfc.statementClosingBalance}`);
  assert("Book Closing equals ₹11,62,896.35", Math.abs(hdfc.bookClosingBalance - 1162896.35) < 0.01, `Got ${hdfc.bookClosingBalance}`);
  assert("Closing Difference equals ₹0.00", hdfc.closingDifference === 0, `Got ${hdfc.closingDifference}`);

  // Arithmetic Formula: Opening + Deposits - Withdrawals = Closing
  const calculatedClosing = hdfc.openingBalance + hdfc.depositsTotal - hdfc.withdrawalsTotal;
  const arithmeticDiff = Math.abs(calculatedClosing - hdfc.statementClosingBalance);
  console.log(`Calculated Closing: ${calculatedClosing.toFixed(2)} | Statement Closing: ${hdfc.statementClosingBalance.toFixed(2)} | Discrepancy: ${arithmeticDiff.toFixed(2)}`);
  assert(
    "Arithmetic formula: Opening + Deposits - Withdrawals = Closing holds (0.00 discrepancy)",
    arithmeticDiff < 0.01 && hdfc.arithmeticContinuityPass
  );

  // Resolution breakdown checks
  assert("Direct Matches equals 413", hdfc.directMatches === 413, `Got ${hdfc.directMatches}`);
  assert("Grouped Receipts equals 4 cases (9 statement components)", hdfc.groupedCases === 4 && hdfc.groupedStatementComponents === 9);
  assert("Human Resolved transfers equals 5", hdfc.humanResolved === 5, `Got ${hdfc.humanResolved}`);
  assert("Unresolved Residual Rows equals 0", hdfc.unresolvedRows === 0, `Got ${hdfc.unresolvedRows}`);
  assert("Audit Coverage equals 100.0%", hdfc.coveragePct === 100.0, `Got ${hdfc.coveragePct}`);

  // ---------------------------------------------------------
  // 2. ENTITY IDENTITY TEST
  // ---------------------------------------------------------
  console.log("\n--- 2. Entity Identity Test ---");
  const entity = getAuthoritativeEntityContext();
  assert("Entity Name is 'Bansil Engineers'", entity.entityName === "Bansil Engineers");
  assert("Entity Type is 'Proprietorship'", entity.entityType === "Proprietorship");

  // Verify that "Bansil Books Private Limited" does not appear in source files
  const checkedFiles = [
    "app/lib/audit/authoritative-hdfc-source.ts",
    "app/lib/audit/pre-audit-export-service.ts",
    "app/lib/audit/export/pre-audit-pdf-builder.ts",
    "app/components/pre-audit/PreAuditReportTab.tsx",
    "app/components/pre-audit/PreAuditOverviewTab.tsx",
    "app/components/pre-audit/PreAuditBankTab.tsx",
    "app/lib/audit/pre-audit-engine.ts"
  ];

  let oldNameFound = false;
  for (const relPath of checkedFiles) {
    const fullPath = path.join(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      if (content.toLowerCase().includes("bansil books private limited")) {
        console.error(`Found 'Bansil Books Private Limited' in ${relPath}`);
        oldNameFound = true;
      }
    }
  }
  assert("Zero instances of 'Bansil Books Private Limited' in codebase components", !oldNameFound);

  // ---------------------------------------------------------
  // 3. REPORT NUMERIC-SOURCE & FALLBACK TEST
  // ---------------------------------------------------------
  console.log("\n--- 3. Report Numeric-Source & Fallback Test ---");
  assert("formatINR(undefined) falls back to 'NOT AVAILABLE'", formatINR(undefined) === "NOT AVAILABLE");
  assert("formatINR(null) falls back to 'NOT AVAILABLE'", formatINR(null) === "NOT AVAILABLE");
  assert("formatINR('') falls back to 'NOT AVAILABLE'", formatINR("") === "NOT AVAILABLE");
  assert("formatINR(NaN) falls back to 'NOT AVAILABLE'", formatINR(NaN) === "NOT AVAILABLE");
  assert("formatINR(1162896.35) returns valid INR string", formatINR(1162896.35).includes("11,62,896.35"));

  // ---------------------------------------------------------
  // 4. CROSS-SURFACE CONSISTENCY TEST
  // ---------------------------------------------------------
  console.log("\n--- 4. Cross-Surface Consistency Test ---");
  // Check SQLite DB
  const db = getAuditDatabase();
  const dbRow = db.prepare(`
    SELECT evidence_json FROM pre_audit_checkpoint_results 
    WHERE checkpoint_key = 'Bank' AND financial_year = '2025-26' 
    ORDER BY started_at DESC LIMIT 1
  `).get() as any;

  assert("SQLite pre_audit_checkpoint_results contains Bank evidence", Boolean(dbRow?.evidence_json));
  const parsedDb = JSON.parse(dbRow.evidence_json);

  // Assert Bank UI / Overview / Report / Excel / PDF all draw from identical values
  assert(
    "SQLite DB evidence matches Authoritative Source exactly (Statement: 427, Book: 422)",
    parsedDb.statement.count === hdfc.statementRows && parsedDb.book.count === hdfc.bookRows
  );
  assert(
    "SQLite DB balances match Authoritative Source exactly (Opening: ₹36.93L, Closing: ₹11.62L)",
    parsedDb.statement.opening === hdfc.openingBalance && parsedDb.statement.closing === hdfc.statementClosingBalance
  );

  // ---------------------------------------------------------
  // 5. EXCEL EXPORT TEST
  // ---------------------------------------------------------
  console.log("\n--- 5. Excel Export Test ---");
  const excelWb = createBankReconciliationWorkbook(hdfc);
  const excelPath = path.join(process.cwd(), "data", "test_stage4_bank_recon.xlsx");
  XLSX.writeFile(excelWb, excelPath);

  assert("Excel export file created successfully", fs.existsSync(excelPath));
  const fileBuf = fs.readFileSync(excelPath);
  const readWb = XLSX.read(fileBuf, { type: "buffer" });
  assert("Excel contains 'HDFC Recon Summary' sheet", readWb.SheetNames.includes("HDFC Recon Summary"));
  assert("Excel contains 'Transaction Matches' sheet", readWb.SheetNames.includes("Transaction Matches"));

  const summarySheet = readWb.Sheets["HDFC Recon Summary"];
  const summaryJson: any[][] = XLSX.utils.sheet_to_json(summarySheet, { header: 1 });

  // Verify Entity & Entity Type in Excel
  const entityRow = summaryJson.find(r => r[0] === "ENTITY");
  const entityTypeRow = summaryJson.find(r => r[0] === "ENTITY TYPE");
  assert("Excel Metadata has ENTITY = 'Bansil Engineers'", entityRow?.[1] === "Bansil Engineers");
  assert("Excel Metadata has ENTITY TYPE = 'Proprietorship'", entityTypeRow?.[1] === "Proprietorship");

  // Verify HDFC Totals in Excel
  const openRow = summaryJson.find(r => r[0] === "Opening Balance");
  const depRow = summaryJson.find(r => r[0] === "Total Deposits / Receipts");
  const withRow = summaryJson.find(r => r[0] === "Total Withdrawals / Payments");
  const closeRow = summaryJson.find(r => r[0] === "Closing Balance (31/03/2026)");

  assert("Excel Opening Balance matches ₹36,93,463.01", Math.abs(Number(openRow?.[1]) - 3693463.01) < 0.01);
  assert("Excel Deposits match ₹17,60,84,152.34", Math.abs(Number(depRow?.[1]) - 176084152.34) < 0.01);
  assert("Excel Withdrawals match ₹17,86,14,719.00", Math.abs(Number(withRow?.[1]) - 178614719.00) < 0.01);
  assert("Excel Closing Balance matches ₹11,62,896.35", Math.abs(Number(closeRow?.[1]) - 1162896.35) < 0.01);

  // ---------------------------------------------------------
  // 6. PDF REPORT-DATA TEST
  // ---------------------------------------------------------
  console.log("\n--- 6. PDF Report-Data Test ---");
  const pdfBuffer = buildPreAuditReportPdf(hdfc);
  const pdfPath = path.join(process.cwd(), "data", "test_stage4_report_only.pdf");
  fs.writeFileSync(pdfPath, pdfBuffer);

  assert("PDF report file created successfully", fs.existsSync(pdfPath));
  assert("PDF begins with valid header '%PDF-1.4'", pdfBuffer.toString("latin1", 0, 8).startsWith("%PDF-1.4"));
  assert("PDF ends with '%%EOF'", pdfBuffer.toString("latin1").includes("%%EOF"));

  const pdfText = pdfBuffer.toString("latin1");
  assert("PDF contains Entity Name 'Bansil Engineers'", pdfText.includes("Bansil Engineers"));
  assert("PDF contains Entity Type 'Proprietorship'", pdfText.includes("Proprietorship"));
  assert("PDF contains Statement Rows '427 rows'", pdfText.includes("427 rows"));
  assert("PDF contains Book Rows '422 rows'", pdfText.includes("422 rows"));
  assert("PDF contains Opening Balance '36,93,463.01'", pdfText.includes("36,93,463.01"));
  assert("PDF contains Deposits Total '17,60,84,152.34'", pdfText.includes("17,60,84,152.34"));
  assert("PDF contains Withdrawals Total '17,86,14,719.00'", pdfText.includes("17,86,14,719.00"));
  assert("PDF contains Statement Closing '11,62,896.35'", pdfText.includes("11,62,896.35"));
  assert("PDF contains Variance 'Rs. 0.00'", pdfText.includes("Rs. 0.00"));
  assert("PDF contains 'CONTINUITY PASS'", pdfText.includes("CONTINUITY PASS"));

  // Verify that website chrome is NOT present in PDF
  assert("PDF excludes sidebar", !pdfText.toLowerCase().includes("sidebar-nav"));
  assert("PDF excludes site header", !pdfText.toLowerCase().includes("site header"));
  assert("PDF excludes sync controls", !pdfText.toLowerCase().includes("smart sync all"));

  console.log("\n==================================================");
  if (allPassed) {
    console.log("STAGE-4 REPORT INTEGRITY GATE: ALL TESTS PASS");
  } else {
    console.error("STAGE-4 REPORT INTEGRITY GATE: FAILURES DETECTED");
    process.exit(1);
  }
  console.log("==================================================");
}

runStage4IntegrityGate().catch(err => {
  console.error("Stage 4 Integrity Gate execution failed:", err);
  process.exit(1);
});
