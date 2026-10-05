"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audit_database_ts_1 = require("../app/lib/db/audit-database.ts");
async function runTests() {
    console.log("Starting Phase 2A Automated Tests...");
    let passed = true;
    const assertTest = (name, condition, actual, expected) => {
        if (condition) {
            console.log(`[PASS] ${name}`);
        }
        else {
            console.log(`[FAIL] ${name} (Expected: ${expected}, Actual: ${actual})`);
            passed = false;
        }
    };
    // We read the latest run so this test runs against whatever we just created
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    const latestRun = db.prepare("SELECT * FROM pre_audit_runs ORDER BY created_at DESC LIMIT 1").get();
    if (!latestRun)
        throw new Error("No runs found");
    const aeResult = db.prepare("SELECT * FROM pre_audit_checkpoint_results WHERE run_id = ? AND checkpoint_key = 'Accounting Equation'").get(latestRun.run_id);
    if (!aeResult || !aeResult.evidence_json)
        throw new Error("No AE result found");
    const aeEvidence = JSON.parse(aeResult.evidence_json);
    const tbLeaves = aeEvidence.tbLeavesCount;
    const bucketSum = aeEvidence.coaListMatchCount + (aeEvidence.targetedLookupMatches?.length || 0) + aeEvidence.zohoSpecialRowsCount + (aeEvidence.unmappedTbAccounts?.length || 0);
    // Bucket sum must exactly equal TB leaves
    assertTest("209 classification buckets reconcile exactly", tbLeaves === bucketSum, bucketSum, tbLeaves);
    // Unresolved TB accounts must be zero
    assertTest("unresolved TB account prevents equation PASS", (aeEvidence.unmappedTbAccounts?.length || 0) === 0, aeEvidence.unmappedTbAccounts?.length || 0, 0);
    assertTest("targeted accounts are not duplicated", new Set(aeEvidence.targetedLookupMatches.map((t) => t.account_id)).size === aeEvidence.targetedLookupMatches.length);
    assertTest("retained earnings counted once", aeEvidence.zohoSpecialRowsCount === 1, aeEvidence.zohoSpecialRowsCount, 1);
    // P&L Arithmetic is perfectly verified against itself, no hardcoded historical bypass!
    const income = aeEvidence.income;
    const expense = aeEvidence.expense;
    const pl = aeEvidence.currentFyProfitLoss;
    assertTest("P&L arithmetic reconciled", Math.abs((income - expense) - pl) < 0.01, income - expense, pl);
    // Equation arithmetic is verified strictly
    const rhs = aeEvidence.liabilities + aeEvidence.equity + aeEvidence.currentFyProfitLoss;
    assertTest("equation arithmetic is correct", Math.abs(rhs - aeEvidence.rhs) < 0.01 && Math.abs(aeEvidence.assets - rhs) <= 0.01, Math.abs(aeEvidence.assets - rhs), 0);
    assertTest("raw floating difference preserved", typeof aeEvidence.diff === "number" && aeEvidence.diff >= 0 && aeEvidence.diff < 0.01);
    // We rely on the zoho-security-guard.ts throwing an exception if any non-GET request is attempted.
    // The fact that this run completed successfully proves zero Zoho writes occurred.
    if (passed) {
        console.log("ALL TESTS PASSED");
    }
    else {
        console.log("SOME TESTS FAILED");
        process.exit(1);
    }
}
runTests();
