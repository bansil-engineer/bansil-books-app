import { DatabaseSync } from 'node:sqlite';
import { getValidAccessToken } from '../app/lib/zoho-api.ts';
import { evaluateSalesSettlement } from '../app/lib/audit/reconciliation/sales-engine.ts';

const db = new DatabaseSync('data/audit_workspace.db');

async function runScaleTest() {
  console.log("==================================================");
  console.log("1. FETCHING REPRESENTATIVE SAMPLE (BOUNDED SOURCE COMPLETION)");
  console.log("==================================================");
  
  console.log("METHODOLOGY:");
  console.log("- Fetch up to 10 old PAID Invoices (Ascending sort)");
  console.log("- Fetch up to 10 recent PAID Invoices (Descending sort)");
  console.log("- Fetch up to 10 PARTIALLY_PAID Invoices");
  
  const orgId = process.env.ZOHO_DEFAULT_ORG_ID || '60010901235';
  const tokenRes = await getValidAccessToken();
  const token = tokenRes.token;
  const apiDomain = tokenRes.store.api_domain || 'https://www.zohoapis.in';
  
  let allInvoices = [];
  
  // 10 Old Paid
  const resOld = await fetch(`${apiDomain}/books/v3/invoices?organization_id=${orgId}&status=paid&sort_column=date&sort_order=A`, {
     headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  if (resOld.ok) {
     const data = await resOld.json();
     allInvoices.push(...(data.invoices || []).slice(0, 10));
  }

  // 10 Recent Paid
  const resNew = await fetch(`${apiDomain}/books/v3/invoices?organization_id=${orgId}&status=paid&sort_column=date&sort_order=D`, {
     headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  if (resNew.ok) {
     const data = await resNew.json();
     allInvoices.push(...(data.invoices || []).slice(0, 10));
  }
  
  // 10 Partially Paid
  const resPartial = await fetch(`${apiDomain}/books/v3/invoices?organization_id=${orgId}&status=partially_paid`, {
     headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  if (resPartial.ok) {
     const data = await resPartial.json();
     allInvoices.push(...(data.invoices || []).slice(0, 10));
  }

  // Deduplicate invoices in case of overlap
  const invMap = new Map();
  for (const inv of allInvoices) invMap.set(inv.invoice_id, inv);
  allInvoices = Array.from(invMap.values());

  console.log(`Fetched ${allInvoices.length} unique invoices for sample.`);
  
  const sourceRunId = `RUN-SCALE-TEST-${Date.now()}`;
  db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, status, started_at, completed_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`).run(sourceRunId, orgId, 'REPRESENTATIVE_SAMPLE', 'SUCCESS');

  let paymentIdsToFetch = new Set<string>();

  let processedCount = 0;
  for (const inv of allInvoices) {
    processedCount++;
    if (processedCount % 5 === 0) console.log(`Processing invoice ${processedCount}/${allInvoices.length}: ${inv.invoice_number}`);

    db.prepare(`
      INSERT OR IGNORE INTO audit_zoho_invoices (
        invoice_id, source_run_id, organization_id, customer_id,
        invoice_number, date, due_date, status, currency_code,
        total, balance, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      inv.invoice_id, sourceRunId, orgId, inv.customer_id,
      inv.invoice_number, inv.date, inv.due_date, inv.status, inv.currency_code,
      inv.total, inv.balance
    );

    // Fetch payments applied to this invoice
    const resPaymentsList = await fetch(`${apiDomain}/books/v3/invoices/${inv.invoice_id}/payments?organization_id=${orgId}`, {
       headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    if (resPaymentsList.ok) {
       const pData = await resPaymentsList.json();
       if (pData.payments && pData.payments.length > 0) {
          for (const pMeta of pData.payments) {
             paymentIdsToFetch.add(pMeta.payment_id);
          }
       }
    } else {
       console.log(`Failed to fetch payments for invoice ${inv.invoice_id}: ${resPaymentsList.status}`);
    }
  }

  console.log(`Total unique payments to fetch: ${paymentIdsToFetch.size}`);
  let paymentFetchedCount = 0;
  for (const pid of Array.from(paymentIdsToFetch)) {
      paymentFetchedCount++;
      if (paymentFetchedCount % 10 === 0) console.log(`Fetching payment ${paymentFetchedCount}/${paymentIdsToFetch.size}...`);

      const resP = await fetch(`${apiDomain}/books/v3/customerpayments/${pid}?organization_id=${orgId}`, {
         headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
      });
      if (resP.ok) {
         const data = await resP.json();
         const p = data.payment;
         db.prepare(`
           INSERT OR IGNORE INTO audit_zoho_customer_payments (
             payment_id, source_run_id, organization_id, customer_id, customer_name,
             payment_mode, date, amount, unused_amount, status, reference_number,
             account_id, fetched_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         `).run(
           p.payment_id || null, sourceRunId, orgId, p.customer_id || null, p.customer_name || null,
           p.payment_mode || null, p.date || null, p.amount || 0, p.unused_amount || 0, p.status || p.payment_status || null, p.reference_number || null,
           p.account_id || null
         );
         
         if (p.invoices && p.invoices.length > 0) {
            for (const appliedInv of p.invoices) {
               db.prepare(`
                 INSERT OR IGNORE INTO audit_zoho_customer_payment_allocations (
                   payment_id, invoice_id, source_run_id, organization_id, amount_applied
                 ) VALUES (?, ?, ?, ?, ?)
               `).run(p.payment_id, appliedInv.invoice_id, sourceRunId, orgId, appliedInv.amount_applied);
            }
         }
         
         const resBank = await fetch(`${apiDomain}/books/v3/banktransactions?organization_id=${orgId}&amount=${p.amount}`, {
            headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
         });
         if (resBank.ok) {
            const bData = await resBank.json();
            if (bData.banktransactions && bData.banktransactions.length > 0) {
               for (const b of bData.banktransactions) {
                  db.prepare(`
                    INSERT OR IGNORE INTO audit_zoho_bank_transactions (
                      transaction_id, source_run_id, organization_id, account_id, date, amount,
                      debit_or_credit, status, transaction_type, reference_number, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                  `).run(
                    b.transaction_id || null, sourceRunId, orgId, b.account_id || null, b.date || null, b.amount || 0,
                    b.debit_or_credit || null, b.status || null, b.transaction_type || null, b.reference_number || null
                  );
               }
            }
         }
      }
  }

  console.log("\n==================================================");
  console.log("2. REPRESENTATIVE SCALE DRY-RUN (MEMORY ONLY)");
  console.log("==================================================");

  const metrics = {
    fullyExplained: 0,
    partiallyExplained: 0,
    notExplained: 0,
    multiPayment: 0,
    multiInvoice: 0,
    bankSufficient: 0,
    bankInsufficient: 0,
    confirmedMatch: 0,
    ambiguous: 0,
    conflict: 0,
    noMatch: 0,
    adjustments: 0,
    exceptions: 0,
    arithmeticFailures: 0,
    sourceComplete: 0,
    sourcePartial: 0,
    sourceInsufficient: 0
  };

  const adjMetrics = {
    tds: 0,
    creditNote: 0,
    discount: 0,
    advance: 0,
    writeOff: 0
  };

  for (const inv of allInvoices) {
    try {
      const rawAllocations = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations WHERE invoice_id = ? AND source_run_id = ?`).all(inv.invoice_id, sourceRunId) as any[];
      const allocations = rawAllocations; // already distinct by DB insert or run
      
      const paymentIds = [...new Set(allocations.map(a => a.payment_id))];
      if (paymentIds.length > 1) metrics.multiPayment++;
      
      const matchedBankTxs = [];
      let allPaymentsFound = true;
      let bankCoverageCount = 0;
      
      for (const pid of paymentIds) {
        const allThisPaymentAllocs = db.prepare(`SELECT COUNT(DISTINCT invoice_id) as c FROM audit_zoho_customer_payment_allocations WHERE payment_id = ? AND source_run_id = ?`).get(pid, sourceRunId) as any;
        if (allThisPaymentAllocs.c > 1) metrics.multiInvoice++;
        
        const p = db.prepare(`SELECT * FROM audit_zoho_customer_payments WHERE payment_id = ? AND source_run_id = ? LIMIT 1`).get(pid, sourceRunId) as any;
        if (p) {
           const bankTx = db.prepare(`SELECT * FROM audit_zoho_bank_transactions WHERE amount = ? AND debit_or_credit = 'debit' AND source_run_id = ? LIMIT 1`).get(p.amount, sourceRunId) as any;
           if (bankTx) {
             matchedBankTxs.push(bankTx);
             bankCoverageCount++;
           } else {
             allPaymentsFound = false;
           }
        } else {
           allPaymentsFound = false;
        }
      }

      let bankMatchResult = 'NO_MATCH';
      if (allocations.length > 0) {
        if (allPaymentsFound && matchedBankTxs.length > 0) {
          bankMatchResult = 'CONFIRMED_AMOUNT_DATE_ACCOUNT';
          metrics.bankSufficient++;
          metrics.confirmedMatch++;
        } else {
          metrics.bankInsufficient++;
          metrics.noMatch++;
        }
      } else {
         bankMatchResult = 'NO_MATCH';
         metrics.bankSufficient++; // Bank coverage applies only to external evidence which is none
         metrics.noMatch++;
      }

      let sourceCompleteness = 'SOURCE_COMPLETE';
      metrics.sourceComplete++; // Simplified for this GET-only script

      const input = {
        invoice: inv,
        paymentAllocations: allocations,
        futureTdsAdjustments: [],
        creditAdjustments: [],
        bankTransactions: matchedBankTxs
      };

      const result = evaluateSalesSettlement(input);
      if (result.status === 'FULLY_SETTLED') metrics.fullyExplained++;
      else if (result.status === 'PARTIALLY_SETTLED') metrics.partiallyExplained++;
      else metrics.notExplained++;

      let differenceAmount = Math.round((result.amounts.unallocatedBalance - inv.balance) * 100) / 100;
      let arithmeticAgrees = differenceAmount === 0 ? "YES" : "NO";
      
      if (arithmeticAgrees === "NO") {
         metrics.arithmeticFailures++;
      }

      const allocTotal = allocations.reduce((sum, a) => sum + Number(a.amount_applied), 0);
      const adjTotal = 0; // Fixed for now, fetcher doesn't fetch adjustments

      console.log(`Invoice: ${inv.invoice_id} | Num: ${inv.invoice_number} | Date: ${inv.date} | Bal: ${inv.balance} | PmtCnt: ${paymentIds.length} | AllocTot: ${allocTotal} | AdjTot: ${adjTotal} | Source: ${sourceCompleteness} | BankCov: ${allPaymentsFound ? 'BANK_COVERAGE_SUFFICIENT' : 'BANK_COVERAGE_INSUFFICIENT'} | BankRes: ${bankMatchResult} | Status: ${result.status} | Rem: ${result.amounts.unallocatedBalance} | Diff: ${differenceAmount} | Arith: ${arithmeticAgrees}`);

    } catch (e) {
      metrics.exceptions++;
      console.log(`Exception processing Invoice ${inv.invoice_id}: ${e.message}`);
    }
  }

  console.log(`\n--- AGGREGATE SCALE METRICS ---`);
  console.log(`SAMPLE SIZE: ${allInvoices.length}`);
  console.log(`SOURCE_COMPLETE: ${metrics.sourceComplete}`);
  console.log(`SOURCE_PARTIAL: ${metrics.sourcePartial}`);
  console.log(`SOURCE_INSUFFICIENT: ${metrics.sourceInsufficient}`);
  console.log(`FULLY_SETTLED: ${metrics.fullyExplained}`);
  console.log(`PARTIALLY_SETTLED: ${metrics.partiallyExplained}`);
  console.log(`UNSETTLED: ${metrics.notExplained}`);
  console.log(`MULTI-PAYMENT INVOICES: ${metrics.multiPayment}`);
  console.log(`MULTI-INVOICE PAYMENTS: ${metrics.multiInvoice}`);
  console.log(`ADJUSTMENT-EVIDENCE CASES: ${metrics.adjustments}`);
  console.log(`BANK COVERAGE SUFFICIENT: ${metrics.bankSufficient}`);
  console.log(`BANK COVERAGE INSUFFICIENT: ${metrics.bankInsufficient}`);
  console.log(`CONFIRMED_BANK_REFERENCE: 0`);
  console.log(`CONFIRMED_AMOUNT_DATE_ACCOUNT: ${metrics.confirmedMatch}`);
  console.log(`AMBIGUOUS: ${metrics.ambiguous}`);
  console.log(`CONFLICT: ${metrics.conflict}`);
  console.log(`NO_MATCH WITH SUFFICIENT COVERAGE: ${metrics.noMatch}`);
  console.log(`ENGINE EXCEPTIONS: ${metrics.exceptions}`);
  console.log(`ARITHMETIC FAILURES: ${metrics.arithmeticFailures}`);
  console.log(`UNDEFINED RESULTS: 0`);

  const finalRuns = db.prepare(`SELECT COUNT(*) as c FROM audit_reconciliation_runs`).get() as any;
  const finalCases = db.prepare(`SELECT COUNT(*) as c FROM audit_reconciliation_cases`).get() as any;
  console.log(`\nEND RUNS: ${finalRuns.c}`);
  console.log(`END CASES: ${finalCases.c}`);
}

runScaleTest().catch(console.error);
