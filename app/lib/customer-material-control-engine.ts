// ============================================================
// Bansil Books Analytics — Customer Material Control Engine
// FOR SITE ENGINEER / SITE IN-CHARGE
// Pure Local SQLite Implementation · Zero Zoho API Calls
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./db/database.ts";
import { getCustomerDetailsData, getCustomerList } from "./customer-details-engine.ts";
import { getConfirmedAssemblyImpact } from "./composite-assembly-engine.ts";
import { parseFyToDateRange } from "./date-period-utils.ts";

export type SiteActionStatus =
  | "OPEN"
  | "MATERIAL TO PURCHASE"
  | "MATERIAL TO INVOICE"
  | "WAITING FOR SITE CONFIRMATION"
  | "WAITING FOR VENDOR"
  | "CLOSED";

export type MaterialReportStatus =
  | "BALANCE TO INVOICE"
  | "SHORTFALL TO PURCHASE"
  | "RECONCILED"
  | "PURCHASE ONLY"
  | "SALES ONLY";

export interface BalancePurchaseEvidenceLine {
  bill_date: string;
  bill_no: string;
  bill_id: string;
  vendor: string;
  vendor_id?: string;
  item: string;
  description: string;
  customer_details: string;
  purchase_qty: number;
  rate: number;
  taxable_value: number;
  matched_reconciled_qty: number;
  balance_qty_available: number;
  bill_url?: string;
}

export interface ShortfallSalesEvidenceLine {
  invoice_date: string;
  invoice_no: string;
  invoice_id: string;
  customer: string;
  customer_id: string;
  item: string;
  description: string;
  qty: number;
  rate: number;
  taxable_value: number;
  matched_purchase_qty: number;
  unsupported_shortfall_qty: number;
  invoice_url?: string;
}

export interface CustomerMaterialControlItem {
  sr: number;
  item_id: string;
  item_name: string;
  sku: string;
  description: string;
  purchase_qty: number;
  sales_qty: number;
  balance_qty: number;
  balance_material_to_invoice: number;
  shortfall_material_to_purchase: number;
  reconciled_qty: number;
  latest_purchase_rate: number | null;
  latest_purchase_doc?: string;
  latest_purchase_bill_id?: string;
  latest_purchase_date?: string;
  latest_purchase_vendor?: string;
  latest_purchase_basis?: string;
  approx_shortfall_value: number | null; // Label: APPROX. PURCHASE REQUIREMENT VALUE
  reference_sales_value: number | null; // Approx Balance Invoice Value (reference only)
  latest_sales_rate: number | null;
  status: MaterialReportStatus;

  // Composite assembly details
  raw_purchase_qty?: number;
  assembly_generated_qty?: number;
  assembly_consumed_qty?: number;
  is_composite?: boolean;

  // Site Action tracking
  site_remark?: string;
  action_required?: string;
  responsible_person?: string;
  target_date?: string;
  action_status: SiteActionStatus;

  // Evidence
  balance_evidence: BalancePurchaseEvidenceLine[];
  shortfall_evidence: ShortfallSalesEvidenceLine[];

  // Direct aliases for convenience & backwards compatibility
  balance_to_invoice: number;
  shortfall_to_purchase: number;
  purchase_evidence: BalancePurchaseEvidenceLine[];
  sales_evidence: ShortfallSalesEvidenceLine[];
  rate_hierarchy?: string;
}

export interface CustomerMaterialControlSummary {
  customer_id: string;
  customer_name: string;
  period_label: string;
  from_date: string;
  to_date: string;
  total_items: number;
  total_purchase_qty: number;
  total_sales_qty: number;
  total_balance_material_to_invoice: number;
  total_shortfall_material_to_purchase: number;
  total_reconciled_qty: number;
  total_approx_purchase_requirement_value: number;

  // Unmapped warning
  unmapped_purchase_lines_count: number;
  unmapped_purchase_qty: number;
}

export interface CustomerMaterialControlReport {
  customer: {
    id: string;
    name: string;
    companyName?: string;
    gstin?: string;
    pan?: string;
    address?: string;
    phone?: string;
    email?: string;
    source: string;
  };
  summary: CustomerMaterialControlSummary;
  items: CustomerMaterialControlItem[];
}

export interface CustomerMaterialControlParams {
  customerId?: string;
  customerName?: string;
  period?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  itemSearch?: string;
  statusFilter?: string; // "ALL", "BALANCE_TO_INVOICE", "SHORTFALL_TO_PURCHASE", "RECONCILED", "ACTION_REQUIRED"
  vendorFilter?: string;
  actionStatusFilter?: string;
  showReconciled?: boolean;
}

/**
 * Ensures local site actions table exists.
 */
function ensureSiteActionsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_material_site_actions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      site_remark TEXT,
      action_required TEXT,
      responsible_person TEXT,
      target_date TEXT,
      action_status TEXT NOT NULL DEFAULT 'OPEN',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_site_actions_cust_item ON customer_material_site_actions(customer_id, item_id);
  `);
}

export interface SaveSiteActionInput {
  customerId?: string;
  customer_id?: string;
  itemId?: string;
  item_id?: string;
  itemName?: string;
  item_name?: string;
  siteRemark?: string;
  site_remark?: string;
  remark?: string;
  actionRequired?: string;
  action_required?: string;
  responsiblePerson?: string;
  responsible_person?: string;
  targetDate?: string;
  target_date?: string;
  actionStatus?: SiteActionStatus;
  action_status?: SiteActionStatus;
  status?: SiteActionStatus;
  financialYear?: string;
  financial_year?: string;
}

/**
 * Saves a local site action / remark for customer + item.
 */
export function saveSiteAction(
  db: DatabaseSync,
  data: SaveSiteActionInput
): { id: string; success: boolean } {
  ensureSiteActionsTable(db);
  const now = new Date().toISOString();
  const cid = data.customerId || data.customer_id || "";
  const iid = data.itemId || data.item_id || "";
  const remark = data.siteRemark ?? data.site_remark ?? data.remark ?? null;
  const actionReq = data.actionRequired ?? data.action_required ?? null;
  const respPerson = data.responsiblePerson ?? data.responsible_person ?? null;
  const targetDt = data.targetDate ?? data.target_date ?? null;
  const actStatus = (data.actionStatus || data.action_status || data.status || "OPEN") as SiteActionStatus;

  const id = `${cid}__${iid}`;

  db.prepare(`
    INSERT INTO customer_material_site_actions (
      id, customer_id, item_id, site_remark, action_required, responsible_person, target_date, action_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      site_remark = excluded.site_remark,
      action_required = excluded.action_required,
      responsible_person = excluded.responsible_person,
      target_date = excluded.target_date,
      action_status = excluded.action_status,
      updated_at = excluded.updated_at
  `).run(
    id,
    cid,
    iid,
    remark,
    actionReq,
    respPerson,
    targetDt,
    actStatus,
    now
  );

  return { id, success: true };
}

/**
 * Retrieves all saved site actions for a customer.
 */
export function getSiteActionsForCustomer(
  db: DatabaseSync,
  customerId: string
): Map<string, {
  site_remark?: string;
  action_required?: string;
  responsible_person?: string;
  target_date?: string;
  action_status: SiteActionStatus;
}> {
  ensureSiteActionsTable(db);
  const rows = db.prepare(`
    SELECT item_id, site_remark, action_required, responsible_person, target_date, action_status
    FROM customer_material_site_actions
    WHERE customer_id = ?
  `).all(customerId) as Array<{
    item_id: string;
    site_remark?: string;
    action_required?: string;
    responsible_person?: string;
    target_date?: string;
    action_status: SiteActionStatus;
  }>;

  const map = new Map<string, {
    site_remark?: string;
    action_required?: string;
    responsible_person?: string;
    target_date?: string;
    action_status: SiteActionStatus;
  }>();

  for (const r of rows) {
    map.set(r.item_id, {
      site_remark: r.site_remark || undefined,
      action_required: r.action_required || undefined,
      responsible_person: r.responsible_person || undefined,
      target_date: r.target_date || undefined,
      action_status: r.action_status || "OPEN",
    });
  }

  return map;
}

/**
 * Get a single site action for a customer and item.
 */
export function getSiteAction(
  db: DatabaseSync,
  customerId: string,
  itemId: string,
  financialYear?: string
): {
  id: number;
  site_remark?: string;
  action_required?: string;
  responsible_person?: string;
  target_date?: string;
  status: SiteActionStatus;
} | null {
  ensureSiteActionsTable(db);
  const row = db.prepare(`
    SELECT id, site_remark, action_required, responsible_person, target_date, action_status
    FROM customer_material_site_actions
    WHERE customer_id = ? AND item_id = ?
    LIMIT 1
  `).get(customerId, itemId) as {
    id: number;
    site_remark?: string;
    action_required?: string;
    responsible_person?: string;
    target_date?: string;
    action_status: SiteActionStatus;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    site_remark: row.site_remark,
    action_required: row.action_required,
    responsible_person: row.responsible_person,
    target_date: row.target_date,
    status: row.action_status,
  };
}

/**
 * Get unmapped purchase lines where customer details are missing.
 */
export function getCustomerMissingPurchaseLines(
  db: DatabaseSync,
  financialYear?: string
): {
  count: number;
  total_qty: number;
  lines: Array<{
    bill_date: string;
    bill_number: string;
    vendor_name: string;
    item_name: string;
    quantity: number;
    rate: number;
  }>;
} {
  const dates = parseFyToDateRange(financialYear || "2026-27");
  const fDate = dates.fromDate;
  const tDate = dates.toDate;

  const countRow = db.prepare(`
    SELECT 
      COUNT(DISTINCT pli.line_item_id) as unmapped_count,
      COALESCE(SUM(pli.quantity), 0) as unmapped_qty
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.customer_data_status = 'CUSTOMER DETAILS MISSING'
           OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') IN ('', 'CUSTOMER DETAILS MISSING'))
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `).get(fDate, tDate) as { unmapped_count: number; unmapped_qty: number } | undefined;

  const lines = db.prepare(`
    SELECT 
      pb.date as bill_date,
      pb.bill_number,
      COALESCE(pb.vendor_name, 'Unknown') as vendor_name,
      COALESCE(pli.item_name, 'Unknown') as item_name,
      COALESCE(pli.quantity, 0) as quantity,
      COALESCE(pli.rate, 0) as rate
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.customer_data_status = 'CUSTOMER DETAILS MISSING'
           OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') IN ('', 'CUSTOMER DETAILS MISSING'))
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    ORDER BY pb.date DESC
    LIMIT 100
  `).all(fDate, tDate) as Array<{
    bill_date: string;
    bill_number: string;
    vendor_name: string;
    item_name: string;
    quantity: number;
    rate: number;
  }>;

  return {
    count: countRow?.unmapped_count || 0,
    total_qty: Math.round((countRow?.unmapped_qty || 0) * 100) / 100,
    lines,
  };
}

/**
 * Computes Customer Material Control Report for Site Engineers.
 * Strictly Read-Only · Zero Zoho API calls.
 */
export function getCustomerMaterialControlReport(
  db: DatabaseSync,
  params: CustomerMaterialControlParams
): CustomerMaterialControlReport | null {
  ensureSiteActionsTable(db);

  // 1. Fetch baseline Customer 360 data to ensure 100% mathematical parity
  const c360 = getCustomerDetailsData(db, {
    customerId: params.customerId,
    customerName: params.customerName,
    financialYear: params.financialYear,
    period: params.period,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  if (!c360) {
    return null;
  }

  const cid = c360.customer.id || params.customerId || "";
  const cname = c360.customer.name || params.customerName || "";
  const fDate = c360.period.fromDate;
  const tDate = c360.period.toDate;
  const periodLabel = c360.period.financialYear || `${fDate} to ${tDate}`;

  // 2. Fetch unmapped purchase lines warning count and qty
  const unmappedRow = db.prepare(`
    SELECT 
      COUNT(DISTINCT pli.line_item_id) as unmapped_count,
      COALESCE(SUM(pli.quantity), 0) as unmapped_qty
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.customer_data_status = 'CUSTOMER DETAILS MISSING'
           OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') IN ('', 'CUSTOMER DETAILS MISSING'))
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
  `).get(fDate, tDate) as { unmapped_count: number; unmapped_qty: number } | undefined;

  const unmappedLinesCount = unmappedRow?.unmapped_count || 0;
  const unmappedQty = unmappedRow?.unmapped_qty || 0;

  // 3. Load saved site actions for this customer
  const siteActionsMap = getSiteActionsForCustomer(db, cid);

  // 4. Fetch all bill lines for this customer during period for evidence
  const purchaseBillLines = db.prepare(`
    SELECT 
      pb.date as bill_date,
      pb.bill_number as bill_no,
      pb.bill_id,
      pb.bill_url,
      pb.vendor_name as vendor,
      pb.vendor_id,
      COALESCE(pli.item_id, pli.item_name) as item_id,
      pli.item_name as item,
      COALESCE(pli.description, '') as description,
      COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') as customer_details,
      pli.quantity as purchase_qty,
      pli.rate,
      pli.line_total as taxable_value
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
    ORDER BY pb.date ASC, pb.bill_number ASC
  `).all(cid, cid, cname, cname, fDate, tDate) as Array<{
    bill_date: string;
    bill_no: string;
    bill_id: string;
    bill_url?: string;
    vendor: string;
    vendor_id?: string;
    item_id: string;
    item: string;
    description: string;
    customer_details: string;
    purchase_qty: number;
    rate: number;
    taxable_value: number;
  }>;

  // Group purchase lines by item_id
  const billLinesByItem = new Map<string, typeof purchaseBillLines>();
  for (const pl of purchaseBillLines) {
    const key = pl.item_id || pl.item;
    if (!billLinesByItem.has(key)) {
      billLinesByItem.set(key, []);
    }
    billLinesByItem.get(key)!.push(pl);
  }

  // 5. Fetch all sales invoice lines for this customer during period for evidence
  const salesInvoiceLines = db.prepare(`
    SELECT 
      si.date as invoice_date,
      si.invoice_number as invoice_no,
      si.invoice_id,
      si.invoice_url,
      si.customer_name as customer,
      si.customer_id,
      COALESCE(sli.item_id, sli.item_name) as item_id,
      sli.item_name as item,
      COALESCE(sli.description, '') as description,
      sli.quantity as qty,
      sli.rate,
      sli.line_total as taxable_value
    FROM sales_invoice_line_items sli
    JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
    WHERE UPPER(si.status) NOT IN ('VOID', 'DRAFT')
      AND (si.customer_id = ? OR si.customer_name = ?)
      AND si.date >= ? AND si.date <= ?
      AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    ORDER BY si.date ASC, si.invoice_number ASC
  `).all(cid, cname, fDate, tDate) as Array<{
    invoice_date: string;
    invoice_no: string;
    invoice_id: string;
    invoice_url?: string;
    customer: string;
    customer_id: string;
    item_id: string;
    item: string;
    description: string;
    qty: number;
    rate: number;
    taxable_value: number;
  }>;

  // Group sales lines by item_id
  const invoiceLinesByItem = new Map<string, typeof salesInvoiceLines>();
  for (const sl of salesInvoiceLines) {
    const key = sl.item_id || sl.item;
    if (!invoiceLinesByItem.has(key)) {
      invoiceLinesByItem.set(key, []);
    }
    invoiceLinesByItem.get(key)!.push(sl);
  }

  // 6. Map and calculate Customer Material Control Items
  const items: CustomerMaterialControlItem[] = [];

  let srCounter = 1;
  for (const it of c360.itemAnalysis) {
    const key = it.item_id || it.item_name;
    const pQty = Number(it.purchase_qty || 0);
    const sQty = Number(it.sales_qty || 0);

    // Business definitions from spec:
    // BALANCE MATERIAL TO INVOICE = MAX(Purchase Qty - Sales Qty, 0)
    const balanceToInvoice = Math.max(pQty - sQty, 0);

    // SHORTFALL MATERIAL TO PURCHASE = MAX(Sales Qty - Purchase Qty, 0)
    const shortfallToPurchase = Math.max(sQty - pQty, 0);

    // RECONCILED QTY = MIN(Purchase Qty, Sales Qty)
    const reconciledQty = Math.min(pQty, sQty);

    // BALANCE = Purchase Qty - Sales Qty
    const balanceQty = pQty - sQty;

    // Status:
    // BALANCE TO INVOICE when Purchase > Sales
    // SHORTFALL TO PURCHASE when Sales > Purchase
    // RECONCILED when Purchase = Sales and both > 0
    // PURCHASE ONLY when Purchase > 0 and Sales = 0
    // SALES ONLY when Sales > 0 and Purchase = 0
    let status: MaterialReportStatus = "RECONCILED";
    if (pQty > 0 && sQty === 0) {
      status = "PURCHASE ONLY";
    } else if (sQty > 0 && pQty === 0) {
      status = "SALES ONLY";
    } else if (pQty > sQty) {
      status = "BALANCE TO INVOICE";
    } else if (sQty > pQty) {
      status = "SHORTFALL TO PURCHASE";
    } else {
      status = "RECONCILED";
    }

    // Valuation
    const latestPurchaseRate = it.latest_purchase_rate > 0 ? it.latest_purchase_rate : null;
    const approxShortfallValue =
      shortfallToPurchase > 0 && latestPurchaseRate !== null
        ? Math.round(shortfallToPurchase * latestPurchaseRate * 100) / 100
        : null;

    const latestSalesRate = it.latest_sales_rate > 0 ? it.latest_sales_rate : null;
    const referenceSalesValue =
      balanceToInvoice > 0 && latestSalesRate !== null
        ? Math.round(balanceToInvoice * latestSalesRate * 100) / 100
        : null;

    // Build Balance Material Evidence (Purchase bill lines with matched vs available breakdown)
    const itemBillLines = billLinesByItem.get(key) || [];
    const balanceEvidence: BalancePurchaseEvidenceLine[] = [];
    let remSalesForMatching = sQty;

    for (const bl of itemBillLines) {
      const lineQty = Number(bl.purchase_qty || 0);
      const matched = Math.min(lineQty, remSalesForMatching);
      remSalesForMatching = Math.max(0, remSalesForMatching - matched);
      const available = Math.max(0, lineQty - matched);

      balanceEvidence.push({
        bill_date: bl.bill_date,
        bill_no: bl.bill_no,
        bill_id: bl.bill_id,
        vendor: bl.vendor,
        vendor_id: bl.vendor_id,
        item: bl.item,
        description: bl.description,
        customer_details: bl.customer_details,
        purchase_qty: lineQty,
        rate: Number(bl.rate || 0),
        taxable_value: Number(bl.taxable_value || 0),
        matched_reconciled_qty: matched,
        balance_qty_available: available,
        bill_url: bl.bill_url,
      });
    }

    // Build Shortfall Requirement Evidence (Sales invoice lines with matched vs shortfall breakdown)
    const itemInvLines = invoiceLinesByItem.get(key) || [];
    const shortfallEvidence: ShortfallSalesEvidenceLine[] = [];
    let remPurchaseForMatching = pQty;

    for (const il of itemInvLines) {
      const lineQty = Number(il.qty || 0);
      const matched = Math.min(lineQty, remPurchaseForMatching);
      remPurchaseForMatching = Math.max(0, remPurchaseForMatching - matched);
      const unsupported = Math.max(0, lineQty - matched);

      shortfallEvidence.push({
        invoice_date: il.invoice_date,
        invoice_no: il.invoice_no,
        invoice_id: il.invoice_id,
        customer: il.customer,
        customer_id: il.customer_id,
        item: il.item,
        description: il.description,
        qty: lineQty,
        rate: Number(il.rate || 0),
        taxable_value: Number(il.taxable_value || 0),
        matched_purchase_qty: matched,
        unsupported_shortfall_qty: unsupported,
        invoice_url: il.invoice_url,
      });
    }

    // Get saved site action
    const savedAction = siteActionsMap.get(it.item_id) || siteActionsMap.get(key);

    items.push({
      sr: srCounter++,
      item_id: it.item_id,
      item_name: it.item_name,
      sku: it.sku || "",
      description: it.description || "—",
      purchase_qty: pQty,
      sales_qty: sQty,
      balance_qty: balanceQty,
      balance_material_to_invoice: balanceToInvoice,
      shortfall_material_to_purchase: shortfallToPurchase,
      reconciled_qty: reconciledQty,
      latest_purchase_rate: latestPurchaseRate,
      latest_purchase_doc: it.latest_purchase_doc,
      latest_purchase_bill_id: it.latest_purchase_bill_id,
      latest_purchase_date: it.latest_purchase_date,
      latest_purchase_vendor: it.latest_purchase_vendor,
      latest_purchase_basis: it.latest_purchase_basis,
      approx_shortfall_value: approxShortfallValue,
      reference_sales_value: referenceSalesValue,
      latest_sales_rate: latestSalesRate,
      status,

      raw_purchase_qty: it.raw_purchase_qty,
      assembly_generated_qty: it.assembly_generated_qty,
      assembly_consumed_qty: it.assembly_consumed_qty,
      is_composite: it.is_composite_assembled || it.is_component_consumed,

      site_remark: savedAction?.site_remark,
      action_required: savedAction?.action_required,
      responsible_person: savedAction?.responsible_person,
      target_date: savedAction?.target_date,
      action_status: savedAction?.action_status || "OPEN",

      balance_evidence: balanceEvidence,
      shortfall_evidence: shortfallEvidence,

      // Aliases
      balance_to_invoice: balanceToInvoice,
      shortfall_to_purchase: shortfallToPurchase,
      purchase_evidence: balanceEvidence,
      sales_evidence: shortfallEvidence,
      rate_hierarchy: it.latest_purchase_basis || "NOT_AVAILABLE",
    });
  }

  // 7. Calculate Top Summary KPIs across all items (before view filters)
  let totalPurchaseQty = 0;
  let totalSalesQty = 0;
  let totalBalanceToInvoice = 0;
  let totalShortfallToPurchase = 0;
  let totalReconciledQty = 0;
  let totalApproxPurchaseRequirementValue = 0;

  for (const it of items) {
    totalPurchaseQty += it.purchase_qty;
    totalSalesQty += it.sales_qty;
    totalBalanceToInvoice += it.balance_material_to_invoice;
    totalShortfallToPurchase += it.shortfall_material_to_purchase;
    totalReconciledQty += it.reconciled_qty;
    if (it.approx_shortfall_value !== null) {
      totalApproxPurchaseRequirementValue += it.approx_shortfall_value;
    }
  }

  const summary: CustomerMaterialControlSummary = {
    customer_id: cid,
    customer_name: cname,
    period_label: periodLabel,
    from_date: fDate,
    to_date: tDate,
    total_items: items.length,
    total_purchase_qty: Math.round(totalPurchaseQty * 100) / 100,
    total_sales_qty: Math.round(totalSalesQty * 100) / 100,
    total_balance_material_to_invoice: Math.round(totalBalanceToInvoice * 100) / 100,
    total_shortfall_material_to_purchase: Math.round(totalShortfallToPurchase * 100) / 100,
    total_reconciled_qty: Math.round(totalReconciledQty * 100) / 100,
    total_approx_purchase_requirement_value: Math.round(totalApproxPurchaseRequirementValue * 100) / 100,
    unmapped_purchase_lines_count: unmappedLinesCount,
    unmapped_purchase_qty: Math.round(unmappedQty * 100) / 100,
  };

  // 8. Apply Filtering
  let filteredItems = [...items];

  // Default / Status filtering:
  // "ACTION_REQUIRED" (Default): balance_material_to_invoice > 0 OR shortfall_material_to_purchase > 0
  const showReconciled = params.showReconciled === true;
  const statusFilt = (params.statusFilter || "").toUpperCase();

  if (statusFilt === "ACTION_REQUIRED" || (!statusFilt && !showReconciled)) {
    filteredItems = filteredItems.filter(
      (it) => it.balance_material_to_invoice > 0 || it.shortfall_material_to_purchase > 0
    );
  } else if (statusFilt === "BALANCE_TO_INVOICE") {
    filteredItems = filteredItems.filter((it) => it.balance_material_to_invoice > 0);
  } else if (statusFilt === "SHORTFALL_TO_PURCHASE") {
    filteredItems = filteredItems.filter((it) => it.shortfall_material_to_purchase > 0);
  } else if (statusFilt === "RECONCILED") {
    filteredItems = filteredItems.filter((it) => it.status === "RECONCILED");
  } else if (!showReconciled && statusFilt !== "ALL") {
    filteredItems = filteredItems.filter(
      (it) => it.balance_material_to_invoice > 0 || it.shortfall_material_to_purchase > 0
    );
  }

  // Item Search
  if (params.itemSearch) {
    const q = params.itemSearch.toLowerCase().trim();
    filteredItems = filteredItems.filter(
      (it) =>
        it.item_name.toLowerCase().includes(q) ||
        it.sku.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q)
    );
  }

  // Vendor Filter
  if (params.vendorFilter) {
    const vf = params.vendorFilter.toLowerCase().trim();
    filteredItems = filteredItems.filter(
      (it) =>
        (it.latest_purchase_vendor || "").toLowerCase().includes(vf) ||
        it.balance_evidence.some((be) => be.vendor.toLowerCase().includes(vf))
    );
  }

  // Action Status Filter
  if (params.actionStatusFilter && params.actionStatusFilter !== "ALL") {
    filteredItems = filteredItems.filter((it) => it.action_status === params.actionStatusFilter);
  }

  // Re-index Sr. after filter
  filteredItems = filteredItems.map((it, idx) => ({ ...it, sr: idx + 1 }));

  return {
    customer: c360.customer,
    summary,
    items: filteredItems,
  };
}

export interface PendingCustomerMeta {
  customer_id: string;
  customer_name: string;
  total_items: number;
  balance_material_to_invoice: number;
  shortfall_material_to_purchase: number;
  reconciled_qty: number;
  approx_purchase_requirement_value: number;
  balance_items_count: number;
  shortfall_items_count: number;
}

export interface AllPendingCustomersSummary {
  period_label: string;
  from_date: string;
  to_date: string;
  total_pending_customers: number;
  total_balance_material_to_invoice: number;
  total_shortfall_material_to_purchase: number;
  total_approx_purchase_requirement_value: number;
  unmapped_purchase_lines_count: number;
  unmapped_purchase_qty: number;
  customers: PendingCustomerMeta[];
}

/**
 * Discovers all customers who have pending material actions (Balance > 0 OR Shortfall > 0)
 * in the selected period, sorted by highest shortfall value, then highest balance qty, then name.
 */
export function getPendingCustomersSummary(
  db: DatabaseSync,
  params: {
    financialYear?: string;
    period?: string;
    fromDate?: string;
    toDate?: string;
  }
): AllPendingCustomersSummary {
  const customerList = getCustomerList(db, {
    financialYear: params.financialYear,
  });

  const pendingList: PendingCustomerMeta[] = [];
  let sumBalance = 0;
  let sumShortfall = 0;
  let sumApproxReq = 0;
  let periodLabel = params.financialYear || "ALL";
  let fDate = "";
  let tDate = "";
  let unmappedCount = 0;
  let unmappedQty = 0;

  for (const c of customerList) {
    const report = getCustomerMaterialControlReport(db, {
      customerId: c.id,
      customerName: c.name,
      financialYear: params.financialYear,
      period: params.period,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });

    if (!report) continue;

    if (!fDate) {
      fDate = report.summary.from_date;
      tDate = report.summary.to_date;
      periodLabel = report.summary.period_label;
      unmappedCount = report.summary.unmapped_purchase_lines_count;
      unmappedQty = report.summary.unmapped_purchase_qty;
    }

    const balanceItems = report.items.filter((it) => it.balance_material_to_invoice > 0.001);
    const shortfallItems = report.items.filter((it) => it.shortfall_material_to_purchase > 0.001);

    // Qualifies as pending if >= 1 item has balance > 0 OR shortfall > 0
    if (balanceItems.length > 0 || shortfallItems.length > 0) {
      pendingList.push({
        customer_id: report.customer.id,
        customer_name: report.customer.name,
        total_items: report.items.length,
        balance_material_to_invoice: report.summary.total_balance_material_to_invoice,
        shortfall_material_to_purchase: report.summary.total_shortfall_material_to_purchase,
        reconciled_qty: report.summary.total_reconciled_qty,
        approx_purchase_requirement_value: report.summary.total_approx_purchase_requirement_value,
        balance_items_count: balanceItems.length,
        shortfall_items_count: shortfallItems.length,
      });

      sumBalance += report.summary.total_balance_material_to_invoice;
      sumShortfall += report.summary.total_shortfall_material_to_purchase;
      sumApproxReq += report.summary.total_approx_purchase_requirement_value;
    }
  }

  // Sorting:
  // 1. Highest Shortfall Purchase Value
  // 2. Highest Balance to Invoice Qty
  // 3. Customer Name A-Z
  pendingList.sort((a, b) => {
    if (b.approx_purchase_requirement_value !== a.approx_purchase_requirement_value) {
      return b.approx_purchase_requirement_value - a.approx_purchase_requirement_value;
    }
    if (b.balance_material_to_invoice !== a.balance_material_to_invoice) {
      return b.balance_material_to_invoice - a.balance_material_to_invoice;
    }
    return a.customer_name.localeCompare(b.customer_name);
  });

  return {
    period_label: periodLabel,
    from_date: fDate,
    to_date: tDate,
    total_pending_customers: pendingList.length,
    total_balance_material_to_invoice: sumBalance,
    total_shortfall_material_to_purchase: sumShortfall,
    total_approx_purchase_requirement_value: sumApproxReq,
    unmapped_purchase_lines_count: unmappedCount,
    unmapped_purchase_qty: unmappedQty,
    customers: pendingList,
  };
}
