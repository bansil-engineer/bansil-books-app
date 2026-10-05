// ============================================================
// Bansil Books Analytics — Action Taken / Customer Mismatch Action Tracker Engine
// Pure Local SQLite Implementation · Zero Zoho API Calls · Read-Only Zoho Guard
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./db/database.ts";
import { parseFyToDateRange, getCurrentFinancialYear } from "./date-period-utils.ts";
import { getConfirmedAssemblyImpact } from "./composite-assembly-engine.ts";

export interface ActionTrackerItem {
  item_id: string;
  item_name: string;
  sku: string;
  description: string;
  purchase_qty: number;
  sales_qty: number;
  balance_qty: number;
  yet_to_purchase: number;
  yet_to_sale: number;
  reconciled_qty: number;
  latest_purchase_rate: number;
  latest_purchase_doc?: string;
  latest_purchase_bill_id?: string;
  latest_purchase_date?: string;
  latest_purchase_vendor?: string;
  latest_purchase_basis?: string;
  shortage_value: number | null;
  surplus_value: number | null;
  status: string; // SHORTAGE, SURPLUS, BALANCED, RECONCILED, PURCHASE ONLY, SALES ONLY
  is_reconciled: boolean;
  is_mismatch: boolean;
}

export interface CustomerActionRecord {
  customer_id: string;
  customer_name: string;
  total_items: number;
  reconciled_items: number;
  mismatch_items: number;
  shortage_items: number;
  surplus_items: number;
  purchase_only_items: number;
  sales_only_items: number;
  total_yet_to_purchase_qty: number;
  total_yet_to_sale_qty: number;
  approx_shortage_value: number;
  approx_surplus_value: number;
  customer_status: "ACTION REQUIRED" | "RECONCILED";
  priority: "HIGH" | "MEDIUM" | "LOW";
  action_status: string;
  action_taken: string;
  action_owner: string;
  next_follow_up_date: string;
  remarks: string;
  last_updated: string;
  items: ActionTrackerItem[];
}

export interface ActionTakenKPIs {
  customers_requiring_action: number;
  total_mismatch_items: number;
  total_shortage_qty: number;
  total_surplus_qty: number;
  approx_shortage_value: number;
  approx_surplus_value: number;
  total_customers_evaluated: number;
  fully_reconciled_customers: number;
}

export interface ActionTakenFilterOptions {
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  statusFilter?: "MISMATCH_ONLY" | "ALL" | "RECONCILED_ONLY";
  search?: string;
  itemSearch?: string;
  actionStatusFilter?: string;
  actionOwnerFilter?: string;
  mismatchTypeFilter?: "ALL" | "SHORTAGE" | "SURPLUS" | "PURCHASE_ONLY" | "SALES_ONLY";
  priorityFilter?: string;
}

export interface ActionTakenResult {
  kpis: ActionTakenKPIs;
  customers: CustomerActionRecord[];
  filterOptions: {
    owners: string[];
    statuses: string[];
    priorities: string[];
  };
  totalRecords: number;
  missingDetailsBadgeCount?: number;
}

export interface CustomerDetailsMissingItem {
  line_item_id: string;
  bill_id: string;
  bill_number: string;
  bill_date: string;
  bill_url?: string;
  vendor_id: string;
  vendor_name: string;
  item_id: string;
  item_name: string;
  sku: string;
  description: string;
  quantity: number;
  purchase_qty: number;
  rate: number;
  line_total: number;
  taxable_value: number;
  customer_details: string; // "MISSING"
  customer_data_status: string; // "CUSTOMER DETAILS MISSING"
  status: string; // "ACTION REQUIRED"
  reconciliation_status: "UNMAPPED_ONLY" | "PURCHASE_ONLY" | "SHORTAGE_RELATED";
  action_status: string;
  action_owner: string;
  next_follow_up_date: string;
  remarks: string;
  last_updated?: string;
}

export interface CustomerDetailsMissingKPIs {
  missing_lines: number;
  affected_bills: number;
  affected_items: number;
  purchase_qty_unmapped: number;
  unmapped_purchase_qty: number;
  taxable_value_unmapped: number;
  unmapped_taxable_value: number;
}

export interface CustomerDetailsMissingFilterOptions {
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  vendor?: string;
  item?: string;
  search?: string;
  reconStatus?: "ALL" | "UNMAPPED_ONLY" | "PURCHASE_ONLY" | "SHORTAGE_RELATED";
  reconStatusFilter?: "ALL" | "UNMAPPED_ONLY" | "PURCHASE_ONLY" | "SHORTAGE_RELATED";
  actionStatusFilter?: string;
}

export interface CustomerDetailsMissingResult {
  kpis: CustomerDetailsMissingKPIs;
  items: CustomerDetailsMissingItem[];
  filterOptions: {
    vendors: Array<{ id: string; name: string }>;
    items: Array<{ id: string; name: string }>;
    actionStatuses: string[];
    actionOwners: string[];
  };
  totalRecords: number;
  badgeCount: number;
}

export interface ActionHistoryEntry {
  id: string;
  customer_id: string;
  customer_name: string;
  item_id?: string;
  item_name?: string;
  action_status: string;
  action_taken: string;
  action_owner: string;
  priority: string;
  next_follow_up_date: string;
  remarks: string;
  created_at: string;
}

/**
 * Returns comprehensive Action Taken analysis for customers across the selected period.
 */
export function getActionTakenData(
  db: DatabaseSync = getDatabase(),
  options: ActionTakenFilterOptions = {}
): ActionTakenResult {
  const fy = options.financialYear || getCurrentFinancialYear();
  let fDate: string;
  let tDate: string;

  if (options.fromDate && options.toDate) {
    fDate = options.fromDate;
    tDate = options.toDate;
  } else {
    const range = parseFyToDateRange(fy);
    fDate = range.fromDate;
    tDate = range.toDate;
  }

  const statusFilter = options.statusFilter || "MISMATCH_ONLY";
  const search = (options.search || "").trim().toLowerCase();
  const itemSearch = (options.itemSearch || "").trim().toLowerCase();
  const actionStatusFilter = options.actionStatusFilter || "ALL";
  const actionOwnerFilter = options.actionOwnerFilter || "ALL";
  const mismatchTypeFilter = options.mismatchTypeFilter || "ALL";
  const priorityFilter = options.priorityFilter || "ALL";

  // 1. Fetch active exclusions
  const activeExcludedRows = db.prepare(`
    SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL
  `).all() as { item_id: string }[];
  const activeExcluded = new Set(activeExcludedRows.map(r => r.item_id.trim()));

  // 2. Fetch all sales lines in date range
  const salesLines = db.prepare(`
    SELECT 
      si.customer_id,
      si.customer_name,
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
      AND si.date >= ? AND si.date <= ?
      AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
      AND si.customer_name IS NOT NULL AND TRIM(si.customer_name) != ''
    ORDER BY si.date DESC, si.invoice_number DESC
  `).all(fDate, tDate) as Array<{
    customer_id: string;
    customer_name: string;
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

  // 3. Fetch all purchase lines in date range with line-level customer attribution
  const purchaseLines = db.prepare(`
    SELECT 
      pli.bill_id,
      COALESCE(pli.purchase_line_customer_id, pli.bbt_customer_id, '') as customer_id,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customer_name,
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
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
      AND COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') NOT IN ('', 'CUSTOMER DETAILS MISSING')
      AND pli.customer_data_status != 'CUSTOMER DETAILS MISSING'
    ORDER BY pb.date DESC, pb.bill_number DESC
  `).all(fDate, tDate) as Array<{
    bill_id: string;
    customer_id: string;
    customer_name: string;
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

  // 4. Prepared statement for Tier 2 historical fallback purchase rate
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

  // Group by customer -> item
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

  interface CustomerAccumulator {
    customer_id: string;
    customer_name: string;
    items: Map<string, ItemAccumulator>;
  }

  const customerMap = new Map<string, CustomerAccumulator>();

  const getOrCreateCustomer = (cid: string, cname: string): CustomerAccumulator => {
    const key = cid || cname;
    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customer_id: cid || cname,
        customer_name: cname || cid,
        items: new Map<string, ItemAccumulator>(),
      });
    }
    return customerMap.get(key)!;
  };

  // Populate purchase lines
  for (const pl of purchaseLines) {
    if (!pl.customer_name && !pl.customer_id) continue;
    const cust = getOrCreateCustomer(pl.customer_id, pl.customer_name);
    const itemKey = pl.item_id || pl.item_name;
    if (!cust.items.has(itemKey)) {
      cust.items.set(itemKey, {
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
    const it = cust.items.get(itemKey)!;
    it.purchase_qty += Number(pl.quantity || 0);
    it.purchase_taxable += Number(pl.line_total || 0);
    if (!it.latest_purchase_doc && pl.quantity > 0) {
      const effRate = pl.quantity > 0 ? pl.line_total / pl.quantity : pl.rate;
      it.latest_purchase_rate = effRate;
      it.latest_purchase_doc = pl.bill_number;
      it.latest_purchase_bill_id = pl.bill_id;
      it.latest_purchase_date = pl.date;
      it.latest_purchase_vendor = pl.vendor_name;
      it.latest_purchase_basis = "LATEST CUSTOMER+ITEM PURCHASE IN PERIOD";
    }
  }

  // Populate sales lines
  for (const sl of salesLines) {
    if (!sl.customer_name && !sl.customer_id) continue;
    const cust = getOrCreateCustomer(sl.customer_id, sl.customer_name);
    const itemKey = sl.item_id || sl.item_name;
    if (!cust.items.has(itemKey)) {
      cust.items.set(itemKey, {
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
    const it = cust.items.get(itemKey)!;
    it.sales_qty += Number(sl.quantity || 0);
    it.sales_taxable += Number(sl.line_total || 0);
    if (!it.latest_sales_doc && sl.quantity > 0) {
      const effRate = sl.quantity > 0 ? sl.line_total / sl.quantity : sl.rate;
      it.latest_sales_rate = effRate;
      it.latest_sales_doc = sl.invoice_number;
      it.latest_sales_date = sl.date;
    }
  }

  // 4b. Apply Confirmed Composite Assembly Impact
  const impactMap = getConfirmedAssemblyImpact(db, { fromDate: fDate, toDate: tDate });
  for (const [custKey, impact] of impactMap.entries()) {
    for (const [mapKey, cust] of customerMap.entries()) {
      const custMatch =
        (cust.customer_id || "").toLowerCase().trim() === custKey ||
        (cust.customer_name || "").toLowerCase().trim() === custKey;

      if (!custMatch) continue;

      // 1. Component consumption
      for (const [compKey, compData] of Object.entries(impact.consumedComponentMap)) {
        for (const [itemKey, it] of cust.items.entries()) {
          const itemMatch =
            (it.item_id || "").toLowerCase().trim() === compKey ||
            (it.item_name || "").toLowerCase().trim() === compKey;

          if (itemMatch && compData.total_consumed_qty > 0) {
            it.purchase_qty = Math.max(0, it.purchase_qty - compData.total_consumed_qty);
          }
        }
      }

      // 2. Composite generation
      for (const [genKey, genData] of Object.entries(impact.generatedCompositeMap)) {
        let found = false;
        for (const [itemKey, it] of cust.items.entries()) {
          const itemMatch =
            (it.item_id || "").toLowerCase().trim() === genKey ||
            (it.item_name || "").toLowerCase().trim() === genKey;

          if (itemMatch) {
            found = true;
            it.purchase_qty += genData.total_generated_qty;
            it.purchase_taxable += genData.total_material_cost;
            if (it.latest_purchase_rate === 0 && genData.assemblies.length > 0) {
              it.latest_purchase_rate = genData.assemblies[0].cost_per_unit;
              it.latest_purchase_basis = "MATERIAL REFERENCE COST (LOCAL COMPOSITE ASSEMBLY)";
              it.latest_purchase_doc = genData.assemblies[0].assembly_number;
              it.latest_purchase_date = genData.assemblies[0].assembly_date;
            }
          }
        }

        if (!found && genData.assemblies.length > 0) {
          const first = genData.assemblies[0];
          const asmRow = db
            .prepare("SELECT composite_item_id, composite_item_name, composite_sku FROM composite_assemblies WHERE assembly_id = ?")
            .get(first.assembly_id) as any;

          if (asmRow) {
            cust.items.set(asmRow.composite_item_id || genKey, {
              item_id: asmRow.composite_item_id || genKey,
              item_name: asmRow.composite_item_name || genKey,
              sku: asmRow.composite_sku || "",
              description: "Locally Assembled Composite Item",
              purchase_qty: genData.total_generated_qty,
              purchase_taxable: genData.total_material_cost,
              latest_purchase_rate: first.cost_per_unit,
              latest_purchase_basis: "MATERIAL REFERENCE COST (LOCAL COMPOSITE ASSEMBLY)",
              latest_purchase_doc: first.assembly_number,
              latest_purchase_date: first.assembly_date,
              sales_qty: 0,
              sales_taxable: 0,
              latest_sales_rate: 0,
            });
          }
        }
      }
    }
  }

  // 5. Fetch all existing action tracker rows
  const trackerRows = db.prepare(`
    SELECT * FROM customer_action_tracker
  `).all() as Array<{
    customer_id: string;
    customer_name: string;
    action_status: string;
    action_taken: string;
    action_owner: string;
    priority: string;
    next_follow_up_date: string;
    remarks: string;
    updated_at: string;
  }>;

  const trackerMap = new Map<string, typeof trackerRows[0]>();
  for (const tr of trackerRows) {
    trackerMap.set(tr.customer_id, tr);
  }

  // 6. Process Customer Records
  const allCustomerRecords: CustomerActionRecord[] = [];
  const distinctOwners = new Set<string>();
  const distinctStatuses = new Set<string>(["Open", "Follow-up Required", "Waiting for Purchase", "Waiting for Customer", "Waiting for Vendor", "Under Review", "Closed"]);
  const distinctPriorities = new Set<string>(["HIGH", "MEDIUM", "LOW"]);

  // Global KPIs across all evaluated customers in dataset
  let kpiCustRequiringAction = 0;
  let kpiTotalMismatchItems = 0;
  let kpiTotalShortageQty = 0;
  let kpiTotalSurplusQty = 0;
  let kpiApproxShortageValue = 0;
  let kpiApproxSurplusValue = 0;
  let kpiFullyReconciledCusts = 0;

  for (const custAcc of customerMap.values()) {
    const itemsList: ActionTrackerItem[] = [];

    let custYetToPurch = 0;
    let custYetToSale = 0;
    let custShortageVal = 0;
    let custSurplusVal = 0;
    let custShortageItemCount = 0;
    let custSurplusItemCount = 0;
    let custPurchaseOnlyCount = 0;
    let custSalesOnlyCount = 0;
    let custReconciledItemCount = 0;
    let custMismatchItemCount = 0;

    for (const itAcc of custAcc.items.values()) {
      const pQty = itAcc.purchase_qty;
      const sQty = itAcc.sales_qty;
      const balance = pQty - sQty;
      const yetToPurch = Math.max(0, sQty - pQty);
      const yetToSale = Math.max(0, pQty - sQty);
      const reconciled = Math.min(pQty, sQty);

      let latestPurchRate = itAcc.latest_purchase_rate;
      let latestPurchDoc = itAcc.latest_purchase_doc;
      let latestPurchBillId = itAcc.latest_purchase_bill_id;
      let latestPurchDate = itAcc.latest_purchase_date;
      let latestPurchVendor = itAcc.latest_purchase_vendor;
      let latestPurchBasis = itAcc.latest_purchase_basis;

      // Tier 2 Fallback if no purchase in period
      if (!latestPurchRate || latestPurchRate === 0) {
        const hRow = historicalRateStmt.get(itAcc.item_id || "", itAcc.item_name || "") as {
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
        custSalesOnlyCount++;
      } else if (sQty === 0 && pQty > 0) {
        status = "PURCHASE ONLY";
        custPurchaseOnlyCount++;
      } else if (balance === 0 && pQty > 0) {
        status = "RECONCILED";
      } else if (balance < 0) {
        status = "SHORTAGE";
        custShortageItemCount++;
      } else if (balance > 0) {
        status = "SURPLUS";
        custSurplusItemCount++;
      }

      const isReconciled = status === "RECONCILED" || status === "BALANCED";
      const isMismatch = !isReconciled;

      if (isReconciled) {
        custReconciledItemCount++;
      } else {
        custMismatchItemCount++;
      }

      const shortageValue = yetToPurch > 0 && latestPurchRate > 0
        ? Math.round(yetToPurch * latestPurchRate * 100) / 100
        : null;
      const surplusValue = yetToSale > 0 && latestPurchRate > 0
        ? Math.round(yetToSale * latestPurchRate * 100) / 100
        : null;

      custYetToPurch += yetToPurch;
      custYetToSale += yetToSale;
      if (shortageValue) custShortageVal += shortageValue;
      if (surplusValue) custSurplusVal += surplusValue;

      itemsList.push({
        item_id: itAcc.item_id,
        item_name: itAcc.item_name,
        sku: itAcc.sku,
        description: itAcc.description,
        purchase_qty: pQty,
        sales_qty: sQty,
        balance_qty: balance,
        yet_to_purchase: yetToPurch,
        yet_to_sale: yetToSale,
        reconciled_qty: reconciled,
        latest_purchase_rate: latestPurchRate,
        latest_purchase_doc: latestPurchDoc,
        latest_purchase_bill_id: latestPurchBillId,
        latest_purchase_date: latestPurchDate,
        latest_purchase_vendor: latestPurchVendor,
        latest_purchase_basis: latestPurchBasis,
        shortage_value: shortageValue,
        surplus_value: surplusValue,
        status,
        is_reconciled: isReconciled,
        is_mismatch: isMismatch,
      });
    }

    // Sort items: Mismatch items first, then alphabetical
    itemsList.sort((a, b) => {
      if (a.is_mismatch && !b.is_mismatch) return -1;
      if (!a.is_mismatch && b.is_mismatch) return 1;
      return a.item_name.localeCompare(b.item_name);
    });

    const isCustomerMismatch = custMismatchItemCount > 0;
    const customerStatus: "ACTION REQUIRED" | "RECONCILED" = isCustomerMismatch ? "ACTION REQUIRED" : "RECONCILED";

    if (isCustomerMismatch) {
      kpiCustRequiringAction++;
      kpiTotalMismatchItems += custMismatchItemCount;
      kpiTotalShortageQty += custYetToPurch;
      kpiTotalSurplusQty += custYetToSale;
      kpiApproxShortageValue += custShortageVal;
      kpiApproxSurplusValue += custSurplusVal;
    } else {
      kpiFullyReconciledCusts++;
    }

    const tracker = trackerMap.get(custAcc.customer_id) || trackerMap.get(custAcc.customer_name);
    const actionStatus = tracker?.action_status || "Open";
    const actionTaken = tracker?.action_taken || "";
    const actionOwner = tracker?.action_owner || "";
    const priority = (tracker?.priority as "HIGH" | "MEDIUM" | "LOW") || "MEDIUM";
    const nextFollowUpDate = tracker?.next_follow_up_date || "";
    const remarks = tracker?.remarks || "";
    const lastUpdated = tracker?.updated_at || "";

    if (actionOwner) distinctOwners.add(actionOwner);
    if (actionStatus) distinctStatuses.add(actionStatus);

    allCustomerRecords.push({
      customer_id: custAcc.customer_id,
      customer_name: custAcc.customer_name,
      total_items: itemsList.length,
      reconciled_items: custReconciledItemCount,
      mismatch_items: custMismatchItemCount,
      shortage_items: custShortageItemCount,
      surplus_items: custSurplusItemCount,
      purchase_only_items: custPurchaseOnlyCount,
      sales_only_items: custSalesOnlyCount,
      total_yet_to_purchase_qty: custYetToPurch,
      total_yet_to_sale_qty: custYetToSale,
      approx_shortage_value: Math.round(custShortageVal * 100) / 100,
      approx_surplus_value: Math.round(custSurplusVal * 100) / 100,
      customer_status: customerStatus,
      priority,
      action_status: actionStatus,
      action_taken: actionTaken,
      action_owner: actionOwner,
      next_follow_up_date: nextFollowUpDate,
      remarks,
      last_updated: lastUpdated,
      items: itemsList,
    });
  }

  // 7. Apply Filters to Customers List
  let filteredCustomers = allCustomerRecords;

  // Status Filter:
  // MISMATCH_ONLY (default): customers with >= 1 mismatch item
  // RECONCILED_ONLY: customers where all items are reconciled (0 mismatch items)
  // ALL: all customers
  if (statusFilter === "MISMATCH_ONLY") {
    filteredCustomers = filteredCustomers.filter(c => c.mismatch_items > 0);
  } else if (statusFilter === "RECONCILED_ONLY") {
    filteredCustomers = filteredCustomers.filter(c => c.mismatch_items === 0);
  }

  // Customer Search filter
  if (search) {
    filteredCustomers = filteredCustomers.filter(
      c => c.customer_name.toLowerCase().includes(search) || c.customer_id.toLowerCase().includes(search)
    );
  }

  // Global Item Search filter (Section 14: show only customers with matching mismatch items)
  if (itemSearch) {
    filteredCustomers = filteredCustomers.filter(c =>
      c.items.some(
        it =>
          it.is_mismatch &&
          (it.item_name.toLowerCase().includes(itemSearch) ||
            (it.sku && it.sku.toLowerCase().includes(itemSearch)) ||
            it.item_id.toLowerCase().includes(itemSearch) ||
            it.status.toLowerCase().includes(itemSearch))
      )
    );
  }

  // Mismatch Type Filter
  if (mismatchTypeFilter && mismatchTypeFilter !== "ALL") {
    const type = mismatchTypeFilter.toUpperCase();
    if (type === "SHORTAGE") {
      filteredCustomers = filteredCustomers.filter(c => c.shortage_items > 0);
    } else if (type === "SURPLUS") {
      filteredCustomers = filteredCustomers.filter(c => c.surplus_items > 0);
    } else if (type === "PURCHASE_ONLY") {
      filteredCustomers = filteredCustomers.filter(c => c.purchase_only_items > 0);
    } else if (type === "SALES_ONLY") {
      filteredCustomers = filteredCustomers.filter(c => c.sales_only_items > 0);
    }
  }

  // Action Status Filter
  if (actionStatusFilter && actionStatusFilter !== "ALL" && actionStatusFilter.trim() !== "") {
    const targetStatus = actionStatusFilter.trim().toLowerCase();
    filteredCustomers = filteredCustomers.filter(
      c => (c.action_status || "").trim().toLowerCase() === targetStatus
    );
  }

  // Action Owner Filter
  if (actionOwnerFilter && actionOwnerFilter !== "ALL" && actionOwnerFilter.trim() !== "") {
    const targetOwner = actionOwnerFilter.trim().toLowerCase();
    filteredCustomers = filteredCustomers.filter(
      c => (c.action_owner || "").trim().toLowerCase().includes(targetOwner)
    );
  }

  // Priority Filter
  if (priorityFilter && priorityFilter !== "ALL" && priorityFilter.trim() !== "") {
    const targetPriority = priorityFilter.trim().toUpperCase();
    filteredCustomers = filteredCustomers.filter(
      c => (c.priority || "").trim().toUpperCase() === targetPriority
    );
  }

  // Sort by mismatch count descending, then customer name ascending
  filteredCustomers.sort((a, b) => {
    if (b.mismatch_items !== a.mismatch_items) {
      return b.mismatch_items - a.mismatch_items;
    }
    return a.customer_name.localeCompare(b.customer_name);
  });

  return {
    kpis: {
      customers_requiring_action: kpiCustRequiringAction,
      total_mismatch_items: kpiTotalMismatchItems,
      total_shortage_qty: kpiTotalShortageQty,
      total_surplus_qty: kpiTotalSurplusQty,
      approx_shortage_value: Math.round(kpiApproxShortageValue * 100) / 100,
      approx_surplus_value: Math.round(kpiApproxSurplusValue * 100) / 100,
      total_customers_evaluated: customerMap.size,
      fully_reconciled_customers: kpiFullyReconciledCusts,
    },
    customers: filteredCustomers,
    filterOptions: {
      owners: Array.from(distinctOwners).filter(Boolean).sort(),
      statuses: Array.from(distinctStatuses),
      priorities: Array.from(distinctPriorities),
    },
    totalRecords: filteredCustomers.length,
    missingDetailsBadgeCount: getCustomerDetailsMissingCount(db, {
      financialYear: options.financialYear,
      fromDate: options.fromDate,
      toDate: options.toDate,
    }),
  };
}

/**
 * Saves/updates action tracker for a customer and logs audit history.
 */
export function saveCustomerAction(
  db: DatabaseSync = getDatabase(),
  payload: {
    customerId: string;
    customerName: string;
    itemId?: string;
    itemName?: string;
    actionStatus: string;
    actionTaken: string;
    actionOwner: string;
    priority?: string;
    nextFollowUpDate?: string;
    remarks?: string;
  }
): { success: boolean; id: string } {
  const cid = payload.customerId.trim();
  const cname = payload.customerName.trim();
  const status = payload.actionStatus || "Open";
  const taken = (payload.actionTaken || "").trim();
  const owner = (payload.actionOwner || "").trim();
  const priority = payload.priority || "MEDIUM";
  const followUp = (payload.nextFollowUpDate || "").trim();
  const remarks = (payload.remarks || "").trim();
  const now = new Date().toISOString();
  const trackerId = `act_trk_${cid}`;
  const historyId = `act_hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Upsert into customer_action_tracker
  db.prepare(`
    INSERT INTO customer_action_tracker (
      id, customer_id, customer_name, action_status, action_taken, action_owner, priority, next_follow_up_date, remarks, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(customer_id) DO UPDATE SET
      customer_name = excluded.customer_name,
      action_status = excluded.action_status,
      action_taken = excluded.action_taken,
      action_owner = excluded.action_owner,
      priority = excluded.priority,
      next_follow_up_date = excluded.next_follow_up_date,
      remarks = excluded.remarks,
      updated_at = excluded.updated_at
  `).run(trackerId, cid, cname, status, taken, owner, priority, followUp, remarks, now, now);

  // Append to customer_action_history
  db.prepare(`
    INSERT INTO customer_action_history (
      id, customer_id, customer_name, item_id, item_name, action_status, action_taken, action_owner, priority, next_follow_up_date, remarks, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    historyId,
    cid,
    cname,
    payload.itemId || null,
    payload.itemName || null,
    status,
    taken,
    owner,
    priority,
    followUp,
    remarks,
    now
  );

  return { success: true, id: trackerId };
}

/**
 * Retrieves audit history of actions for a given customer.
 */
export function getCustomerActionHistory(
  db: DatabaseSync = getDatabase(),
  customerId: string
): ActionHistoryEntry[] {
  const rows = db.prepare(`
    SELECT * FROM customer_action_history
    WHERE customer_id = ?
    ORDER BY created_at DESC
  `).all(customerId) as Array<{
    id: string;
    customer_id: string;
    customer_name: string;
    item_id: string | null;
    item_name: string | null;
    action_status: string;
    action_taken: string;
    action_owner: string;
    priority: string;
    next_follow_up_date: string;
    remarks: string;
    created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    item_id: r.item_id || undefined,
    item_name: r.item_name || undefined,
    action_status: r.action_status,
    action_taken: r.action_taken,
    action_owner: r.action_owner,
    priority: r.priority,
    next_follow_up_date: r.next_follow_up_date,
    remarks: r.remarks,
    created_at: r.created_at,
  }));
}

/**
 * Fast badge counter for missing customer details tab
 */
export function getCustomerDetailsMissingCount(
  db: DatabaseSync = getDatabase(),
  options: { financialYear?: string; fromDate?: string; toDate?: string } = {}
): number {
  let fromDate = options.fromDate;
  let toDate = options.toDate;
  if (!fromDate || !toDate) {
    const fy = options.financialYear || getCurrentFinancialYear();
    if (fy !== "ALL") {
      const range = parseFyToDateRange(fy);
      fromDate = range.fromDate;
      toDate = range.toDate;
    }
  }

  let query = `
    SELECT COUNT(*) as count
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    WHERE (
      pbli.bbt_customer_name IS NULL 
      OR TRIM(pbli.bbt_customer_name) = '' 
      OR pbli.customer_data_status = 'CUSTOMER DETAILS MISSING'
      OR pbli.customer_data_status = 'MISSING'
    )
    AND (
      pbli.item_id IS NULL 
      OR pbli.item_id NOT IN (
        SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL
      )
    )
    AND (
      pbli.item_name IS NULL 
      OR pbli.item_name NOT IN (
        SELECT item_name FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_name IS NOT NULL
      )
    )
  `;

  const queryParams: string[] = [];
  if (fromDate && toDate) {
    query += ` AND pb.date >= ? AND pb.date <= ?`;
    queryParams.push(fromDate, toDate);
  }

  try {
    const row = db.prepare(query).get(...queryParams) as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch (err) {
    console.error("Error getting missing customer count:", err);
    return 0;
  }
}

/**
 * Returns dedicated data for Action Taken > Customer Details Missing view.
 * Isolates Purchase Bill lines that lack line-level Customer Details.
 * Excludes globally excluded items.
 */
export function getCustomerDetailsMissingData(
  db: DatabaseSync = getDatabase(),
  options: CustomerDetailsMissingFilterOptions = {}
): CustomerDetailsMissingResult {
  // Determine date bounds
  let fromDate = options.fromDate;
  let toDate = options.toDate;
  if (!fromDate || !toDate) {
    const fy = options.financialYear || getCurrentFinancialYear();
    if (fy !== "ALL") {
      const range = parseFyToDateRange(fy);
      fromDate = range.fromDate;
      toDate = range.toDate;
    }
  }

  // Find sold item IDs within period to classify shortage-related vs purchase-only
  let salesItemQuery = `
    SELECT DISTINCT sili.item_id
    FROM sales_invoice_line_items sili
    JOIN sales_invoices si ON sili.invoice_id = si.invoice_id
    WHERE (sili.item_id IS NULL OR sili.item_id NOT IN (
      SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL
    ))
  `;
  const salesParams: string[] = [];
  if (fromDate && toDate) {
    salesItemQuery += ` AND si.date >= ? AND si.date <= ?`;
    salesParams.push(fromDate, toDate);
  }
  const soldItemRows = db.prepare(salesItemQuery).all(...salesParams) as Array<{ item_id: string }>;
  const soldItemIds = new Set(soldItemRows.map(r => r.item_id).filter(Boolean));

  // Query purchase lines where Customer Details is missing
  let query = `
    SELECT 
      pbli.line_item_id,
      pbli.bill_id,
      pb.bill_number,
      pb.date as bill_date,
      pb.bill_url,
      pb.vendor_id,
      pb.vendor_name,
      pbli.item_id,
      pbli.item_name,
      COALESCE(pbli.sku, '') as sku,
      COALESCE(pbli.description, '') as description,
      pbli.quantity,
      pbli.rate,
      pbli.line_total,
      pbli.customer_data_status,
      COALESCE(plt.action_status, 'Open') as action_status,
      COALESCE(plt.action_owner, '') as action_owner,
      COALESCE(plt.next_follow_up_date, '') as next_follow_up_date,
      COALESCE(plt.remarks, '') as remarks,
      plt.updated_at as last_updated
    FROM purchase_bill_line_items pbli
    JOIN purchase_bills pb ON pbli.bill_id = pb.bill_id
    LEFT JOIN purchase_line_action_tracker plt ON pbli.line_item_id = plt.line_item_id
    WHERE (
      pbli.bbt_customer_name IS NULL 
      OR TRIM(pbli.bbt_customer_name) = '' 
      OR pbli.customer_data_status = 'CUSTOMER DETAILS MISSING'
      OR pbli.customer_data_status = 'MISSING'
    )
    AND (
      pbli.item_id IS NULL 
      OR pbli.item_id NOT IN (
        SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL
      )
    )
    AND (
      pbli.item_name IS NULL 
      OR pbli.item_name NOT IN (
        SELECT item_name FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_name IS NOT NULL
      )
    )
  `;

  const queryParams: string[] = [];
  if (fromDate && toDate) {
    query += ` AND pb.date >= ? AND pb.date <= ?`;
    queryParams.push(fromDate, toDate);
  }

  query += ` ORDER BY pb.date DESC, pb.bill_number DESC, pbli.rowid ASC`;

  const rawRows = db.prepare(query).all(...queryParams) as Array<{
    line_item_id: string;
    bill_id: string;
    bill_number: string;
    bill_date: string;
    bill_url: string | null;
    vendor_id: string;
    vendor_name: string;
    item_id: string;
    item_name: string;
    sku: string;
    description: string;
    quantity: number;
    rate: number;
    line_total: number;
    customer_data_status: string;
    action_status: string;
    action_owner: string;
    next_follow_up_date: string;
    remarks: string;
    last_updated: string | null;
  }>;

  // Process and map rows
  const allItems: CustomerDetailsMissingItem[] = rawRows.map(r => {
    const isSold = soldItemIds.has(r.item_id);
    const reconStatus: "UNMAPPED_ONLY" | "PURCHASE_ONLY" | "SHORTAGE_RELATED" = isSold ? "SHORTAGE_RELATED" : "PURCHASE_ONLY";
    return {
      line_item_id: r.line_item_id,
      bill_id: r.bill_id,
      bill_number: r.bill_number,
      bill_date: r.bill_date,
      bill_url: r.bill_url || undefined,
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      item_id: r.item_id,
      item_name: r.item_name,
      sku: r.sku,
      description: r.description,
      quantity: Math.round(Number(r.quantity || 0) * 1000) / 1000,
      purchase_qty: Math.round(Number(r.quantity || 0) * 1000) / 1000,
      rate: Math.round(Number(r.rate || 0) * 100) / 100,
      line_total: Math.round(Number(r.line_total || 0) * 100) / 100,
      taxable_value: Math.round(Number(r.line_total || 0) * 100) / 100,
      customer_details: "MISSING",
      customer_data_status: "CUSTOMER DETAILS MISSING",
      status: "ACTION REQUIRED",
      reconciliation_status: reconStatus,
      action_status: r.action_status || "Open",
      action_owner: r.action_owner || "",
      next_follow_up_date: r.next_follow_up_date || "",
      remarks: r.remarks || "",
      last_updated: r.last_updated || undefined,
    };
  });

  // Collect filter options before secondary filtering
  const vendorMap = new Map<string, string>();
  const itemMap = new Map<string, string>();
  const actionStatusesSet = new Set<string>();
  const actionOwnersSet = new Set<string>();

  for (const item of allItems) {
    if (item.vendor_id && item.vendor_name) vendorMap.set(item.vendor_id, item.vendor_name);
    if (item.item_id && item.item_name) itemMap.set(item.item_id, item.item_name);
    if (item.action_status) actionStatusesSet.add(item.action_status);
    if (item.action_owner) actionOwnersSet.add(item.action_owner);
  }

  // Apply secondary filters
  let filteredItems = allItems;

  if (options.vendor) {
    const vMatch = options.vendor.toLowerCase().trim();
    filteredItems = filteredItems.filter(i => 
      i.vendor_id.toLowerCase() === vMatch || i.vendor_name.toLowerCase().includes(vMatch)
    );
  }

  if (options.item) {
    const iMatch = options.item.toLowerCase().trim();
    filteredItems = filteredItems.filter(i => 
      i.item_id.toLowerCase() === iMatch || i.item_name.toLowerCase().includes(iMatch)
    );
  }

  if (options.search) {
    const q = options.search.toLowerCase().trim();
    filteredItems = filteredItems.filter(i =>
      i.bill_number.toLowerCase().includes(q) ||
      i.vendor_name.toLowerCase().includes(q) ||
      i.item_name.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q)
    );
  }

  if (options.actionStatusFilter && options.actionStatusFilter !== "ALL") {
    filteredItems = filteredItems.filter(i => i.action_status === options.actionStatusFilter);
  }

  const reconFilter = options.reconStatus || options.reconStatusFilter || "UNMAPPED_ONLY";
  if (reconFilter === "PURCHASE_ONLY") {
    filteredItems = filteredItems.filter(i => i.reconciliation_status === "PURCHASE_ONLY");
  } else if (reconFilter === "SHORTAGE_RELATED") {
    filteredItems = filteredItems.filter(i => i.reconciliation_status === "SHORTAGE_RELATED");
  } // UNMAPPED_ONLY and ALL include all missing lines

  // Calculate KPIs over filtered items
  const distinctBills = new Set(filteredItems.map(i => i.bill_id));
  const distinctItems = new Set(filteredItems.map(i => i.item_id).filter(Boolean));
  const totalQty = filteredItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalTaxable = filteredItems.reduce((sum, i) => sum + i.line_total, 0);

  const kpis: CustomerDetailsMissingKPIs = {
    missing_lines: filteredItems.length,
    affected_bills: distinctBills.size,
    affected_items: distinctItems.size,
    purchase_qty_unmapped: Math.round(totalQty * 1000) / 1000,
    unmapped_purchase_qty: Math.round(totalQty * 1000) / 1000,
    taxable_value_unmapped: Math.round(totalTaxable * 100) / 100,
    unmapped_taxable_value: Math.round(totalTaxable * 100) / 100,
  };

  return {
    kpis,
    items: filteredItems,
    filterOptions: {
      vendors: Array.from(vendorMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      items: Array.from(itemMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      actionStatuses: Array.from(actionStatusesSet).sort(),
      actionOwners: Array.from(actionOwnersSet).sort(),
    },
    totalRecords: filteredItems.length,
    badgeCount: kpis.missing_lines,
  };
}

/**
 * Saves/updates action tracker note for a purchase line item.
 */
export function savePurchaseLineAction(
  db: DatabaseSync = getDatabase(),
  payload: {
    lineItemId: string;
    billId: string;
    actionStatus: string;
    actionOwner?: string;
    nextFollowUpDate?: string;
    remarks?: string;
  }
): { success: boolean; id: string } {
  const lid = payload.lineItemId.trim();
  const bid = payload.billId.trim();
  const status = payload.actionStatus || "Open";
  const owner = (payload.actionOwner || "").trim();
  const followUp = (payload.nextFollowUpDate || "").trim();
  const remarks = (payload.remarks || "").trim();
  const now = new Date().toISOString();
  const trackerId = `act_pline_${lid}`;

  db.prepare(`
    INSERT INTO purchase_line_action_tracker (
      id, line_item_id, bill_id, action_status, action_owner, next_follow_up_date, remarks, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(line_item_id) DO UPDATE SET
      bill_id = excluded.bill_id,
      action_status = excluded.action_status,
      action_owner = excluded.action_owner,
      next_follow_up_date = excluded.next_follow_up_date,
      remarks = excluded.remarks,
      updated_at = excluded.updated_at
  `).run(trackerId, lid, bid, status, owner, followUp, remarks, now, now);

  return { success: true, id: trackerId };
}
