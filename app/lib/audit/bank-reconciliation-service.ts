import { getAuditDatabase } from "../db/audit-database.ts";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as xlsx from "xlsx";

export interface BankStatementSource {
  source_id: string;
  organization_id: string;
  bank_account_id: string;
  source_type: string;
  folder_path: string;
  created_at: string;
}

export interface BankStatement {
  statement_id: string;
  source_id: string;
  bank_account_id: string;
  file_name: string;
  file_hash: string;
  period_from: string;
  period_to: string;
  imported_at: string;
  status: string;
}

export interface BankStatementTransaction {
  statement_id: string;
  row_index: number;
  date: string;
  value_date: string | null;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  amount: number;
  running_balance: number;
  match_status: string;
  matched_books_txn_id: string | null;
}

// Define supported extensions and mappings
const SUPPORTED_EXTENSIONS = ['.csv']; // Discard unsupported formats

export function getBankAccounts(dbParam?: any) {
  const db = dbParam || getAuditDatabase();
  const accounts = db.prepare(`SELECT * FROM audit_zoho_bank_accounts`).all();
  
  // Also enrich with some basic stats or latest source run if needed, but simple return is fine
  return accounts;
}

export function getBankStatementSources(dbParam?: any): BankStatementSource[] {
  const db = getAuditDatabase();
  return db.prepare(`SELECT * FROM audit_bank_statement_sources ORDER BY created_at DESC`).all() as unknown as BankStatementSource[];
}

export function addBankStatementSource(organizationId: string, bankAccountId: string, folderPath: string): BankStatementSource {
  const db = getAuditDatabase();
  const sourceId = `BSS-${Date.now()}`;
  
  // Verify folder exists
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder path does not exist: ${folderPath}`);
  }

  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`);
  }

  db.prepare(`
    INSERT INTO audit_bank_statement_sources (source_id, organization_id, bank_account_id, source_type, folder_path, created_at)
    VALUES (?, ?, ?, 'LOCAL_FOLDER', ?, datetime('now'))
  `).run(sourceId, organizationId, bankAccountId, folderPath);

  return db.prepare(`SELECT * FROM audit_bank_statement_sources WHERE source_id = ?`).get(sourceId) as unknown as BankStatementSource;
}

export function getBankStatements(sourceId: string): BankStatement[] {
  const db = getAuditDatabase();
  return db.prepare(`SELECT * FROM audit_bank_statements WHERE source_id = ? ORDER BY imported_at DESC`).all(sourceId) as unknown as BankStatement[];
}

function computeFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// Convert Excel dates (number of days since Jan 1, 1900) to ISO string
function parseExcelDate(excelDate: number | string): string {
  if (typeof excelDate === 'number') {
    // Excel's epoch is 1900-01-01, but it incorrectly assumes 1900 was a leap year
    const date = new Date((excelDate - (25567 + 2)) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  
  if (typeof excelDate === 'string') {
    // Try to parse standard string formats
    const parsed = new Date(excelDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  return String(excelDate);
}

function parseFileToTransactions(filePath: string): any[] {
  const ext = path.extname(filePath).toLowerCase();
  
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Extract json data
  // For standard banks, first row is header
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  if (data.length < 2) return [];

  // Find header row (some bank statements have meta data at top)
  let headerRowIdx = -1;
  let dateColIdx = -1;
  let descColIdx = -1;
  let debitColIdx = -1;
  let creditColIdx = -1;
  let amountColIdx = -1;
  let balColIdx = -1;
  let refColIdx = -1;
  
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i] as any[];
    if (!row) continue;
    
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    
    // Check if this looks like a header row
    if (rowStr.includes('date') && (rowStr.includes('description') || rowStr.includes('particulars'))) {
      headerRowIdx = i;
      
      row.forEach((cell, idx) => {
        if (!cell) return;
        const val = String(cell).toLowerCase().trim();
        if (val.includes('date')) dateColIdx = idx;
        if (val.includes('description') || val.includes('particulars')) descColIdx = idx;
        if (val === 'debit' || val === 'withdrawal' || val === 'dr') debitColIdx = idx;
        if (val === 'credit' || val === 'deposit' || val === 'cr') creditColIdx = idx;
        if (val.includes('amount')) amountColIdx = idx;
        if (val.includes('balance')) balColIdx = idx;
        if (val.includes('reference') || val.includes('ref no')) refColIdx = idx;
      });
      break;
    }
  }
  
  if (headerRowIdx === -1) {
    throw new Error(`Could not identify header row in ${filePath}`);
  }

  const transactions = [];
  
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i] as any[];
    if (!row || row.length === 0 || !row[dateColIdx]) continue; // Skip empty rows
    
    const rawDate = row[dateColIdx];
    const dateStr = parseExcelDate(rawDate);
    
    const description = String(row[descColIdx] || '').trim();
    if (!description && !row[dateColIdx]) continue; // Probably end of statement

    const reference = refColIdx !== -1 ? String(row[refColIdx] || '').trim() : '';
    
    let debit = 0;
    let credit = 0;
    let amount = 0;
    
    if (debitColIdx !== -1 && row[debitColIdx]) debit = parseFloat(String(row[debitColIdx]).replace(/,/g, ''));
    if (creditColIdx !== -1 && row[creditColIdx]) credit = parseFloat(String(row[creditColIdx]).replace(/,/g, ''));
    if (amountColIdx !== -1 && row[amountColIdx]) amount = parseFloat(String(row[amountColIdx]).replace(/,/g, ''));
    
    // Normalize amounts (some banks use positive for debit, some negative)
    if (debitColIdx !== -1 || creditColIdx !== -1) {
       debit = Math.abs(debit || 0);
       credit = Math.abs(credit || 0);
       amount = credit - debit;
    }
    
    const balance = balColIdx !== -1 && row[balColIdx] ? parseFloat(String(row[balColIdx]).replace(/,/g, '')) : 0;
    
    if (isNaN(amount) && isNaN(debit) && isNaN(credit)) continue; // Not a valid transaction row

    transactions.push({
      date: dateStr,
      description,
      reference,
      debit,
      credit,
      amount,
      running_balance: balance
    });
  }
  
  return transactions;
}

export function syncBankStatements(sourceId: string): { imported: number, skipped: number, errors: string[] } {
  const db = getAuditDatabase();
  const source = db.prepare(`SELECT * FROM audit_bank_statement_sources WHERE source_id = ?`).get(sourceId) as unknown as BankStatementSource;
  
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  const result = { imported: 0, skipped: 0, errors: [] as string[] };
  
  let files: string[] = [];
  try {
    files = fs.readdirSync(source.folder_path);
  } catch (err: any) {
    throw new Error(`Failed to read directory ${source.folder_path}: ${err.message}`);
  }

  for (const file of files) {
    // Only support excel and csv for now
    if (!file.toLowerCase().endsWith('.xlsx') && !file.toLowerCase().endsWith('.csv') && !file.toLowerCase().endsWith('.xls')) {
      continue;
    }
    
    const filePath = path.join(source.folder_path, file);
    
    // Hash file to check for duplicates
    let fileHash: string;
    try {
       fileHash = computeFileHash(filePath);
    } catch(e) {
       result.errors.push(`Failed to read file ${file}: ${e}`);
       continue;
    }
    
    // Check if already imported
    const existing = db.prepare(`SELECT statement_id FROM audit_bank_statements WHERE file_hash = ? AND source_id = ?`).get(fileHash, sourceId);
    if (existing) {
       result.skipped++;
       continue;
    }

    try {
      const transactions = parseFileToTransactions(filePath);
      
      if (transactions.length === 0) {
         result.errors.push(`No transactions found in ${file}`);
         continue;
      }
      
      // Calculate period
      let minDate = '9999-12-31';
      let maxDate = '0000-00-00';
      
      for (const t of transactions) {
         if (t.date < minDate) minDate = t.date;
         if (t.date > maxDate) maxDate = t.date;
      }

      // Begin transaction
      db.exec("BEGIN");
      try {
         const statementId = `STMT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
         
         db.prepare(`
           INSERT INTO audit_bank_statements (statement_id, source_id, bank_account_id, file_name, file_hash, period_from, period_to, imported_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'IMPORTED')
         `).run(statementId, sourceId, source.bank_account_id, file, fileHash, minDate, maxDate);
         
         const insertTx = db.prepare(`
           INSERT INTO audit_bank_statement_transactions (statement_id, row_index, date, description, reference, debit, credit, amount, running_balance, match_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNMATCHED')
         `);
         
         transactions.forEach((tx, idx) => {
            insertTx.run(statementId, idx, tx.date, tx.description, tx.reference, tx.debit, tx.credit, tx.amount, tx.running_balance);
         });
         db.exec("COMMIT");
      } catch (err) {
         db.exec("ROLLBACK");
         throw err;
      }
      
      result.imported++;
    } catch(err: any) {
      result.errors.push(`Failed to process ${file}: ${err.message}`);
    }
  }

  return result;
}

export interface BankReconciliationMatch {
  bankTx: BankStatementTransaction;
  booksTx: any | null; // From audit_zoho_bank_transactions
  matchStatus: "EXACT_MATCH" | "DATE_MISMATCH" | "UNMATCHED";
  confidence: number;
}

export function getBankReconciliation(sourceId: string, statementId: string, dbParam?: any): BankReconciliationMatch[] {
  const db = dbParam || getAuditDatabase();
  
  const statement = db.prepare(`SELECT * FROM audit_bank_statements WHERE statement_id = ? AND source_id = ?`).get(statementId, sourceId) as BankStatement;
  if (!statement) throw new Error("Statement not found");
  
  const bankTxns = db.prepare(`SELECT * FROM audit_bank_statement_transactions WHERE statement_id = ? ORDER BY row_index ASC`).all(statementId) as BankStatementTransaction[];
  
  // Find the source run ID to use for fetching books transactions
  // Query only runs that actually contain bank transactions for this exact account
  const runRow = db.prepare(`
    SELECT DISTINCT zbt.source_run_id 
    FROM audit_zoho_bank_transactions zbt
    JOIN audit_zoho_source_runs zsr ON zbt.source_run_id = zsr.source_run_id
    WHERE zbt.account_id = ?
    ORDER BY zsr.started_at DESC LIMIT 1
  `).get(statement.bank_account_id) as any;
  const sourceRunId = runRow ? runRow.source_run_id : null;
  
  const matches: BankReconciliationMatch[] = [];
  
  if (!sourceRunId || bankTxns.length === 0) {
    // If no books data or no bank transactions, everything is unmatched (if any)
    return bankTxns.map(tx => ({ bankTx: tx, booksTx: null, matchStatus: "UNMATCHED", confidence: 0 }));
  }
  
  // Fetch books transactions for this bank account within the date range +/- 7 days
  const dateFrom = new Date(statement.period_from);
  dateFrom.setDate(dateFrom.getDate() - 7);
  const dateToStr = dateFrom.toISOString().split('T')[0];
  
  const dateTo = new Date(statement.period_to);
  dateTo.setDate(dateTo.getDate() + 7);
  const dateToPlus7 = dateTo.toISOString().split('T')[0];
  
  const booksTxns = db.prepare(`
    SELECT * FROM audit_zoho_bank_transactions 
    WHERE account_id = ? AND source_run_id = ? AND date >= ? AND date <= ?
  `).all(statement.bank_account_id, sourceRunId, dateToStr, dateToPlus7) as any[];
  
  // Simple matching algorithm
  const matchedBooksTxIds = new Set<string>();
  
  for (const bankTx of bankTxns) {
    // Try to find EXACT match (same date, same amount)
    let bestMatch: any = null;
    let matchStatus: BankReconciliationMatch["matchStatus"] = "UNMATCHED";
    let highestConfidence = 0;
    
    // We expect booksTxns amount to be positive/negative similar to bank amount?
    // In Zoho, transaction_type might indicate direction. Or we just look at amount (bcy_amount / fcy_amount).
    // A more robust way is to just match amount absolute values and check transaction type or matching direction.
    // Assuming amount in bankTx is credit-debit (positive = deposit, negative = withdrawal).
    
    for (const booksTx of booksTxns) {
      if (matchedBooksTxIds.has(booksTx.transaction_id)) continue; // Already matched
      
      const bookAmount = booksTx.amount || 0;
      
      // Match amount (allow small rounding differences)
      if (Math.abs(bookAmount - bankTx.amount) < 0.01) {
         // Same date = EXACT
         if (booksTx.date === bankTx.date) {
            bestMatch = booksTx;
            matchStatus = "EXACT_MATCH";
            highestConfidence = 1.0;
            break;
         }
         
         // Date within +/- 2 days
         const bDate = new Date(bankTx.date).getTime();
         const bkDate = new Date(booksTx.date).getTime();
         const diffDays = Math.abs(bDate - bkDate) / (1000 * 3600 * 24);
         
         if (diffDays <= 2) {
            if (highestConfidence < 0.8) {
               bestMatch = booksTx;
               matchStatus = "DATE_MISMATCH";
               highestConfidence = 0.8 - (diffDays * 0.1);
            }
         }
      }
    }
    
    if (bestMatch) {
       matchedBooksTxIds.add(bestMatch.transaction_id);
    }
    
    matches.push({
       bankTx,
       booksTx: bestMatch,
       matchStatus,
       confidence: highestConfidence
    });
  }
  
  return matches;
}
