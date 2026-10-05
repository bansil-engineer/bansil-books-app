import { getAuditDatabase, openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import fs from "fs";

function generateMigrationSQL() {
  return `
BEGIN TRANSACTION;

-- Backup row counts for validation
CREATE TEMPORARY TABLE IF NOT EXISTS row_counts AS
SELECT 'coa' as tbl, count(*) as cnt FROM audit_zoho_coa
UNION ALL
SELECT 'bank', count(*) FROM audit_zoho_bank_accounts
UNION ALL
SELECT 'tx', count(*) FROM audit_zoho_bank_transactions
UNION ALL
SELECT 'mapping', count(*) FROM audit_bank_coa_mappings;

-- 1. audit_zoho_coa
ALTER TABLE audit_zoho_coa RENAME TO audit_zoho_coa_old;
CREATE TABLE audit_zoho_coa (
  organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
  account_name TEXT NOT NULL,
  account_code TEXT,
  account_type TEXT NOT NULL,
  account_sub_type TEXT,
  parent_account_id TEXT,
  parent_account_name TEXT,
  is_active INTEGER,
  source_endpoint TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, account_id, source_run_id)
);
INSERT INTO audit_zoho_coa SELECT * FROM audit_zoho_coa_old;
DROP TABLE audit_zoho_coa_old;

CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_run ON audit_zoho_coa(source_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_id ON audit_zoho_coa(organization_id, account_id);

-- 2. audit_zoho_bank_accounts
ALTER TABLE audit_zoho_bank_accounts RENAME TO audit_zoho_bank_accounts_old;
CREATE TABLE audit_zoho_bank_accounts (
  organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency_id TEXT,
  currency_code TEXT,
  is_active INTEGER,
  masked_account_number TEXT,
  balance REAL,
  uncategorized_transaction_count INTEGER,
  source_endpoint TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, account_id, source_run_id)
);
INSERT INTO audit_zoho_bank_accounts SELECT * FROM audit_zoho_bank_accounts_old;
DROP TABLE audit_zoho_bank_accounts_old;

CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_run ON audit_zoho_bank_accounts(source_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_id ON audit_zoho_bank_accounts(organization_id, account_id);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_type ON audit_zoho_bank_accounts(account_type);

-- 3. audit_zoho_bank_transactions
ALTER TABLE audit_zoho_bank_transactions RENAME TO audit_zoho_bank_transactions_old;
CREATE TABLE audit_zoho_bank_transactions (
  organization_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL,
  account_name TEXT,
  date TEXT,
  amount REAL NOT NULL,
  transaction_type TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT,
  debit_or_credit TEXT,
  reference_number TEXT,
  payee TEXT,
  description TEXT,
  currency_id TEXT,
  currency_code TEXT,
  imported_transaction_id TEXT,
  source_endpoint TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, transaction_id, source_run_id)
);
INSERT INTO audit_zoho_bank_transactions SELECT * FROM audit_zoho_bank_transactions_old;
DROP TABLE audit_zoho_bank_transactions_old;

CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_run ON audit_zoho_bank_transactions(source_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_id ON audit_zoho_bank_transactions(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_acc_date ON audit_zoho_bank_transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_status ON audit_zoho_bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_type ON audit_zoho_bank_transactions(transaction_type);

-- 4. audit_bank_coa_mappings
ALTER TABLE audit_bank_coa_mappings RENAME TO audit_bank_coa_mappings_old;
CREATE TABLE audit_bank_coa_mappings (
  mapping_id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL,
  coa_account_id TEXT,
  mapping_method TEXT NOT NULL,
  mapping_status TEXT NOT NULL,
  source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
INSERT INTO audit_bank_coa_mappings SELECT * FROM audit_bank_coa_mappings_old;
DROP TABLE audit_bank_coa_mappings_old;

-- Validate counts match
SELECT 
  (SELECT cnt FROM row_counts WHERE tbl = 'coa') = (SELECT count(*) FROM audit_zoho_coa) as coa_ok,
  (SELECT cnt FROM row_counts WHERE tbl = 'bank') = (SELECT count(*) FROM audit_zoho_bank_accounts) as bank_ok,
  (SELECT cnt FROM row_counts WHERE tbl = 'tx') = (SELECT count(*) FROM audit_zoho_bank_transactions) as tx_ok,
  (SELECT cnt FROM row_counts WHERE tbl = 'mapping') = (SELECT count(*) FROM audit_bank_coa_mappings) as map_ok;

COMMIT;
`;
}

function runMigrationTest() {
  const testDbPath = "./data/test_audit_workspace.db";
  
  if (!fs.existsSync(testDbPath)) {
    console.error("Test DB missing, skipping migration test");
    return;
  }
  
  const db = openAuditDatabaseAt(testDbPath);
  console.log("== RUNNING MIGRATION ON TEST DB ==");
  const sql = generateMigrationSQL();
  
  // Need to execute the statements one by one or in a block, sqlite node might not support BEGIN with multiple statements via run() if not using exec().
  db.exec(sql);
  
  const schemaRows = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('audit_zoho_coa', 'audit_zoho_bank_accounts', 'audit_zoho_bank_transactions', 'audit_bank_coa_mappings')").all() as any[];
  const hasCascade = schemaRows.some(r => r.sql.includes('ON DELETE CASCADE'));
  const hasRestrict = schemaRows.some(r => r.sql.includes('ON DELETE RESTRICT'));
  
  console.log(`Cascade removed: ${!hasCascade}`);
  console.log(`Restrict added: ${hasRestrict}`);
}

runMigrationTest();
