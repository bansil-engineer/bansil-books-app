import { getAuditDatabase } from "../db/audit-database.js";

export interface CashEquationResult {
  account_id: string;
  account_name: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  closing_balance: number;
  negative_cash_days: {
    date: string;
    balance: number;
    transaction_id: string;
  }[];
  negative_periods: number;
}

export function calculateCashEquation(accountId: string, fromDate: string, toDate: string): CashEquationResult {
  const db = getAuditDatabase();
  
  // 1. Get latest source_run_id for this account
  const runRow = db.prepare(`
    SELECT source_run_id 
    FROM audit_zoho_bank_transactions 
    WHERE account_id = ? 
    ORDER BY fetched_at DESC 
    LIMIT 1
  `).get(accountId) as { source_run_id: string } | undefined;
  
  if (!runRow) {
    return {
      account_id: accountId,
      account_name: "",
      opening_balance: 0,
      total_receipts: 0,
      total_payments: 0,
      closing_balance: 0,
      negative_cash_days: [],
      negative_periods: 0
    };
  }

  // 2. Fetch all transactions for this account in the latest run, ordered by date
  // Since date is YYYY-MM-DD, sorting by date works. We also sort by transaction_id as secondary.
  const txs = db.prepare(`
    SELECT transaction_id, account_name, date, amount, transaction_type, debit_or_credit, running_balance
    FROM audit_zoho_bank_transactions
    WHERE account_id = ? AND source_run_id = ?
    ORDER BY api_sequence ASC
  `).all(accountId, runRow.source_run_id) as any[];

  let accountName = txs.length > 0 ? txs[0].account_name || "" : "";
  let openingBalance = 0;
  let closingBalance = 0;
  let totalReceipts = 0;
  let totalPayments = 0;
  const negativeCashDays: CashEquationResult["negative_cash_days"] = [];

  let isFirstInPeriod = true;
  let lastBalanceBeforePeriod = 0;
  let negativePeriods = 0;
  let currentlyNegative = false;

  for (const tx of txs) {
    const txDate = tx.date;
    const amount = tx.amount;
    const type = tx.debit_or_credit; // "debit" = receipt (in cash/bank), "credit" = payment
    const runningBalance = tx.running_balance || 0;

    if (txDate < fromDate) {
      lastBalanceBeforePeriod = runningBalance;
      continue;
    }

    if (txDate > toDate) {
      continue;
    }

    // Inside the period
    if (isFirstInPeriod) {
      openingBalance = lastBalanceBeforePeriod;
      if (openingBalance < 0) {
        currentlyNegative = true;
        negativePeriods = 1;
      }
      isFirstInPeriod = false;
    }

    if (type === 'debit') {
      totalReceipts += amount;
    } else if (type === 'credit') {
      totalPayments += amount;
    }

    // Track closing balance (will end up as the last transaction's running balance in period)
    closingBalance = runningBalance;

    if (runningBalance < 0) {
      if (!currentlyNegative) {
        negativePeriods++;
        currentlyNegative = true;
      }
      negativeCashDays.push({
        date: txDate,
        balance: runningBalance,
        transaction_id: tx.transaction_id
      });
    } else {
      currentlyNegative = false;
    }
  }

  // If no transactions in period, closing = opening
  if (isFirstInPeriod) {
    openingBalance = lastBalanceBeforePeriod;
    closingBalance = lastBalanceBeforePeriod;
  }

  return {
    account_id: accountId,
    account_name: accountName,
    opening_balance: Number(openingBalance.toFixed(2)),
    total_receipts: Number(totalReceipts.toFixed(2)),
    total_payments: Number(totalPayments.toFixed(2)),
    closing_balance: Number(closingBalance.toFixed(2)),
    negative_cash_days: negativeCashDays,
    negative_periods: negativePeriods
  };
}
