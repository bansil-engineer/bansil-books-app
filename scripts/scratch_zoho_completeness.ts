import { listBankAccountTransactions } from "../app/lib/audit/accounts/zoho-read-source.ts";
import { DatabaseSync } from "node:sqlite";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";async function main() {
  const actualOrgId = "774390949";
  const db = new DatabaseSync("data/audit_workspace.db");
  
  const hdfcId = "3166667000000092034"; // HDFC Current XXXX7642

  console.log("==================================================");
  console.log("1. LOCAL SYNC COMPLETENESS");
  console.log("==================================================");

  const localRows = db.prepare(
    `SELECT transaction_id, date, amount, debit_or_credit, transaction_type, status, source
     FROM audit_zoho_bank_transactions 
     WHERE account_id = ? AND date >= '2025-04-01' AND date <= '2026-03-31'`
  ).all(hdfcId) as any[];
  
  console.log(`LOCAL COUNT: ${localRows.length}`);
  const dates = localRows.map(r => r.date).sort();
  if (dates.length > 0) {
    console.log(`Min Date: ${dates[0]}`);
    console.log(`Max Date: ${dates[dates.length - 1]}`);
  }
  
  const months = ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", 
                  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
  const counts: Record<string, number> = {};
  for (const m of months) counts[m] = 0;
  for (const r of localRows) {
    const ym = r.date.substring(0, 7);
    if (counts[ym] !== undefined) counts[ym]++;
  }
  
  for (const m of months) {
    console.log(`${m}: ${counts[m]}`);
  }

  console.log("\n==================================================");
  console.log("2. LIVE ZOHO READ-ONLY COUNT");
  console.log("==================================================");
  
  const liveResult = await listBankAccountTransactions(actualOrgId, hdfcId, {});
  const allLiveTxs = liveResult.transactions;
  const liveTxs = allLiveTxs.filter(t => t.date >= '2025-04-01' && t.date <= '2026-03-31');
  const uniqueLiveIds = new Set(liveTxs.map(t => t.transaction_id));
  
  // Try to estimate pages fetched based on 200 per page limit
  const pages = Math.ceil(allLiveTxs.length / 200);
  
  console.log(`pages fetched: ${pages > 0 ? pages : 1} (estimated, up to 50 max allowed)`);
  console.log(`records per page: 200`);
  console.log(`raw records: ${allLiveTxs.length}`);
  console.log(`FY25-26 records: ${liveTxs.length}`);
  console.log(`unique transaction IDs: ${uniqueLiveIds.size}`);
  console.log(`duplicates: ${liveTxs.length - uniqueLiveIds.size}`);
  
  const liveDates = liveTxs.map(t => t.date).sort();
  if (liveDates.length > 0) {
    console.log(`minimum date: ${liveDates[0]}`);
    console.log(`maximum date: ${liveDates[liveDates.length - 1]}`);
  }
  
  console.log("\n==================================================");
  console.log("3. LIVE vs LOCAL");
  console.log("==================================================");
  console.log(`LIVE COUNT: ${liveTxs.length}`);
  console.log(`LOCAL COUNT: ${localRows.length}`);
  
  const localIds = new Set(localRows.map(r => r.transaction_id));
  
  let liveMissingLocally = 0;
  let livePresentLocally = 0;
  const missingLocallyDetails: any[] = [];
  
  for (const t of liveTxs) {
    if (localIds.has(t.transaction_id)) {
      livePresentLocally++;
    } else {
      liveMissingLocally++;
      missingLocallyDetails.push(t);
    }
  }
  
  let localAbsentLive = 0;
  for (const id of localIds) {
    if (!uniqueLiveIds.has(id)) {
      localAbsentLive++;
    }
  }
  
  console.log(`LIVE IDs PRESENT LOCALLY: ${livePresentLocally}`);
  console.log(`LIVE IDs MISSING LOCALLY: ${liveMissingLocally}`);
  console.log(`LOCAL IDs ABSENT LIVE: ${localAbsentLive}`);
  
  if (liveMissingLocally > 0) {
    console.log("Sample Missing IDs (first 5):");
    for (let i = 0; i < Math.min(5, missingLocallyDetails.length); i++) {
        console.log(`ID: ${missingLocallyDetails[i].transaction_id}, Date: ${missingLocallyDetails[i].date}, Type: ${missingLocallyDetails[i].transaction_type}, Status: ${missingLocallyDetails[i].status}`);
    }
  }

  console.log("\n==================================================");
  console.log("4. DETERMINE ZOHO SOURCE SEMANTICS");
  console.log("==================================================");
  // Summarize the unique transaction_type and status of the LIVE transactions
  const types = new Set(liveTxs.map(t => t.transaction_type));
  const statuses = new Set(liveTxs.map(t => t.status));
  const sources = new Set(liveTxs.map(t => t.source));
  
  console.log(`Live Transaction Types: ${Array.from(types).join(", ")}`);
  console.log(`Live Statuses: ${Array.from(statuses).join(", ")}`);
  console.log(`Live Sources: ${Array.from(sources).join(", ")}`);
  
  if (liveMissingLocally > 0) {
      console.log("\nMissing types breakdown:");
      const mTypes = new Set(missingLocallyDetails.map(t => t.transaction_type));
      const mStatuses = new Set(missingLocallyDetails.map(t => t.status));
      console.log(`Missing Types: ${Array.from(mTypes).join(", ")}`);
      console.log(`Missing Statuses: ${Array.from(mStatuses).join(", ")}`);
  }
}

main().catch(console.error);
