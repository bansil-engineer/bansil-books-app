import { DatabaseSync } from "node:sqlite";
import { resolve } from "path";
import { getGenuineCashAccounts } from "../app/lib/audit/cash-sync-service.ts";
import { calculateCashEquation } from "../app/lib/audit/cash-equation.ts";

const ROOT_DIR = process.cwd();
const AUDIT_DB = resolve(ROOT_DIR, "data", "audit_workspace.db");

console.log("==================================================");
console.log("STAGE 5A: CASH EQUATION & CASH BOOKS TEST");
console.log("==================================================");

let passed = true;
let totalAccounts = 0;
let totalAnomalies = 0;

try {
  const db = new DatabaseSync(AUDIT_DB);
  db.close();

  console.log("1. Fetching Genuine Cash Accounts...");
  const accounts = getGenuineCashAccounts();
  
  if (accounts.length === 0) {
    console.error("FAIL: No cash accounts found.");
    passed = false;
  } else {
    console.log(`Found ${accounts.length} Cash Accounts (account_type = 'cash').`);
    totalAccounts = accounts.length;
  }

  console.log("\\n2. Running Cash Equation for FY 2025-26...");
  for (const acc of accounts) {
    const result = calculateCashEquation(acc.account_id, "2025-04-01", "2026-03-31");
    
    const computedClosing = result.opening_balance + result.total_receipts - result.total_payments;
    const match = Math.abs(computedClosing - result.closing_balance) <= 0.01;
    
    if (!match) {
      console.log(`[ANOMALY] ${acc.account_name}: API running balance mismatch.`);
      console.log(`          Equation : ${result.opening_balance.toFixed(2)} + ${result.total_receipts.toFixed(2)} - ${result.total_payments.toFixed(2)} = ${computedClosing.toFixed(2)}`);
      console.log(`          API Close: ${result.closing_balance.toFixed(2)}`);
      console.log(`          Diff     : ${(computedClosing - result.closing_balance).toFixed(2)}`);
      totalAnomalies++;
      passed = false;
    }

    if (result.negative_cash_days.length > 0) {
      console.log(`[FINDING] ${acc.account_name}: ${result.negative_cash_days.length} Negative Cash Days, ${result.negative_periods} Negative Periods found.`);
    }
  }

  console.log("\\n==================================================");
  console.log("TEST SUMMARY");
  console.log("==================================================");
  console.log(`Total Cash Accounts Assessed: ${totalAccounts}`);
  console.log(`Accounts with Missing Receipts/API Anomalies: ${totalAnomalies}`);
  
  if (passed) {
    console.log("STAGE 5A CASH EQUATION VERIFICATION: PASS");
    process.exit(0);
  } else {
    console.log("STAGE 5A CASH EQUATION VERIFICATION: FAIL");
    process.exit(1);
  }

} catch (e: any) {
  console.error("FATAL ERROR:");
  console.error(e);
  process.exit(1);
}
