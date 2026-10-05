import { getAuditDatabase } from '../app/lib/db/audit-database.ts';
import { randomUUID } from "node:crypto";
import { startPreAuditRun } from "../app/lib/audit/pre-audit-engine.ts";

async function runTests() {
  const db = getAuditDatabase();
  console.log("Starting Semantic Corrections Test Run...");
  
  const runId = startPreAuditRun("2025-26");
  
  // Wait for background execution to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const results = db.prepare(`SELECT checkpoint_key, process_status, result_status FROM pre_audit_checkpoint_results WHERE run_id = ?`).all(runId) as any[];
  
  const getStatus = (key: string) => {
     const row = results.find(r => r.checkpoint_key === key);
     return row ? { p: row.process_status, r: row.result_status } : null;
  }
  
  let passed = true;
  const assertTest = (name: string, condition: boolean) => {
    if (condition) {
       console.log(`[PASS] ${name}`);
    } else {
       console.log(`[FAIL] ${name}`);
       passed = false;
    }
  };

  const org = getStatus('Organization / Master Data');
  assertTest("A. organization existence => PARTIAL, never PASS", org?.r === 'PARTIAL');
  
  const dup = getStatus('Duplicate/Missing/Orphan');
  assertTest("B. zero findings => NOT_VERIFIED", dup?.r === 'NOT_VERIFIED');
  
  const ev = getStatus('Supporting Evidence Coverage');
  assertTest("C. zero evidence findings => NOT_VERIFIED", ev?.r === 'NOT_VERIFIED');
  
  const sales = getStatus('Sales Cycle');
  assertTest("D/E. Sales Cycle does not return PASS if unlinked payments/criticals exist", sales?.r === 'WARNING' || sales?.r === 'FAIL' || sales?.r === 'PARTIAL');
  
  const spi = getStatus('Sales ↔ Purchase ↔ Inventory');
  assertTest("F. valid Sales-Purchase-Inventory FAIL remains FAIL", spi?.r === 'FAIL');
  
  assertTest("G. zero records cannot automatically PASS (Verified via Dup/Ev)", dup?.r !== 'PASS' && ev?.r !== 'PASS');
  
  assertTest("H. process status and result status remain separate", org?.p === 'COMPLETED' && org?.r !== undefined);

  if (!passed) {
     console.error("Some focused tests failed!");
     process.exit(1);
  } else {
     console.log("All focused tests passed.");
     console.log("NEW_RUN_ID:", runId);
  }
}

runTests().catch(console.error);
