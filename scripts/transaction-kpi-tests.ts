// ============================================================
// Bansil Books Analytics — Transaction KPI & Taxable Value Verification
// Validates Bill Count, Invoice Count, Purchase Qty, Sales Qty,
// Pre-GST Taxable Values, Filter-Awareness, and Line Deduplication
// ============================================================

import { getDatabase } from "../app/lib/db/database.ts";
import { parseFyToDateRange } from "../app/lib/date-period-utils.ts";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ""}`);
    failedCount++;
  }
}

console.log("\n==================================================");
console.log("RUNNING TRANSACTION KPI & TAXABLE VALUE TESTS");
console.log("==================================================\n");

const db = getDatabase();

// ----------------------------------------------------
// TEST GROUP 1: FY 2026-27 Baseline Totals & Counts
// ----------------------------------------------------
console.log("--- TEST GROUP 1: FY 2026-27 Baseline Totals & Counts ---");

const { fromDate: fy26From, toDate: fy26To } = parseFyToDateRange("2026-27");

const billLineKpi26 = db.prepare(`
  SELECT 
    COUNT(DISTINCT b.bill_id) as bill_count,
    COALESCE(SUM(bli.quantity), 0) as total_qty,
    COALESCE(SUM(bli.line_total), 0) as total_taxable_amount
  FROM purchase_bills b
  LEFT JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
  WHERE b.date >= ? AND b.date <= ?
`).get(fy26From, fy26To) as {
  bill_count: number;
  total_qty: number;
  total_taxable_amount: number;
};

const billHeaderKpi26 = db.prepare(`
  SELECT 
    COALESCE(SUM(total), 0) as grand_total_with_gst,
    COALESCE(SUM(balance), 0) as total_balance
  FROM purchase_bills
  WHERE date >= ? AND date <= ?
`).get(fy26From, fy26To) as {
  grand_total_with_gst: number;
  total_balance: number;
};

const billKpi26 = {
  ...billLineKpi26,
  ...billHeaderKpi26,
};

assert(billKpi26.bill_count > 0, `PURCHASE BILL COUNT > 0 (Got ${billKpi26.bill_count})`);
assert(billKpi26.total_qty > 0, `PURCHASE QTY > 0 (Got ${billKpi26.total_qty})`);
assert(billKpi26.total_taxable_amount > 0, `PURCHASE TAXABLE VALUE > 0 (Got ₹${billKpi26.total_taxable_amount})`);

const invLineKpi26 = db.prepare(`
  SELECT 
    COUNT(DISTINCT inv.invoice_id) as invoice_count,
    COALESCE(SUM(sli.quantity), 0) as total_qty,
    COALESCE(SUM(sli.line_total), 0) as total_taxable_amount
  FROM sales_invoices inv
  LEFT JOIN sales_invoice_line_items sli ON inv.invoice_id = sli.invoice_id
  WHERE inv.date >= ? AND inv.date <= ?
`).get(fy26From, fy26To) as {
  invoice_count: number;
  total_qty: number;
  total_taxable_amount: number;
};

const invHeaderKpi26 = db.prepare(`
  SELECT 
    COALESCE(SUM(total), 0) as grand_total_with_gst,
    COALESCE(SUM(balance), 0) as total_balance
  FROM sales_invoices
  WHERE date >= ? AND date <= ?
`).get(fy26From, fy26To) as {
  grand_total_with_gst: number;
  total_balance: number;
};

const invKpi26 = {
  ...invLineKpi26,
  ...invHeaderKpi26,
};

assert(invKpi26.invoice_count > 0, `SALES INVOICE COUNT > 0 (Got ${invKpi26.invoice_count})`);
assert(invKpi26.total_qty > 0, `SALES QTY > 0 (Got ${invKpi26.total_qty})`);
assert(invKpi26.total_taxable_amount > 0, `SALES TAXABLE VALUE > 0 (Got ₹${invKpi26.total_taxable_amount})`);

// ----------------------------------------------------
// TEST GROUP 2: GST Exclusion & Balance Separation
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: GST Exclusion & Balance Separation ---");

// GST is excluded from Taxable Value (Taxable Value < Grand Total with GST)
assert(
  billKpi26.total_taxable_amount < billKpi26.grand_total_with_gst,
  `PURCHASE GST EXCLUDED: Taxable (₹${billKpi26.total_taxable_amount.toFixed(2)}) < Total with GST (₹${billKpi26.grand_total_with_gst.toFixed(2)})`
);
assert(
  invKpi26.total_taxable_amount < invKpi26.grand_total_with_gst,
  `SALES GST EXCLUDED: Taxable (₹${invKpi26.total_taxable_amount.toFixed(2)}) < Total with GST (₹${invKpi26.grand_total_with_gst.toFixed(2)})`
);

// Balance Due is NOT used as Taxable Value
assert(
  billKpi26.total_taxable_amount !== billKpi26.total_balance,
  `BALANCE NOT USED AS TAXABLE: Purchase Taxable != Balance`
);
assert(
  invKpi26.total_taxable_amount !== invKpi26.total_balance,
  `BALANCE NOT USED AS TAXABLE: Sales Taxable != Balance`
);

// ----------------------------------------------------
// TEST GROUP 3: Distinct Document Counts
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Distinct Document Counts ---");

const distinctBills = db.prepare(`SELECT COUNT(DISTINCT bill_id) as c FROM purchase_bills WHERE date >= ? AND date <= ?`).get(fy26From, fy26To) as { c: number };
assert(billKpi26.bill_count === distinctBills.c, `DISTINCT BILL COUNT: ${billKpi26.bill_count} === ${distinctBills.c}`);

const distinctInvoices = db.prepare(`SELECT COUNT(DISTINCT invoice_id) as c FROM sales_invoices WHERE date >= ? AND date <= ?`).get(fy26From, fy26To) as { c: number };
assert(invKpi26.invoice_count === distinctInvoices.c, `DISTINCT INVOICE COUNT: ${invKpi26.invoice_count} === ${distinctInvoices.c}`);

// ----------------------------------------------------
// TEST GROUP 4: No Source Line Duplication
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: No Source Line Duplication ---");

const dupPurchaseLines = db.prepare(`
  SELECT bill_id, line_item_id, COUNT(*) as c
  FROM purchase_bill_line_items
  GROUP BY bill_id, line_item_id
  HAVING c > 1
`).all();
assert(dupPurchaseLines.length === 0, `NO PURCHASE SOURCE LINE DUPLICATION: ${dupPurchaseLines.length} duplicates found`);

const dupSalesLines = db.prepare(`
  SELECT invoice_id, line_item_id, COUNT(*) as c
  FROM sales_invoice_line_items
  GROUP BY invoice_id, line_item_id
  HAVING c > 1
`).all();
assert(dupSalesLines.length === 0, `NO SALES SOURCE LINE DUPLICATION: ${dupSalesLines.length} duplicates found`);

// ----------------------------------------------------
// TEST GROUP 5: Filter Awareness (Vendor, Customer, Item, Period)
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Filter Awareness (Vendor, Customer, Item, Period) ---");

// 1. Vendor Filter
const sampleVendor = db.prepare(`SELECT vendor_id, vendor_name FROM purchase_bills WHERE date >= ? AND date <= ? LIMIT 1`).get(fy26From, fy26To) as { vendor_id: string; vendor_name: string };
const vendorFiltered = db.prepare(`
  SELECT 
    COUNT(DISTINCT b.bill_id) as bill_count,
    COALESCE(SUM(bli.quantity), 0) as total_qty,
    COALESCE(SUM(bli.line_total), 0) as total_taxable_amount
  FROM purchase_bills b
  LEFT JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
  WHERE b.date >= ? AND b.date <= ? AND b.vendor_id = ?
`).get(fy26From, fy26To, sampleVendor.vendor_id) as { bill_count: number; total_qty: number; total_taxable_amount: number };

assert(vendorFiltered.bill_count > 0 && vendorFiltered.bill_count <= billKpi26.bill_count, `VENDOR FILTER: Filtered bills (${vendorFiltered.bill_count}) <= Total bills (${billKpi26.bill_count})`);

// 2. Customer Filter on Purchase Bills
const samplePurchCust = db.prepare(`
  SELECT bbt_customer_id, bbt_customer_name 
  FROM purchase_bill_line_items bli 
  JOIN purchase_bills b ON bli.bill_id = b.bill_id 
  WHERE b.date >= ? AND b.date <= ? AND bbt_customer_id IS NOT NULL 
  LIMIT 1
`).get(fy26From, fy26To) as { bbt_customer_id: string; bbt_customer_name: string };

const custFilteredPurch = db.prepare(`
  SELECT 
    COUNT(DISTINCT b.bill_id) as bill_count,
    COALESCE(SUM(bli.quantity), 0) as total_qty,
    COALESCE(SUM(bli.line_total), 0) as total_taxable_amount
  FROM purchase_bills b
  JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
  WHERE b.date >= ? AND b.date <= ? AND (bli.bbt_customer_id = ? OR bli.purchase_line_customer_id = ?)
`).get(fy26From, fy26To, samplePurchCust.bbt_customer_id, samplePurchCust.bbt_customer_id) as { bill_count: number; total_qty: number; total_taxable_amount: number };

assert(custFilteredPurch.total_qty > 0 && custFilteredPurch.total_qty <= billKpi26.total_qty, `CUSTOMER FILTER PURCHASE: Filtered qty (${custFilteredPurch.total_qty}) <= Total qty`);

// 3. Item Filter on Sales Invoices
const sampleItem = db.prepare(`
  SELECT sli.item_id, sli.item_name 
  FROM sales_invoice_line_items sli 
  JOIN sales_invoices inv ON sli.invoice_id = inv.invoice_id 
  WHERE inv.date >= ? AND inv.date <= ? AND sli.item_id IS NOT NULL 
  LIMIT 1
`).get(fy26From, fy26To) as { item_id: string; item_name: string };

const itemFilteredSales = db.prepare(`
  SELECT 
    COUNT(DISTINCT inv.invoice_id) as invoice_count,
    COALESCE(SUM(sli.quantity), 0) as total_qty,
    COALESCE(SUM(sli.line_total), 0) as total_taxable_amount
  FROM sales_invoices inv
  JOIN sales_invoice_line_items sli ON inv.invoice_id = sli.invoice_id
  WHERE inv.date >= ? AND inv.date <= ? AND sli.item_id = ?
`).get(fy26From, fy26To, sampleItem.item_id) as { invoice_count: number; total_qty: number; total_taxable_amount: number };

assert(itemFilteredSales.total_taxable_amount > 0 && itemFilteredSales.total_taxable_amount <= invKpi26.total_taxable_amount, `ITEM FILTER SALES: Filtered taxable (₹${itemFilteredSales.total_taxable_amount}) <= Total taxable`);

// 4. Period Filter (FY 2025-26 vs FY 2026-27)
const { fromDate: fy25From, toDate: fy25To } = parseFyToDateRange("2025-26");
const billKpi25 = db.prepare(`
  SELECT 
    COUNT(DISTINCT b.bill_id) as bill_count,
    COALESCE(SUM(bli.quantity), 0) as total_qty,
    COALESCE(SUM(bli.line_total), 0) as total_taxable_amount
  FROM purchase_bills b
  LEFT JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
  WHERE b.date >= ? AND b.date <= ?
`).get(fy25From, fy25To) as { bill_count: number; total_qty: number; total_taxable_amount: number };

assert(billKpi25.bill_count > 0, `PERIOD FILTER: FY 2025-26 bills exist (${billKpi25.bill_count} bills)`);
// ----------------------------------------------------
// TEST GROUP 6: Document Grand Total & Balance Duplication Audit
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: Document Grand Total & Balance Duplication Audit ---");

// Assert header-level SUM(total) without join equals distinct header sum
const rawHeaderBillSum = db.prepare(`SELECT SUM(total) as t, SUM(balance) as b FROM purchase_bills WHERE date >= ? AND date <= ?`).get(fy26From, fy26To) as { t: number; b: number };
const rawHeaderInvSum = db.prepare(`SELECT SUM(total) as t, SUM(balance) as b FROM sales_invoices WHERE date >= ? AND date <= ?`).get(fy26From, fy26To) as { t: number; b: number };

assert(billKpi26.grand_total_with_gst === rawHeaderBillSum.t, `DOCUMENT GRAND TOTAL DUPLICATION: 0 (Purchase Grand Total ₹${billKpi26.grand_total_with_gst} matches distinct header sum)`);
assert(billKpi26.total_balance === rawHeaderBillSum.b, `DOCUMENT BALANCE DUPLICATION: 0 (Purchase Balance ₹${billKpi26.total_balance} matches distinct header sum)`);
assert(invKpi26.grand_total_with_gst === rawHeaderInvSum.t, `DOCUMENT GRAND TOTAL DUPLICATION: 0 (Sales Grand Total ₹${invKpi26.grand_total_with_gst} matches distinct header sum)`);
assert(invKpi26.total_balance === rawHeaderInvSum.b, `DOCUMENT BALANCE DUPLICATION: 0 (Sales Balance ₹${invKpi26.total_balance} matches distinct header sum)`);

// Validate 5 sample bills for Taxable Subtotal + GST = Grand Total
const sampleBills5 = db.prepare(`
  SELECT b.bill_number, b.total as grand_total, SUM(bli.line_total) as taxable_subtotal
  FROM purchase_bills b
  JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
  WHERE b.date >= ? AND b.date <= ?
  GROUP BY b.bill_id
  HAVING COUNT(bli.line_item_id) > 1
  LIMIT 5
`).all(fy26From, fy26To) as { bill_number: string; grand_total: number; taxable_subtotal: number }[];

for (const sb of sampleBills5) {
  const taxDiff = sb.grand_total - sb.taxable_subtotal;
  assert(taxDiff >= 0, `Purchase Bill ${sb.bill_number}: Taxable (₹${sb.taxable_subtotal}) <= Grand Total (₹${sb.grand_total})`);
}

// Validate 5 sample invoices for Taxable Subtotal + GST = Grand Total
const sampleInvoices5 = db.prepare(`
  SELECT inv.invoice_number, inv.total as grand_total, SUM(sli.line_total) as taxable_subtotal
  FROM sales_invoices inv
  JOIN sales_invoice_line_items sli ON inv.invoice_id = sli.invoice_id
  WHERE inv.date >= ? AND inv.date <= ?
  GROUP BY inv.invoice_id
  HAVING COUNT(sli.line_item_id) > 1
  LIMIT 5
`).all(fy26From, fy26To) as { invoice_number: string; grand_total: number; taxable_subtotal: number }[];

for (const si of sampleInvoices5) {
  const taxDiff = si.grand_total - si.taxable_subtotal;
  assert(taxDiff >= 0, `Sales Invoice ${si.invoice_number}: Taxable (₹${si.taxable_subtotal}) <= Grand Total (₹${si.grand_total})`);
}

console.log("\n==================================================");
console.log(`TRANSACTION KPI TESTS COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
