import { importBankTransactionsSnapshot } from "./phase-2c-sync.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

async function run() {
    const orgId = "774390949";
    const hdfcId = "3166667000000092034";
    const db = getAuditDatabase();
    
    console.log("Starting full pilot sync for HDFC...");
    
    try {
        const result = await importBankTransactionsSnapshot(orgId, hdfcId, {
            per_page: 200,
            from_date: "2025-04-01",
            to_date: "2026-03-31"
        }, db);
        
        console.log("Sync completed successfully:");
        console.log(result);
        
        const countRow = db.prepare("SELECT count(*) as c FROM audit_zoho_bank_transactions WHERE account_id = ? AND date >= '2025-04-01' AND date <= '2026-03-31'").get(hdfcId) as any;
        console.log(`Local DB target FY count is now: ${countRow.c}`);
        
    } catch (e) {
        console.error("Sync failed:", e);
    }
}

run().catch(console.error);
