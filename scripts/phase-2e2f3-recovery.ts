
import fs from "fs";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

async function main() {
  const db = getAuditDatabase();
  db.exec("ATTACH DATABASE 'data/bansil_books.db' AS operational");

  const targetAccountId = "3166667000000092038";
  
  const envFile = fs.readFileSync('.env.local', 'utf8');
  let ZOHO_ORG_ID = "";
  for (const line of envFile.split('\n')) {
    if (line.startsWith('ZOHO_DEFAULT_ORG_ID=')) {
      ZOHO_ORG_ID = line.split('=')[1].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  }

  const { token, store } = await getValidAccessToken();
  const domain = store.api_domain || "https://www.zohoapis.in";
  
  const sourceRunId = `bank_source_recovery_${Date.now()}`;
  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status, api_domain)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceRunId, ZOHO_ORG_ID, 'BANK_TRANSACTIONS', new Date().toISOString(), 'RUNNING', 'https://www.zohoapis.com');

  const start = "2026-08-22";
  const end = "2026-09-20";
  
  let rowsFetched = 0;
  let rowsInserted = 0;

  const url = `${domain}/books/v3/banktransactions?organization_id=${ZOHO_ORG_ID}&account_id=${targetAccountId}&date_start=${start}&date_end=${end}`;
  const res = await secureZohoFetch(url, { headers: { "Authorization": `Zoho-oauthtoken ${token}` } }, "audit_sync");
  
  if (res.ok) {
    const json = await res.json();
    const txns = json.banktransactions || [];
    rowsFetched += txns.length;

    for (const txn of txns) {
      const stmt = db.prepare(`
        INSERT INTO audit_zoho_bank_transactions (
          organization_id, transaction_id, source_run_id, account_id, date, amount, transaction_type, 
          status, debit_or_credit, reference_number, imported_transaction_id, description, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (organization_id, transaction_id, source_run_id) DO NOTHING
      `);
      const result = stmt.run(
        ZOHO_ORG_ID, txn.transaction_id, sourceRunId, targetAccountId, txn.date, txn.amount, txn.transaction_type,
        txn.status, txn.debit_or_credit, txn.reference_number || null, txn.imported_transaction_id || null, 
        txn.description || null, new Date().toISOString()
      );
      if (result.changes > 0) rowsInserted++;
    }
  }

  db.prepare(`
    UPDATE audit_zoho_source_runs 
    SET status = 'SUCCESS', completed_at = ?, records_seen = ?, records_written = ?
    WHERE source_run_id = ?
  `).run(new Date().toISOString(), rowsFetched, rowsInserted, sourceRunId);

  const targetAccCount = (db.prepare(`SELECT COUNT(*) as count FROM audit_zoho_bank_transactions WHERE source_run_id = ?`).get(sourceRunId) as any).count;
  
  console.log(`RECOVERY SOURCE RUN: ${sourceRunId}`);
  console.log(`ROWS FETCHED: ${rowsFetched}`);
  console.log(`ROWS INSERTED: ${rowsInserted}`);
  console.log(`TARGET ACCOUNT ROWS: ${targetAccCount}`);

}

main().catch(console.error);
