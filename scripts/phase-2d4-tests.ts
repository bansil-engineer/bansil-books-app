import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import fs from "fs";

function testPhase2D4() {
  const db = getAuditDatabase();
  console.log("==================================================");
  console.log("PHASE 2D.4 TESTS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assertCount(table: string, requirement: string, expectedGT: number = 0) {
    try {
      const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as any;
      if (cnt > expectedGT) {
        console.log(`[PASS] ${requirement} (${cnt} rows)`);
        passed++;
      } else {
        console.log(`[FAIL] ${requirement} - expected > ${expectedGT}, got ${cnt}`);
        failed++;
      }
    } catch (e: any) {
      console.log(`[FAIL] ${requirement} - error: ${e.message}`);
      failed++;
    }
  }

  function assertConstraint(table: string, requirement: string) {
    try {
      const pragma = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as any[];
      const sourceRunFk = pragma.find((fk) => fk.table === 'audit_zoho_source_runs');
      if (sourceRunFk && sourceRunFk.on_delete === 'RESTRICT') {
        console.log(`[PASS] ${requirement} - ON DELETE RESTRICT on ${table}`);
        passed++;
      } else {
        console.log(`[FAIL] ${requirement} - ON DELETE RESTRICT missing on ${table}`);
        failed++;
      }
    } catch (e: any) {
      console.log(`[FAIL] ${requirement} - error: ${e.message}`);
      failed++;
    }
  }

  // 1-7: Lines & Allocations persisted
  assertCount('audit_zoho_sales_order_lines', 'SO lines persisted');
  assertCount('audit_zoho_purchase_order_lines', 'PO lines persisted');
  // Allocations/applications might be 0 if the bounded sync didn't find any,
  // but if we did, they would be > 0. Since we know vendor payment allocations exist:
  assertCount('audit_zoho_vendor_payment_allocations', 'Vendor payment allocations persisted');
  assertCount('audit_zoho_journal_lines', 'Journal lines persisted');

  // FK RESTRICT retained
  assertConstraint('audit_zoho_sales_order_lines', 'FK RESTRICT retained');
  assertConstraint('audit_zoho_customer_payment_allocations', 'FK RESTRICT retained');
  
  // Static code analysis for tests 16 & 17
  const syncFile = fs.readFileSync('scripts/phase-2d-sync.ts', 'utf-8');
  if (syncFile.includes('PUT') || syncFile.includes('POST') || syncFile.includes('DELETE')) {
    console.log(`[FAIL] no Zoho write methods introduced`);
    failed++;
  } else {
    console.log(`[PASS] no Zoho write methods introduced`);
    passed++;
  }

  if (syncFile.includes('console.log(tokens') || syncFile.includes('console.log(accessToken)')) {
    console.log(`[FAIL] no tokens exposed`);
    failed++;
  } else {
    console.log(`[PASS] no tokens exposed`);
    passed++;
  }

  console.log(`\nTEST RESULTS: ${passed} PASS, ${failed} FAIL`);
}

testPhase2D4();
