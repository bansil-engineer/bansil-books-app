import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import fs from "fs";

function applyPhase2cSchema() {
  const db = getAuditDatabase();
  
  console.log("Applying Phase 2C schema...");
  
  db.exec(`
    -- Phase 2C: Local Audit Source Persistence Foundation
    
    CREATE TABLE IF NOT EXISTS audit_zoho_source_runs (
      source_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      api_domain TEXT,
      records_seen INTEGER NOT NULL DEFAULT 0,
      records_written INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_zoho_coa (
      organization_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_run ON audit_zoho_coa(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_coa_id ON audit_zoho_coa(organization_id, account_id);

    CREATE TABLE IF NOT EXISTS audit_zoho_bank_accounts (
      organization_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_run ON audit_zoho_bank_accounts(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_id ON audit_zoho_bank_accounts(organization_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_acc_type ON audit_zoho_bank_accounts(account_type);

    CREATE TABLE IF NOT EXISTS audit_zoho_bank_transactions (
      organization_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE CASCADE,
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
      PRIMARY KEY (organization_id, account_id, transaction_id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_run ON audit_zoho_bank_transactions(source_run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_id ON audit_zoho_bank_transactions(organization_id, transaction_id);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_acc_date ON audit_zoho_bank_transactions(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_status ON audit_zoho_bank_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_audit_zoho_bank_tx_type ON audit_zoho_bank_transactions(transaction_type);

    CREATE TABLE IF NOT EXISTS audit_bank_coa_mappings (
      mapping_id TEXT PRIMARY KEY,
      bank_account_id TEXT NOT NULL,
      coa_account_id TEXT,
      mapping_method TEXT NOT NULL,
      mapping_status TEXT NOT NULL,
      source_run_id TEXT NOT NULL REFERENCES audit_zoho_source_runs(source_run_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
  `);
  
  console.log("Phase 2C schema applied successfully.");
}

applyPhase2cSchema();
