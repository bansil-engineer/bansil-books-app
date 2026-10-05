// ============================================================
// Bansil Books Analytics — Date-Wise Transaction Engine
// Strictly Read-Only · Zero Zoho API Calls · Local SQLite First
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import { getActiveExcludedItemIds } from "./db/database.ts";

export interface DatePurchaseRecord {
  lineItemId: string;
  billId: string;
  billNumber: string;
  date: string;
  vendorId: string;
  vendorName: string;
  customerId: string | null;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  quantity: number;
  rate: number;
  taxableValue: number;
  status: string;
}

export interface DateSalesRecord {
  lineItemId: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  quantity: number;
  rate: number;
  taxableValue: number;
  status: string;
}

export interface DateCombinedRecord {
  lineItemId: string;
  type: "PURCHASE" | "SALES";
  documentId: string;
  documentNumber: string;
  date: string;
  entityName: string; // Vendor or Customer
  entityId?: string | null;
  secondaryEntityName?: string | null; // e.g. Customer Details on Purchase Bill
  secondaryEntityId?: string | null;
  itemId: string;
  itemName: string;
  sku: string | null;
  quantity: number;
  rate: number;
  taxableValue: number;
  status: string;
}

export interface DateTransactionsResult {
  date: string; // YYYY-MM-DD
  itemIdFilter?: string | null;
  itemNameFilter?: string | null;
  hasItemFilter: boolean;
  totalMatchingRecords: number;
  kpis: {
    billCount: number;
    invoiceCount: number;
    totalLineItems: number;
    purchaseQty: number;
    purchaseValue: number;
    salesQty: number;
    salesValue: number;
  };
  all: DateCombinedRecord[];
  purchases: DatePurchaseRecord[];
  sales: DateSalesRecord[];
}

export function getDateTransactions(
  db: DatabaseSync,
  filter: {
    date: string; // Expected YYYY-MM-DD
    itemId?: string | null;
    itemName?: string | null;
    ignoreItemFilter?: boolean;
  }
): DateTransactionsResult {
  const { date, itemId, itemName, ignoreItemFilter } = filter;
  const excludedItemIds = Array.from(getActiveExcludedItemIds(db));

  // Build exclusion clauses
  const pbExclusionClause = excludedItemIds.length > 0
    ? `AND (pbli.item_id IS NULL OR pbli.item_id NOT IN (${excludedItemIds.map(() => "?").join(",")}))`
    : "";

  const siExclusionClause = excludedItemIds.length > 0
    ? `AND (sili.item_id IS NULL OR sili.item_id NOT IN (${excludedItemIds.map(() => "?").join(",")}))`
    : "";

  const applyItemFilter = !ignoreItemFilter && (!!itemId || !!itemName);

  let pbItemClause = "";
  const pbItemParams: string[] = [];
  if (applyItemFilter) {
    if (itemId) {
      pbItemClause = "AND pbli.item_id = ?";
      pbItemParams.push(itemId);
    } else if (itemName) {
      pbItemClause = "AND LOWER(pbli.item_name) = LOWER(?)";
      pbItemParams.push(itemName);
    }
  }

  let siItemClause = "";
  const siItemParams: string[] = [];
  if (applyItemFilter) {
    if (itemId) {
      siItemClause = "AND sili.item_id = ?";
      siItemParams.push(itemId);
    } else if (itemName) {
      siItemClause = "AND LOWER(sili.item_name) = LOWER(?)";
      siItemParams.push(itemName);
    }
  }

  // 1. Purchases on Date
  const purchasesQuery = `
    SELECT
      pbli.line_item_id,
      pb.bill_id,
      pb.bill_number,
      pb.date,
      pb.vendor_id,
      pb.vendor_name,
      COALESCE(pbli.purchase_line_customer_id, pbli.bbt_customer_id) as customer_id,
      COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name, 'UNMAPPED') as customer_name,
      pbli.item_id,
      pbli.item_name,
      pbli.sku,
      pbli.quantity,
      pbli.rate,
      pbli.line_total,
      pb.status
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    WHERE pb.date = ?
      ${pbExclusionClause}
      ${pbItemClause}
    ORDER BY pb.bill_number ASC, pbli.rowid ASC
  `;

  const rawPurchases = db.prepare(purchasesQuery).all(date, ...excludedItemIds, ...pbItemParams) as Array<{
    line_item_id: string;
    bill_id: string;
    bill_number: string;
    date: string;
    vendor_id: string;
    vendor_name: string;
    customer_id: string | null;
    customer_name: string;
    item_id: string;
    item_name: string;
    sku: string | null;
    quantity: number;
    rate: number;
    line_total: number;
    status: string;
  }>;

  const purchases: DatePurchaseRecord[] = rawPurchases.map((p) => ({
    lineItemId: p.line_item_id,
    billId: p.bill_id,
    billNumber: p.bill_number,
    date: p.date,
    vendorId: p.vendor_id,
    vendorName: p.vendor_name,
    customerId: p.customer_id || null,
    customerName: p.customer_name,
    itemId: p.item_id,
    itemName: p.item_name,
    sku: p.sku || null,
    quantity: Math.round(Number(p.quantity || 0) * 100) / 100,
    rate: Math.round(Number(p.rate || 0) * 100) / 100,
    taxableValue: Math.round(Number(p.line_total || 0) * 100) / 100,
    status: p.status || "OPEN",
  }));

  // 2. Sales on Date
  const salesQuery = `
    SELECT
      sili.line_item_id,
      si.invoice_id,
      si.invoice_number,
      si.date,
      si.customer_id,
      si.customer_name,
      sili.item_id,
      sili.item_name,
      sili.sku,
      sili.quantity,
      sili.rate,
      sili.line_total,
      si.status
    FROM sales_invoice_line_items sili
    JOIN sales_invoices si ON sili.invoice_id = si.invoice_id
    WHERE si.date = ?
      ${siExclusionClause}
      ${siItemClause}
    ORDER BY si.invoice_number ASC, sili.rowid ASC
  `;

  const rawSales = db.prepare(salesQuery).all(date, ...excludedItemIds, ...siItemParams) as Array<{
    line_item_id: string;
    invoice_id: string;
    invoice_number: string;
    date: string;
    customer_id: string;
    customer_name: string;
    item_id: string;
    item_name: string;
    sku: string | null;
    quantity: number;
    rate: number;
    line_total: number;
    status: string;
  }>;

  const sales: DateSalesRecord[] = rawSales.map((s) => ({
    lineItemId: s.line_item_id,
    invoiceId: s.invoice_id,
    invoiceNumber: s.invoice_number,
    date: s.date,
    customerId: s.customer_id,
    customerName: s.customer_name,
    itemId: s.item_id,
    itemName: s.item_name,
    sku: s.sku || null,
    quantity: Math.round(Number(s.quantity || 0) * 100) / 100,
    rate: Math.round(Number(s.rate || 0) * 100) / 100,
    taxableValue: Math.round(Number(s.line_total || 0) * 100) / 100,
    status: s.status || "OPEN",
  }));

  // 3. Combined All Records
  const all: DateCombinedRecord[] = [];

  for (const p of purchases) {
    all.push({
      lineItemId: p.lineItemId,
      type: "PURCHASE",
      documentId: p.billId,
      documentNumber: p.billNumber,
      date: p.date,
      entityName: p.vendorName,
      entityId: p.vendorId,
      secondaryEntityName: p.customerName !== "UNMAPPED" ? p.customerName : null,
      secondaryEntityId: p.customerId,
      itemId: p.itemId,
      itemName: p.itemName,
      sku: p.sku,
      quantity: p.quantity,
      rate: p.rate,
      taxableValue: p.taxableValue,
      status: p.status,
    });
  }

  for (const s of sales) {
    all.push({
      lineItemId: s.lineItemId,
      type: "SALES",
      documentId: s.invoiceId,
      documentNumber: s.invoiceNumber,
      date: s.date,
      entityName: s.customerName,
      entityId: s.customerId,
      secondaryEntityName: null,
      secondaryEntityId: null,
      itemId: s.itemId,
      itemName: s.itemName,
      sku: s.sku,
      quantity: s.quantity,
      rate: s.rate,
      taxableValue: s.taxableValue,
      status: s.status,
    });
  }

  // Sort by documentNumber
  all.sort((a, b) => a.documentNumber.localeCompare(b.documentNumber));

  // Distinct Bills & Invoices
  const distinctBillIds = new Set(purchases.map((p) => p.billId));
  const distinctInvoiceIds = new Set(sales.map((s) => s.invoiceId));

  const purchaseQty = Math.round(purchases.reduce((sum, p) => sum + p.quantity, 0) * 100) / 100;
  const purchaseValue = Math.round(purchases.reduce((sum, p) => sum + p.taxableValue, 0) * 100) / 100;
  const salesQty = Math.round(sales.reduce((sum, s) => sum + s.quantity, 0) * 100) / 100;
  const salesValue = Math.round(sales.reduce((sum, s) => sum + s.taxableValue, 0) * 100) / 100;

  return {
    date,
    itemIdFilter: applyItemFilter ? itemId : null,
    itemNameFilter: applyItemFilter ? itemName : null,
    hasItemFilter: applyItemFilter,
    totalMatchingRecords: all.length,
    kpis: {
      billCount: distinctBillIds.size,
      invoiceCount: distinctInvoiceIds.size,
      totalLineItems: all.length,
      purchaseQty,
      purchaseValue,
      salesQty,
      salesValue,
    },
    all,
    purchases,
    sales,
  };
}
