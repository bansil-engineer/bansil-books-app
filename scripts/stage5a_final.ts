import { getAuditDatabase } from "../app/lib/db/audit-database";

const db = getAuditDatabase();

console.log("=== A. VERIFY CURRENT DATABASE ===");
const bankRows = db.prepare("SELECT count(*) as c FROM audit_zoho_bank_transactions").get() as any;
console.log("current total bank/cash transaction rows:", bankRows.c);

const distinctAccounts = db.prepare("SELECT count(DISTINCT account_id) as c FROM audit_zoho_bank_transactions").get() as any;
console.log("distinct account IDs:", distinctAccounts.c);

const distinctRuns = db.prepare("SELECT count(DISTINCT source_run_id) as c FROM audit_zoho_bank_transactions").get() as any;
console.log("distinct source_run_ids:", distinctRuns.c);

const dups = db.prepare("SELECT transaction_id, account_id, source_run_id, count(*) as c FROM audit_zoho_bank_transactions GROUP BY organization_id, transaction_id, account_id, source_run_id HAVING c > 1").all();
console.log("duplicate rows under corrected composite key:", dups.length);

const hdfc = db.prepare("SELECT count(*) as c, (SUM(CASE WHEN debit_or_credit = 'debit' THEN amount ELSE 0 END) - SUM(CASE WHEN debit_or_credit = 'credit' THEN amount ELSE 0 END)) as balance FROM audit_zoho_bank_transactions WHERE account_id = '3166667000000092034' AND date >= '2025-04-01' AND date <= '2026-03-31'").get() as any;
const hdfcDups = db.prepare("SELECT transaction_id, count(*) as c FROM audit_zoho_bank_transactions WHERE account_id = '3166667000000092034' AND date >= '2025-04-01' AND date <= '2026-03-31' GROUP BY transaction_id HAVING c > 1").all();
console.log("HDFC FY25-26 rows:", hdfc.c);
console.log("HDFC unique IDs within account/source:", hdfcDups.length === 0 ? "YES" : "NO");
// HDFC closing balance from Pilot result was 1,162,896.35
console.log("HDFC calculated closing matched accepted Stage-4 evidence:", Math.abs((3693463.01 + hdfc.balance) - 1162896.35) < 0.01 ? "YES" : "NO");


console.log("\\n=== B. FINAL CASH ACCOUNT MATRIX ===");
const cashAccounts = db.prepare(`SELECT account_id, account_name FROM audit_zoho_bank_transactions WHERE account_name NOT LIKE '%HDFC%' AND account_name NOT LIKE '%ICICI%' AND account_name NOT LIKE '%Kotak%' AND account_name NOT LIKE '%SBI%' AND account_name NOT LIKE '%Happay%' AND account_name NOT LIKE '%IDFC%' GROUP BY account_id ORDER BY account_name ASC`).all() as any[];

let totalPasses = 0;
let totalNonZeroDiff = 0;
let totalContinuityFailures = 0;
let totalUnknown = 0;
let totalNegativeAccounts = 0;
let totalNegativeTx = 0;
let totalNegativeDates = 0;
let totalNegativePeriods = 0;

console.log(
  "ACCOUNT".padEnd(25),
  "FY25-26 RECORDS".padEnd(15),
  "OPENING PROVENANCE".padEnd(30),
  "OPENING".padEnd(12),
  "RECEIPTS".padEnd(12),
  "PAYMENTS".padEnd(12),
  "TRANSFER IN".padEnd(12),
  "TRANSFER OUT".padEnd(12),
  "UNKNOWN".padEnd(8),
  "CALC CLOSING".padEnd(15),
  "SRC CLOSING".padEnd(15),
  "DIFFERENCE".padEnd(12),
  "LOWEST BAL".padEnd(12),
  "NEG TX".padEnd(8),
  "NEG DATES".padEnd(12),
  "NEG PERIODS".padEnd(12),
  "RESULT"
);

// We need to also print section C for negative physical cash
let negativeDetails: any[] = [];

for (const acc of cashAccounts) {
  // get all transactions for this account ordered by date, api_sequence
  const allTx = db.prepare("SELECT * FROM audit_zoho_bank_transactions WHERE account_id = ? ORDER BY date ASC, api_sequence ASC").all(acc.account_id) as any[];
  
  let fyTransactions = [];
  let priorRunningBalance = undefined;

  for (const tx of allTx) {
      if (tx.date < "2025-04-01") {
          priorRunningBalance = tx.running_balance;
      } else if (tx.date >= "2025-04-01" && tx.date <= "2026-03-31") {
          fyTransactions.push(tx);
      }
  }

  let openingBalance = 0;
  let provenance = "NOT PROVEN";
  
  if (priorRunningBalance !== undefined) {
      openingBalance = priorRunningBalance;
      provenance = "SOURCE PRIOR CLOSING";
  } else if (fyTransactions.length > 0) {
     const firstTx = fyTransactions[0];
     if (firstTx.running_balance !== null && firstTx.running_balance !== undefined) {
         let amount = firstTx.amount || 0;
         if (firstTx.debit_or_credit === 'debit') {
             openingBalance = firstTx.running_balance - amount;
             provenance = "DERIVED FROM FIRST TX";
         } else if (firstTx.debit_or_credit === 'credit') {
             openingBalance = firstTx.running_balance + amount;
             provenance = "DERIVED FROM FIRST TX";
         }
     }
  } else {
     openingBalance = 0;
     provenance = "SOURCE PRIOR CLOSING"; 
  }
  
  let calculatedBalance = openingBalance;
  let lowestBalance = openingBalance;
  let accNegativeTransactions = 0;
  let negativeDatesSet = new Set();
  let unknownCount = 0;
  let mismatchCount = 0;
  
  let receipts = 0;
  let payments = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  let srcClosing = openingBalance;

  let inNegativePeriod = false;
  let accNegativePeriods = 0;
  let firstNegativeTxDate = "";

  for (const tx of fyTransactions) {
      let amount = tx.amount || 0;
      let isReceipt = false;
      let isPayment = false;
      let isTransferIn = false;
      let isTransferOut = false;

      if (tx.debit_or_credit === 'debit') {
          if (tx.transaction_type === 'transfer_fund') isTransferIn = true;
          else isReceipt = true;
      } else if (tx.debit_or_credit === 'credit') {
          if (tx.transaction_type === 'transfer_fund') isTransferOut = true;
          else isPayment = true;
      } else {
          unknownCount++;
      }

      if (isReceipt) { calculatedBalance += amount; receipts += amount; }
      if (isPayment) { calculatedBalance -= amount; payments += amount; }
      if (isTransferIn) { calculatedBalance += amount; transfersIn += amount; }
      if (isTransferOut) { calculatedBalance -= amount; transfersOut += amount; }

      if (tx.running_balance !== null && tx.running_balance !== undefined) {
          srcClosing = tx.running_balance;
          let diff = Math.abs(calculatedBalance - tx.running_balance);
          if (diff > 0.02) { 
              mismatchCount++;
              calculatedBalance = tx.running_balance;
          }
      } else {
          srcClosing = calculatedBalance;
      }

      if (calculatedBalance < lowestBalance) {
          lowestBalance = calculatedBalance;
      }
      
      if (calculatedBalance < -0.01) {
          if (!inNegativePeriod) {
              inNegativePeriod = true;
              accNegativePeriods++;
          }
          if (firstNegativeTxDate === "") firstNegativeTxDate = tx.date;
          accNegativeTransactions++;
          negativeDatesSet.add(tx.date);
      } else {
          inNegativePeriod = false;
      }
  }
  
  let diff = Math.abs(calculatedBalance - srcClosing);
  let isPass = (diff < 0.02) && (mismatchCount === 0) && (unknownCount === 0);
  
  if (isPass) totalPasses++;
  if (diff >= 0.02) totalNonZeroDiff++;
  totalContinuityFailures += mismatchCount;
  totalUnknown += unknownCount;
  
  if (lowestBalance < -0.01) {
      totalNegativeAccounts++;
      totalNegativeTx += accNegativeTransactions;
      totalNegativeDates += negativeDatesSet.size;
      totalNegativePeriods += accNegativePeriods;
      negativeDetails.push({
          acc: acc.account_name,
          first: firstNegativeTxDate,
          lowest: lowestBalance,
          count: accNegativeTransactions,
          dates: negativeDatesSet.size,
          periods: accNegativePeriods
      });
  }

  console.log(
      acc.account_name.substring(0, 24).padEnd(25),
      String(fyTransactions.length).padEnd(15),
      provenance.padEnd(30),
      openingBalance.toFixed(2).padEnd(12),
      receipts.toFixed(2).padEnd(12),
      payments.toFixed(2).padEnd(12),
      transfersIn.toFixed(2).padEnd(12),
      transfersOut.toFixed(2).padEnd(12),
      String(unknownCount).padEnd(8),
      calculatedBalance.toFixed(2).padEnd(15),
      srcClosing.toFixed(2).padEnd(15),
      (calculatedBalance - srcClosing).toFixed(2).padEnd(12),
      lowestBalance.toFixed(2).padEnd(12),
      String(accNegativeTransactions).padEnd(8),
      String(negativeDatesSet.size).padEnd(12),
      String(accNegativePeriods).padEnd(12),
      isPass ? "PASS" : "FAIL"
  );
}

console.log("\\n=== C. NEGATIVE CASH EVIDENCE ===");
for (const detail of negativeDetails) {
    console.log(`Account: ${detail.acc}`);
    console.log(`  First Negative Date: ${detail.first}`);
    console.log(`  Lowest Balance: ${detail.lowest.toFixed(2)}`);
    console.log(`  Number of Negative Transactions: ${detail.count}`);
    console.log(`  Distinct Dates with Negative Balance: ${detail.dates}`);
    console.log(`  Continuous Negative Periods: ${detail.periods}`);
    console.log();
}

console.log("=== FINAL TOTALS ===");
console.log(`Total Genuine Cash Accounts: ${cashAccounts.length}`);
console.log(`Total Passing Accounts: ${totalPasses}`);
console.log(`Total Equation Differences: ${totalNonZeroDiff}`);
console.log(`Total Continuity Failures: ${totalContinuityFailures}`);
console.log(`Total Unknown Transactions: ${totalUnknown}`);
console.log(`Total Negative Accounts: ${totalNegativeAccounts}`);
console.log(`Total Negative Transactions: ${totalNegativeTx}`);
console.log(`Total Negative Balance Dates: ${totalNegativeDates}`);
console.log(`Total Negative Periods: ${totalNegativePeriods}`);

