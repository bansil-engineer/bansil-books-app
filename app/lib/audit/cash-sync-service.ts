import { getAuditDatabase } from "../db/audit-database.js";
import { getDatabase } from "../db/database.js";
import { readTokenStore } from "../zoho-token-store.js";
import { listCashAccountTransactions } from "./accounts/zoho-read-source.js";
import { advanceWatermarkSuccess, recordWatermarkAttempt } from "./pre-audit-sync-service.js";

// 1. Genuine Cash Account identification
export function getGenuineCashAccounts(): { account_id: string; account_name: string; account_type: string }[] {
  const db = getAuditDatabase();
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_zoho_coa'"
    ).get();
    if (!tableExists) {
      throw new Error("Local Chart of Accounts evidence table (audit_zoho_coa) does not exist. Pre-audit COA sync required.");
    }
    
    const rows = db.prepare(`
      SELECT DISTINCT account_id, account_name, account_type
      FROM audit_zoho_coa
      WHERE account_type = 'cash'
      ORDER BY account_name ASC
    `).all() as { account_id: string; account_name: string; account_type: string }[];

    if (!rows || rows.length === 0) {
      throw new Error("No cash accounts found in local audit_zoho_coa evidence. Pre-audit COA sync required.");
    }

    return rows;
  } catch (e: any) {
    console.error("Error reading audit_zoho_coa for cash accounts:", e);
    throw e;
  }
}

export async function syncCashAccounts(fy: string = "2025-26") {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) {
    throw new Error("Zoho not connected");
  }
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "774390949";
  
  const fromDate = fy === "2025-26" ? "2025-04-01" : "2024-04-01";
  const toDate = fy === "2025-26" ? "2026-03-31" : "2025-03-31";
  
  const cashAccounts = getGenuineCashAccounts();
  const db = getAuditDatabase();
  
  const source_run_id = `CASH_SYNC_${Date.now()}`;
  
  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status, api_domain, records_seen, records_written)
    VALUES (?, ?, 'cash_sync', ?, ?, 'SUCCESS', ?, 0, 0)
    ON CONFLICT(source_run_id) DO UPDATE SET completed_at=excluded.completed_at
  `).run(source_run_id, orgId, new Date().toISOString(), new Date().toISOString(), tokens.api_domain || "");
  
  const results = [];
  
  for (const account of cashAccounts) {
    try {
      const res = await listCashAccountTransactions(orgId, account.account_id, {
        from_date: fromDate,
        to_date: toDate
      });
      
      let created = 0;
      let updated = 0;
      
      db.exec('BEGIN TRANSACTION');
      try {
        const reversedTransactions = [...res.transactions].reverse();
        for (const [index, tx] of reversedTransactions.entries()) {
          const stmt = db.prepare(`
            INSERT INTO audit_zoho_bank_transactions (
              organization_id, transaction_id, source_run_id, account_id, account_name,
              date, amount, transaction_type, status, source, debit_or_credit,
              reference_number, payee, description, currency_code, imported_transaction_id, fetched_at, running_balance, api_sequence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, account_id, transaction_id) DO UPDATE SET
              source_run_id=excluded.source_run_id,
              date=excluded.date,
              amount=excluded.amount,
              status=excluded.status,
              fetched_at=excluded.fetched_at,
              running_balance=excluded.running_balance,
              api_sequence=excluded.api_sequence
          `);
          
          const result = stmt.run(
            orgId, tx.transaction_id, source_run_id, tx.account_id, tx.account_name || null,
            tx.date, tx.amount, tx.transaction_type, tx.status, tx.source || null, tx.debit_or_credit || null,
            tx.reference_number || null, tx.payee || null, tx.description || null, tx.currency_code || null, tx.imported_transaction_id || null, new Date().toISOString(), tx.running_balance !== undefined ? tx.running_balance : null, index
          );
          if (result.changes > 0) created++;
        }
        db.exec('COMMIT');
        
        advanceWatermarkSuccess("BANK_TRANSACTIONS", fy, account.account_id, toDate, res.transactions.length, 1, undefined, orgId);
        
        results.push({
          account_id: account.account_id,
          account_name: account.account_name,
          records: res.transactions.length,
          status: "SUCCESS"
        });
      } catch (dbErr) {
        console.error("DB Error on account", account.account_name, dbErr);
        db.exec('ROLLBACK');
        recordWatermarkAttempt("BANK_TRANSACTIONS", fy, account.account_id, "FAILED", 1, orgId);
        results.push({
          account_id: account.account_id,
          account_name: account.account_name,
          records: 0,
          status: "FAILED"
        });
      }
    } catch (apiErr) {
      console.error("API Error on account", account.account_name, apiErr);
      recordWatermarkAttempt("BANK_TRANSACTIONS", fy, account.account_id, "FAILED", 1, orgId);
      results.push({
        account_id: account.account_id,
        account_name: account.account_name,
        records: 0,
        status: "FAILED"
      });
    }
  }
  
  return results;
}
