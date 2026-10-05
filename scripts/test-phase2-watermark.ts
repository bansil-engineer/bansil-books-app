import { getDatabase, setSyncMetadata, getSyncMetadata } from "../app/lib/db/database.ts";
import { performSmartSync } from "../app/lib/smart-sync-engine.ts";
import * as zohoSecurityGuard from "../app/lib/zoho-security-guard.ts";
const db = getDatabase();

async function main() {
  console.log("=== WATERMARK SAFETY TEST ===\n");
  
  db.exec("DELETE FROM sync_logs");
  db.exec("DELETE FROM sync_state");
  db.exec("DELETE FROM sync_metadata");

  // 1. Initial SUCCESS sync
  console.log("1. Running initial SUCCESS sync...");
  const res1 = await performSmartSync({ mode: "SMART", modules: ["stock"] });
  const watermark1 = getSyncMetadata(db, "last_successful_sync_time");
  console.log(`Initial status: ${res1.status}`);
  console.log(`Watermark BEFORE: ${watermark1}`);
  
  // 2. Simulate PARTIAL sync (Invoices succeed, Bills fail)
  console.log("\n2. Simulating PARTIAL sync (Invoices succeed, Bills fail)...");
  
  const res2 = await performSmartSync({ mode: "SMART", modules: ["sales_invoices", "purchase_bills"], customerId: "FAIL_BILLS" });
  const watermark2 = getSyncMetadata(db, "last_successful_sync_time");
  
  console.log(`Partial sync status: ${res2.status}`);
  console.log(`Modules: ${JSON.stringify(res2.modules)}`);
  console.log(`Watermark AFTER partial: ${watermark2}`);
  console.log(`Watermark advanced on PARTIAL: ${watermark1 !== watermark2 ? "YES" : "NO"}`);
  
  // Wait a bit
  await new Promise(r => setTimeout(r, 2000));
  
  // 3. Retry SUCCESS sync
  console.log("\n3. Retrying SUCCESS sync...");
  const res3 = await performSmartSync({ mode: "SMART", modules: ["stock"] });
  const watermark3 = getSyncMetadata(db, "last_successful_sync_time");
  console.log(`Retry sync status: ${res3.status}`);
  console.log(`Watermark advanced after SUCCESS: ${watermark1 !== watermark3 ? "YES" : "NO"}`);
  
  // Wait a bit
  await new Promise(r => setTimeout(r, 2000));
  
  // 4. Simulate FAILED sync (both fail)
  console.log("\n4. Simulating FAILED sync (both fail)...");
  
  const res4 = await performSmartSync({ mode: "SMART", modules: ["sales_invoices", "purchase_bills"], customerId: "FAIL_ALL" });
  const watermark4 = getSyncMetadata(db, "last_successful_sync_time");
  
  console.log(`Failed sync status: ${res4.status}`);
  console.log(`Watermark AFTER failed: ${watermark4}`);
  console.log(`Watermark advanced on FAILED: ${watermark3 !== watermark4 ? "YES" : "NO"}`);
  
}

main().catch(console.error);
