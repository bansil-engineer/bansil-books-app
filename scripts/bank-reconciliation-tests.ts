import { DatabaseSync } from "node:sqlite";
import * as path from "path";
import * as fs from "fs";
import { 
  getBankStatementSources,
  getBankStatements,
  getBankReconciliation
} from "../app/lib/audit/bank-reconciliation-service.ts";

const DB_DIR = path.join(process.cwd(), "data");
const AUDIT_DB_FILE = ":memory:";

function setupTestDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new DatabaseSync(AUDIT_DB_FILE);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_zoho_source_runs (
      source_run_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'RUNNING'
    );
    CREATE TABLE IF NOT EXISTS audit_zoho_bank_transactions (
      organization_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      account_id TEXT,
      date TEXT,
      status TEXT,
      transaction_type TEXT,
      amount REAL,
      reference_number TEXT,
      description TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, transaction_id, source_run_id)
    );
    CREATE TABLE IF NOT EXISTS audit_bank_statement_sources (
      source_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      folder_path TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_bank_statements (
      statement_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT,
      period_from TEXT,
      period_to TEXT,
      imported_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_bank_statement_transactions (
      statement_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      date TEXT NOT NULL,
      value_date TEXT,
      description TEXT,
      reference TEXT,
      debit REAL,
      credit REAL,
      amount REAL NOT NULL,
      running_balance REAL,
      match_status TEXT,
      matched_books_txn_id TEXT,
      PRIMARY KEY (statement_id, row_index)
    );
  `);

  const runId = "test_run_" + Date.now();
  db.prepare(`INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES (?, 'ORG', 'TEST', ?, ?)`).run(runId, new Date().toISOString(), 'SUCCESS');

  return { db, runId };
}

async function runTests() {
  const { db, runId } = setupTestDb();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) { passed++; console.log(`[PASS] ${msg}`); }
    else { failed++; console.error(`[FAIL] ${msg}`); }
  }

  // Setup bank statement
  db.exec(`
    INSERT INTO audit_bank_statement_sources (source_id, organization_id, bank_account_id, source_type, folder_path, created_at)
    VALUES ('src_1', 'ORG', 'acc_1', 'LOCAL_FOLDER', '/tmp', 'now');
    
    INSERT INTO audit_bank_statements (statement_id, source_id, bank_account_id, file_name, file_hash, period_from, period_to, imported_at, status)
    VALUES ('stmt_1', 'src_1', 'acc_1', 'test.csv', 'hash', '2023-01-01', '2023-01-31', 'now', 'IMPORTED');
    
    INSERT INTO audit_bank_statement_transactions (statement_id, row_index, date, description, amount, debit, credit)
    VALUES ('stmt_1', 0, '2023-01-10', 'Deposit A', 1000.50, 0, 1000.50);
    
    INSERT INTO audit_bank_statement_transactions (statement_id, row_index, date, description, amount, debit, credit)
    VALUES ('stmt_1', 1, '2023-01-12', 'Withdrawal B', -500.00, 500.00, 0);
    
    INSERT INTO audit_bank_statement_transactions (statement_id, row_index, date, description, amount, debit, credit)
    VALUES ('stmt_1', 2, '2023-01-15', 'Unmatched C', 250.00, 0, 250.00);
  `);

  // Setup books transactions
  db.exec(`
    INSERT INTO audit_zoho_bank_transactions (organization_id, transaction_id, source_run_id, account_id, date, amount, reference_number, fetched_at)
    VALUES ('ORG', 'txn_1', '${runId}', 'acc_1', '2023-01-10', 1000.50, 'Ref-1', 'now');
    
    INSERT INTO audit_zoho_bank_transactions (organization_id, transaction_id, source_run_id, account_id, date, amount, reference_number, fetched_at)
    VALUES ('ORG', 'txn_2', '${runId}', 'acc_1', '2023-01-14', -500.00, 'Ref-2', 'now');
  `);

  const matches = getBankReconciliation('src_1', 'stmt_1', db);
  
  assert(matches.length === 3, 'Returns 3 matches');
  
  const m1 = matches.find(m => m.bankTx.row_index === 0);
  assert(m1?.matchStatus === 'EXACT_MATCH', 'Exact match found for 1000.50 on same date');
  
  const m2 = matches.find(m => m.bankTx.row_index === 1);
  assert(m2?.matchStatus === 'DATE_MISMATCH', 'Date mismatch found for -500.00 within +/- 2 days');
  
  const m3 = matches.find(m => m.bankTx.row_index === 2);
  assert(m3?.matchStatus === 'UNMATCHED', 'Unmatched when no similar amount found');

  console.log(`\nTests completed. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
