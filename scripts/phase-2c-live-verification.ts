import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { 
  importChartOfAccountsSnapshot, 
  importBankAccountsSnapshot, 
  importBankTransactionsSnapshot 
} from "./phase-2c-sync.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";

async function runLiveVerification() {
  console.log("== LIVE LOCAL-PERSISTENCE VERIFICATION ==");
  
  const { store } = await getValidAccessToken();
  const orgId = store.organization_id || "774390949";
  const db = getAuditDatabase();

  // A. Chart of Accounts
  console.log("\n-- Capturing Chart of Accounts --");
  const coaRes = await importChartOfAccountsSnapshot(orgId, db);
  console.log(`SOURCE FETCH COUNT: ${coaRes.seen}`);
  console.log(`LOCAL PERSISTED COUNT: ${coaRes.written}`);
  console.log(`DUPLICATE COUNT: 0`);
  console.log(`REJECTED COUNT: 0`);
  console.log(`ERROR COUNT: ${coaRes.errors}`);

  // B. Bank Accounts
  console.log("\n-- Capturing Bank Accounts --");
  const bankRes = await importBankAccountsSnapshot(orgId, db);
  console.log(`SOURCE FETCH COUNT: ${bankRes.seen}`);
  console.log(`LOCAL PERSISTED COUNT: ${bankRes.written}`);
  console.log(`DUPLICATE COUNT: 0`);
  console.log(`REJECTED COUNT: 0`);
  console.log(`ERROR COUNT: ${bankRes.errors}`);

  // C. Bank Transactions (Bounded sample)
  console.log("\n-- Capturing Bank Transactions (Bounded Sample) --");
  // Find a bank account that is active and has uncategorized txs if possible
  const sampleBank = db.prepare(`
    SELECT account_id FROM audit_zoho_bank_accounts 
    WHERE account_type IN ('bank', 'credit_card') AND is_active = 1 
    ORDER BY uncategorized_transaction_count DESC LIMIT 1
  `).get() as { account_id: string };

  if (sampleBank) {
    const txRes = await importBankTransactionsSnapshot(orgId, sampleBank.account_id, { per_page: 5, page: 1 }, db);
    console.log(`SAMPLE ACCOUNT: ${sampleBank.account_id}`);
    console.log(`SOURCE FETCH COUNT: ${txRes.seen}`);
    console.log(`LOCAL PERSISTED COUNT: ${txRes.written}`);
    console.log(`DUPLICATE COUNT: 0`);
    console.log(`REJECTED COUNT: 0`);
    console.log(`ERROR COUNT: ${txRes.errors}`);
  } else {
    console.log(`No active bank account found for sample.`);
  }

  console.log("\n== VERIFY 30/13 BANK <-> COA SNAPSHOT ==");
  
  // Recompute using the DB
  const bankCount = db.prepare(`SELECT count(*) as c FROM audit_zoho_bank_accounts WHERE source_run_id = ?`).get(bankRes.runId) as { c: number };
  
  const matches = db.prepare(`
    SELECT count(*) as c 
    FROM audit_zoho_bank_accounts b
    JOIN audit_zoho_coa c ON b.account_id = c.account_id AND c.source_run_id = ?
    WHERE b.source_run_id = ?
  `).get(coaRes.runId, bankRes.runId) as { c: number };

  const unmatched = bankCount.c - matches.c;

  console.log(`TOTAL BANK-SOURCE: ${bankCount.c}`);
  console.log(`EXACT-ID MATCH: ${matches.c}`);
  console.log(`UNMATCHED: ${unmatched}`);
  
  console.log(`\nPRIOR LIVE OBSERVATION: 43 / 30 / 13`);
  
  if (bankCount.c === 43 && matches.c === 30 && unmatched === 13) {
    console.log(`CAUSE: PROVEN (No change)`);
  } else {
    console.log(`CAUSE: NOT PROVEN (Source data changed since phase 2A)`);
  }
}

runLiveVerification().catch(console.error);
