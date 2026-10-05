import { getAuditDatabase } from "../db/audit-database.ts";
import { buildGlobalSoLookup, resolveUniqueSalesOrder } from "./so-po-mapping.ts";
import { resolveInvoiceLineWithMapping } from "./invoice-line-mapping-service.ts";
import fs from "node:fs";
import * as path from "node:path";

export interface ApprovalPendingItemEvidence {
  sourceLineId: string;
  displayLineNumber?: number; // Human-readable document line number (1, 2, 3...)
  itemId: string;
  itemName: string;
  narration: string;
  refNarration?: string | null;
  refLineId: string | null;
  refDisplayLineNumber?: number | null; // Human-readable reference document line number
  expectedQty: number | null; // Qty from upstream SO/PO
  rate: number | null;
  amount: number | null;
  refRate?: number | null;
  refAmount?: number | null;
  actualQty: number; // Qty in the document
  previousQty: number | null; // Qty from other related documents
  cumulativeQty: number | null; // Qty across all approved/pending documents mapping to the upstream reference
  uomMatch: boolean;
  mismatchType: "MATCHED" | "ITEM_NOT_IN_SOURCE" | "ITEM_MAPPING_REQUIRED" | "UOM_MISMATCH" | "UOM_EVIDENCE_MISSING" | "QTY_EXCEEDED" | "CUMULATIVE_QTY_EXCEEDED" | "PARTIAL_WITHIN_REFERENCE" | "NOT_INCLUDED_IN_CURRENT_DOCUMENT" | "AMBIGUOUS_REFERENCE_LINE";
  previousDocuments?: { number: string; date: string; qty: number; status: string; }[];
  rateCheckStatus?: "OK" | "ALERT" | "CANNOT_DETERMINE";
  premiumAmount?: number | null;
  premiumPercentage?: number | null;
  // AP-UOM-BRIDGE-I1: optional source UOM evidence (PO -> SO only).
  unit?: string | null; // current document line unit (PO line)
  refUnit?: string | null; // reference document line unit (SO line)
  uomStatus?: UomComparisonStatus | null; // null when no deterministic line mapping exists
}

export type UomComparisonStatus = "UOM_MATCH" | "UOM_MISMATCH" | "UOM_EVIDENCE_MISSING";

/**
 * Minimal, non-semantic unit normalization: trim, collapse repeated
 * whitespace, case-insensitive. No conversions / synonyms (Nos != Pcs).
 * Empty or missing evidence -> null.
 */
export function normalizeUnit(unit: unknown): string | null {
  if (unit === null || unit === undefined) return null;
  const t = String(unit).trim().replace(/\s+/g, " ").toLowerCase();
  return t === "" ? null : t;
}

export function compareUom(currentUnit: unknown, refUnit: unknown): UomComparisonStatus {
  const a = normalizeUnit(currentUnit);
  const b = normalizeUnit(refUnit);
  if (a === null || b === null) return "UOM_EVIDENCE_MISSING";
  return a === b ? "UOM_MATCH" : "UOM_MISMATCH";
}

/**
 * Rate Guard (PO -> SO). Compares rates only for a deterministically
 * mapped line whose UOM evidence is proven equal. Monetary precision is
 * the pre-existing 3-decimal rounding; no additional grace is applied.
 */
export function evaluateRateGuard(input: {
  isMapped: boolean;
  uomStatus: UomComparisonStatus | null;
  refRate: number | null | undefined;
  rate: number | null | undefined;
}): { rateCheckStatus: "OK" | "ALERT" | "CANNOT_DETERMINE"; premiumAmount: number | null; premiumPercentage: number | null } {
  const cannot = { rateCheckStatus: "CANNOT_DETERMINE" as const, premiumAmount: null, premiumPercentage: null };
  if (!input.isMapped) return cannot;
  if (input.uomStatus !== "UOM_MATCH") return cannot;
  if (input.refRate == null || input.rate == null) return cannot;

  const roundedSoRate = Math.round(input.refRate * 1000) / 1000;
  const roundedPoRate = Math.round(input.rate * 1000) / 1000;
  if (roundedSoRate >= roundedPoRate) {
    return { rateCheckStatus: "OK", premiumAmount: null, premiumPercentage: null };
  }
  const premiumAmount = Math.round((roundedPoRate - roundedSoRate) * 1000) / 1000;
  const premiumPercentage = roundedSoRate > 0 ? (premiumAmount / roundedSoRate) * 100 : null;
  return { rateCheckStatus: "ALERT", premiumAmount, premiumPercentage };
}

export interface ApprovalPendingDocument {
  id: string;
  type: "PO" | "BILL" | "INVOICE";
  number: string;
  date: string;
  zohoStatus: string;
  verificationStatus: "MATCHED" | "MISMATCH" | "PARTIAL_WITHIN_REFERENCE" | "UNRESOLVED" | "LOCAL_DATA_INCOMPLETE" | "AMBIGUOUS_SO_REFERENCE" | "SO_REFERENCE_NOT_FOUND";
  customerOrVendor: string;
  relatedDocumentRef: string | null;
  nativeReferenceNumber?: string | null;
  referenceDate?: string;
  referenceCustomer?: string;
  referenceSubmittedBy?: string | null;
  submittedBy?: string | null;
  items: ApprovalPendingItemEvidence[];
  mismatchCount: number;
}

export interface ApprovalPendingReport {
  documents: ApprovalPendingDocument[];
  summary: {
    totalPending: number;
    poPending: number;
    billPending: number;
    invoicePending: number;
    matched: number;
    partial: number;
    mismatch: number;
    unresolved: number;
  };
}

function getLatestLines(db: any, tableName: string, idColumn: string, idValue: string): any[] {
  const headerTableName = tableName.replace('_lines', 's');
  const latestHeader = db.prepare(`SELECT source_run_id, organization_id FROM ${headerTableName} WHERE ${idColumn} = ? ORDER BY fetched_at DESC LIMIT 1`).get(idValue) as any;
  if (!latestHeader) return [];
  return db.prepare(`SELECT *, ROW_NUMBER() OVER(ORDER BY rowid ASC) as displayLineNumber FROM ${tableName} WHERE ${idColumn} = ? AND source_run_id = ? AND organization_id = ? ORDER BY rowid ASC`).all(idValue, latestHeader.source_run_id, latestHeader.organization_id) as any[];
}

export function getApprovalPendingDocuments(sourceRunId?: string, dbParam?: any, fromDate?: string, toDate?: string, docNumber?: string): ApprovalPendingReport {
  const db = dbParam || getAuditDatabase();

  let userCache: Record<string, string> = {};
  try {
    const cachePath = path.join(process.cwd(), 'data', 'zoho-users-cache.json');
    if (fs.existsSync(cachePath)) {
      userCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
  } catch (e) {}
  const resolveNarration = (desc: any) => {
    if (desc === "SOURCE DOES NOT PROVIDE NARRATION") return desc;
    if (desc === "CAPTURED_EMPTY") return "—";
    if (desc === null || desc === undefined) return "EVIDENCE NOT SYNCHRONIZED";
    if (String(desc).trim() === "") return "—";
    return String(desc);
  };


  if (!docNumber && !sourceRunId) {
    const runRow = db.prepare(`SELECT source_run_id FROM audit_zoho_source_runs WHERE source_type IN ('approval_pending_sync', 'full_sync') ORDER BY started_at DESC LIMIT 1`).get() as any;
    if (runRow) {
      sourceRunId = runRow.source_run_id;
    }
  }

  const documentsMap = new Map<string, ApprovalPendingDocument>();
  const PENDING_STATUSES = ['pending_approval', 'submitted_for_approval', 'awaiting_approval', 'draft'];
  const statusPlaceholders = PENDING_STATUSES.map(() => '?').join(',');

  let poQuery: string;
  let billQuery: string;
  let invQuery: string;
  let queryParams: any[];

  if (docNumber) {
    // If searching by docNumber, ignore status, date, and source_run_id (just get latest)
    poQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY purchaseorder_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_purchase_orders) WHERE rn = 1 AND purchaseorder_number = ?`;
    billQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY bill_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_bills) WHERE rn = 1 AND bill_number = ?`;
    invQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY invoice_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_invoices) WHERE rn = 1 AND invoice_number = ?`;
    queryParams = [docNumber];
  } else if (sourceRunId) {
    poQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY purchaseorder_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_purchase_orders WHERE source_run_id = ?) WHERE rn = 1 AND LOWER(status) IN (${statusPlaceholders})`;
    billQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY bill_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_bills WHERE source_run_id = ?) WHERE rn = 1 AND LOWER(status) IN (${statusPlaceholders})`;
    invQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY invoice_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_invoices WHERE source_run_id = ?) WHERE rn = 1 AND LOWER(status) IN (${statusPlaceholders})`;
    queryParams = [sourceRunId, ...PENDING_STATUSES];
  } else {
    poQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY purchaseorder_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_purchase_orders) WHERE rn = 1 AND LOWER(status) IN (${statusPlaceholders})`;
    billQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY bill_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_bills) WHERE rn = 1 AND LOWER(status) IN (${statusPlaceholders})`;
    invQuery = `SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY invoice_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_invoices) WHERE rn = 1 AND LOWER(status) IN (${statusPlaceholders})`;
    queryParams = [...PENDING_STATUSES];
  }

  if (!docNumber) {
    if (fromDate) {
      poQuery += " AND date >= ?"; billQuery += " AND date >= ?"; invQuery += " AND date >= ?";
      queryParams.push(fromDate);
    }
    if (toDate) {
      poQuery += " AND date <= ?"; billQuery += " AND date <= ?"; invQuery += " AND date <= ?";
      queryParams.push(toDate);
    }
  }

  const globalSoLookup = buildGlobalSoLookup(db);

  // 1. Process Purchase Orders
  const pos = db.prepare(poQuery).all(...queryParams) as any[];
  for (const po of pos) {
    if (documentsMap.has(po.purchaseorder_id)) continue;
    let customFields = [];
    try {
      customFields = JSON.parse(po.custom_fields_json || "[]");
    } catch (e) {}

    const soNumberField = customFields.find((f: any) => ((f.label || "").toLowerCase() === 'sales order no' || f.api_name === 'cf_sales_order_no'));
    const soRef = soNumberField ? soNumberField.value : (po.reference_number || null);

    const itemsEvidence: ApprovalPendingItemEvidence[] = [];
    let verificationStatus: ApprovalPendingDocument["verificationStatus"] = "UNRESOLVED";
    let referenceDate = undefined;
    let referenceCustomer = undefined;
    let referenceSubmittedBy: string | null = null;

    if (!soRef) {
      verificationStatus = "LOCAL_DATA_INCOMPLETE";
    } else {
      const resolution = resolveUniqueSalesOrder(globalSoLookup, soRef);
      if (resolution.status !== "MATCH") {
        verificationStatus = resolution.status;
      } else {
        const so = resolution.so;
        referenceDate = so.date;
        referenceCustomer = so.customer_name;
        referenceSubmittedBy = so.submitter_id ? (userCache[so.submitter_id] || so.submitted_by_name || null) : null;

        const soLines = getLatestLines(db, "audit_zoho_sales_order_lines", "salesorder_id", so.salesorder_id);
        const poLines = getLatestLines(db, "audit_zoho_purchase_order_lines", "purchaseorder_id", po.purchaseorder_id);

        const allPos = db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY purchaseorder_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_purchase_orders) WHERE rn = 1`).all() as any[];
        const relatedPos = allPos.filter(p => {
           if (p.status.toLowerCase() === 'void' || p.status.toLowerCase() === 'cancelled' || p.status.toLowerCase() === 'deleted' || p.purchaseorder_id === po.purchaseorder_id) return false;
           let cf = [];
           try { cf = JSON.parse(p.custom_fields_json || "[]"); } catch(e){}
           const f = cf.find((f: any) => ((f.label || "").toLowerCase() === 'sales order no' || f.api_name === 'cf_sales_order_no'));
           const refVal = f ? f.value : (p.reference_number || null);
           if (!refVal) return false;
           const res = resolveUniqueSalesOrder(globalSoLookup, refVal);
           return res.status === 'MATCH' && res.so.salesorder_id === so.salesorder_id;
        });

        const cumulativeQtyMap = new Map<string, number>();
        const previousDocsMap = new Map<string, { number: string; date: string; qty: number; status: string; }[]>();

        for (const rp of relatedPos) {
           const lines = getLatestLines(db, "audit_zoho_purchase_order_lines", "purchaseorder_id", rp.purchaseorder_id);
           for (const line of lines) {
              const matchedSoLines = soLines.filter(soLine => soLine.item_id === line.item_id);
              if (matchedSoLines.length === 1) {
                 const refLineId = matchedSoLines[0].line_item_id;
                 cumulativeQtyMap.set(refLineId, (cumulativeQtyMap.get(refLineId) || 0) + line.quantity);
                 if (!previousDocsMap.has(refLineId)) previousDocsMap.set(refLineId, []);
                 previousDocsMap.get(refLineId)!.push({
                     number: rp.purchaseorder_number,
                     date: rp.date,
                     qty: line.quantity,
                     status: rp.status
                 });
              }
           }
        }

        let allMatched = true;
        let anyMismatch = false;
        const mappedSoLineIds = new Set<string>();

        for (const poLine of poLines) {
          const candidateSoLines = soLines.filter(soLine => soLine.item_id === poLine.item_id);

          if (candidateSoLines.length === 1) {
             const refLine = candidateSoLines[0];
             const refLineId = refLine.line_item_id;
             mappedSoLineIds.add(refLineId);

             const expectedQty = refLine.quantity;
             const actualQty = poLine.quantity;
             const previousQty = cumulativeQtyMap.get(refLineId) || 0;
             const cumulativeQty = previousQty + actualQty;

             let mismatchType: ApprovalPendingItemEvidence["mismatchType"] = "MATCHED";
             if (cumulativeQty > expectedQty) {
                mismatchType = "CUMULATIVE_QTY_EXCEEDED";
                anyMismatch = true;
                allMatched = false;
             } else if (cumulativeQty < expectedQty) {
                mismatchType = "PARTIAL_WITHIN_REFERENCE";
                allMatched = false;
             }

             // AP-UOM-BRIDGE-I1: rate comparison only when UOM evidence is proven equal.
             const uomStatus = compareUom(poLine.unit, refLine.unit);
             const uomMatch = uomStatus === "UOM_MATCH";
             const { rateCheckStatus, premiumAmount, premiumPercentage } = evaluateRateGuard({
                isMapped: true,
                uomStatus,
                refRate: refLine.rate,
                rate: poLine.rate,
             });

             itemsEvidence.push({
                sourceLineId: poLine.line_item_id,
                 displayLineNumber: poLine.displayLineNumber,
                itemId: poLine.item_id,
                itemName: poLine.item_name,
                narration: resolveNarration(poLine.description),
                refNarration: resolveNarration(refLine.description),
                refLineId,
                refRate: refLine.rate ?? null,
                refAmount: refLine.amount ?? null,
                rate: poLine.rate ?? null,
                amount: poLine.amount ?? null,
                refDisplayLineNumber: refLine.displayLineNumber,
                expectedQty,
                actualQty,
                previousQty,
                cumulativeQty,
                uomMatch,
                mismatchType,
                previousDocuments: previousDocsMap.get(refLineId) || [],
                rateCheckStatus,
                premiumAmount,
                premiumPercentage,
                unit: poLine.unit ?? null,
                refUnit: refLine.unit ?? null,
                uomStatus
             });
          } else if (candidateSoLines.length > 1) {
             itemsEvidence.push({
                sourceLineId: poLine.line_item_id,
                 displayLineNumber: poLine.displayLineNumber,
                itemId: poLine.item_id,
                itemName: poLine.item_name,
                narration: resolveNarration(poLine.description),
                refNarration: null,
                refLineId: null,
                 refRate: null,
                 refAmount: null,
                rate: poLine.rate ?? null,
                amount: poLine.amount ?? null,
                refDisplayLineNumber: null,
                expectedQty: null,
                actualQty: poLine.quantity,
                previousQty: null,
                cumulativeQty: null,
                uomMatch: false,
                mismatchType: "AMBIGUOUS_REFERENCE_LINE",
                rateCheckStatus: "CANNOT_DETERMINE",
                unit: poLine.unit ?? null,
                refUnit: null,
                uomStatus: null
             });
             anyMismatch = true;
             allMatched = false;
          } else {
             itemsEvidence.push({
                sourceLineId: poLine.line_item_id,
                 displayLineNumber: poLine.displayLineNumber,
                itemId: poLine.item_id,
                itemName: poLine.item_name,
                narration: resolveNarration(poLine.description),
                refNarration: null,
                refLineId: null,
                 refRate: null,
                 refAmount: null,
                rate: poLine.rate ?? null,
                amount: poLine.amount ?? null,
                refDisplayLineNumber: null,
                expectedQty: null,
                actualQty: poLine.quantity,
                previousQty: null,
                cumulativeQty: null,
                uomMatch: false,
                mismatchType: "ITEM_MAPPING_REQUIRED",
                rateCheckStatus: "CANNOT_DETERMINE",
                unit: poLine.unit ?? null,
                refUnit: null,
                uomStatus: null
             });
             anyMismatch = true;
             allMatched = false;
          }
        }

        for (const soLine of soLines) {
           if (!mappedSoLineIds.has(soLine.line_item_id)) {
              itemsEvidence.push({
                 sourceLineId: soLine.line_item_id,
                 displayLineNumber: soLine.displayLineNumber,
                 itemId: soLine.item_id,
                 itemName: soLine.item_name,
                 narration: resolveNarration(soLine.description),
                 refNarration: resolveNarration(soLine.description),
                 refLineId: soLine.line_item_id,
                 refRate: soLine.rate ?? null,
                 refAmount: soLine.amount ?? null,
                 rate: soLine.rate ?? null,
                 amount: soLine.amount ?? null,
                 refDisplayLineNumber: soLine.displayLineNumber,
                 expectedQty: soLine.quantity,
                 actualQty: 0,
                 previousQty: cumulativeQtyMap.get(soLine.line_item_id) || 0,
                 cumulativeQty: cumulativeQtyMap.get(soLine.line_item_id) || 0,
                 uomMatch: false,
                 mismatchType: "NOT_INCLUDED_IN_CURRENT_DOCUMENT",
                 previousDocuments: previousDocsMap.get(soLine.line_item_id) || [],
                 rateCheckStatus: "CANNOT_DETERMINE",
                 unit: null,
                 refUnit: soLine.unit ?? null,
                 uomStatus: null
              });
              allMatched = false;
           }
        }

        if (anyMismatch) verificationStatus = "MISMATCH";
        else if (allMatched) verificationStatus = "MATCHED";
        else verificationStatus = "PARTIAL_WITHIN_REFERENCE";
      }
    }

    documentsMap.set(po.purchaseorder_id, {
      id: po.purchaseorder_id,
      type: "PO",
      number: po.purchaseorder_number,
      date: po.date,
      zohoStatus: po.status,
      verificationStatus,
      customerOrVendor: po.vendor_name,
      relatedDocumentRef: soRef,
      nativeReferenceNumber: po.reference_number || null,
      referenceDate,
      referenceCustomer: referenceCustomer,
      referenceSubmittedBy: referenceSubmittedBy,
      submittedBy: userCache[po.submitter_id] || po.submitted_by_name || null,
      items: itemsEvidence,
      mismatchCount: itemsEvidence.filter(i => i.mismatchType !== 'MATCHED' && i.mismatchType !== 'PARTIAL_WITHIN_REFERENCE' && i.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT' && i.mismatchType !== 'UOM_EVIDENCE_MISSING' && i.mismatchType !== 'ITEM_MAPPING_REQUIRED' && i.mismatchType !== 'AMBIGUOUS_REFERENCE_LINE').length
    });
  }

  // 2. Process Bills
  const bills = db.prepare(billQuery).all(...queryParams) as any[];
  for (const bill of bills) {
    if (documentsMap.has(bill.bill_id)) continue;
    const poRef = bill.purchaseorder_id;
    const itemsEvidence: ApprovalPendingItemEvidence[] = [];
    let verificationStatus: ApprovalPendingDocument["verificationStatus"] = "UNRESOLVED";
    let relatedPoNumber = null;
    let referenceDate = undefined;
    let referenceCustomer = undefined;

    if (!poRef) {
      verificationStatus = "LOCAL_DATA_INCOMPLETE";
    } else {
      const po = db.prepare(`SELECT * FROM audit_zoho_purchase_orders WHERE purchaseorder_id = ? ORDER BY fetched_at DESC LIMIT 1`).get(poRef) as any;
      if (!po) {
        verificationStatus = "UNRESOLVED";
      } else {
        relatedPoNumber = po.purchaseorder_number;
        referenceDate = po.date;
        referenceCustomer = po.vendor_name;

        const poLines = getLatestLines(db, "audit_zoho_purchase_order_lines", "purchaseorder_id", poRef);
        const billLines = getLatestLines(db, "audit_zoho_bill_lines", "bill_id", bill.bill_id);

        const allBills = db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY bill_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_bills) WHERE rn = 1`).all() as any[];
        const relatedBills = allBills.filter(b => b.purchaseorder_id === poRef && b.status.toLowerCase() !== 'void' && b.status.toLowerCase() !== 'cancelled' && b.status.toLowerCase() !== 'deleted' && b.bill_id !== bill.bill_id);

        const cumulativeQtyMap = new Map<string, number>();
        const previousDocsMap = new Map<string, { number: string; date: string; qty: number; status: string; }[]>();

        for (const rb of relatedBills) {
           const lines = getLatestLines(db, "audit_zoho_bill_lines", "bill_id", rb.bill_id);
           for (const line of lines) {
              const matchedPoLines = poLines.filter(poLine => poLine.item_id === line.item_id);
              if (matchedPoLines.length === 1) {
                 const refLineId = matchedPoLines[0].line_item_id;
                 cumulativeQtyMap.set(refLineId, (cumulativeQtyMap.get(refLineId) || 0) + line.quantity);
                 if (!previousDocsMap.has(refLineId)) previousDocsMap.set(refLineId, []);
                 previousDocsMap.get(refLineId)!.push({
                     number: rb.bill_number,
                     date: rb.date,
                     qty: line.quantity,
                     status: rb.status
                 });
              }
           }
        }

        let allMatched = true;
        let anyMismatch = false;
        const mappedPoLineIds = new Set<string>();

        for (const billLine of billLines) {
          const candidatePoLines = poLines.filter(poLine => poLine.item_id === billLine.item_id);

          if (candidatePoLines.length === 1) {
             const refLine = candidatePoLines[0];
             const refLineId = refLine.line_item_id;
             mappedPoLineIds.add(refLineId);

             const expectedQty = refLine.quantity;
             const actualQty = billLine.quantity;
             const previousQty = cumulativeQtyMap.get(refLineId) || 0;
             const cumulativeQty = previousQty + actualQty;

             let mismatchType: ApprovalPendingItemEvidence["mismatchType"] = "MATCHED";
             if (cumulativeQty > expectedQty) {
                mismatchType = "CUMULATIVE_QTY_EXCEEDED";
                anyMismatch = true;
                allMatched = false;
             } else if (cumulativeQty < expectedQty) {
                mismatchType = "PARTIAL_WITHIN_REFERENCE";
                allMatched = false;
             }

             itemsEvidence.push({
                sourceLineId: billLine.line_item_id,
                 displayLineNumber: billLine.displayLineNumber,
                itemId: billLine.item_id,
                itemName: billLine.item_name,
                narration: resolveNarration(billLine.description),
                refNarration: resolveNarration(refLine.description),
                refLineId,
                refRate: refLine.rate ?? null,
                refAmount: refLine.amount ?? null,
                rate: billLine.rate ?? null,
                amount: billLine.amount ?? null,
                refDisplayLineNumber: refLine.displayLineNumber,
                expectedQty,
                actualQty,
                previousQty,
                cumulativeQty,
                uomMatch: false,
                mismatchType,
                previousDocuments: previousDocsMap.get(refLineId) || []
             });
          } else if (candidatePoLines.length > 1) {
             itemsEvidence.push({
                sourceLineId: billLine.line_item_id,
                 displayLineNumber: billLine.displayLineNumber,
                itemId: billLine.item_id,
                itemName: billLine.item_name,
                narration: resolveNarration(billLine.description),
                refNarration: null,
                refLineId: null,
                 refRate: null,
                 refAmount: null,
                rate: billLine.rate ?? null,
                amount: billLine.amount ?? null,
                refDisplayLineNumber: null,
                expectedQty: null,
                actualQty: billLine.quantity,
                previousQty: null,
                cumulativeQty: null,
                uomMatch: false,
                mismatchType: "AMBIGUOUS_REFERENCE_LINE"
             });
             anyMismatch = true;
             allMatched = false;
          } else {
             itemsEvidence.push({
                sourceLineId: billLine.line_item_id,
                 displayLineNumber: billLine.displayLineNumber,
                itemId: billLine.item_id,
                itemName: billLine.item_name,
                narration: resolveNarration(billLine.description),
                refNarration: null,
                refLineId: null,
                 refRate: null,
                 refAmount: null,
                rate: billLine.rate ?? null,
                amount: billLine.amount ?? null,
                refDisplayLineNumber: null,
                expectedQty: null,
                actualQty: billLine.quantity,
                previousQty: null,
                cumulativeQty: null,
                uomMatch: false,
                mismatchType: "ITEM_MAPPING_REQUIRED"
             });
             anyMismatch = true;
             allMatched = false;
          }
        }

        for (const poLine of poLines) {
           if (!mappedPoLineIds.has(poLine.line_item_id)) {
              itemsEvidence.push({
                 sourceLineId: poLine.line_item_id,
                 displayLineNumber: poLine.displayLineNumber,
                 itemId: poLine.item_id,
                 itemName: poLine.item_name,
                 narration: "NARRATION EVIDENCE NOT CURRENTLY SYNCHRONIZED",
                 rate: null,
                 amount: null,
                 refRate: poLine.rate ?? null,
                 refAmount: poLine.amount ?? null,
                 refLineId: poLine.line_item_id,
                 refDisplayLineNumber: poLine.displayLineNumber,
                 expectedQty: poLine.quantity,
                 actualQty: 0,
                 previousQty: cumulativeQtyMap.get(poLine.line_item_id) || 0,
                 cumulativeQty: cumulativeQtyMap.get(poLine.line_item_id) || 0,
                 uomMatch: false,
                 mismatchType: "NOT_INCLUDED_IN_CURRENT_DOCUMENT",
                 previousDocuments: previousDocsMap.get(poLine.line_item_id) || []
              });
              allMatched = false;
           }
        }

        if (anyMismatch) verificationStatus = "MISMATCH";
        else if (allMatched) verificationStatus = "MATCHED";
        else verificationStatus = "PARTIAL_WITHIN_REFERENCE";
      }
    }

    documentsMap.set(bill.bill_id, {
      id: bill.bill_id,
      type: "BILL",
      number: bill.bill_number,
      date: bill.date,
      zohoStatus: bill.status,
      verificationStatus,
      customerOrVendor: bill.vendor_name,
      relatedDocumentRef: relatedPoNumber,
      referenceDate,
      referenceCustomer: undefined,
      submittedBy: userCache[bill.submitter_id] || bill.submitted_by_name || null,
      items: itemsEvidence,
      mismatchCount: itemsEvidence.filter(i => i.mismatchType !== 'MATCHED' && i.mismatchType !== 'PARTIAL_WITHIN_REFERENCE' && i.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT' && i.mismatchType !== 'UOM_EVIDENCE_MISSING' && i.mismatchType !== 'ITEM_MAPPING_REQUIRED' && i.mismatchType !== 'AMBIGUOUS_REFERENCE_LINE').length
    });
  }

  // 3. Process Invoices
  const invoices = db.prepare(invQuery).all(...queryParams) as any[];
  for (const invoice of invoices) {
    if (documentsMap.has(invoice.invoice_id)) continue;
    const nativeSoId = invoice.salesorder_id;
    const itemsEvidence: ApprovalPendingItemEvidence[] = [];
    let verificationStatus: ApprovalPendingDocument["verificationStatus"] = "UNRESOLVED";
    let relatedSoNumber = null;
    let referenceDate = undefined;
    let referenceCustomer = undefined;
    let referenceSubmittedBy: string | null = null;

    // Resolve SO: native salesorder_id first, then cf_sales_order_no fallback
    let invoiceSo: any = null;
    if (nativeSoId) {
      invoiceSo = db.prepare(`SELECT * FROM audit_zoho_sales_orders WHERE salesorder_id = ? ORDER BY fetched_at DESC LIMIT 1`).get(nativeSoId) as any;
      if (!invoiceSo) verificationStatus = "UNRESOLVED";
    } else {
      let invCustomFields: any[] = [];
      try { invCustomFields = JSON.parse(invoice.custom_fields_json || "[]"); } catch (e) {}
      const soNumberField = invCustomFields.find((f: any) => ((f.label || "").toLowerCase() === 'sales order no' || f.api_name === 'cf_sales_order_no'));
      const cfSoRef = soNumberField ? soNumberField.value : null;
      if (!cfSoRef) {
        verificationStatus = "LOCAL_DATA_INCOMPLETE";
      } else {
        const resolution = resolveUniqueSalesOrder(globalSoLookup, cfSoRef);
        if (resolution.status !== "MATCH") {
          verificationStatus = resolution.status;
          relatedSoNumber = cfSoRef;
        } else {
          invoiceSo = resolution.so;
        }
      }
    }

    if (invoiceSo) {
        relatedSoNumber = invoiceSo.salesorder_number;
        referenceDate = invoiceSo.date;
        referenceCustomer = invoiceSo.customer_name;
        referenceSubmittedBy = invoiceSo.submitter_id ? (userCache[invoiceSo.submitter_id] || invoiceSo.submitted_by_name || null) : null;

        const resolvedSoId = invoiceSo.salesorder_id;
        const soLines = getLatestLines(db, "audit_zoho_sales_order_lines", "salesorder_id", resolvedSoId);
        const invLines = getLatestLines(db, "audit_zoho_invoice_lines", "invoice_id", invoice.invoice_id);

        const allInvs = db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY invoice_id ORDER BY fetched_at DESC) as rn FROM audit_zoho_invoices) WHERE rn = 1`).all() as any[];
        const relatedInvs = allInvs.filter(i => i.salesorder_id === resolvedSoId && i.status.toLowerCase() !== 'void' && i.status.toLowerCase() !== 'cancelled' && i.status.toLowerCase() !== 'deleted' && i.invoice_id !== invoice.invoice_id);

        const cumulativeQtyMap = new Map<string, number>();
        const previousDocsMap = new Map<string, { number: string; date: string; qty: number; status: string; }[]>();

        for (const ri of relatedInvs) {
           const lines = getLatestLines(db, "audit_zoho_invoice_lines", "invoice_id", ri.invoice_id);
           for (const line of lines) {
              // R1B REPAIR-1: Use same resolved SO line identity as current Invoice lines
              const prevResolution = resolveInvoiceLineWithMapping(
                db, ri.organization_id || invoice.organization_id || '',
                ri.invoice_id, line.line_item_id, soLines
              );
              if ((prevResolution.source === "MANUAL_MAPPING" || prevResolution.source === "ITEM_ID_UNIQUE") && prevResolution.soLine) {
                 const refLineId = prevResolution.soLine.line_item_id;
                 cumulativeQtyMap.set(refLineId, (cumulativeQtyMap.get(refLineId) || 0) + line.quantity);
                 if (!previousDocsMap.has(refLineId)) previousDocsMap.set(refLineId, []);
                 previousDocsMap.get(refLineId)!.push({
                     number: ri.invoice_number,
                     date: ri.date,
                     qty: line.quantity,
                     status: ri.status
                 });
              }
              // ITEM_ID_AMBIGUOUS / ITEM_NOT_FOUND: do NOT attribute qty arbitrarily
           }
        }

        let allMatched = true;
        let anyMismatch = false;
        const mappedSoLineIds = new Set<string>();

        for (const invLine of invLines) {
          // R1B: Mapping-aware resolution — checks manual mapping FIRST
          const lineResolution = resolveInvoiceLineWithMapping(
            db, invoice.organization_id || '', invoice.invoice_id,
            invLine.line_item_id, soLines
          );

          if (lineResolution.source === "MANUAL_MAPPING" || lineResolution.source === "ITEM_ID_UNIQUE") {
             const refLine = lineResolution.soLine;
             const refLineId = refLine.line_item_id;
             mappedSoLineIds.add(refLineId);

             const expectedQty = refLine.quantity;
             const actualQty = invLine.quantity;
             const previousQty = cumulativeQtyMap.get(refLineId) || 0;
             const cumulativeQty = previousQty + actualQty;

             let mismatchType: ApprovalPendingItemEvidence["mismatchType"] = "MATCHED";
             if (cumulativeQty > expectedQty) {
                mismatchType = "CUMULATIVE_QTY_EXCEEDED";
                anyMismatch = true;
                allMatched = false;
             } else if (cumulativeQty < expectedQty) {
                mismatchType = "PARTIAL_WITHIN_REFERENCE";
                allMatched = false;
             }

             // R1B: UOM evidence for Invoice lines
             const uomStatus = compareUom(invLine.unit, refLine.unit);
             const uomMatch = uomStatus === "UOM_MATCH";

             itemsEvidence.push({
                sourceLineId: invLine.line_item_id,
                 displayLineNumber: invLine.displayLineNumber,
                itemId: invLine.item_id,
                itemName: invLine.item_name,
                narration: resolveNarration(invLine.description),
                refNarration: resolveNarration(refLine.description),
                refLineId,
                refRate: refLine.rate ?? null,
                refAmount: refLine.amount ?? null,
                rate: invLine.rate ?? null,
                amount: invLine.amount ?? null,
                refDisplayLineNumber: refLine.displayLineNumber,
                expectedQty,
                actualQty,
                previousQty,
                cumulativeQty,
                uomMatch,
                mismatchType,
                previousDocuments: previousDocsMap.get(refLineId) || [],
                unit: invLine.unit ?? null,
                refUnit: refLine.unit ?? null,
                uomStatus
             });
          } else if (lineResolution.source === "ITEM_ID_AMBIGUOUS") {
             itemsEvidence.push({
                sourceLineId: invLine.line_item_id,
                 displayLineNumber: invLine.displayLineNumber,
                itemId: invLine.item_id,
                itemName: invLine.item_name,
                narration: resolveNarration(invLine.description),
                refNarration: null,
                refLineId: null,
                 refRate: null,
                 refAmount: null,
                rate: invLine.rate ?? null,
                amount: invLine.amount ?? null,
                refDisplayLineNumber: null,
                expectedQty: null,
                actualQty: invLine.quantity,
                previousQty: null,
                cumulativeQty: null,
                uomMatch: false,
                mismatchType: "AMBIGUOUS_REFERENCE_LINE",
                unit: invLine.unit ?? null,
                refUnit: null,
                uomStatus: null
             });
             anyMismatch = true;
             allMatched = false;
          } else {
             // ITEM_NOT_FOUND
             itemsEvidence.push({
                sourceLineId: invLine.line_item_id,
                 displayLineNumber: invLine.displayLineNumber,
                itemId: invLine.item_id,
                itemName: invLine.item_name,
                narration: resolveNarration(invLine.description),
                refNarration: null,
                refLineId: null,
                 refRate: null,
                 refAmount: null,
                rate: invLine.rate ?? null,
                amount: invLine.amount ?? null,
                refDisplayLineNumber: null,
                expectedQty: null,
                actualQty: invLine.quantity,
                previousQty: null,
                cumulativeQty: null,
                uomMatch: false,
                mismatchType: "ITEM_MAPPING_REQUIRED",
                unit: invLine.unit ?? null,
                refUnit: null,
                uomStatus: null
             });
             anyMismatch = true;
             allMatched = false;
          }
        }

        for (const soLine of soLines) {
           if (!mappedSoLineIds.has(soLine.line_item_id)) {
              itemsEvidence.push({
                 sourceLineId: soLine.line_item_id,
                 displayLineNumber: soLine.displayLineNumber,
                 itemId: soLine.item_id,
                 itemName: soLine.item_name,
                 narration: resolveNarration(soLine.description),
                 refNarration: resolveNarration(soLine.description),
                 refLineId: soLine.line_item_id,
                 refRate: soLine.rate ?? null,
                 refAmount: soLine.amount ?? null,
                 rate: soLine.rate ?? null,
                 amount: soLine.amount ?? null,
                 refDisplayLineNumber: soLine.displayLineNumber,
                 expectedQty: soLine.quantity,
                 actualQty: 0,
                 previousQty: cumulativeQtyMap.get(soLine.line_item_id) || 0,
                 cumulativeQty: cumulativeQtyMap.get(soLine.line_item_id) || 0,
                 uomMatch: false,
                 mismatchType: "NOT_INCLUDED_IN_CURRENT_DOCUMENT",
                 previousDocuments: previousDocsMap.get(soLine.line_item_id) || [],
                 unit: null,
                 refUnit: soLine.unit ?? null,
                 uomStatus: null
              });
              allMatched = false;
           }
        }

        if (anyMismatch) verificationStatus = "MISMATCH";
        else if (allMatched) verificationStatus = "MATCHED";
        else verificationStatus = "PARTIAL_WITHIN_REFERENCE";
    }

    documentsMap.set(invoice.invoice_id, {
      id: invoice.invoice_id,
      type: "INVOICE",
      number: invoice.invoice_number,
      date: invoice.date,
      zohoStatus: invoice.status,
      verificationStatus,
      customerOrVendor: invoice.delivery_customer_name || invoice.customer_id,
      relatedDocumentRef: relatedSoNumber,
      referenceDate,
      referenceCustomer,
      referenceSubmittedBy: referenceSubmittedBy,
      submittedBy: userCache[invoice.submitter_id] || invoice.submitted_by_name || null,
      items: itemsEvidence,
      mismatchCount: itemsEvidence.filter(i => i.mismatchType !== 'MATCHED' && i.mismatchType !== 'PARTIAL_WITHIN_REFERENCE' && i.mismatchType !== 'NOT_INCLUDED_IN_CURRENT_DOCUMENT' && i.mismatchType !== 'UOM_EVIDENCE_MISSING' && i.mismatchType !== 'ITEM_MAPPING_REQUIRED' && i.mismatchType !== 'AMBIGUOUS_REFERENCE_LINE').length
    });
  }

  const documents = Array.from(documentsMap.values());

  return {
    documents,
    summary: {
      totalPending: documents.length,
      poPending: documents.filter(d => d.type === "PO").length,
      billPending: documents.filter(d => d.type === "BILL").length,
      invoicePending: documents.filter(d => d.type === "INVOICE").length,
      matched: documents.filter(d => d.verificationStatus === "MATCHED").length,
      partial: documents.filter(d => d.verificationStatus === "PARTIAL_WITHIN_REFERENCE").length,
      mismatch: documents.filter(d => d.verificationStatus === "MISMATCH").length,
      unresolved: documents.filter(d => d.verificationStatus === "UNRESOLVED" || d.verificationStatus === "LOCAL_DATA_INCOMPLETE" || d.verificationStatus === "AMBIGUOUS_SO_REFERENCE" || d.verificationStatus === "SO_REFERENCE_NOT_FOUND").length
    }
  };
}
