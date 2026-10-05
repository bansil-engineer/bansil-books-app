// ============================================================
// Bansil Books Analytics — Local Manual Composite Assembly Test Suite
// Customer-wise Component Purchase -> BUN Conversion Validation
// Local SQLite Only · Zero Zoho API Calls · Read-Only Guard
// ============================================================

import assert from "node:assert";
import { getDatabase } from "../app/lib/db/database.ts";
import {
  createAssemblyDraft,
  updateAssemblyDraft,
  confirmAssembly,
  cancelOrReverseAssembly,
  getAssemblyDetail,
  getAssemblyList,
  getEligibleComponentPurchaseLines,
  getConfirmedAssemblyImpact,
  type AssemblyComponentInput,
} from "../app/lib/composite-assembly-engine.ts";
import { getCustomerDetailsData } from "../app/lib/customer-details-engine.ts";
import { buildCompositeAssemblyExcel } from "../app/lib/export/excel-builder.ts";
import { buildCompositeAssemblyPdf } from "../app/lib/export/pdf-builder.ts";

let passedCount = 0;
let failedCount = 0;

function pass(name: string, detail?: string) {
  console.log(`  ✓ PASS: ${name}${detail ? ` (${detail})` : ""}`);
  passedCount++;
}

function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === "function") {
      (res as any)
        .then(() => pass(name))
        .catch((err: any) => fail(name, err));
    } else {
      pass(name);
    }
  } catch (err) {
    fail(name, err);
  }
}

console.log("\n==================================================================");
console.log("LOCAL MANUAL COMPOSITE ASSEMBLY (BUN CONVERSION) TEST SUITE");
console.log("==================================================================\n");

const db = getDatabase();

// Setup sample test customer and purchase lines if needed for isolated deterministic tests
const testCustomerId = "TEST_CUST_ASM_001";
const testCustomerName = "TEST COMPOSITE CUSTOMER LTD";
const testBillId = "TEST_BILL_ASM_001";

// Clean any previous test data
db.prepare("DELETE FROM composite_assembly_components WHERE customer_id = ?").run(testCustomerId);
db.prepare("DELETE FROM composite_assembly_audit WHERE assembly_id IN (SELECT assembly_id FROM composite_assemblies WHERE customer_id = ?)").run(testCustomerId);
db.prepare("DELETE FROM composite_assemblies WHERE customer_id = ?").run(testCustomerId);
db.prepare("DELETE FROM purchase_bills WHERE bill_id = ?").run(testBillId);
db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(testBillId);
db.prepare("DELETE FROM sales_invoices WHERE invoice_id = 'TEST_INV_ASM_001'").run();
db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id = 'TEST_INV_ASM_001'").run();

// Insert test purchase bill with 3 component lines
const now = new Date().toISOString();
db.prepare(`
  INSERT INTO purchase_bills (
    bill_id, organization_id, bill_number, vendor_id, vendor_name, date, status, total, balance, synced_at
  ) VALUES (?, '774390949', 'BILL-ASM-9901', 'VEND-001', 'Schneider Electric', '2026-05-10', 'paid', 50000, 0, ?)
`).run(testBillId, now);

db.prepare(`
  INSERT INTO purchase_bill_line_items (
    line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total,
    purchase_line_customer_id, purchase_line_customer_name, bbt_customer_id, bbt_customer_name,
    customer_data_status, synced_at
  ) VALUES 
  ('LINE_DB_01', ?, 'ITEM_DB_01', 'Distribution Board 8-Way', 'DB-8W', 10, 2000, 20000, ?, ?, ?, ?, 'VERIFIED', ?),
  ('LINE_MCB_01', ?, 'ITEM_MCB_01', 'MCB 16A SP C-Curve', 'MCB-16A', 40, 300, 12000, ?, ?, ?, ?, 'VERIFIED', ?),
  ('LINE_RCCB_01', ?, 'ITEM_RCCB_01', 'RCCB 40A 30mA 4P', 'RCCB-40A', 10, 1800, 18000, ?, ?, ?, ?, 'VERIFIED', ?)
`).run(
  testBillId, testCustomerId, testCustomerName, testCustomerId, testCustomerName, now,
  testBillId, testCustomerId, testCustomerName, testCustomerId, testCustomerName, now,
  testBillId, testCustomerId, testCustomerName, testCustomerId, testCustomerName, now
);

// Insert test sales invoice for Finished Composite Item (10 BUN)
db.prepare(`
  INSERT INTO sales_invoices (
    invoice_id, organization_id, invoice_number, customer_id, customer_name, date, status, total, balance, synced_at
  ) VALUES ('TEST_INV_ASM_001', '774390949', 'INV-ASM-001', ?, ?, '2026-05-20', 'paid', 65000, 0, ?)
`).run(testCustomerId, testCustomerName, now);

db.prepare(`
  INSERT INTO sales_invoice_line_items (
    line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total,
    bbt_customer_id, bbt_customer_name, synced_at
  ) VALUES 
  ('LINE_INV_BUN_01', 'TEST_INV_ASM_001', 'ITEM_BUN_01', 'DB with Switchgear - BUN', 'DB-SWG-BUN', 10, 6500, 65000, ?, ?, ?)
`).run(testCustomerId, testCustomerName, now);

// ----------------------------------------------------
// TEST GROUP 1: Eligible Line Discovery & Isolation
// ----------------------------------------------------
console.log("--- TEST GROUP 1: Eligible Purchase Line Discovery ---");

test("Eligible Purchase Lines retrieved accurately for Customer", () => {
  const eligible = getEligibleComponentPurchaseLines(db, testCustomerId);
  assert.strictEqual(eligible.length, 3, "Must have 3 component purchase lines");

  const dbLine = eligible.find((l) => l.item_id === "ITEM_DB_01");
  assert.ok(dbLine, "DB line must exist");
  assert.strictEqual(dbLine?.available_qty, 10, "DB available qty must be 10");
  assert.strictEqual(dbLine?.purchase_rate, 2000, "DB purchase rate must be 2000");

  const mcbLine = eligible.find((l) => l.item_id === "ITEM_MCB_01");
  assert.ok(mcbLine, "MCB line must exist");
  assert.strictEqual(mcbLine?.available_qty, 40, "MCB available qty must be 40");
});

test("Isolation: Unrelated Customer has 0 eligible lines from this Bill", () => {
  const otherEligible = getEligibleComponentPurchaseLines(db, "UNRELATED_CUSTOMER_XYZ");
  const found = otherEligible.find((l) => l.bill_id === testBillId);
  assert.strictEqual(found, undefined, "Unrelated customer must not access component lines");
});

// ----------------------------------------------------
// TEST GROUP 2: Draft Creation & Material Reference Cost
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: Draft Creation & Material Reference Cost ---");

let testAssemblyId = "";

test("Create Composite Assembly Draft with Component Allocations", () => {
  const components: AssemblyComponentInput[] = [
    {
      source_bill_id: testBillId,
      source_bill_number: "BILL-ASM-9901",
      source_bill_date: "2026-05-10",
      source_bill_line_item_id: "LINE_DB_01",
      component_item_id: "ITEM_DB_01",
      component_item_name: "Distribution Board 8-Way",
      component_sku: "DB-8W",
      vendor_name: "Schneider Electric",
      raw_purchase_qty: 10,
      consumed_qty: 10,
      purchase_rate: 2000,
    },
    {
      source_bill_id: testBillId,
      source_bill_number: "BILL-ASM-9901",
      source_bill_date: "2026-05-10",
      source_bill_line_item_id: "LINE_MCB_01",
      component_item_id: "ITEM_MCB_01",
      component_item_name: "MCB 16A SP C-Curve",
      component_sku: "MCB-16A",
      vendor_name: "Schneider Electric",
      raw_purchase_qty: 40,
      consumed_qty: 40,
      purchase_rate: 300,
    },
    {
      source_bill_id: testBillId,
      source_bill_number: "BILL-ASM-9901",
      source_bill_date: "2026-05-10",
      source_bill_line_item_id: "LINE_RCCB_01",
      component_item_id: "ITEM_RCCB_01",
      component_item_name: "RCCB 40A 30mA 4P",
      component_sku: "RCCB-40A",
      vendor_name: "Schneider Electric",
      raw_purchase_qty: 10,
      consumed_qty: 10,
      purchase_rate: 1800,
    },
  ];

  const draft = createAssemblyDraft(db, {
    customerId: testCustomerId,
    customerName: testCustomerName,
    compositeItemId: "ITEM_BUN_01",
    compositeItemName: "DB with Switchgear - BUN",
    compositeSku: "DB-SWG-BUN",
    generatedQty: 10,
    unit: "BUN",
    assemblyDate: "2026-05-15",
    referenceNo: "REF-ASM-001",
    remarks: "Test manual assembly draft",
    components,
    createdBy: "Test Engineer",
  });

  assert.ok(draft.assembly_id, "Assembly ID must be generated");
  assert.ok(draft.assembly_number.startsWith("ASM-"), "Assembly number must follow ASM- prefix format");
  assert.strictEqual(draft.status, "DRAFT", "Initial status must be DRAFT");
  assert.strictEqual(draft.generated_qty, 10, "Generated qty must be 10");

  // Material Reference Cost Validation:
  // DB: 10 * 2000 = 20000
  // MCB: 40 * 300 = 12000
  // RCCB: 10 * 1800 = 18000
  // Total Material Cost = 50000
  // Cost Per BUN = 50000 / 10 = 5000
  assert.strictEqual(draft.total_material_cost, 50000, "Total Material Cost must equal sum of component lines (50000)");
  assert.strictEqual(draft.cost_per_unit, 5000, "Cost per BUN must equal 5000");

  testAssemblyId = draft.assembly_id;
});

test("DRAFT assembly does NOT affect active reconciliation yet", () => {
  const impact = getConfirmedAssemblyImpact(db, { customerId: testCustomerId });
  const custImpact = impact.get(testCustomerId.toLowerCase());
  assert.strictEqual(custImpact, undefined, "DRAFT assembly must not produce confirmed impact");
});

// ----------------------------------------------------
// TEST GROUP 3: Over-Consumption & Validation Blocking
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Over-consumption & Validation Rules ---");

test("Over-consumption beyond available raw purchase qty is rejected", () => {
  const overConsumingPayload = {
    customerId: testCustomerId,
    customerName: testCustomerName,
    compositeItemId: "ITEM_BUN_OVER",
    compositeItemName: "DB with Switchgear Over",
    generatedQty: 10,
    assemblyDate: "2026-05-15",
    components: [
      {
        source_bill_id: testBillId,
        source_bill_line_item_id: "LINE_DB_01",
        component_item_id: "ITEM_DB_01",
        component_item_name: "Distribution Board 8-Way",
        raw_purchase_qty: 10,
        consumed_qty: 25, // Available is only 10!
        purchase_rate: 2000,
      },
    ],
  };

  const overDraft = createAssemblyDraft(db, overConsumingPayload);
  assert.throws(
    () => {
      confirmAssembly(db, overDraft.assembly_id);
    },
    /Over-consumption rejected/,
    "Confirming assembly with consumed > available must throw error"
  );

  // Clean up overDraft
  db.prepare("DELETE FROM composite_assembly_components WHERE assembly_id = ?").run(overDraft.assembly_id);
  db.prepare("DELETE FROM composite_assembly_audit WHERE assembly_id = ?").run(overDraft.assembly_id);
  db.prepare("DELETE FROM composite_assemblies WHERE assembly_id = ?").run(overDraft.assembly_id);
});

// ----------------------------------------------------
// TEST GROUP 4: Confirmation & Non-Destructive Reconciliation
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: Confirmation & Non-Destructive Reconciliation ---");

test("Confirming Assembly succeeds and updates status", () => {
  const confirmed = confirmAssembly(db, testAssemblyId, "Test Verifier");
  assert.strictEqual(confirmed.status, "CONFIRMED", "Status must become CONFIRMED");
});

test("SOURCE DATA IMMUTABILITY: Original purchase bills & line items remain unchanged", () => {
  const rawLine = db
    .prepare("SELECT quantity, rate, line_total FROM purchase_bill_line_items WHERE line_item_id = 'LINE_DB_01'")
    .get() as { quantity: number; rate: number; line_total: number };

  assert.strictEqual(rawLine.quantity, 10, "Raw Purchase Bill Line Quantity MUST NEVER be modified");
  assert.strictEqual(rawLine.rate, 2000, "Raw Purchase Bill Line Rate MUST NEVER be modified");
  assert.strictEqual(rawLine.line_total, 20000, "Raw Purchase Bill Line Total MUST NEVER be modified");
});

test("Reconciliation Engine reflects Effective Purchase Qty and BUN Matching", () => {
  const custData = getCustomerDetailsData(db, {
    customerId: testCustomerId,
    financialYear: "2026-27",
  });

  assert.ok(custData, "Customer 360 data must load");
  const items = custData.itemAnalysis;

  // 1. Component items should have effective purchase qty reduced to 0 (all 10/40 consumed)
  const dbItem = items.find((i) => i.item_id === "ITEM_DB_01");
  assert.ok(dbItem, "DB Item must exist in analysis");
  assert.strictEqual(dbItem?.purchase_qty, 0, "DB effective purchase qty must be 0 (10 raw - 10 consumed)");
  assert.strictEqual(dbItem?.raw_purchase_qty, 10, "DB raw purchase qty must remain 10");
  assert.strictEqual(dbItem?.assembly_consumed_qty, 10, "DB assembly consumed qty must be 10");
  assert.strictEqual(dbItem?.is_component_consumed, true, "is_component_consumed flag must be true");

  const mcbItem = items.find((i) => i.item_id === "ITEM_MCB_01");
  assert.ok(mcbItem, "MCB Item must exist in analysis");
  assert.strictEqual(mcbItem?.purchase_qty, 0, "MCB effective purchase qty must be 0 (40 raw - 40 consumed)");
  assert.strictEqual(mcbItem?.assembly_consumed_qty, 40, "MCB assembly consumed qty must be 40");

  // 2. Finished Composite Item (DB with Switchgear - BUN)
  // Direct Raw Purchase = 0
  // Generated Composite = 10
  // Effective Purchase = 10
  // Sales Qty = 10
  // Balance = 0 (RECONCILED!)
  const bunItem = items.find((i) => i.item_id === "ITEM_BUN_01" || i.item_name === "DB with Switchgear - BUN");
  assert.ok(bunItem, "Composite BUN item must appear in analysis");
  assert.strictEqual(bunItem?.purchase_qty, 10, "Effective Purchase Qty must be 10 (0 direct + 10 generated)");
  assert.strictEqual(bunItem?.sales_qty, 10, "Sales Qty must be 10");
  assert.strictEqual(bunItem?.balance_qty, 0, "Balance Qty must be 0 (Fully Reconciled)");
  assert.strictEqual(bunItem?.yet_to_purchase, 0, "Yet to purchase must be 0");
  assert.strictEqual(bunItem?.status, "RECONCILED", "Composite Item Status must be RECONCILED");
  assert.strictEqual(bunItem?.latest_purchase_rate, 5000, "Material reference rate must be ₹5,000 / BUN");
});

// ----------------------------------------------------
// TEST GROUP 5: Reversal / Cancellation & Audit Log
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Reversal, Restoration & Audit Trail ---");

test("Assembly Reversal / Cancellation restores component availability", () => {
  const reversed = cancelOrReverseAssembly(db, testAssemblyId, "Test customer specification change", "Lead Auditor");
  assert.strictEqual(reversed.status, "CANCELLED", "Status must become CANCELLED");

  // Check eligible lines availability after reversal:
  const eligibleAfter = getEligibleComponentPurchaseLines(db, testCustomerId);
  const dbLineAfter = eligibleAfter.find((l) => l.item_id === "ITEM_DB_01");
  assert.strictEqual(dbLineAfter?.available_qty, 10, "DB available qty must be restored to 10");
  assert.strictEqual(dbLineAfter?.already_consumed_qty, 0, "Consumed qty must reset to 0");

  // Check Customer 360:
  const custDataAfter = getCustomerDetailsData(db, {
    customerId: testCustomerId,
    financialYear: "2026-27",
  });
  assert.ok(custDataAfter, "custDataAfter must load");

  const bunItemAfter = custDataAfter.itemAnalysis.find(
    (i) => i.item_id === "ITEM_BUN_01" || i.item_name === "DB with Switchgear - BUN"
  );
  // After reversal, BUN has 0 purchase qty and 10 sales -> Shortage
  assert.strictEqual(bunItemAfter?.purchase_qty, 0, "BUN purchase qty must return to 0 after reversal");
  assert.strictEqual(bunItemAfter?.status, "SALES ONLY", "BUN status must return to SALES ONLY");
});

test("Audit Trail records lifecycle from creation to reversal", () => {
  const detail = getAssemblyDetail(db, testAssemblyId);
  assert.ok(detail, "Assembly detail must load");

  const auditLogs = db
    .prepare("SELECT * FROM composite_assembly_audit WHERE assembly_id = ? ORDER BY created_at ASC")
    .all(testAssemblyId) as Array<{ action: string; actor: string; details: string }>;

  assert.ok(auditLogs.length >= 3, "Must have at least 3 audit log entries (CREATE_DRAFT, CONFIRM, REVERSE)");
  assert.strictEqual(auditLogs[0].action, "CREATE_DRAFT");
  assert.strictEqual(auditLogs[1].action, "CONFIRM");
  assert.strictEqual(auditLogs[2].action, "REVERSE");
});

// ----------------------------------------------------
// TEST GROUP 6: Excel & PDF Exports
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: Excel & PDF Export Builders ---");

test("buildCompositeAssemblyExcel generates valid OpenXML workbook buffer", () => {
  const asmList = getAssemblyList(db);
  const buf = buildCompositeAssemblyExcel(asmList.assemblies, asmList.summary, "FY 2026-27");
  assert.ok(Buffer.isBuffer(buf), "Must return Buffer");
  assert.ok(buf.length > 500, "Buffer must contain valid zip payload");
  // Check PKZip magic header (0x50, 0x4B)
  assert.strictEqual(buf[0], 0x50);
  assert.strictEqual(buf[1], 0x4B);
});

test("buildCompositeAssemblyPdf generates valid PDF 1.4 binary buffer", () => {
  const asmList = getAssemblyList(db);
  const buf = buildCompositeAssemblyPdf(asmList.assemblies, asmList.summary, "FY 2026-27");
  assert.ok(Buffer.isBuffer(buf), "Must return Buffer");
  assert.ok(buf.length > 500, "PDF buffer must contain content");
  const headerStr = buf.slice(0, 8).toString("utf-8");
  assert.ok(headerStr.startsWith("%PDF-1.4"), "Must start with %PDF-1.4 header");
});

// Cleanup test records
db.prepare("DELETE FROM composite_assembly_components WHERE customer_id = ?").run(testCustomerId);
db.prepare("DELETE FROM composite_assembly_audit WHERE assembly_id IN (SELECT assembly_id FROM composite_assemblies WHERE customer_id = ?)").run(testCustomerId);
db.prepare("DELETE FROM composite_assemblies WHERE customer_id = ?").run(testCustomerId);
db.prepare("DELETE FROM purchase_bills WHERE bill_id = ?").run(testBillId);
db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(testBillId);
db.prepare("DELETE FROM sales_invoices WHERE invoice_id = 'TEST_INV_ASM_001'").run();
db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id = 'TEST_INV_ASM_001'").run();

console.log("\n==================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
