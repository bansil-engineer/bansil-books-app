import { getAuditDatabase } from "../db/audit-database.ts";
import { readTokenStore } from "../zoho-token-store.ts";
import {
  listPurchaseOrders, getPurchaseOrder,
  listInvoices, getInvoice,
  listBills, getBill,
  listSalesOrders, getSalesOrder,
  getSalesOrderByNumber
} from "./accounts/zoho-read-transactions.ts";
import crypto from "crypto";
import { normalizeSoReference } from "./so-po-mapping.ts";
import {
  validateActiveMappingsForDocuments,
  type MappingValidationSummary,
} from "./manual-line-mapping-service.ts";
import {
  validateActiveInvoiceMappingsForDocuments,
  type InvoiceMappingValidationSummary,
} from "./invoice-line-mapping-service.ts";

export interface TargetedDocParam {
  type: "PO" | "BILL" | "INVOICE";
  id: string;
  number?: string;
}

export interface TargetedSyncResult {
  status: "SUCCESS" | "FAILED";
  documentType: "PO" | "BILL" | "INVOICE";
  documentId: string;
  documentNumber?: string;
  result: "NEW" | "UPDATED" | "UNCHANGED" | "FAILED";
  referenceRefreshed: boolean;
  referenceDocumentRefreshed: boolean;
  completedAt: string;
  error?: string;
  /** Phase-3: post-COMMIT manual SO↔PO mapping stale validation (local only) */
  mappingValidation?: MappingValidationSummary;
  /** R1C: post-COMMIT Invoice→SO mapping stale validation (local only) */
  invoiceMappingValidation?: InvoiceMappingValidationSummary;
}

export interface ApprovalPendingSyncOptions {
  db?: any;
  reader?: {
    listPurchaseOrders: (orgId: string, perPage?: number) => Promise<any>;
    getPurchaseOrder: (orgId: string, id: string) => Promise<any>;
    listBills: (orgId: string, perPage?: number) => Promise<any>;
    getBill: (orgId: string, id: string) => Promise<any>;
    listInvoices: (orgId: string, perPage?: number) => Promise<any>;
    getInvoice: (orgId: string, id: string) => Promise<any>;
    listSalesOrders: (orgId: string, perPage?: number) => Promise<any>;
    getSalesOrder: (orgId: string, id: string) => Promise<any>;
    getSalesOrderByNumber?: (orgId: string, soNumber: string) => Promise<any>;
  };
  orgId?: string;
  apiDomain?: string;
}

export interface ApprovalPendingSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  checked: number;
  /** Phase-3: post-COMMIT manual SO↔PO mapping stale validation (local only) */
  mappingValidation?: MappingValidationSummary;
  /** R1C: post-COMMIT Invoice→SO mapping stale validation (local only) */
  invoiceMappingValidation?: InvoiceMappingValidationSummary;
}

/**
 * Phase-3 (PHASE E): validate ACTIVE manual SO↔PO mappings touching the
 * documents whose line evidence was just COMMITted. Runs strictly after the
 * source transaction; uses committed local SQLite evidence only (no network,
 * no AI). A validation failure never rolls back source evidence — it is
 * surfaced through the returned summary (failed / error).
 */
function runPostCommitMappingValidation(
  db: any,
  organizationId: string,
  purchaseorderIds: string[],
  salesorderIds: string[]
): MappingValidationSummary {
  let summary: MappingValidationSummary;
  try {
    summary = validateActiveMappingsForDocuments(db, { organizationId, purchaseorderIds, salesorderIds });
  } catch (e: any) {
    summary = {
      checked: 0, stillValid: 0, markedReviewRequired: 0, missingLines: 0,
      failed: 1, error: e?.message || String(e),
    };
  }
  if (summary.failed > 0) {
    console.warn(`[approval-pending-sync] Manual mapping stale validation incomplete: ${summary.failed} failed — ${summary.error ?? "unknown error"}`);
  }
  return summary;
}

/**
 * R1C (PHASE E): validate ACTIVE manual Invoice→SO mappings touching the
 * documents whose line evidence was just COMMITted. Runs strictly after the
 * source transaction; uses committed local SQLite evidence only (no network,
 * no AI). A validation failure never rolls back source evidence — it is
 * surfaced through the returned summary (failed / error).
 */
function runPostCommitInvoiceMappingValidation(
  db: any,
  organizationId: string,
  invoiceIds: string[],
  salesorderIds: string[]
): InvoiceMappingValidationSummary {
  let summary: InvoiceMappingValidationSummary;
  try {
    summary = validateActiveInvoiceMappingsForDocuments(db, { organizationId, invoiceIds, salesorderIds });
  } catch (e: any) {
    summary = {
      checked: 0, stillValid: 0, markedReviewRequired: 0, missingLines: 0,
      failed: 1, error: e?.message || String(e),
    };
  }
  if (summary.failed > 0) {
    console.warn(`[approval-pending-sync] Invoice mapping stale validation incomplete: ${summary.failed} failed — ${summary.error ?? "unknown error"}`);
  }
  return summary;
}

export function extractSoRefFromPo(po: any): { soRefNumber: string | null; soRefId: string | null } {
  let soRefNumber: string | null = null;
  let soRefId: string | null = po?.salesorder_id || null;
  if (po?.custom_fields && Array.isArray(po.custom_fields)) {
    const f = po.custom_fields.find((cf: any) =>
      cf.label?.toLowerCase() === "sales order no" ||
      cf.label?.toLowerCase() === "reference so" ||
      cf.api_name === "cf_sales_order_no"
    );
    if (f && f.value) {
      soRefNumber = String(f.value).trim();
    }
  }
  return { soRefNumber, soRefId };
}

export function extractSoRefFromCustomFieldsJson(customFieldsJson: string | null | undefined): string | null {
  if (!customFieldsJson) return null;
  try {
    const cf = JSON.parse(customFieldsJson);
    if (Array.isArray(cf)) {
      const f = cf.find((item: any) =>
        item.label?.toLowerCase() === "sales order no" ||
        item.label?.toLowerCase() === "reference so" ||
        item.api_name === "cf_sales_order_no"
      );
      if (f && f.value) return String(f.value).trim();
    }
  } catch (e) {}
  return null;
}

function normalizeNarration(desc: any): string {
  if (desc === undefined || desc === null) return "";
  return String(desc).trim();
}

function resolveDescState(desc: any): string {
  if (desc !== undefined && desc !== null) {
    if (String(desc).trim() === "") {
      return "CAPTURED_EMPTY";
    }
    return String(desc);
  }
  if (desc === undefined) {
    return "SOURCE DOES NOT PROVIDE NARRATION";
  }
  return "CAPTURED_EMPTY";
}

function narrationMatches(dbDesc: any, newDesc: any): boolean {
  if (dbDesc === "SOURCE DOES NOT PROVIDE NARRATION" && newDesc === undefined) return true;
  if (dbDesc === "CAPTURED_EMPTY" && (newDesc === null || String(newDesc).trim() === "")) return true;
  return normalizeNarration(dbDesc) === normalizeNarration(newDesc);
}

function sourceUnit(line: any): string | null {
  return line?.unit ?? null;
}

export async function syncApprovalPending(
  period: any,
  options?: ApprovalPendingSyncOptions
): Promise<ApprovalPendingSyncResult> {
  let orgId = options?.orgId;
  let apiDomain = options?.apiDomain;

  if (!options?.reader) {
    const tokens = readTokenStore();
    if (!tokens || !tokens.access_token) {
      throw new Error("Zoho not connected");
    }
    orgId = orgId || tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "774390949";
    apiDomain = apiDomain || tokens.api_domain || "https://www.zohoapis.com";
  } else {
    orgId = orgId || "TEST_ORG";
    apiDomain = apiDomain || "https://test.zohoapis.com";
  }

  const db = options?.db || getAuditDatabase();
  const source_run_id = "APPROVAL_PENDING_ACTIVE";
  const fetchedAt = new Date().toISOString();

  const reader = options?.reader || {
    listPurchaseOrders,
    getPurchaseOrder,
    listBills,
    getBill,
    listInvoices,
    getInvoice,
    listSalesOrders,
    getSalesOrder,
  };

  // ============================================================
  // PHASE A: NETWORK WORK (ZOHO GET ONLY, ZERO SQLITE WRITE LOCK)
  // ============================================================
  let failed = 0;

  // 1. Fetch candidate lists from Zoho
  const poRes = await reader.listPurchaseOrders(orgId, 200);
  const billRes = await reader.listBills(orgId, 200);
  const invRes = await reader.listInvoices(orgId, 200);

  const pendingPOs: Array<{ row: any; po: any }> = [];
  const candidatePoIdsSeen = new Set<string>();

  for (const row of poRes.purchaseorders || []) {
    candidatePoIdsSeen.add(row.purchaseorder_id);
    if (row.status !== "pending_approval" && row.status !== "draft") continue;
    try {
      const detail = await reader.getPurchaseOrder(orgId, row.purchaseorder_id);
      if (detail.purchaseorder) {
        pendingPOs.push({ row, po: detail.purchaseorder });
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  const pendingBills: Array<{ row: any; bill: any }> = [];
  const candidateBillIdsSeen = new Set<string>();

  for (const row of billRes.bills || []) {
    candidateBillIdsSeen.add(row.bill_id);
    if (row.status !== "pending_approval" && row.status !== "draft" && row.status !== "open") continue;
    try {
      const detail = await reader.getBill(orgId, row.bill_id);
      if (detail.bill) {
        pendingBills.push({ row, bill: detail.bill });
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  const pendingInvoices: Array<{ row: any; inv: any }> = [];
  const candidateInvIdsSeen = new Set<string>();

  for (const row of invRes.invoices || []) {
    candidateInvIdsSeen.add(row.invoice_id);
    if (row.status !== "pending_approval" && row.status !== "draft") continue;
    try {
      const detail = await reader.getInvoice(orgId, row.invoice_id);
      if (detail.invoice) {
        pendingInvoices.push({ row, inv: detail.invoice });
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  // 2. Discover locally-pending documents that might have left pending status
  // (e.g. approved, rejected, voided, or deleted in Zoho)
  const locallyPendingPOs = db.prepare(`
    SELECT purchaseorder_id, status FROM audit_zoho_purchase_orders
    WHERE source_run_id = ? AND LOWER(status) IN ('pending_approval', 'draft')
  `).all(source_run_id) as Array<{ purchaseorder_id: string; status: string }>;

  const poStatusUpdates: Array<{ id: string; status: string }> = [];

  for (const localPO of locallyPendingPOs) {
    if (candidatePoIdsSeen.has(localPO.purchaseorder_id)) {
      // Check if status in list changed to non-pending
      const listMatch = (poRes.purchaseorders || []).find((p: any) => p.purchaseorder_id === localPO.purchaseorder_id);
      if (listMatch && listMatch.status !== "pending_approval" && listMatch.status !== "draft") {
        poStatusUpdates.push({ id: localPO.purchaseorder_id, status: listMatch.status });
      }
    } else {
      // Not in top 200 list - fetch directly to check current status
      try {
        const detail = await reader.getPurchaseOrder(orgId, localPO.purchaseorder_id);
        if (detail.purchaseorder) {
          if (detail.purchaseorder.status !== "pending_approval" && detail.purchaseorder.status !== "draft") {
            poStatusUpdates.push({ id: localPO.purchaseorder_id, status: detail.purchaseorder.status });
          } else {
            pendingPOs.push({ row: detail.purchaseorder, po: detail.purchaseorder });
          }
        }
      } catch (e: any) {
        if (e.message && e.message.includes("404")) {
          poStatusUpdates.push({ id: localPO.purchaseorder_id, status: "deleted" });
        }
      }
    }
  }

  const locallyPendingBills = db.prepare(`
    SELECT bill_id, status FROM audit_zoho_bills
    WHERE source_run_id = ? AND LOWER(status) IN ('pending_approval', 'draft')
  `).all(source_run_id) as Array<{ bill_id: string; status: string }>;

  const billStatusUpdates: Array<{ id: string; status: string }> = [];

  for (const localBill of locallyPendingBills) {
    if (candidateBillIdsSeen.has(localBill.bill_id)) {
      const listMatch = (billRes.bills || []).find((b: any) => b.bill_id === localBill.bill_id);
      if (listMatch && listMatch.status !== "pending_approval" && listMatch.status !== "draft" && listMatch.status !== "open") {
        billStatusUpdates.push({ id: localBill.bill_id, status: listMatch.status });
      }
    } else {
      try {
        const detail = await reader.getBill(orgId, localBill.bill_id);
        if (detail.bill) {
          if (detail.bill.status !== "pending_approval" && detail.bill.status !== "draft" && detail.bill.status !== "open") {
            billStatusUpdates.push({ id: localBill.bill_id, status: detail.bill.status });
          } else {
            pendingBills.push({ row: detail.bill, bill: detail.bill });
          }
        }
      } catch (e: any) {
        if (e.message && e.message.includes("404")) {
          billStatusUpdates.push({ id: localBill.bill_id, status: "deleted" });
        }
      }
    }
  }

  const locallyPendingInvoices = db.prepare(`
    SELECT invoice_id, status FROM audit_zoho_invoices
    WHERE source_run_id = ? AND LOWER(status) IN ('pending_approval', 'draft')
  `).all(source_run_id) as Array<{ invoice_id: string; status: string }>;

  const invoiceStatusUpdates: Array<{ id: string; status: string }> = [];

  for (const localInv of locallyPendingInvoices) {
    if (candidateInvIdsSeen.has(localInv.invoice_id)) {
      const listMatch = (invRes.invoices || []).find((i: any) => i.invoice_id === localInv.invoice_id);
      if (listMatch && listMatch.status !== "pending_approval" && listMatch.status !== "draft") {
        invoiceStatusUpdates.push({ id: localInv.invoice_id, status: listMatch.status });
      }
    } else {
      try {
        const detail = await reader.getInvoice(orgId, localInv.invoice_id);
        if (detail.invoice) {
          if (detail.invoice.status !== "pending_approval" && detail.invoice.status !== "draft") {
            invoiceStatusUpdates.push({ id: localInv.invoice_id, status: detail.invoice.status });
          } else {
            pendingInvoices.push({ row: detail.invoice, inv: detail.invoice });
          }
        }
      } catch (e: any) {
        if (e.message && e.message.includes("404")) {
          invoiceStatusUpdates.push({ id: localInv.invoice_id, status: "deleted" });
        }
      }
    }
  }

  // 3. Collect reference document IDs
  const referencedSoIds = new Set<string>();
  const referencedPoIds = new Set<string>();

  for (const { bill } of pendingBills) {
    if (bill.purchaseorder_id) referencedPoIds.add(bill.purchaseorder_id);
  }
  for (const { inv } of pendingInvoices) {
    if (inv.salesorder_id) referencedSoIds.add(inv.salesorder_id);
  }
  for (const { po } of pendingPOs) {
    const { soRefNumber, soRefId } = extractSoRefFromPo(po);
    if (soRefId) referencedSoIds.add(soRefId);
    if (soRefNumber) {
      const row = db.prepare(`SELECT salesorder_id FROM audit_zoho_sales_orders WHERE salesorder_number = ? LIMIT 1`).get(soRefNumber) as any;
      if (row && row.salesorder_id) {
        referencedSoIds.add(row.salesorder_id);
      } else if (reader.getSalesOrderByNumber) {
        try {
          const searchRes = await reader.getSalesOrderByNumber(orgId, soRefNumber);
          const resolvedSoId = searchRes?.salesorder_id || searchRes?.salesorder?.salesorder_id;
          if (resolvedSoId) {
            referencedSoIds.add(resolvedSoId);
          }
        } catch (e) {}
      }
    }
  }

  const refPOs: any[] = [];
  for (const poId of referencedPoIds) {
    try {
      const detail = await reader.getPurchaseOrder(orgId, poId);
      if (detail.purchaseorder) refPOs.push(detail.purchaseorder);
    } catch (e) {
      failed++;
    }
  }

  const refSOs: any[] = [];
  for (const soId of referencedSoIds) {
    try {
      const detail = await reader.getSalesOrder(orgId, soId);
      if (detail.salesorder) refSOs.push(detail.salesorder);
    } catch (e) {
      failed++;
    }
  }

  // ============================================================
  // PHASE B: IN-MEMORY COMPARISON & CHANGE DETECTION
  // ============================================================
  const seenDocIds = new Set<string>();
  const docsToInsert: Array<{ type: "PO" | "BILL" | "INVOICE" | "SO"; data: any; lines: any[] }> = [];
  const docsToUpdate: Array<{ type: "PO" | "BILL" | "INVOICE" | "SO"; data: any; lines: any[] }> = [];
  let unchanged = 0;

  // Process POs
  for (const { row, po } of pendingPOs) {
    const docId = po.purchaseorder_id || row.purchaseorder_id;
    if (seenDocIds.has(docId)) continue;
    seenDocIds.add(docId);

    const existing = db.prepare(`
      SELECT * FROM audit_zoho_purchase_orders
      WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ? AND source_run_id = ?
      ORDER BY fetched_at DESC LIMIT 1
    `).get(orgId, docId, source_run_id) as any;

    if (!existing) {
      docsToInsert.push({ type: "PO", data: po, lines: po.line_items || [] });
      continue;
    }

    const existingLines = db.prepare(`
      SELECT * FROM audit_zoho_purchase_order_lines
      WHERE purchaseorder_id = ? AND source_run_id = ?
      ORDER BY rowid ASC
    `).all(docId, source_run_id) as any[];

    const incomingLines = po.line_items || [];
    const customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
    const deliveryCustomer = po.delivery_customer_name || null;

    const oldRef = extractSoRefFromCustomFieldsJson(existing.custom_fields_json);
    const newRef = extractSoRefFromPo(po).soRefNumber;
    const referenceChanged = (oldRef !== newRef);

    const headerChanged = (
      String(existing.status ?? "").toLowerCase() !== String(po.status ?? row.status ?? "").toLowerCase() ||
      String(existing.date ?? "") !== String(po.date ?? row.date ?? "") ||
      String(existing.delivery_date ?? "") !== String(po.delivery_date ?? "") ||
      Number(existing.total ?? 0) !== Number(po.total ?? row.total ?? 0) ||
      String(existing.vendor_id ?? "") !== String(po.vendor_id ?? row.vendor_id ?? "") ||
      String(existing.vendor_name ?? "") !== String(po.vendor_name ?? row.vendor_name ?? "") ||
      String(existing.delivery_customer_name ?? "") !== String(deliveryCustomer ?? "") ||
      String(existing.submitter_id ?? "") !== String(po.submitter_id ?? "") ||
      String(existing.submitted_by_name ?? "") !== String(po.submitted_by_name ?? "") ||
      String(existing.custom_fields_json ?? "") !== String(customFieldsJson ?? "")
    );

    let linesChanged = false;
    if (existingLines.length !== incomingLines.length) {
      linesChanged = true;
    } else {
      for (let i = 0; i < existingLines.length; i++) {
        const el = existingLines[i];
        const il = incomingLines[i];
        if (
          String(el.item_id ?? "") !== String(il.item_id ?? "") ||
          String(el.item_name ?? "") !== String(il.name ?? "") ||
          normalizeNarration(el.description) !== normalizeNarration(il.description) ||
          String(el.sku ?? "") !== String(il.sku ?? "") ||
          Number(el.quantity ?? 0) !== Number(il.quantity ?? 0) ||
          Number(el.rate ?? 0) !== Number(il.rate ?? 0) ||
          Number(el.amount ?? 0) !== Number(il.item_total ?? 0) ||
          String(el.unit ?? "") !== String(il.unit ?? "")
        ) {
          linesChanged = true;
          break;
        }
      }
    }

    if (referenceChanged || headerChanged || linesChanged) {
      docsToUpdate.push({ type: "PO", data: po, lines: incomingLines });
    } else {
      unchanged++;
    }
  }

  // Process Bills
  for (const { row, bill } of pendingBills) {
    const docId = bill.bill_id || row.bill_id;
    if (seenDocIds.has(docId)) continue;
    seenDocIds.add(docId);

    const existing = db.prepare(`
      SELECT * FROM audit_zoho_bills
      WHERE (organization_id = ? OR organization_id = '') AND bill_id = ? AND source_run_id = ?
      ORDER BY fetched_at DESC LIMIT 1
    `).get(orgId, docId, source_run_id) as any;

    if (!existing) {
      docsToInsert.push({ type: "BILL", data: bill, lines: bill.line_items || [] });
      continue;
    }

    const existingLines = db.prepare(`
      SELECT * FROM audit_zoho_bill_lines
      WHERE bill_id = ? AND source_run_id = ?
      ORDER BY rowid ASC
    `).all(docId, source_run_id) as any[];

    const incomingLines = bill.line_items || [];
    const customFieldsJson = bill.custom_fields ? JSON.stringify(bill.custom_fields) : null;

    const oldRef = existing.purchaseorder_id || null;
    const newRef = bill.purchaseorder_id || null;
    const referenceChanged = (oldRef !== newRef);

    const headerChanged = (
      String(existing.status ?? "").toLowerCase() !== String(bill.status ?? row.status ?? "").toLowerCase() ||
      String(existing.date ?? "") !== String(bill.date ?? row.date ?? "") ||
      String(existing.due_date ?? "") !== String(bill.due_date ?? "") ||
      Number(existing.total ?? 0) !== Number(bill.total ?? row.total ?? 0) ||
      Number(existing.balance ?? 0) !== Number(bill.balance ?? row.balance ?? 0) ||
      String(existing.vendor_id ?? "") !== String(bill.vendor_id ?? row.vendor_id ?? "") ||
      String(existing.vendor_name ?? "") !== String(bill.vendor_name ?? row.vendor_name ?? "") ||
      String(existing.purchaseorder_id ?? "") !== String(bill.purchaseorder_id ?? "") ||
      String(existing.submitter_id ?? "") !== String(bill.submitter_id ?? "") ||
      String(existing.submitted_by_name ?? "") !== String(bill.submitted_by_name ?? "") ||
      String(existing.custom_fields_json ?? "") !== String(customFieldsJson ?? "")
    );

    let linesChanged = false;
    if (existingLines.length !== incomingLines.length) {
      linesChanged = true;
    } else {
      for (let i = 0; i < existingLines.length; i++) {
        const el = existingLines[i];
        const il = incomingLines[i];
        if (
          String(el.item_id ?? "") !== String(il.item_id ?? "") ||
          String(el.item_name ?? "") !== String(il.name ?? "") ||
          normalizeNarration(el.description) !== normalizeNarration(il.description) ||
          Number(el.quantity ?? 0) !== Number(il.quantity ?? 0) ||
          Number(el.rate ?? 0) !== Number(il.rate ?? 0) ||
          Number(el.amount ?? 0) !== Number(il.item_total ?? 0)
        ) {
          linesChanged = true;
          break;
        }
      }
    }

    if (referenceChanged || headerChanged || linesChanged) {
      docsToUpdate.push({ type: "BILL", data: bill, lines: incomingLines });
    } else {
      unchanged++;
    }
  }

  // Process Invoices
  for (const { row, inv } of pendingInvoices) {
    const docId = inv.invoice_id || row.invoice_id;
    if (seenDocIds.has(docId)) continue;
    seenDocIds.add(docId);

    const existing = db.prepare(`
      SELECT * FROM audit_zoho_invoices
      WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ? AND source_run_id = ?
      ORDER BY fetched_at DESC LIMIT 1
    `).get(orgId, docId, source_run_id) as any;

    if (!existing) {
      docsToInsert.push({ type: "INVOICE", data: inv, lines: inv.line_items || [] });
      continue;
    }

    const existingLines = db.prepare(`
      SELECT * FROM audit_zoho_invoice_lines
      WHERE invoice_id = ? AND source_run_id = ?
      ORDER BY rowid ASC
    `).all(docId, source_run_id) as any[];

    const incomingLines = inv.line_items || [];
    const customFieldsJson = inv.custom_fields ? JSON.stringify(inv.custom_fields) : null;
    const deliveryCustomer = inv.shipping_address?.customer_name || inv.customer_name || null;

    const oldRef = existing.salesorder_id || null;
    const newRef = inv.salesorder_id || null;
    const referenceChanged = (oldRef !== newRef);

    const headerChanged = (
      String(existing.status ?? "").toLowerCase() !== String(inv.status ?? row.status ?? "").toLowerCase() ||
      String(existing.date ?? "") !== String(inv.date ?? row.date ?? "") ||
      String(existing.due_date ?? "") !== String(inv.due_date ?? "") ||
      Number(existing.total ?? 0) !== Number(inv.total ?? row.total ?? 0) ||
      Number(existing.balance ?? 0) !== Number(inv.balance ?? row.balance ?? 0) ||
      String(existing.customer_id ?? "") !== String(inv.customer_id ?? row.customer_id ?? "") ||
      String(existing.salesorder_id ?? "") !== String(inv.salesorder_id ?? "") ||
      String(existing.delivery_customer_name ?? "") !== String(deliveryCustomer ?? "") ||
      String(existing.submitter_id ?? "") !== String(inv.submitter_id ?? "") ||
      String(existing.submitted_by_name ?? "") !== String(inv.submitted_by_name ?? "") ||
      String(existing.custom_fields_json ?? "") !== String(customFieldsJson ?? "")
    );

    let linesChanged = false;
    if (existingLines.length !== incomingLines.length) {
      linesChanged = true;
    } else {
      for (let i = 0; i < existingLines.length; i++) {
        const el = existingLines[i];
        const il = incomingLines[i];
        if (
          String(el.item_id ?? "") !== String(il.item_id ?? "") ||
          String(el.item_name ?? "") !== String(il.name ?? "") ||
          normalizeNarration(el.description) !== normalizeNarration(il.description) ||
          Number(el.quantity ?? 0) !== Number(il.quantity ?? 0) ||
          Number(el.rate ?? 0) !== Number(il.rate ?? 0) ||
          Number(el.amount ?? 0) !== Number(il.item_total ?? 0) ||
          (el.unit ?? null) !== (sourceUnit(il) ?? null)
        ) {
          linesChanged = true;
          break;
        }
      }
    }

    if (referenceChanged || headerChanged || linesChanged) {
      docsToUpdate.push({ type: "INVOICE", data: inv, lines: incomingLines });
    } else {
      unchanged++;
    }
  }

  // Process Referenced POs
  for (const po of refPOs) {
    if (seenDocIds.has(po.purchaseorder_id)) continue;
    seenDocIds.add(po.purchaseorder_id);

    const existing = db.prepare(`
      SELECT * FROM audit_zoho_purchase_orders
      WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ? AND source_run_id = ?
      ORDER BY fetched_at DESC LIMIT 1
    `).get(orgId, po.purchaseorder_id, source_run_id) as any;

    if (!existing) {
      docsToInsert.push({ type: "PO", data: po, lines: po.line_items || [] });
      continue;
    }

    const existingLines = db.prepare(`
      SELECT * FROM audit_zoho_purchase_order_lines
      WHERE purchaseorder_id = ? AND source_run_id = ?
      ORDER BY rowid ASC
    `).all(po.purchaseorder_id, source_run_id) as any[];

    const incomingLines = po.line_items || [];
    let linesChanged = existingLines.length !== incomingLines.length;
    if (!linesChanged) {
      for (let i = 0; i < existingLines.length; i++) {
        const el = existingLines[i];
        const il = incomingLines[i];
        if (
          String(el.item_id ?? "") !== String(il.item_id ?? "") ||
          Number(el.quantity ?? 0) !== Number(il.quantity ?? 0) ||
          Number(el.rate ?? 0) !== Number(il.rate ?? 0) ||
          normalizeNarration(el.description) !== normalizeNarration(il.description) ||
          String(el.unit ?? "") !== String(il.unit ?? "")
        ) {
          linesChanged = true;
          break;
        }
      }
    }

    if (linesChanged || String(existing.status ?? "") !== String(po.status ?? "")) {
      docsToUpdate.push({ type: "PO", data: po, lines: incomingLines });
    } else {
      unchanged++;
    }
  }

  // Process Referenced SOs
  for (const so of refSOs) {
    if (seenDocIds.has(so.salesorder_id)) continue;
    seenDocIds.add(so.salesorder_id);

    const existing = db.prepare(`
      SELECT * FROM audit_zoho_sales_orders
      WHERE (organization_id = ? OR organization_id = '') AND salesorder_id = ? AND source_run_id = ?
      ORDER BY fetched_at DESC LIMIT 1
    `).get(orgId, so.salesorder_id, source_run_id) as any;

    if (!existing) {
      docsToInsert.push({ type: "SO", data: so, lines: so.line_items || [] });
      continue;
    }

    const existingLines = db.prepare(`
      SELECT * FROM audit_zoho_sales_order_lines
      WHERE salesorder_id = ? AND source_run_id = ?
      ORDER BY rowid ASC
    `).all(so.salesorder_id, source_run_id) as any[];

    const incomingLines = so.line_items || [];
    let linesChanged = existingLines.length !== incomingLines.length;
    if (!linesChanged) {
      for (let i = 0; i < existingLines.length; i++) {
        const el = existingLines[i];
        const il = incomingLines[i];
        if (
          String(el.item_id ?? "") !== String(il.item_id ?? "") ||
          Number(el.quantity ?? 0) !== Number(il.quantity ?? 0) ||
          Number(el.rate ?? 0) !== Number(il.rate ?? 0) ||
          normalizeNarration(el.description) !== normalizeNarration(il.description) ||
          String(el.unit ?? "") !== String(il.unit ?? "")
        ) {
          linesChanged = true;
          break;
        }
      }
    }

    if (linesChanged || String(existing.status ?? "") !== String(so.status ?? "")) {
      docsToUpdate.push({ type: "SO", data: so, lines: incomingLines });
    } else {
      unchanged++;
    }
  }

  // Process documents leaving pending approval status
  for (const update of poStatusUpdates) {
    if (!seenDocIds.has(update.id)) {
      seenDocIds.add(update.id);
      db.prepare(`
        UPDATE audit_zoho_purchase_orders SET status = ?, fetched_at = ?
        WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ? AND source_run_id = ?
      `).run(update.status, fetchedAt, orgId, update.id, source_run_id);
      docsToUpdate.push({ type: "PO", data: { purchaseorder_id: update.id, status: update.status }, lines: [] });
    }
  }

  for (const update of billStatusUpdates) {
    if (!seenDocIds.has(update.id)) {
      seenDocIds.add(update.id);
      db.prepare(`
        UPDATE audit_zoho_bills SET status = ?, fetched_at = ?
        WHERE (organization_id = ? OR organization_id = '') AND bill_id = ? AND source_run_id = ?
      `).run(update.status, fetchedAt, orgId, update.id, source_run_id);
      docsToUpdate.push({ type: "BILL", data: { bill_id: update.id, status: update.status }, lines: [] });
    }
  }

  for (const update of invoiceStatusUpdates) {
    if (!seenDocIds.has(update.id)) {
      seenDocIds.add(update.id);
      db.prepare(`
        UPDATE audit_zoho_invoices SET status = ?, fetched_at = ?
        WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ? AND source_run_id = ?
      `).run(update.status, fetchedAt, orgId, update.id, source_run_id);
      docsToUpdate.push({ type: "INVOICE", data: { invoice_id: update.id, status: update.status }, lines: [] });
    }
  }

  // ============================================================
  // PHASE C & D: SHORT SQLITE TRANSACTION (INSERT / UPDATE)
  // ============================================================
  const docsToWrite = [...docsToInsert, ...docsToUpdate.filter(d => d.lines.length > 0)];

  if (docsToWrite.length > 0 || docsToInsert.length > 0) {
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      // 1. Source run upsert
      db.prepare(`
        INSERT INTO audit_zoho_source_runs (
          source_run_id, organization_id, source_type, started_at, completed_at,
          status, api_domain, records_seen, records_written
        ) VALUES (?, ?, 'approval_pending_sync', ?, ?, 'SUCCESS', ?, ?, ?)
        ON CONFLICT(source_run_id) DO UPDATE SET
          completed_at=excluded.completed_at,
          records_seen=excluded.records_seen,
          records_written=excluded.records_written
      `).run(
        source_run_id, orgId, fetchedAt, fetchedAt, apiDomain,
        seenDocIds.size, docsToInsert.length + docsToUpdate.length
      );

      // 2. Persist documents
      for (const item of docsToWrite) {
        if (item.type === "PO") {
          const po = item.data;
          const customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
          const deliveryCustomerName = po.delivery_customer_name || null;

          db.prepare(`
            INSERT INTO audit_zoho_purchase_orders (
              organization_id, purchaseorder_id, source_run_id, purchaseorder_number,
              vendor_id, vendor_name, delivery_customer_name, date, delivery_date,
              status, currency, total, custom_fields_json, source_endpoint, fetched_at,
              submitter_id, submitted_by_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET
              purchaseorder_number=excluded.purchaseorder_number,
              vendor_id=excluded.vendor_id,
              vendor_name=excluded.vendor_name,
              delivery_customer_name=excluded.delivery_customer_name,
              date=excluded.date,
              delivery_date=excluded.delivery_date,
              status=excluded.status,
              currency=excluded.currency,
              total=excluded.total,
              custom_fields_json=excluded.custom_fields_json,
              fetched_at=excluded.fetched_at,
              submitter_id=excluded.submitter_id,
              submitted_by_name=excluded.submitted_by_name
          `).run(
            orgId, po.purchaseorder_id, source_run_id, po.purchaseorder_number ?? null,
            po.vendor_id ?? null, po.vendor_name ?? null, deliveryCustomerName,
            po.date ?? null, po.delivery_date ?? null, po.status ?? null,
            po.currency ?? null, po.total ?? null, customFieldsJson,
            "/books/v3/purchaseorders", fetchedAt,
            po.submitter_id ?? null, po.submitted_by_name ?? null
          );

          // Atomic line replacement to prevent ghost lines
          db.prepare(`
            DELETE FROM audit_zoho_purchase_order_lines
            WHERE organization_id = ? AND purchaseorder_id = ? AND source_run_id = ?
          `).run(orgId, po.purchaseorder_id, source_run_id);

          for (const line of item.lines) {
            db.prepare(`
              INSERT INTO audit_zoho_purchase_order_lines (
                organization_id, line_item_id, purchaseorder_id, source_run_id,
                item_id, item_name, description, sku, quantity, rate, amount, unit
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId, line.line_item_id || ("po_line_" + crypto.randomUUID()),
              po.purchaseorder_id, source_run_id, line.item_id ?? null,
              line.name ?? null, resolveDescState(line.description), line.sku ?? null,
              line.quantity ?? null, line.rate ?? null, line.item_total ?? null,
              sourceUnit(line)
            );
          }

        } else if (item.type === "BILL") {
          const bill = item.data;
          const customFieldsJson = bill.custom_fields ? JSON.stringify(bill.custom_fields) : null;

          db.prepare(`
            INSERT INTO audit_zoho_bills (
              organization_id, bill_id, source_run_id, bill_number,
              vendor_id, vendor_name, purchaseorder_id, date, due_date,
              status, currency, total, balance, custom_fields_json,
              source_endpoint, fetched_at, submitter_id, submitted_by_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, bill_id, source_run_id) DO UPDATE SET
              bill_number=excluded.bill_number,
              vendor_id=excluded.vendor_id,
              vendor_name=excluded.vendor_name,
              purchaseorder_id=excluded.purchaseorder_id,
              date=excluded.date,
              due_date=excluded.due_date,
              status=excluded.status,
              currency=excluded.currency,
              total=excluded.total,
              balance=excluded.balance,
              custom_fields_json=excluded.custom_fields_json,
              fetched_at=excluded.fetched_at,
              submitter_id=excluded.submitter_id,
              submitted_by_name=excluded.submitted_by_name
          `).run(
            orgId, bill.bill_id, source_run_id, bill.bill_number ?? null,
            bill.vendor_id ?? null, bill.vendor_name ?? null, bill.purchaseorder_id ?? null,
            bill.date ?? null, bill.due_date ?? null, bill.status ?? null,
            bill.currency_code ?? bill.currency ?? null, bill.total ?? null, bill.balance ?? null,
            customFieldsJson, "/books/v3/bills", fetchedAt,
            bill.submitter_id ?? null, bill.submitted_by_name ?? null
          );

          db.prepare(`
            DELETE FROM audit_zoho_bill_lines
            WHERE organization_id = ? AND bill_id = ? AND source_run_id = ?
          `).run(orgId, bill.bill_id, source_run_id);

          for (const line of item.lines) {
            db.prepare(`
              INSERT INTO audit_zoho_bill_lines (
                organization_id, line_item_id, bill_id, source_run_id,
                item_id, item_name, description, quantity, rate, amount
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId, line.line_item_id || ("bill_line_" + crypto.randomUUID()),
              bill.bill_id, source_run_id, line.item_id ?? null,
              line.name ?? null, resolveDescState(line.description), line.quantity ?? null,
              line.rate ?? null, line.item_total ?? null
            );
          }

        } else if (item.type === "INVOICE") {
          const inv = item.data;
          const customFieldsJson = inv.custom_fields ? JSON.stringify(inv.custom_fields) : null;
          const deliveryCustomerName = inv.shipping_address?.customer_name || inv.customer_name || null;

          db.prepare(`
            INSERT INTO audit_zoho_invoices (
              organization_id, invoice_id, source_run_id, invoice_number,
              customer_id, delivery_customer_name, salesorder_id, date, due_date,
              status, total, balance, currency_code, custom_fields_json,
              source_endpoint, fetched_at, submitter_id, submitted_by_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, invoice_id, source_run_id) DO UPDATE SET
              invoice_number=excluded.invoice_number,
              customer_id=excluded.customer_id,
              delivery_customer_name=excluded.delivery_customer_name,
              salesorder_id=excluded.salesorder_id,
              date=excluded.date,
              due_date=excluded.due_date,
              status=excluded.status,
              total=excluded.total,
              balance=excluded.balance,
              currency_code=excluded.currency_code,
              custom_fields_json=excluded.custom_fields_json,
              fetched_at=excluded.fetched_at,
              submitter_id=excluded.submitter_id,
              submitted_by_name=excluded.submitted_by_name
          `).run(
            orgId, inv.invoice_id, source_run_id, inv.invoice_number ?? null,
            inv.customer_id ?? null, deliveryCustomerName, inv.salesorder_id ?? null,
            inv.date ?? null, inv.due_date ?? null, inv.status ?? null,
            inv.total ?? null, inv.balance ?? null, inv.currency_code ?? null,
            customFieldsJson, "/books/v3/invoices", fetchedAt,
            inv.submitter_id ?? null, inv.submitted_by_name ?? null
          );

          db.prepare(`
            DELETE FROM audit_zoho_invoice_lines
            WHERE organization_id = ? AND invoice_id = ? AND source_run_id = ?
          `).run(orgId, inv.invoice_id, source_run_id);

          for (const line of item.lines) {
            db.prepare(`
              INSERT INTO audit_zoho_invoice_lines (
                organization_id, line_item_id, invoice_id, source_run_id,
                item_id, item_name, description, quantity, rate, amount, unit
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId, line.line_item_id || ("inv_line_" + crypto.randomUUID()),
              inv.invoice_id, source_run_id, line.item_id ?? null,
              line.name ?? null, resolveDescState(line.description), line.quantity ?? null,
              line.rate ?? null, line.item_total ?? null,
              sourceUnit(line)
            );
          }

        } else if (item.type === "SO") {
          const so = item.data;
          const customFieldsJson = so.custom_fields ? JSON.stringify(so.custom_fields) : null;
          const deliveryCustomerName = so.shipping_address?.customer_name || so.customer_name || null;

          db.prepare(`
            INSERT INTO audit_zoho_sales_orders (
              organization_id, salesorder_id, source_run_id, salesorder_number,
              customer_id, customer_name, delivery_customer_name, date, shipment_date,
              status, currency, total, custom_fields_json, source_endpoint, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, salesorder_id, source_run_id) DO UPDATE SET
              salesorder_number=excluded.salesorder_number,
              customer_id=excluded.customer_id,
              customer_name=excluded.customer_name,
              delivery_customer_name=excluded.delivery_customer_name,
              date=excluded.date,
              shipment_date=excluded.shipment_date,
              status=excluded.status,
              currency=excluded.currency,
              total=excluded.total,
              custom_fields_json=excluded.custom_fields_json,
              fetched_at=excluded.fetched_at
          `).run(
            orgId, so.salesorder_id, source_run_id, so.salesorder_number ?? null,
            so.customer_id ?? null, so.customer_name ?? null, deliveryCustomerName,
            so.date ?? null, so.shipment_date ?? null, so.status ?? null,
            so.currency ?? null, so.total ?? null, customFieldsJson,
            "/books/v3/salesorders", fetchedAt
          );

          db.prepare(`
            DELETE FROM audit_zoho_sales_order_lines
            WHERE organization_id = ? AND salesorder_id = ? AND source_run_id = ?
          `).run(orgId, so.salesorder_id, source_run_id);

          for (const line of item.lines) {
            db.prepare(`
              INSERT INTO audit_zoho_sales_order_lines (
                organization_id, line_item_id, salesorder_id, source_run_id,
                item_id, item_name, description, sku, quantity, rate, amount, unit
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId, line.line_item_id || ("so_line_" + crypto.randomUUID()),
              so.salesorder_id, source_run_id, line.item_id ?? null,
              line.name ?? null, resolveDescState(line.description), line.sku ?? null,
              line.quantity ?? null, line.rate ?? null, line.item_total ?? null,
              sourceUnit(line)
            );
          }
        }
      }

      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const created = docsToInsert.length;
  const updated = docsToUpdate.length;
  const checked = created + updated + unchanged + failed;

  // ============================================================
  // PHASE E: POST-COMMIT MANUAL MAPPING STALE VALIDATION
  // Scope: only SO/PO documents whose line snapshots were written above.
  // ============================================================
  const changedPurchaseOrderIds = new Set<string>();
  const changedSalesOrderIds = new Set<string>();
  for (const item of docsToWrite) {
    if (item.type === "PO" && item.data?.purchaseorder_id) changedPurchaseOrderIds.add(String(item.data.purchaseorder_id));
    else if (item.type === "SO" && item.data?.salesorder_id) changedSalesOrderIds.add(String(item.data.salesorder_id));
  }
  const mappingValidation = runPostCommitMappingValidation(
    db, orgId as string, Array.from(changedPurchaseOrderIds), Array.from(changedSalesOrderIds)
  );

  // R1C: Invoice→SO mapping stale validation (same phase, same pattern)
  const changedInvoiceIds = new Set<string>();
  for (const item of docsToWrite) {
    if (item.type === "INVOICE" && item.data?.invoice_id) changedInvoiceIds.add(String(item.data.invoice_id));
  }
  const invoiceMappingValidation = runPostCommitInvoiceMappingValidation(
    db, orgId as string, Array.from(changedInvoiceIds), Array.from(changedSalesOrderIds)
  );

  return { created, updated, unchanged, failed, checked, mappingValidation, invoiceMappingValidation };
}

export async function syncApprovalPendingDocument(
  targetDoc: TargetedDocParam,
  options?: ApprovalPendingSyncOptions
): Promise<TargetedSyncResult> {
  const completedAt = new Date().toISOString();

  // 1. Validation
  if (!targetDoc || !targetDoc.id || !["PO", "BILL", "INVOICE"].includes(targetDoc.type)) {
    return {
      status: "FAILED",
      documentType: targetDoc?.type || "PO",
      documentId: targetDoc?.id || "",
      documentNumber: targetDoc?.number,
      result: "FAILED",
      referenceRefreshed: false,
      referenceDocumentRefreshed: false,
      completedAt,
      error: "Invalid target document parameters"
    };
  }

  // Identifier sanitization check
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(targetDoc.id)) {
    return {
      status: "FAILED",
      documentType: targetDoc.type,
      documentId: targetDoc.id,
      documentNumber: targetDoc.number,
      result: "FAILED",
      referenceRefreshed: false,
      referenceDocumentRefreshed: false,
      completedAt,
      error: "Document identifier contains invalid characters"
    };
  }

  // 2. Auth / Context resolution
  let orgId = options?.orgId;
  let apiDomain = options?.apiDomain;

  if (!options?.reader) {
    const tokens = readTokenStore();
    if (!tokens || !tokens.access_token) {
      return {
        status: "FAILED",
        documentType: targetDoc.type,
        documentId: targetDoc.id,
        documentNumber: targetDoc.number,
        result: "FAILED",
        referenceRefreshed: false,
        referenceDocumentRefreshed: false,
        completedAt,
        error: "Zoho not connected"
      };
    }
    orgId = orgId || tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "774390949";
    apiDomain = apiDomain || tokens.api_domain || "https://www.zohoapis.com";
  } else {
    orgId = orgId || "TEST_ORG";
    apiDomain = apiDomain || "https://test.zohoapis.com";
  }

  const db = options?.db || getAuditDatabase();
  const reader = options?.reader || {
    listPurchaseOrders,
    getPurchaseOrder,
    listBills,
    getBill,
    listInvoices,
    getInvoice,
    listSalesOrders,
    getSalesOrder,
    getSalesOrderByNumber,
  };

  // ============================================================
  // PHASE A: NETWORK WORK (ZERO SQLITE LOCKS)
  // Fetch only requested document + required reference dependency
  // ============================================================
  try {
    let docData: any = null;
    let docLines: any[] = [];
    let docNumber: string = targetDoc.number || "";
    let result: "NEW" | "UPDATED" | "UNCHANGED" = "UNCHANGED";
    let referenceRefreshed = false;
    let referenceDocumentRefreshed = false;
    let refDocToPersist: { type: "SO" | "PO"; data: any; lines: any[] } | null = null;

    if (targetDoc.type === "PO") {
      const detail = await reader.getPurchaseOrder(orgId, targetDoc.id);
      docData = detail?.purchaseorder;
      if (!docData) {
        return {
          status: "FAILED",
          documentType: "PO",
          documentId: targetDoc.id,
          documentNumber: targetDoc.number,
          result: "FAILED",
          referenceRefreshed: false,
          referenceDocumentRefreshed: false,
          completedAt: new Date().toISOString(),
          error: `Purchase order ${targetDoc.id} not found in Zoho`
        };
      }
      docLines = docData.line_items || [];
      docNumber = docData.purchaseorder_number || docNumber;

      // Extract new reference
      const { soRefNumber: newSoRefNumber, soRefId: newSoRefId } = extractSoRefFromPo(docData);
      const newRefText = newSoRefNumber || docData.reference_number || null;

      // Check existing in DB
      const existingRow = db.prepare(`
        SELECT * FROM audit_zoho_purchase_orders
        WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ?
        ORDER BY fetched_at DESC LIMIT 1
      `).get(orgId, targetDoc.id) as any;

      const existingLines = db.prepare(`
        SELECT * FROM audit_zoho_purchase_order_lines
        WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ?
        ORDER BY line_item_id
      `).all(orgId, targetDoc.id) as any[];

      const oldRefText = existingRow ? (extractSoRefFromCustomFieldsJson(existingRow.custom_fields_json) || existingRow.purchaseorder_number || null) : null;

      if (!existingRow) {
        result = "NEW";
        referenceRefreshed = Boolean(newRefText);
      } else {
        const oldNormRef = (oldRefText || "").trim().toUpperCase();
        const newNormRef = (newRefText || "").trim().toUpperCase();
        referenceRefreshed = oldNormRef !== newNormRef;

        // Header differences
        let headerChanged = false;
        if ((existingRow.status || null) !== (docData.status || null)) headerChanged = true;
        if ((existingRow.date || null) !== (docData.date || null)) headerChanged = true;
        if ((existingRow.vendor_id || null) !== (docData.vendor_id || null)) headerChanged = true;
        if (Math.abs((existingRow.total || 0) - (docData.total || 0)) > 0.001) headerChanged = true;
        if ((existingRow.submitted_by_name || null) !== (docData.submitted_by_name || null)) headerChanged = true;
        if ((existingRow.submitter_id || null) !== (docData.submitter_id || null)) headerChanged = true;
        if (referenceRefreshed) headerChanged = true; // Reference change MUST trigger UPDATED!

        // Lines differences
        let linesChanged = false;
        if (existingLines.length !== docLines.length) {
          linesChanged = true;
        } else {
          for (let i = 0; i < docLines.length; i++) {
            const el = existingLines[i];
            const nl = docLines[i];
            if (el.item_id !== nl.item_id ||
                Math.abs((el.quantity || 0) - (nl.quantity || 0)) > 0.001 ||
                Math.abs((el.rate || 0) - (nl.rate || 0)) > 0.001 ||
                Math.abs((el.amount || 0) - (nl.item_total || nl.amount || 0)) > 0.001 ||
                !narrationMatches(el.description, nl.description)) {
              linesChanged = true;
              break;
            }
          }
        }

        result = (headerChanged || linesChanged) ? "UPDATED" : "UNCHANGED";
      }

      // Refresh required reference dependency if needed
      if (newSoRefId) {
        try {
          const soDetail = await reader.getSalesOrder(orgId, newSoRefId);
          if (soDetail?.salesorder) {
            refDocToPersist = {
              type: "SO",
              data: soDetail.salesorder,
              lines: soDetail.salesorder.line_items || []
            };
            referenceDocumentRefreshed = true;
          }
        } catch (e) {
          console.warn(`Failed to fetch referenced SO ${newSoRefId}:`, e);
        }
      } else if (newSoRefNumber) {
        let soIdToFetch: string | null = null;
        const localSo = db.prepare(`
          SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders
          WHERE (organization_id = ? OR organization_id = '') AND salesorder_number = ?
          ORDER BY fetched_at DESC LIMIT 1
        `).get(orgId, newSoRefNumber) as any;

        if (localSo?.salesorder_id) {
          soIdToFetch = localSo.salesorder_id;
        } else {
          const normKey = normalizeSoReference(newSoRefNumber);
          if (normKey) {
            const allLocalSos = db.prepare(`
              SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders
              WHERE (organization_id = ? OR organization_id = '')
              ORDER BY fetched_at DESC
            `).all(orgId) as any[];
            const candidates = allLocalSos.filter((s: any) => normalizeSoReference(s.salesorder_number) === normKey);
            if (candidates.length === 1) {
              soIdToFetch = candidates[0].salesorder_id;
            }
          }
        }

        if (!soIdToFetch && reader.getSalesOrderByNumber) {
          try {
            const foundSo = await reader.getSalesOrderByNumber(orgId, newSoRefNumber);
            const resolvedId = foundSo?.salesorder_id || foundSo?.salesorder?.salesorder_id;
            if (resolvedId) {
              soIdToFetch = resolvedId;
            }
          } catch (e) {
            console.warn(`Could not locate SO by number ${newSoRefNumber}:`, e);
          }
        }

        if (soIdToFetch) {
          try {
            const soDetail = await reader.getSalesOrder(orgId, soIdToFetch);
            if (soDetail?.salesorder) {
              refDocToPersist = {
                type: "SO",
                data: soDetail.salesorder,
                lines: soDetail.salesorder.line_items || []
              };
              referenceDocumentRefreshed = true;
            }
          } catch (e) {
            console.warn(`Failed to fetch referenced SO ${soIdToFetch}:`, e);
          }
        }
      }

    } else if (targetDoc.type === "BILL") {
      const detail = await reader.getBill(orgId, targetDoc.id);
      docData = detail?.bill;
      if (!docData) {
        return {
          status: "FAILED",
          documentType: "BILL",
          documentId: targetDoc.id,
          documentNumber: targetDoc.number,
          result: "FAILED",
          referenceRefreshed: false,
          referenceDocumentRefreshed: false,
          completedAt: new Date().toISOString(),
          error: `Bill ${targetDoc.id} not found in Zoho`
        };
      }
      docLines = docData.line_items || [];
      docNumber = docData.bill_number || docNumber;

      const existingRow = db.prepare(`
        SELECT * FROM audit_zoho_bills
        WHERE (organization_id = ? OR organization_id = '') AND bill_id = ?
        ORDER BY fetched_at DESC LIMIT 1
      `).get(orgId, targetDoc.id) as any;

      const existingLines = db.prepare(`
        SELECT * FROM audit_zoho_bill_lines
        WHERE (organization_id = ? OR organization_id = '') AND bill_id = ?
        ORDER BY line_item_id
      `).all(orgId, targetDoc.id) as any[];

      const oldPoId = existingRow?.purchaseorder_id || null;
      const newPoId = docData.purchaseorder_id || null;

      if (!existingRow) {
        result = "NEW";
        referenceRefreshed = Boolean(newPoId);
      } else {
        referenceRefreshed = oldPoId !== newPoId;

        let headerChanged = false;
        if ((existingRow.status || null) !== (docData.status || null)) headerChanged = true;
        if ((existingRow.date || null) !== (docData.date || null)) headerChanged = true;
        if ((existingRow.vendor_id || null) !== (docData.vendor_id || null)) headerChanged = true;
        if (Math.abs((existingRow.total || 0) - (docData.total || 0)) > 0.001) headerChanged = true;
        if ((existingRow.submitted_by_name || null) !== (docData.submitted_by_name || null)) headerChanged = true;
        if ((existingRow.submitter_id || null) !== (docData.submitter_id || null)) headerChanged = true;
        if (referenceRefreshed) headerChanged = true;

        let linesChanged = false;
        if (existingLines.length !== docLines.length) {
          linesChanged = true;
        } else {
          for (let i = 0; i < docLines.length; i++) {
            const el = existingLines[i];
            const nl = docLines[i];
            if (el.item_id !== nl.item_id ||
                Math.abs((el.quantity || 0) - (nl.quantity || 0)) > 0.001 ||
                Math.abs((el.rate || 0) - (nl.rate || 0)) > 0.001 ||
                Math.abs((el.amount || 0) - (nl.item_total || nl.amount || 0)) > 0.001 ||
                !narrationMatches(el.description, nl.description)) {
              linesChanged = true;
              break;
            }
          }
        }

        result = (headerChanged || linesChanged) ? "UPDATED" : "UNCHANGED";
      }

      if (newPoId) {
        try {
          const poDetail = await reader.getPurchaseOrder(orgId, newPoId);
          if (poDetail?.purchaseorder) {
            refDocToPersist = {
              type: "PO",
              data: poDetail.purchaseorder,
              lines: poDetail.purchaseorder.line_items || []
            };
            referenceDocumentRefreshed = true;
          }
        } catch (e) {
          console.warn(`Failed to fetch referenced PO ${newPoId}:`, e);
        }
      }

    } else if (targetDoc.type === "INVOICE") {
      const detail = await reader.getInvoice(orgId, targetDoc.id);
      docData = detail?.invoice;
      if (!docData) {
        return {
          status: "FAILED",
          documentType: "INVOICE",
          documentId: targetDoc.id,
          documentNumber: targetDoc.number,
          result: "FAILED",
          referenceRefreshed: false,
          referenceDocumentRefreshed: false,
          completedAt: new Date().toISOString(),
          error: `Invoice ${targetDoc.id} not found in Zoho`
        };
      }
      docLines = docData.line_items || [];
      docNumber = docData.invoice_number || docNumber;

      const existingRow = db.prepare(`
        SELECT * FROM audit_zoho_invoices
        WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ?
        ORDER BY fetched_at DESC LIMIT 1
      `).get(orgId, targetDoc.id) as any;

      const existingLines = db.prepare(`
        SELECT * FROM audit_zoho_invoice_lines
        WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ?
        ORDER BY line_item_id
      `).all(orgId, targetDoc.id) as any[];

      // Extract SO reference: native salesorder_id first, custom field fallback
      const { soRefNumber: newSoRefNumber, soRefId: newSoRefId } = extractSoRefFromPo(docData);
      const newSoId = newSoRefId;  // native salesorder_id (UUID)

      if (!existingRow) {
        result = "NEW";
        referenceRefreshed = Boolean(newSoId || newSoRefNumber);
      } else {
        const oldSoId = existingRow?.salesorder_id || null;
        const oldSoRefNumber = extractSoRefFromCustomFieldsJson(existingRow.custom_fields_json);
        referenceRefreshed = (oldSoId !== newSoId) || ((oldSoRefNumber || null) !== (newSoRefNumber || null));

        let headerChanged = false;
        if ((existingRow.status || null) !== (docData.status || null)) headerChanged = true;
        if ((existingRow.date || null) !== (docData.date || null)) headerChanged = true;
        if ((existingRow.customer_id || null) !== (docData.customer_id || null)) headerChanged = true;
        if (Math.abs((existingRow.total || 0) - (docData.total || 0)) > 0.001) headerChanged = true;
        if ((existingRow.submitted_by_name || null) !== (docData.submitted_by_name || null)) headerChanged = true;
        if ((existingRow.submitter_id || null) !== (docData.submitter_id || null)) headerChanged = true;
        if (referenceRefreshed) headerChanged = true;

        let linesChanged = false;
        if (existingLines.length !== docLines.length) {
          linesChanged = true;
        } else {
          for (let i = 0; i < docLines.length; i++) {
            const el = existingLines[i];
            const nl = docLines[i];
            if (el.item_id !== nl.item_id ||
                Math.abs((el.quantity || 0) - (nl.quantity || 0)) > 0.001 ||
                Math.abs((el.rate || 0) - (nl.rate || 0)) > 0.001 ||
                Math.abs((el.amount || 0) - (nl.item_total || nl.amount || 0)) > 0.001 ||
                !narrationMatches(el.description, nl.description) ||
                (el.unit ?? null) !== (sourceUnit(nl) ?? null)) {
              linesChanged = true;
              break;
            }
          }
        }

        result = (headerChanged || linesChanged) ? "UPDATED" : "UNCHANGED";
      }

      // SO dependency resolution: native ID first, then custom field fallback
      if (newSoId) {
        // Native salesorder_id path: fetch SO by UUID directly
        try {
          const soDetail = await reader.getSalesOrder(orgId, newSoId);
          if (soDetail?.salesorder) {
            refDocToPersist = {
              type: "SO",
              data: soDetail.salesorder,
              lines: soDetail.salesorder.line_items || []
            };
            referenceDocumentRefreshed = true;
          }
        } catch (e) {
          console.warn(`Failed to fetch referenced SO ${newSoId}:`, e);
        }
      } else if (newSoRefNumber) {
        // Custom field cf_sales_order_no fallback: resolve SO number → ID, then fetch
        let soIdToFetch: string | null = null;

        // 1. Try exact local match
        const localSo = db.prepare(`
          SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders
          WHERE (organization_id = ? OR organization_id = '') AND salesorder_number = ?
          ORDER BY fetched_at DESC LIMIT 1
        `).get(orgId, newSoRefNumber) as any;

        if (localSo?.salesorder_id) {
          soIdToFetch = localSo.salesorder_id;
        } else {
          // 2. Try normalized local match (deterministic unique resolution)
          const normKey = normalizeSoReference(newSoRefNumber);
          if (normKey) {
            const allLocalSos = db.prepare(`
              SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders
              WHERE (organization_id = ? OR organization_id = '')
              ORDER BY fetched_at DESC
            `).all(orgId) as any[];
            const candidates = allLocalSos.filter((s: any) => normalizeSoReference(s.salesorder_number) === normKey);
            if (candidates.length === 1) {
              soIdToFetch = candidates[0].salesorder_id;
            }
            // >1 candidates = ambiguous; do not select arbitrarily
          }
        }

        // 3. If still unresolved, try Zoho API lookup by SO number
        if (!soIdToFetch && reader.getSalesOrderByNumber) {
          try {
            const foundSo = await reader.getSalesOrderByNumber(orgId, newSoRefNumber);
            const resolvedId = foundSo?.salesorder_id || foundSo?.salesorder?.salesorder_id;
            if (resolvedId) {
              soIdToFetch = resolvedId;
            }
          } catch (e) {
            console.warn(`Could not locate SO by number ${newSoRefNumber}:`, e);
          }
        }

        // 4. Fetch full SO detail if resolved
        if (soIdToFetch) {
          try {
            const soDetail = await reader.getSalesOrder(orgId, soIdToFetch);
            if (soDetail?.salesorder) {
              refDocToPersist = {
                type: "SO",
                data: soDetail.salesorder,
                lines: soDetail.salesorder.line_items || []
              };
              referenceDocumentRefreshed = true;
            }
          } catch (e) {
            console.warn(`Failed to fetch referenced SO ${soIdToFetch}:`, e);
          }
        }
      }
    }

    // ============================================================
    // PHASE B: SHORT SQLITE TRANSACTION (ZERO NETWORK CALLS)
    // ============================================================
    const fetchedAt = new Date().toISOString();
    const source_run_id = "APPROVAL_PENDING_ACTIVE";

    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      db.prepare(`
        INSERT INTO audit_zoho_source_runs (
          source_run_id, organization_id, source_type, started_at, completed_at,
          status, api_domain, records_seen, records_written
        ) VALUES (?, ?, 'approval_pending_sync', ?, ?, 'SUCCESS', ?, 1, 1)
        ON CONFLICT(source_run_id) DO UPDATE SET
          completed_at=excluded.completed_at,
          records_seen=audit_zoho_source_runs.records_seen + 1,
          records_written=audit_zoho_source_runs.records_written + 1
      `).run(source_run_id, orgId, fetchedAt, fetchedAt, apiDomain);

      if (targetDoc.type === "PO") {
        if (orgId) {
          db.prepare(`DELETE FROM audit_zoho_purchase_orders WHERE organization_id = '' AND purchaseorder_id = ?`).run(docData.purchaseorder_id);
          db.prepare(`DELETE FROM audit_zoho_purchase_order_lines WHERE organization_id = '' AND purchaseorder_id = ?`).run(docData.purchaseorder_id);
        }

        const customFieldsJson = docData.custom_fields ? JSON.stringify(docData.custom_fields) : null;
        const deliveryCustomerName = docData.delivery_customer_name || null;

        try {
          db.exec("ALTER TABLE audit_zoho_purchase_orders ADD COLUMN reference_number TEXT;");
        } catch {}

        db.prepare(`
          INSERT INTO audit_zoho_purchase_orders (
            organization_id, purchaseorder_id, source_run_id, purchaseorder_number,
            vendor_id, vendor_name, delivery_customer_name, date, delivery_date,
            status, currency, total, custom_fields_json, source_endpoint, fetched_at,
            submitter_id, submitted_by_name, reference_number
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET
            purchaseorder_number=excluded.purchaseorder_number,
            vendor_id=excluded.vendor_id,
            vendor_name=excluded.vendor_name,
            delivery_customer_name=excluded.delivery_customer_name,
            date=excluded.date,
            delivery_date=excluded.delivery_date,
            status=excluded.status,
            currency=excluded.currency,
            total=excluded.total,
            custom_fields_json=excluded.custom_fields_json,
            fetched_at=excluded.fetched_at,
            submitter_id=excluded.submitter_id,
            submitted_by_name=excluded.submitted_by_name,
            reference_number=excluded.reference_number
        `).run(
          orgId, docData.purchaseorder_id, source_run_id, docData.purchaseorder_number ?? null,
          docData.vendor_id ?? null, docData.vendor_name ?? null, deliveryCustomerName,
          docData.date ?? null, docData.delivery_date ?? null, docData.status ?? null,
          docData.currency ?? null, docData.total ?? null, customFieldsJson,
          "/books/v3/purchaseorders", fetchedAt,
          docData.submitter_id ?? null, docData.submitted_by_name ?? null,
          docData.reference_number ?? null
        );

        db.prepare(`
          DELETE FROM audit_zoho_purchase_order_lines
          WHERE organization_id = ? AND purchaseorder_id = ? AND source_run_id = ?
        `).run(orgId, docData.purchaseorder_id, source_run_id);

        for (const line of docLines) {
          db.prepare(`
            INSERT INTO audit_zoho_purchase_order_lines (
              organization_id, line_item_id, purchaseorder_id, source_run_id,
              item_id, item_name, description, sku, quantity, rate, amount, unit
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            orgId, line.line_item_id || ("po_line_" + crypto.randomUUID()),
            docData.purchaseorder_id, source_run_id, line.item_id ?? null,
            line.name ?? null, resolveDescState(line.description), line.sku ?? null,
            line.quantity ?? null, line.rate ?? null, line.item_total ?? null,
              sourceUnit(line)
          );
        }

      } else if (targetDoc.type === "BILL") {
        if (orgId) {
          db.prepare(`DELETE FROM audit_zoho_bills WHERE organization_id = '' AND bill_id = ?`).run(docData.bill_id);
          db.prepare(`DELETE FROM audit_zoho_bill_lines WHERE organization_id = '' AND bill_id = ?`).run(docData.bill_id);
        }

        const customFieldsJson = docData.custom_fields ? JSON.stringify(docData.custom_fields) : null;

        db.prepare(`
          INSERT INTO audit_zoho_bills (
            organization_id, bill_id, source_run_id, bill_number,
            vendor_id, vendor_name, purchaseorder_id, date, due_date,
            status, currency, total, balance, custom_fields_json,
            source_endpoint, fetched_at, submitter_id, submitted_by_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, bill_id, source_run_id) DO UPDATE SET
            bill_number=excluded.bill_number,
            vendor_id=excluded.vendor_id,
            vendor_name=excluded.vendor_name,
            purchaseorder_id=excluded.purchaseorder_id,
            date=excluded.date,
            due_date=excluded.due_date,
            status=excluded.status,
            currency=excluded.currency,
            total=excluded.total,
            balance=excluded.balance,
            custom_fields_json=excluded.custom_fields_json,
            fetched_at=excluded.fetched_at,
            submitter_id=excluded.submitter_id,
            submitted_by_name=excluded.submitted_by_name
        `).run(
          orgId, docData.bill_id, source_run_id, docData.bill_number ?? null,
          docData.vendor_id ?? null, docData.vendor_name ?? null, docData.purchaseorder_id ?? null,
          docData.date ?? null, docData.due_date ?? null, docData.status ?? null,
          docData.currency_code ?? docData.currency ?? null, docData.total ?? null, docData.balance ?? null,
          customFieldsJson, "/books/v3/bills", fetchedAt,
          docData.submitter_id ?? null, docData.submitted_by_name ?? null
        );

        db.prepare(`
          DELETE FROM audit_zoho_bill_lines
          WHERE organization_id = ? AND bill_id = ? AND source_run_id = ?
        `).run(orgId, docData.bill_id, source_run_id);

        for (const line of docLines) {
          db.prepare(`
            INSERT INTO audit_zoho_bill_lines (
              organization_id, line_item_id, bill_id, source_run_id,
              item_id, item_name, description, quantity, rate, amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            orgId, line.line_item_id || ("bill_line_" + crypto.randomUUID()),
            docData.bill_id, source_run_id, line.item_id ?? null,
            line.name ?? null, resolveDescState(line.description), line.quantity ?? null,
            line.rate ?? null, line.item_total ?? null
          );
        }

      } else if (targetDoc.type === "INVOICE") {
        if (orgId) {
          db.prepare(`DELETE FROM audit_zoho_invoices WHERE organization_id = '' AND invoice_id = ?`).run(docData.invoice_id);
          db.prepare(`DELETE FROM audit_zoho_invoice_lines WHERE organization_id = '' AND invoice_id = ?`).run(docData.invoice_id);
        }

        const customFieldsJson = docData.custom_fields ? JSON.stringify(docData.custom_fields) : null;
        const deliveryCustomerName = docData.shipping_address?.customer_name || docData.customer_name || null;

        db.prepare(`
          INSERT INTO audit_zoho_invoices (
            organization_id, invoice_id, source_run_id, invoice_number,
            customer_id, delivery_customer_name, salesorder_id, date, due_date,
            status, total, balance, currency_code, custom_fields_json,
            source_endpoint, fetched_at, submitter_id, submitted_by_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, invoice_id, source_run_id) DO UPDATE SET
            invoice_number=excluded.invoice_number,
            customer_id=excluded.customer_id,
            delivery_customer_name=excluded.delivery_customer_name,
            salesorder_id=excluded.salesorder_id,
            date=excluded.date,
            due_date=excluded.due_date,
            status=excluded.status,
            total=excluded.total,
            balance=excluded.balance,
            currency_code=excluded.currency_code,
            custom_fields_json=excluded.custom_fields_json,
            fetched_at=excluded.fetched_at,
            submitter_id=excluded.submitter_id,
            submitted_by_name=excluded.submitted_by_name
        `).run(
          orgId, docData.invoice_id, source_run_id, docData.invoice_number ?? null,
          docData.customer_id ?? null, deliveryCustomerName, docData.salesorder_id ?? null,
          docData.date ?? null, docData.due_date ?? null, docData.status ?? null,
          docData.total ?? null, docData.balance ?? null, docData.currency_code ?? null,
          customFieldsJson, "/books/v3/invoices", fetchedAt,
          docData.submitter_id ?? null, docData.submitted_by_name ?? null
        );

        db.prepare(`
          DELETE FROM audit_zoho_invoice_lines
          WHERE organization_id = ? AND invoice_id = ? AND source_run_id = ?
        `).run(orgId, docData.invoice_id, source_run_id);

        for (const line of docLines) {
          db.prepare(`
            INSERT INTO audit_zoho_invoice_lines (
              organization_id, line_item_id, invoice_id, source_run_id,
              item_id, item_name, description, quantity, rate, amount, unit
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            orgId, line.line_item_id || ("inv_line_" + crypto.randomUUID()),
            docData.invoice_id, source_run_id, line.item_id ?? null,
            line.name ?? null, resolveDescState(line.description), line.quantity ?? null,
            line.rate ?? null, line.item_total ?? null,
            sourceUnit(line)
          );
        }
      }

      // If refDocToPersist was fetched (e.g. newly referenced SO or PO):
      if (refDocToPersist) {
        if (refDocToPersist.type === "SO") {
          const so = refDocToPersist.data;
          if (orgId) {
            db.prepare(`DELETE FROM audit_zoho_sales_orders WHERE organization_id = '' AND salesorder_id = ?`).run(so.salesorder_id);
            db.prepare(`DELETE FROM audit_zoho_sales_order_lines WHERE organization_id = '' AND salesorder_id = ?`).run(so.salesorder_id);
          }
          const customFieldsJson = so.custom_fields ? JSON.stringify(so.custom_fields) : null;
          const deliveryCustomerName = so.shipping_address?.customer_name || so.customer_name || null;

          db.prepare(`
            INSERT INTO audit_zoho_sales_orders (
              organization_id, salesorder_id, source_run_id, salesorder_number,
              customer_id, customer_name, delivery_customer_name, date, shipment_date,
              status, currency, total, custom_fields_json, source_endpoint, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, salesorder_id, source_run_id) DO UPDATE SET
              salesorder_number=excluded.salesorder_number,
              customer_id=excluded.customer_id,
              customer_name=excluded.customer_name,
              delivery_customer_name=excluded.delivery_customer_name,
              date=excluded.date,
              shipment_date=excluded.shipment_date,
              status=excluded.status,
              currency=excluded.currency,
              total=excluded.total,
              custom_fields_json=excluded.custom_fields_json,
              fetched_at=excluded.fetched_at
          `).run(
            orgId, so.salesorder_id, source_run_id, so.salesorder_number ?? null,
            so.customer_id ?? null, so.customer_name ?? null, deliveryCustomerName,
            so.date ?? null, so.shipment_date ?? null, so.status ?? null,
            so.currency ?? null, so.total ?? null, customFieldsJson,
            "/books/v3/salesorders", fetchedAt
          );

          db.prepare(`
            DELETE FROM audit_zoho_sales_order_lines
            WHERE organization_id = ? AND salesorder_id = ? AND source_run_id = ?
          `).run(orgId, so.salesorder_id, source_run_id);

          for (const line of refDocToPersist.lines) {
            db.prepare(`
              INSERT INTO audit_zoho_sales_order_lines (
                organization_id, line_item_id, salesorder_id, source_run_id,
                item_id, item_name, description, sku, quantity, rate, amount, unit
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId, line.line_item_id || ("so_line_" + crypto.randomUUID()),
              so.salesorder_id, source_run_id, line.item_id ?? null,
              line.name ?? null, resolveDescState(line.description), line.sku ?? null,
              line.quantity ?? null, line.rate ?? null, line.item_total ?? null,
              sourceUnit(line)
            );
          }
        } else if (refDocToPersist.type === "PO") {
          const po = refDocToPersist.data;
          if (orgId) {
            db.prepare(`DELETE FROM audit_zoho_purchase_orders WHERE organization_id = '' AND purchaseorder_id = ?`).run(po.purchaseorder_id);
            db.prepare(`DELETE FROM audit_zoho_purchase_order_lines WHERE organization_id = '' AND purchaseorder_id = ?`).run(po.purchaseorder_id);
          }
          const customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
          const deliveryCustomerName = po.delivery_customer_name || null;

          db.prepare(`
            INSERT INTO audit_zoho_purchase_orders (
              organization_id, purchaseorder_id, source_run_id, purchaseorder_number,
              vendor_id, vendor_name, delivery_customer_name, date, delivery_date,
              status, currency, total, custom_fields_json, source_endpoint, fetched_at,
              submitter_id, submitted_by_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET
              purchaseorder_number=excluded.purchaseorder_number,
              vendor_id=excluded.vendor_id,
              vendor_name=excluded.vendor_name,
              delivery_customer_name=excluded.delivery_customer_name,
              date=excluded.date,
              delivery_date=excluded.delivery_date,
              status=excluded.status,
              currency=excluded.currency,
              total=excluded.total,
              custom_fields_json=excluded.custom_fields_json,
              fetched_at=excluded.fetched_at,
              submitter_id=excluded.submitter_id,
              submitted_by_name=excluded.submitted_by_name
          `).run(
            orgId, po.purchaseorder_id, source_run_id, po.purchaseorder_number ?? null,
            po.vendor_id ?? null, po.vendor_name ?? null, deliveryCustomerName,
            po.date ?? null, po.delivery_date ?? null, po.status ?? null,
            po.currency ?? null, po.total ?? null, customFieldsJson,
            "/books/v3/purchaseorders", fetchedAt,
            po.submitter_id ?? null, po.submitted_by_name ?? null
          );

          db.prepare(`
            DELETE FROM audit_zoho_purchase_order_lines
            WHERE organization_id = ? AND purchaseorder_id = ? AND source_run_id = ?
          `).run(orgId, po.purchaseorder_id, source_run_id);

          for (const line of refDocToPersist.lines) {
            db.prepare(`
              INSERT INTO audit_zoho_purchase_order_lines (
                organization_id, line_item_id, purchaseorder_id, source_run_id,
                item_id, item_name, description, sku, quantity, rate, amount, unit
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId, line.line_item_id || ("po_line_" + crypto.randomUUID()),
              po.purchaseorder_id, source_run_id, line.item_id ?? null,
              line.name ?? null, resolveDescState(line.description), line.sku ?? null,
              line.quantity ?? null, line.rate ?? null, line.item_total ?? null,
              sourceUnit(line)
            );
          }
        }
      }

      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    // ============================================================
    // PHASE E: POST-COMMIT MANUAL MAPPING STALE VALIDATION
    // Bounded to the target PO and/or the refreshed SO/PO dependency.
    // ============================================================
    const affectedPurchaseOrderIds: string[] = [];
    const affectedSalesOrderIds: string[] = [];
    if (targetDoc.type === "PO" && docData?.purchaseorder_id) {
      affectedPurchaseOrderIds.push(String(docData.purchaseorder_id));
    }
    if (refDocToPersist?.type === "PO" && refDocToPersist.data?.purchaseorder_id) {
      affectedPurchaseOrderIds.push(String(refDocToPersist.data.purchaseorder_id));
    }
    if (refDocToPersist?.type === "SO" && refDocToPersist.data?.salesorder_id) {
      affectedSalesOrderIds.push(String(refDocToPersist.data.salesorder_id));
    }
    const mappingValidation = runPostCommitMappingValidation(
      db, orgId as string, affectedPurchaseOrderIds, affectedSalesOrderIds
    );

    // R1C: Invoice→SO mapping stale validation (same phase, same pattern)
    const affectedInvoiceIds: string[] = [];
    if (targetDoc.type === "INVOICE" && docData?.invoice_id) {
      affectedInvoiceIds.push(String(docData.invoice_id));
    }
    // When an SO reference was refreshed, its lines may have changed —
    // validate Invoice mappings that reference that SO too.
    const invoiceMappingValidation = runPostCommitInvoiceMappingValidation(
      db, orgId as string, affectedInvoiceIds, affectedSalesOrderIds
    );

    return {
      status: "SUCCESS",
      documentType: targetDoc.type,
      documentId: targetDoc.id,
      documentNumber: docNumber,
      result,
      referenceRefreshed,
      referenceDocumentRefreshed,
      completedAt: fetchedAt,
      mappingValidation,
      invoiceMappingValidation
    };

  } catch (err: any) {
    return {
      status: "FAILED",
      documentType: targetDoc.type,
      documentId: targetDoc.id,
      documentNumber: targetDoc.number,
      result: "FAILED",
      referenceRefreshed: false,
      referenceDocumentRefreshed: false,
      completedAt: new Date().toISOString(),
      error: err.message || String(err)
    };
  }
}
