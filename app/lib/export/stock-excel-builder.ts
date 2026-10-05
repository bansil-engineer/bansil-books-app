// ============================================================
// Bansil Books Analytics — Stock Module Excel Builder
// 7-Sheet Workbook: Summary, Items, Purchase, Sales,
//   Customer Movement, Price History, Audit
// Pure Node OpenXML · No external dependencies · Zero Zoho calls
// ============================================================

import * as zlib from "zlib";
import type { StockSummaryResult, ItemStockDetail } from "../stock-engine.ts";

// ─────────────────────────────────────────────────────────────
// ZIP / OpenXML plumbing (same pattern as existing excel-builder.ts)
// ─────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry { path: string; data: Buffer; }

function packZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = e.data;
    const c32 = crc32(raw);
    const comp = zlib.deflateRawSync(raw);
    const nameB = Buffer.from(e.path, "utf8");
    const lh = Buffer.alloc(30 + nameB.length);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(c32, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28); nameB.copy(lh, 30);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(c32, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42); nameB.copy(cd, 46);
    locals.push(lh, comp);
    cds.push(cd);
    offset += lh.length + comp.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

// ─────────────────────────────────────────────────────────────
// XML helpers
// ─────────────────────────────────────────────────────────────
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numCell(col: string, row: number, val: number | null | undefined, styleId = 1): string {
  const v = val ?? 0;
  return `<c r="${col}${row}" s="${styleId}" t="n"><v>${v}</v></c>`;
}

function strCell(col: string, row: number, val: string, styleId = 0): string {
  return `<c r="${col}${row}" s="${styleId}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
}

function hdrCell(col: string, row: number, val: string): string {
  return `<c r="${col}${row}" s="2" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
}

function colLetter(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function buildWorksheet(
  title: string,
  headers: string[],
  dataRows: Array<Array<string | number | null>>,
  hasTotalRow = false,
  hasAutoFilter = true
): string {
  const colCount = headers.length;
  const lastCol = colLetter(colCount - 1);
  const totalRowsCount = dataRows.length;
  const filterMaxRow = hasTotalRow ? Math.max(1, totalRowsCount) : 1 + totalRowsCount;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView tabSelected="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<sheetData>
<row r="1">`;
  for (let c = 0; c < headers.length; c++) xml += hdrCell(colLetter(c), 1, headers[c]);
  xml += "</row>\n";
  for (let r = 0; r < dataRows.length; r++) {
    const rowNum = r + 2;
    const isTotal = hasTotalRow && r === dataRows.length - 1;
    xml += `<row r="${rowNum}">`;
    for (let c = 0; c < dataRows[r].length; c++) {
      const val = dataRows[r][c];
      const col = colLetter(c);
      if (typeof val === "number" || (val === null && isTotal)) {
        const style = isTotal ? 5 : 1;
        xml += numCell(col, rowNum, val as number | null, style);
      } else {
        const style = isTotal ? 4 : 0;
        xml += strCell(col, rowNum, String(val ?? ""), style);
      }
    }
    xml += "</row>\n";
  }
  xml += `</sheetData>`;
  if (hasAutoFilter && dataRows.length > 0) {
    xml += `\n<autoFilter ref="A1:${lastCol}${filterMaxRow}"/>`;
  }
  xml += `\n</worksheet>`;
  return xml;
}

// ─────────────────────────────────────────────────────────────
// Workbook structure helpers
// ─────────────────────────────────────────────────────────────
function buildWorkbook(sheetNames: string[]): string {
  const sheets = sheetNames
    .map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets}</sheets></workbook>`;
}

function buildWorkbookRels(count: number): string {
  const rels = Array.from({ length: count }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function buildStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
  <numFmt numFmtId="164" formatCode="#,##0.00"/>
  <numFmt numFmtId="165" formatCode="[$₹-en-IN]#,##0.00"/>
</numFmts>
<fonts count="3">
  <font><sz val="11"/><name val="Segoe UI"/><color rgb="FF1E293B"/></font>
  <font><b/><sz val="11"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>
  <font><b/><sz val="11"/><name val="Segoe UI"/><color rgb="FF1E293B"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF0F4F8"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left/><right/><top style="thin"><color rgb="FF1E293B"/></top><bottom style="double"><color rgb="FF1E293B"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"><alignment horizontal="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0"/>
  <xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0"/>
</cellXfs></styleSheet>`;
}

function buildContentTypes(count: number): string {
  const overrides = Array.from({ length: count }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}
</Types>`;
}

// ─────────────────────────────────────────────────────────────
// Main export: buildStockExcel
// ─────────────────────────────────────────────────────────────
export interface StockExportOptions {
  selectedFields?: string[];
  includeTotals?: boolean;
}

const STOCK_COLUMN_MAPPINGS: Record<
  string,
  {
    header: string;
    totalSupported: boolean;
    getValue: (item: any, idx: number) => string | number | null;
    getTotal: (totals: any) => string | number | null;
  }
> = {
  sr: { header: "Sr.", totalSupported: false, getValue: (_, idx) => idx + 1, getTotal: () => "TOTAL" },
  itemName: { header: "Item Name", totalSupported: false, getValue: (it) => it.itemName, getTotal: () => "" },
  itemId: { header: "Item ID", totalSupported: false, getValue: (it) => it.itemId, getTotal: () => "" },
  sku: { header: "SKU / Code", totalSupported: false, getValue: (it) => it.sku, getTotal: () => "" },
  classification: { header: "Classification", totalSupported: false, getValue: (it) => it.classification, getTotal: () => "" },
  stockStatus: { header: "Stock Status", totalSupported: false, getValue: (it) => it.status, getTotal: () => "" },
  purchaseQty: { header: "Purchase Qty", totalSupported: true, getValue: (it) => it.effectivePurchaseQty, getTotal: (t) => t.totalPurchaseQty },
  salesQty: { header: "Sales Qty", totalSupported: true, getValue: (it) => it.salesQty, getTotal: (t) => t.totalSalesQty },
  stockQty: { header: "Stock Qty", totalSupported: true, getValue: (it) => it.stockQty, getTotal: (t) => t.totalStockQty },
  latestPurchaseRate: { header: "Latest Purchase Rate", totalSupported: false, getValue: (it) => it.latestPurchaseRate ?? null, getTotal: () => null },
  latestSalesRate: { header: "Latest Sales Rate", totalSupported: false, getValue: (it) => it.latestSalesRate ?? null, getTotal: () => null },
  approxStockValue: { header: "Approx Stock Value", totalSupported: true, getValue: (it) => it.approxStockValue ?? null, getTotal: (t) => t.totalApproxStockValue },
  customersCount: { header: "Customers Count", totalSupported: false, getValue: (it) => it.customerCount, getTotal: () => null },
  billsCount: { header: "Bills Count", totalSupported: false, getValue: (it) => it.purchaseBillCount, getTotal: () => null },
  invoicesCount: { header: "Invoices Count", totalSupported: false, getValue: (it) => it.salesInvoiceCount, getTotal: () => null },
  lastPurchaseDate: { header: "Last Purchase Date", totalSupported: false, getValue: (it) => it.lastPurchaseDate ?? "", getTotal: () => "" },
  lastSalesDate: { header: "Last Sales Date", totalSupported: false, getValue: (it) => it.lastSalesDate ?? "", getTotal: () => "" },
};

export function buildStockExcel(
  summaryResult: StockSummaryResult,
  periodLabel: string,
  details?: ItemStockDetail[],
  options?: StockExportOptions
): Buffer {
  if (!summaryResult || !summaryResult.items || summaryResult.items.length === 0) {
    throw new Error("Excel export failed: report data is empty.");
  }

  const entries: ZipEntry[] = [];
  const sheetNames = [
    "Item Stock",
    "Stock Summary",
    "Purchase Lines",
    "Sales Lines",
    "Customer Movement",
    "Price History",
    "Audit Metadata",
  ];

  const b = (s: string) => Buffer.from(s, "utf8");

  // ── Sheet 1: Item Stock (Primary Sheet with Selected Fields in Exact Order) ──
  const selectedFieldKeys: string[] =
    options?.selectedFields && options.selectedFields.length > 0
      ? options.selectedFields
      : [
          "itemName",
          "sku",
          "stockStatus",
          "purchaseQty",
          "salesQty",
          "stockQty",
          "latestPurchaseRate",
          "approxStockValue",
        ];

  const validFields = selectedFieldKeys
    .map((k) => ({ key: k, mapping: STOCK_COLUMN_MAPPINGS[k] }))
    .filter((item): item is { key: string; mapping: (typeof STOCK_COLUMN_MAPPINGS)[string] } => Boolean(item.mapping));

  const stockHeaders = validFields.map((f) => f.mapping.header);
  const stockRows: Array<Array<string | number | null>> = summaryResult.items.map((item, i) =>
    validFields.map((f) => f.mapping.getValue(item, i))
  );

  const includeTotals = options?.includeTotals !== false;
  if (includeTotals && summaryResult.items.length > 0) {
    let hasLabel = false;
    const totalRow = validFields.map((f, colIdx) => {
      if (f.key === "sr" || (colIdx === 0 && !hasLabel)) {
        hasLabel = true;
        return "TOTAL";
      }
      if (f.mapping.totalSupported) {
        return f.mapping.getTotal(summaryResult.totals);
      }
      return null;
    });
    stockRows.push(totalRow);
  }

  entries.push({
    path: "xl/worksheets/sheet1.xml",
    data: b(buildWorksheet("Item Stock", stockHeaders, stockRows, includeTotals, true)),
  });

  // ── Sheet 2: Stock Summary (KPIs) ──
  const { kpis, totals } = summaryResult;
  const summaryHeaders = ["Metric", "Value"];
  const summaryRows: Array<[string, string | number]> = [
    ["Report Period", periodLabel],
    ["Total Active Items", kpis.totalActiveItems],
    ["Total Purchase Qty", kpis.totalPurchaseQty],
    ["Total Sales Qty", kpis.totalSalesQty],
    ["Total Stock Qty", kpis.totalStockQty],
    ["Positive Stock Items", kpis.positiveStockItems],
    ["Negative Stock Items", kpis.negativeStockItems],
    ["Zero Stock Items", kpis.zeroStockItems],
    ["Approx Total Stock Value (₹)", kpis.approxTotalStockValue],
    ["Unmapped Purchase Qty", kpis.unmappedPurchaseQty],
    ["Composite Items", kpis.compositeItems],
    ["Purchase Only Items", kpis.purchaseOnlyItems],
    ["Sales Only Items", kpis.salesOnlyItems],
    ["Filtered Purchase Qty", totals.totalPurchaseQty],
    ["Filtered Sales Qty", totals.totalSalesQty],
    ["Filtered Stock Qty", totals.totalStockQty],
    ["Filtered Purchase Value (₹)", totals.totalPurchaseValue],
    ["Filtered Sales Value (₹)", totals.totalSalesValue],
    ["Filtered Approx Stock Value (₹)", totals.totalApproxStockValue],
  ];
  entries.push({
    path: "xl/worksheets/sheet2.xml",
    data: b(buildWorksheet("Stock Summary", summaryHeaders, summaryRows.map(([m, v]) => [m, v]), false, false)),
  });

  // ── Sheet 3: Purchase Lines ──
  const purchHeaders = [
    "Item ID", "Item Name", "SKU", "Bill ID", "Bill No.", "Bill Date",
    "Vendor", "Customer", "Qty", "Rate", "Taxable Value (₹)",
    "Assembly Consumed Qty", "Available Qty", "Mapped?",
  ];
  const purchRows: Array<Array<string | number | null>> = [];
  for (const item of details ?? []) {
    for (const p of item.purchaseLines) {
      purchRows.push([
        item.itemId, item.itemName, item.sku,
        p.billId, p.billNumber, p.billDate,
        p.vendorName, p.customerName,
        p.quantity, p.rate, p.taxableValue,
        p.assemblyConsumedQty, p.availableQty, p.isMapped ? "Yes" : "No",
      ]);
    }
  }
  entries.push({
    path: "xl/worksheets/sheet3.xml",
    data: b(buildWorksheet("Purchase Lines", purchHeaders, purchRows.length ? purchRows : [["(No detail data provided)", null, null, null, null, null, null, null, null, null, null, null, null, null]])),
  });

  // ── Sheet 4: Sales Lines ──
  const salesHeaders = [
    "Item ID", "Item Name", "SKU",
    "Invoice ID", "Invoice No.", "Invoice Date",
    "Customer", "Qty", "Rate", "Taxable Value (₹)",
  ];
  const salesRows: Array<Array<string | number | null>> = [];
  for (const item of details ?? []) {
    for (const s of item.salesLines) {
      salesRows.push([
        item.itemId, item.itemName, item.sku,
        s.invoiceId, s.invoiceNumber, s.invoiceDate,
        s.customerName, s.quantity, s.rate, s.taxableValue,
      ]);
    }
  }
  entries.push({
    path: "xl/worksheets/sheet4.xml",
    data: b(buildWorksheet("Sales Lines", salesHeaders, salesRows.length ? salesRows : [["(No detail data provided)", null, null, null, null, null, null, null, null, null]])),
  });

  // ── Sheet 5: Customer Movement ──
  const custHeaders = [
    "Item ID", "Item Name", "Customer ID", "Customer Name",
    "Purchase Qty", "Sales Qty", "Balance Qty",
    "Purchase Value (₹)", "Sales Value (₹)",
  ];
  const custRows: Array<Array<string | number | null>> = [];
  for (const item of details ?? []) {
    for (const cm of item.customerMovements) {
      custRows.push([
        item.itemId, item.itemName,
        cm.customerId, cm.customerName,
        cm.purchaseQty, cm.salesQty, cm.balanceQty,
        cm.purchaseValue, cm.salesValue,
      ]);
    }
  }
  entries.push({
    path: "xl/worksheets/sheet5.xml",
    data: b(buildWorksheet("Customer Movement", custHeaders, custRows.length ? custRows : [["(No detail data provided)", null, null, null, null, null, null, null, null]])),
  });

  // ── Sheet 6: Price History ──
  const priceHeaders = [
    "Item ID", "Item Name",
    "Latest Purchase Rate", "Lowest Purchase Rate", "Highest Purchase Rate", "Wtd Avg Purchase Rate",
    "Latest Sales Rate", "Lowest Sales Rate", "Highest Sales Rate", "Wtd Avg Sales Rate",
    "Latest Purchase Bill", "Latest Purchase Date", "Latest Purchase Vendor",
    "Latest Sales Invoice", "Latest Sales Date", "Latest Sales Customer",
  ];
  const priceRows: Array<Array<string | number | null>> = [];
  for (const item of details ?? []) {
    const ps = item.priceStats;
    priceRows.push([
      item.itemId, item.itemName,
      item.latestPurchaseRate ?? null,
      ps.lowestPurchaseRate ?? null, ps.highestPurchaseRate ?? null, ps.weightedAvgPurchaseRate ?? null,
      item.latestSalesRate ?? null,
      ps.lowestSalesRate ?? null, ps.highestSalesRate ?? null, ps.weightedAvgSalesRate ?? null,
      ps.latestPurchaseEvidence?.billNumber ?? "",
      ps.latestPurchaseEvidence?.date ?? "",
      ps.latestPurchaseEvidence?.vendorName ?? "",
      ps.latestSalesEvidence?.invoiceNumber ?? "",
      ps.latestSalesEvidence?.date ?? "",
      ps.latestSalesEvidence?.customerName ?? "",
    ]);
  }
  entries.push({
    path: "xl/worksheets/sheet6.xml",
    data: b(buildWorksheet("Price History", priceHeaders, priceRows.length ? priceRows : [["(No detail data provided)", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]])),
  });

  // ── Sheet 7: Audit Metadata ──
  const auditHeaders = ["Key", "Value"];
  const auditRows: Array<[string, string | number]> = [
    ["Report Type", "Stock Module Export"],
    ["Period", periodLabel],
    ["From Date", summaryResult.fromDate],
    ["To Date", summaryResult.toDate],
    ["Total Items in Report", summaryResult.items.length],
    ["Generated At (UTC)", new Date().toISOString()],
    ["Data Source", "Local SQLite (Bansil Books Analytics)"],
    ["Zoho API Calls", 0],
    ["Disclaimer", "Decision-support estimate. Not accounting inventory valuation."],
  ];
  entries.push({
    path: "xl/worksheets/sheet7.xml",
    data: b(buildWorksheet("Audit Metadata", auditHeaders, auditRows.map(([k, v]) => [k, v]))),
  });

  // ── Workbook infrastructure ──
  entries.push({ path: "xl/workbook.xml", data: b(buildWorkbook(sheetNames)) });
  entries.push({ path: "xl/styles.xml", data: b(buildStyles()) });
  entries.push({ path: "xl/_rels/workbook.xml.rels", data: b(buildWorkbookRels(sheetNames.length)) });
  entries.push({
    path: "[Content_Types].xml",
    data: b(buildContentTypes(sheetNames.length)),
  });
  entries.push({
    path: "_rels/.rels",
    data: b(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
  });

  return packZip(entries);
}

// ─────────────────────────────────────────────────────────────
// Single Item 7-Sheet Export: buildSingleItemStockExcel
// ─────────────────────────────────────────────────────────────
export function buildSingleItemStockExcel(
  detail: ItemStockDetail,
  periodLabel: string,
  selectedCustomerName?: string
): Buffer {
  const entries: ZipEntry[] = [];
  const sheetNames = [
    "Item Summary",
    "Purchase History",
    "Sales History",
    "Customer Movement",
    "Price History",
    "Chronological Ledger",
    "Audit Info",
  ];

  const b = (s: string) => Buffer.from(s, "utf8");

  // ── Sheet 1: Item Summary ──
  const summaryHeaders = ["Field", "Value"];
  const summaryRows: Array<[string, string | number]> = [
    ["Item Name", detail.itemName],
    ["Item ID", detail.itemId],
    ["SKU", detail.sku || "-"],
    ["Classification", detail.classification],
    ["Is Composite", detail.isComposite ? "YES" : "NO"],
    ["Selected Customer", selectedCustomerName || "All Customers"],
    ["Report Period", periodLabel],
    ["Status", detail.status],
    ["Raw Purchase Qty", detail.rawPurchaseQty],
    ["Assembly Consumed Qty", detail.assemblyConsumedQty],
    ["Assembly Generated Qty", detail.assemblyGeneratedQty],
    ["Effective Purchase Qty", detail.effectivePurchaseQty],
    ["Sales Qty", detail.salesQty],
    ["Balance / Stock Qty", detail.stockQty],
    ["Purchase Taxable Value (₹)", detail.purchaseTaxableValue],
    ["Sales Taxable Value (₹)", detail.salesTaxableValue],
    ["Latest Purchase Rate (₹)", detail.latestPurchaseRate ?? "N/A"],
    ["Latest Sales Rate (₹)", detail.latestSalesRate ?? "N/A"],
    ["Approx Stock Value (₹)", detail.approxStockValue ?? "N/A"],
    ["Customer Count", detail.customerCount],
    ["Purchase Bill Count", detail.purchaseBillCount],
    ["Sales Invoice Count", detail.salesInvoiceCount],
    ["Last Purchase Date", detail.lastPurchaseDate || "-"],
    ["Last Sales Date", detail.lastSalesDate || "-"],
  ];
  entries.push({
    path: "xl/worksheets/sheet1.xml",
    data: b(buildWorksheet("Item Summary", summaryHeaders, summaryRows.map(([k, v]) => [k, v]))),
  });

  // ── Sheet 2: Purchase History ──
  const purchHeaders = [
    "Sr", "Date", "Bill No.", "Vendor", "Customer Details", "Qty", "Rate (₹)", "Taxable Value (₹)", "Status"
  ];
  const purchRows: Array<Array<string | number | null>> = detail.purchaseLines.map((p, i) => [
    i + 1,
    p.billDate,
    p.billNumber,
    p.vendorName,
    p.customerName || "—",
    p.quantity,
    p.rate,
    p.taxableValue,
    "Active",
  ]);
  const totPurchQty = detail.purchaseLines.reduce((acc, p) => acc + p.quantity, 0);
  const totPurchVal = detail.purchaseLines.reduce((acc, p) => acc + p.taxableValue, 0);
  purchRows.push(["TOTAL", null, null, null, null, totPurchQty, null, totPurchVal, null]);
  entries.push({
    path: "xl/worksheets/sheet2.xml",
    data: b(buildWorksheet("Purchase History", purchHeaders, purchRows)),
  });

  // ── Sheet 3: Sales History ──
  const salesHeaders = [
    "Sr", "Date", "Invoice No.", "Customer", "Qty", "Rate (₹)", "Taxable Value (₹)"
  ];
  const salesRows: Array<Array<string | number | null>> = detail.salesLines.map((s, i) => [
    i + 1,
    s.invoiceDate,
    s.invoiceNumber,
    s.customerName,
    s.quantity,
    s.rate,
    s.taxableValue,
  ]);
  const totSalesQty = detail.salesLines.reduce((acc, s) => acc + s.quantity, 0);
  const totSalesVal = detail.salesLines.reduce((acc, s) => acc + s.taxableValue, 0);
  salesRows.push(["TOTAL", null, null, null, totSalesQty, null, totSalesVal]);
  entries.push({
    path: "xl/worksheets/sheet3.xml",
    data: b(buildWorksheet("Sales History", salesHeaders, salesRows)),
  });

  // ── Sheet 4: Customer Movement ──
  const custHeaders = [
    "Customer Name", "Customer ID", "Purchase Qty", "Sales Qty", "Balance Qty", "Purchase Value (₹)", "Sales Value (₹)"
  ];
  const custRows: Array<Array<string | number | null>> = detail.customerMovements.map((c) => [
    c.customerName,
    c.customerId || "—",
    c.purchaseQty,
    c.salesQty,
    c.balanceQty,
    c.purchaseValue,
    c.salesValue,
  ]);
  const totCustPurch = detail.customerMovements.reduce((acc, c) => acc + c.purchaseQty, 0);
  const totCustSales = detail.customerMovements.reduce((acc, c) => acc + c.salesQty, 0);
  const totCustBal = detail.customerMovements.reduce((acc, c) => acc + c.balanceQty, 0);
  custRows.push(["TOTAL", null, totCustPurch, totCustSales, totCustBal, null, null]);
  entries.push({
    path: "xl/worksheets/sheet4.xml",
    data: b(buildWorksheet("Customer Movement", custHeaders, custRows)),
  });

  // ── Sheet 5: Price History ──
  const ps = detail.priceStats;
  const priceHeaders = ["Metric", "Value"];
  const priceRows: Array<[string, string | number]> = [
    ["Latest Purchase Rate (₹)", detail.latestPurchaseRate ?? "N/A"],
    ["Lowest Purchase Rate (₹)", ps.lowestPurchaseRate ?? "N/A"],
    ["Highest Purchase Rate (₹)", ps.highestPurchaseRate ?? "N/A"],
    ["Weighted Avg Purchase Rate (₹)", ps.weightedAvgPurchaseRate ?? "N/A"],
    ["Latest Sales Rate (₹)", detail.latestSalesRate ?? "N/A"],
    ["Lowest Sales Rate (₹)", ps.lowestSalesRate ?? "N/A"],
    ["Highest Sales Rate (₹)", ps.highestSalesRate ?? "N/A"],
    ["Weighted Avg Sales Rate (₹)", ps.weightedAvgSalesRate ?? "N/A"],
    ["Latest Purchase Bill No.", ps.latestPurchaseEvidence?.billNumber ?? "-"],
    ["Latest Purchase Date", ps.latestPurchaseEvidence?.date ?? "-"],
    ["Latest Purchase Vendor", ps.latestPurchaseEvidence?.vendorName ?? "-"],
    ["Latest Sales Invoice No.", ps.latestSalesEvidence?.invoiceNumber ?? "-"],
    ["Latest Sales Date", ps.latestSalesEvidence?.date ?? "-"],
    ["Latest Sales Customer", ps.latestSalesEvidence?.customerName ?? "-"],
  ];
  entries.push({
    path: "xl/worksheets/sheet5.xml",
    data: b(buildWorksheet("Price History", priceHeaders, priceRows.map(([k, v]) => [k, v]))),
  });

  // ── Sheet 6: Chronological Ledger (Timeline) ──
  const ledgerHeaders = [
    "Date", "Type", "Doc Number", "Party (Vendor / Customer)", "Qty In", "Qty Out", "Running Balance Qty", "Rate (₹)", "Taxable Value (₹)"
  ];
  const ledgerRows: Array<Array<string | number | null>> = detail.timeline.map((t) => [
    t.date,
    t.type,
    t.documentNumber,
    t.party,
    t.qtyIn > 0 ? t.qtyIn : null,
    t.qtyOut > 0 ? t.qtyOut : null,
    t.runningQty,
    t.rate,
    t.taxableValue,
  ]);
  entries.push({
    path: "xl/worksheets/sheet6.xml",
    data: b(buildWorksheet("Chronological Ledger", ledgerHeaders, ledgerRows)),
  });

  // ── Sheet 7: Audit Info ──
  const auditHeaders = ["Key", "Value"];
  const auditRows: Array<[string, string | number]> = [
    ["Report Title", "Single Item Detail & Movement Ledger"],
    ["Item Name", detail.itemName],
    ["Item ID", detail.itemId],
    ["Period", periodLabel],
    ["Selected Customer Context", selectedCustomerName || "All Customers"],
    ["Generated At (UTC)", new Date().toISOString()],
    ["Data Source", "Local SQLite (Bansil Books Analytics)"],
    ["Zoho API Calls", 0],
    ["Zoho Data Modified", "NO"],
    ["Disclaimer", "Decision-support estimate. Not accounting inventory valuation."],
  ];
  entries.push({
    path: "xl/worksheets/sheet7.xml",
    data: b(buildWorksheet("Audit Info", auditHeaders, auditRows.map(([k, v]) => [k, v]))),
  });

  // ── Workbook infrastructure ──
  entries.push({ path: "xl/workbook.xml", data: b(buildWorkbook(sheetNames)) });
  entries.push({ path: "xl/styles.xml", data: b(buildStyles()) });
  entries.push({ path: "xl/_rels/workbook.xml.rels", data: b(buildWorkbookRels(sheetNames.length)) });
  entries.push({
    path: "[Content_Types].xml",
    data: b(buildContentTypes(sheetNames.length)),
  });
  entries.push({
    path: "_rels/.rels",
    data: b(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
  });

  return packZip(entries);
}
