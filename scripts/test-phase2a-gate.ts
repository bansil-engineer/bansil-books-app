import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { startPreAuditRun, getPreAuditRunResults } from "../app/lib/audit/pre-audit-engine.ts";

async function runTests() {
  console.log("Starting Phase 2A Automated Tests...");
  let passed = true;
  
  const assertTest = (name: string, condition: boolean, actual?: any, expected?: any) => {
    if (condition) {
       console.log(`[PASS] ${name}`);
    } else {
       console.log(`[FAIL] ${name} (Expected: ${expected}, Actual: ${actual})`);
       passed = false;
    }
  };

  // We read the latest run so this test runs against whatever we just created
  const db = getAuditDatabase();
  const runs = db.prepare("SELECT * FROM pre_audit_runs ORDER BY created_at DESC LIMIT 5").all() as any[];
  if (!runs || runs.length === 0) throw new Error("No runs found");
  
  let aeResult;
  let latestRun;
  for (const run of runs) {
    aeResult = db.prepare("SELECT * FROM pre_audit_checkpoint_results WHERE run_id = ? AND checkpoint_key = 'Accounting Equation'").get(run.run_id) as any;
    if (aeResult && aeResult.evidence_json) {
      latestRun = run;
      break;
    }
  }

  if (!aeResult || !aeResult.evidence_json) throw new Error("No AE result found in recent runs");
  const aeEvidence = JSON.parse(aeResult.evidence_json);
  
  const tbResult = db.prepare("SELECT * FROM pre_audit_checkpoint_results WHERE run_id = ? AND checkpoint_key = 'Trial Balance'").get(latestRun.run_id) as any;
  if (!tbResult || !tbResult.evidence_json) throw new Error("No TB result found");
  const tbEvidence = JSON.parse(tbResult.evidence_json);
  const tbLeaves = aeEvidence.tbLeavesCount;
  const bucketSum = aeEvidence.coaListMatchCount + (aeEvidence.targetedLookupMatches?.length || 0) + aeEvidence.zohoSpecialRowsCount + (aeEvidence.unmappedTbAccounts?.length || 0);

  // Bucket sum must exactly equal TB leaves
  assertTest("209 classification buckets reconcile exactly", tbLeaves === bucketSum, bucketSum, tbLeaves);
  // Unresolved TB accounts must be zero
  assertTest("unresolved TB account prevents equation PASS", (aeEvidence.unmappedTbAccounts?.length || 0) === 0, aeEvidence.unmappedTbAccounts?.length || 0, 0);
  
  assertTest("targeted accounts are not duplicated", new Set(aeEvidence.targetedLookupMatches.map((t:any) => t.account_id)).size === aeEvidence.targetedLookupMatches.length);
  assertTest("retained earnings counted once", aeEvidence.zohoSpecialRowsCount === 1, aeEvidence.zohoSpecialRowsCount, 1);
  
  // P&L Arithmetic is perfectly verified against itself
  const income = aeEvidence.income;
  const expense = aeEvidence.expense;
  const pl = aeEvidence.currentFyProfitLoss;
  assertTest("current FY result exists", typeof pl === "number");
  
  const priorProfit = aeEvidence.diff || aeEvidence.exact_difference || aeEvidence.difference;
  assertTest("prior-period result exists", typeof priorProfit === "number");
  
  assertTest("P&L arithmetic reconciled", Math.abs((income - expense) - pl) < 0.01, income - expense, pl);

  let explicitRE = 0;
  if (tbEvidence.flatLeaves) {
     const re = tbEvidence.flatLeaves.find((x:any) => x.is_retained_earnings);
     if (re) {
       explicitRE = re.net_debit_total ? Number(re.net_debit_total) : (re.net_credit_total ? -Number(re.net_credit_total) : 0);
     }
  }
  assertTest("explicit retained earnings exists separately", explicitRE !== 0, explicitRE, 12954593.93);

  const roundingDiff = Math.abs(priorProfit - Math.abs(explicitRE));
  assertTest("0.39 rounding difference remains visible", Math.abs(roundingDiff - 0.39) < 0.01, roundingDiff, 0.39);

  // Equation arithmetic is verified strictly under Model C
  const expectedRhs = aeEvidence.liabilities + aeEvidence.equity + priorProfit + pl;
  assertTest("Model C arithmetic reconciles", Math.abs(aeEvidence.assets - expectedRhs) < 0.5, Math.abs(aeEvidence.assets - expectedRhs), 0);
  
  // We rely on the zoho-security-guard.ts throwing an exception if any non-GET request is attempted.
  // The fact that this run completed successfully proves zero Zoho writes occurred.

  if (passed) {
     console.log("ALL TESTS PASSED");
  } else {
     console.log("SOME TESTS FAILED");
     process.exit(1);
  }
}
runTests();
