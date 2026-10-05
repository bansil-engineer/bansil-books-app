import { getAuditDatabase } from "../app/lib/db/audit-database";
import { evaluatePurchaseSettlement } from "../app/lib/audit/reconciliation/purchase-engine";
import type { PurchaseSettlementInput, PurchaseReconciliationResult } from "../app/lib/audit/reconciliation/types";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

async function main() {
  console.log("Starting Phase 2E.2G Purchase Adjustment Source Extraction...");
  const db = getAuditDatabase();
  db.exec(`ATTACH DATABASE 'data/bansil_books.db' AS operational`);

  // 1. Schema Change
  console.log("\n## I. Adjustment Persistence");
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_zoho_purchase_adjustments (
      organization_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      bill_id TEXT NOT NULL,
      adjustment_source_id TEXT,
      adjustment_type TEXT NOT NULL,
      source_field_name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      linked_source_entity TEXT,
      created_time TEXT,
      PRIMARY KEY (organization_id, source_run_id, bill_id, adjustment_type, source_field_name)
    );
  `);
  
  console.log("SCHEMA CHANGE: ADDITIVE MIGRATION EXECUTED");

  // 2. Fetch Sample
  const query = `
    SELECT
      b.bill_id,
      b.bill_number,
      'operational' as bill_source_run_id,
      b.total as gross_amount,
      b.status as bill_status,
      b.vendor_name,
      b.date as bill_date
    FROM operational.purchase_bills b
    JOIN audit_zoho_vendor_payment_allocations vpa ON b.bill_id = vpa.bill_id
    JOIN audit_zoho_vendor_payments vp ON vpa.payment_id = vp.payment_id
    GROUP BY b.bill_id
    ORDER BY b.date DESC
    LIMIT 5;
  `;

  const rows = db.prepare(query).all() as any[];

  if (rows.length === 0) {
    console.log("No bills found.");
    return;
  }

  const { token, store } = await getValidAccessToken();
  const domain = store.api_domain || "https://www.zohoapis.com";
  const orgId = "774390949";
  
  const sourceRunId = `audit_adjustments_${Date.now()}`;
  console.log(`SOURCE RUN: ${sourceRunId}`);
  let rowsAdded = 0;
  
  let getCalls = 0;

  console.log("\n## J. Five-Bill Adjustment Rerun\n");

  for (const row of rows) {
    const { bill_id, bill_number, gross_amount, bill_source_run_id } = row;
    
    // Fetch live data
    const billUrl = `${domain}/books/v3/bills/${bill_id}?organization_id=${orgId}`;
    const billRes = await secureZohoFetch(billUrl, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    getCalls++;
    const billData = await billRes.json();
    const liveBill = billData.bill;

    const adjustments = [];
    
    // Analyze fields
    if (liveBill.tds_amount && Number(liveBill.tds_amount) > 0) {
      adjustments.push({ type: 'TDS', field: 'tds_amount', amount: Number(liveBill.tds_amount) });
    }
    if (liveBill.total_retention_amount && Number(liveBill.total_retention_amount) > 0) {
      adjustments.push({ type: 'RETENTION', field: 'total_retention_amount', amount: Number(liveBill.total_retention_amount) });
    }
    // Handle discounts properly, avoid double counting
    let discount = 0;
    if (liveBill.discount_amount && Number(liveBill.discount_amount) > 0) {
        discount = Number(liveBill.discount_amount);
        adjustments.push({ type: 'DISCOUNT', field: 'discount_amount', amount: discount });
    } else if (liveBill.discount_total && Number(liveBill.discount_total) > 0) {
        discount = Number(liveBill.discount_total);
        adjustments.push({ type: 'DISCOUNT', field: 'discount_total', amount: discount });
    }
    
    if (liveBill.vendor_credits_applied && Number(liveBill.vendor_credits_applied) > 0) {
      adjustments.push({ type: 'VENDOR_CREDIT', field: 'vendor_credits_applied', amount: Number(liveBill.vendor_credits_applied) });
    }
    
    if (liveBill.adjustment && Number(liveBill.adjustment) !== 0) {
      // Map to OTHER_EXPLAINED_ADJUSTMENT, or ROUNDING if documented
      adjustments.push({ type: 'OTHER_EXPLAINED_ADJUSTMENT', field: 'adjustment', amount: Number(liveBill.adjustment) });
    }

    // Persist
    for (const adj of adjustments) {
      db.prepare(`
        INSERT OR IGNORE INTO audit_zoho_purchase_adjustments 
        (organization_id, source_run_id, bill_id, adjustment_type, source_field_name, amount, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, sourceRunId, bill_id, adj.type, adj.field, adj.amount, liveBill.currency_code || 'INR');
      rowsAdded++;
    }

    // Now RERUN ENGINE
    const allAllocations = db.prepare(`SELECT payment_id, amount_applied, source_run_id FROM audit_zoho_vendor_payment_allocations WHERE bill_id = ?`).all(bill_id) as any[];
    const paymentAllocations = [];
    const payments = [];
    const paymentAccounts = [];
    
    for (const alloc of allAllocations) {
      paymentAllocations.push({
        paymentId: alloc.payment_id,
        billId: bill_id,
        amountApplied: alloc.amount_applied,
        sourceRunId: alloc.source_run_id
      });
      
      const p = db.prepare(`SELECT amount, date, source_run_id, paid_through_account_id, reference_number FROM audit_zoho_vendor_payments WHERE payment_id = ?`).get(alloc.payment_id) as any;
      if (p) {
        payments.push({
          paymentId: alloc.payment_id,
          amount: p.amount,
          date: p.date,
          currencyCode: "INR",
          sourceRunId: p.source_run_id,
          paidThroughAccountId: p.paid_through_account_id,
          referenceNumber: p.reference_number
        });
        const acc = db.prepare(`SELECT account_type, account_name FROM audit_zoho_bank_accounts WHERE account_id = ? LIMIT 1`).get(p.paid_through_account_id) as any;
        paymentAccounts.push({ accountId: p.paid_through_account_id, accountType: acc ? acc.account_type : "unknown" });
      }
    }

    // Bank Candidates
    let bankCandidates: any[] = [];
    const accounts = Array.from(new Set(paymentAccounts.filter(a => a.accountType === "bank" || a.accountType === "credit_card").map(a => a.accountId)));
    const selectedRunId = 'bank_source_recovery_1789801003182';

    if (accounts.length > 0) {
       for (const acc of accounts) {
         const cands = db.prepare(`
            SELECT transaction_id as transactionId, account_id as accountId, date, amount, debit_or_credit as debitOrCredit, reference_number as referenceNumber, status as rawStatus, description, imported_transaction_id as importedTransactionId, source_run_id as sourceRunId
            FROM audit_zoho_bank_transactions
            WHERE account_id = ? AND source_run_id = ?
         `).all(acc, selectedRunId) as any[];
         bankCandidates = bankCandidates.concat(cands.map(c => ({...c, amount: Math.abs(c.amount)})));
       }
    }

    // Map adjustments to engine input (exclude generic adjustment if semantics unclear)
    const engineAdjustments = adjustments
      .filter(a => a.type !== 'OTHER_EXPLAINED_ADJUSTMENT')
      .map((a, i) => ({
      adjustmentId: `adj_${bill_id}_${i}`,
      billId: bill_id,
      adjustmentType: a.type as any,
      amount: a.amount,
      currencyCode: liveBill.currency_code || 'INR',
      sourceRunId: sourceRunId,
      evidenceStatus: 'APPROVED_ADJUSTMENT'
    }));

    const input: PurchaseSettlementInput = {
      bill: {
        billId: bill_id,
        total: gross_amount,
        balance: 0, // Using 0 for audit checks
        currencyCode: liveBill.currency_code || 'INR',
        sourceRunId: bill_source_run_id,
      },
      paymentAllocations,
      payments,
      paymentAccounts,
      bankTransactions: bankCandidates,
      adjustments: engineAdjustments
    };

    const result = evaluatePurchaseSettlement(input);
    const bankResult = result.bankMatchResults && result.bankMatchResults.length > 0 ? result.bankMatchResults[0].matchResult : "NO_MATCH";
    const sumAlloc = paymentAllocations.reduce((sum, a) => sum + a.amountApplied, 0);

    console.log(`BILL: ${bill_id} (${bill_number})`);
    console.log(`GROSS: ${gross_amount}`);
    console.log(`SOURCE BALANCE: ${liveBill.balance}`);
    console.log(`PAYMENT ALLOCATIONS: ${sumAlloc}`);
    console.log(`EXPLICIT TDS: ${adjustments.find(a => a.type === 'TDS')?.amount || 0}`);
    console.log(`EXPLICIT RETENTION: ${adjustments.find(a => a.type === 'RETENTION')?.amount || 0}`);
    console.log(`EXPLICIT DISCOUNT: ${adjustments.find(a => a.type === 'DISCOUNT')?.amount || 0}`);
    console.log(`EXPLICIT VENDOR CREDIT: ${adjustments.find(a => a.type === 'VENDOR_CREDIT')?.amount || 0}`);
    console.log(`EXPLICIT GENERIC ADJUSTMENT: ${adjustments.find(a => a.type === 'OTHER_EXPLAINED_ADJUSTMENT')?.amount || 0}`);
    console.log(`EXPLICIT ADVANCE: 0`);
    console.log(`EXPECTED CASH SETTLEMENT: ${result.expectedSettlement}`);
    console.log(`BANK SOURCE RUN: ${selectedRunId}`);
    console.log(`BANK RESULT: ${bankResult}`);
    console.log(`SETTLEMENT STATUS: ${result.settlementStatus}`);
    console.log(`ENGINE REMAINING: ${result.remainingAmount}`);
    console.log(`UNEXPLAINED DIFFERENCE: ${result.differenceAmount}`);
    console.log("--------------------------------------------------");
  }
  
  console.log(`ROWS ADDED: ${rowsAdded}`);
  console.log(`ZOHO GET CALLS: ${getCalls}`);
  console.log(`ZOHO WRITE: 0`);

}

main().catch(console.error);
