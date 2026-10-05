import { DatabaseSync } from 'node:sqlite';
import type { BankMatchResult } from './types.ts';

export interface BankCandidateQuery {
  db: DatabaseSync;
  organizationId: string;
  bankSourceRunId: string;
  accountId: string;
  amount: number;
  dateStr: string;
  direction: 'debit' | 'credit';
  toleranceDays?: number;
}

/**
 * Enforces strict snapshot isolation for bank candidate discovery.
 */
export function findBankCandidates(query: BankCandidateQuery): any[] {
  if (!query.bankSourceRunId || query.bankSourceRunId === 'latest') {
    throw new Error("Bank candidate query requires explicit frozen bankSourceRunId to avoid historical snapshot contamination.");
  }

  const sql = `
    SELECT * FROM audit_zoho_bank_transactions 
    WHERE source_run_id = ?
      AND organization_id = ?
      AND account_id = ? 
      AND amount = ? 
      AND debit_or_credit = ?
  `;
  
  const rows = query.db.prepare(sql).all(query.bankSourceRunId, query.organizationId, query.accountId, query.amount, query.direction) as any[];

  const tol = query.toleranceDays ?? 2;
  const targetTime = new Date(query.dateStr).getTime();
  
  const withinTolerance = rows.filter(r => {
      const cTime = new Date(r.date).getTime();
      const diffDays = Math.abs(targetTime - cTime) / (1000 * 3600 * 24);
      return diffDays <= tol;
  });

  // Ensure same-snapshot duplicates (if any) are reduced by transaction_id
  const unique = [];
  const seenTx = new Set();
  for (const c of withinTolerance) {
      if (!seenTx.has(c.transaction_id)) {
          seenTx.add(c.transaction_id);
          unique.push(c);
      }
  }

  return unique;
}

export function evaluateBankMatchResult(
    candidates: any[],
    coverageStatus: 'BANK_COVERAGE_SUFFICIENT' | 'BANK_COVERAGE_INSUFFICIENT' = 'BANK_COVERAGE_SUFFICIENT'
): BankMatchResult {
   if (coverageStatus === 'BANK_COVERAGE_INSUFFICIENT') {
       return 'SOURCE_COVERAGE_INSUFFICIENT';
   }
   if (candidates.length === 1) return 'CONFIRMED_AMOUNT_DATE_ACCOUNT';
   if (candidates.length > 1) return 'AMBIGUOUS';
   return 'NO_MATCH';
}
