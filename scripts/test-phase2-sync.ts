import { getDatabase } from "../app/lib/db/database";
import { performSmartSync } from "../app/lib/smart-sync-engine";

async function main() {
  const db = getDatabase();
  console.log("=== PHASE 2 SYNC TEST ===");

  // 0. Wipe sync state to ensure Sync 1 is FULL
  console.log("\n0. Wiping sync state");
  db.exec("UPDATE sync_state SET last_successful_sync_at = NULL WHERE module IN ('sales_invoices', 'purchase_bills', 'stock')");

  // 1. Check if first sync works (Full)
  console.log("\n1. Running Full Sync");
  const res1 = await performSmartSync({ mode: "SMART", modules: ["stock"] });
  console.log("Sync 1 Details:", JSON.stringify(res1.modules, null, 2));
  
  // 2. Add dummy composite assembly component mapped to a purchase bill
  console.log("\n2. Testing Composite Assembly Validation");
  
  // Clean up any old dummy
  db.exec("DELETE FROM composite_assembly_components WHERE assembly_id = 'dummy_asm_1'");
  db.exec("DELETE FROM composite_assemblies WHERE assembly_id = 'dummy_asm_1'");

  db.exec(`
    INSERT OR IGNORE INTO composite_assemblies (
      assembly_id, assembly_number, customer_id, customer_name,
      composite_item_id, composite_item_name, generated_qty,
      assembly_date, status, created_at, updated_at
    ) VALUES (
      'dummy_asm_1', 'ASM-999', 'cust_1', 'Test Customer',
      'item_c1', 'Composite Item', 10,
      '2024-01-01', 'CONFIRMED', '2024-01-01', '2024-01-01'
    );
    
    INSERT OR IGNORE INTO composite_assembly_components (
      assembly_component_id, assembly_id, source_bill_id, source_bill_number,
      source_bill_line_item_id, component_item_id, component_item_name,
      raw_purchase_qty, consumed_qty, purchase_rate, purchase_amount,
      customer_id, created_at
    ) VALUES (
      'dummy_comp_1', 'dummy_asm_1', 'bill_999', 'BILL-999',
      'line_999_deleted', 'item_1', 'Raw Material',
      10, 10, 5, 50, 'cust_1', '2024-01-01'
    );
  `);
  
  console.log("Inserted dummy assembly mapped to non-existent bill line 'line_999_deleted'");

  // 3. Run sync again to trigger validation and incremental fetch
  console.log("\n3. Running Incremental Sync");
  const res2 = await performSmartSync({ mode: "SMART", modules: ["stock"] });
  console.log("Sync 2 res:", res2);

  const asmStatus = db.prepare("SELECT status, remarks FROM composite_assemblies WHERE assembly_id = 'dummy_asm_1'").get();
  console.log("Assembly Status After Sync:", asmStatus);

  // Clean up
  db.exec("DELETE FROM composite_assembly_components WHERE assembly_id = 'dummy_asm_1'");
  db.exec("DELETE FROM composite_assemblies WHERE assembly_id = 'dummy_asm_1'");
}

main().catch(console.error);
