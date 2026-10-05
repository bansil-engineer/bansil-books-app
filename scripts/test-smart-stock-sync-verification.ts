import { getAuditDatabase } from "../app/lib/db/audit-database";
import { getDatabase, setSyncMetadata, getSyncMetadata } from "../app/lib/db/database";
import { performSmartSync } from "../app/lib/smart-sync-engine";
import { getStockSummary } from "../app/lib/stock-engine";
import { getCurrentFinancialYear } from "../app/lib/date-period-utils";

async function main() {
  const db = getAuditDatabase();
  console.log("=== SMART STOCK SYNC VERIFICATION ===");
  
  // 1. Initial Stock Smart Sync
  console.log("\n1. Initial Stock Smart Sync");
  db.exec("DELETE FROM audit_section_syncs WHERE section_key = 'INVENTORY_STOCK'");
  
  const primaryDb = getDatabase();
  
  // Wipe last sync times to force full
  setSyncMetadata(primaryDb, "last_successful_sync_time", "");
  primaryDb.prepare("UPDATE sync_state SET last_successful_sync_at = NULL WHERE module IN ('sales_invoices', 'purchase_bills')").run();

  const res1 = await performSmartSync({ mode: "SMART", modules: ["stock"], financialYear: getCurrentFinancialYear() });
  console.log("Result 1:", JSON.stringify(res1.modules, null, 2));
  console.log("Status:", res1.status, "API Calls:", res1.apiCallsUsed);
  
  // 2. Immediate second sync with NO source changes
  console.log("\n2. Immediate second sync with NO source changes");
  const res2 = await performSmartSync({ mode: "SMART", modules: ["stock"], financialYear: getCurrentFinancialYear() });
  console.log("Result 2:", JSON.stringify(res2.modules, null, 2));
  console.log("Status:", res2.status, "API Calls:", res2.apiCallsUsed);

  // 10. Periods Test (just quick calls)
  console.log("\n10. Periods Test");
  const resPrev = await performSmartSync({ mode: "SMART", modules: ["stock"], financialYear: "2024-25" });
  console.log("Prev FY Status:", resPrev.status);

  // 11. Existing Stock totals/calculation regression
  console.log("\n11. Existing Stock totals regression");
  const stockData = getStockSummary({ period: getCurrentFinancialYear() });
  console.log("Stock Items:", stockData.items.length);
  console.log("Total Active Items:", stockData.kpis.totalActiveItems);
  
}

main().catch(console.error);
