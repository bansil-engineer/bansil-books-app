"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCashEquation = calculateCashEquation;
var audit_database_1 = require("../db/audit-database");
function calculateCashEquation(accountId, fromDate, toDate) {
    var db = (0, audit_database_1.getAuditDatabase)();
    // 1. Get latest source_run_id for this account
    var runRow = db.prepare("\n    SELECT source_run_id \n    FROM audit_zoho_bank_transactions \n    WHERE account_id = ? \n    ORDER BY fetched_at DESC \n    LIMIT 1\n  ").get(accountId);
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
    var txs = db.prepare("\n    SELECT transaction_id, account_name, date, amount, transaction_type, debit_or_credit, running_balance\n    FROM audit_zoho_bank_transactions\n    WHERE account_id = ? AND source_run_id = ?\n    ORDER BY api_sequence ASC\n  ").all(accountId, runRow.source_run_id);
    var accountName = txs.length > 0 ? txs[0].account_name || "" : "";
    var openingBalance = 0;
    var closingBalance = 0;
    var totalReceipts = 0;
    var totalPayments = 0;
    var negativeCashDays = [];
    var isFirstInPeriod = true;
    var lastBalanceBeforePeriod = 0;
    var negativePeriods = 0;
    var currentlyNegative = false;
    for (var _i = 0, txs_1 = txs; _i < txs_1.length; _i++) {
        var tx = txs_1[_i];
        var txDate = tx.date;
        var amount = tx.amount;
        var type = tx.debit_or_credit; // "debit" = receipt (in cash/bank), "credit" = payment
        var runningBalance = tx.running_balance || 0;
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
        }
        else if (type === 'credit') {
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
        }
        else {
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
