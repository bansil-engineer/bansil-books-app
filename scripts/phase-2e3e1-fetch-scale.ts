import { DatabaseSync } from 'node:sqlite';
import { loadValidAccessToken } from '../app/lib/audit/auth/token-manager.ts';

const db = new DatabaseSync('data/audit_workspace.db');

async function fetchRepresentativeSample() {
  const orgId = process.env.ZOHO_DEFAULT_ORG_ID || '60010901235';
  
  // Need OAuth token safely
  const token = await loadValidAccessToken();
  
  // 1. Fetch 30 Invoices (Paid and Partially Paid to get diversity)
  let allInvoices = [];
  
  // Fetch some Paid
  const resPaid = await fetch(`https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&status=paid`, {
     headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  if (resPaid.ok) {
     const data = await resPaid.json();
     allInvoices.push(...(data.invoices || []).slice(0, 15));
  }

  // Fetch some Partial/Open
  const resPartial = await fetch(`https://www.zohoapis.com/books/v3/invoices?organization_id=${orgId}&status=partially_paid`, {
     headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  });
  if (resPartial.ok) {
     const data = await resPartial.json();
     allInvoices.push(...(data.invoices || []).slice(0, 15));
  }

  console.log(`Fetched ${allInvoices.length} invoices`);
  
  const sourceRunId = `RUN-SCALE-TEST-${Date.now()}`;
  db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, status, created_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(sourceRunId, orgId, 'REPRESENTATIVE_SAMPLE', 'SUCCESS');

  let paymentIdsToFetch = new Set<string>();

  for (const inv of allInvoices) {
    db.prepare(`
      INSERT OR IGNORE INTO audit_zoho_invoices (
        invoice_id, source_run_id, organization_id, customer_id, customer_name,
        invoice_number, date, due_date, status, currency_code,
        total, balance, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      inv.invoice_id, sourceRunId, orgId, inv.customer_id, inv.customer_name,
      inv.invoice_number, inv.date, inv.due_date, inv.status, inv.currency_code,
      inv.total, inv.balance
    );

    // Fetch payments for this invoice? Actually, Customer Payments are linked to Customer, not directly to Invoice on listing, unless we fetch specific payment. 
    // Wait, we can fetch payments by customer, then find allocations, or we can fetch the invoice explicitly to get its payments?
    // /invoices/:id/payments 
    const resInv = await fetch(`https://www.zohoapis.com/books/v3/invoices/${inv.invoice_id}?organization_id=${orgId}`, {
       headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    if (resInv.ok) {
       const data = await resInv.json();
       const detailedInv = data.invoice;
       if (detailedInv.payments && detailedInv.payments.length > 0) {
          for (const p of detailedInv.payments) {
             paymentIdsToFetch.add(p.payment_id);
             db.prepare(`
               INSERT OR IGNORE INTO audit_zoho_customer_payment_allocations (
                 payment_id, invoice_id, source_run_id, organization_id, amount_applied, fetched_at
               ) VALUES (?, ?, ?, ?, ?, datetime('now'))
             `).run(p.payment_id, inv.invoice_id, sourceRunId, orgId, p.amount_applied);
          }
       }
    }
  }

  console.log(`Need to fetch ${paymentIdsToFetch.size} payments`);
  
  for (const pid of paymentIdsToFetch) {
      const resP = await fetch(`https://www.zohoapis.com/books/v3/customerpayments/${pid}?organization_id=${orgId}`, {
         headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
      });
      if (resP.ok) {
         const data = await resP.json();
         const p = data.payment;
         db.prepare(`
           INSERT OR IGNORE INTO audit_zoho_customer_payments (
             payment_id, source_run_id, organization_id, customer_id, customer_name,
             payment_mode, date, amount, unused_amount, bcy_amount, status, reference_number,
             description, bank_account_id, fetched_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         `).run(
           p.payment_id, sourceRunId, orgId, p.customer_id, p.customer_name,
           p.payment_mode, p.date, p.amount, p.unused_amount, p.bcy_amount, p.status, p.reference_number,
           p.description, p.account_id
         );
         
         // Fetch Bank Tx for this payment amount
         const resBank = await fetch(`https://www.zohoapis.com/books/v3/banktransactions?organization_id=${orgId}&amount=${p.amount}`, {
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
                    b.transaction_id, sourceRunId, orgId, b.account_id, b.date, b.amount,
                    b.debit_or_credit, b.status, b.transaction_type, b.reference_number
                  );
               }
            }
         }
      }
  }
}

fetchRepresentativeSample().catch(console.error);
