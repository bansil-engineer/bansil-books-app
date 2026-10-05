import fs from "fs";
import path from "path";
import assert from "assert";
import { DatabaseSync } from "node:sqlite";
import { evaluatePurchaseSettlement } from "../app/lib/audit/reconciliation/purchase-engine.ts";
import { PurchaseSettlementInput } from "../app/lib/audit/reconciliation/types.ts";

function runTests() {
  console.log("== PHASE 2E.2 TESTS ==");
  
  // 1. Simple Purchase Full Settlement
  const t1Input: PurchaseSettlementInput = {
    bill: { billId: 'bill-1', total: 100, currencyCode: 'INR', sourceRunId: 'sr-1' },
    paymentAllocations: [{ paymentId: 'pay-1', billId: 'bill-1', amountApplied: 100, sourceRunId: 'sr-1' }],
    payments: [{ paymentId: 'pay-1', amount: 100, date: '2026-09-10', currencyCode: 'INR', sourceRunId: 'sr-1', paidThroughAccountId: 'acc-1' }],
    paymentAccounts: [{ accountId: 'acc-1', accountType: 'bank' }],
    bankTransactions: [{ transactionId: 'txn-1', amount: 100, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }],
    adjustments: []
  };
  const t1Res = evaluatePurchaseSettlement(t1Input);
  assert.strictEqual(t1Res.settlementStatus, 'FULLY_SETTLED');
  assert.strictEqual(t1Res.bankMatchResults[0].matchResult, 'CONFIRMED_AMOUNT_DATE_ACCOUNT');
  console.log("[OK] 1. Simple purchase full settlement");

  // 2. Deductions Bridge
  const t2Input: PurchaseSettlementInput = {
    bill: { billId: 'bill-2', total: 100, currencyCode: 'INR', sourceRunId: 'sr-1' },
    adjustments: [
      { adjustmentId: 'adj-1', adjustmentType: 'TDS', amount: 2, currencyCode: 'INR' },
      { adjustmentId: 'adj-2', adjustmentType: 'RETENTION', amount: 5, currencyCode: 'INR' }
    ],
    paymentAllocations: [{ paymentId: 'pay-2', billId: 'bill-2', amountApplied: 93, sourceRunId: 'sr-1' }],
    payments: [{ paymentId: 'pay-2', amount: 93, date: '2026-09-10', currencyCode: 'INR', sourceRunId: 'sr-1', paidThroughAccountId: 'acc-1' }],
    paymentAccounts: [{ accountId: 'acc-1', accountType: 'bank' }],
    bankTransactions: [{ transactionId: 'txn-2', amount: 93, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }]
  };
  const t2Res = evaluatePurchaseSettlement(t2Input);
  assert.strictEqual(t2Res.expectedSettlement, 93);
  assert.strictEqual(t2Res.settlementStatus, 'FULLY_SETTLED');
  console.log("[OK] 2. Deductions bridge");

  // 3. Partial Bill
  const t3Input = { ...t1Input, paymentAllocations: [{ paymentId: 'pay-1', billId: 'bill-1', amountApplied: 60, sourceRunId: 'sr-1' }], payments: [{ paymentId: 'pay-1', amount: 60, date: '2026-09-10', currencyCode: 'INR', sourceRunId: 'sr-1', paidThroughAccountId: 'acc-1' }], bankTransactions: [{ transactionId: 'txn-1', amount: 60, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }] };
  const t3Res = evaluatePurchaseSettlement(t3Input as any);
  assert.strictEqual(t3Res.settlementStatus, 'PARTIALLY_SETTLED');
  assert.strictEqual(t3Res.remainingAmount, 40);
  console.log("[OK] 3. Partial Bill");

  // 4. Multi-Bill / one Payment / one Bank
  // Need to call evaluatePurchaseSettlement on each bill
  const payments4 = [{ paymentId: 'pay-multi', amount: 500, date: '2026-09-10', currencyCode: 'INR', sourceRunId: 'sr-1', paidThroughAccountId: 'acc-1' }];
  const allocs4 = [
    { paymentId: 'pay-multi', billId: 'bill-A', amountApplied: 100, sourceRunId: 'sr-1' },
    { paymentId: 'pay-multi', billId: 'bill-B', amountApplied: 150, sourceRunId: 'sr-1' },
    { paymentId: 'pay-multi', billId: 'bill-C', amountApplied: 250, sourceRunId: 'sr-1' }
  ];
  const txns4 = [{ transactionId: 'txn-multi', amount: 500, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }];
  const t4Res = evaluatePurchaseSettlement({ bill: { billId: 'bill-B', total: 150, currencyCode: 'INR', sourceRunId: 'sr-1' }, paymentAllocations: allocs4, payments: payments4, bankTransactions: txns4, paymentAccounts: [{ accountId: 'acc-1', accountType: 'bank' }], adjustments: [] });
  assert.strictEqual(t4Res.settlementStatus, 'FULLY_SETTLED');
  assert.strictEqual(t4Res.bankMatchResults.length, 1);
  assert.strictEqual(t4Res.bankMatchResults[0].matchResult, 'CONFIRMED_AMOUNT_DATE_ACCOUNT');
  console.log("[OK] 4. Multi-Bill / one Payment / one Bank");

  // 5. Missing Bank evidence
  const t5Res = evaluatePurchaseSettlement({ ...t1Input, bankTransactions: [] });
  assert.strictEqual(t5Res.settlementStatus, 'BANK_EVIDENCE_MISSING');
  assert.ok(t5Res.alerts.includes('PAYMENT_WITHOUT_BANK_EVIDENCE'));
  console.log("[OK] 5. Missing Bank evidence");

  // 6. Exact UTR outside date
  const t6Res = evaluatePurchaseSettlement({ ...t1Input, bankTransactions: [{ transactionId: 'txn-1', amount: 100, date: '2026-09-15', referenceNumber: 'XYZ-123', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }], payments: [{ paymentId: 'pay-1', amount: 100, date: '2026-09-10', referenceNumber: 'XYZ-123', currencyCode: 'INR', sourceRunId: 'sr-1', paidThroughAccountId: 'acc-1' }] });
  assert.strictEqual(t6Res.bankMatchResults[0].matchResult, 'CONFIRMED_BANK_REFERENCE');
  console.log("[OK] 6. Exact UTR outside date");

  // 7. Ambiguous same amount/date
  const t7Res = evaluatePurchaseSettlement({ ...t1Input, bankTransactions: [
    { transactionId: 'txn-1', amount: 100, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' },
    { transactionId: 'txn-2', amount: 100, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }
  ] });
  assert.strictEqual(t7Res.bankMatchResults[0].matchResult, 'AMBIGUOUS');
  assert.ok(t7Res.alerts.includes('AMBIGUOUS_BANK_MATCH'));
  console.log("[OK] 7. Ambiguous same amount/date");

  // 8. Over-settlement
  const t8Res = evaluatePurchaseSettlement({ ...t1Input, paymentAllocations: [{ paymentId: 'pay-1', billId: 'bill-1', amountApplied: 120, sourceRunId: 'sr-1' }] });
  assert.strictEqual(t8Res.settlementStatus, 'OVER_SETTLED');
  assert.ok(t8Res.alerts.includes('OVER_SETTLED'));
  console.log("[OK] 8. Over-settlement");

  // 9. Unexplained deduction
  // Tested by lack of adjustment providing difference
  const t9Res = evaluatePurchaseSettlement({ bill: { billId: 'bill-9', total: 100, currencyCode: 'INR', sourceRunId: 'sr-1' }, paymentAllocations: [{ paymentId: 'pay-9', billId: 'bill-9', amountApplied: 95, sourceRunId: 'sr-1' }], payments: [{ paymentId: 'pay-9', amount: 95, date: '2026-09-10', currencyCode: 'INR', sourceRunId: 'sr-1', paidThroughAccountId: 'acc-1' }], paymentAccounts: [{ accountId: 'acc-1', accountType: 'bank' }], bankTransactions: [{ transactionId: 'txn-9', amount: 95, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }], adjustments: [] });
  assert.strictEqual(t9Res.settlementStatus, 'PARTIALLY_SETTLED'); // Since there's no adjustment, expected is 100, paid 95. Remaining 5.
  console.log("[OK] 9. Unexplained deduction (treated as partially settled by engine)");

  // 10. Cash account behavior
  const t10Res = evaluatePurchaseSettlement({ ...t1Input, paymentAccounts: [{ accountId: 'acc-1', accountType: 'cash' }], bankTransactions: [] });
  assert.strictEqual(t10Res.settlementStatus, 'FULLY_SETTLED');
  assert.strictEqual(t10Res.bankMatchResults[0].matchResult, 'CONFIRMED_AMOUNT_DATE_ACCOUNT');
  console.log("[OK] 10. Cash account behavior");

  // 11. Credit card account behavior
  const t11Res = evaluatePurchaseSettlement({ ...t1Input, paymentAccounts: [{ accountId: 'acc-1', accountType: 'credit_card' }] });
  assert.strictEqual(t11Res.settlementStatus, 'FULLY_SETTLED');
  console.log("[OK] 11. Credit card account behavior");

  // 12. Payment clearing behavior
  const t12Res = evaluatePurchaseSettlement({ ...t1Input, paymentAccounts: [{ accountId: 'acc-1', accountType: 'payment_clearing' }], bankTransactions: [] });
  assert.strictEqual(t12Res.settlementStatus, 'FULLY_SETTLED');
  console.log("[OK] 12. Payment clearing behavior");

  // 13. Account mismatch rejection
  const t13Res = evaluatePurchaseSettlement({ ...t1Input, bankTransactions: [{ transactionId: 'txn-1', amount: 100, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-WRONG' }] });
  assert.strictEqual(t13Res.bankMatchResults[0].matchResult, 'NO_MATCH');
  console.log("[OK] 13. Account mismatch rejection");
  
  // 14. Amount mismatch
  const t14Res = evaluatePurchaseSettlement({ ...t1Input, bankTransactions: [{ transactionId: 'txn-1', amount: 101, date: '2026-09-10', debitOrCredit: 'debit', currencyCode: 'INR', sourceRunId: 'sr-1', accountId: 'acc-1' }] });
  assert.strictEqual(t14Res.bankMatchResults[0].matchResult, 'NO_MATCH');
  console.log("[OK] 14. Amount mismatch");

  // DATABASE TESTS - Persistence Adapter test
  const tempDbPath = path.join(process.cwd(), "data", "audit_temp_2e2.db");
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  
  const db = new DatabaseSync(tempDbPath);
  
  const schemaPath = path.join(process.cwd(), "app/lib/db/audit-database.ts");
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const startIndex = schemaContent.indexOf("db.exec(`");
  const endIndex = schemaContent.lastIndexOf("`);");
  if (startIndex !== -1 && endIndex !== -1) {
     const schemaSql = schemaContent.substring(startIndex + 9, endIndex);
     db.exec(schemaSql);
  } else {
     throw new Error("Could not extract schema script");
  }
  
  db.exec("PRAGMA foreign_keys = ON;");
  
  // Insert source runs
  db.exec(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES ('sr-1', 'org-1', 'salesorders', '2026-09-19T00:00:00Z', 'SUCCESS');
  `);
  
  // Create Run
  db.exec(`
    INSERT INTO audit_reconciliation_runs (reconciliation_run_id, organization_id, domain, ruleset_version, status, created_at)
    VALUES ('run-1', 'org-1', 'PURCHASE', 'BANK_SETTLEMENT_V1', 'SUCCESS', '2026-09-19T00:00:00Z');
    
    INSERT INTO audit_reconciliation_run_sources (id, reconciliation_run_id, source_type, source_run_id, created_at)
    VALUES ('rsrc-1', 'run-1', 'salesorders', 'sr-1', '2026-09-19T00:00:00Z');
  `);
  
  // Insert Case
  db.exec(`
    INSERT INTO audit_reconciliation_cases (case_id, reconciliation_run_id, organization_id, domain, primary_source_type, primary_source_id, primary_source_run_id, machine_result, created_at, updated_at)
    VALUES ('case-1', 'run-1', 'org-1', 'PURCHASE', 'bill', 'bill-1', 'sr-1', 'CONFIRMED_AMOUNT_DATE_ACCOUNT', '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z');
  `);
  
  // Try inserting duplicate case (same case_id, which we use as deterministic hash of run + billId)
  try {
    db.exec(`
      INSERT INTO audit_reconciliation_cases (case_id, reconciliation_run_id, organization_id, domain, primary_source_type, primary_source_id, primary_source_run_id, machine_result, created_at, updated_at)
      VALUES ('case-1', 'run-1', 'org-1', 'PURCHASE', 'bill', 'bill-1', 'sr-1', 'CONFIRMED_AMOUNT_DATE_ACCOUNT', '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z');
    `);
    assert.fail("Allowed duplicate case");
  } catch (e: any) {
    assert.match(e.message, /UNIQUE constraint failed/);
  }
  console.log("[OK] Database persistence adapter idempotent design");
  
  // Insert evidence linking to unknown source run id
  try {
    db.exec(`
      INSERT INTO audit_reconciliation_links (link_id, case_id, organization_id, source_type, source_id, source_run_id, relationship_type, evidence_strength, amount_contribution, currency_code, created_at)
      VALUES ('link-1', 'case-1', 'org-1', 'payment', 'pay-1', 'UNKNOWN', 'BILL_TO_PAYMENT', 'EXPLICIT_ALLOCATION', 100, 'INR', '2026-09-19T00:00:00Z');
    `);
    assert.fail("Allowed missing source run id in evidence");
  } catch (e: any) {
    assert.match(e.message, /FOREIGN KEY constraint failed/);
  }
  console.log("[OK] Snapshot freeze enforced (FK on evidence source_run_id)");
  
  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  console.log("\\n[OK] All deterministic fixture tests passed.");
}

runTests();
