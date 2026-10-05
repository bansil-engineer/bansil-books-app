// ============================================================
// Bansil Books Analytics — Vendor Detail Engine
// Strictly Read-Only · Zero Zoho API Calls · Local SQLite First
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import { getActiveExcludedItemIds } from "./db/database.ts";
import { parseFyToDateRange } from "./date-period-utils.ts";

export interface VendorSummaryKPIs {
  purchaseBillCount: number;
  purchaseQty: number;
  purchaseTaxableValue: number;
  outstandingBalance: number;
  latestPurchaseDate: string | null;
  itemCount: number;
}

export interface VendorBillRow {
  billId: string;
  billNumber: string;
  date: string;
  itemCount: number;
  quantity: number;
  taxableValue: number;
  grandTotal: number;
  balance: number;
  status: string;
  billUrl?: string;
}

export interface VendorItemRow {
  itemId: string;
  itemName: string;
  sku: string | null;
  purchaseQty: number;
  latestRate: number;
  lowestRate: number;
  highestRate: number;
  weightedAverageRate: number;
  lastPurchaseDate: string | null;
}

export interface VendorPriceHistoryRow {
  billId: string;
  billNumber: string;
  date: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  quantity: number;
  rate: number;
  taxableValue: number;
}

export interface VendorCustomerSuppliedRow {
  customerId: string | null;
  customerName: string;
  itemCount: number;
  totalQty: number;
  totalTaxableValue: number;
  latestDate: string | null;
}

export interface VendorDetailResult {
  vendorId: string;
  vendorName: string;
  financialYear?: string;
  kpis: VendorSummaryKPIs;
  bills: VendorBillRow[];
  items: VendorItemRow[];
  priceHistory: VendorPriceHistoryRow[];
  customersSupplied: VendorCustomerSuppliedRow[];
}

export function getVendorDetail(
  db: DatabaseSync,
  filter: {
    vendorName?: string;
    vendorId?: string;
    financialYear?: string;
    fromDate?: string;
    toDate?: string;
  }
): VendorDetailResult | null {
  const { vendorName, vendorId, financialYear, fromDate, toDate } = filter;

  if (!vendorName && !vendorId) {
    return null;
  }

  // 1. Resolve Date Range
  let dateFilterSql = "";
  const dateParams: string[] = [];
  if (fromDate && toDate) {
    dateFilterSql = "AND pb.date >= ? AND pb.date <= ?";
    dateParams.push(fromDate, toDate);
  } else if (financialYear && financialYear !== "ALL") {
    const range = parseFyToDateRange(financialYear);
    if (range) {
      dateFilterSql = "AND pb.date >= ? AND pb.date <= ?";
      dateParams.push(range.fromDate, range.toDate);
    }
  }

  // 2. Identify Vendor Profile (Factual from SQLite only)
  let vendorRow: { vendor_id: string; vendor_name: string } | undefined;
  if (vendorId) {
    vendorRow = db.prepare(`
      SELECT vendor_id, vendor_name
      FROM purchase_bills
      WHERE vendor_id = ?
      LIMIT 1
    `).get(vendorId) as { vendor_id: string; vendor_name: string } | undefined;
  }
  if (!vendorRow && vendorName) {
    vendorRow = db.prepare(`
      SELECT vendor_id, vendor_name
      FROM purchase_bills
      WHERE LOWER(vendor_name) = LOWER(?)
      LIMIT 1
    `).get(vendorName) as { vendor_id: string; vendor_name: string } | undefined;
  }

  if (!vendorRow) {
    return null;
  }

  const vId = vendorRow.vendor_id;
  const vName = vendorRow.vendor_name;
  const excludedItemIds = Array.from(getActiveExcludedItemIds(db));

  // Build exclusion placeholders
  const exclusionClause = excludedItemIds.length > 0
    ? `AND (pbli.item_id IS NULL OR pbli.item_id NOT IN (${excludedItemIds.map(() => "?").join(",")}))`
    : "";

  // 3. Purchase Bills for this vendor
  const billsQuery = `
    SELECT
      pb.bill_id,
      pb.bill_number,
      pb.date,
      pb.status,
      pb.total as grand_total,
      pb.balance,
      pb.bill_url,
      COUNT(DISTINCT pbli.line_item_id) as item_count,
      COALESCE(SUM(pbli.quantity), 0) as total_qty,
      COALESCE(SUM(pbli.line_total), 0) as taxable_total
    FROM purchase_bills pb
    LEFT JOIN purchase_bill_line_items pbli
      ON pb.bill_id = pbli.bill_id ${exclusionClause}
    WHERE (pb.vendor_id = ? OR LOWER(pb.vendor_name) = LOWER(?))
      ${dateFilterSql}
    GROUP BY pb.bill_id
    ORDER BY pb.date DESC, pb.bill_number DESC
  `;

  const billParams = [...excludedItemIds, vId, vName, ...dateParams];
  const rawBills = db.prepare(billsQuery).all(...billParams) as Array<{
    bill_id: string;
    bill_number: string;
    date: string;
    status: string;
    grand_total: number;
    balance: number;
    bill_url?: string;
    item_count: number;
    total_qty: number;
    taxable_total: number;
  }>;

  const bills: VendorBillRow[] = rawBills.map((b) => ({
    billId: b.bill_id,
    billNumber: b.bill_number,
    date: b.date,
    itemCount: Number(b.item_count || 0),
    quantity: Math.round(Number(b.total_qty || 0) * 100) / 100,
    taxableValue: Math.round(Number(b.taxable_total || 0) * 100) / 100,
    grandTotal: Math.round(Number(b.grand_total || 0) * 100) / 100,
    balance: Math.round(Number(b.balance || 0) * 100) / 100,
    status: b.status || "OPEN",
    billUrl: b.bill_url || undefined,
  }));

  // 4. Items Purchased from this vendor
  const itemsQuery = `
    SELECT
      pbli.item_id,
      pbli.item_name,
      pbli.sku,
      SUM(pbli.quantity) as total_qty,
      SUM(pbli.line_total) as total_val,
      MIN(pbli.rate) as min_rate,
      MAX(pbli.rate) as max_rate,
      MAX(pb.date) as last_date
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    WHERE (pb.vendor_id = ? OR LOWER(pb.vendor_name) = LOWER(?))
      ${exclusionClause}
      ${dateFilterSql}
    GROUP BY pbli.item_id, pbli.item_name, pbli.sku
    HAVING SUM(pbli.quantity) > 0
    ORDER BY total_val DESC
  `;

  const itemParams = [vId, vName, ...excludedItemIds, ...dateParams];
  const rawItems = db.prepare(itemsQuery).all(...itemParams) as Array<{
    item_id: string;
    item_name: string;
    sku: string | null;
    total_qty: number;
    total_val: number;
    min_rate: number;
    max_rate: number;
    last_date: string | null;
  }>;

  // For each item, find latest purchase rate
  const latestRateStmt = db.prepare(`
    SELECT pbli.rate
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    WHERE (pb.vendor_id = ? OR LOWER(pb.vendor_name) = LOWER(?))
      AND pbli.item_name = ?
      ${exclusionClause}
      ${dateFilterSql}
    ORDER BY pb.date DESC, pb.bill_number DESC
    LIMIT 1
  `);

  const items: VendorItemRow[] = rawItems.map((it) => {
    const lRow = latestRateStmt.get(vId, vName, it.item_name, ...excludedItemIds, ...dateParams) as { rate: number } | undefined;
    const latestRate = lRow ? Number(lRow.rate || 0) : Number(it.max_rate || 0);
    const totalQty = Number(it.total_qty || 0);
    const totalVal = Number(it.total_val || 0);
    const weightedAvg = totalQty > 0 ? Math.round((totalVal / totalQty) * 100) / 100 : 0;

    return {
      itemId: it.item_id,
      itemName: it.item_name,
      sku: it.sku || null,
      purchaseQty: Math.round(totalQty * 100) / 100,
      latestRate: Math.round(latestRate * 100) / 100,
      lowestRate: Math.round(Number(it.min_rate || 0) * 100) / 100,
      highestRate: Math.round(Number(it.max_rate || 0) * 100) / 100,
      weightedAverageRate: weightedAvg,
      lastPurchaseDate: it.last_date || null,
    };
  });

  // 5. Price History Lines
  const priceHistoryQuery = `
    SELECT
      pb.bill_id,
      pb.bill_number,
      pb.date,
      pbli.item_id,
      pbli.item_name,
      pbli.sku,
      pbli.quantity,
      pbli.rate,
      pbli.line_total
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    WHERE (pb.vendor_id = ? OR LOWER(pb.vendor_name) = LOWER(?))
      ${exclusionClause}
      ${dateFilterSql}
    ORDER BY pb.date DESC, pb.bill_number DESC
    LIMIT 300
  `;
  const rawPriceLines = db.prepare(priceHistoryQuery).all(vId, vName, ...excludedItemIds, ...dateParams) as Array<{
    bill_id: string;
    bill_number: string;
    date: string;
    item_id: string;
    item_name: string;
    sku: string | null;
    quantity: number;
    rate: number;
    line_total: number;
  }>;

  const priceHistory: VendorPriceHistoryRow[] = rawPriceLines.map((p) => ({
    billId: p.bill_id,
    billNumber: p.bill_number,
    date: p.date,
    itemId: p.item_id,
    itemName: p.item_name,
    sku: p.sku || null,
    quantity: Math.round(Number(p.quantity || 0) * 100) / 100,
    rate: Math.round(Number(p.rate || 0) * 100) / 100,
    taxableValue: Math.round(Number(p.line_total || 0) * 100) / 100,
  }));

  // 6. Customers Supplied by this Vendor
  const customerSuppliedQuery = `
    SELECT
      COALESCE(pbli.purchase_line_customer_id, pbli.bbt_customer_id) as customer_id,
      COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name, 'UNMAPPED') as customer_name,
      COUNT(DISTINCT pbli.item_id) as item_count,
      SUM(pbli.quantity) as total_qty,
      SUM(pbli.line_total) as total_val,
      MAX(pb.date) as latest_date
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    WHERE (pb.vendor_id = ? OR LOWER(pb.vendor_name) = LOWER(?))
      ${exclusionClause}
      ${dateFilterSql}
    GROUP BY customer_id, customer_name
    ORDER BY total_val DESC
  `;
  const rawCustomers = db.prepare(customerSuppliedQuery).all(vId, vName, ...excludedItemIds, ...dateParams) as Array<{
    customer_id: string | null;
    customer_name: string;
    item_count: number;
    total_qty: number;
    total_val: number;
    latest_date: string | null;
  }>;

  const customersSupplied: VendorCustomerSuppliedRow[] = rawCustomers.map((c) => ({
    customerId: c.customer_id || null,
    customerName: c.customer_name || "UNMAPPED",
    itemCount: Number(c.item_count || 0),
    totalQty: Math.round(Number(c.total_qty || 0) * 100) / 100,
    totalTaxableValue: Math.round(Number(c.total_val || 0) * 100) / 100,
    latestDate: c.latest_date || null,
  }));

  // 7. KPIs Summary
  const purchaseBillCount = bills.length;
  const purchaseQty = Math.round(bills.reduce((sum, b) => sum + b.quantity, 0) * 100) / 100;
  const purchaseTaxableValue = Math.round(bills.reduce((sum, b) => sum + b.taxableValue, 0) * 100) / 100;
  const outstandingBalance = Math.round(bills.reduce((sum, b) => sum + b.balance, 0) * 100) / 100;
  const latestPurchaseDate = bills.length > 0 ? bills[0].date : null;
  const itemCount = items.length;

  return {
    vendorId: vId,
    vendorName: vName,
    financialYear,
    kpis: {
      purchaseBillCount,
      purchaseQty,
      purchaseTaxableValue,
      outstandingBalance,
      latestPurchaseDate,
      itemCount,
    },
    bills,
    items,
    priceHistory,
    customersSupplied,
  };
}
