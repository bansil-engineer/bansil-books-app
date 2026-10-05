import { secureZohoFetch } from '../app/lib/zoho-security-guard.ts';
import { getValidAccessToken } from '../app/lib/zoho-api.ts';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/audit_workspace.db');

async function run() {
  const { token, store } = await getValidAccessToken();
  const domain = store.api_domain;
  const orgId = store.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;

  const sourceRunId = `RUN-3D-SALES-${Date.now()}`;
  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status)
    VALUES (?, ?, ?, datetime('now'), ?)
  `).run(sourceRunId, orgId, 'CUSTOMER_PAYMENT_AND_BANK', 'SUCCESS');

  let rowsInserted = 0;
  let rowsAttached = 0;
  
  // The missing payments that complete the two invoices:
  // 3166667000019016691 and 3166667000016731057 (along with the bounded one 3166667000019016185 just in case it wasn't fully persisted)
  const targetPayments = [
    '3166667000019016185',
    '3166667000019016691', 
    '3166667000016731057'
  ];

  for (const paymentId of targetPayments) {
    const pUrl = `${domain}/books/v3/customerpayments/${paymentId}?organization_id=${orgId}`;
    const pRes = await secureZohoFetch(pUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } });
    const pData = await pRes.json();
    const detail = pData.payment;
    if (!detail) {
      console.log('No detail for payment:', paymentId, pData);
      continue;
    }
    console.log('Fetched payment detail for:', detail.payment_id, detail.amount);

    try {
      db.prepare(`
        INSERT OR IGNORE INTO audit_zoho_customer_payments (
          organization_id, payment_id, source_run_id, customer_id, payment_mode, date, amount, unused_amount, account_id, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(orgId, detail.payment_id, sourceRunId, detail.customer_id, detail.payment_mode, detail.date, detail.amount, detail.unused_amount, detail.account_id);
      rowsInserted++;
    } catch (e: any) {
      console.log('Payment duplicate/error:', e.message);
    }

    if (detail.invoices) {
      for (const alloc of detail.invoices) {
        try {
           db.prepare(`
            INSERT OR IGNORE INTO audit_zoho_customer_payment_allocations (
              organization_id, payment_id, invoice_id, source_run_id, amount_applied
            ) VALUES (?, ?, ?, ?, ?)
          `).run(orgId, detail.payment_id, alloc.invoice_id, sourceRunId, alloc.amount_applied);
          rowsAttached++;
        } catch (e: any) {
           console.log('Allocation error:', e.message);
        }
      }
    }
  }

  // 2. Fetch Bank Transactions for account 3166667000000092034 between 2026-09-10 and 2026-09-20
  const accId = '3166667000000092034';
  const fromDate = '2026-09-10';
  const toDate = '2026-09-20';
  
  let bankRowsFetched = 0;
  let bankRowsInserted = 0;

  const bUrl = `${domain}/books/v3/banktransactions?organization_id=${orgId}&account_id=${accId}&transaction_date_start=${fromDate}&transaction_date_end=${toDate}&page=1`;
  const bRes = await secureZohoFetch(bUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } });
  const bData = await bRes.json();

  if (bData.banktransactions) {
    for (const tx of bData.banktransactions) {
      bankRowsFetched++;
      try {
        db.prepare(`
          INSERT OR IGNORE INTO audit_zoho_bank_transactions (
            organization_id, transaction_id, source_run_id, account_id, date, amount, debit_or_credit, transaction_type, status, reference_number, description, fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(orgId, tx.transaction_id, sourceRunId, tx.account_id, tx.date, tx.amount, tx.debit_or_credit, tx.transaction_type, tx.status, tx.reference_number, tx.description);
        bankRowsInserted++;
      } catch (e) {}
    }
  }

  console.log(`SOURCE RUN: ${sourceRunId}`);
  console.log(`PAYMENTS/ALLOCATIONS INSERTED: ${rowsInserted} / ${rowsAttached}`);
  console.log(`BANK ROWS FETCHED: ${bankRowsFetched}`);
  console.log(`BANK ROWS INSERTED: ${bankRowsInserted}`);
}

run().catch(console.error);
