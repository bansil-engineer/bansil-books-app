// ============================================================
// Bansil Books Analytics — Generalized Reconciliation Engine
// Phase-1: Single Calculation Engine for UI, Excel, and PDF
// ============================================================

import type {
  ReconciliationFilter,
  ReconciliationSummaryItem,
  ReconciliationTransactionDetail,
  CustomerDetailsMissingItem,
  ReconciliationReportResult,
} from "../types/reconciliation.ts";

const ZOHO_BASE_URL = "https://books.bansilengineers.com/app/774390949";

/**
 * Calculates reconciliation metrics for a single Customer + Item combination.
 */
export function calculateReconciliationMetrics(
  purchaseQty: number,
  salesQty: number
): {
  balanceQty: number;
  yetToPurchaseQty: number;
  yetToSaleQty: number;
  reconciledQty: number;
  status: ReconciliationSummaryItem["status"];
} {
  const balanceQty = purchaseQty - salesQty;
  const yetToPurchaseQty = Math.max(0, salesQty - purchaseQty);
  const yetToSaleQty = Math.max(0, purchaseQty - salesQty);
  const reconciledQty = Math.min(purchaseQty, salesQty);

  let status: ReconciliationSummaryItem["status"] = "INACTIVE";
  if (balanceQty === 0 && purchaseQty > 0) {
    status = "RECONCILED";
  } else if (balanceQty > 0) {
    status = "PENDING SALE";
  } else if (balanceQty < 0) {
    status = "SHORTFALL";
  }

  return {
    balanceQty,
    yetToPurchaseQty,
    yetToSaleQty,
    reconciledQty,
    status,
  };
}

/**
 * Historical validation test dataset (Section 20 Acceptance Test Case):
 * BBT Tap Off Box for FY 2025-26.
 * LANTEC: Purchase = 55, Sales = 55, Balance = 0
 * JSW MG MOTOR: Purchase = 16, Sales = 23, Balance = -7
 * Total: Purchase = 71, Sales = 78, Balance = -7
 */
export const BBT_TAP_OFF_BOX_FIXTURE = {
  summaryItems: [
    {
      customerId: "cust_lantec_01",
      customerName: "LANTEC INDUSTRIES PRIVATE LIMITED",
      itemId: "item_bbt_01",
      itemName: "BBT Tap Off Box",
      sku: "BBT-TOB-STD",
      purchaseQty: 55,
      purchaseAmount: 275000,
      salesQty: 55,
      salesAmount: 341000,
      ...calculateReconciliationMetrics(55, 55),
    },
    {
      customerId: "cust_jsw_02",
      customerName: "JSW MG MOTOR INDIA PRIVATE LIMITED",
      itemId: "item_bbt_01",
      itemName: "BBT Tap Off Box",
      sku: "BBT-TOB-STD",
      purchaseQty: 16,
      purchaseAmount: 80000,
      salesQty: 23,
      salesAmount: 142600,
      ...calculateReconciliationMetrics(16, 23),
    },
  ] as ReconciliationSummaryItem[],

  transactionDetails: [
    {
      transactionDate: "2025-05-12",
      financialYear: "2025-26",
      customerId: "cust_lantec_01",
      customerName: "LANTEC INDUSTRIES PRIVATE LIMITED",
      itemId: "item_bbt_01",
      itemName: "BBT Tap Off Box",
      sku: "BBT-TOB-STD",
      salesInvoiceNumber: "INV-2025-0101",
      salesInvoiceUrl: `${ZOHO_BASE_URL}#/invoices/inv_lantec_01`,
      salesQty: 55,
      salesAmount: 341000,
      purchaseBillNumber: "BILL-2025-0045",
      purchaseBillUrl: `${ZOHO_BASE_URL}#/bills/bill_lantec_01`,
      vendorName: "Schneider Electric India",
      purchaseQty: 55,
      purchaseAmount: 275000,
      customerDataStatus: "VERIFIED",
    },
    {
      transactionDate: "2025-07-20",
      financialYear: "2025-26",
      customerId: "cust_jsw_02",
      customerName: "JSW MG MOTOR INDIA PRIVATE LIMITED",
      itemId: "item_bbt_01",
      itemName: "BBT Tap Off Box",
      sku: "BBT-TOB-STD",
      salesInvoiceNumber: "INV-2025-0215",
      salesInvoiceUrl: `${ZOHO_BASE_URL}#/invoices/inv_jsw_01`,
      salesQty: 23,
      salesAmount: 142600,
      purchaseBillNumber: "BILL-2025-0112",
      purchaseBillUrl: `${ZOHO_BASE_URL}#/bills/bill_jsw_01`,
      vendorName: "Schneider Electric India",
      purchaseQty: 16,
      purchaseAmount: 80000,
      customerDataStatus: "VERIFIED",
    },
  ] as ReconciliationTransactionDetail[],

  exceptionItems: [
    {
      billDate: "2025-08-14",
      billNumber: "BILL-2025-0199",
      billUrl: `${ZOHO_BASE_URL}#/bills/bill_exc_01`,
      vendorName: "L&T Electrical & Automation",
      itemId: "item_bbt_01",
      itemName: "BBT Tap Off Box",
      sku: "BBT-TOB-STD",
      quantity: 5,
      purchaseAmount: 25000,
      description: "Line item entered without customer reference in Zoho Books",
      customerDataStatus: "CUSTOMER DETAILS MISSING",
    },
  ] as CustomerDetailsMissingItem[],
};

import { getDatabase, getSyncMetadata, getClassifiedServiceItemIds, getActiveExcludedItemIds } from "./db/database.ts";
import { getConfirmedAssemblyImpact } from "./composite-assembly-engine.ts";
import {
  getDateRangeForPeriod,
  parseFyToDateRange,
  type MasterPeriodOption,
} from "./date-period-utils.ts";

function resolveReconDateRange(filter: ReconciliationFilter): { fromDate: string; toDate: string } {
  if (filter.period) {
    const range = getDateRangeForPeriod(
      filter.period as MasterPeriodOption,
      filter.fromDate,
      filter.toDate
    );
    return { fromDate: range.fromDate, toDate: range.toDate };
  }
  if (filter.fromDate && filter.toDate) {
    return { fromDate: filter.fromDate, toDate: filter.toDate };
  }
  if (filter.financialYear) {
    if (filter.financialYear === "ALL") {
      return { fromDate: "2020-04-01", toDate: "2030-03-31" };
    }
    const range = parseFyToDateRange(filter.financialYear);
    return { fromDate: range.fromDate, toDate: range.toDate };
  }
  const currentFyRange = getDateRangeForPeriod("CURRENT_FY");
  return { fromDate: currentFyRange.fromDate, toDate: currentFyRange.toDate };
}

/**
 * Filter-aware report computation engine.
 * Powered by local SQLite cache — Never calls Zoho Books during reports or exports.
 */
export function generateReconciliationReport(
  filter: ReconciliationFilter
): ReconciliationReportResult {
  const { fromDate, toDate } = resolveReconDateRange(filter);
  let dataset = {
    summaryItems: [] as ReconciliationSummaryItem[],
    transactionDetails: [] as ReconciliationTransactionDetail[],
    exceptionItems: [] as CustomerDetailsMissingItem[],
  };
  let lastSyncTime = "2026-09-10T18:30:00Z";

  try {
    const db = getDatabase();
    const metaSync = getSyncMetadata(db, "last_successful_sync_time");
    if (metaSync) lastSyncTime = metaSync;

    const activeExcludedItemIds = getActiveExcludedItemIds(db);
    const isExcluded = (id?: string | null) => Boolean(id && activeExcludedItemIds.has(id.trim()));

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

    // 1. Query Sales Lines aggregated from SQLite
    const rawSalesRows = db.prepare(`
      SELECT 
        COALESCE(si.customer_name, '') as customerName,
        COALESCE(si.customer_id, '') as customerId,
        sli.item_id as itemId,
        sli.item_name as itemName,
        COALESCE(sli.sku, '') as sku,
        SUM(sli.quantity) as salesQty,
        SUM(sli.line_total) as salesAmount,
        GROUP_CONCAT(DISTINCT si.invoice_number) as invoiceNumbers
      FROM sales_invoice_line_items sli
      JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
      WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
        AND si.date >= ? AND si.date <= ?
      GROUP BY si.customer_id, si.customer_name, sli.item_id, sli.item_name, sli.sku
    `).all(fromDate, toDate) as {
      customerName: string;
      customerId: string;
      itemId: string;
      itemName: string;
      sku: string;
      salesQty: number;
      salesAmount: number;
      invoiceNumbers: string;
    }[];

    const salesRows = rawSalesRows.filter(r => isIncludedByClassification(r.itemId, r.itemName) && !isExcluded(r.itemId));

    // 2. Query Purchase Lines aggregated from SQLite
    const rawPurchRows = db.prepare(`
      SELECT 
        COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customerName,
        COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as customerId,
        pli.item_id as itemId,
        pli.item_name as itemName,
        COALESCE(pli.sku, '') as sku,
        SUM(pli.quantity) as purchaseQty,
        SUM(pli.line_total) as purchaseAmount,
        GROUP_CONCAT(DISTINCT pb.bill_number) as billNumbers
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
      customerName: string;
      customerId: string;
      itemId: string;
      itemName: string;
      sku: string;
      purchaseQty: number;
      purchaseAmount: number;
      billNumbers: string;
    }[];

    const purchRows = rawPurchRows.filter(r => isIncludedByClassification(r.itemId, r.itemName) && !isExcluded(r.itemId));

    // Combine by Customer + Item
    const map = new Map<string, ReconciliationSummaryItem>();

    for (const p of purchRows) {
      const key = `${p.customerId || p.customerName}:::${p.itemId || p.itemName}`;
      const metrics = calculateReconciliationMetrics(p.purchaseQty, 0);
      map.set(key, {
        customerId: p.customerId || "",
        customerName: p.customerName || "",
        itemId: p.itemId || "",
        itemName: p.itemName || "",
        sku: p.sku || "",
        purchaseQty: p.purchaseQty,
        purchaseAmount: p.purchaseAmount,
        salesQty: 0,
        salesAmount: 0,
        invoiceNumbers: "",
        billNumbers: p.billNumbers || "",
        ...metrics,
      });
    }

    for (const s of salesRows) {
      const key = `${s.customerId || s.customerName}:::${s.itemId || s.itemName}`;
      const existing = map.get(key);
      const purchQty = existing ? existing.purchaseQty : 0;
      const purchAmt = existing ? existing.purchaseAmount : 0;
      const billNumbers = existing ? (existing.billNumbers || "") : "";
      const metrics = calculateReconciliationMetrics(purchQty, s.salesQty);
      map.set(key, {
        customerId: s.customerId || (existing ? existing.customerId : ""),
        customerName: s.customerName || (existing ? existing.customerName : ""),
        itemId: s.itemId || (existing ? existing.itemId : ""),
        itemName: s.itemName || (existing ? existing.itemName : ""),
        sku: s.sku || (existing ? existing.sku : ""),
        purchaseQty: purchQty,
        purchaseAmount: purchAmt,
        salesQty: s.salesQty,
        salesAmount: s.salesAmount,
        invoiceNumbers: s.invoiceNumbers || "",
        billNumbers: billNumbers,
        ...metrics,
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
            const metrics = calculateReconciliationMetrics(newPurchQty, item.salesQty);
            map.set(mapKey, {
              ...item,
              purchaseQty: newPurchQty,
              ...metrics,
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
            const metrics = calculateReconciliationMetrics(newPurchQty, item.salesQty);
            map.set(mapKey, {
              ...item,
              purchaseQty: newPurchQty,
              purchaseAmount: newPurchAmt,
              ...metrics,
            });
          }
        }

        // If composite item had 0 direct purchases and 0 sales in period
        if (!found && genData.assemblies.length > 0) {
          const first = genData.assemblies[0];
          const asmRow = db
            .prepare("SELECT customer_id, customer_name, composite_item_id, composite_item_name, composite_sku FROM composite_assemblies WHERE assembly_id = ?")
            .get(first.assembly_id) as any;

          if (asmRow) {
            const key = `${asmRow.customer_id || asmRow.customer_name}:::${asmRow.composite_item_id || asmRow.composite_item_name}`;
            const metrics = calculateReconciliationMetrics(genData.total_generated_qty, 0);
            map.set(key, {
              customerId: asmRow.customer_id || "",
              customerName: asmRow.customer_name || "",
              itemId: asmRow.composite_item_id || "",
              itemName: asmRow.composite_item_name || "",
              sku: asmRow.composite_sku || "",
              purchaseQty: genData.total_generated_qty,
              purchaseAmount: genData.total_material_cost,
              salesQty: 0,
              salesAmount: 0,
              invoiceNumbers: "",
              billNumbers: `ASM: ${first.assembly_number}`,
              ...metrics,
            });
          }
        }
      }
    }

    // 3. Query Independent Source Transactions from SQLite (ZERO Cartesian join)
    const salesTxRows = db.prepare(`
      SELECT 
        si.date as transactionDate,
        ? as financialYear,
        si.customer_id as customerId,
        si.customer_name as customerName,
        sili.item_id as itemId,
        sili.item_name as itemName,
        COALESCE(sili.sku, '') as sku,
        si.invoice_number as salesInvoiceNumber,
        si.invoice_url as salesInvoiceUrl,
        sili.quantity as salesQty,
        sili.line_total as salesAmount,
        NULL as purchaseBillNumber,
        NULL as purchaseBillUrl,
        NULL as vendorName,
        0 as purchaseQty,
        0 as purchaseAmount,
        'VERIFIED' as customerDataStatus
      FROM sales_invoice_line_items sili
      JOIN sales_invoices si ON sili.invoice_id = si.invoice_id
      WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
        AND si.date >= ? AND si.date <= ?
    `).all(filter.financialYear || "FY 2025-26", fromDate, toDate) as unknown as ReconciliationTransactionDetail[];

    const purchTxRows = db.prepare(`
      SELECT 
        pb.date as transactionDate,
        ? as financialYear,
        COALESCE(pbli.purchase_line_customer_id, pbli.bbt_customer_id, '') as customerId,
        COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name, '') as customerName,
        pbli.item_id as itemId,
        pbli.item_name as itemName,
        COALESCE(pbli.sku, '') as sku,
        NULL as salesInvoiceNumber,
        NULL as salesInvoiceUrl,
        0 as salesQty,
        0 as salesAmount,
        pb.bill_number as purchaseBillNumber,
        pb.bill_url as purchaseBillUrl,
        pb.vendor_name as vendorName,
        pbli.quantity as purchaseQty,
        pbli.line_total as purchaseAmount,
        pbli.customer_data_status as customerDataStatus
      FROM purchase_bill_line_items pbli
      JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
      WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
        AND pb.date >= ? AND pb.date <= ?
        AND COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name, '') NOT IN ('', 'CUSTOMER DETAILS MISSING')
        AND pbli.customer_data_status != 'CUSTOMER DETAILS MISSING'
    `).all(filter.financialYear || "FY 2025-26", fromDate, toDate) as unknown as ReconciliationTransactionDetail[];

    const allTx = [...salesTxRows, ...purchTxRows]
      .filter(tx => isIncludedByClassification(tx.itemId, tx.itemName) && !isExcluded(tx.itemId))
      .sort((a, b) => (b.transactionDate || "").localeCompare(a.transactionDate || ""));

    // 4. Query Exceptions from SQLite
    const excRows = db.prepare(`
      SELECT 
        pb.date as billDate,
        pb.bill_number as billNumber,
        pb.bill_url as billUrl,
        pb.vendor_name as vendorName,
        pbli.item_id as itemId,
        pbli.item_name as itemName,
        COALESCE(pbli.sku, '') as sku,
        pbli.quantity as quantity,
        pbli.line_total as purchaseAmount,
        pbli.description as description,
        pbli.customer_data_status as customerDataStatus
      FROM purchase_bill_line_items pbli
      JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
      WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
        AND pb.date >= ? AND pb.date <= ?
        AND (
          COALESCE(pbli.purchase_line_customer_name, pbli.bbt_customer_name, '') IN ('', 'CUSTOMER DETAILS MISSING')
          OR pbli.customer_data_status = 'CUSTOMER DETAILS MISSING'
        )
    `).all(fromDate, toDate) as unknown as CustomerDetailsMissingItem[];

    dataset = {
      summaryItems: Array.from(map.values()),
      transactionDetails: allTx,
      exceptionItems: excRows.filter(e => isIncludedByClassification(e.itemId, e.itemName) && !isExcluded(e.itemId)),
    };
  } catch (err: unknown) {
    console.error("[ReconciliationEngine] Database query error:", err);
  }

  const normCustomer = (filter.customerName || filter.customerId || "").toLowerCase().trim();
  const normItem = (filter.itemName || filter.itemId || "").toLowerCase().trim();
  const normSearch = (filter.search || "").toLowerCase().trim();
  const normVendor = (filter.vendorName || "").toLowerCase().trim();
  const normStatus = (filter.status || "").toLowerCase().trim();

  // 1. Filter Summary Items
  const filteredSummary = dataset.summaryItems.filter((item) => {
    if (filter.customerId && filter.customerId.trim()) {
      const targetCustId = filter.customerId.trim();
      if (item.customerId !== targetCustId && item.customerName.toLowerCase() !== targetCustId.toLowerCase()) {
        return false;
      }
    } else if (normCustomer) {
      if (!item.customerName.toLowerCase().includes(normCustomer) && item.customerId.toLowerCase() !== normCustomer) {
        return false;
      }
    }

    if (filter.itemId && filter.itemId.trim()) {
      const targetItemId = filter.itemId.trim();
      if (item.itemId !== targetItemId && item.itemName.toLowerCase() !== targetItemId.toLowerCase()) {
        return false;
      }
    } else if (normItem) {
      if (!item.itemName.toLowerCase().includes(normItem) && item.itemId.toLowerCase() !== normItem) {
        return false;
      }
    }

    if (normStatus && item.status.toLowerCase() !== normStatus) {
      return false;
    }

    if (normSearch) {
      const matches =
        item.customerName.toLowerCase().includes(normSearch) ||
        item.itemName.toLowerCase().includes(normSearch) ||
        item.sku.toLowerCase().includes(normSearch) ||
        item.customerId.toLowerCase().includes(normSearch) ||
        item.itemId.toLowerCase().includes(normSearch);
      if (!matches) return false;
    }

    return true;
  });

  // 2. Filter Transaction Details
  const filteredTransactions = dataset.transactionDetails.filter((tx) => {
    if (filter.customerId && filter.customerId.trim()) {
      const targetCustId = filter.customerId.trim();
      if (tx.customerId !== targetCustId && tx.customerName.toLowerCase() !== targetCustId.toLowerCase()) {
        return false;
      }
    } else if (normCustomer) {
      if (!tx.customerName.toLowerCase().includes(normCustomer) && tx.customerId.toLowerCase() !== normCustomer) {
        return false;
      }
    }

    if (filter.itemId && filter.itemId.trim()) {
      const targetItemId = filter.itemId.trim();
      if (tx.itemId !== targetItemId && tx.itemName.toLowerCase() !== targetItemId.toLowerCase()) {
        return false;
      }
    } else if (normItem) {
      if (!tx.itemName.toLowerCase().includes(normItem) && tx.itemId !== filter.itemId) {
        return false;
      }
    }

    if (normVendor && tx.vendorName && !tx.vendorName.toLowerCase().includes(normVendor)) {
      return false;
    }
    if (normSearch) {
      const haystack = `${tx.customerName} ${tx.itemName} ${tx.salesInvoiceNumber || ""} ${tx.purchaseBillNumber || ""} ${tx.vendorName || ""}`.toLowerCase();
      if (!haystack.includes(normSearch)) return false;
    }
    return true;
  });

  // 3. Filter Exception Items
  const filteredExceptions = dataset.exceptionItems.filter((exc) => {
    // If a specific customer is selected, missing customer lines have NO customer allocation
    if ((filter.customerId && filter.customerId.trim()) || normCustomer) {
      return false;
    }
    if (filter.itemId && filter.itemId.trim()) {
      const targetItemId = filter.itemId.trim();
      if (exc.itemId !== targetItemId && exc.itemName.toLowerCase() !== targetItemId.toLowerCase()) {
        return false;
      }
    } else if (normItem) {
      if (!exc.itemName.toLowerCase().includes(normItem) && exc.itemId !== filter.itemId) {
        return false;
      }
    }
    if (normVendor && !exc.vendorName.toLowerCase().includes(normVendor)) {
      return false;
    }
    if (filter.fromDate && exc.billDate < filter.fromDate) {
      return false;
    }
    if (filter.toDate && exc.billDate > filter.toDate) {
      return false;
    }
    if (normSearch) {
      const haystack = `${exc.vendorName} ${exc.itemName} ${exc.billNumber}`.toLowerCase();
      if (!haystack.includes(normSearch)) return false;
    }
    return true;
  });

  // 4. Calculate Additive Totals (Decimal-safe)
  const totals = filteredSummary.reduce(
    (acc, curr) => ({
      purchaseQty: acc.purchaseQty + curr.purchaseQty,
      purchaseAmount: acc.purchaseAmount + curr.purchaseAmount,
      salesQty: acc.salesQty + curr.salesQty,
      salesAmount: acc.salesAmount + curr.salesAmount,
      balanceQty: acc.balanceQty + curr.balanceQty,
      yetToPurchaseQty: acc.yetToPurchaseQty + curr.yetToPurchaseQty,
      yetToSaleQty: acc.yetToSaleQty + curr.yetToSaleQty,
      reconciledQty: acc.reconciledQty + curr.reconciledQty,
    }),
    {
      purchaseQty: 0,
      purchaseAmount: 0,
      salesQty: 0,
      salesAmount: 0,
      balanceQty: 0,
      yetToPurchaseQty: 0,
      yetToSaleQty: 0,
      reconciledQty: 0,
    }
  );

  return {
    filter,
    generatedAt: new Date().toISOString(),
    dataLastSynced: lastSyncTime,
    organizationName: "BANSIL ENGINEER",
    organizationId: "774390949",
    summaryItems: filteredSummary,
    transactionDetails: filteredTransactions,
    exceptionItems: filteredExceptions,
    totals,
  };
}
