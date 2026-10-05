// ============================================================
// Bansil Books Analytics — Pure Node OpenXML Excel (.xlsx) Builder
// Local Only · Read-Only · Professional Formatting with INR & AutoFilter
// ============================================================

import * as zlib from "zlib";
import type {
  ReconciliationReportResult,
  MasterInventoryMismatchReportResult,
  MasterInventoryMismatchItem,
  ItemTransactionBreakdown,
  ExportOptions,
  ExportFieldKey,
  ExportFieldDefinition,
} from "../../types/reconciliation.ts";
import {
  EXPORT_FIELD_DEFINITIONS,
} from "../../types/reconciliation.ts";
import { formatDisplayDate, formatDisplayDateTime } from "../date-utils.ts";


// CRC32 table for ZIP packaging
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  path: string;
  data: Buffer;
}

/**
 * Packs multiple entries into an uncompressed or deflate-compressed PKZip (.xlsx) buffer.
 */
function packZip(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const rawData = entry.data;
    const crc = calculateCrc32(rawData);
    // OpenXML works reliably with standard DEFLATE compression
    const compressed = zlib.deflateRawSync(rawData);
    const useDeflate = true;
    const compData = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;
    const pathBuf = Buffer.from(entry.path, "utf-8");

    // Local File Header
    const lfh = Buffer.alloc(30 + pathBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0); // Signature
    lfh.writeUInt16LE(20, 4); // Version needed
    lfh.writeUInt16LE(0, 6); // Flags
    lfh.writeUInt16LE(method, 8); // Compression method
    lfh.writeUInt16LE(0, 10); // Mod time
    lfh.writeUInt16LE(0x5200, 12); // Mod date
    lfh.writeUInt32LE(crc, 14); // CRC-32
    lfh.writeUInt32LE(compData.length, 18); // Compressed size
    lfh.writeUInt32LE(rawData.length, 22); // Uncompressed size
    lfh.writeUInt16LE(pathBuf.length, 26); // Path length
    lfh.writeUInt16LE(0, 28); // Extra field length
    pathBuf.copy(lfh, 30);

    localHeaders.push(lfh, compData);

    // Central Directory Record
    const cde = Buffer.alloc(46 + pathBuf.length);
    cde.writeUInt32LE(0x02014b50, 0); // Signature
    cde.writeUInt16LE(20, 4); // Version made by
    cde.writeUInt16LE(20, 6); // Version needed
    cde.writeUInt16LE(0, 8); // Flags
    cde.writeUInt16LE(method, 10); // Compression method
    cde.writeUInt16LE(0, 12); // Mod time
    cde.writeUInt16LE(0x5200, 14); // Mod date
    cde.writeUInt32LE(crc, 16); // CRC-32
    cde.writeUInt32LE(compData.length, 20); // Compressed size
    cde.writeUInt32LE(rawData.length, 24); // Uncompressed size
    cde.writeUInt16LE(pathBuf.length, 28); // Path length
    cde.writeUInt16LE(0, 30); // Extra field length
    cde.writeUInt16LE(0, 32); // File comment length
    cde.writeUInt16LE(0, 34); // Disk number start
    cde.writeUInt16LE(0, 36); // Internal file attributes
    cde.writeUInt32LE(0, 38); // External file attributes
    cde.writeUInt32LE(offset, 42); // Relative offset of local header
    pathBuf.copy(cde, 46);

    cdEntries.push(cde);
    offset += lfh.length + compData.length;
  }

  const cdStart = offset;
  const cdSize = cdEntries.reduce((sum, b) => sum + b.length, 0);

  // End of Central Directory Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk with central directory
  eocd.writeUInt16LE(entries.length, 8); // Total entries on disk
  eocd.writeUInt16LE(entries.length, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12); // Central directory size
  eocd.writeUInt32LE(cdStart, 16); // Central directory offset
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, ...cdEntries, eocd]);
}

function escapeXml(str: string | number | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colLetter(index: number): string {
  let letter = "";
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Builds styles.xml with Indian Currency (numFmtId 164), Quantities (numFmtId 165),
 * headers, borders, bold grand totals, and hyperlinks.
 */
function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="[$₹-en-IN]#,##,##0.00;([$₹-en-IN]#,##,##0.00);&quot;-&quot;"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
  </numFmts>
  <fonts count="4">
    <!-- 0: Normal regular font -->
    <font>
      <sz val="10"/>
      <color rgb="FF1F2937"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
    <!-- 1: Bold Header font -->
    <font>
      <b/>
      <sz val="10"/>
      <color rgb="FF111827"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
    <!-- 2: Bold Total font -->
    <font>
      <b/>
      <sz val="10"/>
      <color rgb="FF000000"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
    <!-- 3: Hyperlink font -->
    <font>
      <u/>
      <sz val="10"/>
      <color rgb="FF1A73E8"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
  </fonts>
  <fills count="3">
    <!-- 0: None -->
    <fill><patternFill patternType="none"/></fill>
    <!-- 1: Gray125 (reserved by openxml) -->
    <fill><patternFill patternType="gray125"/></fill>
    <!-- 2: Header Background (Light gray) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/></patternFill></fill>
  </fills>
  <borders count="3">
    <!-- 0: None -->
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <!-- 1: Cell Border (Thin light gray) -->
    <border>
      <left style="thin"><color rgb="FFE5E7EB"/></left>
      <right style="thin"><color rgb="FFE5E7EB"/></right>
      <top style="thin"><color rgb="FFE5E7EB"/></top>
      <bottom style="thin"><color rgb="FFE5E7EB"/></bottom>
    </border>
    <!-- 2: Total Row Border (Top thin, bottom double) -->
    <border>
      <left style="thin"><color rgb="FFE5E7EB"/></left>
      <right style="thin"><color rgb="FFE5E7EB"/></right>
      <top style="thin"><color rgb="FF1F2937"/></top>
      <bottom style="double"><color rgb="FF1F2937"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="10">
    <!-- 0: Normal Text -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 1: Bold Header -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 2: Numeric Quantity -->
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 3: Currency INR -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 4: Centered Text / Date -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 5: Grand Total Label (Bold, double underline border) -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 6: Grand Total Quantity -->
    <xf numFmtId="165" fontId="2" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 7: Grand Total INR -->
    <xf numFmtId="164" fontId="2" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
    <!-- 8: Hyperlink Style (Blue, Underline) -->
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 9: Status Tag Center Bold -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;
}

/**
 * Field extraction & layout helpers for dynamic Excel exports
 */
export function getActiveFieldDefs(options?: ExportOptions): ExportFieldDefinition[] {
  if (!options?.selectedFields || options.selectedFields.length === 0) {
    return EXPORT_FIELD_DEFINITIONS.filter((f) => f.isDefault);
  }
  const keyMap = new Map(EXPORT_FIELD_DEFINITIONS.map((f) => [f.key, f]));
  const list: ExportFieldDefinition[] = [];
  for (const k of options.selectedFields) {
    const found = keyMap.get(k);
    if (found) list.push(found);
  }
  return list.length > 0 ? list : EXPORT_FIELD_DEFINITIONS.filter((f) => f.isDefault);
}

export function getFieldColWidth(key: ExportFieldKey): number {
  switch (key) {
    case "sr": return 8;
    case "period": return 14;
    case "customerName": return 34;
    case "customerId": return 22;
    case "itemName": return 34;
    case "itemId": return 22;
    case "sku": return 16;
    case "status": return 18;
    case "billNumber": return 20;
    case "billDate": return 14;
    case "vendorName": return 30;
    case "vendorId": return 22;
    case "purchaseQty": return 15;
    case "purchaseRate": return 18;
    case "purchaseAmount": return 20;
    case "purchaseCustomerDetails": return 26;
    case "invoiceNumber": return 20;
    case "invoiceDate": return 14;
    case "salesQty": return 15;
    case "salesRate": return 18;
    case "salesAmount": return 20;
    case "balanceQty": return 15;
    case "yetToPurchase": return 18;
    case "yetToSale": return 18;
    case "reconciledQty": return 18;
    case "includedInReconciliation": return 22;
    case "isExcluded": return 12;
    case "exclusionScope": return 18;
    case "exclusionReason": return 30;
    case "remarks": return 26;
    case "approvedBy": return 20;
    case "approvedDate": return 14;
    default: return 16;
  }
}

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function getFieldValue(
  item: any,
  def: ExportFieldDefinition,
  idx: number
): { val: any; type: "string" | "number" | "currency" | "date" | "status" } {
  switch (def.key) {
    case "sr":
      return { val: idx + 1, type: "number" };
    case "period":
      return { val: item.financialYear || item.period || "", type: "string" };
    case "customerName":
      return { val: item.customerName || "", type: "string" };
    case "customerId":
      return { val: item.customerId || "", type: "string" };
    case "itemName":
      return { val: item.itemName || "", type: "string" };
    case "itemId":
      return { val: item.itemId || "", type: "string" };
    case "sku":
      return { val: item.sku || "", type: "string" };
    case "status":
      return { val: item.status || "RECONCILED", type: "status" };
    case "billNumber":
      return { val: item.billNumbers || item.billNumber || "", type: "string" };
    case "billDate":
      return { val: item.billDate || "", type: "date" };
    case "vendorName":
      return { val: item.vendorName || "", type: "string" };
    case "vendorId":
      return { val: item.vendorId || "", type: "string" };
    case "purchaseQty":
      const pQty = item.purchaseQty ?? item.totalPurchaseQty ?? item.quantity ?? 0;
      return { val: round3(Number(pQty) || 0), type: "number" };
    case "purchaseRate":
      const pr = item.avgPurchaseRate ?? item.singlePurchaseRate ?? item.purchaseRate ?? (item.purchaseQty ? (item.purchaseAmount / item.purchaseQty) : (item.rate ?? 0));
      return { val: round2(Number(pr) || 0), type: "currency" };
    case "purchaseAmount":
      const pAmt = item.purchaseAmount ?? item.totalPurchaseAmount ?? item.amount ?? 0;
      return { val: round2(Number(pAmt) || 0), type: "currency" };
    case "purchaseCustomerDetails":
      return { val: item.purchaseCustomerDetails || item.customerDataStatus || item.customerDetailsStatus || "VERIFIED", type: "string" };
    case "invoiceNumber":
      return { val: item.invoiceNumbers || item.invoiceNumber || "", type: "string" };
    case "invoiceDate":
      return { val: item.invoiceDate || item.transactionDate || "", type: "date" };
    case "salesQty":
      const sQty = item.salesQty ?? item.totalSalesQty ?? 0;
      return { val: round3(Number(sQty) || 0), type: "number" };
    case "salesRate":
      const sr = item.avgSalesRate ?? item.singleSalesRate ?? item.salesRate ?? (item.salesQty ? (item.salesAmount / item.salesQty) : 0);
      return { val: round2(Number(sr) || 0), type: "currency" };
    case "salesAmount":
      const sAmt = item.salesAmount ?? item.totalSalesAmount ?? 0;
      return { val: round2(Number(sAmt) || 0), type: "currency" };
    case "balanceQty":
      return { val: round3(Number(item.balanceQty ?? 0)), type: "number" };
    case "yetToPurchase":
      return { val: round3(Number(item.yetToPurchaseQty ?? item.yetToPurchase ?? 0)), type: "number" };
    case "yetToSale":
      return { val: round3(Number(item.yetToSaleQty ?? item.yetToSale ?? 0)), type: "number" };
    case "reconciledQty":
      return { val: round3(Number(item.reconciledQty ?? 0)), type: "number" };
    case "includedInReconciliation":
      return { val: item.isExcluded ? "No" : "Yes", type: "string" };
    case "isExcluded":
      return { val: item.isExcluded ? "Yes" : "No", type: "string" };
    case "exclusionScope":
      return { val: item.scope || item.exclusionScope || (item.isExcluded ? "TRANSACTION" : "NONE"), type: "string" };
    case "exclusionReason":
      return { val: item.exclusionReason || item.reason || "", type: "string" };
    case "remarks":
      return { val: item.remarks || item.notes || item.description || "", type: "string" };
    case "approvedBy":
      return { val: item.approvedBy || item.excludedBy || "", type: "string" };
    case "approvedDate":
      return { val: item.approvedDate || item.excludedAt || "", type: "date" };
    default:
      return { val: "", type: "string" };
  }
}

/**
 * Builds Sheet 1: Reconciliation Summary
 */
function buildSheet1Xml(report: ReconciliationReportResult, options?: ExportOptions): string {
  const fieldDefs = getActiveFieldDefs(options);
  const includeTotals = options?.includeTotals !== false;

  let rowsXml = "";
  // Header Row 1
  rowsXml += `<row r="1" ht="28" customHeight="1">`;
  fieldDefs.forEach((def, idx) => {
    const col = colLetter(idx);
    rowsXml += `<c r="${col}1" s="1" t="inlineStr"><is><t>${escapeXml(def.label)}</t></is></c>`;
  });
  rowsXml += `</row>`;

  // Data Rows
  let rowIdx = 2;
  const colSums: number[] = fieldDefs.map(() => 0);

  for (let itemIdx = 0; itemIdx < report.summaryItems.length; itemIdx++) {
    const item = report.summaryItems[itemIdx];
    rowsXml += `<row r="${rowIdx}" ht="20" customHeight="1">`;

    fieldDefs.forEach((def, colIdx) => {
      const col = colLetter(colIdx);
      const { val, type } = getFieldValue(item, def, itemIdx);

      if (type === "number") {
        colSums[colIdx] += typeof val === "number" ? val : 0;
        rowsXml += `<c r="${col}${rowIdx}" s="2" t="n"><v>${val}</v></c>`;
      } else if (type === "currency") {
        colSums[colIdx] += typeof val === "number" ? val : 0;
        rowsXml += `<c r="${col}${rowIdx}" s="3" t="n"><v>${val}</v></c>`;
      } else if (type === "status") {
        rowsXml += `<c r="${col}${rowIdx}" s="9" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
      } else if (type === "date") {
        rowsXml += `<c r="${col}${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
      } else {
        rowsXml += `<c r="${col}${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
      }
    });

    rowsXml += `</row>`;
    rowIdx++;
  }

  // Optional Grand Total Row
  if (includeTotals && report.summaryItems.length > 0) {
    const totalRow = rowIdx;
    rowsXml += `<row r="${totalRow}" ht="24" customHeight="1">`;
    let firstTextRendered = false;

    fieldDefs.forEach((def, colIdx) => {
      const col = colLetter(colIdx);
      if (def.type === "number") {
        rowsXml += `<c r="${col}${totalRow}" s="6" t="n"><v>${Math.round(colSums[colIdx] * 100) / 100}</v></c>`;
      } else if (def.type === "currency") {
        if (def.key === "purchaseRate" || def.key === "salesRate") {
          rowsXml += `<c r="${col}${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
        } else {
          rowsXml += `<c r="${col}${totalRow}" s="7" t="n"><v>${Math.round(colSums[colIdx] * 100) / 100}</v></c>`;
        }
      } else {
        if (!firstTextRendered) {
          rowsXml += `<c r="${col}${totalRow}" s="5" t="inlineStr"><is><t>Grand Total</t></is></c>`;
          firstTextRendered = true;
        } else {
          rowsXml += `<c r="${col}${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
        }
      }
    });

    rowsXml += `</row>`;
  }

  // Dynamic Column Widths
  let colsXml = "<cols>";
  fieldDefs.forEach((def, idx) => {
    const w = getFieldColWidth(def.key);
    colsXml += `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`;
  });
  colsXml += "</cols>";

  const lastColLetter = colLetter(fieldDefs.length - 1);
  const filterMaxRow = Math.max(1, report.summaryItems.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  ${colsXml}
  <sheetData>
    ${rowsXml}
  </sheetData>
  <autoFilter ref="A1:${lastColLetter}${filterMaxRow}"/>
</worksheet>`;
}


/**
 * Builds Sheet 2: Transaction Detail (with clickable Zoho VIEW links)
 */
function buildSheet2Xml(report: ReconciliationReportResult): {
  sheetXml: string;
  relsXml?: string;
} {
  const headers = [
    "Transaction Date",
    "Financial Year",
    "Customer",
    "Item",
    "SKU",
    "Sales Invoice Number",
    "Sales Qty",
    "Sales Amount",
    "Purchase Bill Number",
    "Vendor",
    "Purchase Qty",
    "Purchase Amount",
    "Customer Data Status",
  ];

  let rowsXml = "";
  rowsXml += `<row r="1" ht="28" customHeight="1">`;
  headers.forEach((h, idx) => {
    const col = colLetter(idx);
    rowsXml += `<c r="${col}1" s="1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  rowsXml += `</row>`;

  const hyperlinks: { ref: string; url: string }[] = [];

  let rowIdx = 2;
  for (const tx of report.transactionDetails) {
    const invCol = `F${rowIdx}`;
    const billCol = `I${rowIdx}`;

    if (tx.salesInvoiceUrl) {
      hyperlinks.push({ ref: invCol, url: tx.salesInvoiceUrl });
    }
    if (tx.purchaseBillUrl) {
      hyperlinks.push({ ref: billCol, url: tx.purchaseBillUrl });
    }

    rowsXml += `<row r="${rowIdx}" ht="20" customHeight="1">`;
    rowsXml += `<c r="A${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(tx.transactionDate)}</t></is></c>`;
    rowsXml += `<c r="B${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(tx.financialYear)}</t></is></c>`;
    rowsXml += `<c r="C${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(tx.customerName)}</t></is></c>`;
    rowsXml += `<c r="D${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(tx.itemName)}</t></is></c>`;
    rowsXml += `<c r="E${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(tx.sku)}</t></is></c>`;
    rowsXml += `<c r="F${rowIdx}" s="${tx.salesInvoiceUrl ? 8 : 0}" t="inlineStr"><is><t>${escapeXml(tx.salesInvoiceNumber || "-")}</t></is></c>`;
    rowsXml += `<c r="G${rowIdx}" s="2" t="n"><v>${tx.salesQty}</v></c>`;
    rowsXml += `<c r="H${rowIdx}" s="3" t="n"><v>${tx.salesAmount}</v></c>`;
    rowsXml += `<c r="I${rowIdx}" s="${tx.purchaseBillUrl ? 8 : 0}" t="inlineStr"><is><t>${escapeXml(tx.purchaseBillNumber || "-")}</t></is></c>`;
    rowsXml += `<c r="J${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(tx.vendorName || "-")}</t></is></c>`;
    rowsXml += `<c r="K${rowIdx}" s="2" t="n"><v>${tx.purchaseQty}</v></c>`;
    rowsXml += `<c r="L${rowIdx}" s="3" t="n"><v>${tx.purchaseAmount}</v></c>`;
    rowsXml += `<c r="M${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(tx.customerDataStatus)}</t></is></c>`;
    rowsXml += `</row>`;
    rowIdx++;
  }

  let hyperlinksXml = "";
  let relsXml: string | undefined = undefined;

  if (hyperlinks.length > 0) {
    hyperlinksXml = `<hyperlinks>`;
    let relsInner = "";
    hyperlinks.forEach((hl, i) => {
      const rId = `rId${i + 1}`;
      hyperlinksXml += `<hyperlink ref="${hl.ref}" r:id="${rId}"/>`;
      relsInner += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(hl.url)}" TargetMode="External"/>`;
    });
    hyperlinksXml += `</hyperlinks>`;

    relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relsInner}
</Relationships>`;
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    <col min="1" max="1" width="16" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="36" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
    <col min="5" max="5" width="16" customWidth="1"/>
    <col min="6" max="6" width="22" customWidth="1"/>
    <col min="7" max="7" width="14" customWidth="1"/>
    <col min="8" max="8" width="18" customWidth="1"/>
    <col min="9" max="9" width="22" customWidth="1"/>
    <col min="10" max="10" width="28" customWidth="1"/>
    <col min="11" max="11" width="14" customWidth="1"/>
    <col min="12" max="12" width="18" customWidth="1"/>
    <col min="13" max="13" width="26" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
  ${hyperlinksXml}
  <autoFilter ref="A1:M${Math.max(1, report.transactionDetails.length + 1)}"/>
</worksheet>`;

  return { sheetXml, relsXml };
}

/**
 * Builds Sheet 3: Customer Details Missing / Exception Report
 */
function buildSheet3Xml(report: ReconciliationReportResult): string {
  const headers = [
    "Bill Date",
    "Bill Number",
    "Vendor",
    "Item",
    "SKU",
    "Quantity",
    "Purchase Amount",
    "Description",
    "Customer Data Status",
  ];

  let rowsXml = "";
  rowsXml += `<row r="1" ht="28" customHeight="1">`;
  headers.forEach((h, idx) => {
    const col = colLetter(idx);
    rowsXml += `<c r="${col}1" s="1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  rowsXml += `</row>`;

  let rowIdx = 2;
  for (const exc of report.exceptionItems) {
    rowsXml += `<row r="${rowIdx}" ht="20" customHeight="1">`;
    rowsXml += `<c r="A${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(exc.billDate)}</t></is></c>`;
    rowsXml += `<c r="B${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(exc.billNumber)}</t></is></c>`;
    rowsXml += `<c r="C${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(exc.vendorName)}</t></is></c>`;
    rowsXml += `<c r="D${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(exc.itemName)}</t></is></c>`;
    rowsXml += `<c r="E${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(exc.sku)}</t></is></c>`;
    rowsXml += `<c r="F${rowIdx}" s="2" t="n"><v>${exc.quantity}</v></c>`;
    rowsXml += `<c r="G${rowIdx}" s="3" t="n"><v>${exc.purchaseAmount}</v></c>`;
    rowsXml += `<c r="H${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(exc.description)}</t></is></c>`;
    rowsXml += `<c r="I${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(exc.customerDataStatus)}</t></is></c>`;
    rowsXml += `</row>`;
    rowIdx++;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    <col min="1" max="1" width="16" customWidth="1"/>
    <col min="2" max="2" width="22" customWidth="1"/>
    <col min="3" max="3" width="30" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
    <col min="5" max="5" width="16" customWidth="1"/>
    <col min="6" max="6" width="14" customWidth="1"/>
    <col min="7" max="7" width="18" customWidth="1"/>
    <col min="8" max="8" width="45" customWidth="1"/>
    <col min="9" max="9" width="26" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
  <autoFilter ref="A1:I${Math.max(1, report.exceptionItems.length + 1)}"/>
</worksheet>`;
}

/**
 * Builds Sheet 4: Export Information
 */
function buildSheet4Xml(report: ReconciliationReportResult): string {
  const genDate = new Date(report.generatedAt);
  const infoRows = [
    ["Report Name", "Bansil Books Material Reconciliation Analytics"],
    ["Organization", report.organizationName],
    ["Organization ID", report.organizationId],
    ["Financial Year", report.filter.financialYear || "FY 2025-26"],
    ["From Date", report.filter.fromDate || "All"],
    ["To Date", report.filter.toDate || "All"],
    ["Customer Filter", report.filter.customerName || report.filter.customerId || "All Customers"],
    ["Item Filter", report.filter.itemName || report.filter.itemId || "All Items"],
    ["Vendor Filter", report.filter.vendorName || "All Vendors"],
    ["Status Filter", report.filter.status || "All Statuses"],
    ["Generated Date", genDate.toISOString().slice(0, 10)],
    ["Generated Time", genDate.toTimeString().slice(0, 8)],
    ["Data Source", "Zoho Books READ-ONLY synchronized data"],
    ["Security Notice", "Zoho Books source data was not modified."],
  ];

  let rowsXml = "";
  rowsXml += `<row r="1" ht="28" customHeight="1">
    <c r="A1" s="1" t="inlineStr"><is><t>Metadata Field</t></is></c>
    <c r="B1" s="1" t="inlineStr"><is><t>Report Parameter / System State</t></is></c>
  </row>`;

  infoRows.forEach(([key, val], idx) => {
    const r = idx + 2;
    rowsXml += `<row r="${r}" ht="20" customHeight="1">
      <c r="A${r}" s="1" t="inlineStr"><is><t>${escapeXml(key)}</t></is></c>
      <c r="B${r}" s="0" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>
    </row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="26" customWidth="1"/>
    <col min="2" max="2" width="60" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
</worksheet>`;
}

/**
 * Main export generator: builds complete .xlsx binary buffer.
 */
/**
 * Main export generator: builds complete .xlsx binary buffer.
 */
export function buildExcelWorkbook(
  report: ReconciliationReportResult,
  options?: ExportOptions
): Buffer {
  const sheet1Xml = buildSheet1Xml(report, options);
  const { sheetXml: sheet2Xml, relsXml: sheet2RelsXml } = buildSheet2Xml(report);
  const sheet3Xml = buildSheet3Xml(report);
  const sheet4Xml = buildSheet4Xml(report);
  const stylesXml = buildStylesXml();

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Reconciliation Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Transaction Detail" sheetId="2" r:id="rId2"/>
    <sheet name="Customer Details Missing" sheetId="3" r:id="rId3"/>
    <sheet name="Export Information" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    {
      path: "xl/styles.xml",
      data: Buffer.from(stylesXml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet1.xml",
      data: Buffer.from(sheet1Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet2.xml",
      data: Buffer.from(sheet2Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet3.xml",
      data: Buffer.from(sheet3Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet4.xml",
      data: Buffer.from(sheet4Xml, "utf-8"),
    },
  ];

  if (sheet2RelsXml) {
    entries.push({
      path: "xl/worksheets/_rels/sheet2.xml.rels",
      data: Buffer.from(sheet2RelsXml, "utf-8"),
    });
  }

  return packZip(entries);
}

/**
 * Builds Sheet XML for Customer-Item mismatch tables (Summary, Yet to Sale, Yet to Purchase, Purchase Only, Sale Only)
 */
function buildCustomerItemMismatchTableXml(
  items: MasterInventoryMismatchItem[],
  options?: ExportOptions
): string {
  const fieldDefs = getActiveFieldDefs(options);
  const includeTotals = options?.includeTotals !== false;

  let rowsXml = "";
  // Header row
  rowsXml += `<row r="1" ht="28" customHeight="1">`;
  fieldDefs.forEach((def, idx) => {
    const col = colLetter(idx);
    rowsXml += `<c r="${col}1" s="1" t="inlineStr"><is><t>${escapeXml(def.label)}</t></is></c>`;
  });
  rowsXml += `</row>`;

  // Data rows
  let rowIdx = 2;
  const colSums: number[] = fieldDefs.map(() => 0);

  items.forEach((item, itemIdx) => {
    rowsXml += `<row r="${rowIdx}" ht="20" customHeight="1">`;

    fieldDefs.forEach((def, colIdx) => {
      const col = colLetter(colIdx);
      const { val, type } = getFieldValue(item, def, itemIdx);

      if (type === "number") {
        colSums[colIdx] += typeof val === "number" ? val : 0;
        rowsXml += `<c r="${col}${rowIdx}" s="2" t="n"><v>${val}</v></c>`;
      } else if (type === "currency") {
        colSums[colIdx] += typeof val === "number" ? val : 0;
        rowsXml += `<c r="${col}${rowIdx}" s="3" t="n"><v>${val}</v></c>`;
      } else if (type === "status") {
        rowsXml += `<c r="${col}${rowIdx}" s="9" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
      } else if (type === "date") {
        rowsXml += `<c r="${col}${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
      } else {
        rowsXml += `<c r="${col}${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
      }
    });

    rowsXml += `</row>`;
    rowIdx++;
  });

  // Grand Total Row
  if (includeTotals && items.length > 0) {
    const totalRow = rowIdx;
    rowsXml += `<row r="${totalRow}" ht="24" customHeight="1">`;
    let firstTextRendered = false;

    fieldDefs.forEach((def, colIdx) => {
      const col = colLetter(colIdx);
      if (def.type === "number") {
        rowsXml += `<c r="${col}${totalRow}" s="6" t="n"><v>${Math.round(colSums[colIdx] * 100) / 100}</v></c>`;
      } else if (def.type === "currency") {
        if (def.key === "purchaseRate" || def.key === "salesRate") {
          rowsXml += `<c r="${col}${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
        } else {
          rowsXml += `<c r="${col}${totalRow}" s="7" t="n"><v>${Math.round(colSums[colIdx] * 100) / 100}</v></c>`;
        }
      } else {
        if (!firstTextRendered) {
          rowsXml += `<c r="${col}${totalRow}" s="5" t="inlineStr"><is><t>Grand Total</t></is></c>`;
          firstTextRendered = true;
        } else {
          rowsXml += `<c r="${col}${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
        }
      }
    });

    rowsXml += `</row>`;
  }

  // Dynamic Column Widths
  let colsXml = "<cols>";
  fieldDefs.forEach((def, idx) => {
    const w = getFieldColWidth(def.key);
    colsXml += `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`;
  });
  colsXml += "</cols>";

  const lastColLetter = colLetter(fieldDefs.length - 1);
  const filterMaxRow = Math.max(1, items.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  ${colsXml}
  <sheetData>
    ${rowsXml}
  </sheetData>
  <autoFilter ref="A1:${lastColLetter}${filterMaxRow}"/>
</worksheet>`;
}


/**
 * Builds Sheet XML for Customer Details Missing
 */
function buildCustomerDetailsMissingTableXml(missing: MasterInventoryMismatchReportResult["customerDetailsMissing"]): string {
  const headers = [
    "Sr",
    "Bill Number",
    "Bill Date",
    "Vendor Name",
    "Item Name",
    "SKU",
    "Quantity",
    "Rate (₹)",
    "Amount (₹)",
    "Description",
  ];

  let rowsXml = "";
  rowsXml += `<row r="1" ht="28" customHeight="1">`;
  headers.forEach((h, idx) => {
    const col = colLetter(idx);
    rowsXml += `<c r="${col}1" s="1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  rowsXml += `</row>`;

  let rowIdx = 2;
  missing.forEach((item, idx) => {
    rowsXml += `<row r="${rowIdx}" ht="20" customHeight="1">`;
    rowsXml += `<c r="A${rowIdx}" s="4" t="n"><v>${idx + 1}</v></c>`;
    rowsXml += `<c r="B${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(item.billNumber)}</t></is></c>`;
    rowsXml += `<c r="C${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(item.billDate)}</t></is></c>`;
    rowsXml += `<c r="D${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(item.vendorName)}</t></is></c>`;
    rowsXml += `<c r="E${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(item.itemName)}</t></is></c>`;
    rowsXml += `<c r="F${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(item.sku || "")}</t></is></c>`;
    rowsXml += `<c r="G${rowIdx}" s="2" t="n"><v>${item.quantity}</v></c>`;
    rowsXml += `<c r="H${rowIdx}" s="3" t="n"><v>${item.rate}</v></c>`;
    rowsXml += `<c r="I${rowIdx}" s="3" t="n"><v>${item.amount}</v></c>`;
    rowsXml += `<c r="J${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(item.description || "")}</t></is></c>`;
    rowsXml += `</row>`;
    rowIdx++;
  });

  const totalQty = missing.reduce((s, i) => s + i.quantity, 0);
  const totalAmt = Math.round(missing.reduce((s, i) => s + i.amount, 0) * 100) / 100;

  const totalRow = rowIdx;
  rowsXml += `<row r="${totalRow}" ht="24" customHeight="1">`;
  rowsXml += `<c r="A${totalRow}" s="5" t="inlineStr"><is><t>Grand Total</t></is></c>`;
  rowsXml += `<c r="B${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `<c r="C${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `<c r="D${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `<c r="E${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `<c r="F${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `<c r="G${totalRow}" s="6" t="n"><v>${totalQty}</v></c>`;
  rowsXml += `<c r="H${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `<c r="I${totalRow}" s="7" t="n"><v>${totalAmt}</v></c>`;
  rowsXml += `<c r="J${totalRow}" s="5" t="inlineStr"><is><t></t></is></c>`;
  rowsXml += `</row>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="20" customWidth="1"/>
    <col min="3" max="3" width="14" customWidth="1"/>
    <col min="4" max="4" width="32" customWidth="1"/>
    <col min="5" max="5" width="32" customWidth="1"/>
    <col min="6" max="6" width="16" customWidth="1"/>
    <col min="7" max="7" width="14" customWidth="1"/>
    <col min="8" max="8" width="18" customWidth="1"/>
    <col min="9" max="9" width="22" customWidth="1"/>
    <col min="10" max="10" width="36" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
  <autoFilter ref="A1:J${Math.max(1, missing.length + 1)}"/>
</worksheet>`;
}

/**
 * Builds Sheet XML for Transaction Detail
 */
function buildTransactionDetailTableXml(report: MasterInventoryMismatchReportResult): string {
  const headers = [
    "Sr",
    "Type",
    "Doc Number",
    "Date",
    "Customer",
    "Vendor",
    "Item Name",
    "SKU",
    "Quantity",
    "Rate (₹)",
    "Amount (₹)",
  ];

  let rowsXml = "";
  rowsXml += `<row r="1" ht="28" customHeight="1">`;
  headers.forEach((h, idx) => {
    const col = colLetter(idx);
    rowsXml += `<c r="${col}1" s="1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  rowsXml += `</row>`;

  // Export transaction detail from the report's raw transaction lines
  let rowIdx = 2;
  (report.transactionLines || []).forEach((item, idx) => {
    const isPurchase = item.type === "PURCHASE";
    const customer = item.customerName || (isPurchase ? "CUSTOMER DETAILS MISSING" : "—");
    const vendor = isPurchase ? (item.vendorName || "—") : "—";
    rowsXml += `<row r="${rowIdx}" ht="20" customHeight="1">`;
    rowsXml += `<c r="A${rowIdx}" s="4" t="n"><v>${idx + 1}</v></c>`;
    rowsXml += `<c r="B${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(item.type)}</t></is></c>`;
    rowsXml += `<c r="C${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(item.docNumber || item.documentNo)}</t></is></c>`;
    rowsXml += `<c r="D${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(formatDisplayDate(item.date))}</t></is></c>`;
    rowsXml += `<c r="E${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(customer)}</t></is></c>`;
    rowsXml += `<c r="F${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(vendor)}</t></is></c>`;
    rowsXml += `<c r="G${rowIdx}" s="0" t="inlineStr"><is><t>${escapeXml(item.itemName)}</t></is></c>`;
    rowsXml += `<c r="H${rowIdx}" s="4" t="inlineStr"><is><t>${escapeXml(item.sku || "-")}</t></is></c>`;
    rowsXml += `<c r="I${rowIdx}" s="2" t="n"><v>${item.quantity || 0}</v></c>`;
    rowsXml += `<c r="J${rowIdx}" s="3" t="n"><v>${Math.round((item.rate || 0) * 1000) / 1000}</v></c>`;
    rowsXml += `<c r="K${rowIdx}" s="3" t="n"><v>${Math.round((item.amount || 0) * 1000) / 1000}</v></c>`;
    rowsXml += `</row>`;
    rowIdx++;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="20" customWidth="1"/>
    <col min="4" max="4" width="16" customWidth="1"/>
    <col min="5" max="5" width="34" customWidth="1"/>
    <col min="6" max="6" width="34" customWidth="1"/>
    <col min="7" max="7" width="34" customWidth="1"/>
    <col min="8" max="8" width="16" customWidth="1"/>
    <col min="9" max="9" width="14" customWidth="1"/>
    <col min="10" max="10" width="18" customWidth="1"/>
    <col min="11" max="11" width="22" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
  <autoFilter ref="A1:K${Math.max(1, (report.transactionLines?.length || 0) + 1)}"/>
</worksheet>`;
}

/**
 * Builds Export Information Sheet for Master Inventory Mismatch
 */
function buildMasterMismatchInfoXml(report: MasterInventoryMismatchReportResult): string {
  const metadata = [
    ["Report Name", "Master Inventory Mismatch — Customer + Item Analytics"],
    ["Organization", `${report.organizationName} (${report.organizationId})`],
    ["Financial Year", report.filter.financialYear || "FY 2025-26"],
    ["Period Filter", report.filter.period || "Current FY"],
    ["From Date", report.filter.fromDate || "Default"],
    ["To Date", report.filter.toDate || "Default"],
    ["Export Date & Time", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"],
    ["Data Last Synced", formatDisplayDateTime(report.dataLastSynced) || "N/A"],
    ["Total Customer-Item Records", String(report.totals.totalItems)],
    ["Total Mismatches (Unbalanced)", String(report.tabCounts.allMismatches)],
    ["Yet to Sale Records", String(report.tabCounts.yetToSale)],
    ["Yet to Purchase Records", String(report.tabCounts.yetToPurchase)],
    ["Purchase Only (No Sale) Records", String(report.tabCounts.purchaseOnly)],
    ["Sale Only (No Purchase) Records", String(report.tabCounts.saleOnly)],
    ["Missing Customer Details Lines", String(report.tabCounts.missingCustomer)],
    ["Fully Reconciled Records", String(report.tabCounts.reconciled)],
    ["Total Purchase Quantity", String(report.totals.totalPurchaseQty)],
    ["Total Purchase Amount", `₹${report.totals.totalPurchaseAmount.toLocaleString("en-IN")}`],
    ["Total Sales Quantity", String(report.totals.totalSalesQty)],
    ["Total Sales Amount", `₹${report.totals.totalSalesAmount.toLocaleString("en-IN")}`],
    ["Net Balance Quantity", String(report.totals.netBalanceQty)],
    ["Security Invariant", "Zoho Books source data was not modified. Generated locally via SQLite cache."],
  ];

  let rowsXml = "";
  rowsXml += `<row r="1" ht="24" customHeight="1">
    <c r="A1" s="1" t="inlineStr"><is><t>Property</t></is></c>
    <c r="B1" s="1" t="inlineStr"><is><t>Value</t></is></c>
  </row>`;

  metadata.forEach(([key, val], idx) => {
    const r = idx + 2;
    rowsXml += `<row r="${r}" ht="20" customHeight="1">
      <c r="A${r}" s="1" t="inlineStr"><is><t>${escapeXml(key)}</t></is></c>
      <c r="B${r}" s="0" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>
    </row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="34" customWidth="1"/>
    <col min="2" max="2" width="65" customWidth="1"/>
  </cols>
  <sheetData>
    ${rowsXml}
  </sheetData>
</worksheet>`;
}

/**
 * Builds standalone Master Inventory Mismatch Excel workbook (.xlsx) with all 8 operational sheets:
 * 1. Mismatch Summary
 * 2. Yet to Sale
 * 3. Yet to Purchase
 * 4. Purchase Only No Sale
 * 5. Sale Only No Purchase
 * 6. Customer Details Missing
 * 7. Transaction Detail
 * 8. Export Information
 */
export function buildMasterInventoryMismatchExcel(
  report: MasterInventoryMismatchReportResult,
  options?: ExportOptions
): Buffer {
  const sheet1Xml = buildCustomerItemMismatchTableXml(report.items.length > 0 ? report.items : report.allMismatches, options);
  const sheet2Xml = buildCustomerItemMismatchTableXml(report.yetToSale, options);
  const sheet3Xml = buildCustomerItemMismatchTableXml(report.yetToPurchase, options);
  const sheet4Xml = buildCustomerItemMismatchTableXml(report.purchaseOnly, options);
  const sheet5Xml = buildCustomerItemMismatchTableXml(report.saleOnly, options);
  const sheet6Xml = buildCustomerDetailsMissingTableXml(report.customerDetailsMissing);
  const sheet7Xml = buildTransactionDetailTableXml(report);
  const sheet8Xml = buildMasterMismatchInfoXml(report);
  const stylesXml = buildStylesXml();

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet8.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet8.xml"/>
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Mismatch Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Yet to Sale" sheetId="2" r:id="rId2"/>
    <sheet name="Yet to Purchase" sheetId="3" r:id="rId3"/>
    <sheet name="Purchase Only No Sale" sheetId="4" r:id="rId4"/>
    <sheet name="Sale Only No Purchase" sheetId="5" r:id="rId5"/>
    <sheet name="Customer Details Missing" sheetId="6" r:id="rId6"/>
    <sheet name="Transaction Detail" sheetId="7" r:id="rId7"/>
    <sheet name="Export Information" sheetId="8" r:id="rId8"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    {
      path: "xl/styles.xml",
      data: Buffer.from(stylesXml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet1.xml",
      data: Buffer.from(sheet1Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet2.xml",
      data: Buffer.from(sheet2Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet3.xml",
      data: Buffer.from(sheet3Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet4.xml",
      data: Buffer.from(sheet4Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet5.xml",
      data: Buffer.from(sheet5Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet6.xml",
      data: Buffer.from(sheet6Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet7.xml",
      data: Buffer.from(sheet7Xml, "utf-8"),
    },
    {
      path: "xl/worksheets/sheet8.xml",
      data: Buffer.from(sheet8Xml, "utf-8"),
    },
  ];

  return packZip(entries);
}

/**
 * Builds Excel Workbook for a single Customer+Item Transaction Breakdown (Section 23).
 * Sheets: Summary, Purchase Bill Lines, Sales Invoice Lines, Exclusion / Audit Information, Export Information
 */
export function buildTransactionBreakdownExcel(
  item: ItemTransactionBreakdown,
  period: string = item.period || "Current Period"
): Buffer {
  const stylesXml = buildStylesXml();

  // Sheet 1: Summary
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="40" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr" s="1"><is><t>METRIC / PROPERTY</t></is></c>
      <c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c>
    </row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Customer Name</t></is></c><c r="B2" t="inlineStr" s="3"><is><t>${escapeXml(item.customerName)}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Item Name</t></is></c><c r="B3" t="inlineStr" s="3"><is><t>${escapeXml(item.itemName)}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>SKU / Item Code</t></is></c><c r="B4" t="inlineStr"><is><t>${escapeXml(item.sku || "-")}</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Period</t></is></c><c r="B5" t="inlineStr"><is><t>${escapeXml(period)}</t></is></c></row>
    <row r="6"><c r="A6" t="inlineStr"><is><t>Reconciliation Status</t></is></c><c r="B6" t="inlineStr" s="1"><is><t>${escapeXml(item.status || "RECONCILED")}</t></is></c></row>
    <row r="7"><c r="A7" t="inlineStr"><is><t>Exclusion Status</t></is></c><c r="B7" t="inlineStr"><is><t>${item.isExcluded ? "EXCLUDED" : "ACTIVE / INCLUDED"}</t></is></c></row>
    <row r="8"><c r="A8" t="inlineStr" s="2"><is><t>TOTAL PURCHASE QTY</t></is></c><c r="B8" s="5"><v>${item.totalPurchaseQty}</v></c></row>
    <row r="9"><c r="A9" t="inlineStr" s="2"><is><t>TOTAL PURCHASE AMOUNT</t></is></c><c r="B9" s="6"><v>${item.totalPurchaseAmount}</v></c></row>
    <row r="10"><c r="A10" t="inlineStr" s="2"><is><t>TOTAL SALES QTY</t></is></c><c r="B10" s="5"><v>${item.totalSalesQty}</v></c></row>
    <row r="11"><c r="A11" t="inlineStr" s="2"><is><t>TOTAL SALES AMOUNT</t></is></c><c r="B11" s="6"><v>${item.totalSalesAmount}</v></c></row>
    <row r="12"><c r="A12" t="inlineStr" s="2"><is><t>BALANCE QTY</t></is></c><c r="B12" s="5"><v>${item.balanceQty}</v></c></row>
    <row r="13"><c r="A13" t="inlineStr"><is><t>Yet to Purchase (Shortage)</t></is></c><c r="B13" s="5"><v>${item.yetToPurchaseQty}</v></c></row>
    <row r="14"><c r="A14" t="inlineStr"><is><t>Yet to Sale (Surplus)</t></is></c><c r="B14" s="5"><v>${item.yetToSaleQty}</v></c></row>
    <row r="15"><c r="A15" t="inlineStr"><is><t>Reconciled Qty</t></is></c><c r="B15" s="5"><v>${item.reconciledQty}</v></c></row>
  </sheetData>
</worksheet>`;

  // Sheet 2: Purchase Bill Lines
  let pRowsXml = "";
  pRowsXml += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Bill No</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Bill Date</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Vendor Name</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Item Name</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Purchase Qty</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Purchase Rate</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Purchase Amount</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Purchase Customer Tag</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Exclusion Status</t></is></c>
  </row>`;
  item.purchaseTransactions.forEach((tx, idx) => {
    const r = idx + 2;
    pRowsXml += `<row r="${r}">
      <c r="A${r}"><v>${idx + 1}</v></c>
      <c r="B${r}" t="inlineStr" s="3"><is><t>${escapeXml(tx.billNumber)}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml(tx.date)}</t></is></c>
      <c r="D${r}" t="inlineStr"><is><t>${escapeXml(tx.vendorName)}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t>${escapeXml(tx.itemName || item.itemName)}</t></is></c>
      <c r="F${r}" t="inlineStr"><is><t>${escapeXml(tx.sku || item.sku || "-")}</t></is></c>
      <c r="G${r}" s="5"><v>${tx.quantity}</v></c>
      <c r="H${r}" s="6"><v>${tx.rate}</v></c>
      <c r="I${r}" s="6"><v>${tx.amount}</v></c>
      <c r="J${r}" t="inlineStr"><is><t>${escapeXml(tx.purchaseCustomerDetails || item.customerName)}</t></is></c>
      <c r="K${r}" t="inlineStr"><is><t>${escapeXml(tx.exclusionStatus || (item.isExcluded ? "EXCLUDED" : "ACTIVE"))}</t></is></c>
    </row>`;
  });
  const pTotR = item.purchaseTransactions.length + 2;
  pRowsXml += `<row r="${pTotR}">
    <c r="A${pTotR}" t="inlineStr" s="2"><is><t>TOTAL</t></is></c>
    <c r="B${pTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="C${pTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="D${pTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="E${pTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="F${pTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="G${pTotR}" s="5"><v>${item.totalPurchaseQty}</v></c>
    <c r="H${pTotR}" t="inlineStr"><is><t>-</t></is></c>
    <c r="I${pTotR}" s="6"><v>${item.totalPurchaseAmount}</v></c>
    <c r="J${pTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="K${pTotR}" t="inlineStr"><is><t></t></is></c>
  </row>`;
  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView tabSelected="0" workbookViewId="0"/></sheetViews>
  <sheetData>${pRowsXml}</sheetData>
  <autoFilter ref="A1:K${pTotR - 1}"/>
</worksheet>`;

  // Sheet 3: Sales Invoice Lines
  let sRowsXml = "";
  sRowsXml += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Invoice No</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Invoice Date</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Item Name</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Sales Qty</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Sales Rate</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Sales Amount</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Exclusion Status</t></is></c>
  </row>`;
  item.salesTransactions.forEach((tx, idx) => {
    const r = idx + 2;
    sRowsXml += `<row r="${r}">
      <c r="A${r}"><v>${idx + 1}</v></c>
      <c r="B${r}" t="inlineStr" s="3"><is><t>${escapeXml(tx.invoiceNumber)}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml(tx.date)}</t></is></c>
      <c r="D${r}" t="inlineStr"><is><t>${escapeXml(tx.customerName || item.customerName)}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t>${escapeXml(tx.itemName || item.itemName)}</t></is></c>
      <c r="F${r}" t="inlineStr"><is><t>${escapeXml(tx.sku || item.sku || "-")}</t></is></c>
      <c r="G${r}" s="5"><v>${tx.quantity}</v></c>
      <c r="H${r}" s="6"><v>${tx.rate}</v></c>
      <c r="I${r}" s="6"><v>${tx.amount}</v></c>
      <c r="J${r}" t="inlineStr"><is><t>${escapeXml(tx.exclusionStatus || (item.isExcluded ? "EXCLUDED" : "ACTIVE"))}</t></is></c>
    </row>`;
  });
  const sTotR = item.salesTransactions.length + 2;
  sRowsXml += `<row r="${sTotR}">
    <c r="A${sTotR}" t="inlineStr" s="2"><is><t>TOTAL</t></is></c>
    <c r="B${sTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="C${sTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="D${sTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="E${sTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="F${sTotR}" t="inlineStr"><is><t></t></is></c>
    <c r="G${sTotR}" s="5"><v>${item.totalSalesQty}</v></c>
    <c r="H${sTotR}" t="inlineStr"><is><t>-</t></is></c>
    <c r="I${sTotR}" s="6"><v>${item.totalSalesAmount}</v></c>
    <c r="J${sTotR}" t="inlineStr"><is><t></t></is></c>
  </row>`;
  const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView tabSelected="0" workbookViewId="0"/></sheetViews>
  <sheetData>${sRowsXml}</sheetData>
  <autoFilter ref="A1:J${sTotR - 1}"/>
</worksheet>`;

  // Sheet 4: Exclusion / Audit Information
  const sheet4Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>PROPERTY</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>DETAILS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Exclusion State</t></is></c><c r="B2" t="inlineStr"><is><t>${item.isExcluded ? "EXCLUDED FROM RECONCILIATION" : "ACTIVE (INCLUDED)"}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Customer Name</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(item.customerName)}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Item Name</t></is></c><c r="B4" t="inlineStr"><is><t>${escapeXml(item.itemName)}</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>SKU</t></is></c><c r="B5" t="inlineStr"><is><t>${escapeXml(item.sku || "-")}</t></is></c></row>
    <row r="6"><c r="A6" t="inlineStr"><is><t>Human Approval Required</t></is></c><c r="B6" t="inlineStr"><is><t>YES (Strict Local Policy)</t></is></c></row>
  </sheetData>
</worksheet>`;

  // Sheet 5: Export Information
  const now = new Date().toISOString();
  const sheet5Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>AUDIT FIELD</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Generated At (UTC)</t></is></c><c r="B2" t="inlineStr"><is><t>${now}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Source Database</t></is></c><c r="B3" t="inlineStr"><is><t>Local SQLite Cache (Zero Zoho Mutations)</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Security Guard</t></is></c><c r="B4" t="inlineStr"><is><t>STRICTLY READ-ONLY (GET Only)</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Precision Architecture</t></is></c><c r="B5" t="inlineStr"><is><t>Full raw float precision internally, Max 3 decimals display</t></is></c></row>
  </sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Purchase Bill Lines" sheetId="2" r:id="rId2"/>
    <sheet name="Sales Invoice Lines" sheetId="3" r:id="rId3"/>
    <sheet name="Exclusion Audit" sheetId="4" r:id="rId4"/>
    <sheet name="Export Information" sheetId="5" r:id="rId5"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
    { path: "xl/worksheets/sheet3.xml", data: Buffer.from(sheet3Xml, "utf-8") },
    { path: "xl/worksheets/sheet4.xml", data: Buffer.from(sheet4Xml, "utf-8") },
    { path: "xl/worksheets/sheet5.xml", data: Buffer.from(sheet5Xml, "utf-8") },
  ];

  return packZip(entries);
}

/**
 * Builds Global Full Breakdown Workbook with 7 sheets (Section 25).
 * Sheets:
 * 1. Breakdown Summary
 * 2. Purchase Bill Lines
 * 3. Sales Invoice Lines
 * 4. Customer-Item Reconciliation
 * 5. Customer Details Missing
 * 6. Excluded Items
 * 7. Export Information
 */
export function buildGlobalBreakdownExcel(
  report: MasterInventoryMismatchReportResult,
  exclusions: Record<string, unknown>[] = [],
  options?: ExportOptions
): Buffer {
  const stylesXml = buildStylesXml();

  // Sheet 1: Breakdown Summary
  const sheet1Xml = buildMasterMismatchInfoXml(report);

  // Sheet 2: Purchase Bill Lines (Unique source lines)
  let pRowsXml = `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Bill No</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Date</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Vendor Name</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Customer Details</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Item / Service</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Quantity</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Rate</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Amount</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Classification</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Customer Data Status</t></is></c>
  </row>`;
  let pTotQty = 0;
  let pTotAmt = 0;
  (report.rawPurchaseLines || []).forEach((l, idx) => {
    const r = idx + 2;
    pTotQty += l.quantity || 0;
    pTotAmt += l.amount || 0;
    const formattedDate = formatDisplayDate(l.date);
    const classification = (l.itemName && l.itemName.toUpperCase().includes("ELECTRICAL, INSTALLATION")) ? "SERVICE" : "MATERIAL";
    pRowsXml += `<row r="${r}">
      <c r="A${r}"><v>${idx + 1}</v></c>
      <c r="B${r}" t="inlineStr" s="3"><is><t>${escapeXml(l.docNumber || "-")}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml(formattedDate)}</t></is></c>
      <c r="D${r}" t="inlineStr"><is><t>${escapeXml(l.vendorName || "-")}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t>${escapeXml(l.purchaseCustomerDetails || "CUSTOMER DETAILS MISSING")}</t></is></c>
      <c r="F${r}" t="inlineStr"><is><t>${escapeXml(l.itemName || "-")}</t></is></c>
      <c r="G${r}" t="inlineStr"><is><t>${escapeXml(l.sku || "-")}</t></is></c>
      <c r="H${r}" s="5"><v>${round3(l.quantity || 0)}</v></c>
      <c r="I${r}" s="6"><v>${round2(l.rate || 0)}</v></c>
      <c r="J${r}" s="6"><v>${round2(l.amount || 0)}</v></c>
      <c r="K${r}" t="inlineStr"><is><t>${classification}</t></is></c>
      <c r="L${r}" t="inlineStr"><is><t>${escapeXml(l.customerDataStatus || "VERIFIED")}</t></is></c>
    </row>`;
  });
  const pTotR = (report.rawPurchaseLines?.length || 0) + 2;
  if (options?.includeTotals !== false) {
    pRowsXml += `<row r="${pTotR}">
      <c r="A${pTotR}" t="inlineStr" s="2"><is><t>TOTAL</t></is></c>
      <c r="B${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="C${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="D${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="E${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="F${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="G${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="H${pTotR}" s="5"><v>${round3(pTotQty)}</v></c>
      <c r="I${pTotR}" t="inlineStr"><is><t>-</t></is></c>
      <c r="J${pTotR}" s="6"><v>${round2(pTotAmt)}</v></c>
      <c r="K${pTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="L${pTotR}" t="inlineStr"><is><t></t></is></c>
    </row>`;
  }
  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${pRowsXml}</sheetData>
  <autoFilter ref="A1:L${pTotR - 1}"/>
</worksheet>`;

  // Sheet 3: Sales Invoice Lines (Unique source lines)
  let sRowsXml = `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Invoice No</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Date</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Item / Service</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Quantity</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Rate</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Amount</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Classification</t></is></c>
  </row>`;
  let sTotQty = 0;
  let sTotAmt = 0;
  (report.rawSalesLines || []).forEach((l, idx) => {
    const r = idx + 2;
    sTotQty += l.quantity || 0;
    sTotAmt += l.amount || 0;
    const formattedDate = formatDisplayDate(l.date);
    const classification = (l.itemName && l.itemName.toUpperCase().includes("ELECTRICAL, INSTALLATION")) ? "SERVICE" : "MATERIAL";
    sRowsXml += `<row r="${r}">
      <c r="A${r}"><v>${idx + 1}</v></c>
      <c r="B${r}" t="inlineStr" s="3"><is><t>${escapeXml(l.docNumber || "-")}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml(formattedDate)}</t></is></c>
      <c r="D${r}" t="inlineStr"><is><t>${escapeXml(l.customerName || "-")}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t>${escapeXml(l.itemName || "-")}</t></is></c>
      <c r="F${r}" t="inlineStr"><is><t>${escapeXml(l.sku || "-")}</t></is></c>
      <c r="G${r}" s="5"><v>${round3(l.quantity || 0)}</v></c>
      <c r="H${r}" s="6"><v>${round2(l.rate || 0)}</v></c>
      <c r="I${r}" s="6"><v>${round2(l.amount || 0)}</v></c>
      <c r="J${r}" t="inlineStr"><is><t>${classification}</t></is></c>
    </row>`;
  });
  const sTotR = (report.rawSalesLines?.length || 0) + 2;
  if (options?.includeTotals !== false) {
    sRowsXml += `<row r="${sTotR}">
      <c r="A${sTotR}" t="inlineStr" s="2"><is><t>TOTAL</t></is></c>
      <c r="B${sTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="C${sTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="D${sTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="E${sTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="F${sTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="G${sTotR}" s="5"><v>${round3(sTotQty)}</v></c>
      <c r="H${sTotR}" t="inlineStr"><is><t>-</t></is></c>
      <c r="I${sTotR}" s="6"><v>${round2(sTotAmt)}</v></c>
      <c r="J${sTotR}" t="inlineStr"><is><t></t></is></c>
    </row>`;
  }
  const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sRowsXml}</sheetData>
  <autoFilter ref="A1:J${sTotR - 1}"/>
</worksheet>`;

  // Sheet 4: Customer-Item Reconciliation
  const sheet4Xml = buildCustomerItemMismatchTableXml(report.items.length > 0 ? report.items : report.allMismatches);

  // Sheet 5: Customer Details Missing
  const sheet5Xml = buildCustomerDetailsMissingTableXml(report.customerDetailsMissing || []);

  // Sheet 6: Excluded Items
  let exRowsXml = `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Item Name</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Reason</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Financial Year</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Status</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Approved By</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Remarks</t></is></c>
  </row>`;
  exclusions.forEach((ex, idx) => {
    const r = idx + 2;
    exRowsXml += `<row r="${r}">
      <c r="A${r}"><v>${idx + 1}</v></c>
      <c r="B${r}" t="inlineStr"><is><t>${escapeXml((ex.customer_name as string) || "All Customers (Global)")}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml((ex.item_name as string) || "-")}</t></is></c>
      <c r="D${r}" t="inlineStr"><is><t>${escapeXml((ex.reason as string) || "-")}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t>${escapeXml((ex.financial_year as string) || "All FY")}</t></is></c>
      <c r="F${r}" t="inlineStr"><is><t>${escapeXml((ex.status as string) || "ACTIVE")}</t></is></c>
      <c r="G${r}" t="inlineStr"><is><t>${escapeXml((ex.approved_by as string) || "-")}</t></is></c>
      <c r="H${r}" t="inlineStr"><is><t>${escapeXml((ex.notes as string) || "-")}</t></is></c>
    </row>`;
  });
  const sheet6Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${exRowsXml}</sheetData>
</worksheet>`;

  // Sheet 7: Service Transactions
  const serviceLines = (report.transactionLines || []).filter(tx => tx.classification === "SERVICE");
  let svcRowsXml = `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Type</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Date</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Customer</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Vendor</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Document No</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Service Name</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Qty</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Rate</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Amount</t></is></c>
  </row>`;
  let svcTotAmt = 0;
  serviceLines.forEach((tx, idx) => {
    const r = idx + 2;
    svcTotAmt += tx.amount || 0;
    svcRowsXml += `<row r="${r}">
      <c r="A${r}"><v>${idx + 1}</v></c>
      <c r="B${r}" t="inlineStr"><is><t>${escapeXml(tx.type || "-")}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml(formatDisplayDate(tx.date))}</t></is></c>
      <c r="D${r}" t="inlineStr"><is><t>${escapeXml(tx.customerName || "-")}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t>${escapeXml(tx.vendorName || "-")}</t></is></c>
      <c r="F${r}" t="inlineStr" s="3"><is><t>${escapeXml(tx.docNumber || "-")}</t></is></c>
      <c r="G${r}" t="inlineStr"><is><t>${escapeXml(tx.itemName || "-")}</t></is></c>
      <c r="H${r}" s="5"><v>${round3(tx.quantity || 0)}</v></c>
      <c r="I${r}" s="6"><v>${round2(tx.rate || 0)}</v></c>
      <c r="J${r}" s="6"><v>${round2(tx.amount || 0)}</v></c>
    </row>`;
  });
  const svcTotR = serviceLines.length + 2;
  if (options?.includeTotals !== false && serviceLines.length > 0) {
    svcRowsXml += `<row r="${svcTotR}">
      <c r="A${svcTotR}" t="inlineStr" s="2"><is><t>TOTAL</t></is></c>
      <c r="B${svcTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="C${svcTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="D${svcTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="E${svcTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="F${svcTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="G${svcTotR}" t="inlineStr"><is><t></t></is></c>
      <c r="H${svcTotR}" t="inlineStr"><is><t>-</t></is></c>
      <c r="I${svcTotR}" t="inlineStr"><is><t>-</t></is></c>
      <c r="J${svcTotR}" s="6"><v>${round2(svcTotAmt)}</v></c>
    </row>`;
  }
  const sheet7Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${svcRowsXml}</sheetData>
  <autoFilter ref="A1:J${Math.max(1, svcTotR - 1)}"/>
</worksheet>`;

  // Sheet 8: Export Information
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
  const sheet8Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>FIELD</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>DETAILS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Report</t></is></c><c r="B2" t="inlineStr"><is><t>Global Breakdown Report (8 Sheets)</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Generated At</t></is></c><c r="B3" t="inlineStr"><is><t>${now}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Security Guard</t></is></c><c r="B4" t="inlineStr"><is><t>STRICTLY READ-ONLY · Zero Zoho API Calls</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Precision</t></is></c><c r="B5" t="inlineStr"><is><t>Full internal SQLite source precision</t></is></c></row>
  </sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet8.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet8.xml"/>
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Breakdown Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Purchase Bill Lines" sheetId="2" r:id="rId2"/>
    <sheet name="Sales Invoice Lines" sheetId="3" r:id="rId3"/>
    <sheet name="Customer-Item Reconciliation" sheetId="4" r:id="rId4"/>
    <sheet name="Customer Details Missing" sheetId="5" r:id="rId5"/>
    <sheet name="Excluded Items" sheetId="6" r:id="rId6"/>
    <sheet name="Service Transactions" sheetId="7" r:id="rId7"/>
    <sheet name="Export Information" sheetId="8" r:id="rId8"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
    { path: "xl/worksheets/sheet3.xml", data: Buffer.from(sheet3Xml, "utf-8") },
    { path: "xl/worksheets/sheet4.xml", data: Buffer.from(sheet4Xml, "utf-8") },
    { path: "xl/worksheets/sheet5.xml", data: Buffer.from(sheet5Xml, "utf-8") },
    { path: "xl/worksheets/sheet6.xml", data: Buffer.from(sheet6Xml, "utf-8") },
    { path: "xl/worksheets/sheet7.xml", data: Buffer.from(sheet7Xml, "utf-8") },
    { path: "xl/worksheets/sheet8.xml", data: Buffer.from(sheet8Xml, "utf-8") },
  ];

  return packZip(entries);
}

/**
 * Builds professional Excel workbook for Price Reference.
 */
export function buildPriceReferenceExcel(result: {
  stats: any;
  history: any[];
  appliedFilter: any;
}): Buffer {
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="₹#,##,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##,##0.000"/>
    <numFmt numFmtId="166" formatCode="DD/MM/YYYY"/>
  </numFmts>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

  const stats = result.stats || {};
  const filter = result.appliedFilter || {};

  // Sheet 1: Summary Statistics
  const s1Rows = `
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>METRIC / KPI</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c><c r="C1" t="inlineStr" s="1"><is><t>EVIDENCE / BASIS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr" s="3"><is><t>Financial Year / Period</t></is></c><c r="B2" t="inlineStr"><is><t>${escapeXml(filter.financialYear || "FY2026-27")}</t></is></c><c r="C2" t="inlineStr"><is><t>${filter.fromDate && filter.toDate ? `${filter.fromDate} to ${filter.toDate}` : "Full FY Period"}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr" s="3"><is><t>Price Type Filter</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(filter.priceType || "Purchase + Sales")}</t></is></c><c r="C3" t="inlineStr"><is><t></t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr" s="2"><is><t>PURCHASE LATEST PRICE</t></is></c><c r="B4" s="6"><v>${stats.latest_purchase?.effective_rate ?? 0}</v></c><c r="C4" t="inlineStr"><is><t>${escapeXml(stats.latest_purchase?.evidence ? `Bill: ${stats.latest_purchase.evidence.document_number} (${stats.latest_purchase.evidence.date}) - Qty: ${stats.latest_purchase.evidence.quantity}` : "N/A")}</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr" s="2"><is><t>PURCHASE LOWEST PRICE</t></is></c><c r="B5" s="6"><v>${stats.lowest_purchase?.effective_rate ?? 0}</v></c><c r="C5" t="inlineStr"><is><t>${escapeXml(stats.lowest_purchase?.evidence ? `Bill: ${stats.lowest_purchase.evidence.document_number} (${stats.lowest_purchase.evidence.date})` : "N/A")}</t></is></c></row>
    <row r="6"><c r="A6" t="inlineStr" s="2"><is><t>PURCHASE HIGHEST PRICE</t></is></c><c r="B6" s="6"><v>${stats.highest_purchase?.effective_rate ?? 0}</v></c><c r="C6" t="inlineStr"><is><t>${escapeXml(stats.highest_purchase?.evidence ? `Bill: ${stats.highest_purchase.evidence.document_number} (${stats.highest_purchase.evidence.date})` : "N/A")}</t></is></c></row>
    <row r="7"><c r="A7" t="inlineStr" s="2"><is><t>PURCHASE WEIGHTED AVG</t></is></c><c r="B7" s="6"><v>${stats.weighted_avg_purchase ?? 0}</v></c><c r="C7" t="inlineStr"><is><t>${stats.purchase_transactions_count ?? 0} lines / ${stats.purchase_distinct_docs_count ?? 0} bills (Total Qty: ${stats.purchase_total_qty ?? 0})</t></is></c></row>
    <row r="8"><c r="A8" t="inlineStr" s="2"><is><t>SALES LATEST PRICE</t></is></c><c r="B8" s="6"><v>${stats.latest_sales?.effective_rate ?? 0}</v></c><c r="C8" t="inlineStr"><is><t>${escapeXml(stats.latest_sales?.evidence ? `Inv: ${stats.latest_sales.evidence.document_number} (${stats.latest_sales.evidence.date}) - Qty: ${stats.latest_sales.evidence.quantity}` : "N/A")}</t></is></c></row>
    <row r="9"><c r="A9" t="inlineStr" s="2"><is><t>SALES LOWEST PRICE</t></is></c><c r="B9" s="6"><v>${stats.lowest_sales?.effective_rate ?? 0}</v></c><c r="C9" t="inlineStr"><is><t>${escapeXml(stats.lowest_sales?.evidence ? `Inv: ${stats.lowest_sales.evidence.document_number} (${stats.lowest_sales.evidence.date})` : "N/A")}</t></is></c></row>
    <row r="10"><c r="A10" t="inlineStr" s="2"><is><t>SALES HIGHEST PRICE</t></is></c><c r="B10" s="6"><v>${stats.highest_sales?.effective_rate ?? 0}</v></c><c r="C10" t="inlineStr"><is><t>${escapeXml(stats.highest_sales?.evidence ? `Inv: ${stats.highest_sales.evidence.document_number} (${stats.highest_sales.evidence.date})` : "N/A")}</t></is></c></row>
    <row r="11"><c r="A11" t="inlineStr" s="2"><is><t>SALES WEIGHTED AVG</t></is></c><c r="B11" s="6"><v>${stats.weighted_avg_sales ?? 0}</v></c><c r="C11" t="inlineStr"><is><t>${stats.sales_transactions_count ?? 0} lines / ${stats.sales_distinct_docs_count ?? 0} invoices (Total Qty: ${stats.sales_total_qty ?? 0})</t></is></c></row>
    <row r="12"><c r="A12" t="inlineStr" s="3"><is><t>Gross Price Spread</t></is></c><c r="B12" s="6"><v>${stats.gross_price_spread ?? 0}</v></c><c r="C12" t="inlineStr"><is><t>Latest Sales Effective Rate - Latest Purchase Effective Rate (Reference Only)</t></is></c></row>
    <row r="13"><c r="A13" t="inlineStr" s="3"><is><t>Latest Markup %</t></is></c><c r="B13" t="inlineStr"><is><t>${stats.markup_percentage !== null && stats.markup_percentage !== undefined ? `${stats.markup_percentage}%` : "N/A"}</t></is></c><c r="C13" t="inlineStr"><is><t>Reference Decision-Support Metric</t></is></c></row>
  `;
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${s1Rows}</sheetData>
</worksheet>`;

  // Sheet 2: Evidence History
  let hRows = `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>SR</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>DATE</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>TYPE</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>DOCUMENT NO.</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>ITEM NAME</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>DESCRIPTION</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>VENDOR / CUSTOMER</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>QUANTITY</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>SOURCE RATE</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>EFFECTIVE NET RATE</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>TAXABLE VALUE</t></is></c>
  </row>`;

  (result.history || []).forEach((row, i) => {
    const r = i + 2;
    const isP = row.document_type === "PURCHASE";
    const party = isP ? (row.vendor_name || "-") : (row.customer_name || "-");
    hRows += `<row r="${r}">
      <c r="A${r}" t="inlineStr" s="4"><is><t>${i + 1}</t></is></c>
      <c r="B${r}" t="inlineStr" s="4"><is><t>${escapeXml(row.date)}</t></is></c>
      <c r="C${r}" t="inlineStr" s="3"><is><t>${row.document_type}</t></is></c>
      <c r="D${r}" t="inlineStr" s="3"><is><t>${escapeXml(row.document_number)}</t></is></c>
      <c r="E${r}" t="inlineStr" s="4"><is><t>${escapeXml(row.item_name)}</t></is></c>
      <c r="F${r}" t="inlineStr" s="4"><is><t>${escapeXml(row.description || "-")}</t></is></c>
      <c r="G${r}" t="inlineStr" s="4"><is><t>${escapeXml(row.sku || "-")}</t></is></c>
      <c r="H${r}" t="inlineStr" s="4"><is><t>${escapeXml(party)}</t></is></c>
      <c r="I${r}" s="5"><v>${row.quantity}</v></c>
      <c r="J${r}" s="6"><v>${row.source_rate}</v></c>
      <c r="K${r}" s="6"><v>${row.effective_rate}</v></c>
      <c r="L${r}" s="6"><v>${row.taxable_amount}</v></c>
    </row>`;
  });

  const hTotR = (result.history?.length || 0) + 2;
  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView tabSelected="0" workbookViewId="0"/></sheetViews>
  <sheetData>${hRows}</sheetData>
  <autoFilter ref="A1:L${hTotR - 1}"/>
</worksheet>`;

  // Sheet 3: Export Information
  const now = new Date().toISOString();
  const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>AUDIT FIELD</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Generated At (UTC)</t></is></c><c r="B2" t="inlineStr"><is><t>${now}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Source Database</t></is></c><c r="B3" t="inlineStr"><is><t>Local SQLite Cache (Zero Zoho Mutations)</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Security Guard</t></is></c><c r="B4" t="inlineStr"><is><t>STRICTLY READ-ONLY (GET Only)</t></is></c></row>
  </sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Summary Statistics" sheetId="1" r:id="rId1"/>
    <sheet name="Price Evidence History" sheetId="2" r:id="rId2"/>
    <sheet name="Export Information" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
    { path: "xl/worksheets/sheet3.xml", data: Buffer.from(sheet3Xml, "utf-8") },
  ];

  return packZip(entries);
}

/**
 * Builds a multi-sheet Excel report for Customer 360 / Customer Details.
 */
export async function buildCustomerDetailsExcel(data: any): Promise<Buffer> {
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="₹#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0.000"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Segoe UI"/></font>
    <font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
</styleSheet>`;

  const cust = data.customer || {};
  const kpis = data.kpis || {};
  const period = data.period || {};
  const salesInvoices = data.salesInvoices || [];
  const purchaseBills = data.purchaseBills || [];
  const itemAnalysis = data.itemAnalysis || [];
  const recon = data.reconciliation || {};

  // Sheet 1: Customer Summary
  const s1Rows = `
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>CUSTOMER 360 PROFILE</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>DETAILS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr" s="2"><is><t>Customer Name</t></is></c><c r="B2" t="inlineStr"><is><t>${escapeXml(cust.name || "—")}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr" s="2"><is><t>Customer ID</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(cust.id || "—")}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr" s="2"><is><t>GSTIN</t></is></c><c r="B4" t="inlineStr"><is><t>${escapeXml(cust.gstin || "—")}</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr" s="2"><is><t>Financial Period</t></is></c><c r="B5" t="inlineStr"><is><t>${escapeXml(period.financialYear || "FY2026-27")} (${escapeXml(period.fromDate || "")} to ${escapeXml(period.toDate || "")})</t></is></c></row>
    <row r="6"><c r="A6" t="inlineStr" s="2"><is><t>Data Source</t></is></c><c r="B6" t="inlineStr"><is><t>Local SQLite Cache (Read-Only)</t></is></c></row>
    <row r="7"><c r="A7" t="inlineStr"><is><t></t></is></c><c r="B7" t="inlineStr"><is><t></t></is></c></row>
    <row r="8"><c r="A8" t="inlineStr" s="1"><is><t>FINANCIAL / OPERATIONAL KPI</t></is></c><c r="B8" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="9"><c r="A9" t="inlineStr" s="2"><is><t>Sales Taxable Value (Before GST)</t></is></c><c r="B9" s="6"><v>${kpis.salesTaxableValue ?? 0}</v></c></row>
    <row r="10"><c r="A10" t="inlineStr" s="2"><is><t>Purchase Taxable Value (Before GST)</t></is></c><c r="B10" s="6"><v>${kpis.purchaseTaxableValue ?? 0}</v></c></row>
    <row r="11"><c r="A11" t="inlineStr" s="2"><is><t>Commercial Value Spread (Sales - Purchase)</t></is></c><c r="B11" s="6"><v>${kpis.commercialValueSpread ?? 0}</v></c></row>
    <row r="12"><c r="A12" t="inlineStr" s="2"><is><t>Sales Invoice Count</t></is></c><c r="B12" s="4"><v>${kpis.salesInvoiceCount ?? 0}</v></c></row>
    <row r="13"><c r="A13" t="inlineStr" s="2"><is><t>Purchase Bill Count (Customer Lines)</t></is></c><c r="B13" s="4"><v>${kpis.purchaseBillCount ?? 0}</v></c></row>
    <row r="14"><c r="A14" t="inlineStr" s="2"><is><t>Total Sales Quantity</t></is></c><c r="B14" s="5"><v>${kpis.salesQty ?? 0}</v></c></row>
    <row r="15"><c r="A15" t="inlineStr" s="2"><is><t>Total Purchase Quantity</t></is></c><c r="B15" s="5"><v>${kpis.purchaseQty ?? 0}</v></c></row>
    <row r="16"><c r="A16" t="inlineStr" s="2"><is><t>Sales Receivable Balance</t></is></c><c r="B16" s="6"><v>${kpis.salesBalanceReceivable ?? 0}</v></c></row>
    <row r="17"><c r="A17" t="inlineStr" s="2"><is><t>Purchase Payable Balance</t></is></c><c r="B17" s="6"><v>${kpis.purchaseBalancePayable ?? 0}</v></c></row>
  `;

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="45" customWidth="1"/>
    <col min="2" max="2" width="35" customWidth="1"/>
  </cols>
  <sheetData>${s1Rows}</sheetData>
</worksheet>`;

  // Sheet 2: Sales Invoices
  let s2Rows = `
    <row r="1">
      <c r="A1" t="inlineStr" s="1"><is><t>Sr.</t></is></c>
      <c r="B1" t="inlineStr" s="1"><is><t>Date</t></is></c>
      <c r="C1" t="inlineStr" s="1"><is><t>Invoice No.</t></is></c>
      <c r="D1" t="inlineStr" s="1"><is><t>Due Date</t></is></c>
      <c r="E1" t="inlineStr" s="1"><is><t>Status</t></is></c>
      <c r="F1" t="inlineStr" s="1"><is><t>Items</t></is></c>
      <c r="G1" t="inlineStr" s="1"><is><t>Qty</t></is></c>
      <c r="H1" t="inlineStr" s="1"><is><t>Taxable Value (Pre-GST)</t></is></c>
      <c r="I1" t="inlineStr" s="1"><is><t>Grand Total</t></is></c>
      <c r="J1" t="inlineStr" s="1"><is><t>Balance</t></is></c>
    </row>
  `;
  salesInvoices.forEach((inv: any, i: number) => {
    const r = i + 2;
    s2Rows += `
      <row r="${r}">
        <c r="A${r}" t="inlineStr" s="4"><is><t>${i + 1}</t></is></c>
        <c r="B${r}" t="inlineStr"><is><t>${escapeXml(inv.date || "")}</t></is></c>
        <c r="C${r}" t="inlineStr" s="2"><is><t>${escapeXml(inv.invoice_number || "")}</t></is></c>
        <c r="D${r}" t="inlineStr"><is><t>${escapeXml(inv.due_date || "—")}</t></is></c>
        <c r="E${r}" t="inlineStr"><is><t>${escapeXml(inv.status || "")}</t></is></c>
        <c r="F${r}" s="4"><v>${inv.item_count ?? 0}</v></c>
        <c r="G${r}" s="5"><v>${inv.total_qty ?? 0}</v></c>
        <c r="H${r}" s="6"><v>${inv.taxable_value ?? 0}</v></c>
        <c r="I${r}" s="6"><v>${inv.grand_total ?? 0}</v></c>
        <c r="J${r}" s="6"><v>${inv.balance ?? 0}</v></c>
      </row>
    `;
  });

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="22" customWidth="1"/>
    <col min="4" max="4" width="14" customWidth="1"/>
    <col min="5" max="5" width="14" customWidth="1"/>
    <col min="6" max="6" width="10" customWidth="1"/>
    <col min="7" max="7" width="14" customWidth="1"/>
    <col min="8" max="8" width="22" customWidth="1"/>
    <col min="9" max="9" width="20" customWidth="1"/>
    <col min="10" max="10" width="20" customWidth="1"/>
  </cols>
  <sheetData>${s2Rows}</sheetData>
</worksheet>`;

  // Sheet 3: Purchase Bills
  let s3Rows = `
    <row r="1">
      <c r="A1" t="inlineStr" s="1"><is><t>Sr.</t></is></c>
      <c r="B1" t="inlineStr" s="1"><is><t>Date</t></is></c>
      <c r="C1" t="inlineStr" s="1"><is><t>Bill No.</t></is></c>
      <c r="D1" t="inlineStr" s="1"><is><t>Vendor Name</t></is></c>
      <c r="E1" t="inlineStr" s="1"><is><t>Status</t></is></c>
      <c r="F1" t="inlineStr" s="1"><is><t>Matching Items</t></is></c>
      <c r="G1" t="inlineStr" s="1"><is><t>Matching Qty</t></is></c>
      <c r="H1" t="inlineStr" s="1"><is><t>Customer Taxable (Pre-GST)</t></is></c>
      <c r="I1" t="inlineStr" s="1"><is><t>Source Bill Total</t></is></c>
      <c r="J1" t="inlineStr" s="1"><is><t>Source Balance</t></is></c>
    </row>
  `;
  purchaseBills.forEach((b: any, i: number) => {
    const r = i + 2;
    s3Rows += `
      <row r="${r}">
        <c r="A${r}" t="inlineStr" s="4"><is><t>${i + 1}</t></is></c>
        <c r="B${r}" t="inlineStr"><is><t>${escapeXml(b.date || "")}</t></is></c>
        <c r="C${r}" t="inlineStr" s="2"><is><t>${escapeXml(b.bill_number || "")}</t></is></c>
        <c r="D${r}" t="inlineStr"><is><t>${escapeXml(b.vendor_name || "")}</t></is></c>
        <c r="E${r}" t="inlineStr"><is><t>${escapeXml(b.status || "")}</t></is></c>
        <c r="F${r}" s="4"><v>${b.matching_item_count ?? 0}</v></c>
        <c r="G${r}" s="5"><v>${b.matching_qty ?? 0}</v></c>
        <c r="H${r}" s="6"><v>${b.customer_taxable_value ?? 0}</v></c>
        <c r="I${r}" s="6"><v>${b.source_grand_total ?? 0}</v></c>
        <c r="J${r}" s="6"><v>${b.source_balance ?? 0}</v></c>
      </row>
    `;
  });

  const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="22" customWidth="1"/>
    <col min="4" max="4" width="30" customWidth="1"/>
    <col min="5" max="5" width="14" customWidth="1"/>
    <col min="6" max="6" width="16" customWidth="1"/>
    <col min="7" max="7" width="16" customWidth="1"/>
    <col min="8" max="8" width="24" customWidth="1"/>
    <col min="9" max="9" width="20" customWidth="1"/>
    <col min="10" max="10" width="20" customWidth="1"/>
  </cols>
  <sheetData>${s3Rows}</sheetData>
</worksheet>`;

  // Sheet 4: Item Analysis
  let s4Rows = `
    <row r="1">
      <c r="A1" t="inlineStr" s="1"><is><t>Sr.</t></is></c>
      <c r="B1" t="inlineStr" s="1"><is><t>Item Name</t></is></c>
      <c r="C1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
      <c r="D1" t="inlineStr" s="1"><is><t>Purchase Qty</t></is></c>
      <c r="E1" t="inlineStr" s="1"><is><t>Purchase Taxable</t></is></c>
      <c r="F1" t="inlineStr" s="1"><is><t>Purchase Avg Rate</t></is></c>
      <c r="G1" t="inlineStr" s="1"><is><t>Latest Purchase Rate</t></is></c>
      <c r="H1" t="inlineStr" s="1"><is><t>Sales Qty</t></is></c>
      <c r="I1" t="inlineStr" s="1"><is><t>Sales Taxable</t></is></c>
      <c r="J1" t="inlineStr" s="1"><is><t>Sales Avg Rate</t></is></c>
      <c r="K1" t="inlineStr" s="1"><is><t>Latest Sales Rate</t></is></c>
      <c r="L1" t="inlineStr" s="1"><is><t>Balance Qty</t></is></c>
      <c r="M1" t="inlineStr" s="1"><is><t>Yet to Purchase</t></is></c>
      <c r="N1" t="inlineStr" s="1"><is><t>Yet to Sale</t></is></c>
      <c r="O1" t="inlineStr" s="1"><is><t>Reconciled Qty</t></is></c>
    </row>
  `;
  itemAnalysis.forEach((it: any, i: number) => {
    const r = i + 2;
    s4Rows += `
      <row r="${r}">
        <c r="A${r}" t="inlineStr" s="4"><is><t>${i + 1}</t></is></c>
        <c r="B${r}" t="inlineStr" s="2"><is><t>${escapeXml(it.item_name || "")}</t></is></c>
        <c r="C${r}" t="inlineStr"><is><t>${escapeXml(it.sku || "—")}</t></is></c>
        <c r="D${r}" s="5"><v>${it.purchase_qty ?? 0}</v></c>
        <c r="E${r}" s="6"><v>${it.purchase_taxable ?? 0}</v></c>
        <c r="F${r}" s="6"><v>${it.purchase_avg_rate ?? 0}</v></c>
        <c r="G${r}" s="6"><v>${it.latest_purchase_rate ?? 0}</v></c>
        <c r="H${r}" s="5"><v>${it.sales_qty ?? 0}</v></c>
        <c r="I${r}" s="6"><v>${it.sales_taxable ?? 0}</v></c>
        <c r="J${r}" s="6"><v>${it.sales_avg_rate ?? 0}</v></c>
        <c r="K${r}" s="6"><v>${it.latest_sales_rate ?? 0}</v></c>
        <c r="L${r}" s="5"><v>${it.balance_qty ?? 0}</v></c>
        <c r="M${r}" s="5"><v>${it.yet_to_purchase ?? 0}</v></c>
        <c r="N${r}" s="5"><v>${it.yet_to_sale ?? 0}</v></c>
        <c r="O${r}" s="5"><v>${it.reconciled_qty ?? 0}</v></c>
      </row>
    `;
  });

  const sheet4Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="30" customWidth="1"/>
    <col min="3" max="3" width="16" customWidth="1"/>
    <col min="4" max="4" width="14" customWidth="1"/>
    <col min="5" max="5" width="18" customWidth="1"/>
    <col min="6" max="6" width="18" customWidth="1"/>
    <col min="7" max="7" width="18" customWidth="1"/>
    <col min="8" max="8" width="14" customWidth="1"/>
    <col min="9" max="9" width="18" customWidth="1"/>
    <col min="10" max="10" width="18" customWidth="1"/>
    <col min="11" max="11" width="18" customWidth="1"/>
    <col min="12" max="12" width="14" customWidth="1"/>
    <col min="13" max="13" width="16" customWidth="1"/>
    <col min="14" max="14" width="14" customWidth="1"/>
    <col min="15" max="15" width="16" customWidth="1"/>
  </cols>
  <sheetData>${s4Rows}</sheetData>
</worksheet>`;

  // Sheet 5: Reconciliation
  const s5Rows = `
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>RECONCILIATION METRIC</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr" s="2"><is><t>Total Items Count</t></is></c><c r="B2" s="4"><v>${recon.items_count ?? 0}</v></c></row>
    <row r="3"><c r="A3" t="inlineStr" s="2"><is><t>Items with Mismatch</t></is></c><c r="B3" s="4"><v>${recon.mismatch_count ?? 0}</v></c></row>
    <row r="4"><c r="A4" t="inlineStr" s="2"><is><t>Total Purchase Qty</t></is></c><c r="B4" s="5"><v>${recon.purchase_qty ?? 0}</v></c></row>
    <row r="5"><c r="A5" t="inlineStr" s="2"><is><t>Total Sales Qty</t></is></c><c r="B5" s="5"><v>${recon.sales_qty ?? 0}</v></c></row>
    <row r="6"><c r="A6" t="inlineStr" s="2"><is><t>Net Balance Qty</t></is></c><c r="B6" s="5"><v>${recon.balance_qty ?? 0}</v></c></row>
    <row r="7"><c r="A7" t="inlineStr" s="2"><is><t>Yet to Purchase Qty (Shortage)</t></is></c><c r="B7" s="5"><v>${recon.yet_to_purchase_qty ?? 0}</v></c></row>
    <row r="8"><c r="A8" t="inlineStr" s="2"><is><t>Yet to Sale Qty (Surplus)</t></is></c><c r="B8" s="5"><v>${recon.yet_to_sale_qty ?? 0}</v></c></row>
    <row r="9"><c r="A9" t="inlineStr" s="2"><is><t>Reconciled Qty</t></is></c><c r="B9" s="5"><v>${recon.reconciled_qty ?? 0}</v></c></row>
    <row r="10"><c r="A10" t="inlineStr" s="2"><is><t>Approx Shortage Value (Latest Purchase Rate)</t></is></c><c r="B10" s="6"><v>${recon.approx_shortage_value ?? 0}</v></c></row>
    <row r="11"><c r="A11" t="inlineStr" s="2"><is><t>Approx Surplus Value (Latest Purchase Rate)</t></is></c><c r="B11" s="6"><v>${recon.approx_surplus_value ?? 0}</v></c></row>
  `;

  const sheet5Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="45" customWidth="1"/>
    <col min="2" max="2" width="30" customWidth="1"/>
  </cols>
  <sheetData>${s5Rows}</sheetData>
</worksheet>`;

  // Sheet 6: Sales Orders Notice
  const sheet6Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>SALES ORDERS</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>STATUS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Sales Order Data</t></is></c><c r="B2" t="inlineStr"><is><t>Sales Order data is not available in the current local cache.</t></is></c></row>
  </sheetData>
</worksheet>`;

  // Sheet 7: Purchase Orders Notice
  const sheet7Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>PURCHASE ORDERS</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>STATUS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Purchase Order Data</t></is></c><c r="B2" t="inlineStr"><is><t>Purchase Order data is not available in the current local cache.</t></is></c></row>
  </sheetData>
</worksheet>`;

  // Sheet 8: Audit Information
  const now = new Date().toISOString();
  const sheet8Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>AUDIT FIELD</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Customer ID</t></is></c><c r="B2" t="inlineStr"><is><t>${escapeXml(cust.id || "")}</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Customer Name</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(cust.name || "")}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Generated At (UTC)</t></is></c><c r="B4" t="inlineStr"><is><t>${now}</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Source Database</t></is></c><c r="B5" t="inlineStr"><is><t>Local SQLite Cache (Read-Only)</t></is></c></row>
    <row r="6"><c r="A6" t="inlineStr"><is><t>Security Guard</t></is></c><c r="B6" t="inlineStr"><is><t>STRICTLY READ-ONLY (GET Only)</t></is></c></row>
  </sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet8.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet6.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet8.xml"/>
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Customer Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Sales Invoices" sheetId="2" r:id="rId2"/>
    <sheet name="Purchase Bills" sheetId="3" r:id="rId3"/>
    <sheet name="Item Analysis" sheetId="4" r:id="rId4"/>
    <sheet name="Reconciliation" sheetId="5" r:id="rId5"/>
    <sheet name="Sales Orders" sheetId="6" r:id="rId6"/>
    <sheet name="Purchase Orders" sheetId="7" r:id="rId7"/>
    <sheet name="Audit Metadata" sheetId="8" r:id="rId8"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
    { path: "xl/worksheets/sheet3.xml", data: Buffer.from(sheet3Xml, "utf-8") },
    { path: "xl/worksheets/sheet4.xml", data: Buffer.from(sheet4Xml, "utf-8") },
    { path: "xl/worksheets/sheet5.xml", data: Buffer.from(sheet5Xml, "utf-8") },
    { path: "xl/worksheets/sheet6.xml", data: Buffer.from(sheet6Xml, "utf-8") },
    { path: "xl/worksheets/sheet7.xml", data: Buffer.from(sheet7Xml, "utf-8") },
    { path: "xl/worksheets/sheet8.xml", data: Buffer.from(sheet8Xml, "utf-8") },
  ];

  return packZip(entries);
}

/**
 * Builds Excel Workbook for Customers > Action Taken (Mismatch Action Tracker).
 * Features:
 * - Sheet 1: Customer Action Summary (Status, Priority, Mismatches, Values, Owner, Follow-up, Remarks)
 * - Sheet 2: Mismatch Items Detail (Customer, Item, SKU, Purchase, Sales, Balance, Shortage, Surplus, Rate, Approx Values, Status)
 * - Sheet 3: Action History Audit Trail
 */
export function buildActionTakenExcel(data: {
  kpis: any;
  customers: any[];
  financialYear?: string;
  period?: string;
  statusFilter?: string;
}): Buffer {
  const stylesXml = buildStylesXml();
  const customers = data.customers || [];
  const kpis = data.kpis || {};
  const periodLabel = data.period || data.financialYear || "FY2026-27";

  // Sheet 1: Customer Action Summary
  let s1Rows = "";
  s1Rows += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Customer ID</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Summary Status</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Priority</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Total Items</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Reconciled Items</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Mismatch Items</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Shortage Items</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Surplus Items</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Purchase Only</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Sales Only</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Yet to Purchase Qty</t></is></c>
    <c r="M1" t="inlineStr" s="1"><is><t>Yet to Sale Qty</t></is></c>
    <c r="N1" t="inlineStr" s="1"><is><t>Approx Shortage Value (INR)</t></is></c>
    <c r="O1" t="inlineStr" s="1"><is><t>Approx Surplus Value (INR)</t></is></c>
    <c r="P1" t="inlineStr" s="1"><is><t>Action Status</t></is></c>
    <c r="Q1" t="inlineStr" s="1"><is><t>Action Owner</t></is></c>
    <c r="R1" t="inlineStr" s="1"><is><t>Next Follow-up Date</t></is></c>
    <c r="S1" t="inlineStr" s="1"><is><t>Action Taken / Remarks</t></is></c>
    <c r="T1" t="inlineStr" s="1"><is><t>Last Updated</t></is></c>
  </row>`;

  customers.forEach((c, idx) => {
    const rIdx = idx + 2;
    s1Rows += `<row r="${rIdx}">
      <c r="A${rIdx}" t="inlineStr"><is><t>${escapeXml(c.customer_id || "")}</t></is></c>
      <c r="B${rIdx}" t="inlineStr"><is><t>${escapeXml(c.customer_name || "")}</t></is></c>
      <c r="C${rIdx}" t="inlineStr"><is><t>${escapeXml(c.customer_status || "")}</t></is></c>
      <c r="D${rIdx}" t="inlineStr"><is><t>${escapeXml(c.priority || "MEDIUM")}</t></is></c>
      <c r="E${rIdx}" s="2"><v>${Number(c.total_items || 0)}</v></c>
      <c r="F${rIdx}" s="2"><v>${Number(c.reconciled_items || 0)}</v></c>
      <c r="G${rIdx}" s="2"><v>${Number(c.mismatch_items || 0)}</v></c>
      <c r="H${rIdx}" s="2"><v>${Number(c.shortage_items || 0)}</v></c>
      <c r="I${rIdx}" s="2"><v>${Number(c.surplus_items || 0)}</v></c>
      <c r="J${rIdx}" s="2"><v>${Number(c.purchase_only_items || 0)}</v></c>
      <c r="K${rIdx}" s="2"><v>${Number(c.sales_only_items || 0)}</v></c>
      <c r="L${rIdx}" s="4"><v>${Number(c.total_yet_to_purchase_qty || 0)}</v></c>
      <c r="M${rIdx}" s="4"><v>${Number(c.total_yet_to_sale_qty || 0)}</v></c>
      <c r="N${rIdx}" s="3"><v>${Number(c.approx_shortage_value || 0)}</v></c>
      <c r="O${rIdx}" s="3"><v>${Number(c.approx_surplus_value || 0)}</v></c>
      <c r="P${rIdx}" t="inlineStr"><is><t>${escapeXml(c.action_status || "Open")}</t></is></c>
      <c r="Q${rIdx}" t="inlineStr"><is><t>${escapeXml(c.action_owner || "—")}</t></is></c>
      <c r="R${rIdx}" t="inlineStr"><is><t>${escapeXml(c.next_follow_up_date || "—")}</t></is></c>
      <c r="S${rIdx}" t="inlineStr"><is><t>${escapeXml(c.remarks || c.action_taken || "—")}</t></is></c>
      <c r="T${rIdx}" t="inlineStr"><is><t>${escapeXml(c.last_updated || "—")}</t></is></c>
    </row>`;
  });

  // Grand Total Summary Row (Sheet 1)
  const totCustomerCount = customers.length;
  const totItems = customers.reduce((sum, c) => sum + Number(c.total_items || 0), 0);
  const totReconciled = customers.reduce((sum, c) => sum + Number(c.reconciled_items || 0), 0);
  const totMismatch = customers.reduce((sum, c) => sum + Number(c.mismatch_items || 0), 0);
  const totShortage = customers.reduce((sum, c) => sum + Number(c.shortage_items || 0), 0);
  const totSurplus = customers.reduce((sum, c) => sum + Number(c.surplus_items || 0), 0);
  const totPurchOnly = customers.reduce((sum, c) => sum + Number(c.purchase_only_items || 0), 0);
  const totSalesOnly = customers.reduce((sum, c) => sum + Number(c.sales_only_items || 0), 0);
  const totShortageQty = customers.reduce((sum, c) => sum + Number(c.total_yet_to_purchase_qty || 0), 0);
  const totSurplusQty = customers.reduce((sum, c) => sum + Number(c.total_yet_to_sale_qty || 0), 0);
  const totShortageVal = customers.reduce((sum, c) => sum + Number(c.approx_shortage_value || 0), 0);
  const totSurplusVal = customers.reduce((sum, c) => sum + Number(c.approx_surplus_value || 0), 0);

  const totalRowIdx = customers.length + 2;
  s1Rows += `<row r="${totalRowIdx}">
    <c r="A${totalRowIdx}" t="inlineStr" s="1"><is><t>TOTAL</t></is></c>
    <c r="B${totalRowIdx}" t="inlineStr" s="1"><is><t>GRAND TOTAL (${totCustomerCount} Customers)</t></is></c>
    <c r="C${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="D${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="E${totalRowIdx}" s="2"><v>${totItems}</v></c>
    <c r="F${totalRowIdx}" s="2"><v>${totReconciled}</v></c>
    <c r="G${totalRowIdx}" s="2"><v>${totMismatch}</v></c>
    <c r="H${totalRowIdx}" s="2"><v>${totShortage}</v></c>
    <c r="I${totalRowIdx}" s="2"><v>${totSurplus}</v></c>
    <c r="J${totalRowIdx}" s="2"><v>${totPurchOnly}</v></c>
    <c r="K${totalRowIdx}" s="2"><v>${totSalesOnly}</v></c>
    <c r="L${totalRowIdx}" s="4"><v>${totShortageQty}</v></c>
    <c r="M${totalRowIdx}" s="4"><v>${totSurplusQty}</v></c>
    <c r="N${totalRowIdx}" s="3"><v>${totShortageVal}</v></c>
    <c r="O${totalRowIdx}" s="3"><v>${totSurplusVal}</v></c>
    <c r="P${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="Q${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="R${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="S${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="T${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
  </row>`;

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${s1Rows}</sheetData>
</worksheet>`;

  // Sheet 2: Mismatch Items Detail
  let s2Rows = "";
  s2Rows += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Item Name</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Purchase Qty</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Sales Qty</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Balance Qty</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Shortage Qty</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Surplus Qty</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Latest Purchase Rate (INR)</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Approx Shortage Value (INR)</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Approx Surplus Value (INR)</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Mismatch Status</t></is></c>
  </row>`;

  let itemRowIdx = 2;
  customers.forEach((c) => {
    (c.items || []).forEach((it: any) => {
      s2Rows += `<row r="${itemRowIdx}">
        <c r="A${itemRowIdx}" t="inlineStr"><is><t>${escapeXml(c.customer_name || "")}</t></is></c>
        <c r="B${itemRowIdx}" t="inlineStr"><is><t>${escapeXml(it.item_name || "")}</t></is></c>
        <c r="C${itemRowIdx}" t="inlineStr"><is><t>${escapeXml(it.sku || "—")}</t></is></c>
        <c r="D${itemRowIdx}" s="4"><v>${Number(it.purchase_qty || 0)}</v></c>
        <c r="E${itemRowIdx}" s="4"><v>${Number(it.sales_qty || 0)}</v></c>
        <c r="F${itemRowIdx}" s="4"><v>${Number(it.balance_qty || 0)}</v></c>
        <c r="G${itemRowIdx}" s="4"><v>${Number(it.yet_to_purchase || 0)}</v></c>
        <c r="H${itemRowIdx}" s="4"><v>${Number(it.yet_to_sale || 0)}</v></c>
        <c r="I${itemRowIdx}" s="3"><v>${Number(it.latest_purchase_rate || 0)}</v></c>
        <c r="J${itemRowIdx}" s="3"><v>${Number(it.shortage_value || 0)}</v></c>
        <c r="K${itemRowIdx}" s="3"><v>${Number(it.surplus_value || 0)}</v></c>
        <c r="L${itemRowIdx}" t="inlineStr"><is><t>${escapeXml(it.status || "")}</t></is></c>
      </row>`;
      itemRowIdx++;
    });
  });

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${s2Rows}</sheetData>
</worksheet>`;

  // Sheet 3: Metadata & Audit
  const now = new Date().toISOString();
  const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>METRIC / PROPERTY</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Report Title</t></is></c><c r="B2" t="inlineStr"><is><t>Customer Action Tracker (Mismatch Action Taken)</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Period</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(periodLabel)}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Customers Requiring Action</t></is></c><c r="B4" s="2"><v>${Number(kpis.customers_requiring_action || 0)}</v></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Total Mismatch Items</t></is></c><c r="B5" s="2"><v>${Number(kpis.total_mismatch_items || 0)}</v></c></row>
    <row r="6"><c r="A6" t="inlineStr"><is><t>Total Shortage Qty</t></is></c><c r="B6" s="4"><v>${Number(kpis.total_shortage_qty || 0)}</v></c></row>
    <row r="7"><c r="A7" t="inlineStr"><is><t>Total Surplus Qty</t></is></c><c r="B7" s="4"><v>${Number(kpis.total_surplus_qty || 0)}</v></c></row>
    <row r="8"><c r="A8" t="inlineStr"><is><t>Approx Shortage Value (INR)</t></is></c><c r="B8" s="3"><v>${Number(kpis.approx_shortage_value || 0)}</v></c></row>
    <row r="9"><c r="A9" t="inlineStr"><is><t>Approx Surplus Value (INR)</t></is></c><c r="B9" s="3"><v>${Number(kpis.approx_surplus_value || 0)}</v></c></row>
    <row r="10"><c r="A10" t="inlineStr"><is><t>Generated At (UTC)</t></is></c><c r="B10" t="inlineStr"><is><t>${now}</t></is></c></row>
    <row r="11"><c r="A11" t="inlineStr"><is><t>Source Database</t></is></c><c r="B11" t="inlineStr"><is><t>Local SQLite Cache (Read-Only Zoho Books)</t></is></c></row>
    <row r="12"><c r="A12" t="inlineStr"><is><t>Zoho Mutations</t></is></c><c r="B12" t="inlineStr"><is><t>0 (Zero Zoho Writes Guaranteed)</t></is></c></row>
  </sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Customer Action Tracker" sheetId="1" r:id="rId1"/>
    <sheet name="Mismatch Items Breakdown" sheetId="2" r:id="rId2"/>
    <sheet name="Audit &amp; KPI Metadata" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
    { path: "xl/worksheets/sheet3.xml", data: Buffer.from(sheet3Xml, "utf-8") },
  ];

  return packZip(entries);
}

/**
 * Generates an OpenXML Excel (.xlsx) workbook for Composite Assemblies & Component Breakdown.
 */
export function buildCompositeAssemblyExcel(
  assemblies: any[],
  summary: any,
  periodLabel: string
): Buffer {
  // Styles XML with Header (1), Int (2), INR (3), Qty (4), Normal (0)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="₹#,##0.00"/>
    <numFmt numFmtId="166" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="10"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0284C7"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></left>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

  // Sheet 1: Master Assemblies
  let s1Rows = "";
  s1Rows += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Assembly #</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Date</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Finished / Composite Item</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Generated Qty</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Unit</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Total Material Cost (INR)</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Cost Per Unit (INR)</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Status</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Reference No</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Remarks</t></is></c>
    <c r="M1" t="inlineStr" s="1"><is><t>Created At</t></is></c>
  </row>`;

  assemblies.forEach((a, idx) => {
    const rIdx = idx + 2;
    s1Rows += `<row r="${rIdx}">
      <c r="A${rIdx}" t="inlineStr"><is><t>${escapeXml(a.assembly_number || "")}</t></is></c>
      <c r="B${rIdx}" t="inlineStr"><is><t>${escapeXml(a.assembly_date || "")}</t></is></c>
      <c r="C${rIdx}" t="inlineStr"><is><t>${escapeXml(a.customer_name || "")}</t></is></c>
      <c r="D${rIdx}" t="inlineStr"><is><t>${escapeXml(a.composite_item_name || "")}</t></is></c>
      <c r="E${rIdx}" t="inlineStr"><is><t>${escapeXml(a.composite_sku || "—")}</t></is></c>
      <c r="F${rIdx}" s="4"><v>${Number(a.generated_qty || 0)}</v></c>
      <c r="G${rIdx}" t="inlineStr"><is><t>${escapeXml(a.unit || "BUN")}</t></is></c>
      <c r="H${rIdx}" s="3"><v>${Number(a.total_material_cost || 0)}</v></c>
      <c r="I${rIdx}" s="3"><v>${Number(a.cost_per_unit || 0)}</v></c>
      <c r="J${rIdx}" t="inlineStr"><is><t>${escapeXml(a.status || "")}</t></is></c>
      <c r="K${rIdx}" t="inlineStr"><is><t>${escapeXml(a.reference_no || "—")}</t></is></c>
      <c r="L${rIdx}" t="inlineStr"><is><t>${escapeXml(a.remarks || "—")}</t></is></c>
      <c r="M${rIdx}" t="inlineStr"><is><t>${escapeXml(a.created_at || "")}</t></is></c>
    </row>`;
  });

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${s1Rows}</sheetData>
</worksheet>`;

  // Sheet 2: Component Consumptions Detail
  let s2Rows = "";
  s2Rows += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Assembly #</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Customer Name</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Finished Item</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Component Item</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>SKU</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Vendor Name</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Source Bill #</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Bill Date</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Raw Purch Qty</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Consumed Qty</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Purchase Rate (INR)</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Purchase Amount (INR)</t></is></c>
  </row>`;

  let compRowIdx = 2;
  assemblies.forEach((a) => {
    (a.components || []).forEach((c: any) => {
      s2Rows += `<row r="${compRowIdx}">
        <c r="A${compRowIdx}" t="inlineStr"><is><t>${escapeXml(a.assembly_number || "")}</t></is></c>
        <c r="B${compRowIdx}" t="inlineStr"><is><t>${escapeXml(a.customer_name || "")}</t></is></c>
        <c r="C${compRowIdx}" t="inlineStr"><is><t>${escapeXml(a.composite_item_name || "")}</t></is></c>
        <c r="D${compRowIdx}" t="inlineStr"><is><t>${escapeXml(c.component_item_name || "")}</t></is></c>
        <c r="E${compRowIdx}" t="inlineStr"><is><t>${escapeXml(c.component_sku || "—")}</t></is></c>
        <c r="F${compRowIdx}" t="inlineStr"><is><t>${escapeXml(c.vendor_name || "—")}</t></is></c>
        <c r="G${compRowIdx}" t="inlineStr"><is><t>${escapeXml(c.source_bill_number || "—")}</t></is></c>
        <c r="H${compRowIdx}" t="inlineStr"><is><t>${escapeXml(c.source_bill_date || "—")}</t></is></c>
        <c r="I${compRowIdx}" s="4"><v>${Number(c.raw_purchase_qty || 0)}</v></c>
        <c r="J${compRowIdx}" s="4"><v>${Number(c.consumed_qty || 0)}</v></c>
        <c r="K${compRowIdx}" s="3"><v>${Number(c.purchase_rate || 0)}</v></c>
        <c r="L${compRowIdx}" s="3"><v>${Number(c.purchase_amount || 0)}</v></c>
      </row>`;
      compRowIdx++;
    });
  });

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${s2Rows}</sheetData>
</worksheet>`;

  // Sheet 3: Metadata & KPIs
  const now = new Date().toISOString();
  const sheet3Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr" s="1"><is><t>METRIC / PROPERTY</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>VALUE</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Report Title</t></is></c><c r="B2" t="inlineStr"><is><t>Local Manual Composite Assembly Register</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Period</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(periodLabel)}</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Total Assemblies</t></is></c><c r="B4" s="2"><v>${Number(summary?.totalAssemblies || 0)}</v></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Confirmed Assemblies</t></is></c><c r="B5" s="2"><v>${Number(summary?.confirmedAssemblies || 0)}</v></c></row>
    <row r="6"><c r="A6" t="inlineStr"><is><t>Draft Assemblies</t></is></c><c r="B6" s="2"><v>${Number(summary?.draftAssemblies || 0)}</v></c></row>
    <row r="7"><c r="A7" t="inlineStr"><is><t>Cancelled Assemblies</t></is></c><c r="B7" s="2"><v>${Number(summary?.cancelledAssemblies || 0)}</v></c></row>
    <row r="8"><c r="A8" t="inlineStr"><is><t>Total Generated Units</t></is></c><c r="B8" s="4"><v>${Number(summary?.totalGeneratedUnits || 0)}</v></c></row>
    <row r="9"><c r="A9" t="inlineStr"><is><t>Total Material Value (INR)</t></is></c><c r="B9" s="3"><v>${Number(summary?.totalMaterialCost || 0)}</v></c></row>
    <row r="10"><c r="A10" t="inlineStr"><is><t>Generated At (UTC)</t></is></c><c r="B10" t="inlineStr"><is><t>${now}</t></is></c></row>
    <row r="11"><c r="A11" t="inlineStr"><is><t>Source Database</t></is></c><c r="B11" t="inlineStr"><is><t>Local SQLite Cache (Read-Only Zoho Books)</t></is></c></row>
    <row r="12"><c r="A12" t="inlineStr"><is><t>Zoho Mutations</t></is></c><c r="B12" t="inlineStr"><is><t>0 (Zero Zoho Writes Guaranteed)</t></is></c></row>
  </sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Composite Assemblies" sheetId="1" r:id="rId1"/>
    <sheet name="Component Consumptions" sheetId="2" r:id="rId2"/>
    <sheet name="Audit &amp; Metadata" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
    { path: "xl/worksheets/sheet3.xml", data: Buffer.from(sheet3Xml, "utf-8") },
  ];

  return packZip(entries);
}

/**
 * Builds Excel spreadsheet for Action Taken > Customer Details Missing view.
 */
export function buildCustomerDetailsMissingExcel(data: {
  kpis: any;
  items: any[];
  financialYear?: string;
  period?: string;
  reconStatusFilter?: string;
  search?: string;
}): Buffer {
  const stylesXml = buildStylesXml();
  const items = data.items || [];
  const kpis = data.kpis || {};
  const periodLabel = data.period || data.financialYear || "FY2026-27";

  // Sheet 1: Missing Customer Details Lines
  let s1Rows = "";
  s1Rows += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>Sr.</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>Bill Date</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Bill No.</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Vendor</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Item</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>SKU / Code</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Description</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Purchase Qty</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Rate (INR)</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Taxable Value (INR)</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Customer Details</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Status</t></is></c>
    <c r="M1" t="inlineStr" s="1"><is><t>Action Status</t></is></c>
    <c r="N1" t="inlineStr" s="1"><is><t>Action Owner</t></is></c>
    <c r="O1" t="inlineStr" s="1"><is><t>Next Follow-up</t></is></c>
    <c r="P1" t="inlineStr" s="1"><is><t>Remarks</t></is></c>
  </row>`;

  items.forEach((it, idx) => {
    const rIdx = idx + 2;
    s1Rows += `<row r="${rIdx}">
      <c r="A${rIdx}" s="2"><v>${idx + 1}</v></c>
      <c r="B${rIdx}" t="inlineStr"><is><t>${escapeXml(it.bill_date || "")}</t></is></c>
      <c r="C${rIdx}" t="inlineStr"><is><t>${escapeXml(it.bill_number || "")}</t></is></c>
      <c r="D${rIdx}" t="inlineStr"><is><t>${escapeXml(it.vendor_name || "")}</t></is></c>
      <c r="E${rIdx}" t="inlineStr"><is><t>${escapeXml(it.item_name || "")}</t></is></c>
      <c r="F${rIdx}" t="inlineStr"><is><t>${escapeXml(it.sku || "")}</t></is></c>
      <c r="G${rIdx}" t="inlineStr"><is><t>${escapeXml(it.description || "")}</t></is></c>
      <c r="H${rIdx}" s="4"><v>${Number(it.quantity || 0)}</v></c>
      <c r="I${rIdx}" s="3"><v>${Number(it.rate || 0)}</v></c>
      <c r="J${rIdx}" s="3"><v>${Number(it.line_total || 0)}</v></c>
      <c r="K${rIdx}" t="inlineStr"><is><t>${escapeXml(it.customer_details || "MISSING")}</t></is></c>
      <c r="L${rIdx}" t="inlineStr"><is><t>${escapeXml(it.status || "ACTION REQUIRED")}</t></is></c>
      <c r="M${rIdx}" t="inlineStr"><is><t>${escapeXml(it.action_status || "Open")}</t></is></c>
      <c r="N${rIdx}" t="inlineStr"><is><t>${escapeXml(it.action_owner || "—")}</t></is></c>
      <c r="O${rIdx}" t="inlineStr"><is><t>${escapeXml(it.next_follow_up_date || "—")}</t></is></c>
      <c r="P${rIdx}" t="inlineStr"><is><t>${escapeXml(it.remarks || "—")}</t></is></c>
    </row>`;
  });

  // Grand Total Summary Row
  const totalRowIdx = items.length + 2;
  const totQty = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
  const totTaxable = items.reduce((sum, it) => sum + Number(it.line_total || 0), 0);

  s1Rows += `<row r="${totalRowIdx}">
    <c r="A${totalRowIdx}" t="inlineStr" s="1"><is><t>GRAND TOTAL</t></is></c>
    <c r="B${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="C${totalRowIdx}" t="inlineStr" s="1"><is><t>${kpis.affected_bills ?? new Set(items.map(i => i.bill_id)).size} Bills</t></is></c>
    <c r="D${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="E${totalRowIdx}" t="inlineStr" s="1"><is><t>${kpis.affected_items ?? new Set(items.map(i => i.item_id)).size} Items</t></is></c>
    <c r="F${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="G${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="H${totalRowIdx}" s="5"><v>${Math.round(totQty * 1000) / 1000}</v></c>
    <c r="I${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="J${totalRowIdx}" s="6"><v>${Math.round(totTaxable * 100) / 100}</v></c>
    <c r="K${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="L${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="M${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="N${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="O${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
    <c r="P${totalRowIdx}" t="inlineStr" s="1"><is><t>—</t></is></c>
  </row>`;

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="6" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="18" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
    <col min="5" max="5" width="30" customWidth="1"/>
    <col min="6" max="6" width="16" customWidth="1"/>
    <col min="7" max="7" width="26" customWidth="1"/>
    <col min="8" max="8" width="16" customWidth="1"/>
    <col min="9" max="9" width="14" customWidth="1"/>
    <col min="10" max="10" width="20" customWidth="1"/>
    <col min="11" max="11" width="18" customWidth="1"/>
    <col min="12" max="12" width="18" customWidth="1"/>
    <col min="13" max="13" width="20" customWidth="1"/>
    <col min="14" max="14" width="18" customWidth="1"/>
    <col min="15" max="15" width="16" customWidth="1"/>
    <col min="16" max="16" width="30" customWidth="1"/>
  </cols>
  <sheetData>${s1Rows}</sheetData>
</worksheet>`;

  // Sheet 2: KPI & Metadata
  let s2Rows = "";
  s2Rows += `<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Metric / Property</t></is></c><c r="B1" t="inlineStr" s="1"><is><t>Value</t></is></c></row>`;
  s2Rows += `<row r="2"><c r="A2" t="inlineStr"><is><t>Report Title</t></is></c><c r="B2" t="inlineStr"><is><t>Customer Details Missing (Purchase Line Mapping Exceptions)</t></is></c></row>`;
  s2Rows += `<row r="3"><c r="A3" t="inlineStr"><is><t>Period</t></is></c><c r="B3" t="inlineStr"><is><t>${escapeXml(periodLabel)}</t></is></c></row>`;
  s2Rows += `<row r="4"><c r="A4" t="inlineStr"><is><t>Missing Lines</t></is></c><c r="B4" s="2"><v>${kpis.missing_lines || items.length}</v></c></row>`;
  s2Rows += `<row r="5"><c r="A5" t="inlineStr"><is><t>Affected Bills</t></is></c><c r="B5" s="2"><v>${kpis.affected_bills || new Set(items.map(i => i.bill_id)).size}</v></c></row>`;
  s2Rows += `<row r="6"><c r="A6" t="inlineStr"><is><t>Affected Items</t></is></c><c r="B6" s="2"><v>${kpis.affected_items || new Set(items.map(i => i.item_id)).size}</v></c></row>`;
  s2Rows += `<row r="7"><c r="A7" t="inlineStr"><is><t>Purchase Qty Unmapped</t></is></c><c r="B7" s="4"><v>${kpis.purchase_qty_unmapped || totQty}</v></c></row>`;
  s2Rows += `<row r="8"><c r="A8" t="inlineStr"><is><t>Taxable Value Unmapped (INR)</t></is></c><c r="B8" s="3"><v>${kpis.taxable_value_unmapped || totTaxable}</v></c></row>`;
  s2Rows += `<row r="9"><c r="A9" t="inlineStr"><is><t>Generated At</t></is></c><c r="B9" t="inlineStr"><is><t>${new Date().toISOString()}</t></is></c></row>`;

  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="45" customWidth="1"/></cols>
  <sheetData>${s2Rows}</sheetData>
</worksheet>`;

  const entries = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`, "utf-8"),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8"),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Missing Customer Details" sheetId="1" r:id="rId1"/>
    <sheet name="Summary &amp; KPIs" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`, "utf-8"),
    },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
    { path: "xl/worksheets/sheet2.xml", data: Buffer.from(sheet2Xml, "utf-8") },
  ];

  return packZip(entries);
}





export function buildCashBooksExcel(data: any): Buffer {
  const stylesXml = buildStylesXml();
  let s1Rows = "";
  s1Rows += `<row r="1">
    <c r="A1" t="inlineStr" s="1"><is><t>FY</t></is></c>
    <c r="B1" t="inlineStr" s="1"><is><t>AY</t></is></c>
    <c r="C1" t="inlineStr" s="1"><is><t>Account</t></is></c>
    <c r="D1" t="inlineStr" s="1"><is><t>Opening</t></is></c>
    <c r="E1" t="inlineStr" s="1"><is><t>Receipts</t></is></c>
    <c r="F1" t="inlineStr" s="1"><is><t>Payments</t></is></c>
    <c r="G1" t="inlineStr" s="1"><is><t>Closing</t></is></c>
    <c r="H1" t="inlineStr" s="1"><is><t>Equation Difference</t></is></c>
    <c r="I1" t="inlineStr" s="1"><is><t>Negative Closing</t></is></c>
    <c r="J1" t="inlineStr" s="1"><is><t>Negative During FY</t></is></c>
    <c r="K1" t="inlineStr" s="1"><is><t>Negative Transactions</t></is></c>
    <c r="L1" t="inlineStr" s="1"><is><t>Negative Balance Dates</t></is></c>
    <c r="M1" t="inlineStr" s="1"><is><t>Negative Periods</t></is></c>
    <c r="N1" t="inlineStr" s="1"><is><t>Evidence Through</t></is></c>
  </row>`;
  data.accounts.forEach((acc: any, idx: number) => {
    const r = idx + 2;
    const diff = Math.abs(acc.opening_balance + acc.total_receipts - acc.total_payments - acc.closing_balance);
    const uniqueDates = new Set(acc.negative_cash_days.map((d: any) => d.date)).size;
    const getAY = (fyStr: string) => {
      if (!fyStr) return "";
      const start = parseInt(fyStr.substring(0, 4), 10);
      return `AY${start + 1}-${(start + 2).toString().slice(-2)}`;
    };
    s1Rows += `<row r="${r}">
      <c r="A${r}" t="inlineStr"><is><t>${escapeXml(data.financialYear)}</t></is></c>
      <c r="B${r}" t="inlineStr"><is><t>${escapeXml(getAY(data.financialYear))}</t></is></c>
      <c r="C${r}" t="inlineStr"><is><t>${escapeXml(acc.account_name)}</t></is></c>
      <c r="D${r}" s="2"><v>${acc.opening_balance}</v></c>
      <c r="E${r}" s="2"><v>${acc.total_receipts}</v></c>
      <c r="F${r}" s="2"><v>${acc.total_payments}</v></c>
      <c r="G${r}" s="2"><v>${acc.closing_balance}</v></c>
      <c r="H${r}" s="2"><v>${diff}</v></c>
      <c r="I${r}" t="inlineStr"><is><t>${acc.closing_balance < 0 ? "YES" : "NO"}</t></is></c>
      <c r="J${r}" t="inlineStr"><is><t>${acc.negative_cash_days.length > 0 ? "YES" : "NO"}</t></is></c>
      <c r="K${r}"><v>${acc.negative_cash_days.length}</v></c>
      <c r="L${r}"><v>${uniqueDates}</v></c>
      <c r="M${r}"><v>${acc.negative_periods}</v></c>
      <c r="N${r}" t="inlineStr"><is><t>${escapeXml(data.coverageThrough || "")}</t></is></c>
    </row>`;
  });
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${s1Rows}</sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    { path: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, "utf-8") },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, "utf-8") },
    { path: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`, "utf-8") },
    { path: "xl/workbook.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Cash Books" sheetId="1" r:id="rId1"/></sheets>
</workbook>`, "utf-8") },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf-8") },
  ];
  return packZip(entries);
}
