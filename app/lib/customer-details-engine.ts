// ============================================================
// Bansil Books Analytics — Customer 360 / Customer Details Engine
// Pure Local SQLite Implementation · Zero Zoho API Calls
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { parseFyToDateRange, getCurrentFinancialYear } from "./date-period-utils.ts";
import { getPriceReferenceData } from "./price-reference-engine.ts";
import { getConfirmedAssemblyImpact } from "./composite-assembly-engine.ts";

export interface CustomerProfile {
  id: string;
  name: string;
  gstin: string;
  email: string;
  phone: string;
  billingAddress: string;
  shippingAddress: string;
  source: string;
  isNameOnlyMatch: boolean;
}

export interface CustomerSalesInvoice {
  invoice_id: string;
  invoice_number: string;
  date: string;
  due_date?: string;
  status: string;
  item_count: number;
  total_qty: number;
  taxable_value: number; // Pre-GST
  grand_total: number;   // Document header total
  balance: number;       // Document header balance
  invoice_url?: string;
}

export interface CustomerPurchaseBill {
  bill_id: string;
  bill_number: string;
  vendor_id: string;
  vendor_name: string;
  date: string;
  due_date?: string;
  status: string;
  matching_item_count: number;
  matching_qty: number;
  customer_taxable_value: number; // Pre-GST only for selected customer's lines
  source_grand_total: number;     // Full bill header total
  source_balance: number;         // Full bill header balance
  bill_url?: string;
}

export interface CustomerItemAnalysis {
  item_id: string;
  item_name: string;
  sku: string;
  description: string;
  purchase_qty: number;
  purchase_taxable: number;
  purchase_avg_rate: number;
  latest_purchase_rate: number;
  latest_purchase_doc?: string;
  latest_purchase_bill_id?: string;
  latest_purchase_date?: string;
  latest_purchase_vendor?: string;
  latest_purchase_basis?: string;
  sales_qty: number;
  sales_taxable: number;
  sales_avg_rate: number;
  latest_sales_rate: number;
  latest_sales_doc?: string;
  latest_sales_date?: string;
  balance_qty: number;
  yet_to_purchase: number;
  yet_to_sale: number;
  reconciled_qty: number;
  shortage_value: number | null;
  surplus_value: number | null;
  status: string;
  reference_spread?: number;
  reference_markup_pct?: number;
  raw_purchase_qty?: number;
  assembly_consumed_qty?: number;
  assembly_generated_qty?: number;
  is_composite_assembled?: boolean;
  is_component_consumed?: boolean;
  assembly_details?: Array<{
    assembly_id: string;
    assembly_number: string;
    qty: number;
    type: "CONSUMED" | "GENERATED";
    rate?: number;
  }>;
}

export interface CustomerReconciliationSummary {
  purchase_qty: number;
  sales_qty: number;
  balance_qty: number;
  yet_to_purchase_qty: number;
  yet_to_sale_qty: number;
  reconciled_qty: number;
  approx_shortage_value: number; // Evaluated using latest actual purchase rate
  approx_surplus_value: number;
  items_count: number;
  mismatch_count: number;
}

export interface CustomerActivityEvent {
  date: string;
  type: "SALES_INVOICE" | "PURCHASE_BILL";
  document_id: string;
  document_number: string;
  party_name: string;
  description: string;
  quantity: number;
  taxable_value: number;
  status: string;
  url?: string;
}

export interface Customer360Data {
  customer: CustomerProfile;
  period: {
    financialYear: string;
    period: string;
    fromDate: string;
    toDate: string;
  };
  kpis: {
    salesTaxableValue: number;
    purchaseTaxableValue: number;
    commercialValueSpread: number; // salesTaxableValue - purchaseTaxableValue (Reference only)
    salesInvoiceCount: number;
    purchaseBillCount: number;
    salesQty: number;
    purchaseQty: number;
    salesBalanceReceivable: number;
    purchaseBalancePayable: number;
    purchaseToSalesRatio: number;
    salesToPurchaseRatio: number;
    avgInvoiceValue: number;
    avgBillValue: number;
  };
  overview: {
    topPurchasedByValue: Array<{ item_id: string; item_name: string; sku: string; qty: number; taxable: number }>;
    topPurchasedByQty: Array<{ item_id: string; item_name: string; sku: string; qty: number; taxable: number }>;
    topSoldByValue: Array<{ item_id: string; item_name: string; sku: string; qty: number; taxable: number }>;
    topSoldByQty: Array<{ item_id: string; item_name: string; sku: string; qty: number; taxable: number }>;
    latestSalesInvoice?: CustomerSalesInvoice;
    latestPurchaseBill?: CustomerPurchaseBill;
    latestPurchasePriceEvidence?: {
      item_name: string;
      effective_rate: number;
      date: string;
      document_number: string;
      vendor_name: string;
      quantity: number;
    };
    latestSalesPriceEvidence?: {
      item_name: string;
      effective_rate: number;
      date: string;
      document_number: string;
      customer_name: string;
      quantity: number;
    };
  };
  salesInvoices: CustomerSalesInvoice[];
  purchaseBills: CustomerPurchaseBill[];
  salesOrders: {
    available: boolean;
    message: string;
  };
  purchaseOrders: {
    available: boolean;
    message: string;
  };
  itemAnalysis: CustomerItemAnalysis[];
  reconciliation: CustomerReconciliationSummary;
  priceHistory: any;
  activityTimeline: CustomerActivityEvent[];
}

export interface CustomerListItem {
  id: string;
  name: string;
  gstin: string;
  email: string;
  phone: string;
  salesCount: number;
  purchaseCount: number;
  totalTransactions: number;
}

/**
 * Returns list of distinct customers from local SQLite.
 */
export function getCustomerList(
  db: DatabaseSync,
  filter?: { search?: string; financialYear?: string }
): CustomerListItem[] {
  const fy = filter?.financialYear || getCurrentFinancialYear();
  const { fromDate, toDate } = parseFyToDateRange(fy);

  // Active excluded item IDs
  const activeExcludedRows = db.prepare(`
    SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL
  `).all() as { item_id: string }[];
  const activeExcluded = new Set(activeExcludedRows.map((r) => r.item_id.trim()));

  // 1. Sales Invoices Customers
  const salesRows = db.prepare(`
    SELECT 
      COALESCE(si.customer_id, '') as customer_id,
      COALESCE(si.customer_name, '') as customer_name,
      COUNT(DISTINCT si.invoice_id) as inv_count
    FROM sales_invoices si
    JOIN sales_invoice_line_items sli ON si.invoice_id = sli.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND si.date >= ? AND si.date <= ?
      AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
      AND si.customer_name IS NOT NULL AND TRIM(si.customer_name) != ''
    GROUP BY si.customer_id, si.customer_name
  `).all(fromDate, toDate) as { customer_id: string; customer_name: string; inv_count: number }[];

  // 2. Purchase Bills Customers (Line-level Customer Details)
  const purchaseRows = db.prepare(`
    SELECT 
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as customer_id,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customer_name,
      COUNT(DISTINCT pb.bill_id) as bill_count
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
      AND COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') NOT IN ('', 'CUSTOMER DETAILS MISSING')
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
    GROUP BY COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, ''), COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '')
  `).all(fromDate, toDate) as { customer_id: string; customer_name: string; bill_count: number }[];

  const map = new Map<string, CustomerListItem>();

  for (const s of salesRows) {
    const key = s.customer_id || s.customer_name;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id: s.customer_id || s.customer_name,
        name: s.customer_name,
        gstin: "—",
        email: "—",
        phone: "—",
        salesCount: s.inv_count,
        purchaseCount: 0,
        totalTransactions: s.inv_count,
      });
    } else {
      const ex = map.get(key)!;
      ex.salesCount += s.inv_count;
      ex.totalTransactions += s.inv_count;
    }
  }

  for (const p of purchaseRows) {
    const key = p.customer_id || p.customer_name;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id: p.customer_id || p.customer_name,
        name: p.customer_name,
        gstin: "—",
        email: "—",
        phone: "—",
        salesCount: 0,
        purchaseCount: p.bill_count,
        totalTransactions: p.bill_count,
      });
    } else {
      const ex = map.get(key)!;
      ex.purchaseCount += p.bill_count;
      ex.totalTransactions += p.bill_count;
    }
  }

  let list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.gstin.toLowerCase().includes(q)
    );
  }

  return list;
}

export interface CustomerDetailsParams {
  customerId?: string;
  customerName?: string;
  financialYear?: string;
  period?: string;
  fromDate?: string;
  toDate?: string;
}

/**
 * Returns comprehensive Customer 360 analytics from Local SQLite.
 */
export function getCustomerDetailsData(
  db: DatabaseSync,
  params: CustomerDetailsParams
): Customer360Data | null {
  const targetId = (params.customerId || "").trim();
  const targetName = (params.customerName || "").trim();

  if (!targetId && !targetName) {
    return null;
  }

  const fy = params.financialYear || getCurrentFinancialYear();
  let fDate: string;
  let tDate: string;
  // Resolved label for the period actually applied below — this is the single source
  // every consumer (Customer 360 on-screen header, Customer Material Control table,
  // and its PDF/Excel exports) reads via period.financialYear / summary.period_label.
  // It must always describe the dates that were actually resolved, never just echo
  // the app's static active-FY context regardless of what period was selected.
  let resolvedPeriodLabel: string;

  if (params.period === "CUSTOM" && params.fromDate && params.toDate) {
    fDate = params.fromDate;
    tDate = params.toDate;
    resolvedPeriodLabel = `${fDate} to ${tDate}`;
  } else if (params.period === "ALL") {
    fDate = "2000-01-01";
    tDate = "2099-12-31";
    resolvedPeriodLabel = "ALL TIME";
  } else if (params.period === "PREVIOUS_FY") {
    const [startYear] = fy.split("-").map((s) => parseInt(s, 10));
    const prevFy = `${startYear - 1}-${String(startYear).slice(-2)}`;
    const range = parseFyToDateRange(prevFy);
    fDate = range.fromDate;
    tDate = range.toDate;
    resolvedPeriodLabel = prevFy;
  } else {
    const range = parseFyToDateRange(fy);
    fDate = range.fromDate;
    tDate = range.toDate;
    resolvedPeriodLabel = fy;
  }

  // 1. Resolve Customer Profile
  let customerProfile: CustomerProfile | null = null;

  // Try finding customer from sales_invoices
  const salesCustMatch = db.prepare(`
    SELECT customer_id, customer_name
    FROM sales_invoices
    WHERE (customer_id = ? OR customer_name = ? OR customer_id = ? OR customer_name = ?)
    LIMIT 1
  `).get(targetId, targetName, targetName, targetId) as { customer_id: string; customer_name: string } | undefined;

  if (salesCustMatch) {
    customerProfile = {
      id: salesCustMatch.customer_id,
      name: salesCustMatch.customer_name,
      gstin: "—",
      email: "—",
      phone: "—",
      billingAddress: "—",
      shippingAddress: "—",
      source: "Local SQLite Cache",
      isNameOnlyMatch: false,
    };
  } else {
    // Try finding customer from purchase_bill_line_items
    const purchCustMatch = db.prepare(`
      SELECT 
        COALESCE(purchase_line_customer_id, bbt_customer_id, '') as customer_id,
        COALESCE(purchase_line_customer_name, bbt_customer_name, '') as customer_name
      FROM purchase_bill_line_items
      WHERE (purchase_line_customer_id = ? OR bbt_customer_id = ? OR purchase_line_customer_name = ? OR bbt_customer_name = ?)
      LIMIT 1
    `).get(targetId, targetId, targetName, targetName) as { customer_id: string; customer_name: string } | undefined;

    if (purchCustMatch) {
      customerProfile = {
        id: purchCustMatch.customer_id || purchCustMatch.customer_name,
        name: purchCustMatch.customer_name,
        gstin: "—",
        email: "—",
        phone: "—",
        billingAddress: "—",
        shippingAddress: "—",
        source: "Local SQLite Cache",
        isNameOnlyMatch: !purchCustMatch.customer_id,
      };
    } else {
      customerProfile = {
        id: targetId || targetName,
        name: targetName || targetId,
        gstin: "—",
        email: "—",
        phone: "—",
        billingAddress: "—",
        shippingAddress: "—",
        source: "Local SQLite Cache",
        isNameOnlyMatch: !targetId,
      };
    }
  }

  const cid = customerProfile.id;
  const cname = customerProfile.name;

  // 2. Fetch Sales Invoices for Customer
  const invoiceHeaders = db.prepare(`
    SELECT DISTINCT
      si.invoice_id,
      si.invoice_number,
      si.date,
      si.due_date,
      si.status,
      si.total as grand_total,
      si.balance,
      si.invoice_url
    FROM sales_invoices si
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND (si.customer_id = ? OR si.customer_name = ?)
      AND si.date >= ? AND si.date <= ?
    ORDER BY si.date DESC, si.invoice_number DESC
  `).all(cid, cname, fDate, tDate) as Array<{
    invoice_id: string;
    invoice_number: string;
    date: string;
    due_date?: string;
    status: string;
    grand_total: number;
    balance: number;
    invoice_url?: string;
  }>;

  const salesInvoices: CustomerSalesInvoice[] = [];
  let totalSalesTaxable = 0;
  let totalSalesQty = 0;
  let totalSalesBalance = 0;

  for (const inv of invoiceHeaders) {
    const lineStats = db.prepare(`
      SELECT 
        COUNT(line_item_id) as item_count,
        COALESCE(SUM(quantity), 0) as total_qty,
        COALESCE(SUM(line_total), 0) as taxable_value
      FROM sales_invoice_line_items
      WHERE invoice_id = ?
        AND (item_id IS NULL OR item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    `).get(inv.invoice_id) as { item_count: number; total_qty: number; taxable_value: number };

    // If an invoice only contained excluded items, skip or show zero lines
    if (lineStats.item_count === 0) continue;

    salesInvoices.push({
      invoice_id: inv.invoice_id,
      invoice_number: inv.invoice_number,
      date: inv.date,
      due_date: inv.due_date || undefined,
      status: inv.status,
      item_count: lineStats.item_count,
      total_qty: lineStats.total_qty,
      taxable_value: lineStats.taxable_value,
      grand_total: Number(inv.grand_total || 0),
      balance: Number(inv.balance || 0),
      invoice_url: inv.invoice_url || undefined,
    });

    totalSalesTaxable += lineStats.taxable_value;
    totalSalesQty += lineStats.total_qty;
    totalSalesBalance += Number(inv.balance || 0);
  }

  // 3. Fetch Purchase Bills linked through Line Customer Details
  const billHeaders = db.prepare(`
    SELECT DISTINCT
      pb.bill_id,
      pb.bill_number,
      pb.vendor_id,
      pb.vendor_name,
      pb.date,
      pb.due_date,
      pb.status,
      pb.total as source_grand_total,
      pb.balance as source_balance,
      pb.bill_url
    FROM purchase_bills pb
    JOIN purchase_bill_line_items pli ON pb.bill_id = pli.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND (
        pli.purchase_line_customer_id = ? OR 
        pli.bbt_customer_id = ? OR 
        pli.purchase_line_customer_name = ? OR 
        pli.bbt_customer_name = ?
      )
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    ORDER BY pb.date DESC, pb.bill_number DESC
  `).all(cid, cid, cname, cname, fDate, tDate) as Array<{
    bill_id: string;
    bill_number: string;
    vendor_id: string;
    vendor_name: string;
    date: string;
    due_date?: string;
    status: string;
    source_grand_total: number;
    source_balance: number;
    bill_url?: string;
  }>;

  const purchaseBills: CustomerPurchaseBill[] = [];
  let totalPurchaseTaxable = 0;
  let totalPurchaseQty = 0;
  let totalPurchaseBalance = 0;

  for (const bill of billHeaders) {
    const lineStats = db.prepare(`
      SELECT 
        COUNT(line_item_id) as matching_item_count,
        COALESCE(SUM(quantity), 0) as matching_qty,
        COALESCE(SUM(line_total), 0) as customer_taxable_value
      FROM purchase_bill_line_items
      WHERE bill_id = ?
        AND (
          purchase_line_customer_id = ? OR 
          bbt_customer_id = ? OR 
          purchase_line_customer_name = ? OR 
          bbt_customer_name = ?
        )
        AND customer_data_status != 'CUSTOMER DETAILS MISSING'
        AND (item_id IS NULL OR item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    `).get(bill.bill_id, cid, cid, cname, cname) as {
      matching_item_count: number;
      matching_qty: number;
      customer_taxable_value: number;
    };

    if (lineStats.matching_item_count === 0) continue;

    purchaseBills.push({
      bill_id: bill.bill_id,
      bill_number: bill.bill_number,
      vendor_id: bill.vendor_id,
      vendor_name: bill.vendor_name,
      date: bill.date,
      due_date: bill.due_date || undefined,
      status: bill.status,
      matching_item_count: lineStats.matching_item_count,
      matching_qty: lineStats.matching_qty,
      customer_taxable_value: lineStats.customer_taxable_value,
      source_grand_total: Number(bill.source_grand_total || 0),
      source_balance: Number(bill.source_balance || 0),
      bill_url: bill.bill_url || undefined,
    });

    totalPurchaseTaxable += lineStats.customer_taxable_value;
    totalPurchaseQty += lineStats.matching_qty;
    totalPurchaseBalance += Number(bill.source_balance || 0);
  }

  // 4. Item Analysis (Customer ID + Item ID grain)
  // Fetch all sales lines for this customer
  const salesLines = db.prepare(`
    SELECT 
      COALESCE(sli.item_id, sli.item_name) as item_id,
      sli.item_name,
      COALESCE(sli.sku, '') as sku,
      COALESCE(sli.description, '') as description,
      sli.quantity,
      sli.rate,
      sli.line_total,
      si.invoice_number,
      si.date
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND (si.customer_id = ? OR si.customer_name = ?)
      AND si.date >= ? AND si.date <= ?
      AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    ORDER BY si.date DESC, si.invoice_number DESC
  `).all(cid, cname, fDate, tDate) as Array<{
    item_id: string;
    item_name: string;
    sku: string;
    description: string;
    quantity: number;
    rate: number;
    line_total: number;
    invoice_number: string;
    date: string;
  }>;

  // Fetch all purchase lines for this customer
  const purchaseLines = db.prepare(`
    SELECT 
      pli.bill_id,
      COALESCE(pli.item_id, pli.item_name) as item_id,
      pli.item_name,
      COALESCE(pli.sku, '') as sku,
      COALESCE(pli.description, '') as description,
      pli.quantity,
      pli.rate,
      pli.line_total,
      pb.bill_number,
      pb.date,
      pb.vendor_name
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND (
        pli.purchase_line_customer_id = ? OR 
        pli.bbt_customer_id = ? OR 
        pli.purchase_line_customer_name = ? OR 
        pli.bbt_customer_name = ?
      )
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    ORDER BY pb.date DESC, pb.bill_number DESC
  `).all(cid, cid, cname, cname, fDate, tDate) as Array<{
    bill_id: string;
    item_id: string;
    item_name: string;
    sku: string;
    description: string;
    quantity: number;
    rate: number;
    line_total: number;
    bill_number: string;
    date: string;
    vendor_name: string;
  }>;

  interface ItemAccumulator {
    item_id: string;
    item_name: string;
    sku: string;
    description: string;
    purchase_qty: number;
    purchase_taxable: number;
    latest_purchase_rate: number;
    latest_purchase_doc?: string;
    latest_purchase_bill_id?: string;
    latest_purchase_date?: string;
    latest_purchase_vendor?: string;
    latest_purchase_basis?: string;
    sales_qty: number;
    sales_taxable: number;
    latest_sales_rate: number;
    latest_sales_doc?: string;
    latest_sales_date?: string;
  }

  const itemMap = new Map<string, ItemAccumulator>();

  for (const pl of purchaseLines) {
    const key = pl.item_id || pl.item_name;
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        item_id: pl.item_id,
        item_name: pl.item_name,
        sku: pl.sku,
        description: pl.description || "—",
        purchase_qty: 0,
        purchase_taxable: 0,
        latest_purchase_rate: 0,
        sales_qty: 0,
        sales_taxable: 0,
        latest_sales_rate: 0,
      });
    }
    const acc = itemMap.get(key)!;
    acc.purchase_qty += Number(pl.quantity || 0);
    acc.purchase_taxable += Number(pl.line_total || 0);
    if (!acc.latest_purchase_doc && pl.quantity > 0) {
      const effRate = pl.quantity > 0 ? pl.line_total / pl.quantity : pl.rate;
      acc.latest_purchase_rate = effRate;
      acc.latest_purchase_doc = pl.bill_number;
      acc.latest_purchase_bill_id = pl.bill_id;
      acc.latest_purchase_date = pl.date;
      acc.latest_purchase_vendor = pl.vendor_name;
      acc.latest_purchase_basis = "LATEST CUSTOMER+ITEM PURCHASE IN PERIOD";
    }
  }

  for (const sl of salesLines) {
    const key = sl.item_id || sl.item_name;
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        item_id: sl.item_id,
        item_name: sl.item_name,
        sku: sl.sku,
        description: sl.description || "—",
        purchase_qty: 0,
        purchase_taxable: 0,
        latest_purchase_rate: 0,
        sales_qty: 0,
        sales_taxable: 0,
        latest_sales_rate: 0,
      });
    }
    const acc = itemMap.get(key)!;
    acc.sales_qty += Number(sl.quantity || 0);
    acc.sales_taxable += Number(sl.line_total || 0);
    if (!acc.latest_sales_doc && sl.quantity > 0) {
      const effRate = sl.quantity > 0 ? sl.line_total / sl.quantity : sl.rate;
      acc.latest_sales_rate = effRate;
      acc.latest_sales_doc = sl.invoice_number;
      acc.latest_sales_date = sl.date;
    }
  }

  // 4b. Incorporate Confirmed Local Composite Assembly Impact
  const confirmedImpactMap = getConfirmedAssemblyImpact(db, {
    customerId: cid,
    fromDate: fDate,
    toDate: tDate,
  });

  const custImpact =
    confirmedImpactMap.get(cid.toLowerCase().trim()) ||
    (cname ? confirmedImpactMap.get(cname.toLowerCase().trim()) : undefined);

  // Track raw qty, consumed qty, generated qty, and assembly details per item key
  const assemblyMetadataMap = new Map<
    string,
    {
      raw_purchase_qty: number;
      assembly_consumed_qty: number;
      assembly_generated_qty: number;
      is_composite_assembled: boolean;
      is_component_consumed: boolean;
      assembly_details: Array<{
        assembly_id: string;
        assembly_number: string;
        qty: number;
        type: "CONSUMED" | "GENERATED";
        rate?: number;
      }>;
    }
  >();

  // Add any generated composite items that have no raw purchase / sales lines yet
  if (custImpact) {
    for (const [genKey, genInfo] of Object.entries(custImpact.generatedCompositeMap)) {
      const matchAcc = Array.from(itemMap.values()).find(
        (acc) =>
          (acc.item_id || "").toLowerCase().trim() === genKey.toLowerCase().trim() ||
          (acc.item_name || "").toLowerCase().trim() === genKey.toLowerCase().trim()
      );
      if (!matchAcc && genInfo.assemblies.length > 0) {
        const firstAsm = genInfo.assemblies[0];
        const asmHeader = db
          .prepare("SELECT composite_item_id, composite_item_name, composite_sku FROM composite_assemblies WHERE assembly_id = ?")
          .get(firstAsm.assembly_id) as { composite_item_id?: string; composite_item_name?: string; composite_sku?: string } | undefined;

        const itemId = asmHeader?.composite_item_id || genKey;
        const itemName = asmHeader?.composite_item_name || genKey;
        const sku = asmHeader?.composite_sku || "";

        itemMap.set(itemId, {
          item_id: itemId,
          item_name: itemName,
          sku: sku,
          description: "Locally Assembled Composite Item",
          purchase_qty: 0,
          purchase_taxable: 0,
          latest_purchase_rate: 0,
          sales_qty: 0,
          sales_taxable: 0,
          latest_sales_rate: 0,
        });
      }
    }
  }

  // Adjust each item in itemMap for assembly consumption and generation
  for (const [key, acc] of itemMap.entries()) {
    const rawPurchQty = acc.purchase_qty;
    let consumedQty = 0;
    let generatedQty = 0;
    let isCompConsumed = false;
    let isCompAssembled = false;
    const asmDetails: Array<{
      assembly_id: string;
      assembly_number: string;
      qty: number;
      type: "CONSUMED" | "GENERATED";
      rate?: number;
    }> = [];

    if (custImpact) {
      const keyLower = key.toLowerCase().trim();
      const nameLower = (acc.item_name || "").toLowerCase().trim();
      const idLower = (acc.item_id || "").toLowerCase().trim();

      // Check Component Consumption
      const consumedMatch =
        custImpact.consumedComponentMap[keyLower] ||
        custImpact.consumedComponentMap[nameLower] ||
        custImpact.consumedComponentMap[idLower];

      if (consumedMatch && consumedMatch.total_consumed_qty > 0) {
        consumedQty = consumedMatch.total_consumed_qty;
        isCompConsumed = true;
        for (const cl of consumedMatch.lines) {
          asmDetails.push({
            assembly_id: cl.assembly_id,
            assembly_number: cl.assembly_number,
            qty: cl.consumed_qty,
            type: "CONSUMED",
            rate: cl.purchase_rate,
          });
        }
      }

      // Check Composite Generation
      const generatedMatch =
        custImpact.generatedCompositeMap[keyLower] ||
        custImpact.generatedCompositeMap[nameLower] ||
        custImpact.generatedCompositeMap[idLower];

      if (generatedMatch && generatedMatch.total_generated_qty > 0) {
        generatedQty = generatedMatch.total_generated_qty;
        isCompAssembled = true;
        for (const ga of generatedMatch.assemblies) {
          asmDetails.push({
            assembly_id: ga.assembly_id,
            assembly_number: ga.assembly_number,
            qty: ga.generated_qty,
            type: "GENERATED",
            rate: ga.cost_per_unit,
          });
        }

        // Add generated material cost to purchase taxable
        acc.purchase_taxable += generatedMatch.total_material_cost;

        // If no direct purchase rate, use Material Reference Cost
        if ((!acc.latest_purchase_rate || acc.latest_purchase_rate === 0) && generatedMatch.assemblies.length > 0) {
          const first = generatedMatch.assemblies[0];
          acc.latest_purchase_rate = first.cost_per_unit;
          acc.latest_purchase_basis = "MATERIAL REFERENCE COST (LOCAL COMPOSITE ASSEMBLY)";
          acc.latest_purchase_doc = first.assembly_number;
          acc.latest_purchase_date = first.assembly_date;
        }
      }
    }

    // Effective Purchase Qty = MAX(0, Raw Purchase Qty - Consumed Qty) + Generated Qty
    const effectivePurchaseQty = Math.max(0, rawPurchQty - consumedQty) + generatedQty;
    acc.purchase_qty = effectivePurchaseQty;

    assemblyMetadataMap.set(key, {
      raw_purchase_qty: rawPurchQty,
      assembly_consumed_qty: consumedQty,
      assembly_generated_qty: generatedQty,
      is_composite_assembled: isCompAssembled,
      is_component_consumed: isCompConsumed,
      assembly_details: asmDetails,
    });
  }

  // Prepared statement for Tier 2: historical fallback purchase rate
  const historicalRateStmt = db.prepare(`
    SELECT pb.bill_id, pli.rate, pb.date as billDate, pb.bill_number as billNumber, pb.vendor_name as vendorName
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE (pli.item_id = ? OR pli.item_name = ?)
      AND pli.rate > 0
      AND UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
    ORDER BY pb.date DESC, pb.bill_id DESC, pli.line_item_id DESC
    LIMIT 1
  `);

  const itemAnalysis: CustomerItemAnalysis[] = Array.from(itemMap.values()).map((acc) => {
    const pQty = acc.purchase_qty;
    const sQty = acc.sales_qty;
    const pAvg = pQty > 0 ? acc.purchase_taxable / pQty : 0;
    const sAvg = sQty > 0 ? acc.sales_taxable / sQty : 0;
    const balance = pQty - sQty;
    const yetToPurch = Math.max(0, sQty - pQty);
    const yetToSale = Math.max(0, pQty - sQty);
    const reconciled = Math.min(pQty, sQty);

    let latestPurchRate = acc.latest_purchase_rate;
    let latestPurchDoc = acc.latest_purchase_doc;
    let latestPurchBillId = acc.latest_purchase_bill_id;
    let latestPurchDate = acc.latest_purchase_date;
    let latestPurchVendor = acc.latest_purchase_vendor;
    let latestPurchBasis = acc.latest_purchase_basis;

    // If no purchase for this customer in period, check historical item purchase (Tier 2)
    if ((!latestPurchRate || latestPurchRate === 0)) {
      const hRow = historicalRateStmt.get(acc.item_id || "", acc.item_name || "") as {
        bill_id: string;
        rate: number;
        billDate: string;
        billNumber: string;
        vendorName: string;
      } | undefined;
      if (hRow && Number(hRow.rate) > 0) {
        latestPurchRate = Number(hRow.rate);
        latestPurchDoc = hRow.billNumber;
        latestPurchBillId = hRow.bill_id;
        latestPurchDate = hRow.billDate;
        latestPurchVendor = hRow.vendorName;
        latestPurchBasis = "LATEST HISTORICAL ITEM PURCHASE";
      } else {
        latestPurchBasis = "NO REFERENCE RATE";
      }
    }

    let status = "BALANCED";
    if (pQty === 0 && sQty > 0) {
      status = "SALES ONLY";
    } else if (sQty === 0 && pQty > 0) {
      status = "PURCHASE ONLY";
    } else if (balance === 0 && pQty > 0) {
      status = "RECONCILED";
    } else if (balance < 0) {
      status = "SHORTAGE";
    } else if (balance > 0) {
      status = "SURPLUS";
    }

    const shortageValue = yetToPurch > 0 && latestPurchRate > 0
      ? Math.round(yetToPurch * latestPurchRate * 100) / 100
      : null;
    const surplusValue = yetToSale > 0 && latestPurchRate > 0
      ? Math.round(yetToSale * latestPurchRate * 100) / 100
      : null;

    let spread: number | undefined = undefined;
    let markupPct: number | undefined = undefined;
    if (latestPurchRate > 0 && acc.latest_sales_rate > 0) {
      spread = acc.latest_sales_rate - latestPurchRate;
      markupPct = (spread / latestPurchRate) * 100;
    }

    const asmMeta = assemblyMetadataMap.get(acc.item_id || acc.item_name) || {
      raw_purchase_qty: pQty,
      assembly_consumed_qty: 0,
      assembly_generated_qty: 0,
      is_composite_assembled: false,
      is_component_consumed: false,
      assembly_details: [],
    };

    return {
      item_id: acc.item_id,
      item_name: acc.item_name,
      sku: acc.sku,
      description: acc.description,
      purchase_qty: pQty,
      purchase_taxable: acc.purchase_taxable,
      purchase_avg_rate: pAvg,
      latest_purchase_rate: latestPurchRate,
      latest_purchase_doc: latestPurchDoc,
      latest_purchase_bill_id: latestPurchBillId,
      latest_purchase_date: latestPurchDate,
      latest_purchase_vendor: latestPurchVendor,
      latest_purchase_basis: latestPurchBasis,
      sales_qty: sQty,
      sales_taxable: acc.sales_taxable,
      sales_avg_rate: sAvg,
      latest_sales_rate: acc.latest_sales_rate,
      latest_sales_doc: acc.latest_sales_doc,
      latest_sales_date: acc.latest_sales_date,
      balance_qty: balance,
      yet_to_purchase: yetToPurch,
      yet_to_sale: yetToSale,
      reconciled_qty: reconciled,
      shortage_value: shortageValue,
      surplus_value: surplusValue,
      status,
      reference_spread: spread,
      reference_markup_pct: markupPct,
      raw_purchase_qty: asmMeta.raw_purchase_qty,
      assembly_consumed_qty: asmMeta.assembly_consumed_qty,
      assembly_generated_qty: asmMeta.assembly_generated_qty,
      is_composite_assembled: asmMeta.is_composite_assembled,
      is_component_consumed: asmMeta.is_component_consumed,
      assembly_details: asmMeta.assembly_details,
    };
  }).sort((a, b) => a.item_name.localeCompare(b.item_name));

  // 5. Customer Reconciliation Summary (with valuation via Latest Purchase Rate)
  let reconTotPurchQty = 0;
  let reconTotSalesQty = 0;
  let reconTotYetToPurch = 0;
  let reconTotYetToSale = 0;
  let reconTotReconciled = 0;
  let approxShortageValue = 0;
  let approxSurplusValue = 0;
  let mismatchCount = 0;

  for (const it of itemAnalysis) {
    reconTotPurchQty += it.purchase_qty;
    reconTotSalesQty += it.sales_qty;
    reconTotYetToPurch += it.yet_to_purchase;
    reconTotYetToSale += it.yet_to_sale;
    reconTotReconciled += it.reconciled_qty;

    if (it.balance_qty !== 0) {
      mismatchCount++;
    }

    if (it.shortage_value !== null) {
      approxShortageValue += it.shortage_value;
    }
    if (it.surplus_value !== null) {
      approxSurplusValue += it.surplus_value;
    }
  }

  const customerReconciliation: CustomerReconciliationSummary = {
    purchase_qty: reconTotPurchQty,
    sales_qty: reconTotSalesQty,
    balance_qty: reconTotPurchQty - reconTotSalesQty,
    yet_to_purchase_qty: reconTotYetToPurch,
    yet_to_sale_qty: reconTotYetToSale,
    reconciled_qty: reconTotReconciled,
    approx_shortage_value: Math.round(approxShortageValue * 100) / 100,
    approx_surplus_value: Math.round(approxSurplusValue * 100) / 100,
    items_count: itemAnalysis.length,
    mismatch_count: mismatchCount,
  };

  // 6. Overview Top Items
  const topPurchasedByValue = [...itemAnalysis]
    .filter((it) => it.purchase_taxable > 0)
    .sort((a, b) => b.purchase_taxable - a.purchase_taxable)
    .slice(0, 5)
    .map((it) => ({
      item_id: it.item_id,
      item_name: it.item_name,
      sku: it.sku,
      qty: it.purchase_qty,
      taxable: it.purchase_taxable,
    }));

  const topPurchasedByQty = [...itemAnalysis]
    .filter((it) => it.purchase_qty > 0)
    .sort((a, b) => b.purchase_qty - a.purchase_qty)
    .slice(0, 5)
    .map((it) => ({
      item_id: it.item_id,
      item_name: it.item_name,
      sku: it.sku,
      qty: it.purchase_qty,
      taxable: it.purchase_taxable,
    }));

  const topSoldByValue = [...itemAnalysis]
    .filter((it) => it.sales_taxable > 0)
    .sort((a, b) => b.sales_taxable - a.sales_taxable)
    .slice(0, 5)
    .map((it) => ({
      item_id: it.item_id,
      item_name: it.item_name,
      sku: it.sku,
      qty: it.sales_qty,
      taxable: it.sales_taxable,
    }));

  const topSoldByQty = [...itemAnalysis]
    .filter((it) => it.sales_qty > 0)
    .sort((a, b) => b.sales_qty - a.sales_qty)
    .slice(0, 5)
    .map((it) => ({
      item_id: it.item_id,
      item_name: it.item_name,
      sku: it.sku,
      qty: it.sales_qty,
      taxable: it.sales_taxable,
    }));

  // Latest evidence snippets
  const latestPurch = purchaseLines[0];
  const latestSale = salesLines[0];

  // 7. Activity Timeline (Combined Invoices + Bills sorted by date DESC)
  const activityTimeline: CustomerActivityEvent[] = [];

  for (const inv of salesInvoices) {
    activityTimeline.push({
      date: inv.date,
      type: "SALES_INVOICE",
      document_id: inv.invoice_id,
      document_number: inv.invoice_number,
      party_name: customerProfile.name,
      description: `Sales Invoice with ${inv.item_count} items`,
      quantity: inv.total_qty,
      taxable_value: inv.taxable_value,
      status: inv.status,
      url: inv.invoice_url,
    });
  }

  for (const bill of purchaseBills) {
    activityTimeline.push({
      date: bill.date,
      type: "PURCHASE_BILL",
      document_id: bill.bill_id,
      document_number: bill.bill_number,
      party_name: bill.vendor_name,
      description: `Purchase Bill for ${customerProfile.name}`,
      quantity: bill.matching_qty,
      taxable_value: bill.customer_taxable_value,
      status: bill.status,
      url: bill.bill_url,
    });
  }

  activityTimeline.sort((a, b) => {
    const dComp = b.date.localeCompare(a.date);
    if (dComp !== 0) return dComp;
    return b.document_number.localeCompare(a.document_number);
  });

  // 8. Price History for Customer
  const priceHistory = getPriceReferenceData({
    customerId: cid,
    financialYear: fy,
    fromDate: fDate,
    toDate: tDate,
    priceType: "ALL",
  });

  // 9. Analytical KPIs
  const commercialValueSpread = totalSalesTaxable - totalPurchaseTaxable;
  const purchaseToSalesRatio = totalSalesTaxable > 0 ? (totalPurchaseTaxable / totalSalesTaxable) * 100 : 0;
  const salesToPurchaseRatio = totalPurchaseTaxable > 0 ? (totalSalesTaxable / totalPurchaseTaxable) * 100 : 0;
  const avgInvoiceValue = salesInvoices.length > 0 ? totalSalesTaxable / salesInvoices.length : 0;
  const avgBillValue = purchaseBills.length > 0 ? totalPurchaseTaxable / purchaseBills.length : 0;

  return {
    customer: customerProfile,
    period: {
      financialYear: resolvedPeriodLabel,
      period: params.period || "CURRENT_FY",
      fromDate: fDate,
      toDate: tDate,
    },
    kpis: {
      salesTaxableValue: totalSalesTaxable,
      purchaseTaxableValue: totalPurchaseTaxable,
      commercialValueSpread,
      salesInvoiceCount: salesInvoices.length,
      purchaseBillCount: purchaseBills.length,
      salesQty: totalSalesQty,
      purchaseQty: totalPurchaseQty,
      salesBalanceReceivable: totalSalesBalance,
      purchaseBalancePayable: totalPurchaseBalance,
      purchaseToSalesRatio,
      salesToPurchaseRatio,
      avgInvoiceValue,
      avgBillValue,
    },
    overview: {
      topPurchasedByValue,
      topPurchasedByQty,
      topSoldByValue,
      topSoldByQty,
      latestSalesInvoice: salesInvoices[0] || undefined,
      latestPurchaseBill: purchaseBills[0] || undefined,
      latestPurchasePriceEvidence: latestPurch
        ? {
            item_name: latestPurch.item_name,
            effective_rate: latestPurch.quantity > 0 ? latestPurch.line_total / latestPurch.quantity : latestPurch.rate,
            date: latestPurch.date,
            document_number: latestPurch.bill_number,
            vendor_name: latestPurch.vendor_name,
            quantity: latestPurch.quantity,
          }
        : undefined,
      latestSalesPriceEvidence: latestSale
        ? {
            item_name: latestSale.item_name,
            effective_rate: latestSale.quantity > 0 ? latestSale.line_total / latestSale.quantity : latestSale.rate,
            date: latestSale.date,
            document_number: latestSale.invoice_number,
            customer_name: customerProfile.name,
            quantity: latestSale.quantity,
          }
        : undefined,
    },
    salesInvoices,
    purchaseBills,
    salesOrders: {
      available: false,
      message: "Sales Order data is not available in the current local cache.",
    },
    purchaseOrders: {
      available: false,
      message: "Purchase Order data is not available in the current local cache.",
    },
    itemAnalysis,
    reconciliation: customerReconciliation,
    priceHistory,
    activityTimeline,
  };
}
