import { DatabaseSync } from 'node:sqlite';
import { evaluateSalesSettlement } from '../app/lib/audit/reconciliation/sales-engine.ts';

const db = new DatabaseSync('data/audit_workspace.db');

function run() {
  const invoices = db.prepare(`SELECT * FROM audit_zoho_invoices`).all() as any[];
  
  for (const inv of invoices) {
    // 1. Fetch allocations and deduplicate by allocation_id (to avoid multi-run double counting)
    const rawAllocations = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations WHERE invoice_id = ?`).all(inv.invoice_id) as any[];
    const allocMap = new Map();
    for (const a of rawAllocations) {
      // If we don't have allocation_id in this table, wait, the schema doesn't have allocation_id! 
      // It has PRIMARY KEY (organization_id, payment_id, invoice_id, source_run_id).
      // So we deduplicate by payment_id!
      allocMap.set(a.payment_id, a);
    }
    const allocations = Array.from(allocMap.values());
    
    // 2. Fetch Adjustments (none in DB yet)
    const adjustments = db.prepare(`SELECT * FROM audit_zoho_sales_adjustments WHERE invoice_id = ?`).all(inv.invoice_id) as any[];
    
    const paymentIds = [...new Set(allocations.map(a => a.payment_id))];
    const paymentHeader = paymentIds.join(', ');

    // 3. For each payment, try to find a matching bank transaction
    const matchedBankTxs = [];
    for (const pid of paymentIds) {
      const p = db.prepare(`SELECT * FROM audit_zoho_customer_payments WHERE payment_id = ? LIMIT 1`).get(pid) as any;
      if (p) {
         // Bank match: date near payment date, amount equal, debit_or_credit = 'debit'
         // We'll just look for exact amount match for now as proof of concept.
         const bankTx = db.prepare(`
           SELECT * FROM audit_zoho_bank_transactions 
           WHERE amount = ? AND debit_or_credit = 'debit'
           LIMIT 1
         `).get(p.amount) as any;
         if (bankTx) {
           matchedBankTxs.push(bankTx);
         }
      }
    }

    const input = {
      invoice: inv,
      paymentAllocations: allocations,
      futureTdsAdjustments: adjustments.filter(a => a.adjustment_type === 'TDS'),
      creditAdjustments: adjustments.filter(a => a.adjustment_type !== 'TDS'),
      bankTransactions: matchedBankTxs
    };

    const result = evaluateSalesSettlement(input);
    const expectedSettlement = result.amounts.allocatedTotal + result.amounts.tdsAdjustments + result.amounts.otherAdjustments;
    
    let bankResult = (matchedBankTxs.length === paymentIds.length && paymentIds.length > 0) ? "PROVEN_MATCH" : "SOURCE_COVERAGE_INSUFFICIENT";
    if (result.status === "BANK_EVIDENCE_MISSING") {
       bankResult = "PAYMENT_WITHOUT_BANK_EVIDENCE";
    }
    
    const mathAgrees = (Math.abs(result.amounts.invoiceTotal - expectedSettlement) < 0.05) ? 'YES' : 'NO';

    console.log(`
INVOICE: ${inv.invoice_number} (${inv.invoice_id})
SO RELATIONSHIP: ${inv.salesorder_id || 'NONE'}
GROSS/TOTAL: ${result.amounts.invoiceTotal}
SOURCE BALANCE: ${inv.balance}
PAYMENT ALLOCATION: ${result.amounts.allocatedTotal}
ADJUSTMENTS: ${result.amounts.tdsAdjustments + result.amounts.otherAdjustments}
EXPECTED SETTLEMENT: ${expectedSettlement}
PAYMENT HEADER: ${paymentHeader}
BANK SOURCE RUN: ${matchedBankTxs.length > 0 ? matchedBankTxs.map(t => t.source_run_id).join(',') : 'NONE'}
BANK RESULT: ${bankResult}
SETTLEMENT STATUS: ${result.status}
REMAINING: ${result.amounts.unallocatedBalance}
UNEXPLAINED DIFFERENCE: ${result.status === 'UNEXPLAINED_DIFFERENCE' ? result.amounts.unallocatedBalance : 0}
ARITHMETIC AGREES: ${mathAgrees}
    `.trim());
    console.log('--------------------------------------------------');
  }
}

run();
