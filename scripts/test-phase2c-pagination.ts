import { listBankAccountTransactions } from "../app/lib/audit/accounts/zoho-read-source.ts";

async function run() {
    const orgId = "774390949";
    const hdfcId = "3166667000000092034";
    
    console.log(`Starting pagination test for orgId=${orgId}, accountId=${hdfcId}`);
    
    const res = await listBankAccountTransactions(orgId, hdfcId, {
        per_page: 50,
        from_date: "2025-04-01",
        to_date: "2026-03-31"
    });
    
    console.log(`Fetched ${res.transactions.length} records with a page size of 50.`);
    console.log(`Expected around 422 if pagination works correctly across multiple pages.`);
}

run().catch(console.error);
