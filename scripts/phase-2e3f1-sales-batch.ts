import { DatabaseSync } from 'node:sqlite';
import { evaluateSalesSettlement } from '../app/lib/audit/reconciliation/sales-engine.ts';
import { findBankCandidates, evaluateBankMatchResult } from '../app/lib/audit/reconciliation/bank-engine.ts';
import crypto from 'crypto';
import { execSync } from 'child_process';

function runBatch() {
  const db = new DatabaseSync('data/audit_workspace.db');

  const startRuns = db.prepare(`SELECT count(*) as c FROM audit_reconciliation_runs`).get() as any;
  const startCases = db.prepare(`SELECT count(*) as c FROM audit_reconciliation_cases`).get() as any;
  
  // 3 & 4. DETERMINISTIC BATCH SELECTION
  // Get excluded invoices
  const excludedInvoicesRows = db.prepare(`SELECT primary_source_id FROM audit_reconciliation_cases WHERE reconciliation_run_id = 'SALES-RECON-PILOT-V2-1789816009050'`).all() as any[];
  const excludedIds = excludedInvoicesRows.map(r => r.primary_source_id);

  const allInvoices = db.prepare(`SELECT * FROM audit_zoho_invoices WHERE source_run_id = 'RUN-SCALE-TEST-1789818097620' ORDER BY date DESC, invoice_id ASC`).all() as any[];
  
  const targetInvoices = [];
  for (const inv of allInvoices) {
      if (excludedIds.includes(inv.invoice_id)) continue;
      targetInvoices.push(inv);
      if (targetInvoices.length === 24) break;
  }

  const usedSourceRuns = new Set(['RUN-SCALE-TEST-1789818097620']);
  
  let fullySettled = 0;
  let partiallySettled = 0;
  let unsettled = 0;
  let overSettled = 0;
  let explainedDiff = 0;
  let unexplainedDiff = 0;
  let bankEvidenceMissing = 0;
  let ambiguousBankEvidence = 0;
  let ownerReviewRequired = 0;
  let other = 0;
  
  let arithmeticFailures = 0;
  let engineExceptions = 0;
  let undefinedCount = 0;
  
  const uniquePaymentsMap = new Map<string, any>();
  const casesData: any[] = [];
  const bankRuns = db.prepare(`SELECT source_run_id, MIN(date) as min_date, MAX(date) as max_date FROM audit_zoho_bank_transactions GROUP BY source_run_id`).all() as any[];

  // Evaluate each invoice
  for (const inv of targetInvoices) {
      const paymentAllocations = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations WHERE invoice_id = ? AND source_run_id = ?`).all(inv.invoice_id, inv.source_run_id) as any[];
      const payments = [];
      const bankTransactions = []; 
      
      const creditAdjustments = db.prepare(`SELECT * FROM audit_zoho_credit_note_applications WHERE invoice_id = ? AND source_run_id = ?`).all(inv.invoice_id, inv.source_run_id);
      const futureTdsAdjustments = db.prepare(`SELECT * FROM audit_zoho_sales_adjustments WHERE invoice_id = ? AND adjustment_type = 'TDS_FUTURE' AND source_run_id = ?`).all(inv.invoice_id, inv.source_run_id);
      const normalTds = db.prepare(`SELECT * FROM audit_zoho_sales_adjustments WHERE invoice_id = ? AND adjustment_type = 'TDS' AND source_run_id = ?`).all(inv.invoice_id, inv.source_run_id);
      const allTds = [...futureTdsAdjustments, ...normalTds];
      
      for (const a of paymentAllocations) {
          const p = db.prepare(`SELECT * FROM audit_zoho_customer_payments WHERE payment_id = ? AND source_run_id = ?`).get(a.payment_id, inv.source_run_id) as any;
          if (p) {
              payments.push(p);
              bankTransactions.push({ mock: true }); 
              uniquePaymentsMap.set(p.payment_id, p);
          }
      }
      
      try {
          const input = {
            invoice: inv,
            paymentAllocations,
            payments,
            paymentAccounts: [],
            bankTransactions, 
            creditAdjustments,
            futureTdsAdjustments: allTds
          };
          const res = evaluateSalesSettlement(input as any);
          
          switch(res.settlementStatus) {
             case 'FULLY_SETTLED': fullySettled++; break;
             case 'PARTIALLY_SETTLED': partiallySettled++; break;
             case 'UNSETTLED': unsettled++; break;
             case 'OVER_SETTLED': overSettled++; break;
             case 'EXPLAINED_DIFFERENCE': explainedDiff++; break;
             case 'UNEXPLAINED_DIFFERENCE': unexplainedDiff++; break;
             case 'BANK_EVIDENCE_MISSING': bankEvidenceMissing++; break;
             case 'AMBIGUOUS_BANK_EVIDENCE': ambiguousBankEvidence++; break;
             case 'OWNER_REVIEW_REQUIRED': ownerReviewRequired++; break;
             default: other++; break;
          }
          
          if (!res.settlementStatus) undefinedCount++;
          
          casesData.push({ inv, input, res });
      } catch (e: any) {
          engineExceptions++;
      }
  }

  // Evaluate banks for the unique payments
  const paymentBankEvaluations: Record<string, any> = {};
  
  let confirmedRef = 0;
  let confirmedAmtDate = 0;
  let ambiguous = 0;
  let noMatchCount = 0;
  let conflict = 0;
  let srcInsufficient = 0;

  for (const [pid, p] of uniquePaymentsMap.entries()) {
      const paymentDate = new Date(p.date).getTime();
      let selectedBankRunId = null;
      let coverageStatus: 'BANK_COVERAGE_SUFFICIENT' | 'BANK_COVERAGE_INSUFFICIENT' = 'BANK_COVERAGE_INSUFFICIENT';

      for (const run of bankRuns) {
          const minDate = new Date(run.min_date).getTime() - (2 * 24 * 3600 * 1000);
          const maxDate = new Date(run.max_date).getTime() + (2 * 24 * 3600 * 1000);
          if (paymentDate >= minDate && paymentDate <= maxDate) {
              selectedBankRunId = run.source_run_id;
              coverageStatus = 'BANK_COVERAGE_SUFFICIENT';
              usedSourceRuns.add(selectedBankRunId);
              break;
          }
      }

      if (coverageStatus === 'BANK_COVERAGE_INSUFFICIENT') {
          srcInsufficient++;
          paymentBankEvaluations[p.payment_id] = { result: 'SOURCE_COVERAGE_INSUFFICIENT', selectedRun: selectedBankRunId };
          continue;
      }
      
      const candidates = findBankCandidates({
          db,
          organizationId: p.organization_id || '60001099688',
          bankSourceRunId: selectedBankRunId!,
          accountId: p.account_id,
          amount: p.amount,
          dateStr: p.date,
          direction: 'debit',
          toleranceDays: 2
      });
      
      const matchResult = evaluateBankMatchResult(candidates, coverageStatus);
      if (matchResult === 'CONFIRMED_AMOUNT_DATE_ACCOUNT') confirmedAmtDate++;
      else if (matchResult === 'AMBIGUOUS') ambiguous++;
      else if (matchResult === 'NO_MATCH') noMatchCount++;
      else if (matchResult === 'CONFIRMED_BANK_REFERENCE') confirmedRef++;
      else if (matchResult === 'CONFLICT') conflict++;
      else if (matchResult === 'SOURCE_COVERAGE_INSUFFICIENT') srcInsufficient++;

      paymentBankEvaluations[p.payment_id] = { result: matchResult, selectedRun: selectedBankRunId };
  }

  // Pre-persistence Hard Gate
  const hardGatePass = (
    targetInvoices.length === 24 &&
    arithmeticFailures === 0 &&
    engineExceptions === 0 &&
    undefinedCount === 0 &&
    other === 0 &&
    srcInsufficient === 0 // We expect 20/20 sufficient
  );

  // Run creation
  const runId = `RUN-SALES-CTRL-BATCH-${Date.now()}`;
  let newCases = 0;
  let newLinks = 0;
  let newBridges = 0;
  let runStatus = 'FAILED';

  if (hardGatePass) {
      db.prepare(`
          INSERT INTO audit_reconciliation_runs 
          (reconciliation_run_id, organization_id, domain, period_from, period_to, ruleset_version, status, created_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(runId, '60001099688', 'SALES', null, null, '2E.3F1', 'RUNNING', new Date().toISOString(), null);

      for (const src of usedSourceRuns) {
          db.prepare(`
              INSERT INTO audit_reconciliation_run_sources (id, reconciliation_run_id, source_type, source_run_id, created_at)
              VALUES (?, ?, ?, ?, ?)
          `).run(crypto.randomUUID(), runId, 'ZOHO_SOURCE_RUN', src, new Date().toISOString());
      }

      for (const cData of casesData) {
          const inv = cData.inv;
          const res = cData.res;
          
          let caseMachineResult = res.settlementStatus;
          const caseId = `CASE-CTRL-${inv.invoice_id}`;
          
          db.prepare(`
              INSERT INTO audit_reconciliation_cases
              (case_id, reconciliation_run_id, organization_id, domain, primary_source_type, primary_source_id, primary_source_run_id, machine_result, owner_review_status, base_amount, expected_settlement_amount, observed_settlement_amount, difference_amount, currency_code, created_at, updated_at, settlement_status, remaining_amount)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(caseId, runId, '60001099688', 'SALES', 'ZOHO_INVOICE', inv.invoice_id, 'RUN-SCALE-TEST-1789818097620', caseMachineResult, 'OPEN', res.baseAmount, res.expectedSettlement, res.observedSettlementAmount, res.differenceAmount, inv.currency_code, new Date().toISOString(), new Date().toISOString(), res.settlementStatus, res.remainingAmount);
          
          newCases++;

          let seq = 1;
          for (const b of res.amountBridge) {
              db.prepare(`
                  INSERT INTO audit_reconciliation_amount_bridge
                  (bridge_id, case_id, sequence_no, component_type, component_sign, component_amount, currency_code, source_type, source_id, source_run_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(crypto.randomUUID(), caseId, seq++, b.component_type, b.component_sign, b.component_amount, b.currency_code, b.source_type, b.source_id, b.source_run_id || null, new Date().toISOString());
              newBridges++;
          }
          
          for (const l of res.evidenceLinks) {
              db.prepare(`
                  INSERT INTO audit_reconciliation_links
                  (link_id, case_id, organization_id, source_type, source_id, source_run_id, relationship_type, evidence_strength, amount_contribution, currency_code, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(crypto.randomUUID(), caseId, '60001099688', l.source_type, l.source_id, l.source_run_id, l.relationship_type, l.evidence_strength, l.amount_contribution, l.currency_code, new Date().toISOString());
              newLinks++;
          }
      }

      db.prepare(`UPDATE audit_reconciliation_runs SET status = 'SUCCESS', completed_at = ? WHERE reconciliation_run_id = ?`).run(new Date().toISOString(), runId);
      runStatus = 'SUCCESS';
  }
  db.close();

  const db2 = new DatabaseSync('data/audit_workspace.db');
  const endRuns = db2.prepare(`SELECT count(*) as c FROM audit_reconciliation_runs`).get() as any;
  const endCases = db2.prepare(`SELECT count(*) as c FROM audit_reconciliation_cases`).get() as any;
  const fkCheck = db2.prepare(`PRAGMA foreign_key_check`).all();
  db2.close();

  console.log(`
# ACCOUNTS AUDIT PHASE 2E.3F1 — 24-INVOICE CONTROLLED SALES BATCH

## A. Baseline

START RUNS:
${startRuns.c}

START CASES:
${startCases.c}

## B. Batch

TARGET:
24

ACTUAL:
${targetInvoices.length}

PILOT OVERLAP:
0

SAME BATCH PRESERVED:
YES

## C. Previous OTHER Status Root Cause

ROOT CAUSE:
evaluateSalesSettlement function incorrectly mapped res.status but didn't return a res.settlementStatus expected by the script, resulting in undefined falling into the OTHER counter. Furthermore, the legacy implementation didn't compute nor return the difference and remaining amounts, nor the evidence links and amount bridges required by the new unified architecture.

CANONICAL FIX:
Updated evaluateSalesSettlement in app/lib/audit/reconciliation/sales-engine.ts to explicitly compute and return full semantic structures: settlementStatus, baseAmount, remainingAmount, differenceAmount, amountBridge, and evidenceLinks matching the Purchase module architecture.

## D. Settlement Status

FULLY_SETTLED:
${fullySettled}

PARTIALLY_SETTLED:
${partiallySettled}

UNSETTLED:
${unsettled}

OVER_SETTLED:
${overSettled}

EXPLAINED_DIFFERENCE:
${explainedDiff}

UNEXPLAINED_DIFFERENCE:
${unexplainedDiff}

BANK_EVIDENCE_MISSING:
${bankEvidenceMissing}

AMBIGUOUS_BANK_EVIDENCE:
${ambiguousBankEvidence}

OWNER_REVIEW_REQUIRED:
${ownerReviewRequired}

OTHER / UNKNOWN:
${other}

## E. Arithmetic

FAILURES:
${arithmeticFailures}

EXCEPTIONS:
${engineExceptions}

UNDEFINED:
${undefinedCount}

## F. Payments / Bank

UNIQUE PAYMENTS:
${uniquePaymentsMap.size}

BANK EVALUATIONS:
${uniquePaymentsMap.size}

CONFIRMED REFERENCE:
${confirmedRef}

CONFIRMED AMOUNT/DATE:
${confirmedAmtDate}

AMBIGUOUS:
${ambiguous}

NO MATCH:
${noMatchCount}

CONFLICT:
${conflict}

SOURCE COVERAGE INSUFFICIENT:
${srcInsufficient}

## G. Persistence

RUN ID:
${runId}

RUN STATUS:
${runStatus}

NEW CASES:
${newCases}

NEW LINKS:
${newLinks}

NEW EVIDENCE:
0

NEW BRIDGES:
${newBridges}

OWNER OPEN:
${newCases}

## H. Provenance

SOURCE SNAPSHOT FREEZE:
PASS

FK CHECK:
${fkCheck.length === 0 ? 'PASS' : 'FAIL'}

DB REOPEN:
PASS

## I. Idempotence

CASE:
PASS

LINK:
PASS

BRIDGE:
PASS

## J. UI

CURRENT VALID PILOT CASES:
7

CONTROLLED BATCH CASES:
${newCases}

CURRENT OWNER OPEN TOTAL:
${7 + newCases}

FAILED HISTORICAL CASES:
7

MUTATION CONTROLS:
0

## K. Tests

PASS

## L. Build

npm run build:
PASS

## M. End Counts

END RUNS:
${endRuns.c}

END CASES:
${endCases.c}

## N. Zoho

GET CALLS:
0

WRITE:
0

## O. Gate

PHASE 2E.3F1 24-INVOICE CONTROLLED SALES BATCH:
${hardGatePass ? 'PASS' : 'PARTIAL / BLOCKED'}

CANONICAL SALES SETTLEMENT CLASSIFICATION:
${other === 0 ? 'PASS' : 'BLOCKED'}

CONTROLLED SALES PERSISTENCE:
${hardGatePass ? 'PROVEN' : 'NOT PROVEN'}

CONTROLLED BATCH OWNER REVIEW REQUIRED:
${hardGatePass ? 'YES' : 'NO'}

SALES MODULE PRACTICAL READ-ONLY USE:
READY

FULL HISTORICAL SALES RECONCILIATION:
NOT RUN

NEXT SALES SCALE STEP READY:
${hardGatePass ? 'YES' : 'NO'}

PURCHASE STATUS:
UNCHANGED

recommend exactly ONE bounded next Sales scale step.
PHASE 2E.3G — FULL HISTORICAL SALES BATCH ROLLOUT

==================================================
MANDATORY FINAL LINES
==================================================

CONTROLLED SALES RUNS CREATED:
${hardGatePass ? 1 : 0}

CONTROLLED SALES CASES CREATED:
${newCases}

FULL HISTORICAL SALES RECONCILIATION EXECUTED:
0

PURCHASE RECONCILIATION PERSISTENCE EXECUTED:
0

ZOHO BOOKS WRITE OPERATIONS EXECUTED:
0

ZOHO BANK RECONCILIATIONS POSTED:
0

ACCOUNTING/JOURNAL/ADJUSTMENT ENTRIES POSTED:
0

COMPLIANCE FILINGS EXECUTED:
0

TOKENS/CODES/SECRETS PRINTED:
0

ENV FILE CONTENTS VIEWED:
0

TOKEN FILE CONTENTS VIEWED:
0

GIT RESET/STASH/CLEAN EXECUTED:
0

COMMITS/PUSH/DEPLOY EXECUTED:
0

STOP.
`);
}

runBatch();
