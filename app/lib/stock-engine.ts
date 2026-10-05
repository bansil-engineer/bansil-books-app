// ============================================================
// Bansil Books Analytics — Stock Engine
// Item-wise Stock / Movement Analytics
// Primary Grain: Zoho Item ID
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS
// Business Rules:
//   1. All amounts = Taxable Value (Before GST) = line_total
//   2. Excluded items (reconciliation_exclusions status=ACTIVE) are hidden
//   3. Service items can appear (for classification visibility) but marked
//   4. Normal items: effectivePurchase = rawPurchase - assemblyConsumed
//   5. Composite items: effectivePurchase = directPurchase + assemblyGenerated
//   6. Stock = effectivePurchase - sales (negative allowed)
//   7. Unmapped purchases = lines with no customer identity
//   8. Unique purchase key: bill_id + line_item_id
//   9. Unique sales key: invoice_id + line_item_id
// ============================================================

import {
  getDatabase,
  getActiveExcludedItemIds,
  getClassifiedServiceItemIds,
} from "./db/database.ts";
import { resolveDateRange, parseFyToDateRange } from "./date-period-utils.ts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type StockStatus =
  | "IN_STOCK"
  | "ZERO_STOCK"
  | "NEGATIVE"
  | "PURCHASE_ONLY"
  | "SALES_ONLY"
  | "COMPOSITE"
  | "NO_MOVEMENT";

export interface StockSummaryRow {
  itemId: string;
  itemName: string;
  sku: string;
  classification: "MATERIAL" | "SERVICE" | "UNKNOWN";
  // Purchase side
  rawPurchaseQty: number;
  assemblyConsumedQty: number;
  assemblyGeneratedQty: number;
  effectivePurchaseQty: number;
  purchaseTaxableValue: number;
  // Sales side
  salesQty: number;
  salesTaxableValue: number;
  // Stock
  stockQty: number;
  approxStockValue: number | null;
  // Reference rates (latest)
  latestPurchaseRate: number | null;
  latestSalesRate: number | null;
  // Metrics
  customerCount: number;
  purchaseBillCount: number;
  salesInvoiceCount: number;
  lastPurchaseDate: string | null;
  lastSalesDate: string | null;
  // Flags
  status: StockStatus;
  isComposite: boolean;
  unmappedPurchaseQty: number;
}

export interface StockKPIs {
  totalActiveItems: number;
  totalPurchaseQty: number;
  totalSalesQty: number;
  totalStockQty: number;
  positiveStockItems: number;
  negativeStockItems: number;
  zeroStockItems: number;
  approxTotalStockValue: number;
  unmappedPurchaseQty: number;
  compositeItems: number;
  purchaseOnlyItems: number;
  salesOnlyItems: number;
}

export interface PurchaseLine {
  lineItemId: string;
  billId: string;
  billNumber: string;
  billDate: string;
  vendorId: string;
  vendorName: string;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string;
  description: string;
  quantity: number;
  rate: number;
  taxableValue: number;
  assemblyConsumedQty: number;
  availableQty: number;
  isMapped: boolean;
}

export interface SalesLine {
  lineItemId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string;
  description: string;
  quantity: number;
  rate: number;
  taxableValue: number;
}

export interface CustomerMovement {
  customerId: string;
  customerName: string;
  purchaseQty: number;
  salesQty: number;
  balanceQty: number;
  purchaseValue: number;
  salesValue: number;
}

export interface TimelineEntry {
  date: string;
  type: "PURCHASE" | "SALE" | "ASSEMBLY_CONSUMED" | "ASSEMBLY_GENERATED";
  documentId: string;
  documentNumber: string;
  party: string; // customer or vendor
  qtyIn: number;
  qtyOut: number;
  runningQty: number;
  rate: number;
  taxableValue: number;
}

export interface AssemblyImpactDetail {
  assemblyId: string;
  assemblyNumber: string;
  assemblyDate: string;
  customerName: string;
  compositeItemId: string;
  compositeItemName: string;
  generatedQty: number;
  consumedQty?: number;
  totalMaterialCost: number;
  costPerUnit: number;
  status: string;
}

export interface ItemStockDetail extends StockSummaryRow {
  purchaseLines: PurchaseLine[];
  salesLines: SalesLine[];
  customerMovements: CustomerMovement[];
  timeline: TimelineEntry[];
  assemblyConsumedDetails: AssemblyImpactDetail[];
  assemblyGeneratedDetails: AssemblyImpactDetail[];
  priceStats: {
    latestPurchaseEvidence: { billNumber: string; date: string; vendorName: string; qty: number; rate: number } | null;
    latestSalesEvidence: { invoiceNumber: string; date: string; customerName: string; qty: number; rate: number } | null;
    lowestPurchaseRate: number | null;
    highestPurchaseRate: number | null;
    weightedAvgPurchaseRate: number | null;
    lowestSalesRate: number | null;
    highestSalesRate: number | null;
    weightedAvgSalesRate: number | null;
  };
}

export interface StockFilter {
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  itemSearch?: string;
  classification?: "Material" | "Service" | "ALL" | "" | string;
  stockStatus?: string;
  customerId?: string;
  customerName?: string;
  vendorName?: string;
  sortBy?: "name" | "stockQty" | "purchaseQty" | "salesQty" | "lastPurchase" | "lastSales" | "stockValue";
  sortOrder?: "asc" | "desc";
}

export interface StockSummaryResult {
  items: StockSummaryRow[];
  totals: {
    totalPurchaseQty: number;
    totalSalesQty: number;
    totalStockQty: number;
    totalPurchaseValue: number;
    totalSalesValue: number;
    totalApproxStockValue: number;
  };
  kpis: StockKPIs;
  periodLabel: string;
  fromDate: string;
  toDate: string;
}

// ─────────────────────────────────────────────────────────────
// Helper: derive stock status
// ─────────────────────────────────────────────────────────────
function deriveStockStatus(row: {
  effectivePurchaseQty: number;
  salesQty: number;
  stockQty: number;
  isComposite: boolean;
}): StockStatus {
  if (row.isComposite) return "COMPOSITE";
  if (row.effectivePurchaseQty === 0 && row.salesQty === 0) return "NO_MOVEMENT";
  if (row.effectivePurchaseQty > 0 && row.salesQty === 0) return "PURCHASE_ONLY";
  if (row.effectivePurchaseQty === 0 && row.salesQty > 0) return "SALES_ONLY";
  if (row.stockQty > 0) return "IN_STOCK";
  if (row.stockQty === 0) return "ZERO_STOCK";
  return "NEGATIVE"; // stockQty < 0
}

// ─────────────────────────────────────────────────────────────
// Helper: get assembly impact for items (item-grain, not customer-grain)
// Returns Map<itemId_lower, { consumed: number; generated: number }>
// ─────────────────────────────────────────────────────────────
function getItemAssemblyImpact(
  db: ReturnType<typeof getDatabase>,
  fromDate: string,
  toDate: string
): Map<string, { consumed: number; generated: number }> {
  const result = new Map<string, { consumed: number; generated: number }>();

  // Components consumed (deduct from purchase qty)
  const consumed = db.prepare(`
    SELECT
      LOWER(COALESCE(cac.component_item_id, '')) as itemId,
      SUM(cac.consumed_qty) as totalConsumed
    FROM composite_assembly_components cac
    JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
    WHERE ca.status = 'CONFIRMED'
      AND ca.assembly_date >= ? AND ca.assembly_date <= ?
      AND cac.component_item_id IS NOT NULL AND cac.component_item_id != ''
    GROUP BY 1
  `).all(fromDate, toDate) as { itemId: string; totalConsumed: number }[];

  for (const row of consumed) {
    if (!result.has(row.itemId)) result.set(row.itemId, { consumed: 0, generated: 0 });
    result.get(row.itemId)!.consumed += row.totalConsumed;
  }

  // Composites generated (add to purchase qty for composite item)
  const generated = db.prepare(`
    SELECT
      LOWER(COALESCE(ca.composite_item_id, '')) as itemId,
      SUM(ca.generated_qty) as totalGenerated
    FROM composite_assemblies ca
    WHERE ca.status = 'CONFIRMED'
      AND ca.assembly_date >= ? AND ca.assembly_date <= ?
      AND ca.composite_item_id IS NOT NULL AND ca.composite_item_id != ''
    GROUP BY 1
  `).all(fromDate, toDate) as { itemId: string; totalGenerated: number }[];

  for (const row of generated) {
    if (!result.has(row.itemId)) result.set(row.itemId, { consumed: 0, generated: 0 });
    result.get(row.itemId)!.generated += row.totalGenerated;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Core: getStockSummary
// ─────────────────────────────────────────────────────────────
export function getStockSummary(filter: StockFilter = {}): StockSummaryResult {
  const db = getDatabase();
  const { fromDate, toDate } = resolveDateRange({
    financialYear: filter.financialYear,
    fromDate: filter.fromDate,
    toDate: filter.toDate,
  });

  const excludedItemIds = Array.from(getActiveExcludedItemIds(db));
  const serviceItemIds = getClassifiedServiceItemIds(db);
  const serviceIdSet = new Set(Array.from(serviceItemIds).map((s) => s.toLowerCase()));

  // Build exclusion SQL fragment
  const hasExclusions = excludedItemIds.length > 0;
  const exclusionClause = hasExclusions
    ? `AND LOWER(COALESCE(pli.item_id, '')) NOT IN (${excludedItemIds.map(() => "?").join(",")})`
    : "";
  const exclusionClauseSales = hasExclusions
    ? `AND LOWER(COALESCE(sli.item_id, '')) NOT IN (${excludedItemIds.map(() => "?").join(",")})`
    : "";
  const exclusionParamsPurch = hasExclusions ? excludedItemIds.map((id) => id.toLowerCase()) : [];
  const exclusionParamsSales = hasExclusions ? excludedItemIds.map((id) => id.toLowerCase()) : [];

  // ── Purchase aggregation by item ──
  const purchaseRows = db.prepare(`
    SELECT
      pli.item_id,
      pli.item_name,
      COALESCE(pli.sku, '') as sku,
      SUM(pli.quantity) as totalPurchaseQty,
      SUM(pli.line_total) as totalPurchaseValue,
      COUNT(DISTINCT pb.bill_id) as billCount,
      COUNT(DISTINCT COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '')) as customerCount,
      MAX(pb.date) as lastPurchaseDate,
      MAX(pb.date || '|' || CAST(pli.rate AS TEXT)) as lastRateRecord,
      SUM(CASE
        WHEN (COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') = ''
          AND COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') = '')
        THEN pli.quantity ELSE 0 END) as unmappedQty
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID','DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND pli.item_id IS NOT NULL AND pli.item_id != ''
      ${exclusionClause}
    GROUP BY pli.item_id, pli.item_name, pli.sku
  `).all(fromDate, toDate, ...exclusionParamsPurch) as {
    item_id: string; item_name: string; sku: string;
    totalPurchaseQty: number; totalPurchaseValue: number;
    billCount: number; customerCount: number;
    lastPurchaseDate: string; lastRateRecord: string;
    unmappedQty: number;
  }[];

  // ── Sales aggregation by item ──
  const salesRows = db.prepare(`
    SELECT
      sli.item_id,
      sli.item_name,
      COALESCE(sli.sku, '') as sku,
      SUM(sli.quantity) as totalSalesQty,
      SUM(sli.line_total) as totalSalesValue,
      COUNT(DISTINCT si.invoice_id) as invoiceCount,
      COUNT(DISTINCT COALESCE(si.customer_id, '')) as custCount,
      MAX(si.date) as lastSalesDate,
      MAX(si.date || '|' || CAST(sli.rate AS TEXT)) as lastSalesRateRecord
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID','DRAFT')
      AND si.date >= ? AND si.date <= ?
      AND sli.item_id IS NOT NULL AND sli.item_id != ''
      ${exclusionClauseSales}
    GROUP BY sli.item_id, sli.item_name, sli.sku
  `).all(fromDate, toDate, ...exclusionParamsSales) as {
    item_id: string; item_name: string; sku: string;
    totalSalesQty: number; totalSalesValue: number;
    invoiceCount: number; custCount: number;
    lastSalesDate: string; lastSalesRateRecord: string;
  }[];

  // ── Assembly impact ──
  const assemblyImpact = getItemAssemblyImpact(db, fromDate, toDate);

  // ── Composite item IDs (items that appear in composite_assemblies as composite_item_id) ──
  const compositeItemRows = db.prepare(`
    SELECT DISTINCT LOWER(COALESCE(composite_item_id,'')) as cid
    FROM composite_assemblies WHERE status = 'CONFIRMED'
  `).all() as { cid: string }[];
  const compositeItemIds = new Set(compositeItemRows.map((r) => r.cid));

  // ── Build merged item map ──
  const itemMap = new Map<string, StockSummaryRow>();

  for (const p of purchaseRows) {
    const key = (p.item_id || "").toLowerCase();
    const lastRate = (() => {
      // lastRateRecord = "YYYY-MM-DD|rate"
      const parts = (p.lastRateRecord || "").split("|");
      return parts.length >= 2 ? parseFloat(parts[1]) || null : null;
    })();
    const assembled = assemblyImpact.get(key) ?? { consumed: 0, generated: 0 };
    const isComp = compositeItemIds.has(key);
    const effPurchase = isComp
      ? p.totalPurchaseQty + assembled.generated
      : p.totalPurchaseQty - assembled.consumed;

    itemMap.set(key, {
      itemId: p.item_id,
      itemName: p.item_name,
      sku: p.sku,
      classification: serviceIdSet.has(key) ? "SERVICE" : "MATERIAL",
      rawPurchaseQty: p.totalPurchaseQty,
      assemblyConsumedQty: assembled.consumed,
      assemblyGeneratedQty: assembled.generated,
      effectivePurchaseQty: effPurchase,
      purchaseTaxableValue: p.totalPurchaseValue,
      salesQty: 0,
      salesTaxableValue: 0,
      stockQty: effPurchase,
      approxStockValue: null,
      latestPurchaseRate: lastRate,
      latestSalesRate: null,
      customerCount: p.customerCount,
      purchaseBillCount: p.billCount,
      salesInvoiceCount: 0,
      lastPurchaseDate: p.lastPurchaseDate || null,
      lastSalesDate: null,
      status: "PURCHASE_ONLY",
      isComposite: isComp,
      unmappedPurchaseQty: p.unmappedQty,
    });
  }

  for (const s of salesRows) {
    const key = (s.item_id || "").toLowerCase();
    const lastSalesRate = (() => {
      const parts = (s.lastSalesRateRecord || "").split("|");
      return parts.length >= 2 ? parseFloat(parts[1]) || null : null;
    })();

    if (itemMap.has(key)) {
      const existing = itemMap.get(key)!;
      existing.salesQty = s.totalSalesQty;
      existing.salesTaxableValue = s.totalSalesValue;
      existing.stockQty = existing.effectivePurchaseQty - s.totalSalesQty;
      existing.latestSalesRate = lastSalesRate;
      existing.salesInvoiceCount = s.invoiceCount;
      existing.lastSalesDate = s.lastSalesDate || null;
      existing.customerCount = Math.max(existing.customerCount, s.custCount);
    } else {
      const assembled = assemblyImpact.get(key) ?? { consumed: 0, generated: 0 };
      const isComp = compositeItemIds.has(key);
      const effPurchase = isComp ? assembled.generated : -assembled.consumed;
      itemMap.set(key, {
        itemId: s.item_id,
        itemName: s.item_name,
        sku: s.sku,
        classification: serviceIdSet.has(key) ? "SERVICE" : "MATERIAL",
        rawPurchaseQty: 0,
        assemblyConsumedQty: assembled.consumed,
        assemblyGeneratedQty: assembled.generated,
        effectivePurchaseQty: effPurchase,
        purchaseTaxableValue: 0,
        salesQty: s.totalSalesQty,
        salesTaxableValue: s.totalSalesValue,
        stockQty: effPurchase - s.totalSalesQty,
        approxStockValue: null,
        latestPurchaseRate: null,
        latestSalesRate: lastSalesRate,
        customerCount: s.custCount,
        purchaseBillCount: 0,
        salesInvoiceCount: s.invoiceCount,
        lastPurchaseDate: null,
        lastSalesDate: s.lastSalesDate || null,
        status: "SALES_ONLY",
        isComposite: isComp,
        unmappedPurchaseQty: 0,
      });
    }
  }

  // ── Compute approxStockValue and status for all rows ──
  const rows = Array.from(itemMap.values()).map((row) => {
    row.status = deriveStockStatus(row);
    if (row.stockQty > 0 && row.latestPurchaseRate !== null && row.latestPurchaseRate > 0) {
      row.approxStockValue = row.stockQty * row.latestPurchaseRate;
    }
    return row;
  });

  // ── Apply filters ──
  let filtered = rows;

  if (filter.itemSearch) {
    const term = filter.itemSearch.toLowerCase().trim();
    filtered = filtered.filter(
      (r) =>
        r.itemName.toLowerCase().includes(term) ||
        r.sku.toLowerCase().includes(term) ||
        r.itemId.toLowerCase().includes(term)
    );
  }

  if (filter.classification && (filter.classification as string) !== "ALL" && (filter.classification as string) !== "") {
    const cls = filter.classification.toUpperCase();
    filtered = filtered.filter((r) => r.classification === cls);
  }

  if (filter.stockStatus && filter.stockStatus !== "All" && filter.stockStatus !== "ALL") {
    const ss = filter.stockStatus.toUpperCase();
    filtered = filtered.filter((r) => {
      if (ss === "IN_STOCK") return r.stockQty > 0 && !r.isComposite;
      if (ss === "ZERO_STOCK") return r.stockQty === 0 && r.status === "ZERO_STOCK";
      if (ss === "NEGATIVE") return r.stockQty < 0;
      if (ss === "PURCHASE_ONLY") return r.status === "PURCHASE_ONLY";
      if (ss === "SALES_ONLY") return r.status === "SALES_ONLY";
      if (ss === "COMPOSITE") return r.isComposite;
      return true;
    });
  }

  // Customer/vendor filters would require per-line data — handled at API level for now
  // (filter by customer means "items purchased for this customer")
  if (filter.customerId || filter.customerName) {
    const custFilter = (filter.customerId || filter.customerName || "").toLowerCase();
    // Get item IDs that have purchase lines for this customer
    const custItems = db.prepare(`
      SELECT DISTINCT LOWER(COALESCE(pli.item_id, '')) as itemId
      FROM purchase_bill_line_items pli
      JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
      WHERE UPPER(pb.status) NOT IN ('VOID','DRAFT')
        AND pb.date >= ? AND pb.date <= ?
        AND (LOWER(COALESCE(pli.purchase_line_customer_id,'')) = ?
          OR LOWER(COALESCE(pli.purchase_line_customer_name,'')) = ?
          OR LOWER(COALESCE(pli.bbt_customer_id,'')) = ?
          OR LOWER(COALESCE(pli.bbt_customer_name,'')) = ?)
    `).all(fromDate, toDate, custFilter, custFilter, custFilter, custFilter) as { itemId: string }[];
    const custItemSet = new Set(custItems.map((r) => r.itemId));
    filtered = filtered.filter((r) => custItemSet.has(r.itemId.toLowerCase()));
  }

  if (filter.vendorName) {
    const vendFilter = filter.vendorName.toLowerCase();
    const vendItems = db.prepare(`
      SELECT DISTINCT LOWER(COALESCE(pli.item_id, '')) as itemId
      FROM purchase_bill_line_items pli
      JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
      WHERE UPPER(pb.status) NOT IN ('VOID','DRAFT')
        AND pb.date >= ? AND pb.date <= ?
        AND LOWER(COALESCE(pb.vendor_name,'')) = ?
    `).all(fromDate, toDate, vendFilter) as { itemId: string }[];
    const vendItemSet = new Set(vendItems.map((r) => r.itemId));
    filtered = filtered.filter((r) => vendItemSet.has(r.itemId.toLowerCase()));
  }

  // ── Sort ──
  const sortBy = filter.sortBy || "name";
  const sortAsc = (filter.sortOrder || "asc") === "asc";
  filtered.sort((a, b) => {
    let va: string | number = 0;
    let vb: string | number = 0;
    switch (sortBy) {
      case "name": va = a.itemName.toLowerCase(); vb = b.itemName.toLowerCase(); break;
      case "stockQty": va = a.stockQty; vb = b.stockQty; break;
      case "purchaseQty": va = a.effectivePurchaseQty; vb = b.effectivePurchaseQty; break;
      case "salesQty": va = a.salesQty; vb = b.salesQty; break;
      case "lastPurchase": va = a.lastPurchaseDate || ""; vb = b.lastPurchaseDate || ""; break;
      case "lastSales": va = a.lastSalesDate || ""; vb = b.lastSalesDate || ""; break;
      case "stockValue": va = a.approxStockValue ?? -Infinity; vb = b.approxStockValue ?? -Infinity; break;
    }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  // ── Totals ──
  const totals = {
    totalPurchaseQty: filtered.reduce((s, r) => s + r.effectivePurchaseQty, 0),
    totalSalesQty: filtered.reduce((s, r) => s + r.salesQty, 0),
    totalStockQty: filtered.reduce((s, r) => s + r.stockQty, 0),
    totalPurchaseValue: filtered.reduce((s, r) => s + r.purchaseTaxableValue, 0),
    totalSalesValue: filtered.reduce((s, r) => s + r.salesTaxableValue, 0),
    totalApproxStockValue: filtered.reduce((s, r) => s + (r.approxStockValue ?? 0), 0),
  };

  // ── KPIs (from full unfiltered dataset) ──
  const kpis: StockKPIs = {
    totalActiveItems: rows.length,
    totalPurchaseQty: rows.reduce((s, r) => s + r.effectivePurchaseQty, 0),
    totalSalesQty: rows.reduce((s, r) => s + r.salesQty, 0),
    totalStockQty: rows.reduce((s, r) => s + r.stockQty, 0),
    positiveStockItems: rows.filter((r) => r.stockQty > 0).length,
    negativeStockItems: rows.filter((r) => r.stockQty < 0).length,
    zeroStockItems: rows.filter((r) => r.stockQty === 0).length,
    approxTotalStockValue: rows.reduce((s, r) => s + (r.approxStockValue ?? 0), 0),
    unmappedPurchaseQty: rows.reduce((s, r) => s + r.unmappedPurchaseQty, 0),
    compositeItems: rows.filter((r) => r.isComposite).length,
    purchaseOnlyItems: rows.filter((r) => r.status === "PURCHASE_ONLY").length,
    salesOnlyItems: rows.filter((r) => r.status === "SALES_ONLY").length,
  };

  // ── Period label ──
  let periodLabel = "All Periods";
  if (filter.financialYear && filter.financialYear !== "ALL") {
    periodLabel = `FY ${filter.financialYear}`;
  } else if (filter.fromDate && filter.toDate) {
    periodLabel = `${filter.fromDate} to ${filter.toDate}`;
  }

  return { items: filtered, totals, kpis, periodLabel, fromDate, toDate };
}

// ─────────────────────────────────────────────────────────────
// Core: getItemStockDetail
// Full drill-down for one item
// ─────────────────────────────────────────────────────────────
export function getItemStockDetail(itemId: string, filter: StockFilter = {}): ItemStockDetail | null {
  const db = getDatabase();
  const { fromDate, toDate } = resolveDateRange({
    financialYear: filter.financialYear,
    fromDate: filter.fromDate,
    toDate: filter.toDate,
  });

  const excludedItemIds = Array.from(getActiveExcludedItemIds(db));
  const isExcluded = excludedItemIds.some(
    (eid) => eid.toLowerCase() === itemId.toLowerCase()
  );
  if (isExcluded) return null;

  const serviceItemIds = getClassifiedServiceItemIds(db);
  const serviceIdSet = new Set(Array.from(serviceItemIds).map((s) => s.toLowerCase()));
  const classification: "MATERIAL" | "SERVICE" | "UNKNOWN" = serviceIdSet.has(itemId.toLowerCase())
    ? "SERVICE"
    : "MATERIAL";

  // ── Purchase lines ──
  const purchaseLines = db.prepare(`
    SELECT
      pli.line_item_id,
      pb.bill_id,
      pb.bill_number,
      pb.date as billDate,
      pb.vendor_id,
      pb.vendor_name,
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as customerId,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customerName,
      pli.item_id,
      pli.item_name,
      COALESCE(pli.sku, '') as sku,
      COALESCE(pli.description, '') as description,
      pli.quantity,
      pli.rate,
      pli.line_total as taxableValue
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID','DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (LOWER(pli.item_id) = ? OR LOWER(pli.item_name) = LOWER(?))
    ORDER BY pb.date DESC, pb.bill_number DESC
  `).all(fromDate, toDate, itemId.toLowerCase(), itemId) as {
    line_item_id: string; bill_id: string; bill_number: string; billDate: string;
    vendor_id: string; vendor_name: string; customerId: string; customerName: string;
    item_id: string; item_name: string; sku: string; description: string;
    quantity: number; rate: number; taxableValue: number;
  }[];

  // ── Assembly consumed qty per purchase line ──
  const consumedByLine = new Map<string, number>();
  const consumedRows = db.prepare(`
    SELECT source_bill_line_item_id, SUM(consumed_qty) as totalConsumed
    FROM composite_assembly_components cac
    JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
    WHERE ca.status = 'CONFIRMED'
      AND LOWER(COALESCE(cac.component_item_id,'')) = ?
    GROUP BY source_bill_line_item_id
  `).all(itemId.toLowerCase()) as { source_bill_line_item_id: string; totalConsumed: number }[];
  for (const r of consumedRows) {
    consumedByLine.set(r.source_bill_line_item_id, r.totalConsumed);
  }

  const purchaseLinesResult: PurchaseLine[] = purchaseLines.map((p) => {
    const consumed = consumedByLine.get(p.line_item_id) || 0;
    return {
      lineItemId: p.line_item_id,
      billId: p.bill_id,
      billNumber: p.bill_number,
      billDate: p.billDate,
      vendorId: p.vendor_id || "",
      vendorName: p.vendor_name || "",
      customerId: p.customerId,
      customerName: p.customerName,
      itemId: p.item_id,
      itemName: p.item_name,
      sku: p.sku,
      description: p.description,
      quantity: p.quantity,
      rate: p.rate,
      taxableValue: p.taxableValue,
      assemblyConsumedQty: consumed,
      availableQty: Math.max(0, p.quantity - consumed),
      isMapped: !!(p.customerId || p.customerName),
    };
  });

  // ── Sales lines ──
  const salesLines = db.prepare(`
    SELECT
      sli.line_item_id,
      si.invoice_id,
      si.invoice_number,
      si.date as invoiceDate,
      si.customer_id as customerId,
      si.customer_name as customerName,
      sli.item_id,
      sli.item_name,
      COALESCE(sli.sku, '') as sku,
      COALESCE(sli.description, '') as description,
      sli.quantity,
      sli.rate,
      sli.line_total as taxableValue
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID','DRAFT')
      AND si.date >= ? AND si.date <= ?
      AND (LOWER(sli.item_id) = ? OR LOWER(sli.item_name) = LOWER(?))
    ORDER BY si.date DESC, si.invoice_number DESC
  `).all(fromDate, toDate, itemId.toLowerCase(), itemId) as {
    line_item_id: string; invoice_id: string; invoice_number: string; invoiceDate: string;
    customerId: string; customerName: string; item_id: string; item_name: string;
    sku: string; description: string; quantity: number; rate: number; taxableValue: number;
  }[];

  const salesLinesResult: SalesLine[] = salesLines.map((s) => ({
    lineItemId: s.line_item_id,
    invoiceId: s.invoice_id,
    invoiceNumber: s.invoice_number,
    invoiceDate: s.invoiceDate,
    customerId: s.customerId,
    customerName: s.customerName,
    itemId: s.item_id,
    itemName: s.item_name,
    sku: s.sku,
    description: s.description,
    quantity: s.quantity,
    rate: s.rate,
    taxableValue: s.taxableValue,
  }));

  // ── Customer-wise movement ──
  const custPurchMap = new Map<string, CustomerMovement>();
  for (const p of purchaseLinesResult) {
    if (!p.isMapped) continue;
    const key = p.customerId || p.customerName;
    if (!custPurchMap.has(key)) {
      custPurchMap.set(key, {
        customerId: p.customerId,
        customerName: p.customerName,
        purchaseQty: 0, salesQty: 0, balanceQty: 0,
        purchaseValue: 0, salesValue: 0,
      });
    }
    const cm = custPurchMap.get(key)!;
    cm.purchaseQty += p.quantity;
    cm.purchaseValue += p.taxableValue;
  }
  for (const s of salesLinesResult) {
    const key = s.customerId || s.customerName;
    if (!custPurchMap.has(key)) {
      custPurchMap.set(key, {
        customerId: s.customerId,
        customerName: s.customerName,
        purchaseQty: 0, salesQty: 0, balanceQty: 0,
        purchaseValue: 0, salesValue: 0,
      });
    }
    const cm = custPurchMap.get(key)!;
    cm.salesQty += s.quantity;
    cm.salesValue += s.taxableValue;
  }
  const customerMovements: CustomerMovement[] = Array.from(custPurchMap.values()).map((cm) => ({
    ...cm,
    balanceQty: cm.purchaseQty - cm.salesQty,
  })).sort((a, b) => b.purchaseQty - a.purchaseQty);

  // ── Assembly details ──
  const assemblyConsumedDetails: AssemblyImpactDetail[] = (db.prepare(`
    SELECT ca.assembly_id, ca.assembly_number, ca.assembly_date, ca.customer_name,
           ca.composite_item_id, ca.composite_item_name, ca.generated_qty,
           ca.total_material_cost, ca.cost_per_unit, ca.status,
           SUM(cac.consumed_qty) as consumedQty
    FROM composite_assembly_components cac
    JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
    WHERE ca.status = 'CONFIRMED'
      AND ca.assembly_date >= ? AND ca.assembly_date <= ?
      AND LOWER(COALESCE(cac.component_item_id,'')) = ?
    GROUP BY ca.assembly_id
    ORDER BY ca.assembly_date DESC
  `).all(fromDate, toDate, itemId.toLowerCase()) as any[]).map((r) => ({
    assemblyId: r.assembly_id,
    assemblyNumber: r.assembly_number,
    assemblyDate: r.assembly_date,
    customerName: r.customer_name,
    compositeItemId: r.composite_item_id,
    compositeItemName: r.composite_item_name,
    generatedQty: r.generated_qty,
    consumedQty: r.consumedQty,
    totalMaterialCost: r.total_material_cost,
    costPerUnit: r.cost_per_unit,
    status: r.status,
  }));

  const assemblyGeneratedDetails: AssemblyImpactDetail[] = (db.prepare(`
    SELECT assembly_id, assembly_number, assembly_date, customer_name,
           composite_item_id, composite_item_name, generated_qty,
           total_material_cost, cost_per_unit, status
    FROM composite_assemblies
    WHERE status = 'CONFIRMED'
      AND assembly_date >= ? AND assembly_date <= ?
      AND LOWER(COALESCE(composite_item_id,'')) = ?
    ORDER BY assembly_date DESC
  `).all(fromDate, toDate, itemId.toLowerCase()) as any[]).map((r) => ({
    assemblyId: r.assembly_id,
    assemblyNumber: r.assembly_number,
    assemblyDate: r.assembly_date,
    customerName: r.customer_name,
    compositeItemId: r.composite_item_id,
    compositeItemName: r.composite_item_name,
    generatedQty: r.generated_qty,
    totalMaterialCost: r.total_material_cost,
    costPerUnit: r.cost_per_unit,
    status: r.status,
  }));

  // ── Stock quantities ──
  const rawPurchaseQty = purchaseLinesResult.reduce((s, p) => s + p.quantity, 0);
  const assemblyConsumedQty = purchaseLinesResult.reduce((s, p) => s + p.assemblyConsumedQty, 0);
  const assemblyGeneratedQty = assemblyGeneratedDetails.reduce((s, d) => s + d.generatedQty, 0);
  const isComposite = assemblyGeneratedDetails.length > 0;
  const effectivePurchaseQty = isComposite
    ? rawPurchaseQty + assemblyGeneratedQty
    : rawPurchaseQty - assemblyConsumedQty;
  const salesQty = salesLinesResult.reduce((s, sl) => s + sl.quantity, 0);
  const stockQty = effectivePurchaseQty - salesQty;
  const purchaseTaxableValue = purchaseLinesResult.reduce((s, p) => s + p.taxableValue, 0);
  const salesTaxableValue = salesLinesResult.reduce((s, sl) => s + sl.taxableValue, 0);
  const unmappedPurchaseQty = purchaseLinesResult.filter((p) => !p.isMapped).reduce((s, p) => s + p.quantity, 0);

  // ── Latest rates ──
  const latestPurchaseRate = purchaseLinesResult.length > 0
    ? (purchaseLinesResult.sort((a, b) => b.billDate.localeCompare(a.billDate))[0]?.rate ?? null)
    : null;
  const latestSalesRate = salesLinesResult.length > 0
    ? (salesLinesResult.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))[0]?.rate ?? null)
    : null;
  const approxStockValue = stockQty > 0 && latestPurchaseRate ? stockQty * latestPurchaseRate : null;

  // ── Price statistics ──
  const purchaseRates = purchaseLinesResult.map((p) => ({ rate: p.rate, qty: p.quantity, value: p.taxableValue }));
  const salesRates = salesLinesResult.map((s) => ({ rate: s.rate, qty: s.quantity, value: s.taxableValue }));

  const latestPurchEvidence = purchaseLinesResult.length > 0
    ? (() => {
      const sorted = [...purchaseLinesResult].sort((a, b) => b.billDate.localeCompare(a.billDate));
      const latest = sorted[0];
      return { billNumber: latest.billNumber, date: latest.billDate, vendorName: latest.vendorName, qty: latest.quantity, rate: latest.rate };
    })()
    : null;

  const latestSalesEvidence = salesLinesResult.length > 0
    ? (() => {
      const sorted = [...salesLinesResult].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
      const latest = sorted[0];
      return { invoiceNumber: latest.invoiceNumber, date: latest.invoiceDate, customerName: latest.customerName, qty: latest.quantity, rate: latest.rate };
    })()
    : null;

  const priceStats = {
    latestPurchaseEvidence: latestPurchEvidence,
    latestSalesEvidence: latestSalesEvidence,
    lowestPurchaseRate: purchaseRates.length > 0 ? Math.min(...purchaseRates.map((r) => r.rate)) : null,
    highestPurchaseRate: purchaseRates.length > 0 ? Math.max(...purchaseRates.map((r) => r.rate)) : null,
    weightedAvgPurchaseRate:
      purchaseRates.length > 0
        ? purchaseRates.reduce((s, r) => s + r.value, 0) / purchaseRates.reduce((s, r) => s + r.qty, 0)
        : null,
    lowestSalesRate: salesRates.length > 0 ? Math.min(...salesRates.map((r) => r.rate)) : null,
    highestSalesRate: salesRates.length > 0 ? Math.max(...salesRates.map((r) => r.rate)) : null,
    weightedAvgSalesRate:
      salesRates.length > 0
        ? salesRates.reduce((s, r) => s + r.value, 0) / salesRates.reduce((s, r) => s + r.qty, 0)
        : null,
  };

  // ── Transaction timeline (chronological, newest first) ──
  let running = 0;
  const allEvents: Array<{ date: string; type: TimelineEntry["type"]; docId: string; docNum: string; party: string; qtyIn: number; qtyOut: number; rate: number; value: number }> = [];

  for (const p of purchaseLinesResult) {
    allEvents.push({ date: p.billDate, type: "PURCHASE", docId: p.billId, docNum: p.billNumber, party: p.vendorName || p.customerName, qtyIn: p.quantity, qtyOut: 0, rate: p.rate, value: p.taxableValue });
    if (p.assemblyConsumedQty > 0) {
      allEvents.push({ date: p.billDate, type: "ASSEMBLY_CONSUMED", docId: p.billId, docNum: p.billNumber, party: p.customerName, qtyIn: 0, qtyOut: p.assemblyConsumedQty, rate: p.rate, value: 0 });
    }
  }
  for (const s of salesLinesResult) {
    allEvents.push({ date: s.invoiceDate, type: "SALE", docId: s.invoiceId, docNum: s.invoiceNumber, party: s.customerName, qtyIn: 0, qtyOut: s.quantity, rate: s.rate, value: s.taxableValue });
  }
  for (const ag of assemblyGeneratedDetails) {
    allEvents.push({ date: ag.assemblyDate, type: "ASSEMBLY_GENERATED", docId: ag.assemblyId, docNum: ag.assemblyNumber, party: ag.customerName, qtyIn: ag.generatedQty, qtyOut: 0, rate: ag.costPerUnit, value: ag.totalMaterialCost });
  }

  // Sort oldest-first for running qty, then reverse for display newest-first
  allEvents.sort((a, b) => a.date.localeCompare(b.date));
  const timeline: TimelineEntry[] = allEvents.map((ev) => {
    running += ev.qtyIn - ev.qtyOut;
    return {
      date: ev.date,
      type: ev.type,
      documentId: ev.docId,
      documentNumber: ev.docNum,
      party: ev.party,
      qtyIn: ev.qtyIn,
      qtyOut: ev.qtyOut,
      runningQty: running,
      rate: ev.rate,
      taxableValue: ev.value,
    };
  }).reverse(); // Newest first for display

  const itemName = purchaseLinesResult[0]?.itemName || salesLinesResult[0]?.itemName || itemId;
  const sku = purchaseLinesResult[0]?.sku || salesLinesResult[0]?.sku || "";
  const lastPurchaseDate = purchaseLinesResult[0]?.billDate || null;
  const lastSalesDate = salesLinesResult[0]?.invoiceDate || null;
  const customerCount = Math.max(custPurchMap.size, 0);
  const status = deriveStockStatus({ effectivePurchaseQty, salesQty, stockQty, isComposite });

  return {
    itemId,
    itemName,
    sku,
    classification,
    rawPurchaseQty,
    assemblyConsumedQty,
    assemblyGeneratedQty,
    effectivePurchaseQty,
    purchaseTaxableValue,
    salesQty,
    salesTaxableValue,
    stockQty,
    approxStockValue,
    latestPurchaseRate,
    latestSalesRate,
    customerCount,
    purchaseBillCount: purchaseLinesResult.length > 0 ? new Set(purchaseLinesResult.map((p) => p.billId)).size : 0,
    salesInvoiceCount: salesLinesResult.length > 0 ? new Set(salesLinesResult.map((s) => s.invoiceId)).size : 0,
    lastPurchaseDate,
    lastSalesDate,
    status,
    isComposite,
    unmappedPurchaseQty,
    purchaseLines: purchaseLinesResult,
    salesLines: salesLinesResult,
    customerMovements,
    timeline,
    assemblyConsumedDetails,
    assemblyGeneratedDetails,
    priceStats,
  };
}

export { isStockItemExcludable } from "./stock-utils.ts";

