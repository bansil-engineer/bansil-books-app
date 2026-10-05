// ============================================================
// Bansil Books Analytics — Price Reference Engine
// Historical Purchase & Sales Price Evidence from Local SQLite
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS
// Business Rules:
// 1. All amounts = Taxable Value (Before GST)
// 2. Weighted Average Price = SUM(Line Taxable) / SUM(Line Qty)
// 3. Effective Net Rate = Line Taxable / Line Qty
// 4. Global Exclusion Rule: Excluded Items = 0
// 5. Customer Details: Line-level customer for Purchase
// ============================================================

import { getDatabase } from "./db/database.ts";
import { parseFyToDateRange } from "./date-period-utils.ts";

export interface PriceEvidence {
  document_type: "PURCHASE" | "SALES";
  line_item_id: string;
  document_id: string;
  document_number: string;
  date: string;
  vendor_id?: string;
  vendor_name?: string;
  customer_id?: string;
  customer_name?: string;
  item_id: string;
  item_name: string;
  sku?: string;
  description?: string;
  quantity: number;
  source_rate: number;
  effective_rate: number;
  taxable_amount: number;
  url?: string;
}

export interface PriceStatWithEvidence {
  rate: number | null;
  effective_rate: number | null;
  evidence: PriceEvidence | null;
}

export interface PriceReferenceSummaryStats {
  // Purchase side
  latest_purchase: PriceStatWithEvidence;
  lowest_purchase: PriceStatWithEvidence;
  highest_purchase: PriceStatWithEvidence;
  weighted_avg_purchase: number | null;
  purchase_transactions_count: number;
  purchase_distinct_docs_count: number;
  purchase_total_qty: number;
  purchase_total_taxable: number;

  // Sales side
  latest_sales: PriceStatWithEvidence;
  lowest_sales: PriceStatWithEvidence;
  highest_sales: PriceStatWithEvidence;
  weighted_avg_sales: number | null;
  sales_transactions_count: number;
  sales_distinct_docs_count: number;
  sales_total_qty: number;
  sales_total_taxable: number;

  // Comparison
  gross_price_spread: number | null; // Latest Sales Rate - Latest Purchase Rate
  markup_percentage: number | null; // ((Sales Rate - Purchase Rate) / Purchase Rate) * 100
}

export interface PriceReferenceQueryOptions {
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  priceType?: "PURCHASE" | "SALES" | "ALL";
  itemId?: string;
  sku?: string;
  customerId?: string;
  vendorId?: string;
  priceFilter?: "ALL" | "LOWEST" | "HIGHEST" | "LATEST";
  search?: string;
  sort?: "NEWEST" | "OLDEST" | "PRICE_DESC" | "PRICE_ASC" | "QTY_DESC";
}

export interface PriceReferenceResult {
  stats: PriceReferenceSummaryStats;
  history: PriceEvidence[];
  chartData: Array<{
    date: string;
    type: "PURCHASE" | "SALES";
    rate: number;
    effective_rate: number;
    quantity: number;
    document_number: string;
    party: string;
  }>;
  filterOptions: {
    items: Array<{ id: string; name: string; sku?: string }>;
    customers: Array<{ id: string; name: string }>;
    vendors: Array<{ id: string; name: string }>;
  };
  totalRecords: number;
  appliedFilter: {
    financialYear: string;
    fromDate?: string;
    toDate?: string;
    priceType: "PURCHASE" | "SALES" | "ALL";
    itemId?: string;
    sku?: string;
    customerId?: string;
    vendorId?: string;
    priceFilter: "ALL" | "LOWEST" | "HIGHEST" | "LATEST";
    search?: string;
    sort: string;
  };
}

export function getPriceReferenceData(options: PriceReferenceQueryOptions = {}): PriceReferenceResult {
  const db = getDatabase();

  const financialYear = options.financialYear || "2026-27";
  const priceType = options.priceType || "ALL";
  const itemId = options.itemId || "";
  const customerId = options.customerId || "";
  const vendorId = options.vendorId || "";
  const priceFilter = options.priceFilter || "ALL";
  const search = (options.search || "").trim().toLowerCase();
  const sort = options.sort || "NEWEST";

  // Resolve date range
  let fromDate: string | undefined;
  let toDate: string | undefined;

  if (financialYear === "CUSTOM" && options.fromDate && options.toDate) {
    fromDate = options.fromDate;
    toDate = options.toDate;
  } else if (financialYear !== "ALL") {
    const range = parseFyToDateRange(financialYear);
    fromDate = range.fromDate;
    toDate = range.toDate;
  }

  // 1. Fetch available filter options (excluding active exclusions)
  const itemsRows = db.prepare(`
    SELECT DISTINCT item_id, item_name, sku
    FROM (
      SELECT bli.item_id, bli.item_name, bli.sku
      FROM purchase_bill_line_items bli
      WHERE bli.item_id IS NOT NULL AND bli.item_id != ''
        AND bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL)
      UNION
      SELECT sli.item_id, sli.item_name, sli.sku
      FROM sales_invoice_line_items sli
      WHERE sli.item_id IS NOT NULL AND sli.item_id != ''
        AND sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL)
    )
    ORDER BY item_name ASC
  `).all() as Array<{ item_id: string; item_name: string; sku?: string }>;

  const customersRows = db.prepare(`
    SELECT DISTINCT customer_id, customer_name
    FROM (
      SELECT inv.customer_id, inv.customer_name
      FROM sales_invoices inv
      WHERE inv.customer_id IS NOT NULL AND inv.customer_name IS NOT NULL AND inv.customer_name != ''
      UNION
      SELECT COALESCE(bli.purchase_line_customer_id, bli.bbt_customer_id) as customer_id,
             COALESCE(bli.purchase_line_customer_name, bli.bbt_customer_name) as customer_name
      FROM purchase_bill_line_items bli
      WHERE COALESCE(bli.purchase_line_customer_name, bli.bbt_customer_name) IS NOT NULL
        AND COALESCE(bli.purchase_line_customer_name, bli.bbt_customer_name) != ''
    )
    ORDER BY customer_name ASC
  `).all() as Array<{ customer_id: string; customer_name: string }>;

  const vendorsRows = db.prepare(`
    SELECT DISTINCT vendor_id, vendor_name
    FROM purchase_bills
    WHERE vendor_id IS NOT NULL AND vendor_name IS NOT NULL AND vendor_name != ''
    ORDER BY vendor_name ASC
  `).all() as Array<{ vendor_id: string; vendor_name: string }>;

  // 2. Fetch PURCHASE history lines
  const purchaseLines: PriceEvidence[] = [];
  if (priceType === "PURCHASE" || priceType === "ALL") {
    const pWhere: string[] = [
      "(bli.item_id IS NULL OR bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))",
    ];
    const pParams: (string | number)[] = [];

    if (fromDate && toDate) {
      pWhere.push("b.date >= ? AND b.date <= ?");
      pParams.push(fromDate, toDate);
    }

    if (itemId) {
      pWhere.push("bli.item_id = ?");
      pParams.push(itemId);
    }

    if (vendorId) {
      pWhere.push("b.vendor_id = ?");
      pParams.push(vendorId);
    }

    if (customerId) {
      pWhere.push("(bli.purchase_line_customer_id = ? OR bli.bbt_customer_id = ? OR bli.purchase_line_customer_name = ? OR bli.bbt_customer_name = ?)");
      pParams.push(customerId, customerId, customerId, customerId);
    }

    if (search) {
      pWhere.push(`(
        LOWER(b.bill_number) LIKE ? 
        OR LOWER(b.vendor_name) LIKE ? 
        OR LOWER(COALESCE(bli.purchase_line_customer_name, bli.bbt_customer_name, '')) LIKE ? 
        OR LOWER(bli.item_name) LIKE ? 
        OR LOWER(COALESCE(bli.sku, '')) LIKE ? 
        OR LOWER(COALESCE(bli.description, '')) LIKE ?
      )`);
      const s = `%${search}%`;
      pParams.push(s, s, s, s, s, s);
    }

    const pQuery = `
      SELECT 
        bli.line_item_id,
        b.bill_id,
        b.bill_number,
        b.date,
        b.vendor_id,
        b.vendor_name,
        COALESCE(bli.purchase_line_customer_id, bli.bbt_customer_id) AS customer_id,
        COALESCE(bli.purchase_line_customer_name, bli.bbt_customer_name) AS customer_name,
        bli.item_id,
        bli.item_name,
        bli.sku,
        bli.description,
        bli.quantity,
        bli.rate AS source_rate,
        bli.line_total AS taxable_amount,
        b.bill_url AS url
      FROM purchase_bill_line_items bli
      JOIN purchase_bills b ON b.bill_id = bli.bill_id
      WHERE ${pWhere.join(" AND ")}
      ORDER BY b.date DESC, b.bill_number DESC, bli.line_item_id DESC
    `;

    const pRows = db.prepare(pQuery).all(...pParams) as Record<string, unknown>[];
    for (const r of pRows) {
      const qty = Number(r.quantity || 0);
      const taxable = Number(r.taxable_amount || 0);
      const sRate = Number(r.source_rate || 0);
      const effRate = qty > 0 ? Math.round((taxable / qty) * 100) / 100 : sRate;

      purchaseLines.push({
        document_type: "PURCHASE",
        line_item_id: String(r.line_item_id),
        document_id: String(r.bill_id),
        document_number: String(r.bill_number),
        date: String(r.date),
        vendor_id: r.vendor_id ? String(r.vendor_id) : undefined,
        vendor_name: String(r.vendor_name || "—"),
        customer_id: r.customer_id ? String(r.customer_id) : undefined,
        customer_name: r.customer_name ? String(r.customer_name) : "—",
        item_id: String(r.item_id),
        item_name: String(r.item_name),
        sku: r.sku ? String(r.sku) : undefined,
        description: r.description ? String(r.description) : undefined,
        quantity: qty,
        source_rate: sRate,
        effective_rate: effRate,
        taxable_amount: taxable,
        url: r.url ? String(r.url) : undefined,
      });
    }
  }

  // 3. Fetch SALES history lines
  const salesLines: PriceEvidence[] = [];
  if (priceType === "SALES" || priceType === "ALL") {
    const sWhere: string[] = [
      "(sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))",
    ];
    const sParams: (string | number)[] = [];

    if (fromDate && toDate) {
      sWhere.push("inv.date >= ? AND inv.date <= ?");
      sParams.push(fromDate, toDate);
    }

    if (itemId) {
      sWhere.push("sli.item_id = ?");
      sParams.push(itemId);
    }

    // Vendor filter does not apply to Sales
    if (customerId) {
      sWhere.push("(inv.customer_id = ? OR inv.customer_name = ?)");
      sParams.push(customerId, customerId);
    }

    if (search) {
      sWhere.push(`(
        LOWER(inv.invoice_number) LIKE ? 
        OR LOWER(inv.customer_name) LIKE ? 
        OR LOWER(sli.item_name) LIKE ? 
        OR LOWER(COALESCE(sli.sku, '')) LIKE ? 
        OR LOWER(COALESCE(sli.description, '')) LIKE ?
      )`);
      const s = `%${search}%`;
      sParams.push(s, s, s, s, s);
    }

    const sQuery = `
      SELECT 
        sli.line_item_id,
        inv.invoice_id,
        inv.invoice_number,
        inv.date,
        inv.customer_id,
        inv.customer_name,
        sli.item_id,
        sli.item_name,
        sli.sku,
        sli.description,
        sli.quantity,
        sli.rate AS source_rate,
        sli.line_total AS taxable_amount,
        inv.invoice_url AS url
      FROM sales_invoice_line_items sli
      JOIN sales_invoices inv ON inv.invoice_id = sli.invoice_id
      WHERE ${sWhere.join(" AND ")}
      ORDER BY inv.date DESC, inv.invoice_number DESC, sli.line_item_id DESC
    `;

    const sRows = db.prepare(sQuery).all(...sParams) as Record<string, unknown>[];
    for (const r of sRows) {
      const qty = Number(r.quantity || 0);
      const taxable = Number(r.taxable_amount || 0);
      const sRate = Number(r.source_rate || 0);
      const effRate = qty > 0 ? Math.round((taxable / qty) * 100) / 100 : sRate;

      salesLines.push({
        document_type: "SALES",
        line_item_id: String(r.line_item_id),
        document_id: String(r.invoice_id),
        document_number: String(r.invoice_number),
        date: String(r.date),
        customer_id: r.customer_id ? String(r.customer_id) : undefined,
        customer_name: String(r.customer_name || "—"),
        item_id: String(r.item_id),
        item_name: String(r.item_name),
        sku: r.sku ? String(r.sku) : undefined,
        description: r.description ? String(r.description) : undefined,
        quantity: qty,
        source_rate: sRate,
        effective_rate: effRate,
        taxable_amount: taxable,
        url: r.url ? String(r.url) : undefined,
      });
    }
  }

  // 4. Calculate Purchase Statistics (Filtered for statistical validity: qty > 0 and effective_rate > 0)
  const validPurchaseLines = purchaseLines.filter((l) => l.quantity > 0 && l.effective_rate > 0);
  
  let latestPurchase: PriceStatWithEvidence = { rate: null, effective_rate: null, evidence: null };
  let lowestPurchase: PriceStatWithEvidence = { rate: null, effective_rate: null, evidence: null };
  let highestPurchase: PriceStatWithEvidence = { rate: null, effective_rate: null, evidence: null };
  let weightedAvgPurchase: number | null = null;
  const pTotalQty = validPurchaseLines.reduce((sum, l) => sum + l.quantity, 0);
  const pTotalTaxable = validPurchaseLines.reduce((sum, l) => sum + l.taxable_amount, 0);
  const pDistinctDocs = new Set(validPurchaseLines.map((l) => l.document_id)).size;

  if (validPurchaseLines.length > 0) {
    // Latest: deterministic sort by date DESC, document_number DESC, line_item_id DESC
    const sortedByDate = [...validPurchaseLines].sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      const docCmp = b.document_number.localeCompare(a.document_number);
      if (docCmp !== 0) return docCmp;
      return b.line_item_id.localeCompare(a.line_item_id);
    });
    const latestP = sortedByDate[0];
    latestPurchase = {
      rate: latestP.source_rate,
      effective_rate: latestP.effective_rate,
      evidence: latestP,
    };

    // Lowest: sort by effective_rate ASC, date DESC
    const sortedByRateAsc = [...validPurchaseLines].sort((a, b) => {
      if (a.effective_rate !== b.effective_rate) return a.effective_rate - b.effective_rate;
      return b.date.localeCompare(a.date);
    });
    const lowestP = sortedByRateAsc[0];
    lowestPurchase = {
      rate: lowestP.source_rate,
      effective_rate: lowestP.effective_rate,
      evidence: lowestP,
    };

    // Highest: sort by effective_rate DESC, date DESC
    const sortedByRateDesc = [...validPurchaseLines].sort((a, b) => {
      if (b.effective_rate !== a.effective_rate) return b.effective_rate - a.effective_rate;
      return b.date.localeCompare(a.date);
    });
    const highestP = sortedByRateDesc[0];
    highestPurchase = {
      rate: highestP.source_rate,
      effective_rate: highestP.effective_rate,
      evidence: highestP,
    };

    // Weighted average: SUM(Taxable) / SUM(Qty)
    if (pTotalQty > 0) {
      weightedAvgPurchase = Math.round((pTotalTaxable / pTotalQty) * 100) / 100;
    }
  }

  // 5. Calculate Sales Statistics (Filtered for statistical validity: qty > 0 and effective_rate > 0)
  const validSalesLines = salesLines.filter((l) => l.quantity > 0 && l.effective_rate > 0);

  let latestSales: PriceStatWithEvidence = { rate: null, effective_rate: null, evidence: null };
  let lowestSales: PriceStatWithEvidence = { rate: null, effective_rate: null, evidence: null };
  let highestSales: PriceStatWithEvidence = { rate: null, effective_rate: null, evidence: null };
  let weightedAvgSales: number | null = null;
  const sTotalQty = validSalesLines.reduce((sum, l) => sum + l.quantity, 0);
  const sTotalTaxable = validSalesLines.reduce((sum, l) => sum + l.taxable_amount, 0);
  const sDistinctDocs = new Set(validSalesLines.map((l) => l.document_id)).size;

  if (validSalesLines.length > 0) {
    // Latest: deterministic sort by date DESC, document_number DESC, line_item_id DESC
    const sortedByDate = [...validSalesLines].sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      const docCmp = b.document_number.localeCompare(a.document_number);
      if (docCmp !== 0) return docCmp;
      return b.line_item_id.localeCompare(a.line_item_id);
    });
    const latestS = sortedByDate[0];
    latestSales = {
      rate: latestS.source_rate,
      effective_rate: latestS.effective_rate,
      evidence: latestS,
    };

    // Lowest: sort by effective_rate ASC, date DESC
    const sortedByRateAsc = [...validSalesLines].sort((a, b) => {
      if (a.effective_rate !== b.effective_rate) return a.effective_rate - b.effective_rate;
      return b.date.localeCompare(a.date);
    });
    const lowestS = sortedByRateAsc[0];
    lowestSales = {
      rate: lowestS.source_rate,
      effective_rate: lowestS.effective_rate,
      evidence: lowestS,
    };

    // Highest: sort by effective_rate DESC, date DESC
    const sortedByRateDesc = [...validSalesLines].sort((a, b) => {
      if (b.effective_rate !== a.effective_rate) return b.effective_rate - a.effective_rate;
      return b.date.localeCompare(a.date);
    });
    const highestS = sortedByRateDesc[0];
    highestSales = {
      rate: highestS.source_rate,
      effective_rate: highestS.effective_rate,
      evidence: highestS,
    };

    // Weighted average: SUM(Taxable) / SUM(Qty)
    if (sTotalQty > 0) {
      weightedAvgSales = Math.round((sTotalTaxable / sTotalQty) * 100) / 100;
    }
  }

  // 6. Gross Price Spread & Markup %
  let grossPriceSpread: number | null = null;
  let markupPercentage: number | null = null;

  if (latestSales.effective_rate !== null && latestPurchase.effective_rate !== null) {
    grossPriceSpread = Math.round((latestSales.effective_rate - latestPurchase.effective_rate) * 100) / 100;
    if (latestPurchase.effective_rate > 0) {
      markupPercentage =
        Math.round(((latestSales.effective_rate - latestPurchase.effective_rate) / latestPurchase.effective_rate) * 10000) / 100;
    }
  }

  const summaryStats: PriceReferenceSummaryStats = {
    latest_purchase: latestPurchase,
    lowest_purchase: lowestPurchase,
    highest_purchase: highestPurchase,
    weighted_avg_purchase: weightedAvgPurchase,
    purchase_transactions_count: validPurchaseLines.length,
    purchase_distinct_docs_count: pDistinctDocs,
    purchase_total_qty: Math.round(pTotalQty * 1000) / 1000,
    purchase_total_taxable: Math.round(pTotalTaxable * 100) / 100,

    latest_sales: latestSales,
    lowest_sales: lowestSales,
    highest_sales: highestSales,
    weighted_avg_sales: weightedAvgSales,
    sales_transactions_count: validSalesLines.length,
    sales_distinct_docs_count: sDistinctDocs,
    sales_total_qty: Math.round(sTotalQty * 1000) / 1000,
    sales_total_taxable: Math.round(sTotalTaxable * 100) / 100,

    gross_price_spread: grossPriceSpread,
    markup_percentage: markupPercentage,
  };

  // 7. Combine, filter by Price Filter, and sort history
  let combinedHistory = [...purchaseLines, ...salesLines];

  if (priceFilter === "LATEST") {
    const latestDocIds = new Set<string>();
    if (latestPurchase.evidence) latestDocIds.add(latestPurchase.evidence.line_item_id);
    if (latestSales.evidence) latestDocIds.add(latestSales.evidence.line_item_id);
    combinedHistory = combinedHistory.filter((h) => latestDocIds.has(h.line_item_id));
  } else if (priceFilter === "LOWEST") {
    const lowestDocIds = new Set<string>();
    if (lowestPurchase.evidence) lowestDocIds.add(lowestPurchase.evidence.line_item_id);
    if (lowestSales.evidence) lowestDocIds.add(lowestSales.evidence.line_item_id);
    combinedHistory = combinedHistory.filter((h) => lowestDocIds.has(h.line_item_id));
  } else if (priceFilter === "HIGHEST") {
    const highestDocIds = new Set<string>();
    if (highestPurchase.evidence) highestDocIds.add(highestPurchase.evidence.line_item_id);
    if (highestSales.evidence) highestDocIds.add(highestSales.evidence.line_item_id);
    combinedHistory = combinedHistory.filter((h) => highestDocIds.has(h.line_item_id));
  }

  // Sorting
  combinedHistory.sort((a, b) => {
    if (sort === "OLDEST") {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      return a.document_number.localeCompare(b.document_number);
    }
    if (sort === "PRICE_DESC") {
      if (b.effective_rate !== a.effective_rate) return b.effective_rate - a.effective_rate;
      return b.date.localeCompare(a.date);
    }
    if (sort === "PRICE_ASC") {
      if (a.effective_rate !== b.effective_rate) return a.effective_rate - b.effective_rate;
      return b.date.localeCompare(a.date);
    }
    if (sort === "QTY_DESC") {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return b.date.localeCompare(a.date);
    }
    // Default: NEWEST
    const cmp = b.date.localeCompare(a.date);
    if (cmp !== 0) return cmp;
    const docCmp = b.document_number.localeCompare(a.document_number);
    if (docCmp !== 0) return docCmp;
    return b.line_item_id.localeCompare(a.line_item_id);
  });

  // Chart data: chrono sorted chronological timeline
  const chartData = [...validPurchaseLines, ...validSalesLines]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => ({
      date: l.date,
      type: l.document_type,
      rate: l.source_rate,
      effective_rate: l.effective_rate,
      quantity: l.quantity,
      document_number: l.document_number,
      party: l.document_type === "PURCHASE" ? l.vendor_name || "" : l.customer_name || "",
    }));

  return {
    stats: summaryStats,
    history: combinedHistory,
    chartData,
    filterOptions: {
      items: itemsRows.map((it) => ({ id: it.item_id, name: it.item_name, sku: it.sku || undefined })),
      customers: customersRows.map((c) => ({ id: c.customer_id, name: c.customer_name })),
      vendors: vendorsRows.map((v) => ({ id: v.vendor_id, name: v.vendor_name })),
    },
    totalRecords: combinedHistory.length,
    appliedFilter: {
      financialYear,
      fromDate,
      toDate,
      priceType,
      itemId: itemId || undefined,
      sku: options.sku || undefined,
      customerId: customerId || undefined,
      vendorId: vendorId || undefined,
      priceFilter,
      search: search || undefined,
      sort,
    },
  };
}
