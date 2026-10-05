// ============================================================
// Bansil Books Analytics — Section-Based PDF 1.4 Builder
// A4 Landscape · Customer Grouped · Max <= 10-12 Columns · Zero Mojibake
// Strictly Exports User-Selected Fields · Dynamic Section Filtering
// ============================================================

import type {
  ReconciliationReportResult,
  MasterInventoryMismatchReportResult,
  ExportOptions,
  ExportFieldKey,
} from "../../types/reconciliation.ts";
import {
  DEFAULT_EXPORT_FIELD_KEYS,
  EXPORT_FIELD_DEFINITIONS,
} from "../../types/reconciliation.ts";
import { formatDisplayDate, formatDisplayDateTime } from "../date-utils.ts";

interface PdfPage {
  stream: string;
}

// ---- Layout Constants (A4 Landscape) ----
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 36;
const TOP_MARGIN = 36;
const BOTTOM_MARGIN = 36;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // ~769.89 pt

/**
 * Robust string sanitization for PDF WinAnsi / Type 1 encoding.
 * Completely eliminates mojibake (â€, Â·, â‚, Â, etc.) and non-ASCII chars.
 */
export function sanitizePdfText(input?: string | number | null): string {
  if (input === null || input === undefined) return "";
  let text = String(input);

  // Replace rupee symbols and mojibake rupee
  text = text.replace(/₹/g, "Rs. ");
  text = text.replace(/\u20B9/g, "Rs. ");
  text = text.replace(/â‚¹/g, "Rs. ");
  text = text.replace(/â‚/g, "Rs. ");

  // Replace dashes and mojibake dashes
  text = text.replace(/[\u2014\u2015]/g, "-"); // em-dash
  text = text.replace(/[\u2012\u2013]/g, "-"); // en-dash
  text = text.replace(/â€”|â€“/g, "-");
  text = text.replace(/â€/g, "-");

  // Replace bullets and middle dots
  text = text.replace(/[\u2022\u00B7]/g, "|");
  text = text.replace(/Â·/g, "|");
  text = text.replace(/Â/g, "");

  // Replace any remaining non-ASCII characters with safe space/dash
  text = text.replace(/[^\x20-\x7E\n\r\t]/g, " ");

  // Normalize duplicate whitespace
  text = text.replace(/[ \t]+/g, " ").trim();

  return text;
}

/**
 * Escapes characters for PDF text literal syntax: \(, \), \\
 */
export function escapePdfText(text: string): string {
  const sanitized = sanitizePdfText(text);
  return sanitized
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Formats financial amounts with Indian number grouping and 2 decimal places.
 */
export function formatINR(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === "") return "-";
  const num = typeof val === "string" ? parseFloat(val) : Number(val);
  if (isNaN(num)) return "-";
  const rounded = Math.round(num * 100) / 100;
  const isNeg = rounded < 0;
  const absVal = Math.abs(rounded);
  const fixed = absVal.toFixed(2);
  const parts = fixed.split(".");
  let intPart = parts[0];
  const decPart = parts[1];

  if (intPart.length > 3) {
    const last3 = intPart.substring(intPart.length - 3);
    const rest = intPart.substring(0, intPart.length - 3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    intPart = `${grouped},${last3}`;
  }
  const str = `Rs. ${intPart}.${decPart}`;
  return isNeg ? `(${str})` : str;
}

/**
 * Formats quantity up to 3 decimals with Indian number grouping.
 */
export function formatQty(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === "") return "0";
  const num = typeof val === "string" ? parseFloat(val) : Number(val);
  if (isNaN(num)) return "0";
  const rounded = Math.round(num * 1000) / 1000;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(rounded);
}

/**
 * Formats date into DD/MM/YYYY for PDF display.
 */
export function formatPdfDate(dateStr?: string | null): string {
  if (!dateStr || dateStr === "—" || dateStr === "-") return "-";
  return formatDisplayDate(dateStr);
}

/**
 * Formats document list with vertical stacking (up to 2 docs, +N more).
 */
export function formatDocumentList(docInput: any): string[] {
  if (!docInput) return ["-"];
  if (Array.isArray(docInput)) {
    const list = docInput
      .map((d) => (typeof d === "string" ? d : d.billNumber || d.invoiceNumber || ""))
      .filter(Boolean);
    if (list.length === 0) return ["-"];
    if (list.length <= 2) return list;
    return [list[0], list[1], `+${list.length - 2} more`];
  }
  if (typeof docInput === "string") {
    const parts = docInput.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return ["-"];
    if (parts.length <= 2) return parts;
    return [parts[0], parts[1], `+${parts.length - 2} more`];
  }
  return ["-"];
}

/**
 * Wraps text into lines that do not exceed max characters.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const clean = sanitizePdfText(text);
  if (!clean) return ["-"];
  if (clean.length <= maxChars) return [clean];

  const words = clean.split(" ");
  const lines: string[] = [];
  let cur = "";

  for (const w of words) {
    if ((cur + (cur ? " " : "") + w).length <= maxChars) {
      cur += (cur ? " " : "") + w;
    } else {
      if (cur) lines.push(cur);
      if (w.length > maxChars) {
        let remaining = w;
        while (remaining.length > maxChars) {
          lines.push(remaining.slice(0, maxChars));
          remaining = remaining.slice(maxChars);
        }
        cur = remaining;
      } else {
        cur = w;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : ["-"];
}

// ---- Column Specification Interface ----

export interface PdfColumnSpec {
  key: ExportFieldKey;
  header: string;
  width: number;
  align: "left" | "center" | "right";
  maxChars?: number;
  getValue: (item: any, idx: number) => string | string[];
  getRawSum?: (item: any) => number | null;
  isCurrencySum?: boolean;
}

export interface PdfSectionSpec {
  id: string;
  title: string;
  subtitle: string;
  fieldKeys: ExportFieldKey[];
  columns: PdfColumnSpec[];
}

// ---- Master Dictionary of all 39 ExportFieldKeys ----

export const ALL_COLUMN_SPECS: Record<ExportFieldKey, PdfColumnSpec> = {
  // GENERAL
  sr: {
    key: "sr",
    header: "Sr",
    width: 26,
    align: "center",
    getValue: (_, idx) => String(idx + 1),
  },
  period: {
    key: "period",
    header: "Period",
    width: 60,
    align: "center",
    getValue: (item) => item.period || item.financialYear || "-",
  },
  customerName: {
    key: "customerName",
    header: "Customer Name",
    width: 135,
    align: "left",
    maxChars: 22,
    getValue: (item) => item.customerName || "-",
  },
  customerId: {
    key: "customerId",
    header: "Customer ID",
    width: 70,
    align: "left",
    maxChars: 14,
    getValue: (item) => item.customerId || "-",
  },
  itemName: {
    key: "itemName",
    header: "Item Name",
    width: 135,
    align: "left",
    maxChars: 22,
    getValue: (item) => item.itemName || "-",
  },
  itemId: {
    key: "itemId",
    header: "Item ID",
    width: 70,
    align: "left",
    maxChars: 14,
    getValue: (item) => item.itemId || "-",
  },
  sku: {
    key: "sku",
    header: "SKU / Code",
    width: 65,
    align: "left",
    maxChars: 12,
    getValue: (item) => item.sku || "-",
  },
  status: {
    key: "status",
    header: "Status",
    width: 70,
    align: "center",
    getValue: (item) => item.status || (item.isExcluded ? "EXCLUDED" : "RECONCILED"),
  },

  // PURCHASE
  billNumber: {
    key: "billNumber",
    header: "Bill No.",
    width: 95,
    align: "left",
    getValue: (item) => formatDocumentList(item.billList || item.billNumbers),
  },
  billDate: {
    key: "billDate",
    header: "Bill Date",
    width: 65,
    align: "center",
    getValue: (item) => formatPdfDate(item.billDate || item.approxRateDate),
  },
  vendorName: {
    key: "vendorName",
    header: "Vendor",
    width: 120,
    align: "left",
    maxChars: 18,
    getValue: (item) => item.vendorName || item.approxRateVendor || "-",
  },
  vendorId: {
    key: "vendorId",
    header: "Vendor ID",
    width: 70,
    align: "left",
    maxChars: 14,
    getValue: (item) => item.vendorId || "-",
  },
  purchaseQty: {
    key: "purchaseQty",
    header: "Purchase Qty",
    width: 68,
    align: "right",
    getValue: (item) => formatQty(item.purchaseQty),
    getRawSum: (item) => item.purchaseQty,
  },
  purchaseRate: {
    key: "purchaseRate",
    header: "Purchase Rate",
    width: 80,
    align: "right",
    getValue: (item) => {
      const pr =
        item.singlePurchaseRate ??
        item.avgPurchaseRate ??
        (item.purchaseQty ? item.purchaseAmount / item.purchaseQty : null);
      return pr != null ? formatINR(pr) : "-";
    },
  },
  purchaseAmount: {
    key: "purchaseAmount",
    header: "Purchase Amount",
    width: 95,
    align: "right",
    getValue: (item) => formatINR(item.purchaseAmount),
    getRawSum: (item) => item.purchaseAmount,
    isCurrencySum: true,
  },
  purchaseCustomerDetails: {
    key: "purchaseCustomerDetails",
    header: "Purch Customer Details",
    width: 110,
    align: "left",
    maxChars: 18,
    getValue: (item) => item.purchaseCustomerDetails || item.customerName || "-",
  },

  // SALES
  invoiceNumber: {
    key: "invoiceNumber",
    header: "Invoice No.",
    width: 105,
    align: "left",
    getValue: (item) => formatDocumentList(item.invoiceList || item.invoiceNumbers),
  },
  invoiceDate: {
    key: "invoiceDate",
    header: "Invoice Date",
    width: 68,
    align: "center",
    getValue: (item) => formatPdfDate(item.invoiceDate),
  },
  salesQty: {
    key: "salesQty",
    header: "Sales Qty",
    width: 68,
    align: "right",
    getValue: (item) => formatQty(item.salesQty),
    getRawSum: (item) => item.salesQty,
  },
  salesRate: {
    key: "salesRate",
    header: "Sales Rate",
    width: 80,
    align: "right",
    getValue: (item) => {
      const sr =
        item.singleSalesRate ??
        item.avgSalesRate ??
        (item.salesQty ? item.salesAmount / item.salesQty : null);
      return sr != null ? formatINR(sr) : "-";
    },
  },
  salesAmount: {
    key: "salesAmount",
    header: "Sales Amount",
    width: 95,
    align: "right",
    getValue: (item) => formatINR(item.salesAmount),
    getRawSum: (item) => item.salesAmount,
    isCurrencySum: true,
  },

  // RECONCILIATION
  balanceQty: {
    key: "balanceQty",
    header: "Balance Qty",
    width: 68,
    align: "right",
    getValue: (item) => formatQty(item.balanceQty),
    getRawSum: (item) => item.balanceQty,
  },
  yetToPurchase: {
    key: "yetToPurchase",
    header: "Yet to Purch",
    width: 68,
    align: "right",
    getValue: (item) => formatQty(item.yetToPurchaseQty),
    getRawSum: (item) => item.yetToPurchaseQty,
  },
  yetToSale: {
    key: "yetToSale",
    header: "Yet to Sale",
    width: 68,
    align: "right",
    getValue: (item) => formatQty(item.yetToSaleQty),
    getRawSum: (item) => item.yetToSaleQty,
  },
  reconciledQty: {
    key: "reconciledQty",
    header: "Reconciled",
    width: 68,
    align: "right",
    getValue: (item) => formatQty(item.reconciledQty),
    getRawSum: (item) => item.reconciledQty,
  },
  approxShortageValue: {
    key: "approxShortageValue",
    header: "Approx Shortage Value",
    width: 100,
    align: "right",
    getValue: (item) => (item.approxShortageValue != null ? formatINR(item.approxShortageValue) : "-"),
    getRawSum: (item) => (item.approxShortageValue != null ? Number(item.approxShortageValue) : 0),
    isCurrencySum: true,
  },
  approxSurplusValue: {
    key: "approxSurplusValue",
    header: "Approx Surplus Value",
    width: 100,
    align: "right",
    getValue: (item) => (item.approxSurplusValue != null ? formatINR(item.approxSurplusValue) : "-"),
    getRawSum: (item) => (item.approxSurplusValue != null ? Number(item.approxSurplusValue) : 0),
    isCurrencySum: true,
  },
  approxRefPurchaseRate: {
    key: "approxRefPurchaseRate",
    header: "Ref Purch Rate",
    width: 80,
    align: "right",
    getValue: (item) => (item.approxRefPurchaseRate != null ? formatINR(item.approxRefPurchaseRate) : "-"),
  },
  approxRateBasis: {
    key: "approxRateBasis",
    header: "Rate Basis",
    width: 85,
    align: "left",
    maxChars: 14,
    getValue: (item) => item.approxRateBasis || "-",
  },
  approxRateDate: {
    key: "approxRateDate",
    header: "Ref Bill Date",
    width: 65,
    align: "center",
    getValue: (item) => formatPdfDate(item.approxRateDate),
  },
  approxRateBillNumber: {
    key: "approxRateBillNumber",
    header: "Ref Bill No.",
    width: 75,
    align: "left",
    getValue: (item) => item.approxRateBillNumber || "-",
  },
  approxRateVendor: {
    key: "approxRateVendor",
    header: "Ref Vendor",
    width: 110,
    align: "left",
    maxChars: 16,
    getValue: (item) => item.approxRateVendor || "-",
  },

  // EXCLUSION / AUDIT
  includedInReconciliation: {
    key: "includedInReconciliation",
    header: "Included in Recon",
    width: 80,
    align: "center",
    getValue: (item) => (item.isExcluded ? "No" : "Yes"),
  },
  isExcluded: {
    key: "isExcluded",
    header: "Excluded",
    width: 60,
    align: "center",
    getValue: (item) => (item.isExcluded ? "Yes" : "No"),
  },
  exclusionScope: {
    key: "exclusionScope",
    header: "Exclusion Scope",
    width: 80,
    align: "left",
    maxChars: 12,
    getValue: (item) => item.exclusionScope || "-",
  },
  exclusionReason: {
    key: "exclusionReason",
    header: "Exclusion Reason",
    width: 95,
    align: "left",
    maxChars: 15,
    getValue: (item) => item.exclusionReason || item.reason || "-",
  },
  remarks: {
    key: "remarks",
    header: "Remarks",
    width: 90,
    align: "left",
    maxChars: 14,
    getValue: (item) => item.remarks || "-",
  },
  approvedBy: {
    key: "approvedBy",
    header: "Approved By",
    width: 80,
    align: "left",
    maxChars: 12,
    getValue: (item) => item.approvedBy || "-",
  },
  approvedDate: {
    key: "approvedDate",
    header: "Approved Date",
    width: 70,
    align: "center",
    getValue: (item) => formatPdfDate(item.approvedDate),
  },
};

// ---- Dynamic Section Templates ----

interface SectionTemplate {
  id: string;
  title: string;
  subtitle: string;
  triggerKeys: ExportFieldKey[];
  candidateKeys: ExportFieldKey[];
}

const SECTION_TEMPLATES: SectionTemplate[] = [
  // SECTION A: SUMMARY
  {
    id: "SUMMARY",
    title: "SECTION A: SUMMARY — RECONCILIATION & BALANCE",
    subtitle: "Customer-Item Quantities, Net Balance, Shortage (Yet to Purchase), and Surplus (Yet to Sale)",
    triggerKeys: [
      "sr",
      "period",
      "customerName",
      "itemName",
      "sku",
      "status",
      "purchaseQty",
      "salesQty",
      "balanceQty",
      "yetToPurchase",
      "yetToSale",
      "reconciledQty",
    ],
    candidateKeys: [
      "sr",
      "period",
      "customerName",
      "itemName",
      "sku",
      "status",
      "purchaseQty",
      "salesQty",
      "balanceQty",
      "yetToPurchase",
      "yetToSale",
      "reconciledQty",
    ],
  },

  // SECTION B: FINANCIAL
  {
    id: "FINANCIAL",
    title: "SECTION B: FINANCIAL & VALUATION ANALYSIS",
    subtitle: "Total Purchase Amount, Sales Amount, and Approx Shortage/Surplus Values",
    triggerKeys: ["approxShortageValue", "approxSurplusValue"],
    candidateKeys: [
      "sr",
      "customerName",
      "itemName",
      "purchaseAmount",
      "salesAmount",
      "approxShortageValue",
      "approxSurplusValue",
    ],
  },

  // SECTION C: PURCHASE REFERENCE
  {
    id: "PURCHASE_REF",
    title: "SECTION C: PURCHASE REFERENCE & VOUCHERS",
    subtitle: "Purchase Bill Numbers, Dates, Vendors, Unit Rates, and Totals",
    triggerKeys: [
      "billNumber",
      "billDate",
      "vendorName",
      "vendorId",
      "purchaseRate",
      "purchaseAmount",
      "purchaseCustomerDetails",
    ],
    candidateKeys: [
      "sr",
      "customerName",
      "itemName",
      "billNumber",
      "billDate",
      "vendorName",
      "vendorId",
      "purchaseRate",
      "purchaseAmount",
      "purchaseCustomerDetails",
    ],
  },

  // SECTION D: SALES REFERENCE
  {
    id: "SALES_REF",
    title: "SECTION D: SALES REFERENCE & INVOICES",
    subtitle: "Sales Invoice Numbers, Dates, Unit Rates, and Totals",
    triggerKeys: ["invoiceNumber", "invoiceDate", "salesRate", "salesAmount"],
    candidateKeys: [
      "sr",
      "customerName",
      "itemName",
      "invoiceNumber",
      "invoiceDate",
      "salesRate",
      "salesAmount",
    ],
  },

  // SECTION E: APPROX RATE & AUDIT
  {
    id: "AUDIT",
    title: "SECTION E: APPROX RATE VALUATION BASIS & AUDIT",
    subtitle: "Reference Purchase Rates, Reference Bill/Date/Vendor, Rate Basis, and Exclusion Policies",
    triggerKeys: [
      "approxRefPurchaseRate",
      "approxRateBillNumber",
      "approxRateDate",
      "approxRateVendor",
      "approxRateBasis",
      "customerId",
      "itemId",
      "includedInReconciliation",
      "isExcluded",
      "exclusionScope",
      "exclusionReason",
      "remarks",
      "approvedBy",
      "approvedDate",
    ],
    candidateKeys: [
      "sr",
      "customerName",
      "customerId",
      "itemName",
      "itemId",
      "approxRefPurchaseRate",
      "approxRateBillNumber",
      "approxRateDate",
      "approxRateVendor",
      "approxRateBasis",
      "includedInReconciliation",
      "isExcluded",
      "exclusionScope",
      "exclusionReason",
      "remarks",
      "approvedBy",
      "approvedDate",
    ],
  },
];

/**
 * Legacy full static section definitions (for backwards compatibility / unit test inspection)
 */
export const PDF_SECTIONS: PdfSectionSpec[] = SECTION_TEMPLATES.map((tmpl) => {
  const rawCols = tmpl.candidateKeys.map((k) => ALL_COLUMN_SPECS[k]).filter(Boolean);
  // Cap at 10-12 columns
  const boundedCols = rawCols.slice(0, 10);
  const totalBase = boundedCols.reduce((sum, c) => sum + c.width, 0);
  const scale = totalBase > 0 ? USABLE_WIDTH / totalBase : 1;
  let assigned = 0;
  const scaled = boundedCols.map((c, idx) => {
    if (idx === boundedCols.length - 1) {
      return { ...c, width: Math.round(USABLE_WIDTH - assigned) };
    }
    const w = Math.round(c.width * scale);
    assigned += w;
    return { ...c, width: w };
  });
  return {
    id: tmpl.id,
    title: tmpl.title,
    subtitle: tmpl.subtitle,
    fieldKeys: tmpl.candidateKeys,
    columns: scaled,
  };
});

/**
 * Dynamically builds PDF sections strictly containing user-selected fields.
 * If user selected a custom set, only sections with selected fields are created.
 * Inside each section, ONLY selected columns are rendered.
 */
export function getActivePdfSections(options?: ExportOptions): PdfSectionSpec[] {
  const selectedKeys =
    options?.selectedFields && options.selectedFields.length > 0
      ? options.selectedFields
      : DEFAULT_EXPORT_FIELD_KEYS;

  const selectedSet = new Set<string>(selectedKeys);
  const resultSections: PdfSectionSpec[] = [];

  for (const tmpl of SECTION_TEMPLATES) {
    // 1. Check if at least one trigger key for this section is selected
    const hasTrigger = tmpl.triggerKeys.some((k) => selectedSet.has(k));
    if (!hasTrigger) continue;

    // 2. Filter candidate keys strictly by selectedSet
    // Rule: visibleColumn = selectedFields.includes(fieldKey)
    const activeColKeys = tmpl.candidateKeys.filter((k) => selectedSet.has(k));
    if (activeColKeys.length === 0) continue;

    // 3. Map to column specs
    const rawCols = activeColKeys.map((k) => ALL_COLUMN_SPECS[k]).filter(Boolean);
    if (rawCols.length === 0) continue;

    // 4. If active column count exceeds 12, chunk columns to ensure MAX <= 12
    const MAX_COLS_PER_TABLE = 12;
    if (rawCols.length <= MAX_COLS_PER_TABLE) {
      const totalBaseWidth = rawCols.reduce((sum, c) => sum + c.width, 0);
      const scale = totalBaseWidth > 0 ? USABLE_WIDTH / totalBaseWidth : 1;

      let assignedWidth = 0;
      const scaledCols: PdfColumnSpec[] = rawCols.map((c, idx) => {
        if (idx === rawCols.length - 1) {
          return { ...c, width: Math.round(USABLE_WIDTH - assignedWidth) };
        }
        const w = Math.round(c.width * scale);
        assignedWidth += w;
        return { ...c, width: w };
      });

      resultSections.push({
        id: tmpl.id,
        title: tmpl.title,
        subtitle: tmpl.subtitle,
        fieldKeys: activeColKeys,
        columns: scaledCols,
      });
    } else {
      // Chunk columns into sub-tables of max 10-12 columns each
      const contextCols = rawCols.filter((c) => c.key === "sr" || c.key === "customerName" || c.key === "itemName");
      const payloadCols = rawCols.filter((c) => c.key !== "sr" && c.key !== "customerName" && c.key !== "itemName");
      const chunkSize = Math.max(1, MAX_COLS_PER_TABLE - contextCols.length);

      for (let i = 0; i < payloadCols.length; i += chunkSize) {
        const chunk = payloadCols.slice(i, i + chunkSize);
        const subCols = [...contextCols, ...chunk];
        const totalBaseWidth = subCols.reduce((sum, c) => sum + c.width, 0);
        const scale = totalBaseWidth > 0 ? USABLE_WIDTH / totalBaseWidth : 1;

        let assignedWidth = 0;
        const scaledCols: PdfColumnSpec[] = subCols.map((c, idx) => {
          if (idx === subCols.length - 1) {
            return { ...c, width: Math.round(USABLE_WIDTH - assignedWidth) };
          }
          const w = Math.round(c.width * scale);
          assignedWidth += w;
          return { ...c, width: w };
        });

        const partNum = Math.floor(i / chunkSize) + 1;
        resultSections.push({
          id: `${tmpl.id}_PART${partNum}`,
          title: `${tmpl.title} - Part ${partNum}`,
          subtitle: tmpl.subtitle,
          fieldKeys: subCols.map((c) => c.key),
          columns: scaledCols,
        });
      }
    }
  }

  return resultSections;
}

/**
 * Normalizes input report data into uniform items array.
 */
function normalizeReportItems(report: any): any[] {
  if (Array.isArray(report.items) && report.items.length > 0) {
    return report.items;
  }
  if (Array.isArray(report.summaryItems) && report.summaryItems.length > 0) {
    return report.summaryItems;
  }
  return [];
}

/**
 * Customer Grouped, Multi-Page, Section-Based PDF Builder.
 * Maximum <= 10-12 columns per table. Zero mojibake. Full Indian formatting.
 */
export function generateSectionBasedPdf(
  reportData: any,
  options?: ExportOptions,
  reportTitle: string = "Master Inventory Mismatch"
): Buffer {
  const items = normalizeReportItems(reportData);
  const activeSections = getActivePdfSections(options);
  const includeTotals = options?.includeTotals !== false;

  const filterFy = sanitizePdfText(reportData.filter?.financialYear || "FY 2026-27");
  const filterPeriod = sanitizePdfText(reportData.filter?.period || "Current FY");
  const filterDate =
    reportData.filter?.fromDate && reportData.filter?.toDate
      ? `${formatPdfDate(reportData.filter.fromDate)} to ${formatPdfDate(reportData.filter.toDate)}`
      : "Full Period";
  const syncDate = formatDisplayDateTime(reportData.dataLastSynced);
  const genDate = formatDisplayDate(new Date().toISOString().slice(0, 10));

  // Group items by Customer Name
  const customerMap = new Map<string, any[]>();
  for (const item of items) {
    const cName = sanitizePdfText(item.customerName || "UNSPECIFIED CUSTOMER");
    if (!customerMap.has(cName)) customerMap.set(cName, []);
    customerMap.get(cName)!.push(item);
  }
  const sortedCustomerNames = Array.from(customerMap.keys()).sort((a, b) => a.localeCompare(b));

  const pages: PdfPage[] = [];
  let currentPageStream = "";
  let curY = PAGE_HEIGHT - TOP_MARGIN;
  let isPage1 = true;
  let curSectionTitle = "";

  function startNewPage(secTitle?: string) {
    if (currentPageStream) {
      pages.push({ stream: currentPageStream });
    }
    currentPageStream = "";
    curY = PAGE_HEIGHT - TOP_MARGIN;
    isPage1 = pages.length === 0;
    if (secTitle) curSectionTitle = secTitle;

    // Draw page header
    if (isPage1) {
      // Main Title Header
      currentPageStream += `BT /F2 15 Tf 0.1 0.1 0.1 rg ${MARGIN_X} ${curY - 14} Td (BANSIL ENGINEERS) Tj ET\n`;
      currentPageStream += `BT /F2 11 Tf 0.15 0.25 0.55 rg ${MARGIN_X} ${curY - 28} Td (${escapePdfText(reportTitle)} - Customer-Item Balance & Shortage Analysis) Tj ET\n`;

      // Metadata Block (Right side)
      const metaRightX = PAGE_WIDTH - MARGIN_X - 250;
      currentPageStream += `BT /F1 8.5 Tf 0.3 0.3 0.3 rg ${metaRightX} ${curY - 12} Td (Financial Year: ${escapePdfText(filterFy)} | Period: ${escapePdfText(filterPeriod)}) Tj ET\n`;
      currentPageStream += `BT /F1 8.5 Tf 0.3 0.3 0.3 rg ${metaRightX} ${curY - 24} Td (Data Last Synced: ${escapePdfText(syncDate || "-")}) Tj ET\n`;
      currentPageStream += `BT /F1 8.5 Tf 0.3 0.3 0.3 rg ${metaRightX} ${curY - 36} Td (Generated: ${escapePdfText(genDate)} | Local SQLite Cache) Tj ET\n`;

      curY -= 48;

      // Filter & KPI Summary Bar
      currentPageStream += `0.95 0.96 0.98 rg ${MARGIN_X} ${curY - 26} ${USABLE_WIDTH} 26 re f\n`;
      currentPageStream += `0.85 0.88 0.92 RG 0.5 w ${MARGIN_X} ${curY - 26} ${USABLE_WIDTH} 26 re S\n`;

      const recCount = items.length;
      const totShortage =
        reportData.totals?.shortageCount ?? items.filter((i: any) => i.status === "SHORTAGE").length;
      const totSurplus =
        reportData.totals?.surplusCount ?? items.filter((i: any) => i.status === "SURPLUS").length;
      const totReconciled =
        reportData.totals?.reconciledCount ?? items.filter((i: any) => i.status === "RECONCILED").length;
      const netBal = reportData.totals?.netBalanceQty ?? reportData.totals?.balanceQty ?? 0;

      currentPageStream += `BT /F2 8.5 Tf 0.2 0.2 0.2 rg ${MARGIN_X + 10} ${curY - 17} Td (Records: ${recCount}) Tj ET\n`;
      currentPageStream += `BT /F2 8.5 Tf 0.7 0.1 0.1 rg ${MARGIN_X + 120} ${curY - 17} Td (Shortages: ${totShortage}) Tj ET\n`;
      currentPageStream += `BT /F2 8.5 Tf 0.1 0.4 0.7 rg ${MARGIN_X + 230} ${curY - 17} Td (Surplus: ${totSurplus}) Tj ET\n`;
      currentPageStream += `BT /F2 8.5 Tf 0.1 0.6 0.2 rg ${MARGIN_X + 330} ${curY - 17} Td (Reconciled: ${totReconciled}) Tj ET\n`;
      currentPageStream += `BT /F2 8.5 Tf 0.2 0.2 0.2 rg ${MARGIN_X + 450} ${curY - 17} Td (Net Balance Qty: ${formatQty(netBal)}) Tj ET\n`;
      currentPageStream += `BT /F1 8 Tf 0.35 0.35 0.35 rg ${MARGIN_X + 600} ${curY - 17} Td (Date: ${escapePdfText(filterDate)}) Tj ET\n`;

      curY -= 36;
    } else {
      // Continuation Header
      currentPageStream += `BT /F2 9.5 Tf 0.2 0.2 0.2 rg ${MARGIN_X} ${curY - 10} Td (BANSIL ENGINEERS - ${escapePdfText(reportTitle)} [${escapePdfText(curSectionTitle)}]) Tj ET\n`;
      currentPageStream += `BT /F1 8.5 Tf 0.4 0.4 0.4 rg ${PAGE_WIDTH - MARGIN_X - 180} ${curY - 10} Td (FY: ${escapePdfText(filterFy)} | Synced: ${escapePdfText(syncDate || "-")}) Tj ET\n`;
      curY -= 20;
    }
  }

  // Helper to draw section table header
  function drawSectionTableHeader(sec: PdfSectionSpec) {
    const HEADER_HEIGHT = 20;
    currentPageStream += `0.92 0.94 0.97 rg ${MARGIN_X} ${curY - HEADER_HEIGHT} ${USABLE_WIDTH} ${HEADER_HEIGHT} re f\n`;
    currentPageStream += `0.8 0.83 0.88 RG 0.5 w ${MARGIN_X} ${curY - HEADER_HEIGHT} ${USABLE_WIDTH} ${HEADER_HEIGHT} re S\n`;

    let colX = MARGIN_X;
    for (const col of sec.columns) {
      const escH = escapePdfText(col.header);
      const font = "/F2 8 Tf";
      const color = "0.15 0.15 0.15 rg";
      if (col.align === "right") {
        const estW = escH.length * 4.4;
        currentPageStream += `BT ${font} ${color} ${colX + col.width - 5 - estW} ${curY - 14} Td (${escH}) Tj ET\n`;
      } else if (col.align === "center") {
        const estW = escH.length * 4.4;
        currentPageStream += `BT ${font} ${color} ${colX + (col.width - estW) / 2} ${curY - 14} Td (${escH}) Tj ET\n`;
      } else {
        currentPageStream += `BT ${font} ${color} ${colX + 5} ${curY - 14} Td (${escH}) Tj ET\n`;
      }
      colX += col.width;
    }
    curY -= HEADER_HEIGHT;
  }

  // ---- RENDER EACH ACTIVE SECTION ----
  if (activeSections.length === 0) {
    startNewPage("No Fields Selected");
    currentPageStream += `BT /F2 12 Tf 0.5 0.1 0.1 rg ${MARGIN_X + 20} ${curY - 40} Td (No fields were selected for export.) Tj ET\n`;
  } else {
    startNewPage(activeSections[0]?.title);

    let globalItemIndex = 0;

    for (let sIdx = 0; sIdx < activeSections.length; sIdx++) {
      const sec = activeSections[sIdx];
      curSectionTitle = sec.title;

      // Start each subsequent section on a fresh page for clean multi-section report
      if (sIdx > 0) {
        startNewPage(sec.title);
      }

      // Section Header Banner
      const SEC_BANNER_H = 24;
      currentPageStream += `0.93 0.96 0.99 rg ${MARGIN_X} ${curY - SEC_BANNER_H} ${USABLE_WIDTH} ${SEC_BANNER_H} re f\n`;
      currentPageStream += `0.7 0.8 0.9 RG 0.75 w ${MARGIN_X} ${curY - SEC_BANNER_H} ${USABLE_WIDTH} ${SEC_BANNER_H} re S\n`;
      currentPageStream += `BT /F2 9.5 Tf 0.1 0.2 0.5 rg ${MARGIN_X + 8} ${curY - 16} Td (${escapePdfText(sec.title)}) Tj ET\n`;
      curY -= SEC_BANNER_H + 4;

      // Draw Table Header
      drawSectionTableHeader(sec);

      // Track column sums for section totals
      const sectionColSums: number[] = sec.columns.map(() => 0);
      let sectionHasSums = false;

      // Render items grouped by customer
      for (const custName of sortedCustomerNames) {
        const custItems = customerMap.get(custName) || [];
        if (custItems.length === 0) continue;

        // Check space for Customer Banner + 1 Row (at least 50pt)
        if (curY < BOTTOM_MARGIN + 50) {
          startNewPage(sec.title);
          drawSectionTableHeader(sec);
        }

        // Customer Group Banner Row
        const CUST_BANNER_H = 16;
        currentPageStream += `0.96 0.98 1.0 rg ${MARGIN_X} ${curY - CUST_BANNER_H} ${USABLE_WIDTH} ${CUST_BANNER_H} re f\n`;
        currentPageStream += `0.85 0.9 0.95 RG 0.5 w ${MARGIN_X} ${curY - CUST_BANNER_H} ${USABLE_WIDTH} ${CUST_BANNER_H} re S\n`;
        currentPageStream += `BT /F2 8.5 Tf 0.05 0.25 0.5 rg ${MARGIN_X + 8} ${curY - 12} Td (CUSTOMER: ${escapePdfText(custName)} [${custItems.length} items]) Tj ET\n`;
        curY -= CUST_BANNER_H;

        // Render rows for this customer
        for (let rIdx = 0; rIdx < custItems.length; rIdx++) {
          const item = custItems[rIdx];

          // Format cell values and calculate required wrapped row height
          const formattedCells: { textLines: string[]; align: string; font: string; color: string; width: number }[] = [];
          let maxLinesInRow = 1;

          for (const col of sec.columns) {
            const rawVal = col.getValue(item, globalItemIndex);
            let lines: string[] = [];
            if (Array.isArray(rawVal)) {
              lines = rawVal.map((s) => sanitizePdfText(s));
            } else {
              const strVal = sanitizePdfText(rawVal);
              if (col.maxChars && strVal.length > col.maxChars) {
                lines = wrapText(strVal, col.maxChars);
              } else {
                lines = [strVal];
              }
            }
            if (lines.length > maxLinesInRow) maxLinesInRow = lines.length;

            // Compute column sums
            if (col.getRawSum) {
              const num = col.getRawSum(item);
              if (num != null && !isNaN(num)) {
                const cIndex = sec.columns.indexOf(col);
                sectionColSums[cIndex] += Number(num);
                sectionHasSums = true;
              }
            }

            let font = "/F1 7.5 Tf";
            let color = "0.15 0.15 0.15 rg";

            if (col.key === "status") {
              font = "/F2 7.5 Tf";
              const st = String(item.status || "").toUpperCase();
              if (st === "SHORTAGE") color = "0.8 0.1 0.1 rg";
              else if (st === "SURPLUS") color = "0.1 0.4 0.7 rg";
              else if (st === "RECONCILED") color = "0.1 0.6 0.2 rg";
            } else if (col.key === "balanceQty" && Number(item.balanceQty) < 0) {
              font = "/F2 7.5 Tf";
              color = "0.8 0.1 0.1 rg";
            } else if (col.key === "sr") {
              font = "/F1 7.5 Tf";
              color = "0.4 0.4 0.4 rg";
            }

            formattedCells.push({
              textLines: lines,
              align: col.align,
              font,
              color,
              width: col.width,
            });
          }

          const calculatedRowHeight = Math.max(18, maxLinesInRow * 11 + 6);

          // Check page overflow
          if (curY - calculatedRowHeight < BOTTOM_MARGIN + 20) {
            startNewPage(sec.title);
            drawSectionTableHeader(sec);
          }

          const rowY = curY - calculatedRowHeight;

          // Alternating background
          if (globalItemIndex % 2 === 1) {
            currentPageStream += `0.98 0.98 0.99 rg ${MARGIN_X} ${rowY} ${USABLE_WIDTH} ${calculatedRowHeight} re f\n`;
          }
          // Row divider
          currentPageStream += `0.9 0.9 0.92 RG 0.5 w ${MARGIN_X} ${rowY} m ${MARGIN_X + USABLE_WIDTH} ${rowY} l S\n`;

          // Render cells
          let cellX = MARGIN_X;
          for (const cell of formattedCells) {
            const lineCount = cell.textLines.length;
            for (let lIdx = 0; lIdx < lineCount; lIdx++) {
              const lineText = escapePdfText(cell.textLines[lIdx]);
              const textY = rowY + calculatedRowHeight - 12 - lIdx * 10.5;

              if (cell.align === "right") {
                const estW = lineText.length * 4.2;
                currentPageStream += `BT ${cell.font} ${cell.color} ${cellX + cell.width - 5 - estW} ${textY} Td (${lineText}) Tj ET\n`;
              } else if (cell.align === "center") {
                const estW = lineText.length * 4.2;
                currentPageStream += `BT ${cell.font} ${cell.color} ${cellX + (cell.width - estW) / 2} ${textY} Td (${lineText}) Tj ET\n`;
              } else {
                currentPageStream += `BT ${cell.font} ${cell.color} ${cellX + 5} ${textY} Td (${lineText}) Tj ET\n`;
              }
            }
            cellX += cell.width;
          }

          globalItemIndex++;
          curY -= calculatedRowHeight;
        }
      }

      // Section Totals Row
      if (includeTotals && sectionHasSums && items.length > 0) {
        const TOTAL_H = 22;
        if (curY - TOTAL_H < BOTTOM_MARGIN + 20) {
          startNewPage(sec.title);
          drawSectionTableHeader(sec);
        }

        const totY = curY - TOTAL_H;
        currentPageStream += `0.93 0.95 0.97 rg ${MARGIN_X} ${totY} ${USABLE_WIDTH} ${TOTAL_H} re f\n`;
        currentPageStream += `0.2 0.2 0.2 RG 0.75 w ${MARGIN_X} ${curY} m ${MARGIN_X + USABLE_WIDTH} ${curY} l S\n`;
        currentPageStream += `0.2 0.2 0.2 RG 1 w ${MARGIN_X} ${totY} m ${MARGIN_X + USABLE_WIDTH} ${totY} l S\n`;

        let tX = MARGIN_X;
        let labelDrawn = false;

        sec.columns.forEach((col, cIdx) => {
          if (col.getRawSum) {
            const sumVal = sectionColSums[cIdx];
            const displaySum = col.isCurrencySum ? formatINR(sumVal) : formatQty(sumVal);
            const escSum = escapePdfText(displaySum);
            const estW = escSum.length * 4.4;
            currentPageStream += `BT /F2 8 Tf 0.1 0.1 0.1 rg ${tX + col.width - 5 - estW} ${totY + 7} Td (${escSum}) Tj ET\n`;
          } else if (!labelDrawn) {
            currentPageStream += `BT /F2 8.5 Tf 0.1 0.1 0.1 rg ${tX + 6} ${totY + 7} Td (Grand Total) Tj ET\n`;
            labelDrawn = true;
          }
          tX += col.width;
        });

        curY -= TOTAL_H + 10;
      }
    }
  }

  // Push final page
  if (currentPageStream) {
    pages.push({ stream: currentPageStream });
  }

  // Finalize Footers with Page X of Y on all pages
  const totalPagesCount = pages.length;
  for (let pIdx = 0; pIdx < totalPagesCount; pIdx++) {
    const footerY = BOTTOM_MARGIN - 15;
    let footerStream = `0.8 0.8 0.85 RG 0.5 w ${MARGIN_X} ${footerY + 12} m ${PAGE_WIDTH - MARGIN_X} ${footerY + 12} l S\n`;
    footerStream += `BT /F1 8 Tf 0.35 0.35 0.35 rg ${MARGIN_X} ${footerY} Td (Bansil Books Analytics | Zoho Books Read-Only | Local SQLite Cache) Tj ET\n`;
    const pageStr = `Page ${pIdx + 1} of ${totalPagesCount}`;
    footerStream += `BT /F1 8 Tf 0.35 0.35 0.35 rg ${PAGE_WIDTH - MARGIN_X - 70} ${footerY} Td (${escapePdfText(pageStr)}) Tj ET\n`;

    pages[pIdx].stream += footerStream;
  }

  // ---- Assemble Standard PDF 1.4 Binary ----
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}

/**
 * Public export functions for API routes & callers.
 * ALL PDF Generation routes strictly use the Section-Based Customer-Grouped Builder.
 */
export function buildMasterInventoryMismatchPdf(
  report: MasterInventoryMismatchReportResult,
  options?: ExportOptions
): Buffer {
  return generateSectionBasedPdf(report, options, "Master Inventory Mismatch");
}

export function buildPdfDocument(
  report: ReconciliationReportResult,
  options?: ExportOptions
): Buffer {
  return generateSectionBasedPdf(report, options, "Master Material Reconciliation");
}

export function buildGlobalBreakdownPdf(
  report: MasterInventoryMismatchReportResult,
  options?: ExportOptions
): Buffer {
  return generateSectionBasedPdf(report, options, "Master Inventory Breakdown");
}

export function buildPriceReferencePdf(
  result: {
    stats: any;
    history: any[];
    appliedFilter: any;
  },
  _options?: ExportOptions
): Buffer {
  const pages: PdfPage[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  function newPage() {
    if (currentStream) {
      pages.push({ stream: currentStream });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
  }

  // Draw Header
  function drawHeader() {
    currentStream += `0 0 0 rg\n`;
    currentStream += `BT /F2 13 Tf ${MARGIN_X} ${currentY} Td (${escapePdfText("BANSIL BOOKS ANALYTICS - ITEM PRICE REFERENCE")}) Tj ET\n`;
    currentY -= 15;
    const filterDesc = `Period: ${result.appliedFilter?.financialYear || "FY2026-27"} | Price Type: ${result.appliedFilter?.priceType || "Purchase + Sales"} | Local SQLite Cache`;
    currentStream += `0.3 0.3 0.3 rg\n`;
    currentStream += `BT /F1 8.5 Tf ${MARGIN_X} ${currentY} Td (${escapePdfText(filterDesc)}) Tj ET\n`;
    currentY -= 15;

    // Header dividing line
    currentStream += `0.8 0.8 0.8 RG 1 w\n${MARGIN_X} ${currentY} m ${PAGE_WIDTH - MARGIN_X} ${currentY} l S\n`;
    currentY -= 12;
  }

  drawHeader();

  // Summary Table
  const stats = result.stats || {};
  currentStream += `0.95 0.95 0.98 rg ${MARGIN_X} ${currentY - 58} ${USABLE_WIDTH} 58 re f\n`;
  currentStream += `0.8 0.8 0.85 RG 1 w ${MARGIN_X} ${currentY - 58} ${USABLE_WIDTH} 58 re S\n`;

  currentStream += `0 0 0 rg\n`;
  currentStream += `BT /F2 8.5 Tf ${MARGIN_X + 10} ${currentY - 13} Td (PURCHASE PRICE REFERENCE:) Tj ET\n`;
  const pSummary = `Latest: ${formatINR(stats.latest_purchase?.effective_rate)} | Lowest: ${formatINR(stats.lowest_purchase?.effective_rate)} | Highest: ${formatINR(stats.highest_purchase?.effective_rate)} | Weighted Avg: ${formatINR(stats.weighted_avg_purchase)} (${stats.purchase_transactions_count || 0} lines, Qty: ${formatQty(stats.purchase_total_qty)})`;
  currentStream += `BT /F1 8 Tf ${MARGIN_X + 10} ${currentY - 24} Td (${escapePdfText(pSummary)}) Tj ET\n`;

  currentStream += `BT /F2 8.5 Tf ${MARGIN_X + 10} ${currentY - 38} Td (SALES PRICE REFERENCE:) Tj ET\n`;
  const sSummary = `Latest: ${formatINR(stats.latest_sales?.effective_rate)} | Lowest: ${formatINR(stats.lowest_sales?.effective_rate)} | Highest: ${formatINR(stats.highest_sales?.effective_rate)} | Weighted Avg: ${formatINR(stats.weighted_avg_sales)} (${stats.sales_transactions_count || 0} lines, Qty: ${formatQty(stats.sales_total_qty)})`;
  currentStream += `BT /F1 8 Tf ${MARGIN_X + 10} ${currentY - 49} Td (${escapePdfText(sSummary)}) Tj ET\n`;

  currentY -= 70;

  // History Table Headers
  const colWidths = [28, 56, 52, 70, 110, 110, 100, 48, 60, 65, 70];
  const headers = ["#", "Date", "Type", "Doc No", "Item Name", "Description", "Party", "Qty", "Src Rate", "Eff Rate", "Taxable"];

  function drawTableHeaders() {
    currentStream += `0.06 0.09 0.16 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 16 re f\n`;
    currentStream += `1 1 1 rg\n`;
    let curX = MARGIN_X + 4;
    headers.forEach((h, idx) => {
      currentStream += `BT /F2 7.5 Tf ${curX} ${currentY - 10} Td (${escapePdfText(h)}) Tj ET\n`;
      curX += colWidths[idx];
    });
    currentY -= 16;
  }

  drawTableHeaders();

  // History Rows
  const history = result.history || [];
  history.forEach((row, i) => {
    if (currentY < BOTTOM_MARGIN + 25) {
      newPage();
      drawHeader();
      drawTableHeaders();
    }

    const isEven = i % 2 === 0;
    if (isEven) {
      currentStream += `0.98 0.98 0.98 rg ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 13 re f\n`;
    }

    currentStream += `0.1 0.1 0.1 rg\n`;
    let curX = MARGIN_X + 4;
    const isP = row.document_type === "PURCHASE";
    const party = isP ? (row.vendor_name || "-") : (row.customer_name || "-");

    const rowVals = [
      String(i + 1),
      formatPdfDate(row.date),
      row.document_type,
      row.document_number,
      row.item_name.length > 20 ? row.item_name.slice(0, 19) + "..." : row.item_name,
      row.description ? (row.description.length > 18 ? row.description.slice(0, 17) + "..." : row.description) : "-",
      party.length > 18 ? party.slice(0, 17) + "..." : party,
      formatQty(row.quantity),
      formatINR(row.source_rate),
      formatINR(row.effective_rate),
      formatINR(row.taxable_amount),
    ];

    rowVals.forEach((val, cIdx) => {
      currentStream += `BT /F1 7.2 Tf ${curX} ${currentY - 9} Td (${escapePdfText(val)}) Tj ET\n`;
      curX += colWidths[cIdx];
    });

    currentY -= 13;
  });

  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Footer on each page
  const totalPages = pages.length;
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const footerY = BOTTOM_MARGIN - 15;
    let fStr = `0.8 0.8 0.8 RG 0.5 w ${MARGIN_X} ${footerY + 12} m ${PAGE_WIDTH - MARGIN_X} ${footerY + 12} l S\n`;
    fStr += `0.4 0.4 0.4 rg\n`;
    fStr += `BT /F1 7.5 Tf ${MARGIN_X} ${footerY} Td (${escapePdfText("Bansil Books Analytics | Strictly Local SQLite | Read-Only")}) Tj ET\n`;
    const pInfo = `Page ${pIdx + 1} of ${totalPages}`;
    fStr += `BT /F1 7.5 Tf ${PAGE_WIDTH - MARGIN_X - 60} ${footerY} Td (${escapePdfText(pInfo)}) Tj ET\n`;
    pages[pIdx].stream += fStr;
  }

  // Assemble PDF Binary
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}

/**
 * Builds a Landscape A4 PDF report for Customer 360 / Customer Details.
 */
export function buildCustomerDetailsPdf(
  data: any,
  _options?: ExportOptions
): Buffer {
  const pages: PdfPage[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  function newPage() {
    if (currentStream) {
      pages.push({ stream: currentStream });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
  }

  const cust = data.customer || {};
  const kpis = data.kpis || {};
  const period = data.period || {};
  const itemAnalysis = data.itemAnalysis || [];
  const salesInvoices = data.salesInvoices || [];
  const purchaseBills = data.purchaseBills || [];
  const recon = data.reconciliation || {};

  function drawHeader() {
    currentStream += `0 0 0 rg\n`;
    currentStream += `BT /F2 13 Tf ${MARGIN_X} ${currentY} Td (${escapePdfText("BANSIL BOOKS ANALYTICS - CUSTOMER 360 REPORT")}) Tj ET\n`;
    currentY -= 15;
    const filterDesc = `Customer: ${cust.name || "—"} (${cust.id || "—"}) | Period: ${period.financialYear || "FY2026-27"} | Source: Local SQLite Cache`;
    currentStream += `0.3 0.3 0.3 rg\n`;
    currentStream += `BT /F1 8.5 Tf ${MARGIN_X} ${currentY} Td (${escapePdfText(filterDesc)}) Tj ET\n`;
    currentY -= 15;

    // Header dividing line
    currentStream += `0.8 0.8 0.8 RG 1 w\n${MARGIN_X} ${currentY} m ${PAGE_WIDTH - MARGIN_X} ${currentY} l S\n`;
    currentY -= 12;
  }

  drawHeader();

  // 1. KPI Summary Box
  currentStream += `0.95 0.98 0.98 rg ${MARGIN_X} ${currentY - 60} ${USABLE_WIDTH} 60 re f\n`;
  currentStream += `0.8 0.85 0.85 RG 1 w ${MARGIN_X} ${currentY - 60} ${USABLE_WIDTH} 60 re S\n`;

  currentStream += `0 0 0 rg\n`;
  currentStream += `BT /F2 8.5 Tf ${MARGIN_X + 10} ${currentY - 14} Td (FINANCIAL KPIS (PRE-GST):) Tj ET\n`;
  const kpiLine1 = `Sales Taxable: ${formatINR(kpis.salesTaxableValue)} | Purchase Taxable: ${formatINR(kpis.purchaseTaxableValue)} | Commercial Spread: ${formatINR(kpis.commercialValueSpread)} (Reference Only)`;
  currentStream += `BT /F1 8 Tf ${MARGIN_X + 10} ${currentY - 26} Td (${escapePdfText(kpiLine1)}) Tj ET\n`;

  currentStream += `BT /F2 8.5 Tf ${MARGIN_X + 10} ${currentY - 40} Td (OPERATIONAL & BALANCE SUMMARY:) Tj ET\n`;
  const kpiLine2 = `Sales Invoices: ${kpis.salesInvoiceCount || 0} (${formatQty(kpis.salesQty)} Qty) | Purchase Bills: ${kpis.purchaseBillCount || 0} (${formatQty(kpis.purchaseQty)} Qty) | Receivable: ${formatINR(kpis.salesBalanceReceivable)} | Payable: ${formatINR(kpis.purchaseBalancePayable)}`;
  currentStream += `BT /F1 8 Tf ${MARGIN_X + 10} ${currentY - 52} Td (${escapePdfText(kpiLine2)}) Tj ET\n`;

  currentY -= 74;

  // 2. Section: Item Analysis Table
  currentStream += `0 0 0 rg\n`;
  currentStream += `BT /F2 10 Tf ${MARGIN_X} ${currentY} Td (ITEM-WISE ANALYSIS & RECONCILIATION) Tj ET\n`;
  currentY -= 14;

  const colWidths = [24, 180, 75, 48, 64, 60, 48, 64, 60, 48, 55, 55];
  const headers = ["#", "Item Name", "SKU", "P.Qty", "P.Taxable", "P.Avg", "S.Qty", "S.Taxable", "S.Avg", "Bal", "Shortage", "Recon"];

  function drawItemHeaders() {
    currentStream += `0.06 0.09 0.16 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 16 re f\n`;
    currentStream += `1 1 1 rg\n`;
    let curX = MARGIN_X + 4;
    for (let h = 0; h < headers.length; h++) {
      currentStream += `BT /F2 7.5 Tf ${curX} ${currentY - 10} Td (${escapePdfText(headers[h])}) Tj ET\n`;
      curX += colWidths[h];
    }
    currentY -= 16;
  }

  drawItemHeaders();

  itemAnalysis.forEach((it: any, idx: number) => {
    if (currentY < BOTTOM_MARGIN + 20) {
      newPage();
      drawHeader();
      drawItemHeaders();
    }

    const rowBg = idx % 2 === 0 ? "1 1 1" : "0.98 0.98 0.99";
    currentStream += `${rowBg} rg ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 12 re f\n`;
    currentStream += `0.9 0.9 0.9 RG 0.5 w ${MARGIN_X} ${currentY - 12} m ${PAGE_WIDTH - MARGIN_X} ${currentY - 12} l S\n`;

    const rowVals = [
      String(idx + 1),
      it.item_name || "—",
      it.sku || "—",
      formatQty(it.purchase_qty),
      formatINR(it.purchase_taxable),
      formatINR(it.purchase_avg_rate),
      formatQty(it.sales_qty),
      formatINR(it.sales_taxable),
      formatINR(it.sales_avg_rate),
      formatQty(it.balance_qty),
      formatQty(it.yet_to_purchase),
      formatQty(it.reconciled_qty),
    ];

    currentStream += `0 0 0 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < rowVals.length; c++) {
      const isBold = c === 1 || c === 9;
      const font = isBold ? "/F2" : "/F1";
      const maxLen = Math.max(3, Math.floor(colWidths[c] / 5.2));
      const rawVal = rowVals[c] || "";
      const valStr = rawVal.length > maxLen ? rawVal.slice(0, maxLen - 1) + "..." : rawVal;
      currentStream += `BT ${font} 7 Tf ${curX} ${currentY - 9} Td (${escapePdfText(valStr)}) Tj ET\n`;
      curX += colWidths[c];
    }

    currentY -= 12;
  });

  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Footer on each page
  const totalPages = pages.length;
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const footerY = BOTTOM_MARGIN - 15;
    let fStr = `0.8 0.8 0.8 RG 0.5 w ${MARGIN_X} ${footerY + 12} m ${PAGE_WIDTH - MARGIN_X} ${footerY + 12} l S\n`;
    fStr += `0.4 0.4 0.4 rg\n`;
    fStr += `BT /F1 7.5 Tf ${MARGIN_X} ${footerY} Td (${escapePdfText("Bansil Books Analytics | Strictly Local SQLite | Read-Only")}) Tj ET\n`;
    const pInfo = `Page ${pIdx + 1} of ${totalPages}`;
    fStr += `BT /F1 7.5 Tf ${PAGE_WIDTH - MARGIN_X - 60} ${footerY} Td (${escapePdfText(pInfo)}) Tj ET\n`;
    pages[pIdx].stream += fStr;
  }

  // Assemble PDF Binary
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}

/**
 * Builds PDF Document for Customers > Action Taken (Mismatch Action Tracker).
 * Features:
 * - A4 Landscape layout
 * - Top KPI Summary Header
 * - Customer Action Tracker Table (Customer Name, Status, Priority, Total, Reconciled, Mismatch, Shortage Qty, Surplus Qty, Shortage Val, Surplus Val, Action Status, Owner, Follow-up Date)
 * - Mismatch Items sub-tables per Customer with line-by-line metrics
 */
export function buildActionTakenPdf(
  data: {
    kpis: any;
    customers: any[];
    financialYear?: string;
    period?: string;
    statusFilter?: string;
  },
  options: ExportOptions = {}
): Buffer {
  const pages: PdfPage[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  const customers = data.customers || [];
  const kpis = data.kpis || {};
  const periodLabel = data.period || data.financialYear || "FY2026-27";

  const startNewPage = () => {
    if (currentStream) {
      pages.push({ stream: currentStream });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
  };

  const drawHeader = (pageNumber: number) => {
    currentStream += `0.06 0.09 0.16 rg\n`;
    currentStream += `BT /F2 14 Tf ${MARGIN_X} ${currentY - 14} Td (${escapePdfText("BANSIL BOOKS ANALYTICS - CUSTOMER ACTION TRACKER")}) Tj ET\n`;
    currentStream += `0.3 0.3 0.3 rg\n`;
    currentStream += `BT /F1 8.5 Tf ${PAGE_WIDTH - MARGIN_X - 180} ${currentY - 14} Td (${escapePdfText(`Period: ${periodLabel} | ${data.statusFilter || "Mismatch Only"}`)}) Tj ET\n`;
    currentY -= 22;

    // KPI Summary Bar on first page
    if (pageNumber === 1 && kpis) {
      currentStream += `0.95 0.96 0.98 rg ${MARGIN_X} ${currentY - 24} ${USABLE_WIDTH} 24 re f\n`;
      currentStream += `0.8 0.85 0.9 RG 0.5 w ${MARGIN_X} ${currentY - 24} ${USABLE_WIDTH} 24 re S\n`;
      currentStream += `0.06 0.09 0.16 rg\n`;

      const kpiText1 = `Action Req: ${kpis.customers_requiring_action || 0} Cust | Mismatches: ${kpis.total_mismatch_items || 0} Items`;
      const kpiText2 = `Shortage: ${formatQty(kpis.total_shortage_qty)} Qty (${formatINR(kpis.approx_shortage_value)})`;
      const kpiText3 = `Surplus: ${formatQty(kpis.total_surplus_qty)} Qty (${formatINR(kpis.approx_surplus_value)})`;

      currentStream += `BT /F2 8 Tf ${MARGIN_X + 10} ${currentY - 16} Td (${escapePdfText(kpiText1)}) Tj ET\n`;
      currentStream += `BT /F2 8 Tf ${MARGIN_X + 280} ${currentY - 16} Td (${escapePdfText(kpiText2)}) Tj ET\n`;
      currentStream += `BT /F2 8 Tf ${MARGIN_X + 540} ${currentY - 16} Td (${escapePdfText(kpiText3)}) Tj ET\n`;
      currentY -= 32;
    }
  };

  startNewPage();
  drawHeader(1);

  // Table Columns Definition
  const colHeaders = [
    "#",
    "Customer Name",
    "Status",
    "Priority",
    "Total",
    "Recon",
    "Mismatch",
    "Shortage Qty",
    "Surplus Qty",
    "Shortage Val (Rs.)",
    "Surplus Val (Rs.)",
    "Action Status",
    "Owner",
    "Follow-up",
  ];
  // USABLE_WIDTH is ~769.89
  const colWidths = [20, 140, 65, 45, 30, 30, 42, 52, 50, 75, 75, 65, 60, 60];

  const drawTableHeader = () => {
    currentStream += `0.09 0.46 0.43 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re f\n`;
    currentStream += `1 1 1 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < colHeaders.length; c++) {
      currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${escapePdfText(colHeaders[c])}) Tj ET\n`;
      curX += colWidths[c];
    }
    currentY -= 16;
  };

  drawTableHeader();

  customers.forEach((cust, idx) => {
    if (currentY < BOTTOM_MARGIN + 30) {
      startNewPage();
      drawHeader(pages.length + 1);
      drawTableHeader();
    }

    const isEven = idx % 2 === 0;
    if (isEven) {
      currentStream += `0.97 0.98 0.99 rg ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 12 re f\n`;
    }

    const rowVals = [
      String(idx + 1),
      cust.customer_name || "—",
      cust.customer_status || "—",
      cust.priority || "MEDIUM",
      String(cust.total_items || 0),
      String(cust.reconciled_items || 0),
      String(cust.mismatch_items || 0),
      formatQty(cust.total_yet_to_purchase_qty),
      formatQty(cust.total_yet_to_sale_qty),
      formatINR(cust.approx_shortage_value),
      formatINR(cust.approx_surplus_value),
      cust.action_status || "Open",
      cust.action_owner || "—",
      cust.next_follow_up_date || "—",
    ];

    currentStream += `0 0 0 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < rowVals.length; c++) {
      const isBold = c === 1 || c === 2 || c === 6;
      const font = isBold ? "/F2" : "/F1";
      const maxLen = Math.max(3, Math.floor(colWidths[c] / 4.8));
      const rawVal = rowVals[c] || "";
      const valStr = rawVal.length > maxLen ? rawVal.slice(0, maxLen - 1) + "..." : rawVal;
      currentStream += `BT ${font} 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText(valStr)}) Tj ET\n`;
      curX += colWidths[c];
    }
    currentY -= 13;
  });

  // Grand Total Summary Row (PDF)
  if (currentY < BOTTOM_MARGIN + 30) {
    startNewPage();
    drawHeader(pages.length + 1);
    drawTableHeader();
  }

  const totCustomerCount = customers.length;
  const totItems = customers.reduce((sum, c) => sum + Number(c.total_items || 0), 0);
  const totReconciled = customers.reduce((sum, c) => sum + Number(c.reconciled_items || 0), 0);
  const totMismatch = customers.reduce((sum, c) => sum + Number(c.mismatch_items || 0), 0);
  const totShortageQty = customers.reduce((sum, c) => sum + Number(c.total_yet_to_purchase_qty || 0), 0);
  const totSurplusQty = customers.reduce((sum, c) => sum + Number(c.total_yet_to_sale_qty || 0), 0);
  const totShortageVal = customers.reduce((sum, c) => sum + Number(c.approx_shortage_value || 0), 0);
  const totSurplusVal = customers.reduce((sum, c) => sum + Number(c.approx_surplus_value || 0), 0);

  // Background and border for Grand Total row
  currentStream += `0.92 0.94 0.97 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re f\n`;
  currentStream += `0.6 0.65 0.7 RG 1 w ${MARGIN_X} ${currentY} m ${MARGIN_X + USABLE_WIDTH} ${currentY} l S\n`;
  currentStream += `0.6 0.65 0.7 RG 1 w ${MARGIN_X} ${currentY - 14} m ${MARGIN_X + USABLE_WIDTH} ${currentY - 14} l S\n`;

  const totalRowVals = [
    "TOTAL",
    `GRAND TOTAL (${totCustomerCount})`,
    "—",
    "—",
    String(totItems),
    String(totReconciled),
    String(totMismatch),
    formatQty(totShortageQty),
    formatQty(totSurplusQty),
    formatINR(totShortageVal),
    formatINR(totSurplusVal),
    "—",
    "—",
    "—",
  ];

  currentStream += `0.06 0.09 0.16 rg\n`;
  let curTotalX = MARGIN_X + 4;
  for (let c = 0; c < totalRowVals.length; c++) {
    const rawVal = totalRowVals[c] || "";
    const maxLen = Math.max(3, Math.floor(colWidths[c] / 4.8));
    const valStr = rawVal.length > maxLen ? rawVal.slice(0, maxLen - 1) + "..." : rawVal;
    currentStream += `BT /F2 6.5 Tf ${curTotalX} ${currentY - 10} Td (${escapePdfText(valStr)}) Tj ET\n`;
    curTotalX += colWidths[c];
  }
  currentY -= 18;

  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Footer on each page
  const totalPages = pages.length;
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const footerY = BOTTOM_MARGIN - 15;
    let fStr = `0.8 0.8 0.8 RG 0.5 w ${MARGIN_X} ${footerY + 12} m ${PAGE_WIDTH - MARGIN_X} ${footerY + 12} l S\n`;
    fStr += `0.4 0.4 0.4 rg\n`;
    fStr += `BT /F1 7.5 Tf ${MARGIN_X} ${footerY} Td (${escapePdfText("Bansil Books Analytics | Customers > Action Taken | 100% Local SQLite")}) Tj ET\n`;
    const pInfo = `Page ${pIdx + 1} of ${totalPages}`;
    fStr += `BT /F1 7.5 Tf ${PAGE_WIDTH - MARGIN_X - 60} ${footerY} Td (${escapePdfText(pInfo)}) Tj ET\n`;
    pages[pIdx].stream += fStr;
  }

  // Assemble PDF Binary
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}

/**
 * Builds a clean, professional A4 Landscape PDF for Composite Assemblies.
 */
export function buildCompositeAssemblyPdf(
  assemblies: any[],
  summary: any,
  periodLabel: string
): Buffer {
  const pages: PdfPage[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  const escapePdfText = (str: string): string => {
    return sanitizePdfText(str)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  };

  const formatINR = (val: number | undefined | null): string => {
    if (val === undefined || val === null || isNaN(val)) return "Rs. 0.00";
    return `Rs. ${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatQty = (val: number | undefined | null): string => {
    if (val === undefined || val === null || isNaN(val)) return "0";
    return Number(val).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  const renderHeader = (isFirstPage: boolean) => {
    let s = "";
    // Header background banner
    s += `0.008 0.518 0.780 rg\n`;
    s += `${MARGIN_X} ${PAGE_HEIGHT - TOP_MARGIN - 28} ${USABLE_WIDTH} 28 re f\n`;

    // Title text
    s += `1 1 1 rg\n`;
    s += `BT /F2 13 Tf ${MARGIN_X + 8} ${PAGE_HEIGHT - TOP_MARGIN - 18} Td (${escapePdfText("BANSIL BOOKS ANALYTICS — COMPOSITE ASSEMBLY REGISTER")}) Tj ET\n`;

    // Subtitle & period
    s += `0.9 0.9 0.9 rg\n`;
    s += `BT /F1 8 Tf ${PAGE_WIDTH - MARGIN_X - 220} ${PAGE_HEIGHT - TOP_MARGIN - 18} Td (${escapePdfText(`Period: ${periodLabel} | Local SQLite`)}) Tj ET\n`;

    currentY = PAGE_HEIGHT - TOP_MARGIN - 36;

    if (isFirstPage) {
      // KPI summary boxes
      const boxW = (USABLE_WIDTH - 24) / 4;
      const boxH = 28;
      const kpiY = currentY - boxH;

      const kpis = [
        { label: "Total Assemblies", val: `${summary?.totalAssemblies || 0} (${summary?.confirmedAssemblies || 0} Confirmed)` },
        { label: "Draft / Cancelled", val: `${summary?.draftAssemblies || 0} Draft / ${summary?.cancelledAssemblies || 0} Cancelled` },
        { label: "Generated Units", val: `${formatQty(summary?.totalGeneratedUnits)} BUN` },
        { label: "Total Material Value", val: formatINR(summary?.totalMaterialCost) },
      ];

      for (let i = 0; i < 4; i++) {
        const bx = MARGIN_X + i * (boxW + 8);
        s += `0.96 0.97 0.98 rg\n`;
        s += `${bx} ${kpiY} ${boxW} ${boxH} re f\n`;
        s += `0.85 0.88 0.90 RG 0.5 w ${bx} ${kpiY} ${boxW} ${boxH} re S\n`;

        s += `0.4 0.45 0.5 rg\n`;
        s += `BT /F1 6.5 Tf ${bx + 6} ${kpiY + 17} Td (${escapePdfText(kpis[i].label)}) Tj ET\n`;
        s += `0.1 0.15 0.2 rg\n`;
        s += `BT /F2 9 Tf ${bx + 6} ${kpiY + 6} Td (${escapePdfText(kpis[i].val)}) Tj ET\n`;
      }

      currentY = kpiY - 14;
    }

    // Table Header
    const colWidths = [70, 55, 130, 140, 55, 75, 75, 65, 104];
    const colHeaders = [
      "Assembly #",
      "Date",
      "Customer Name",
      "Finished Item",
      "Gen Qty",
      "Material Cost",
      "Cost / Unit",
      "Status",
      "Components Consumed",
    ];

    s += `0.92 0.94 0.96 rg\n`;
    s += `${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re f\n`;
    s += `0.80 0.82 0.85 RG 0.5 w ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re S\n`;

    s += `0.2 0.25 0.3 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < colHeaders.length; c++) {
      s += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${escapePdfText(colHeaders[c])}) Tj ET\n`;
      curX += colWidths[c];
    }

    currentY -= 16;
    return s;
  };

  currentStream = renderHeader(true);

  const colWidths = [70, 55, 130, 140, 55, 75, 75, 65, 104];

  assemblies.forEach((asm, idx) => {
    // Check page overflow
    if (currentY < BOTTOM_MARGIN + 30) {
      pages.push({ stream: currentStream });
      currentStream = renderHeader(false);
    }

    const isEven = idx % 2 === 0;
    if (isEven) {
      currentStream += `0.98 0.99 1.00 rg\n`;
      currentStream += `${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 12 re f\n`;
    }

    const compSummary = (asm.components || [])
      .map((c: any) => `${c.component_item_name} (${c.consumed_qty})`)
      .join(", ");

    const rowVals = [
      asm.assembly_number || "",
      asm.assembly_date || "",
      asm.customer_name || "",
      asm.composite_item_name || "",
      `${formatQty(asm.generated_qty)} ${asm.unit || "BUN"}`,
      formatINR(asm.total_material_cost),
      formatINR(asm.cost_per_unit),
      asm.status || "",
      compSummary || "—",
    ];

    currentStream += `0 0 0 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < rowVals.length; c++) {
      const isBold = c === 0 || c === 5 || c === 7;
      const font = isBold ? "/F2" : "/F1";
      const maxLen = Math.max(3, Math.floor(colWidths[c] / 4.8));
      const rawVal = rowVals[c] || "";
      const valStr = rawVal.length > maxLen ? rawVal.slice(0, maxLen - 1) + "..." : rawVal;
      currentStream += `BT ${font} 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText(valStr)}) Tj ET\n`;
      curX += colWidths[c];
    }
    currentY -= 13;
  });

  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Footer on each page
  const totalPages = pages.length;
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const footerY = BOTTOM_MARGIN - 15;
    let fStr = `0.8 0.8 0.8 RG 0.5 w ${MARGIN_X} ${footerY + 12} m ${PAGE_WIDTH - MARGIN_X} ${footerY + 12} l S\n`;
    fStr += `0.4 0.4 0.4 rg\n`;
    fStr += `BT /F1 7.5 Tf ${MARGIN_X} ${footerY} Td (${escapePdfText("Bansil Books Analytics | Reconciliation > Composite Assembly | 100% Local SQLite")}) Tj ET\n`;
    const pInfo = `Page ${pIdx + 1} of ${totalPages}`;
    fStr += `BT /F1 7.5 Tf ${PAGE_WIDTH - MARGIN_X - 60} ${footerY} Td (${escapePdfText(pInfo)}) Tj ET\n`;
    pages[pIdx].stream += fStr;
  }

  // Assemble PDF Binary
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}

/**
 * Builds PDF for Action Taken > Customer Details Missing view.
 */
export function buildCustomerDetailsMissingPdf(
  data: {
    kpis: any;
    items: any[];
    financialYear?: string;
    period?: string;
    reconStatusFilter?: string;
    search?: string;
  },
  options: ExportOptions = {}
): Buffer {
  const pages: PdfPage[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  const items = data.items || [];
  const kpis = data.kpis || {};
  const periodLabel = data.period || data.financialYear || "FY2026-27";

  const startNewPage = () => {
    if (currentStream) {
      pages.push({ stream: currentStream });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
  };

  const drawHeader = (pageNumber: number) => {
    currentStream += `0.06 0.09 0.16 rg\n`;
    currentStream += `BT /F2 14 Tf ${MARGIN_X} ${currentY - 14} Td (${escapePdfText("BANSIL BOOKS ANALYTICS - CUSTOMER DETAILS MISSING")}) Tj ET\n`;
    currentStream += `0.3 0.3 0.3 rg\n`;
    currentStream += `BT /F1 8.5 Tf ${PAGE_WIDTH - MARGIN_X - 220} ${currentY - 14} Td (${escapePdfText(`Period: ${periodLabel} | Unmapped Purchase Lines`)}) Tj ET\n`;
    currentY -= 22;

    // KPI Summary Bar on first page
    if (pageNumber === 1 && kpis) {
      currentStream += `0.95 0.96 0.98 rg ${MARGIN_X} ${currentY - 24} ${USABLE_WIDTH} 24 re f\n`;
      currentStream += `0.8 0.85 0.9 RG 0.5 w ${MARGIN_X} ${currentY - 24} ${USABLE_WIDTH} 24 re S\n`;
      currentStream += `0.06 0.09 0.16 rg\n`;

      const kpiText1 = `Missing Lines: ${kpis.missing_lines || items.length} | Affected Bills: ${kpis.affected_bills || 0} | Affected Items: ${kpis.affected_items || 0}`;
      const kpiText2 = `Unmapped Purchase Qty: ${formatQty(kpis.purchase_qty_unmapped || 0)}`;
      const kpiText3 = `Unmapped Taxable: Rs. ${formatINR(kpis.taxable_value_unmapped || 0)}`;

      currentStream += `BT /F2 8 Tf ${MARGIN_X + 10} ${currentY - 16} Td (${escapePdfText(kpiText1)}) Tj ET\n`;
      currentStream += `BT /F2 8 Tf ${MARGIN_X + 340} ${currentY - 16} Td (${escapePdfText(kpiText2)}) Tj ET\n`;
      currentStream += `BT /F2 8 Tf ${MARGIN_X + 540} ${currentY - 16} Td (${escapePdfText(kpiText3)}) Tj ET\n`;
      currentY -= 32;
    }
  };

  startNewPage();
  drawHeader(1);

  // Table Columns Definition
  const colHeaders = [
    "#",
    "Bill Date",
    "Bill No.",
    "Vendor",
    "Item",
    "SKU",
    "Qty",
    "Rate (Rs)",
    "Taxable (Rs)",
    "Customer",
    "Status",
    "Action Status",
    "Owner",
  ];
  // USABLE_WIDTH is ~769.89
  const colWidths = [20, 55, 70, 110, 130, 60, 40, 50, 65, 55, 60, 54];

  const drawTableHeader = () => {
    currentStream += `0.09 0.46 0.43 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re f\n`;
    currentStream += `1 1 1 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < colHeaders.length; c++) {
      currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${escapePdfText(colHeaders[c])}) Tj ET\n`;
      curX += colWidths[c];
    }
    currentY -= 16;
  };

  drawTableHeader();

  items.forEach((it, idx) => {
    if (currentY < BOTTOM_MARGIN + 30) {
      startNewPage();
      drawHeader(pages.length + 1);
      drawTableHeader();
    }

    if (idx % 2 === 1) {
      currentStream += `0.97 0.98 0.99 rg ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 12 re f\n`;
    }

    currentStream += `0.15 0.2 0.25 rg\n`;
    let curX = MARGIN_X + 4;

    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${idx + 1}) Tj ET\n`;
    curX += colWidths[0];

    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText(it.bill_date || "")}) Tj ET\n`;
    curX += colWidths[1];

    currentStream += `BT /F2 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText(it.bill_number || "")}) Tj ET\n`;
    curX += colWidths[2];

    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText((it.vendor_name || "").substring(0, 22))}) Tj ET\n`;
    curX += colWidths[3];

    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText((it.item_name || "").substring(0, 26))}) Tj ET\n`;
    curX += colWidths[4];

    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText((it.sku || "—").substring(0, 12))}) Tj ET\n`;
    curX += colWidths[5];

    currentStream += `BT /F2 6.5 Tf ${curX} ${currentY - 9} Td (${formatQty(it.quantity)}) Tj ET\n`;
    curX += colWidths[6];

    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${formatINR(it.rate)}) Tj ET\n`;
    curX += colWidths[7];

    currentStream += `BT /F2 6.5 Tf ${curX} ${currentY - 9} Td (${formatINR(it.line_total)}) Tj ET\n`;
    curX += colWidths[8];

    currentStream += `1 0.3 0 rg\n`;
    currentStream += `BT /F2 6 Tf ${curX} ${currentY - 9} Td (${escapePdfText(it.customer_details || "MISSING")}) Tj ET\n`;
    curX += colWidths[9];

    currentStream += `0.8 0.2 0.2 rg\n`;
    currentStream += `BT /F2 6 Tf ${curX} ${currentY - 9} Td (ACTION REQ) Tj ET\n`;
    curX += colWidths[10];

    currentStream += `0.3 0.3 0.3 rg\n`;
    currentStream += `BT /F1 6.5 Tf ${curX} ${currentY - 9} Td (${escapePdfText(it.action_status || "Open")}) Tj ET\n`;

    currentY -= 13;
  });

  // Grand Total Footer in PDF
  if (currentY < BOTTOM_MARGIN + 30) {
    startNewPage();
    drawHeader(pages.length + 1);
  }

  const totQty = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
  const totTaxable = items.reduce((sum, it) => sum + Number(it.line_total || 0), 0);

  currentStream += `0.92 0.94 0.96 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re f\n`;
  currentStream += `0.06 0.09 0.16 rg\n`;

  let curX = MARGIN_X + 4;
  currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (GRAND TOTAL) Tj ET\n`;
  curX += colWidths[0] + colWidths[1];

  currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${kpis.affected_bills ?? new Set(items.map(i => i.bill_id)).size} Bills) Tj ET\n`;
  curX += colWidths[2] + colWidths[3];

  currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${kpis.affected_items ?? new Set(items.map(i => i.item_id)).size} Items) Tj ET\n`;
  curX += colWidths[4] + colWidths[5];

  currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${formatQty(totQty)}) Tj ET\n`;
  curX += colWidths[6] + colWidths[7];

  currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (Rs. ${formatINR(totTaxable)}) Tj ET\n`;

  currentY -= 20;

  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Assemble PDF structure
  const objects: string[] = [];
  let nextId = 1;

  objects[nextId++] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[nextId++] = `2 0 obj\n<< /Producer (Bansil Books Analytics PDF Engine) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>\nendobj\n`;
  nextId++; // pages object id is 3
  objects[nextId++] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  objects[nextId++] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;

  const pageObjIds: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}




export function buildCashBooksPdf(data: any): Buffer {
  const pages: PdfPage[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  const startNewPage = () => {
    if (currentStream) {
      pages.push({ stream: currentStream });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
  };

  const getAY = (fyStr: string) => {
    if (!fyStr) return "";
    const start = parseInt(fyStr.substring(0, 4), 10);
    return `AY${start + 1}-${(start + 2).toString().slice(-2)}`;
  };

  const drawHeader = (pageNumber: number) => {
    currentStream += `0.06 0.09 0.16 rg\n`;
    currentStream += `BT /F2 14 Tf ${MARGIN_X} ${currentY - 14} Td (${escapePdfText("BANSIL ENGINEERS - CASH & CASH BOOKS VERIFICATION")}) Tj ET\n`;
    currentStream += `0.3 0.3 0.3 rg\n`;
    currentStream += `BT /F1 8.5 Tf ${PAGE_WIDTH - MARGIN_X - 250} ${currentY - 14} Td (${escapePdfText(`FY: ${data.financialYear || ""} | AY: ${getAY(data.financialYear || "")} | Entity: Proprietorship`)}) Tj ET\n`;
    currentY -= 22;

    if (pageNumber === 1) {
      currentStream += `0.95 0.96 0.98 rg ${MARGIN_X} ${currentY - 24} ${USABLE_WIDTH} 24 re f\n`;
      currentStream += `0.8 0.85 0.9 RG 0.5 w ${MARGIN_X} ${currentY - 24} ${USABLE_WIDTH} 24 re S\n`;
      currentStream += `0.06 0.09 0.16 rg\n`;

      const kpiText1 = `Net Cash in Hand: ${formatINR(data.summary?.netCash || 0)} | Cash Accounts: ${data.accounts?.length || 0} | Neg. Closing Accs: ${data.summary?.negativeAccounts || 0}`;
      const kpiText2 = `Closing Exposure: ${formatINR(data.summary?.negativeExposure || 0)} | Accounts Neg. During FY: ${data.summary?.accountsNegativeDuringFY || 0}`;
      const kpiText3 = `Neg. Txns: ${data.summary?.negativeTransactions || 0} | Neg. Balance Dates: ${data.summary?.negativeBalanceDates || 0} | Cont. Neg. Periods: ${data.summary?.continuousNegativePeriods || 0}`;
      
      currentStream += `BT /F2 8 Tf ${MARGIN_X + 10} ${currentY - 10} Td (${escapePdfText(kpiText1)}) Tj ET\n`;
      currentStream += `BT /F2 8 Tf ${MARGIN_X + 10} ${currentY - 20} Td (${escapePdfText(kpiText2)} | ${escapePdfText(kpiText3)}) Tj ET\n`;
      currentY -= 32;
      
      // Source provenance
      currentStream += `BT /F1 8 Tf ${MARGIN_X} ${currentY - 10} Td (${escapePdfText(`Source: locally persisted read-only Zoho Books evidence with independent cash-equation verification. Local Evidence Through: ${data.coverageThrough || "N/A"}`)}) Tj ET\n`;
      
      // Physical count
      const py = data.financialYear ? parseInt(data.financialYear.substring(0,4)) + 1 : 2026;
      currentStream += `BT /F2 8 Tf ${MARGIN_X} ${currentY - 20} Td (${escapePdfText(`Physical Count Certificate: EVIDENCE REQUIRED (As on 31/03/${py})`)}) Tj ET\n`;
      
      currentY -= 30;
    }
  };

  startNewPage();
  drawHeader(1);

  const colHeaders = ["Account Name", "Opening", "Receipts", "Payments", "Closing", "Status"];
  const colWidths = [150, 60, 60, 60, 60, 125];

  const drawTableHeader = () => {
    currentStream += `0.09 0.46 0.43 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 14 re f\n`;
    currentStream += `1 1 1 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < colHeaders.length; c++) {
      const isNum = c >= 1 && c <= 4;
      const escH = escapePdfText(colHeaders[c]);
      if (isNum) {
        const estW = escH.length * 4.4;
        currentStream += `BT /F2 7 Tf ${curX + colWidths[c] - 8 - estW} ${currentY - 10} Td (${escH}) Tj ET\n`;
      } else {
        currentStream += `BT /F2 7 Tf ${curX} ${currentY - 10} Td (${escH}) Tj ET\n`;
      }
      curX += colWidths[c];
    }
    currentY -= 16;
  };

  drawTableHeader();

  const accounts = data.accounts || [];
  accounts.forEach((acc: any, idx: number) => {
    if (currentY < BOTTOM_MARGIN + 30) {
      startNewPage();
      drawHeader(pages.length + 1);
      drawTableHeader();
    }

    const isEven = idx % 2 === 0;
    if (isEven) {
      currentStream += `0.97 0.98 0.99 rg ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 12 re f\n`;
    }

    let statusText = "OK — No Negative Balance Detected";
    if (acc.closing_balance < 0) {
      statusText = "REVIEW — Negative Closing Balance";
    } else if (acc.negative_cash_days?.length > 0 || acc.negative_periods > 0) {
      statusText = "REVIEW — Negative Balance During FY";
    }

    const rowVals = [
      acc.account_name,
      formatINR(acc.opening_balance),
      formatINR(acc.total_receipts),
      formatINR(acc.total_payments),
      formatINR(acc.closing_balance),
      statusText,
    ];

    currentStream += `0 0 0 rg\n`;
    let curX = MARGIN_X + 4;
    for (let c = 0; c < rowVals.length; c++) {
      const isNum = c >= 1 && c <= 4;
      const valStr = escapePdfText(rowVals[c]);
      if (isNum) {
        const estW = valStr.length * 3.8; // Approximate width for numbers
        currentStream += `BT /F1 7 Tf ${curX + colWidths[c] - 8 - estW} ${currentY - 9} Td (${valStr}) Tj ET\n`;
      } else {
        if (c === 5 && statusText.startsWith("REVIEW")) {
          currentStream += `0.7 0.1 0.1 rg\n`;
        }
        currentStream += `BT /F1 7 Tf ${curX} ${currentY - 9} Td (${valStr}) Tj ET\n`;
        if (c === 5) {
          currentStream += `0 0 0 rg\n`;
        }
      }
      curX += colWidths[c];
    }
    currentY -= 12;
  });

  // Add footers before saving
  const totalPages = pages.length || (currentStream ? 1 : 0);
  if (currentStream && totalPages === 0) {
     pages.push({ stream: currentStream });
     currentStream = "";
  } else if (currentStream) {
     pages.push({ stream: currentStream });
     currentStream = "";
  }
  
  for (let i = 0; i < pages.length; i++) {
    const pnum = i + 1;
    const fStr = `Page ${pnum} of ${pages.length}`;
    pages[i].stream += `0 0 0 rg\nBT /F1 8 Tf ${PAGE_WIDTH - MARGIN_X - 60} ${BOTTOM_MARGIN - 15} Td (${fStr}) Tj ET\n`;
    pages[i].stream += `0.5 0.5 0.5 rg\nBT /F1 7 Tf ${MARGIN_X} ${BOTTOM_MARGIN - 15} Td (Pre-Audit Working Paper) Tj ET\n`;
  }

  // Assemble PDF Binary
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const streamData = pages[i].stream;
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, "utf-8")} >>\nstream\n${streamData}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}
