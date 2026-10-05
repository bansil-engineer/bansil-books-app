import { getAuditDatabase } from "./app/lib/db/audit-database.ts";
import { calculateCashEquation } from "./app/lib/audit/cash-equation.ts";
import { getGenuineCashAccounts } from "./app/lib/audit/cash-sync-service.ts";

async function run() {
  const db = getAuditDatabase();
  const runId = "c527aa89-d3fe-4b3a-939a-3a86908b5c59";
  
  const resTB = db.prepare(`SELECT evidence_json FROM pre_audit_checkpoint_results WHERE run_id = ? AND checkpoint_key = 'Trial Balance'`).get(runId) as any;
  const tbEv = JSON.parse(resTB.evidence_json);
  const tbLeaves = tbEv.flatLeaves;
  
  const cashAccounts = getGenuineCashAccounts();
  const targets = [
    'Cash For Company', 'Petty Cash', 'ATITI SHAH Cash Book', 'Naresh Luharia', 
    'Vipul R Patel', 'Kajal Soni', 'Agasti Patel Cash Book'
  ];
  
  console.log("==================================================");
  console.log("2. EXACT 7-ACCOUNT MATRIX");
  console.log("==================================================");

  let matchCount = 0;
  let accountIdMatchCount = 0;
  let totalAbsDiff = 0;
  
  for (const t of targets) {
     const tbAcc = tbLeaves.find((l: any) => l.name === t);
     const cashAccMeta = cashAccounts.find((c: any) => c.account_name === t);
     
     const tbId = tbAcc ? tbAcc.account_id : 'NOT_FOUND_IN_TB';
     const cashId = cashAccMeta ? cashAccMeta.account_id : 'NOT_FOUND_IN_CASH_DB';
     const sameId = (tbId !== 'NOT_FOUND_IN_TB' && cashId !== 'NOT_FOUND_IN_CASH_DB' && tbId === cashId);
     if (sameId) accountIdMatchCount++;
     
     let cashEq: any = { opening_balance: 0, total_receipts: 0, total_payments: 0, closing_balance: 0 };
     if (cashAccMeta) {
         cashEq = calculateCashEquation(cashId, "2025-04-01", "2026-03-31");
     }

     const tbDebit = tbAcc ? (tbAcc.net_debit_total || 0) : 0;
     const tbCredit = tbAcc ? (tbAcc.net_credit_total || 0) : 0;
     const tbNet = tbDebit - tbCredit; // Asset normal balance is debit
     
     const diff = tbNet - cashEq.closing_balance;
     totalAbsDiff += Math.abs(diff);
     if (Math.abs(diff) < 0.01) matchCount++;

     console.log(`\nACCOUNT NAME: ${t}`);
     console.log(`ACCOUNT ID: TB=${tbId} | CASH=${cashId} | SAME ID? ${sameId ? 'YES' : 'NO'}`);
     console.log(`ZOHO ACCOUNT TYPE: TB=${tbAcc?.account_type || 'N/A'} | CASH=${cashAccMeta?.account_type || 'N/A'}`);
     console.log(`\nTRUE TB 31/03/2026:`);
     console.log(`  Debit: ${tbDebit}`);
     console.log(`  Credit: ${tbCredit}`);
     console.log(`  Net: ${tbNet}`);
     console.log(`\nCASH RECONSTRUCTION:`);
     console.log(`  Opening: ${cashEq.opening_balance}`);
     console.log(`  Receipts: ${cashEq.total_receipts}`);
     console.log(`  Payments: ${cashEq.total_payments}`);
     console.log(`  Closing: ${cashEq.closing_balance}`);
     console.log(`\nDIFFERENCE:`);
     console.log(`  TB Net - Cash Closing: ${diff.toFixed(2)}`);

     // Latest Balance
     let latestBal = 'N/A';
     if (cashAccMeta) {
        // Query the latest transaction running balance from DB
        const latestTx = db.prepare(`SELECT running_balance FROM audit_zoho_bank_transactions WHERE account_id = ? ORDER BY date DESC, api_sequence DESC LIMIT 1`).get(cashId) as any;
        if (latestTx) latestBal = latestTx.running_balance;
     }
     console.log(`\nLATEST BALANCE: ${latestBal}`);
  }

  console.log("\n==================================================");
  console.log(`TOTAL MATCH: ${matchCount}/7`);
  console.log(`TOTAL ABSOLUTE DIFFERENCE: ${totalAbsDiff.toFixed(2)}`);
}

run().catch(console.error);
