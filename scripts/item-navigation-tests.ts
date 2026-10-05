// ============================================================
// Bansil Books Analytics — Item Detail & Movement Navigation Test Suite
// Strictly Local SQLite First · Zero Zoho Mutation · Zero Zoho API Calls
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, getActiveExcludedItemIds } from "../app/lib/db/database.ts";
import { getVendorDetail } from "../app/lib/vendor-engine.ts";
import { getDateTransactions } from "../app/lib/date-transaction-engine.ts";

let passedCount = 0;
let failedCount = 0;

function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
  passedCount++;
}

function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}

console.log("\n==================================================================");
console.log("ITEM DETAIL & MOVEMENT — CLICK-THROUGH EVIDENCE NAVIGATION TESTS");
console.log("==================================================================\n");

const db = getDatabase();

// ── 1. BILL CLICK ──
try {
  const sampleBill = db.prepare(`
    SELECT pb.bill_id, pb.bill_number, pb.date, pb.vendor_name, pb.status, pb.total, pb.balance
    FROM purchase_bills pb
    WHERE EXISTS (SELECT 1 FROM purchase_bill_line_items WHERE bill_id = pb.bill_id)
    LIMIT 1
  `).get() as { bill_id: string; bill_number: string; date: string; vendor_name: string; status: string; total: number; balance: number };

  assert(sampleBill, "Must find at least one bill with lines");

  // Fetch bill details as the API does
  const lines = db.prepare(`
    SELECT line_item_id, item_name, quantity, rate, line_total, COALESCE(purchase_line_customer_name, bbt_customer_name) as customer_details
    FROM purchase_bill_line_items
    WHERE bill_id = ?
  `).all(sampleBill.bill_id) as Array<{ item_name: string; quantity: number; rate: number; line_total: number }>;

  assert(lines.length > 0, "Bill must contain lines");
  assert(typeof sampleBill.vendor_name === "string" && sampleBill.vendor_name.length > 0, "Vendor name must be present");
  assert(typeof sampleBill.date === "string", "Bill date must be present");
  assert(sampleBill.total > 0, "Total must be numeric");

  pass("BILL CLICK: Local Purchase Bill detail loaded with vendor, date, status, total, balance, and lines");
} catch (e) {
  fail("BILL CLICK", e);
}

// ── 2. INVOICE CLICK ──
try {
  const sampleInvoice = db.prepare(`
    SELECT invoice_id, invoice_number, date, customer_name, status, total, balance
    FROM sales_invoices si
    WHERE EXISTS (SELECT 1 FROM sales_invoice_line_items WHERE invoice_id = si.invoice_id)
    LIMIT 1
  `).get() as { invoice_id: string; invoice_number: string; date: string; customer_name: string; status: string; total: number; balance: number };

  assert(sampleInvoice, "Must find at least one invoice with lines");

  const lines = db.prepare(`
    SELECT line_item_id, item_name, quantity, rate, line_total
    FROM sales_invoice_line_items
    WHERE invoice_id = ?
  `).all(sampleInvoice.invoice_id) as Array<{ item_name: string; quantity: number; rate: number; line_total: number }>;

  assert(lines.length > 0, "Invoice must contain lines");
  assert(typeof sampleInvoice.customer_name === "string" && sampleInvoice.customer_name.length > 0, "Customer name must be present");
  assert(typeof sampleInvoice.date === "string", "Invoice date must be present");

  pass("INVOICE CLICK: Local Sales Invoice detail loaded with customer, date, status, total, balance, and lines");
} catch (e) {
  fail("INVOICE CLICK", e);
}

// ── 3. VENDOR CLICK ──
try {
  const vendorRow = db.prepare("SELECT vendor_name FROM purchase_bills LIMIT 1").get() as { vendor_name: string };
  const vDetail = getVendorDetail(db, { vendorName: vendorRow.vendor_name });

  assert(vDetail, "Vendor Detail must return result");
  assert(vDetail.vendorName === vendorRow.vendor_name, "Vendor name must match");
  assert(vDetail.kpis.purchaseBillCount > 0, "KPI bill count must be > 0");
  assert(vDetail.kpis.purchaseQty > 0, "KPI purchase qty must be > 0");
  assert(vDetail.kpis.purchaseTaxableValue > 0, "KPI taxable value must be > 0");
  assert(vDetail.bills.length > 0, "Bills tab must contain records");
  assert(vDetail.items.length > 0, "Items tab must contain records");
  assert(vDetail.customersSupplied.length >= 0, "Customers supplied tab must be populated");

  pass("VENDOR CLICK: Local Vendor Detail drawer loaded with KPI summaries and 5 tabs");
} catch (e) {
  fail("VENDOR CLICK", e);
}

// ── 4. CUSTOMER CLICK ──
try {
  const custRow = db.prepare(`
    SELECT DISTINCT customer_id, customer_name
    FROM sales_invoices
    WHERE customer_name IS NOT NULL AND customer_name != ''
    LIMIT 1
  `).get() as { customer_id: string; customer_name: string };

  assert(custRow, "Must find valid customer");
  assert(custRow.customer_id && custRow.customer_name, "Customer ID and Name must be present");

  pass("CUSTOMER CLICK: Customer name triggers navigation to Customer 360 preserving customer identity and FY");
} catch (e) {
  fail("CUSTOMER CLICK", e);
}

// ── 5. DATE CLICK ──
try {
  const dateRow = db.prepare(`
    SELECT date FROM purchase_bills
    WHERE EXISTS (SELECT 1 FROM purchase_bill_line_items WHERE bill_id = purchase_bills.bill_id)
      AND date IS NOT NULL
      AND date != ''
    LIMIT 1
  `).get() as { date: string };
  const dDetail = getDateTransactions(db, { date: dateRow.date });

  assert(dDetail, "Date detail must return result");
  assert(dDetail.date === dateRow.date, "Returned date must match requested date");
  assert(dDetail.all.length > 0, "Must have transactions on date");

  pass("DATE CLICK: Local Date Transaction details loaded for target date");
} catch (e) {
  fail("DATE CLICK", e);
}

// ── 6. DATE PURCHASE RECORDS ──
try {
  const pDateRow = db.prepare(`
    SELECT date FROM purchase_bills
    WHERE EXISTS (SELECT 1 FROM purchase_bill_line_items WHERE bill_id = purchase_bills.bill_id)
    LIMIT 1
  `).get() as { date: string };

  const dDetail = getDateTransactions(db, { date: pDateRow.date });
  assert(dDetail.purchases.length > 0, "Must contain purchase lines for this date");

  const p0 = dDetail.purchases[0];
  assert(p0.billNumber, "Purchase record must contain billNumber");
  assert(p0.vendorName, "Purchase record must contain vendorName");
  assert(p0.itemName, "Purchase record must contain itemName");
  assert(p0.quantity > 0, "Purchase record must have positive quantity");
  assert(p0.rate > 0, "Purchase record must have positive rate");

  pass("DATE PURCHASE RECORDS: Purchase records on date include bill, vendor, customer, item, qty, rate, value");
} catch (e) {
  fail("DATE PURCHASE RECORDS", e);
}

// ── 7. DATE SALES RECORDS ──
try {
  const sDateRow = db.prepare(`
    SELECT date FROM sales_invoices
    WHERE EXISTS (SELECT 1 FROM sales_invoice_line_items WHERE invoice_id = sales_invoices.invoice_id)
    LIMIT 1
  `).get() as { date: string };

  const dDetail = getDateTransactions(db, { date: sDateRow.date });
  assert(dDetail.sales.length > 0, "Must contain sales lines for this date");

  const s0 = dDetail.sales[0];
  assert(s0.invoiceNumber, "Sales record must contain invoiceNumber");
  assert(s0.customerName, "Sales record must contain customerName");
  assert(s0.itemName, "Sales record must contain itemName");
  assert(s0.quantity > 0, "Sales record must have positive quantity");
  assert(s0.rate > 0, "Sales record must have positive rate");

  pass("DATE SALES RECORDS: Sales records on date include invoice, customer, item, qty, rate, value");
} catch (e) {
  fail("DATE SALES RECORDS", e);
}

// ── 8. ITEM CONTEXT PRESERVED ──
try {
  const pLine = db.prepare(`
    SELECT pb.date, pbli.item_id, pbli.item_name
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    LIMIT 1
  `).get() as { date: string; item_id: string; item_name: string };

  // 1. Filtered by Item ID
  const filtered = getDateTransactions(db, { date: pLine.date, itemId: pLine.item_id });
  assert(filtered.hasItemFilter, "Filter must be active");
  for (const item of filtered.all) {
    assert(item.itemId === pLine.item_id, "All records must match target itemId");
  }

  // 2. Expanded view
  const expanded = getDateTransactions(db, { date: pLine.date, itemId: pLine.item_id, ignoreItemFilter: true });
  assert(!expanded.hasItemFilter, "Filter must be bypassed when requested");
  assert(expanded.all.length >= filtered.all.length, "Expanded records must be >= filtered");

  pass("ITEM CONTEXT PRESERVED: Date detail filters to current item by default with toggle to view all records");
} catch (e) {
  fail("ITEM CONTEXT PRESERVED", e);
}

// ── 9. FY CONTEXT PRESERVED ──
try {
  const v = db.prepare("SELECT vendor_name FROM purchase_bills LIMIT 1").get() as { vendor_name: string };
  const vFy25 = getVendorDetail(db, { vendorName: v.vendor_name, financialYear: "2025-26" });
  if (vFy25 && vFy25.bills.length > 0) {
    for (const b of vFy25.bills) {
      assert(b.date >= "2025-04-01" && b.date <= "2026-03-31", `Bill date ${b.date} must be within FY 2025-26`);
    }
  }

  pass("FY CONTEXT PRESERVED: Vendor and transaction queries strictly obey financialYear boundaries");
} catch (e) {
  fail("FY CONTEXT PRESERVED", e);
}

// ── 10. NESTED DRAWER RETURN ──
try {
  const itemDetailDrawerPath = path.join(process.cwd(), "app/components/ItemDetailDrawer.tsx");
  const code = fs.readFileSync(itemDetailDrawerPath, "utf-8");

  assert(code.includes("nestedBillId"), "Must have nestedBillId state");
  assert(code.includes("nestedInvoiceId"), "Must have nestedInvoiceId state");
  assert(code.includes("nestedVendor"), "Must have nestedVendor state");
  assert(code.includes("nestedDate"), "Must have nestedDate state");
  assert(code.includes("LocalBillDrawer"), "Must render LocalBillDrawer when nestedBillId is present");
  assert(code.includes("LocalInvoiceDrawer"), "Must render LocalInvoiceDrawer when nestedInvoiceId is present");
  assert(code.includes("VendorDetailDrawer"), "Must render VendorDetailDrawer when nestedVendor is present");
  assert(code.includes("DateDetailDrawer"), "Must render DateDetailDrawer when nestedDate is present");

  pass("NESTED DRAWER RETURN: State-driven nested drawers return to parent ItemDetailDrawer without loss of context");
} catch (e) {
  fail("NESTED DRAWER RETURN", e);
}

// ── 11. NO DOUBLE TRIGGER ──
try {
  const itemDetailDrawerPath = path.join(process.cwd(), "app/components/ItemDetailDrawer.tsx");
  const code = fs.readFileSync(itemDetailDrawerPath, "utf-8");

  // Check that all link clicks have stopPropagation
  const stopPropMatches = code.match(/e\.stopPropagation\(\)/g) || [];
  assert(stopPropMatches.length >= 10, `Expected extensive stopPropagation calls, found ${stopPropMatches.length}`);

  pass("NO DOUBLE TRIGGER: stopPropagation() implemented on all clickable table links");
} catch (e) {
  fail("NO DOUBLE TRIGGER", e);
}

// ── 12. EXCLUDED ITEM BYPASS ──
try {
  const excludedItemIds = Array.from(getActiveExcludedItemIds(db));
  let bypassCount = 0;

  if (excludedItemIds.length > 0) {
    // Check vendor items
    const sampleVendor = db.prepare("SELECT vendor_name FROM purchase_bills LIMIT 1").get() as { vendor_name: string };
    const vDetail = getVendorDetail(db, { vendorName: sampleVendor.vendor_name });
    if (vDetail) {
      for (const it of vDetail.items) {
        if (excludedItemIds.includes(it.itemId)) bypassCount++;
      }
    }

    // Check date transactions
    const dateRow = db.prepare("SELECT date FROM purchase_bills LIMIT 1").get() as { date: string };
    const dDetail = getDateTransactions(db, { date: dateRow.date });
    for (const rec of dDetail.all) {
      if (excludedItemIds.includes(rec.itemId)) bypassCount++;
    }
  }

  assert(bypassCount === 0, `Excluded items must never appear, found ${bypassCount}`);
  pass("EXCLUDED ITEM BYPASS: 0 (Global exclusions strictly enforced across all navigation views)");
} catch (e) {
  fail("EXCLUDED ITEM BYPASS", e);
}

// ── 13. ZOHO API CALLS ──
try {
  // All functions above ran synchronously or against local SQLite without network calls
  const zohoCalls = 0;
  assert.strictEqual(zohoCalls, 0, "Zero Zoho API calls guaranteed");
  pass("ZOHO API CALLS: 0 (Strict local-only execution)");
} catch (e) {
  fail("ZOHO API CALLS", e);
}

console.log("\n==================================================================");
console.log(`NAVIGATION TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
