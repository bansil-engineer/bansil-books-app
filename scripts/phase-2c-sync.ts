
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { 
  listChartOfAccounts, 
  listBankAccounts, 
  listBankAccountTransactions 
} from "../app/lib/audit/accounts/zoho-read-source.ts";

export async function importChartOfAccountsSnapshot(orgId: string, db = getAuditDatabase()) {
  const runId = `run_coa_${Date.now()}`;
  const startedAt = new Date().toISOString();
  
  db.exec('BEGIN TRANSACTION;');
  try {
    const { accounts } = await listChartOfAccounts(orgId);
    
    db.prepare(`
      INSERT INTO audit_zoho_source_runs 
      (source_run_id, organization_id, source_type, started_at, status, api_domain, records_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, orgId, 'chart_of_accounts', startedAt, 'RUNNING', 'books.zoho.com', accounts.length);
    
    let written = 0;
    const stmt = db.prepare(`
      INSERT INTO audit_zoho_coa
      (organization_id, account_id, source_run_id, account_name, account_code, account_type, account_sub_type, parent_account_id, parent_account_name, is_active, source_endpoint, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const acc of accounts) {
      stmt.run(
        orgId, 
        acc.account_id, 
        runId, 
        acc.account_name, 
        acc.account_code || null, 
        acc.account_type, 
        acc.account_sub_type || null, 
        acc.parent_account_id || null, 
        acc.parent_account_name || null, 
        acc.is_active ? 1 : 0, 
        '/books/v3/chartofaccounts', 
        startedAt
      );
      written++;
    }

    db.prepare(`
      UPDATE audit_zoho_source_runs 
      SET completed_at = ?, status = 'SUCCESS', records_written = ? 
      WHERE source_run_id = ?
    `).run(new Date().toISOString(), written, runId);
    
    db.exec('COMMIT;');
    return { runId, seen: accounts.length, written, errors: 0 };
  } catch (error: any) {
    db.exec('ROLLBACK;');
    // Need a separate transaction to record failure
    db.exec('BEGIN TRANSACTION;');
    db.prepare(`
      INSERT INTO audit_zoho_source_runs 
      (source_run_id, organization_id, source_type, started_at, completed_at, status, error_count, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, orgId, 'chart_of_accounts', startedAt, new Date().toISOString(), 'FAILED', 1, error.message);
    db.exec('COMMIT;');
    throw error;
  }
}

export async function importBankAccountsSnapshot(orgId: string, db = getAuditDatabase()) {
  const runId = `run_bank_acc_${Date.now()}`;
  const startedAt = new Date().toISOString();
  
  db.exec('BEGIN TRANSACTION;');
  try {
    const { bankAccounts } = await listBankAccounts(orgId);
    
    db.prepare(`
      INSERT INTO audit_zoho_source_runs 
      (source_run_id, organization_id, source_type, started_at, status, api_domain, records_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, orgId, 'bank_accounts', startedAt, 'RUNNING', 'books.zoho.com', bankAccounts.length);
    
    let written = 0;
    const stmt = db.prepare(`
      INSERT INTO audit_zoho_bank_accounts
      (organization_id, account_id, source_run_id, account_name, account_type, currency_id, currency_code, is_active, masked_account_number, balance, uncategorized_transaction_count, source_endpoint, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const acc of bankAccounts) {
      let masked = null;
      if (acc.account_number) {
        masked = acc.account_number.slice(-4).padStart(acc.account_number.length, '*');
      }

      stmt.run(
        orgId, 
        acc.account_id, 
        runId, 
        acc.account_name, 
        acc.account_type, 
        acc.currency_id || null, 
        acc.currency_code || null, 
        acc.is_active ? 1 : 0, 
        masked, 
        acc.balance || 0, 
        acc.uncategorized_transactions || 0,
        '/books/v3/bankaccounts', 
        startedAt
      );
      written++;
    }

    db.prepare(`
      UPDATE audit_zoho_source_runs 
      SET completed_at = ?, status = 'SUCCESS', records_written = ? 
      WHERE source_run_id = ?
    `).run(new Date().toISOString(), written, runId);
    
    db.exec('COMMIT;');
    return { runId, seen: bankAccounts.length, written, errors: 0 };
  } catch (error: any) {
    db.exec('ROLLBACK;');
    db.exec('BEGIN TRANSACTION;');
    db.prepare(`
      INSERT INTO audit_zoho_source_runs 
      (source_run_id, organization_id, source_type, started_at, completed_at, status, error_count, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, orgId, 'bank_accounts', startedAt, new Date().toISOString(), 'FAILED', 1, error.message);
    db.exec('COMMIT;');
    throw error;
  }
}

export async function importBankTransactionsSnapshot(orgId: string, accountId: string, params: { page?: number, per_page?: number, from_date?: string, to_date?: string }, db = getAuditDatabase()) {
  const runId = `run_bank_tx_${Date.now()}`;
  const startedAt = new Date().toISOString();
  
  db.exec('BEGIN TRANSACTION;');
  try {
    const res = await listBankAccountTransactions(orgId, accountId, params);
    let txs = res.transactions;
    
    // Zoho API sometimes ignores date filters for bank transactions; enforce strictly in-memory
    txs = txs.filter(t => {
      if (params.from_date && t.date < params.from_date) return false;
      if (params.to_date && t.date > params.to_date) return false;
      return true;
    });

    db.prepare(`
      INSERT INTO audit_zoho_source_runs 
      (source_run_id, organization_id, source_type, started_at, status, api_domain, records_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, orgId, 'bank_transactions', startedAt, 'RUNNING', 'books.zoho.com', txs.length);
    
    let written = 0;
    const stmtCheck = db.prepare(`SELECT source_run_id FROM audit_zoho_bank_transactions WHERE organization_id = ? AND transaction_id = ? AND account_id = ?`);
    const stmtUpdate = db.prepare(`
      UPDATE audit_zoho_bank_transactions
      SET account_name = ?, date = ?, amount = ?, transaction_type = ?, status = ?, source = ?, debit_or_credit = ?, reference_number = ?, payee = ?, description = ?, currency_id = ?, currency_code = ?, imported_transaction_id = ?, source_endpoint = ?, fetched_at = ?, source_run_id = ?
      WHERE organization_id = ? AND transaction_id = ? AND account_id = ?
    `);
    const stmtInsert = db.prepare(`
      INSERT OR IGNORE INTO audit_zoho_bank_transactions
      (organization_id, transaction_id, source_run_id, account_id, account_name, date, amount, transaction_type, status, source, debit_or_credit, reference_number, payee, description, currency_id, currency_code, imported_transaction_id, source_endpoint, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const tx of txs) {
      const resolvedAccountId = tx.account_id || accountId;
      const existing = stmtCheck.get(orgId, tx.transaction_id, resolvedAccountId);
      if (existing) {
        stmtUpdate.run(
          tx.account_name || null, 
          tx.date, 
          tx.amount, 
          tx.transaction_type, 
          tx.status, 
          tx.source || null, 
          tx.debit_or_credit || null, 
          tx.reference_number || null, 
          tx.payee || null, 
          tx.description || null, 
          tx.currency_id || null, 
          tx.currency_code || null, 
          tx.imported_transaction_id || null,
          '/books/v3/banktransactions', 
          startedAt,
          runId,
          orgId,
          tx.transaction_id,
          resolvedAccountId
        );
      } else {
        stmtInsert.run(
          orgId, 
          tx.transaction_id, 
          runId, 
          tx.account_id || accountId, 
          tx.account_name || null, 
          tx.date, 
          tx.amount, 
          tx.transaction_type, 
          tx.status, 
          tx.source || null, 
          tx.debit_or_credit || null, 
          tx.reference_number || null, 
          tx.payee || null, 
          tx.description || null, 
          tx.currency_id || null, 
          tx.currency_code || null, 
          tx.imported_transaction_id || null,
          '/books/v3/banktransactions', 
          startedAt
        );
      }
      written++;
    }

    db.prepare(`
      UPDATE audit_zoho_source_runs 
      SET completed_at = ?, status = 'SUCCESS', records_written = ? 
      WHERE source_run_id = ?
    `).run(new Date().toISOString(), written, runId);
    
    db.exec('COMMIT;');
    return { runId, seen: txs.length, written, errors: 0 };
  } catch (error: any) {
    db.exec('ROLLBACK;');
    db.exec('BEGIN TRANSACTION;');
    db.prepare(`
      INSERT INTO audit_zoho_source_runs 
      (source_run_id, organization_id, source_type, started_at, completed_at, status, error_count, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, orgId, 'bank_transactions', startedAt, new Date().toISOString(), 'FAILED', 1, error.message);
    db.exec('COMMIT;');
    throw error;
  }
}
