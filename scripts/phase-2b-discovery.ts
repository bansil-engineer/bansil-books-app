import { listBankAccounts, listChartOfAccounts, listBankAccountTransactions } from "../app/lib/audit/accounts/zoho-read-source.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import fs from "fs";

async function runDiscovery() {
  const { store } = await getValidAccessToken();
  const orgId = store.organization_id || "774390949";

  const { bankAccounts } = await listBankAccounts(orgId);
  const { accounts: coa } = await listChartOfAccounts(orgId);

  // 10. ACCOUNT-TYPE COUNT DISCREPANCY
  const typeCounts: Record<string, number> = {
    "bank": 0, "cash": 0, "credit_card": 0, "payment_clearing": 0, "other": 0
  };
  
  for (const b of bankAccounts) {
    const t = b.account_type.toLowerCase();
    if (typeCounts[t] !== undefined) typeCounts[t]++;
    else typeCounts.other++;
  }
  
  console.log("== ACCOUNT-TYPE UNIVERSE ==");
  for (const [k, v] of Object.entries(typeCounts)) {
    console.log(`${k.toUpperCase()}: ${v}`);
  }

  // 7. MASTER UNCATEGORIZED COUNT
  let totalUncat = 0;
  for (const b of bankAccounts) {
    totalUncat += b.uncategorized_transactions || 0;
  }
  console.log("\n== UNCATEGORIZED VERIFICATION ==");
  console.log(`CURRENT MASTER UNCATEGORIZED COUNT: ${totalUncat}`);
  console.log(`PREVIOUS PHASE 2A COUNT: 24`);
  console.log(`PREVIOUS PHASE 2B COUNT: 28`);
  const countChanged = totalUncat !== 24;
  console.log(`COUNT CHANGED: ${countChanged ? "YES" : "NO"}`);
  console.log(`CAUSE: NOT PROVEN`);

  // SELECT SAFE DISCOVERY ACCOUNTS
  const bankWithUncat = bankAccounts.find(b => b.account_type === "bank" && b.is_active && (b.uncategorized_transactions || 0) > 0);
  const bankZeroUncat = bankAccounts.find(b => b.account_type === "bank" && b.is_active && (b.uncategorized_transactions || 0) === 0);
  const creditCard = bankAccounts.find(b => b.account_type === "credit_card" && b.is_active);

  console.log("\n== SELECTED ACCOUNTS ==");
  if (bankWithUncat) console.log(`A. Bank with Uncat: ID=${bankWithUncat.account_id}`);
  if (bankZeroUncat) console.log(`B. Bank zero Uncat: ID=${bankZeroUncat.account_id}`);
  if (creditCard) console.log(`C. Credit Card: ID=${creditCard.account_id}`);

  // 6. VERIFY SAMPLE TRANSACTION SEMANTICS
  console.log("\n== LIVE TRANSACTION DISCOVERY ==");
  for (const acc of [bankWithUncat, bankZeroUncat, creditCard].filter(Boolean)) {
    console.log(`\nFetching transactions for Account ID: ${acc!.account_id}...`);
    try {
      const res = await listBankAccountTransactions(orgId, acc!.account_id, { per_page: 5, page: 1 });
      const txs = res.transactions;
      console.log(`API SUCCESS. Retrieved ${txs.length} transactions (Page 1).`);
      
      let debits = 0, credits = 0;
      let statuses: Record<string, number> = {};
      let types: Record<string, number> = {};
      let earliest = txs[0]?.date, latest = txs[0]?.date;

      for (const tx of txs) {
        if (tx.debit_or_credit === "debit") debits++;
        if (tx.debit_or_credit === "credit") credits++;
        
        statuses[tx.status] = (statuses[tx.status] || 0) + 1;
        types[tx.transaction_type] = (types[tx.transaction_type] || 0) + 1;
        
        if (tx.date < earliest) earliest = tx.date;
        if (tx.date > latest) latest = tx.date;
      }
      console.log(`Dates: ${earliest} to ${latest}`);
      console.log(`Debits: ${debits}, Credits: ${credits}`);
      console.log(`Statuses: ${JSON.stringify(statuses)}`);
      console.log(`Transaction Types: ${JSON.stringify(types)}`);
      
      console.log(`Samples:`);
      for (const tx of txs.slice(0, 3)) {
        console.log(` - [${tx.date}] ${tx.transaction_type} | Status=${tx.status} | ${tx.debit_or_credit} | ${tx.amount}`);
      }
    } catch (e: any) {
      console.log(`API FAILED: ${e.message}`);
    }
  }
  
  // 8. STATUS-FILTER CONTROL TEST
  console.log("\n== STATUS-FILTER CONTROL TEST ==");
  if (bankWithUncat) {
    const masterCount = bankWithUncat.uncategorized_transactions || 0;
    console.log(`MASTER UNCATEGORIZED: ${masterCount}`);
    
    // Request filtered by status
    let filteredCount = 0;
    try {
      // To get total count, we must iterate pages, but wait, we can just do one call if it returns total.
      // But we just want to verify it works. Let's do a request.
      const resFilter = await listBankAccountTransactions(orgId, bankWithUncat.account_id, { status: "uncategorized", per_page: 200, page: 1 });
      filteredCount = resFilter.transactions.length; // Assuming all fit in page 1 for this test
      console.log(`FILTERED API COUNT: ${filteredCount}`);
      console.log(`CONSISTENT: ${masterCount === filteredCount ? "YES" : "NO"}`);
    } catch(e:any) {
      console.log(`API FAILED: ${e.message}`);
    }
  }

  // 9. BANK <-> COA IDENTITY CLAIM
  console.log("\n== BANK <-> COA IDENTITY CHECK ==");
  let exactMatches = 0;
  for (const b of bankAccounts) {
    const coaMatchById = coa.find(c => c.account_id === b.account_id);
    if (coaMatchById) {
      exactMatches++;
    }
  }
  
  console.log(`TOTAL BANK-SOURCE RECORDS: ${bankAccounts.length}`);
  console.log(`TOTAL EXACT COA-ID MATCHES: ${exactMatches}`);
  console.log(`UNMATCHED: ${bankAccounts.length - exactMatches}`);
  
}

runDiscovery().catch(console.error);
