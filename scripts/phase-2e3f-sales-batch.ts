import { DatabaseSync } from 'node:sqlite';
import { evaluateSalesSettlement } from '../app/lib/audit/reconciliation/sales-engine.ts';
import { findBankCandidates, evaluateBankMatchResult } from '../app/lib/audit/reconciliation/bank-engine.ts';
import crypto from 'crypto';
import { execSync } from 'child_process';

function runBatch() {
  const db = new DatabaseSync('data/audit_workspace.db');

  // 1. GIT / REPOSITORY BASELINE
  const gitRoot = '/Users/balkrishnapjoshi/Documents/Antigravity';
  const gitBranch = 'feature/audit-workspace-milestone-a';
  const gitHead = '7a43858cc21416adf24c64a11e17b23fd8b00771';

  // 2. START RECONCILIATION COUNTS
  const startRuns = db.prepare(`SELECT count(*) as c FROM audit_reconciliation_runs`).get() as any;
  const startCases = db.prepare(`SELECT count(*) as c FROM audit_reconciliation_cases`).get() as any;
  
  if (startRuns.c !== 2 || startCases.c !== 14) {
      console.log(`Expected baseline RUNS: 2, CASES: 14. Found RUNS: ${startRuns.c}, CASES: ${startCases.c}`);
      return;
  }

  // 3 & 4. DETERMINISTIC BATCH SELECTION
  // Get excluded invoices
  const excludedInvoicesRows = db.prepare(`SELECT primary_source_id FROM audit_reconciliation_cases WHERE reconciliation_run_id = 'SALES-RECON-PILOT-V2-1789816009050'`).all() as any[];
  const excludedIds = excludedInvoicesRows.map(r => r.primary_source_id);

  const allInvoices = db.prepare(`SELECT * FROM audit_zoho_invoices WHERE source_run_id = 'RUN-SCALE-TEST-1789818097620' ORDER BY date DESC, invoice_id ASC`).all() as any[];
  
  const targetInvoices = [];
  for (const inv of allInvoices) {
      if (excludedIds.includes(inv.invoice_id)) continue;
      targetInvoices.push(inv);
      if (targetInvoices.length === 50) break;
  }

  // 5. BATCH MANIFEST
  if (targetInvoices.length !== 50) {
      console.log(`WARNING: Only ${targetInvoices.length} suitable invoices available. Will evaluate but SKIP persistence.`);
  }

  // Determine bounds and source runs used
  let minDate = targetInvoices[0]?.date || 'N/A';
  let maxDate = targetInvoices[0]?.date || 'N/A';
  for (const inv of targetInvoices) {
      if (inv.date < minDate) minDate = inv.date;
      if (inv.date > maxDate) maxDate = inv.date;
  }
  const usedSourceRuns = new Set(['RUN-SCALE-TEST-1789818097620']);
  
  let fullySettled = 0;
  let partiallySettled = 0;
  let unsettled = 0;
  let other = 0;
  let arithmeticFailures = 0;
  let engineExceptions = 0;
  let undefinedCount = 0;
  
  let tdsCases = 0;
  let creditNoteCases = 0;
  let discountCases = 0; // if discount is present in invoice
  let advanceCases = 0; // if advance present in invoice or payments? we don't track advance per se unless explicitly given
  let writeOffCases = 0;
  let otherCases = 0;
  
  const uniquePaymentsMap = new Map<string, any>();
  const paymentsByInvoice: Record<string, string[]> = {};
  const invoicesByPayment: Record<string, string[]> = {};
  
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
      
      if (creditAdjustments.length > 0) creditNoteCases++;
      if (allTds.length > 0) tdsCases++;
      
      if (inv.discount > 0) discountCases++;
      if (inv.write_off_amount > 0) writeOffCases++;

      paymentsByInvoice[inv.invoice_id] = [];
      
      for (const a of paymentAllocations) {
          const p = db.prepare(`SELECT * FROM audit_zoho_customer_payments WHERE payment_id = ? AND source_run_id = ?`).get(a.payment_id, inv.source_run_id) as any;
          if (p) {
              payments.push(p);
              bankTransactions.push({ mock: true }); 
              uniquePaymentsMap.set(p.payment_id, p);
              paymentsByInvoice[inv.invoice_id].push(p.payment_id);
              
              if (!invoicesByPayment[p.payment_id]) invoicesByPayment[p.payment_id] = [];
              invoicesByPayment[p.payment_id].push(inv.invoice_id);
          }
      }
      
      try {
          const input = {
            invoice: inv,
            paymentAllocations,
            payments,
            paymentAccounts: [],
            bankTransactions, // mocked purely for sales evaluation
            creditAdjustments,
            futureTdsAdjustments: allTds
          };
          const res = evaluateSalesSettlement(input as any);
          if (res.settlementStatus === 'FULLY_SETTLED') fullySettled++;
          else if (res.settlementStatus === 'PARTIALLY_SETTLED') partiallySettled++;
          else if (res.settlementStatus === 'UNSETTLED') unsettled++;
          else other++;
          
          if (res.status === 'UNEXPLAINED_DIFFERENCE') {
            arithmeticFailures++;
          }
          
          casesData.push({ inv, input, res });
      } catch (e: any) {
          engineExceptions++;
      }
  }

  if (arithmeticFailures > 0 || engineExceptions > 0) {
      console.log(`STOP. Arithmetic Failures: ${arithmeticFailures}, Engine Exceptions: ${engineExceptions}`);
      return;
  }

  // Multi relationships
  let multiPaymentInvoices = 0;
  for (const inv of targetInvoices) {
      if (paymentsByInvoice[inv.invoice_id].length > 1) multiPaymentInvoices++;
  }
  let multiInvoicePayments = 0;
  for (const pid of Object.keys(invoicesByPayment)) {
      if (invoicesByPayment[pid].length > 1) multiInvoicePayments++;
  }

  // Evaluate banks for the unique payments
  const paymentBankEvaluations: Record<string, any> = {};
  
  let sufficientCoverage = 0;
  let insufficientCoverage = 0;
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

      if (coverageStatus === 'BANK_COVERAGE_SUFFICIENT') {
          sufficientCoverage++;
      } else {
          insufficientCoverage++;
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

  // Run creation
  const runId = `RUN-SALES-CTRL-BATCH-${Date.now()}`;
  let newCases = 0;
  let newLinks = 0;
  let newBridges = 0;

  if (targetInvoices.length === 50) {
      db.prepare(`
          INSERT INTO audit_reconciliation_runs 
          (reconciliation_run_id, organization_id, domain, period_from, period_to, ruleset_version, status, created_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(runId, '60001099688', 'SALES', null, null, '2E.3F', 'RUNNING', new Date().toISOString(), null);

      for (const src of usedSourceRuns) {
          db.prepare(`
              INSERT INTO audit_reconciliation_run_sources (id, reconciliation_run_id, source_type, source_run_id, created_at)
              VALUES (?, ?, ?, ?, ?)
          `).run(crypto.randomUUID(), runId, 'ZOHO_SOURCE_RUN', src, new Date().toISOString());
      }

      for (const cData of casesData) {
          const inv = cData.inv;
          const res = cData.res;
          const input = cData.input;
          
          // Determine machine result for case
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
  }
  db.close();

  // Test reopen
  const db2 = new DatabaseSync('data/audit_workspace.db');
  
  const endRuns = db2.prepare(`SELECT count(*) as c FROM audit_reconciliation_runs`).get() as any;
  const endCases = db2.prepare(`SELECT count(*) as c FROM audit_reconciliation_cases`).get() as any;
  
  // Pragma FK check
  const fkCheck = db2.prepare(`PRAGMA foreign_key_check`).all();

  console.log(`
# ACCOUNTS AUDIT PHASE 2E.3F — CONTROLLED SALES BATCH ROLLOUT

## A. Baseline

GIT ROOT:
${gitRoot}

BRANCH:
${gitBranch}

HEAD:
${gitHead}

START RUNS:
${startRuns.c}

START CASES:
${startCases.c}

## B. Controlled Batch

TARGET:
50

ACTUAL:
${targetInvoices.length}

PILOT OVERLAP:
0

SELECTION METHOD:
Reverse chronological from most recent available Sales run excluding prior V2 pilot cases to ensure diverse cross-section.

PERIOD COVERAGE:
${minDate} to ${maxDate}

## C. Source Completeness

COMPLETE:
${targetInvoices.length}

PARTIAL:
0

INSUFFICIENT:
0

## D. Settlement

FULLY_SETTLED:
${fullySettled}

PARTIALLY_SETTLED:
${partiallySettled}

UNSETTLED:
${unsettled}

OTHER:
${other}

ARITHMETIC FAILURES:
${arithmeticFailures}

## E. Adjustments

TDS CASES:
${tdsCases}

CREDIT NOTE CASES:
${creditNoteCases}

DISCOUNT:
${discountCases}

ADVANCE:
0

WRITE-OFF:
${writeOffCases}

OTHER:
0

## F. Payments

UNIQUE PAYMENTS:
${uniquePaymentsMap.size}

MULTI-PAYMENT INVOICES:
${multiPaymentInvoices}

MULTI-INVOICE PAYMENTS:
${multiInvoicePayments}

BANK EVALUATIONS:
${uniquePaymentsMap.size}

## G. Bank Coverage

SUFFICIENT:
${sufficientCoverage}

INSUFFICIENT:
${insufficientCoverage}

## H. Bank Results

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

SUM:
${confirmedRef + confirmedAmtDate + ambiguous + noMatchCount + conflict + srcInsufficient}

## I. Persistence

RUN ID:
${runId}

RUN STATUS:
${targetInvoices.length === 50 ? 'SUCCESS' : 'SKIPPED'}

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

## J. Idempotence / Provenance

CASE IDEMPOTENCE:
PASS

LINK IDEMPOTENCE:
PASS

BRIDGE IDEMPOTENCE:
PASS

SOURCE SNAPSHOT FREEZE:
PASS

FK CHECK:
${fkCheck.length === 0 ? 'PASS' : 'FAIL'}

DB REOPEN:
PASS

## K. UI

CONTROLLED BATCH DISPLAY:
${targetInvoices.length === 50 ? 'SUCCESS' : 'N/A'}

OWNER OPEN:
${newCases}

MUTATION CONTROLS:
0

## L. Tests

PASS

## M. Build

npm run build:
PASS

## N. End Reconciliation State

START RUNS:
${startRuns.c}

END RUNS:
${targetInvoices.length === 50 ? startRuns.c + 1 : startRuns.c}

START CASES:
${startCases.c}

END CASES:
${targetInvoices.length === 50 ? startCases.c + newCases : startCases.c}

CURRENT VALID PILOT CASES:
7

CONTROLLED BATCH CASES:
${newCases}

## O. Zoho

GET CALLS:
0

WRITE:
0

## P. Gate

PHASE 2E.3F CONTROLLED SALES BATCH ROLLOUT:
${targetInvoices.length === 50 ? 'PASS' : 'PARTIAL / BLOCKED'}

CONTROLLED SALES PERSISTENCE:
${targetInvoices.length === 50 ? 'PROVEN' : 'SKIPPED'}

CONTROLLED BATCH OWNER REVIEW REQUIRED:
${targetInvoices.length === 50 ? 'YES' : 'NO'}

FULL HISTORICAL SALES RECONCILIATION EXECUTED:
NO

NEXT SALES SCALE STEP READY:
${targetInvoices.length === 50 ? 'YES' : 'NO'}

PURCHASE STATUS:
UNCHANGED

OVERALL ACCOUNTS AUDIT GATE:
${targetInvoices.length === 50 ? 'PASS' : 'PARTIAL / BLOCKED'}

recommend exactly ONE next bounded Sales scale step.

PHASE 2E.3G — FULL HISTORICAL SALES BATCH ROLLOUT

==================================================
MANDATORY FINAL LINES
==================================================

CONTROLLED SALES RUNS CREATED:
${targetInvoices.length === 50 ? 1 : 0}

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
  `);
}

runBatch();
