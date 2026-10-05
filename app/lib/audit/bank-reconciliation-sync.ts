import { getAuditDatabase } from "../db/audit-database";
import { readTokenStore } from "../zoho-token-store";
import { 
  listCustomerPayments,
  listVendorPayments,
  listExpenses
} from "./accounts/zoho-read-transactions";

export async function syncBankReconciliation(period: any) {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) {
    throw new Error("Zoho not connected");
  }
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "";
  const db = getAuditDatabase();
  const source_run_id = "BANK_SYNC_ACTIVE";
  const fetchedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status, api_domain, records_seen, records_written)
    VALUES (?, ?, 'bank_sync', ?, ?, 'SUCCESS', ?, 0, 0)
    ON CONFLICT(source_run_id) DO UPDATE SET completed_at=excluded.completed_at
  `).run(source_run_id, orgId, fetchedAt, fetchedAt, tokens.api_domain);

  let created = 0;
  
  db.exec('BEGIN TRANSACTION');
  try {
    // Note: Since Zoho bank accounts / transactions aren't exposed in our current zoho-read-transactions,
    // we sync the evidence (Customer Payments, Vendor Payments, Expenses)

    // 1. Customer Payments
    const cpRes = await listCustomerPayments(orgId, 200);
    for (const row of cpRes.customerpayments || []) {
      db.prepare(`
        INSERT INTO audit_zoho_customer_payments (organization_id, payment_id, source_run_id, date, customer_id, customer_name, amount, currency, reference_number, invoice_numbers, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, payment_id, source_run_id) DO UPDATE SET
          date=excluded.date,
          amount=excluded.amount,
          fetched_at=excluded.fetched_at
      `).run(orgId, row.payment_id, source_run_id, row.date ?? null, row.customer_id ?? null, row.customer_name ?? null, row.amount ?? null, row.currency_code ?? null, row.reference_number ?? null, row.invoice_numbers ?? null, fetchedAt);
      created++;
    }

    // 2. Vendor Payments
    const vpRes = await listVendorPayments(orgId, 200);
    for (const row of vpRes.vendorpayments || []) {
      db.prepare(`
        INSERT INTO audit_zoho_vendor_payments (organization_id, payment_id, source_run_id, date, vendor_id, vendor_name, amount, currency, reference_number, bill_numbers, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, payment_id, source_run_id) DO UPDATE SET
          date=excluded.date,
          amount=excluded.amount,
          fetched_at=excluded.fetched_at
      `).run(orgId, row.payment_id, source_run_id, row.date ?? null, row.vendor_id ?? null, row.vendor_name ?? null, row.amount ?? null, row.currency_code ?? null, row.reference_number ?? null, row.bill_numbers ?? null, fetchedAt);
      created++;
    }

    // 3. Expenses
    const eRes = await listExpenses(orgId, 200);
    for (const row of eRes.expenses || []) {
      db.prepare(`
        INSERT INTO audit_zoho_expenses (organization_id, expense_id, source_run_id, date, account_id, account_name, paid_through_account_id, vendor_id, amount, currency, reference_number, status, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, expense_id, source_run_id) DO UPDATE SET
          date=excluded.date,
          amount=excluded.amount,
          status=excluded.status,
          fetched_at=excluded.fetched_at
      `).run(orgId, row.expense_id, source_run_id, row.date ?? null, row.account_id ?? null, row.account_name ?? null, row.paid_through_account_id ?? null, row.vendor_id ?? null, row.amount ?? null, row.currency_code ?? null, row.reference_number ?? null, row.status ?? null, fetchedAt);
      created++;
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { created, updated: 0, unchanged: 0, failed: 0, checked: created };
}
