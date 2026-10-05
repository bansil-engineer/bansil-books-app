import { getZohoTrialBalance } from "../app/lib/audit/accounts/zoho-reports-source";
import { listChartOfAccounts } from "../app/lib/audit/accounts/zoho-read-source";
import { getAuditDatabase, updateCheckpointHumanReviewStatus } from "../app/lib/db/audit-database";
import { randomUUID } from "node:crypto";
import { checkChartOfAccounts, checkTrialBalance, checkAccountingEquation } from "../app/lib/audit/pre-audit-engine";

async function runTests() {
  console.log("=== PHASE 2A AUTOMATED TESTS ===");
  let failures = 0;
  const testRunId = "test-" + randomUUID();

  // Test 1: No Hardcoded Org ID in zoho-reports-source.ts and zoho-read-source.ts
  const fs = require('fs');
  const source1 = fs.readFileSync("app/lib/audit/accounts/zoho-reports-source.ts", "utf-8");
  const source2 = fs.readFileSync("app/lib/audit/accounts/zoho-read-source.ts", "utf-8");
  
  if (source1.includes("60029517173") || source2.includes("60029517173")) {
    console.log("❌ FAILED: Hardcoded Org ID '60029517173' found in source files.");
    failures++;
  } else {
    console.log("✅ PASSED: No hardcoded Org ID in source files.");
  }

  if (source1.match(/method:\s*['"]POST['"]/i) || source2.match(/method:\s*['"]POST['"]/i)) {
    console.log("❌ FAILED: Found POST method. ZOHO WRITE = 0 violated.");
    failures++;
  } else {
    console.log("✅ PASSED: ZOHO WRITE = 0 (GET only).");
  }

  // Use the actual DB but only insert/update test records, then delete ONLY those test records.
  const dbAudit = getAuditDatabase();
  
  try {
    dbAudit.prepare(`
      INSERT INTO pre_audit_runs (run_id, financial_year, process_status, started_at, created_at, updated_at, engine_version)
      VALUES (?, '2025-26', 'IN_PROGRESS', ?, ?, ?, '2.0')
    `).run(testRunId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    console.log("✅ PASSED: Test Run Created.");

    console.log("Testing Checkpoints...");
    await checkChartOfAccounts(testRunId, '2025-26', dbAudit, new Date().toISOString());
    console.log("✅ PASSED: COA Checkpoint executed.");
    
    await checkTrialBalance(testRunId, '2025-26', dbAudit, new Date().toISOString());
    console.log("✅ PASSED: Trial Balance Checkpoint executed.");

    await checkAccountingEquation(testRunId, '2025-26', dbAudit, new Date().toISOString());
    console.log("✅ PASSED: Accounting Equation Checkpoint executed.");
    
    // Check results
    const results = dbAudit.prepare(`SELECT * FROM pre_audit_checkpoint_results WHERE run_id = ?`).all(testRunId) as any[];
    
    const coaRes = results.find(r => r.checkpoint_key === 'Chart of Accounts');
    if (coaRes?.result_status === 'PASS') {
      console.log("✅ PASSED: COA result is PASS. Records:", coaRes.records_checked);
    } else {
      console.log("❌ FAILED: COA result not PASS.");
      failures++;
    }

    const tbRes = results.find(r => r.checkpoint_key === 'Trial Balance');
    if (tbRes?.result_status === 'PASS') {
      console.log("✅ PASSED: Trial Balance result is PASS. Leaf Rows:", tbRes.records_checked);
      const ev = JSON.parse(tbRes.evidence_json);
      if (ev.sourceTotals.diff < 0.01 && ev.crossCheckDiff.debit < 0.01 && ev.crossCheckDiff.credit < 0.01) {
         console.log("✅ PASSED: Trial Balance differences are 0.");
      } else {
         console.log("❌ FAILED: Trial Balance differences not 0.");
         failures++;
      }
    } else {
      console.log("❌ FAILED: Trial Balance result not PASS. STATUS:", tbRes?.result_status);
      failures++;
    }

    const aeRes = results.find(r => r.checkpoint_key === 'Accounting Equation');
    if (aeRes) {
      console.log(`✅ PASSED: Accounting Equation executed (Status: ${aeRes.result_status}, Diff: ${aeRes.exact_difference})`);
    } else {
      console.log("❌ FAILED: Accounting Equation result missing.");
      failures++;
    }

    // Test Human Review
    updateCheckpointHumanReviewStatus(testRunId, 'Trial Balance', 'HUMAN VERIFIED', 'Test Note');
    const updatedTb = dbAudit.prepare(`SELECT * FROM pre_audit_checkpoint_results WHERE run_id = ? AND checkpoint_key = 'Trial Balance'`).get(testRunId) as any;
    if (updatedTb.human_review_status === 'HUMAN VERIFIED' && updatedTb.human_review_note === 'Test Note') {
       console.log("✅ PASSED: Human review local mutation successful.");
    } else {
       console.log("❌ FAILED: Human review local mutation failed.");
       failures++;
    }

  } catch (e: any) {
    console.error("❌ FAILED EXCEPTION:", e.message);
    failures++;
  } finally {
    // Cleanup exactly the test records
    console.log("Cleaning up test records...");
    dbAudit.prepare(`DELETE FROM pre_audit_checkpoint_results WHERE run_id = ?`).run(testRunId);
    dbAudit.prepare(`DELETE FROM pre_audit_runs WHERE run_id = ?`).run(testRunId);
    console.log("Cleanup complete.");
  }

  if (failures > 0) {
    console.log(`\nTESTS FAILED: ${failures} issues found.`);
    process.exit(1);
  } else {
    console.log(`\nALL TESTS PASSED.`);
  }
}

runTests();
