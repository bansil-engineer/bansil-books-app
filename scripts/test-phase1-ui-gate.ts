import { startPreAuditRun } from '../app/lib/audit/pre-audit-engine.ts';

async function runTests() {
  console.log("Starting UI Gate Tests...");
  let passed = true;
  
  const assertTest = (name: string, condition: boolean) => {
    if (condition) {
       console.log(`[PASS] ${name}`);
    } else {
       console.log(`[FAIL] ${name}`);
       passed = false;
    }
  };

  const getRuns = async (fy?: string) => {
    const url = `http://127.0.0.1:3000/api/audit/pre-audit/run${fy ? '?financialYear=' + fy : ''}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.runs || [];
  };

  const getResults = async (runId: string) => {
    const url = `http://127.0.0.1:3000/api/audit/pre-audit/run?runId=${runId}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.results || [];
  };

  // A. FY 2025-26 returns only FY 2025-26 runs
  const runs2526 = await getRuns("2025-26");
  assertTest("A. FY 2025-26 returns only FY 2025-26 runs", runs2526.length > 0 && runs2526.every((r: any) => r.financial_year === "2025-26"));

  // B & C. another FY never falls back to 2025-26, no-run FY returns empty/not-available state
  const runs2022 = await getRuns("2022-23");
  assertTest("B/C. no-run FY returns empty state, no fallback", runs2022.length === 0);
  
  // Create a new run for 2022-23 to test run button submission and isolation
  const startRes = await fetch("http://127.0.0.1:3000/api/audit/pre-audit/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ financialYear: "2022-23" })
  });
  const startJson = await startRes.json();
  const runId2022 = startJson.runId;
  assertTest("G. run button submits selected FY (returns new runId)", !!runId2022);
  
  // Wait for it to finish
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const newRuns2022 = await getRuns("2022-23");
  assertTest("F. run history is FY-isolated", newRuns2022.length === 1 && newRuns2022[0].financial_year === "2022-23" && runs2526.every((r: any) => r.financial_year === "2025-26"));

  // D & E. selecting run A loads only run A results, selecting run B loads only run B results
  const resultsA = await getResults(runId2022);
  const startRes2526 = await fetch("http://127.0.0.1:3000/api/audit/pre-audit/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ financialYear: "2025-26" })
  });
  const startJson2526 = await startRes2526.json();
  const runId2025 = startJson2526.runId;
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const resultsB = await getResults(runId2025);
  
  assertTest("D. selecting run A loads only run A results", resultsA.length > 0 && resultsA.every((r: any) => r.run_id === runId2022));
  assertTest("E. selecting run B loads only run B results", resultsB.length > 0 && resultsB.every((r: any) => r.run_id === runId2025));

  // I, J, K. Semantics Check on runId2025
  const getStatus = (key: string) => {
     const row = resultsB.find((r: any) => r.checkpoint_key === key);
     return row ? row.result_status : null;
  }
  assertTest("I. PARTIAL remains PARTIAL (Sales Cycle)", getStatus("Sales Cycle") === "PARTIAL");
  assertTest("J. NOT_VERIFIED remains NOT_VERIFIED (Duplicate/Missing/Orphan)", getStatus("Duplicate/Missing/Orphan") === "NOT_VERIFIED");
  assertTest("K. FAIL remains FAIL (Sales ↔ Purchase ↔ Inventory)", getStatus("Sales ↔ Purchase ↔ Inventory") === "FAIL");

  // H & L. Evidence Details use persisted values and no simulated values
  const spiResult = resultsB.find((r: any) => r.checkpoint_key === "Sales ↔ Purchase ↔ Inventory");
  assertTest("H. evidence details use persisted values", spiResult && spiResult.exact_difference !== undefined && spiResult.evidence_json !== undefined);
  
  assertTest("L. no fake/simulated values", typeof spiResult.records_checked === "number" && spiResult.result_status === "FAIL");

  if (!passed) {
     console.error("Some focused tests failed!");
     process.exit(1);
  } else {
     console.log("All focused tests passed.");
  }
}

runTests().catch(console.error);
