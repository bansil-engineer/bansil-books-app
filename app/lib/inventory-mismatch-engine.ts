// ============================================================
// Bansil Books Analytics — Master Inventory Mismatch Engine
// Primary Grain: Customer ID + Zoho Item ID
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS DURING REPORTS / EXPORTS
// No FIFO / LIFO · Vendor Is Supporting Information Only
// Quantity-based Pending/Mismatch · Zero Average-Rate Mismatch Value
// ============================================================

import {
  getDatabase,
  getSyncMetadata,
  isFullBackfillCompleted,
  getClassifiedServiceItemIds,
  getActiveExcludedItemIds,
  getActiveExclusions,
} from "./db/database.ts";
import { getConfirmedAssemblyImpact } from "./composite-assembly-engine.ts";
import {
  getDateRangeForPeriod,
  parseFyToDateRange,
  resolveDateRange,
  type MasterPeriodOption,
} from "./date-period-utils.ts";
import type {
  ReconciliationFilter,
  MasterInventoryMismatchItem,
  MasterInventoryMismatchReportResult,
  ItemTransactionBreakdown,
  CustomerDetailsMissingRecord,
} from "../types/reconciliation.ts";


/**
 * Extracts distinct customer and item options available for the selected period from SQLite.
 * Never calls Zoho Books.
 */
export function getPeriodFilterOptions(
  param1: ReturnType<typeof getDatabase> | ReconciliationFilter,
  fromDate?: string,
  toDate?: string,
  financialYear?: string
) {
  let db: ReturnType<typeof getDatabase>;
  let fDate = fromDate || "";
  let tDate = toDate || "";
  let fy = financialYear;

  if (param1 && typeof (param1 as ReturnType<typeof getDatabase>).prepare === "function") {
    db = param1 as ReturnType<typeof getDatabase>;
  } else {
    db = getDatabase();
    const filter = (param1 as ReconciliationFilter) || { period: "CURRENT_FY" };
    const range = resolveDateRange(filter);
    fDate = range.fromDate;
    tDate = range.toDate;
    fy = filter.financialYear;
  }

  const activeExcludedItemIds = getActiveExcludedItemIds(db);

  const salesCust = db.prepare(`
    SELECT DISTINCT 
      COALESCE(si.customer_id, '') as id, 
      COALESCE(si.customer_name, '') as name
    FROM sales_invoices si
    JOIN sales_invoice_line_items sli ON si.invoice_id = sli.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT') 
      AND si.date >= ? AND si.date <= ?
      AND si.customer_name IS NOT NULL AND TRIM(si.customer_name) != ''
      AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `).all(fDate, tDate) as { id: string; name: string }[];

  const purchCust = db.prepare(`
    SELECT DISTINCT 
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as id,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as name
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT') 
      AND pb.date >= ? AND pb.date <= ?
      AND COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') NOT IN ('', 'CUSTOMER DETAILS MISSING')
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `).all(fDate, tDate) as { id: string; name: string }[];

  const custMap = new Map<string, { id: string; name: string }>();
  for (const c of [...salesCust, ...purchCust]) {
    const key = c.id || c.name;
    if (key && !custMap.has(key)) {
      custMap.set(key, { id: c.id || c.name, name: c.name });
    }
  }
  const customers = Array.from(custMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  // 2. Items from Sales Invoices and Purchase Bills (excluding active excluded items)
  const salesItems = db.prepare(`
    SELECT DISTINCT 
      COALESCE(sli.item_id, '') as id, 
      COALESCE(sli.item_name, '') as name, 
      COALESCE(sli.sku, '') as sku
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT') 
      AND si.date >= ? AND si.date <= ?
      AND sli.item_name IS NOT NULL AND TRIM(sli.item_name) != ''
      AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `).all(fDate, tDate) as { id: string; name: string; sku: string }[];

  const purchItems = db.prepare(`
    SELECT DISTINCT 
      COALESCE(pli.item_id, '') as id, 
      COALESCE(pli.item_name, '') as name, 
      COALESCE(pli.sku, '') as sku
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT') 
      AND pb.date >= ? AND pb.date <= ?
      AND pli.item_name IS NOT NULL AND TRIM(pli.item_name) != ''
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `).all(fDate, tDate) as { id: string; name: string; sku: string }[];

  const itemMap = new Map<string, { id: string; name: string; sku: string }>();
  for (const it of [...salesItems, ...purchItems]) {
    const key = it.id || it.name;
    if (it.id && activeExcludedItemIds.has(it.id.trim())) continue;
    if (key && !itemMap.has(key)) {
      itemMap.set(key, { id: it.id || it.name, name: it.name, sku: it.sku });
    }
  }
  const items = Array.from(itemMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  // 3. Coverage Status
  let isComplete = false;
  if (fy) {
    isComplete = isFullBackfillCompleted(db, fy);
  }
  const totalInv = (db.prepare(`
    SELECT COUNT(*) as c 
    FROM sales_invoices 
    WHERE UPPER(status) NOT IN ('VOID', 'DRAFT') AND date >= ? AND date <= ?
  `).get(fDate, tDate) as { c: number }).c;

  const totalBills = (db.prepare(`
    SELECT COUNT(*) as c 
    FROM purchase_bills 
    WHERE UPPER(status) NOT IN ('VOID', 'DRAFT') AND date >= ? AND date <= ?
  `).get(fDate, tDate) as { c: number }).c;

  const totalRecordsInPeriod = totalInv + totalBills;

  let coverageStatus: "COMPLETE" | "PARTIAL" | "NOT_SYNCED" = "NOT_SYNCED";
  if (isComplete) {
    coverageStatus = "COMPLETE";
  } else if (totalRecordsInPeriod > 0) {
    coverageStatus = "PARTIAL";
  }

  return {
    customers,
    items,
    coverageStatus,
    totalRecordsInPeriod,
  };
}

/**
 * Generates the organization-wide Master Inventory Mismatch report.
 * PRIMARY GRAIN: CUSTOMER + ITEM.
 * Purchase Bill Line Customer ID + Zoho Item ID vs Sales Invoice Customer ID + Zoho Item ID.
 * Executed 100% locally against SQLite. Zero Zoho API calls.
 */
export function generateMasterInventoryMismatchReport(
  filter: ReconciliationFilter
): MasterInventoryMismatchReportResult {
  const db = getDatabase();
  let lastSyncTime = "2026-09-10T18:30:00Z";
  const metaSync = getSyncMetadata(db, "last_successful_sync_time");
  if (metaSync) lastSyncTime = metaSync;

  const { fromDate, toDate } = resolveDateRange(filter);

  // Classification Filtering Helper
  const serviceItemIds = getClassifiedServiceItemIds(db);
  const isService = (id?: string | null, name?: string | null) => {
    if (id && serviceItemIds.has(id)) return true;
    if (name && serviceItemIds.has(name.toUpperCase().trim())) return true;
    return false;
  };

  const isIncludedByClassification = (id?: string | null, name?: string | null) => {
    const svc = isService(id, name);
    if (filter.classification === "SERVICE") return svc;
    if (filter.classification === "ALL") return true;
    // Default / MATERIAL: exclude services
    return !svc;
  };

  // Period-aware options and coverage status
  const filterOptions = getPeriodFilterOptions(db, fromDate, toDate, filter.financialYear);

  // 0. Fetch Exclusions
  const activeExcludedItemIds = getActiveExcludedItemIds(db);
  const activeExclusions = getActiveExclusions(db);

  const isItemExcluded = (customerId?: string | null, itemId?: string | null, itemName?: string | null) => {
    if (itemId && activeExcludedItemIds.has(itemId.trim())) return true;
    return activeExclusions.some(ex => {
      const hasExclItem = Boolean(ex.item_id && ex.item_id.trim() !== '');
      const matchItem = hasExclItem ? (itemId && ex.item_id!.trim() === itemId.trim()) : (ex.item_name && itemName && ex.item_name.trim().toLowerCase() === itemName.trim().toLowerCase());
      const matchCustomer = !ex.customer_id || (customerId && ex.customer_id === customerId);
      const matchFy = !ex.financial_year || ex.financial_year === 'ALL' || ex.financial_year === filter.financialYear;
      return Boolean(matchItem && matchCustomer && matchFy);
    });
  };

  // 1. Query Sales aggregated per (Customer + Item)
  const rawSalesRows = db.prepare(`
    SELECT 
      COALESCE(si.customer_id, '') as customerId,
      COALESCE(si.customer_name, 'UNKNOWN CUSTOMER') as customerName,
      COALESCE(sli.item_id, '') as itemId,
      COALESCE(sli.item_name, 'UNKNOWN ITEM') as itemName,
      COALESCE(sli.sku, '') as sku,
      COUNT(DISTINCT si.invoice_id) as salesInvoiceCount,
      COALESCE(SUM(sli.quantity), 0) as salesQty,
      COALESCE(SUM(sli.line_total), 0) as salesAmount,
      GROUP_CONCAT(DISTINCT si.invoice_number) as invoiceNumbers,
      GROUP_CONCAT(DISTINCT sli.rate) as salesRates,
      GROUP_CONCAT(DISTINCT si.invoice_number || ':::' || COALESCE(si.invoice_url, '')) as invoiceUrls
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND si.date >= ? AND si.date <= ?
    GROUP BY si.customer_id, si.customer_name, sli.item_id, sli.item_name, sli.sku
  `).all(fromDate, toDate) as {
    customerId: string;
    customerName: string;
    itemId: string;
    itemName: string;
    sku: string;
    salesInvoiceCount: number;
    salesQty: number;
    salesAmount: number;
    invoiceNumbers: string;
    salesRates: string;
    invoiceUrls: string;
  }[];

  const salesRows = rawSalesRows.filter(r => isIncludedByClassification(r.itemId, r.itemName) && !isItemExcluded(r.customerId, r.itemId));

  // 2. Query Purchases with reliable Customer Details (excluding missing customer lines)
  // Vendor is NOT a matching key. Customer is defined by Purchase Bill Line Customer Details.
  const rawPurchRows = db.prepare(`
    SELECT 
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as customerId,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customerName,
      COALESCE(pli.item_id, '') as itemId,
      COALESCE(pli.item_name, 'UNKNOWN ITEM') as itemName,
      COALESCE(pli.sku, '') as sku,
      COUNT(DISTINCT pb.bill_id) as purchaseBillCount,
      COALESCE(SUM(pli.quantity), 0) as purchaseQty,
      COALESCE(SUM(pli.line_total), 0) as purchaseAmount,
      GROUP_CONCAT(DISTINCT pb.bill_number) as billNumbers,
      GROUP_CONCAT(DISTINCT pli.rate) as purchaseRates,
      GROUP_CONCAT(DISTINCT pb.bill_number || ':::' || COALESCE(pb.bill_url, '')) as billUrls
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') NOT IN ('', 'CUSTOMER DETAILS MISSING')
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
    GROUP BY 
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, ''),
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, ''),
      pli.item_id, pli.item_name, pli.sku
  `).all(fromDate, toDate) as {
    customerId: string;
    customerName: string;
    itemId: string;
    itemName: string;
    sku: string;
    purchaseBillCount: number;
    purchaseQty: number;
    purchaseAmount: number;
    billNumbers: string;
    purchaseRates: string;
    billUrls: string;
  }[];

  const purchRows = rawPurchRows.filter(r => isIncludedByClassification(r.itemId, r.itemName) && !isItemExcluded(r.customerId, r.itemId));

  // 3. Query Purchase Lines with Missing Customer Details (Exception Collection)
  // Purchase lines without reliable Customer Details: DO NOT reconcile.
  const rawCustomerDetailsMissing = db.prepare(`
    SELECT 
      pli.line_item_id as lineItemId,
      pb.bill_id as billId,
      pb.bill_number as billNumber,
      pb.date as billDate,
      pb.vendor_name as vendorName,
      pli.item_id as itemId,
      pli.item_name as itemName,
      COALESCE(pli.sku, '') as sku,
      pli.quantity as quantity,
      pli.rate as rate,
      pli.line_total as amount,
      COALESCE(pli.description, '') as description,
      pb.bill_url as billUrl
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (
        COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') IN ('', 'CUSTOMER DETAILS MISSING')
        OR pli.customer_data_status = 'CUSTOMER DETAILS MISSING'
      )
    ORDER BY pb.date ASC
  `).all(fromDate, toDate) as unknown as CustomerDetailsMissingRecord[];

  const customerDetailsMissing = rawCustomerDetailsMissing.filter(
    (m) => isIncludedByClassification(m.itemId, m.itemName) && !isItemExcluded(undefined, m.itemId)
  );

  // Helper to parse URL list string: "DOC1:::url1,DOC2:::url2"
  const parseDocUrls = (str?: string): { number: string; url?: string }[] => {
    if (!str) return [];
    return str.split(",").filter(Boolean).map(entry => {
      const [docNum, url] = entry.split(":::");
      return { number: docNum, url: url || undefined };
    });
  };

  // Helper to parse rates
  const parseRates = (str?: string): number[] => {
    if (!str) return [];
    return Array.from(new Set(str.split(",").map(r => parseFloat(r.trim())).filter(n => !isNaN(n))));
  };

  // Combine by Customer ID + Item ID (authoritative key)
  const map = new Map<string, MasterInventoryMismatchItem>();

  for (const p of purchRows) {
    const key = `${p.customerId || p.customerName}:::${p.itemId || p.itemName}`;
    const purchaseQty = p.purchaseQty || 0;
    const purchaseAmount = p.purchaseAmount || 0;
    const avgPurchaseRate = purchaseQty > 0 ? purchaseAmount / purchaseQty : 0;
    const balanceQty = purchaseQty;
    const yetToSaleQty = purchaseQty;
    const yetToPurchaseQty = 0;
    const reconciledQty = 0;
    const status: MasterInventoryMismatchItem["status"] =
      purchaseQty > 0 ? "PURCHASE ONLY — NO SALE / INVOICE" : "INACTIVE";

    const pRates = parseRates(p.purchaseRates);
    const pBills = parseDocUrls(p.billUrls).map(d => ({ billNumber: d.number, billUrl: d.url }));

    map.set(key, {
      customerId: p.customerId || "",
      customerName: p.customerName || "UNKNOWN CUSTOMER",
      itemId: p.itemId || "",
      itemName: p.itemName || "",
      sku: p.sku || "",
      unit: "Nos",
      purchaseQty,
      purchaseAmount,
      avgPurchaseRate,
      purchaseRates: pRates,
      singlePurchaseRate: pRates.length === 1 ? pRates[0] : null,
      billList: pBills,
      salesQty: 0,
      salesAmount: 0,
      avgSalesRate: 0,
      salesRates: [],
      singleSalesRate: null,
      invoiceList: [],
      balanceQty,
      yetToPurchaseQty,
      yetToSaleQty,
      reconciledQty,
      mismatchValue: 0,
      status,
      salesInvoiceCount: 0,
      purchaseBillCount: p.purchaseBillCount || 0,
      invoiceNumbers: "",
      billNumbers: p.billNumbers || "",
    });
  }

  for (const s of salesRows) {
    const key = `${s.customerId || s.customerName}:::${s.itemId || s.itemName}`;
    const existing = map.get(key);
    const purchaseQty = existing ? existing.purchaseQty : 0;
    const purchaseAmount = existing ? existing.purchaseAmount : 0;
    const avgPurchaseRate = existing ? existing.avgPurchaseRate : 0;
    const purchaseBillCount = existing ? existing.purchaseBillCount : 0;
    const purchaseRates = existing ? existing.purchaseRates : [];
    const singlePurchaseRate = existing ? existing.singlePurchaseRate : null;
    const billList = existing ? existing.billList : [];

    const salesQty = s.salesQty || 0;
    const salesAmount = s.salesAmount || 0;
    const avgSalesRate = salesQty > 0 ? salesAmount / salesQty : 0;

    const balanceQty = purchaseQty - salesQty;
    const yetToPurchaseQty = Math.max(0, salesQty - purchaseQty);
    const yetToSaleQty = Math.max(0, purchaseQty - salesQty);
    const reconciledQty = Math.min(purchaseQty, salesQty);

    let status: MasterInventoryMismatchItem["status"] = "INACTIVE";
    if (purchaseQty === 0 && salesQty > 0) {
      status = "SALE ONLY — NO PURCHASE";
    } else if (salesQty === 0 && purchaseQty > 0) {
      status = "PURCHASE ONLY — NO SALE / INVOICE";
    } else if (balanceQty === 0 && purchaseQty > 0) {
      status = "RECONCILED";
    } else if (balanceQty < 0) {
      status = "SHORTAGE";
    } else if (balanceQty > 0) {
      status = "SURPLUS";
    }

    const sRates = parseRates(s.salesRates);
    const sInvoices = parseDocUrls(s.invoiceUrls).map(d => ({ invoiceNumber: d.number, invoiceUrl: d.url }));

    map.set(key, {
      customerId: s.customerId || (existing ? existing.customerId : ""),
      customerName: s.customerName || (existing ? existing.customerName : "UNKNOWN CUSTOMER"),
      itemId: s.itemId || (existing ? existing.itemId : ""),
      itemName: s.itemName || (existing ? existing.itemName : ""),
      sku: s.sku || (existing ? existing.sku : ""),
      unit: existing ? existing.unit : "Nos",
      purchaseQty,
      purchaseAmount,
      avgPurchaseRate,
      purchaseRates,
      singlePurchaseRate,
      billList,
      salesQty,
      salesAmount,
      avgSalesRate,
      salesRates: sRates,
      singleSalesRate: sRates.length === 1 ? sRates[0] : null,
      invoiceList: sInvoices,
      balanceQty,
      yetToPurchaseQty,
      yetToSaleQty,
      reconciledQty,
      mismatchValue: 0,
      status,
      salesInvoiceCount: s.salesInvoiceCount || 0,
      purchaseBillCount,
      invoiceNumbers: s.invoiceNumbers || "",
      billNumbers: existing ? existing.billNumbers : "",
    });
  }

  // Apply Confirmed Composite Assembly Impact
  const impactMap = getConfirmedAssemblyImpact(db, { fromDate, toDate });
  for (const [custKey, impact] of impactMap.entries()) {
    // 1. Reduce component purchase quantities
    for (const [compKey, compData] of Object.entries(impact.consumedComponentMap)) {
      for (const [mapKey, item] of map.entries()) {
        const itemCustMatch =
          (item.customerId || "").toLowerCase().trim() === custKey ||
          (item.customerName || "").toLowerCase().trim() === custKey;
        const itemMatch =
          (item.itemId || "").toLowerCase().trim() === compKey ||
          (item.itemName || "").toLowerCase().trim() === compKey;

        if (itemCustMatch && itemMatch && compData.total_consumed_qty > 0) {
          const rawPurchQty = item.purchaseQty;
          const newPurchQty = Math.max(0, rawPurchQty - compData.total_consumed_qty);
          const balanceQty = newPurchQty - item.salesQty;
          const yetToPurchaseQty = Math.max(0, item.salesQty - newPurchQty);
          const yetToSaleQty = Math.max(0, newPurchQty - item.salesQty);
          const reconciledQty = Math.min(newPurchQty, item.salesQty);

          let status: MasterInventoryMismatchItem["status"] = "INACTIVE";
          if (newPurchQty === 0 && item.salesQty > 0) {
            status = "SALE ONLY — NO PURCHASE";
          } else if (item.salesQty === 0 && newPurchQty > 0) {
            status = "PURCHASE ONLY — NO SALE / INVOICE";
          } else if (balanceQty === 0 && newPurchQty > 0) {
            status = "RECONCILED";
          } else if (balanceQty < 0) {
            status = "SHORTAGE";
          } else if (balanceQty > 0) {
            status = "SURPLUS";
          }

          map.set(mapKey, {
            ...item,
            purchaseQty: newPurchQty,
            balanceQty,
            yetToPurchaseQty,
            yetToSaleQty,
            reconciledQty,
            status,
          });
        }
      }
    }

    // 2. Add generated composite purchase quantities
    for (const [genKey, genData] of Object.entries(impact.generatedCompositeMap)) {
      let found = false;
      for (const [mapKey, item] of map.entries()) {
        const itemCustMatch =
          (item.customerId || "").toLowerCase().trim() === custKey ||
          (item.customerName || "").toLowerCase().trim() === custKey;
        const itemMatch =
          (item.itemId || "").toLowerCase().trim() === genKey ||
          (item.itemName || "").toLowerCase().trim() === genKey;

        if (itemCustMatch && itemMatch) {
          found = true;
          const newPurchQty = item.purchaseQty + genData.total_generated_qty;
          const newPurchAmt = item.purchaseAmount + genData.total_material_cost;
          const balanceQty = newPurchQty - item.salesQty;
          const yetToPurchaseQty = Math.max(0, item.salesQty - newPurchQty);
          const yetToSaleQty = Math.max(0, newPurchQty - item.salesQty);
          const reconciledQty = Math.min(newPurchQty, item.salesQty);

          let status: MasterInventoryMismatchItem["status"] = "INACTIVE";
          if (newPurchQty === 0 && item.salesQty > 0) {
            status = "SALE ONLY — NO PURCHASE";
          } else if (item.salesQty === 0 && newPurchQty > 0) {
            status = "PURCHASE ONLY — NO SALE / INVOICE";
          } else if (balanceQty === 0 && newPurchQty > 0) {
            status = "RECONCILED";
          } else if (balanceQty < 0) {
            status = "SHORTAGE";
          } else if (balanceQty > 0) {
            status = "SURPLUS";
          }

          map.set(mapKey, {
            ...item,
            purchaseQty: newPurchQty,
            purchaseAmount: newPurchAmt,
            balanceQty,
            yetToPurchaseQty,
            yetToSaleQty,
            reconciledQty,
            status,
          });
        }
      }

      if (!found && genData.assemblies.length > 0) {
        const first = genData.assemblies[0];
        const asmRow = db
          .prepare("SELECT customer_id, customer_name, composite_item_id, composite_item_name, composite_sku FROM composite_assemblies WHERE assembly_id = ?")
          .get(first.assembly_id) as any;

        if (asmRow) {
          const key = `${asmRow.customer_id || asmRow.customer_name}:::${asmRow.composite_item_id || asmRow.composite_item_name}`;
          map.set(key, {
            customerId: asmRow.customer_id || "",
            customerName: asmRow.customer_name || "",
            itemId: asmRow.composite_item_id || "",
            itemName: asmRow.composite_item_name || "",
            sku: asmRow.composite_sku || "",
            unit: "Nos",
            purchaseQty: genData.total_generated_qty,
            purchaseAmount: genData.total_material_cost,
            avgPurchaseRate: genData.total_generated_qty > 0 ? genData.total_material_cost / genData.total_generated_qty : 0,
            purchaseRates: [first.cost_per_unit],
            singlePurchaseRate: first.cost_per_unit,
            billList: [],
            salesQty: 0,
            salesAmount: 0,
            avgSalesRate: 0,
            salesRates: [],
            singleSalesRate: null,
            invoiceList: [],
            balanceQty: genData.total_generated_qty,
            yetToPurchaseQty: 0,
            yetToSaleQty: genData.total_generated_qty,
            reconciledQty: 0,
            mismatchValue: 0,
            status: "PURCHASE ONLY — NO SALE / INVOICE",
            salesInvoiceCount: 0,
            purchaseBillCount: 0,
            invoiceNumbers: "",
            billNumbers: `ASM: ${first.assembly_number}`,
          });
        }
      }
    }
  }

  // Fetch latest purchase rate per (Customer + Item) in the selected period (Tier 1)
  const latestPeriodPurchases = db.prepare(`
    SELECT 
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as customerId,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customerName,
      COALESCE(pli.item_id, '') as itemId,
      COALESCE(pli.item_name, '') as itemName,
      pli.rate as rate,
      pb.date as billDate,
      pb.bill_number as billNumber,
      pb.vendor_name as vendorName,
      pb.bill_id as billId,
      pli.line_item_id as lineItemId
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND pli.rate > 0
      AND COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') NOT IN ('', 'CUSTOMER DETAILS MISSING')
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
    ORDER BY pb.date DESC, pb.bill_id DESC, pli.line_item_id DESC
  `).all(fromDate, toDate) as {
    customerId: string;
    customerName: string;
    itemId: string;
    itemName: string;
    rate: number;
    billDate: string;
    billNumber: string;
    vendorName: string;
  }[];

  const periodLatestPurchRateMap = new Map<string, { rate: number; date: string; billNumber: string; vendorName: string }>();
  for (const row of latestPeriodPurchases) {
    const key = `${row.customerId || row.customerName}:::${row.itemId || row.itemName}`;
    if (!periodLatestPurchRateMap.has(key)) {
      periodLatestPurchRateMap.set(key, {
        rate: Number(row.rate),
        date: row.billDate,
        billNumber: row.billNumber,
        vendorName: row.vendorName || "—",
      });
    }
  }

  // Prepared statement for historical purchase rate (Tier 2)
  const historicalRateStmt = db.prepare(`
    SELECT pli.rate, pb.date as billDate, pb.bill_number as billNumber, pb.vendor_name as vendorName
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE (pli.item_id = ? OR pli.item_name = ?)
      AND pli.rate > 0
      AND UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
    ORDER BY pb.date DESC, pb.bill_id DESC, pli.line_item_id DESC
    LIMIT 1
  `);

  let allItems = Array.from(map.values()).map(item => {
    const itemKey = `${item.customerId || item.customerName}:::${item.itemId || item.itemName}`;
    const isSvc = isService(item.itemId, item.itemName);
    const isExcl = isItemExcluded(item.customerId, item.itemId);

    let approxRefPurchaseRate: number | null = null;
    let approxRateBasis = "NO REFERENCE RATE";
    let approxRateDate: string | undefined = undefined;
    let approxRateBillNumber: string | undefined = undefined;
    let approxRateVendor: string | undefined = undefined;

    if (!isSvc && !isExcl) {
      // Tier 1: Latest period purchase rate for SAME Customer + Item
      const pRate = periodLatestPurchRateMap.get(itemKey);
      if (pRate && pRate.rate > 0) {
        approxRefPurchaseRate = pRate.rate;
        approxRateBasis = "LATEST CUSTOMER+ITEM PURCHASE IN PERIOD";
        approxRateDate = pRate.date;
        approxRateBillNumber = pRate.billNumber;
        approxRateVendor = pRate.vendorName;
      } else {
        // Tier 2: Latest historical purchase rate for SAME item from local SQLite
        const hRow = historicalRateStmt.get(item.itemId || "", item.itemName || "") as { rate: number; billDate: string; billNumber: string; vendorName: string } | undefined;
        if (hRow && Number(hRow.rate) > 0) {
          approxRefPurchaseRate = Number(hRow.rate);
          approxRateBasis = "LATEST HISTORICAL ITEM PURCHASE";
          approxRateDate = hRow.billDate;
          approxRateBillNumber = hRow.billNumber;
          approxRateVendor = hRow.vendorName;
        }
      }
    }

    let approxShortageValue: number | null = null;
    let approxSurplusValue: number | null = null;

    if (approxRefPurchaseRate !== null && approxRefPurchaseRate > 0 && !isSvc && !isExcl) {
      approxShortageValue = item.yetToPurchaseQty > 0 ? Math.round(item.yetToPurchaseQty * approxRefPurchaseRate * 100) / 100 : 0;
      approxSurplusValue = item.yetToSaleQty > 0 ? Math.round(item.yetToSaleQty * approxRefPurchaseRate * 100) / 100 : 0;
    } else {
      approxRefPurchaseRate = null;
      approxShortageValue = null;
      approxSurplusValue = null;
      approxRateBasis = "NO REFERENCE RATE";
      approxRateDate = undefined;
      approxRateBillNumber = undefined;
      approxRateVendor = undefined;
    }

    return {
      ...item,
      isExcluded: isExcl,
      approxRefPurchaseRate,
      approxShortageValue,
      approxSurplusValue,
      approxRateBasis,
      approxRateDate,
      approxRateBillNumber,
      approxRateVendor,
    };
  });

  // Normal reports: excluded items are permanently excluded
  allItems = allItems.filter(item => !item.isExcluded && !isItemExcluded(item.customerId, item.itemId));

  // Apply Customer Filter (Supports stable customerId or fallback customerName)
  if (filter.customerId && filter.customerId.trim()) {
    const targetCustId = filter.customerId.trim();
    allItems = allItems.filter(
      (item) => item.customerId === targetCustId || item.customerName.toLowerCase() === targetCustId.toLowerCase()
    );
  } else if (filter.customerName && filter.customerName.trim()) {
    const custFilter = filter.customerName.trim().toLowerCase();
    allItems = allItems.filter(
      (item) =>
        item.customerName.toLowerCase().includes(custFilter) ||
        item.customerId.toLowerCase() === custFilter
    );
  }

  // Apply Item Filter (Supports stable itemId or fallback itemName)
  if (filter.itemId && filter.itemId.trim()) {
    const targetItemId = filter.itemId.trim();
    allItems = allItems.filter(
      (item) => item.itemId === targetItemId || item.itemName.toLowerCase() === targetItemId.toLowerCase()
    );
  } else if (filter.itemName && filter.itemName.trim()) {
    const itmFilter = filter.itemName.trim().toLowerCase();
    allItems = allItems.filter(
      (item) =>
        item.itemName.toLowerCase().includes(itmFilter) ||
        item.itemId.toLowerCase() === itmFilter
    );
  }

  // Apply Search Filter
  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    allItems = allItems.filter(
      (item) =>
        item.customerName.toLowerCase().includes(q) ||
        item.itemName.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.itemId.toLowerCase().includes(q)
    );
  }

  // Filter Customer Details Missing records
  let filteredCustomerDetailsMissing = customerDetailsMissing;
  if ((filter.customerId && filter.customerId.trim()) || (filter.customerName && filter.customerName.trim())) {
    // When a specific customer is selected, missing customer lines have NO customer allocation
    filteredCustomerDetailsMissing = [];
  } else {
    if (filter.itemId && filter.itemId.trim()) {
      const targetItemId = filter.itemId.trim();
      filteredCustomerDetailsMissing = filteredCustomerDetailsMissing.filter(
        (cdm) => cdm.itemId === targetItemId || cdm.itemName.toLowerCase() === targetItemId.toLowerCase()
      );
    } else if (filter.itemName && filter.itemName.trim()) {
      const itmFilter = filter.itemName.trim().toLowerCase();
      filteredCustomerDetailsMissing = filteredCustomerDetailsMissing.filter(
        (cdm) => cdm.itemName.toLowerCase().includes(itmFilter) || cdm.itemId.toLowerCase() === itmFilter
      );
    }
    if (filter.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      filteredCustomerDetailsMissing = filteredCustomerDetailsMissing.filter(
        (cdm) =>
          cdm.billNumber.toLowerCase().includes(q) ||
          cdm.vendorName.toLowerCase().includes(q) ||
          cdm.itemName.toLowerCase().includes(q) ||
          cdm.sku.toLowerCase().includes(q) ||
          cdm.itemId.toLowerCase().includes(q)
      );
    }
  }

  // Segment into Operational Categories
  const reconciled = allItems.filter((i) => i.status === "RECONCILED");
  // Default All Mismatches: HIDES fully reconciled records
  const allMismatches = allItems.filter((i) => i.status !== "RECONCILED" && i.status !== "INACTIVE");
  const balanceItems = allItems.filter((i) => i.balanceQty !== 0);
  const yetToSale = allItems.filter((i) => i.purchaseQty > i.salesQty);
  const yetToPurchase = allItems.filter((i) => i.salesQty > i.purchaseQty);
  const purchaseOnly = allItems.filter((i) => i.purchaseQty > 0 && i.salesQty === 0);
  const saleOnly = allItems.filter((i) => i.salesQty > 0 && i.purchaseQty === 0);

  // Determine active tab items
  let displayItems: MasterInventoryMismatchItem[] = [];
  
  if (filter.operationalTabs && filter.operationalTabs.length > 0) {
    // Unique set to avoid duplicates if tabs overlap (e.g., YET_TO_SALE overlaps with PURCHASE_ONLY)
    const displaySet = new Set<MasterInventoryMismatchItem>();
    
    for (const item of allItems) {
      let matched = false;
      for (const tab of filter.operationalTabs) {
        if (tab === "ALL_MISMATCHES" && item.status !== "RECONCILED" && item.status !== "INACTIVE") matched = true;
        if (tab === "BALANCE" && item.balanceQty !== 0) matched = true;
        if (tab === "YET_TO_SALE" && item.purchaseQty > item.salesQty) matched = true;
        if (tab === "YET_TO_PURCHASE" && item.salesQty > item.purchaseQty) matched = true;
        if (tab === "PURCHASE_ONLY" && item.purchaseQty > 0 && item.salesQty === 0) matched = true;
        if (tab === "SALE_ONLY" && item.salesQty > 0 && item.purchaseQty === 0) matched = true;
        if (tab === "RECONCILED" && item.status === "RECONCILED") matched = true;
      }
      if (matched) displaySet.add(item);
    }
    displayItems = Array.from(displaySet);
  } else {
    // Legacy fallback
    const tab = filter.operationalTab || "ALL_MISMATCHES";
    switch (tab) {
      case "BALANCE":
        displayItems = balanceItems;
        break;
      case "YET_TO_SALE":
        displayItems = yetToSale;
        break;
      case "YET_TO_PURCHASE":
        displayItems = yetToPurchase;
        break;
      case "PURCHASE_ONLY":
        displayItems = purchaseOnly;
        break;
      case "SALE_ONLY":
        displayItems = saleOnly;
        break;
      case "RECONCILED":
        displayItems = reconciled;
        break;
      case "ALL_MISMATCHES":
      default:
        if (filter.customerId || filter.customerName || filter.itemId || filter.itemName) {
          displayItems = allItems;
        } else {
          displayItems = allMismatches;
        }
        break;
    }
  }

  // If status query parameter is also provided (e.g. legacy status filter)
  if (filter.status && filter.status !== "ALL" && filter.status !== "") {
    const s = filter.status.toUpperCase();
    displayItems = displayItems.filter((item) => item.status === s);
  }

  // Calculate Totals across all Customer-Item Mismatch Records
  const totals = {
    totalItems: allItems.length,
    shortageCount: yetToPurchase.length,
    surplusCount: yetToSale.length,
    reconciledCount: reconciled.length,
    totalPurchaseQty: allItems.reduce((sum, i) => sum + i.purchaseQty, 0),
    totalPurchaseAmount: allItems.reduce((sum, i) => sum + i.purchaseAmount, 0),
    totalSalesQty: allItems.reduce((sum, i) => sum + i.salesQty, 0),
    totalSalesAmount: allItems.reduce((sum, i) => sum + i.salesAmount, 0),
    netBalanceQty: allItems.reduce((sum, i) => sum + i.balanceQty, 0),
    totalYetToPurchaseQty: allItems.reduce((sum, i) => sum + i.yetToPurchaseQty, 0),
    totalYetToSaleQty: allItems.reduce((sum, i) => sum + i.yetToSaleQty, 0),
    totalReconciledQty: allItems.reduce((sum, i) => sum + i.reconciledQty, 0),
    netMismatchValue: 0,
    totalApproxShortageValue: Math.round(allItems.reduce((sum, i) => sum + (i.approxShortageValue || 0), 0) * 100) / 100,
    totalApproxSurplusValue: Math.round(allItems.reduce((sum, i) => sum + (i.approxSurplusValue || 0), 0) * 100) / 100,
  };

  // Query raw transaction lines for export (Single source lines)
  const allRawSalesLines = db.prepare(`
    SELECT 
      si.invoice_number as docNumber,
      si.date as date,
      si.customer_name as customerName,
      si.customer_id as customerId,
      sli.item_id as itemId,
      sli.item_name as itemName,
      COALESCE(sli.sku, '') as sku,
      sli.quantity as quantity,
      sli.rate as rate,
      sli.line_total as amount,
      sli.line_item_id as lineItemId,
      si.invoice_id as invoiceId
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND si.date >= ? AND si.date <= ?
  `).all(fromDate, toDate) as any[];

  const allRawPurchLines = db.prepare(`
    SELECT 
      pb.bill_number as docNumber,
      pb.date as date,
      pb.vendor_name as vendorName,
      pb.vendor_id as vendorId,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) as purchaseCustomerDetails,
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) as customerId,
      pli.item_id as itemId,
      pli.item_name as itemName,
      COALESCE(pli.sku, '') as sku,
      pli.quantity as quantity,
      pli.rate as rate,
      pli.line_total as amount,
      pli.customer_data_status as customerDataStatus,
      pli.line_item_id as lineItemId,
      pb.bill_id as billId
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
  `).all(fromDate, toDate) as any[];

  const rawSalesLines = allRawSalesLines.filter(s => isIncludedByClassification(s.itemId, s.itemName) && !isItemExcluded(s.customerId, s.itemId));
  const rawPurchLines = allRawPurchLines.filter(p => isIncludedByClassification(p.itemId, p.itemName) && !isItemExcluded(p.customerId, p.itemId));

  return {
    generatedAt: new Date().toISOString(),
    dataLastSynced: lastSyncTime,
    isOffline: false,
    financialYear: filter.financialYear || (filter.period === "PREVIOUS_FY" ? "2025-26" : "2026-27"),
    filter,
    organizationName: "Bansil Engineers Private Limited",
    organizationId: "774390949",
    items: displayItems,
    allMismatches,
    yetToSale,
    yetToPurchase,
    purchaseOnly,
    saleOnly,
    customerDetailsMissing: filteredCustomerDetailsMissing,
    reconciled,
    tabCounts: {
      allMismatches: allMismatches.length,
      balance: balanceItems.length,
      yetToSale: yetToSale.length,
      yetToPurchase: yetToPurchase.length,
      purchaseOnly: purchaseOnly.length,
      saleOnly: saleOnly.length,
      missingCustomer: filteredCustomerDetailsMissing.length,
      reconciled: reconciled.length,
      excludedCount: activeExclusions.length,
    },
    filterCounts: {
      allMismatches: allMismatches.length,
      balance: balanceItems.length,
      yetToSale: yetToSale.length,
      yetToPurchase: yetToPurchase.length,
      purchaseOnly: purchaseOnly.length,
      saleOnly: saleOnly.length,
      missingCustomer: filteredCustomerDetailsMissing.length,
      reconciled: reconciled.length,
      excludedCount: activeExclusions.length,
    },
    totals,
    rawPurchaseLines: rawPurchLines,
    rawSalesLines: rawSalesLines,
    filterOptions,
    transactionLines: [
      ...rawPurchLines.map(p => ({
        canonicalId: `purchase:${p.billId}:${p.lineItemId}`,
        type: "PURCHASE",
        billId: p.billId,
        lineItemId: p.lineItemId,
        docNumber: p.docNumber,
        documentNo: p.docNumber,
        date: p.date,
        customerName: p.purchaseCustomerDetails || "CUSTOMER DETAILS MISSING",
        customerId: p.customerId || "",
        customerVendor: p.purchaseCustomerDetails || "CUSTOMER DETAILS MISSING",
        vendorName: p.vendorName || "—",
        vendorId: p.vendorId || "",
        itemName: p.itemName,
        itemId: p.itemId,
        sku: p.sku,
        quantity: p.quantity,
        rate: p.rate,
        amount: p.amount,
        classification: isService(p.itemId, p.itemName) ? "SERVICE" : "MATERIAL",
        status: p.customerDataStatus || (p.purchaseCustomerDetails ? "VERIFIED" : "CUSTOMER_DETAILS_MISSING")
      })),
      ...rawSalesLines.map(s => ({
        canonicalId: `sales:${s.invoiceId}:${s.lineItemId}`,
        type: "SALE",
        invoiceId: s.invoiceId,
        lineItemId: s.lineItemId,
        docNumber: s.docNumber,
        documentNo: s.docNumber,
        date: s.date,
        customerName: s.customerName || "—",
        customerId: s.customerId || "",
        customerVendor: s.customerName || "—",
        vendorName: "—",
        itemName: s.itemName,
        itemId: s.itemId,
        sku: s.sku,
        quantity: s.quantity,
        rate: s.rate,
        amount: s.amount,
        classification: isService(s.itemId, s.itemName) ? "SERVICE" : "MATERIAL",
        status: "VERIFIED"
      }))
    ].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
  };
}

/**
 * Retrieves drilldown supporting invoices and bills for ONE Customer + ONE Item.
 * For Yet to Sale: shows ALL supporting purchase bills and any already-made sales invoices for SAME Customer + Item.
 * For Yet to Purchase: shows ALL supporting sales invoices and any booked purchases for SAME Customer + Item.
 * If no purchase exists: Purchase Status = "NOT YET BOOKED", Vendor = "NOT YET DETERMINED".
 */
export function getItemTransactionBreakdown(
  param1: string,
  param2?: string | ReconciliationFilter,
  param3?: ReconciliationFilter
): ItemTransactionBreakdown {
  const db = getDatabase();

  let customerIdOrName = "";
  let itemIdOrName = "";
  let filter: ReconciliationFilter = { period: "CURRENT_FY" };

  if (typeof param2 === "string") {
    customerIdOrName = param1;
    itemIdOrName = param2;
    filter = param3 || { period: "CURRENT_FY" };
  } else if (param1.includes(":::")) {
    const parts = param1.split(":::");
    customerIdOrName = parts[0];
    itemIdOrName = parts[1];
    filter = (param2 as ReconciliationFilter) || { period: "CURRENT_FY" };
  } else {
    itemIdOrName = param1;
    filter = (param2 as ReconciliationFilter) || { period: "CURRENT_FY" };
  }

  // Also respect explicit filter identifiers if provided
  if (!customerIdOrName && filter.customerId) {
    customerIdOrName = filter.customerId;
  } else if (!customerIdOrName && filter.customerName) {
    customerIdOrName = filter.customerName;
  }
  if (!itemIdOrName && filter.itemId) {
    itemIdOrName = filter.itemId;
  } else if (!itemIdOrName && filter.itemName) {
    itemIdOrName = filter.itemName;
  }

  const { fromDate, toDate } = resolveDateRange(filter);
  const activeExcludedItemIds = getActiveExcludedItemIds(db);

  // Query sales lines for SAME Customer + Item
  let salesQuery = `
    SELECT 
      sli.line_item_id as lineItemId,
      si.invoice_id as invoiceId,
      si.invoice_number as invoiceNumber,
      si.invoice_url as invoiceUrl,
      si.date as date,
      si.customer_name as customerName,
      si.customer_id as customerId,
      sli.quantity as quantity,
      sli.rate as rate,
      sli.line_total as amount,
      sli.item_id as itemId,
      sli.item_name as itemName,
      sli.sku as sku,
      sli.description as description
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND si.date >= ? AND si.date <= ?
      AND (sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `;
  const salesParams: string[] = [fromDate, toDate];

  if (filter.customerId && filter.customerName && filter.customerId !== filter.customerName) {
    salesQuery += " AND (si.customer_id = ? OR si.customer_name = ?)";
    salesParams.push(filter.customerId, filter.customerName);
  } else if (customerIdOrName) {
    salesQuery += " AND (si.customer_id = ? OR si.customer_name = ?)";
    salesParams.push(customerIdOrName, customerIdOrName);
  }
  if (filter.itemId && filter.itemName && filter.itemId !== filter.itemName) {
    salesQuery += " AND (sli.item_id = ? OR sli.item_name = ?)";
    salesParams.push(filter.itemId, filter.itemName);
  } else if (itemIdOrName) {
    salesQuery += " AND (sli.item_id = ? OR sli.item_name = ?)";
    salesParams.push(itemIdOrName, itemIdOrName);
  }
  salesQuery += " ORDER BY si.date ASC";

  const salesLines = db.prepare(salesQuery).all(...salesParams) as {
    lineItemId?: string;
    invoiceId: string;
    invoiceNumber: string;
    invoiceUrl?: string;
    date: string;
    customerName: string;
    customerId: string;
    quantity: number;
    rate: number;
    amount: number;
    itemId: string;
    itemName: string;
    sku: string;
    description?: string;
  }[];

  // Query purchase lines for SAME Customer + Item
  let purchaseQuery = `
    SELECT 
      pli.line_item_id as lineItemId,
      pb.bill_id as billId,
      pb.bill_number as billNumber,
      pb.bill_url as billUrl,
      pb.date as date,
      pb.vendor_name as vendorName,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) as purchaseCustomerDetails,
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) as customerId,
      pli.quantity as quantity,
      pli.rate as rate,
      pli.line_total as amount,
      pli.customer_data_status as customerDataStatus,
      pli.item_id as itemId,
      pli.item_name as itemName,
      pli.sku as sku,
      pli.description as description
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `;
  const purchaseParams: string[] = [fromDate, toDate];

  if (filter.customerId && filter.customerName && filter.customerId !== filter.customerName) {
    purchaseQuery += " AND (COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) = ? OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) = ? OR COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) = ? OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) = ?)";
    purchaseParams.push(filter.customerId, filter.customerName, filter.customerName, filter.customerId);
  } else if (customerIdOrName) {
    purchaseQuery += " AND (COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id) = ? OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name) = ?)";
    purchaseParams.push(customerIdOrName, customerIdOrName);
  }
  if (filter.itemId && filter.itemName && filter.itemId !== filter.itemName) {
    purchaseQuery += " AND (pli.item_id = ? OR pli.item_name = ?)";
    purchaseParams.push(filter.itemId, filter.itemName);
  } else if (itemIdOrName) {
    purchaseQuery += " AND (pli.item_id = ? OR pli.item_name = ?)";
    purchaseParams.push(itemIdOrName, itemIdOrName);
  }
  purchaseQuery += " ORDER BY pb.date ASC";

  const purchaseLines = db.prepare(purchaseQuery).all(...purchaseParams) as {
    lineItemId?: string;
    billId: string;
    billNumber: string;
    billUrl?: string;
    date: string;
    vendorName: string;
    purchaseCustomerDetails?: string;
    customerId: string;
    quantity: number;
    rate: number;
    amount: number;
    customerDataStatus?: string;
    itemId: string;
    itemName: string;
    sku: string;
    description?: string;
  }[];

  const totalPurchaseQty = purchaseLines.reduce((s, l) => s + l.quantity, 0);
  const totalPurchaseAmount = purchaseLines.reduce((s, l) => s + l.amount, 0);
  const totalSalesQty = salesLines.reduce((s, l) => s + l.quantity, 0);
  const totalSalesAmount = salesLines.reduce((s, l) => s + l.amount, 0);

  const balanceQty = totalPurchaseQty - totalSalesQty;
  const yetToPurchaseQty = Math.max(0, totalSalesQty - totalPurchaseQty);
  const yetToSaleQty = Math.max(0, totalPurchaseQty - totalSalesQty);
  const reconciledQty = Math.min(totalPurchaseQty, totalSalesQty);

  let status = "INACTIVE";
  if (totalPurchaseQty === 0 && totalSalesQty > 0) {
    status = "SALE ONLY — NO PURCHASE";
  } else if (totalSalesQty === 0 && totalPurchaseQty > 0) {
    status = "PURCHASE ONLY — NO SALE / INVOICE";
  } else if (balanceQty === 0 && totalPurchaseQty > 0) {
    status = "RECONCILED";
  } else if (balanceQty < 0) {
    status = "SHORTAGE";
  } else if (balanceQty > 0) {
    status = "SURPLUS";
  }

  const purchaseStatus = totalPurchaseQty > 0 ? "BOOKED" : "NOT YET BOOKED";
  const vendorStatus = totalPurchaseQty > 0 ? "DETERMINED" : "NOT YET DETERMINED";

  const firstSale = salesLines[0];
  const firstPurch = purchaseLines[0];

  let customerName = filter.customerName || firstSale?.customerName || firstPurch?.purchaseCustomerDetails;
  const customerId = filter.customerId || firstSale?.customerId || firstPurch?.customerId || customerIdOrName;
  let itemName = filter.itemName || firstSale?.itemName || firstPurch?.itemName;
  const resolvedItemId = filter.itemId || firstSale?.itemId || firstPurch?.itemId || itemIdOrName;
  let sku = filter.sku || firstSale?.sku || firstPurch?.sku || "";

  // If customerName is missing or matches customerId (e.g. numeric ID), lookup real customer name from DB
  if (!customerName || customerName === customerId) {
    const custRow = db.prepare(`
      SELECT customer_name FROM sales_invoices WHERE (customer_id = ? OR customer_name = ?) AND customer_name != '' LIMIT 1
    `).get(customerIdOrName, customerIdOrName) as { customer_name: string } | undefined;
    if (custRow?.customer_name) {
      customerName = custRow.customer_name;
    } else {
      const custRow2 = db.prepare(`
        SELECT COALESCE(purchase_line_customer_name, bbt_customer_name) as cust_name 
        FROM purchase_bill_line_items 
        WHERE (purchase_line_customer_id = ? OR bbt_customer_id = ? OR purchase_line_customer_name = ?) 
          AND COALESCE(purchase_line_customer_name, bbt_customer_name) != '' 
        LIMIT 1
      `).get(customerIdOrName, customerIdOrName, customerIdOrName) as { cust_name: string } | undefined;
      if (custRow2?.cust_name) {
        customerName = custRow2.cust_name;
      }
    }
  }
  if (!customerName) {
    customerName = customerIdOrName;
  }

  // If itemName is missing or matches itemId (numeric ID), lookup real item name & SKU from DB
  if (!itemName || itemName === resolvedItemId) {
    const itemRow = db.prepare(`
      SELECT item_name, sku FROM sales_invoice_line_items WHERE (item_id = ? OR item_name = ?) AND item_name != '' LIMIT 1
    `).get(itemIdOrName, itemIdOrName) as { item_name: string; sku?: string } | undefined;
    if (itemRow?.item_name) {
      itemName = itemRow.item_name;
      if (!sku && itemRow.sku) sku = itemRow.sku;
    } else {
      const itemRow2 = db.prepare(`
        SELECT item_name, sku FROM purchase_bill_line_items WHERE (item_id = ? OR item_name = ?) AND item_name != '' LIMIT 1
      `).get(itemIdOrName, itemIdOrName) as { item_name: string; sku?: string } | undefined;
      if (itemRow2?.item_name) {
        itemName = itemRow2.item_name;
        if (!sku && itemRow2.sku) sku = itemRow2.sku;
      }
    }
  }
  if (!itemName) {
    itemName = itemIdOrName;
  }

  const effectivePeriod = filter.financialYear || (filter.period === "PREVIOUS_FY" ? "2025-26" : filter.period === "CURRENT_FY" ? "2026-27" : filter.period) || "2026-27";

  // Check exclusion for this customer+item
  const exclusions = (db.prepare(`
    SELECT customer_id, item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE'
  `).all() || []) as Array<{ customer_id: string | null; item_id: string }>;

  const isExcluded = (resolvedItemId && activeExcludedItemIds.has(resolvedItemId.trim())) || exclusions.some((ex: { customer_id: string | null; item_id: string }) => {
    const matchCustomer = !ex.customer_id || ex.customer_id === customerId;
    const matchItem = ex.item_id === resolvedItemId;
    return matchCustomer && matchItem;
  });

  const serviceItemIds = getClassifiedServiceItemIds(db);
  const isSvc = (resolvedItemId && serviceItemIds.has(resolvedItemId)) || (itemName && serviceItemIds.has(itemName.toUpperCase().trim()));
  let approxRefPurchaseRate: number | null = null;
  let approxRateBasis = "NO REFERENCE RATE";
  let approxRateDate: string | undefined = undefined;
  let approxRateBillNumber: string | undefined = undefined;
  let approxRateVendor: string | undefined = undefined;

  if (!isSvc && !isExcluded) {
    const sortedPurchases = [...purchaseLines]
      .filter((p) => p.rate > 0)
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.billId || "").localeCompare(a.billId || "") || (b.lineItemId || "").localeCompare(a.lineItemId || ""));
    if (sortedPurchases.length > 0) {
      approxRefPurchaseRate = sortedPurchases[0].rate;
      approxRateBasis = "LATEST CUSTOMER+ITEM PURCHASE IN PERIOD";
      approxRateDate = sortedPurchases[0].date;
      approxRateBillNumber = sortedPurchases[0].billNumber;
      approxRateVendor = sortedPurchases[0].vendorName;
    } else {
      const hRow = db.prepare(`
        SELECT pli.rate, pb.date as billDate, pb.bill_number as billNumber, pb.vendor_name as vendorName
        FROM purchase_bill_line_items pli
        JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
        WHERE (pli.item_id = ? OR pli.item_name = ?)
          AND pli.rate > 0
          AND UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
        ORDER BY pb.date DESC, pb.bill_id DESC, pli.line_item_id DESC
        LIMIT 1
      `).get(resolvedItemId || "", itemName || "") as { rate: number; billDate: string; billNumber: string; vendorName: string } | undefined;

      if (hRow && Number(hRow.rate) > 0) {
        approxRefPurchaseRate = Number(hRow.rate);
        approxRateBasis = "LATEST HISTORICAL ITEM PURCHASE";
        approxRateDate = hRow.billDate;
        approxRateBillNumber = hRow.billNumber;
        approxRateVendor = hRow.vendorName;
      }
    }
  }

  let approxShortageValue: number | null = null;
  let approxSurplusValue: number | null = null;

  if (approxRefPurchaseRate !== null && approxRefPurchaseRate > 0 && !isSvc && !isExcluded) {
    approxShortageValue = yetToPurchaseQty > 0 ? Math.round(yetToPurchaseQty * approxRefPurchaseRate * 100) / 100 : 0;
    approxSurplusValue = yetToSaleQty > 0 ? Math.round(yetToSaleQty * approxRefPurchaseRate * 100) / 100 : 0;
  } else {
    approxRefPurchaseRate = null;
    approxShortageValue = null;
    approxSurplusValue = null;
    approxRateBasis = "NO REFERENCE RATE";
    approxRateDate = undefined;
    approxRateBillNumber = undefined;
    approxRateVendor = undefined;
  }

  return {
    customerId: customerId || customerIdOrName,
    customerName: customerName || customerIdOrName,
    itemId: resolvedItemId || itemIdOrName,
    itemName: itemName || itemIdOrName,
    sku: sku || "",
    unit: "Nos",
    period: effectivePeriod,
    status,
    isExcluded,
    totalPurchaseQty,
    totalPurchaseAmount,
    totalSalesQty,
    totalSalesAmount,
    balanceQty,
    yetToPurchaseQty,
    yetToSaleQty,
    reconciledQty,
    purchaseStatus,
    vendorStatus,
    approxRefPurchaseRate,
    approxShortageValue,
    approxSurplusValue,
    approxRateBasis,
    approxRateDate,
    approxRateBillNumber,
    approxRateVendor,
    salesTransactions: salesLines.map((s) => ({
      lineItemId: s.lineItemId,
      invoiceId: s.invoiceId,
      invoiceNumber: s.invoiceNumber,
      invoiceUrl: s.invoiceUrl,
      date: s.date,
      customerName: s.customerName,
      itemName: s.itemName || itemName,
      sku: s.sku || sku,
      quantity: s.quantity,
      rate: s.rate,
      amount: s.amount,
      description: s.description || "",
      exclusionStatus: isExcluded ? "EXCLUDED" : "ACTIVE",
    })),
    purchaseTransactions: purchaseLines.map((p) => ({
      lineItemId: p.lineItemId,
      billId: p.billId,
      billNumber: p.billNumber,
      billUrl: p.billUrl,
      date: p.date,
      vendorName: p.vendorName,
      itemName: p.itemName || itemName,
      sku: p.sku || sku,
      purchaseCustomerDetails: p.purchaseCustomerDetails || "",
      quantity: p.quantity,
      rate: p.rate,
      amount: p.amount,
      description: p.description || "",
      customerDataStatus: p.customerDataStatus,
      exclusionStatus: isExcluded ? "EXCLUDED" : "ACTIVE",
    })),
  };
}
