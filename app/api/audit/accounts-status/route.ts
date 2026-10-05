import { NextResponse } from "next/server";
import { getAuditDatabase } from "@/app/lib/db/audit-database";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getAuditDatabase();

    // 1. Production Cases/Runs Count
    const runsCount = db.prepare(`SELECT COUNT(*) as count FROM audit_reconciliation_runs`).get() as any;
    const casesCount = db.prepare(`SELECT COUNT(*) as count FROM audit_reconciliation_cases`).get() as any;

    // 2. Sales Cases (Domain = SALES)
    // Separate active cases (Pilot V2, Batch) from the failed V1 historical run using semantic run status
    const activeSalesCases = db.prepare(`
      SELECT c.* FROM audit_reconciliation_cases c
      JOIN audit_reconciliation_runs r ON c.reconciliation_run_id = r.reconciliation_run_id
      WHERE c.domain = 'SALES' 
      AND r.status = 'SUCCESS'
      ORDER BY c.created_at DESC
    `).all() as any[];

    const failedSalesCases = db.prepare(`
      SELECT c.* FROM audit_reconciliation_cases c
      JOIN audit_reconciliation_runs r ON c.reconciliation_run_id = r.reconciliation_run_id
      WHERE c.domain = 'SALES' 
      AND r.status = 'FAILED'
      ORDER BY c.created_at DESC
    `).all() as any[];

    // Calculate grouping summaries for UI badges
    const settlementSummary = { FULLY_SETTLED: 0, PARTIALLY_SETTLED: 0, UNSETTLED: 0, OTHER: 0 };
    const bankMatchSummary = { CONFIRMED_AMOUNT_DATE_ACCOUNT: 0, AMBIGUOUS: 0, NO_MATCH: 0, SOURCE_COVERAGE_INSUFFICIENT: 0 };
    
    const financialMetrics = {
      receivableTotalAudited: 0,
      receivableOutstanding: 0,
      payableTotalAudited: 0,
      payableOutstanding: 0,
      openMismatches: 0,
    };
    
    let ownerReviewOpen = 0;

    for (const c of activeSalesCases) {
      if (c.settlement_status === 'FULLY_SETTLED') settlementSummary.FULLY_SETTLED++;
      else if (c.settlement_status === 'PARTIALLY_SETTLED') settlementSummary.PARTIALLY_SETTLED++;
      else if (c.settlement_status === 'UNSETTLED') settlementSummary.UNSETTLED++;
      else settlementSummary.OTHER++;

      if (c.machine_result === 'CONFIRMED_AMOUNT_DATE_ACCOUNT') bankMatchSummary.CONFIRMED_AMOUNT_DATE_ACCOUNT++;
      else if (c.machine_result === 'AMBIGUOUS') bankMatchSummary.AMBIGUOUS++;
      else if (c.machine_result === 'NO_MATCH') bankMatchSummary.NO_MATCH++;
      else if (c.machine_result === 'SOURCE_COVERAGE_INSUFFICIENT') bankMatchSummary.SOURCE_COVERAGE_INSUFFICIENT++;

      if (c.owner_review_status === 'OPEN') ownerReviewOpen++;
      
      if (c.machine_result !== 'CONFIRMED_AMOUNT_DATE_ACCOUNT' || c.settlement_status !== 'FULLY_SETTLED') {
        financialMetrics.openMismatches++;
      }

      financialMetrics.receivableTotalAudited += c.expected_settlement_amount || 0;
      financialMetrics.receivableOutstanding += c.remaining_amount || 0;
    }

    // 3. Source Database Counts (GET-ONLY)
    const bankAccountsCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_bank_accounts`).get() as any).c || 0;
    const bankTxnCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_bank_transactions`).get() as any).c || 0;
    const soCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_sales_orders`).get() as any).c || 0;
    const cpCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_customer_payments`).get() as any).c || 0;
    const cpaCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_customer_payment_allocations`).get() as any).c || 0;
    const poCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_purchase_orders`).get() as any).c || 0;
    const vpCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_vendor_payments`).get() as any).c || 0;
    const vpaCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_vendor_payment_allocations`).get() as any).c || 0;
    const journalCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_journals`).get() as any).c || 0;
    const expenseCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_expenses`).get() as any).c || 0;

    const sourceCounts = {
      bankAccounts: bankAccountsCount,
      bankTransactions: bankTxnCount,
      salesOrders: soCount,
      customerPayments: cpCount,
      customerPaymentAllocations: cpaCount,
      purchaseOrders: poCount,
      vendorPayments: vpCount,
      vendorPaymentAllocations: vpaCount,
      journals: journalCount,
      expenses: expenseCount
    };

    // 4. Evidence Trace (Real Data Only)
    const paymentToBill = db.prepare(`
      SELECT payment_id as entity_id, 'Vendor Payment -> Bill' as relationship_type, source_run_id, 'PROVEN_ALLOCATION' as classification, bill_id as related_id
      FROM audit_zoho_vendor_payment_allocations
      LIMIT 10
    `).all() as any[];

    const paymentToAccount = db.prepare(`
      SELECT p.payment_id as entity_id, 'Vendor Payment -> Account' as relationship_type, p.source_run_id, 'PROVEN_EXPLICIT' as classification, p.paid_through_account_id as related_id
      FROM audit_zoho_vendor_payments p
      LIMIT 10
    `).all() as any[];

    const customerPaymentToInvoice = db.prepare(`
      SELECT payment_id as entity_id, 'Customer Payment -> Invoice' as relationship_type, source_run_id, 'PROVEN_ALLOCATION' as classification, invoice_id as related_id
      FROM audit_zoho_customer_payment_allocations
      LIMIT 10
    `).all() as any[];

    const customerPaymentToAccount = db.prepare(`
      SELECT p.payment_id as entity_id, 'Customer Payment -> Account' as relationship_type, p.source_run_id, 'NOT_PROVEN' as classification, p.account_id as related_id
      FROM audit_zoho_customer_payments p
      LIMIT 10
    `).all() as any[];

    const expenseToAccount = db.prepare(`
      SELECT expense_id as entity_id, 'Expense -> Paid-through' as relationship_type, source_run_id, 'PROVEN_EXPLICIT' as classification, paid_through_account_id as related_id
      FROM audit_zoho_expenses
      LIMIT 10
    `).all() as any[];

    const journalToCoa = db.prepare(`
      SELECT l.line_id as entity_id, 'Journal Line -> CoA' as relationship_type, j.source_run_id, 'PROVEN_EXPLICIT' as classification, l.account_id as related_id
      FROM audit_zoho_journal_lines l
      JOIN audit_zoho_journals j ON l.journal_id = j.journal_id
      LIMIT 10
    `).all() as any[];

    const evidenceTrace = [
      ...paymentToBill,
      ...paymentToAccount,
      ...customerPaymentToInvoice,
      ...customerPaymentToAccount,
      ...expenseToAccount,
      ...journalToCoa
    ];

    // Bank Source Status (Zoho Source Status)
    const bankTxnStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM audit_zoho_bank_transactions
      GROUP BY status
    `).all() as any[];

    return NextResponse.json({
      success: true,
      production: {
        runs: runsCount.count,
        cases: casesCount.count
      },
      salesStatus: {
        totalValidCases: activeSalesCases.length,
        totalFailedHistoricalCases: failedSalesCases.length,
        ownerReviewOpen,
        settlementSummary,
        bankMatchSummary,
        financialMetrics
      },
      salesCases: activeSalesCases,
      failedSalesCases: failedSalesCases,
      sourceCounts,
      evidenceTrace,
      bankTxnStatus
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
