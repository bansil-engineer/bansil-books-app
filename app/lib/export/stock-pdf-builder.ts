// ============================================================
// Bansil Books Analytics — Stock Module PDF Builder
// A4 Landscape · Pure Node PDF 1.4 Generation · Zero Zoho Calls
// ============================================================

import type { StockSummaryResult } from "../stock-engine.ts";
import { formatDisplayDate, formatDisplayDateTime } from "../date-utils.ts";

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 36;
const TOP_MARGIN = 36;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function esc(v: unknown): string {
  let s = String(v ?? "");
  s = s.replace(/₹/g, "Rs. ");
  s = s.replace(/\u20B9/g, "Rs. ");
  s = s.replace(/[\u2014\u2015\u2012\u2013]/g, "-");
  s = s.replace(/[^\x20-\x7E]/g, " ");
  s = s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  return s.trim();
}

function formatDisplayQty(qty: number | string | null | undefined): string {
  const n = Number(qty);
  if (isNaN(n) || Math.abs(n) < 0.001) return "0";
  const rounded = parseFloat(n.toFixed(3));
  if (Math.abs(rounded) < 0.001) return "0";
  return String(rounded);
}

function formatINR(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return `Rs. ${Math.round(val).toLocaleString("en-IN")}`;
}

function wrapText(text: string, maxWidth: number, charWidth = 4.8, maxLines = 2): string[] {
  if (!text) return ["—"];
  const str = String(text).trim();
  const maxCharsPerLine = Math.floor(maxWidth / charWidth);
  if (str.length <= maxCharsPerLine) return [str];

  const words = str.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!currentLine) {
      currentLine = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
    } else if ((currentLine + " " + word).length <= maxCharsPerLine) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      if (lines.length === maxLines - 1) {
        const remaining = words.slice(i).join(" ");
        if (remaining.length > maxCharsPerLine) {
          lines.push(remaining.slice(0, Math.max(0, maxCharsPerLine - 3)) + "...");
        } else {
          lines.push(remaining);
        }
        return lines;
      }
      currentLine = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  return lines;
}

interface PdfPage {
  stream: string;
}

export interface StockPdfExportOptions {
  selectedFields?: string[];
  includeTotals?: boolean;
}

interface ColumnDef {
  key: string;
  header: string;
  widthRatio: number;
  align: "left" | "center" | "right";
  totalSupported: boolean;
  formatValue: (item: any, idx: number) => string;
  formatTotal: (totals: any) => string;
}

const STOCK_PDF_COLUMN_DEFS: Record<string, ColumnDef> = {
  sr: {
    key: "sr",
    header: "Sr.",
    widthRatio: 4,
    align: "center",
    totalSupported: false,
    formatValue: (_, idx) => String(idx + 1),
    formatTotal: () => "TOTAL",
  },
  itemName: {
    key: "itemName",
    header: "Item Name",
    widthRatio: 26,
    align: "left",
    totalSupported: false,
    formatValue: (it) => it.itemName || "—",
    formatTotal: () => "",
  },
  itemId: {
    key: "itemId",
    header: "Item ID",
    widthRatio: 14,
    align: "left",
    totalSupported: false,
    formatValue: (it) => it.itemId || "—",
    formatTotal: () => "",
  },
  sku: {
    key: "sku",
    header: "SKU / Code",
    widthRatio: 12,
    align: "left",
    totalSupported: false,
    formatValue: (it) => it.sku || "—",
    formatTotal: () => "",
  },
  classification: {
    key: "classification",
    header: "Class",
    widthRatio: 9,
    align: "center",
    totalSupported: false,
    formatValue: (it) => it.classification || "—",
    formatTotal: () => "",
  },
  stockStatus: {
    key: "stockStatus",
    header: "Status",
    widthRatio: 10,
    align: "center",
    totalSupported: false,
    formatValue: (it) => it.status || "—",
    formatTotal: () => "",
  },
  purchaseQty: {
    key: "purchaseQty",
    header: "Purch Qty",
    widthRatio: 9,
    align: "right",
    totalSupported: true,
    formatValue: (it) => formatDisplayQty(it.effectivePurchaseQty),
    formatTotal: (t) => formatDisplayQty(t.totalPurchaseQty),
  },
  salesQty: {
    key: "salesQty",
    header: "Sales Qty",
    widthRatio: 9,
    align: "right",
    totalSupported: true,
    formatValue: (it) => formatDisplayQty(it.salesQty),
    formatTotal: (t) => formatDisplayQty(t.totalSalesQty),
  },
  stockQty: {
    key: "stockQty",
    header: "Stock Qty",
    widthRatio: 9,
    align: "right",
    totalSupported: true,
    formatValue: (it) => formatDisplayQty(it.stockQty),
    formatTotal: (t) => formatDisplayQty(t.totalStockQty),
  },
  latestPurchaseRate: {
    key: "latestPurchaseRate",
    header: "Latest Purch Rate",
    widthRatio: 12,
    align: "right",
    totalSupported: false,
    formatValue: (it) => (it.latestPurchaseRate ? formatINR(it.latestPurchaseRate) : "—"),
    formatTotal: () => "",
  },
  latestSalesRate: {
    key: "latestSalesRate",
    header: "Latest Sales Rate",
    widthRatio: 12,
    align: "right",
    totalSupported: false,
    formatValue: (it) => (it.latestSalesRate ? formatINR(it.latestSalesRate) : "—"),
    formatTotal: () => "",
  },
  approxStockValue: {
    key: "approxStockValue",
    header: "Approx Stock Val",
    widthRatio: 14,
    align: "right",
    totalSupported: true,
    formatValue: (it) => (it.approxStockValue !== null && it.approxStockValue !== undefined ? formatINR(it.approxStockValue) : "—"),
    formatTotal: (t) => formatINR(t.totalApproxStockValue),
  },
  customersCount: {
    key: "customersCount",
    header: "Cust",
    widthRatio: 6,
    align: "right",
    totalSupported: false,
    formatValue: (it) => String(it.customerCount || 0),
    formatTotal: () => "",
  },
  billsCount: {
    key: "billsCount",
    header: "Bills",
    widthRatio: 6,
    align: "right",
    totalSupported: false,
    formatValue: (it) => String(it.purchaseBillCount || 0),
    formatTotal: () => "",
  },
  invoicesCount: {
    key: "invoicesCount",
    header: "Invoices",
    widthRatio: 7,
    align: "right",
    totalSupported: false,
    formatValue: (it) => String(it.salesInvoiceCount || 0),
    formatTotal: () => "",
  },
  lastPurchaseDate: {
    key: "lastPurchaseDate",
    header: "Last Purch Date",
    widthRatio: 11,
    align: "center",
    totalSupported: false,
    formatValue: (it) => (it.lastPurchaseDate ? formatDisplayDate(it.lastPurchaseDate) : "—"),
    formatTotal: () => "",
  },
  lastSalesDate: {
    key: "lastSalesDate",
    header: "Last Sales Date",
    widthRatio: 11,
    align: "center",
    totalSupported: false,
    formatValue: (it) => (it.lastSalesDate ? formatDisplayDate(it.lastSalesDate) : "—"),
    formatTotal: () => "",
  },
};

export function buildStockPdf(
  summaryResult: StockSummaryResult,
  periodLabel: string,
  options?: StockPdfExportOptions
): Buffer {
  if (!summaryResult || !summaryResult.items || summaryResult.items.length === 0) {
    throw new Error("PDF export failed: report data is empty.");
  }

  const { items, totals, kpis } = summaryResult;

  // Resolve requested fields preserving exact order
  const fieldKeys: string[] =
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

  const columns: ColumnDef[] = fieldKeys
    .map((k) => STOCK_PDF_COLUMN_DEFS[k])
    .filter((col): col is ColumnDef => Boolean(col));

  if (columns.length === 0) {
    throw new Error("PDF export failed: no valid fields selected.");
  }

  // Calculate proportional column widths
  const totalRatio = columns.reduce((acc, c) => acc + c.widthRatio, 0);
  const colWidths = columns.map((c) => (c.widthRatio / totalRatio) * USABLE_WIDTH);

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

  function drawText(
    text: string,
    x: number,
    y: number,
    size = 9,
    bold = false,
    r = 0,
    g = 0,
    b = 0,
    align: "left" | "center" | "right" = "left",
    colW = 0
  ) {
    const font = bold ? "/F2" : "/F1";
    const clean = esc(text);
    const charW = bold ? size * 0.55 : size * 0.5;
    const textW = clean.length * charW;
    let finalX = x;
    if (align === "right" && colW > 0) {
      finalX = x + colW - textW;
    } else if (align === "center" && colW > 0) {
      finalX = x + (colW - textW) / 2;
    }
    currentStream += `${r} ${g} ${b} rg\n`;
    currentStream += `BT ${font} ${size} Tf ${finalX.toFixed(2)} ${y.toFixed(2)} Td (${clean}) Tj ET\n`;
  }

  function drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r = 0.95,
    g = 0.95,
    b = 0.95,
    fill = true,
    stroke = false
  ) {
    currentStream += `${r} ${g} ${b} rg\n`;
    if (fill) {
      currentStream += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`;
    }
    if (stroke) {
      currentStream += `0.8 0.8 0.8 RG 0.5 w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re s\n`;
    }
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number, r = 0.8, g = 0.8, b = 0.8, w = 0.5) {
    currentStream += `${r} ${g} ${b} RG ${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
  }

  function renderHeader(pageNum: number) {
    // Banner header
    drawRect(MARGIN_X, PAGE_HEIGHT - 48, USABLE_WIDTH, 32, 0.12, 0.23, 0.37, true);
    drawText("BANSIL ENGINEERS", MARGIN_X + 12, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
    drawText("INVENTORY STOCK & VALUATION STATEMENT", MARGIN_X + 160, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
    drawText(`Period: ${periodLabel}`, MARGIN_X + USABLE_WIDTH - 200, PAGE_HEIGHT - 32, 9, false, 0.9, 0.9, 0.9);

    currentY = PAGE_HEIGHT - 62;
    drawText(
      `Active Items: ${kpis.totalActiveItems}  |  Generated: ${formatDisplayDateTime(new Date().toISOString())}  |  Local SQLite Cache`,
      MARGIN_X,
      currentY,
      8.5,
      false,
      0.3,
      0.35,
      0.4
    );
    drawLine(MARGIN_X, currentY - 6, MARGIN_X + USABLE_WIDTH, currentY - 6);
    currentY -= 16;

    // KPI row on page 1
    if (pageNum === 1) {
      const cardW = (USABLE_WIDTH - 18) / 4;
      const cardH = 34;
      const kpiCards = [
        { label: "TOTAL PURCHASE QTY", val: formatDisplayQty(kpis.totalPurchaseQty), r: 0.1, g: 0.3, b: 0.6 },
        { label: "TOTAL SALES QTY", val: formatDisplayQty(kpis.totalSalesQty), r: 0.1, g: 0.4, b: 0.3 },
        { label: "TOTAL STOCK QTY", val: formatDisplayQty(kpis.totalStockQty), r: 0.8, g: 0.4, b: 0.0 },
        { label: "APPROX TOTAL VALUE", val: formatINR(kpis.approxTotalStockValue), r: 0.12, g: 0.23, b: 0.37 },
      ];

      for (let i = 0; i < kpiCards.length; i++) {
        const cx = MARGIN_X + i * (cardW + 6);
        drawRect(cx, currentY - cardH, cardW, cardH, 0.96, 0.97, 0.99, true, true);
        drawText(kpiCards[i].label, cx + 8, currentY - 12, 7.5, true, 0.4, 0.45, 0.5);
        drawText(kpiCards[i].val, cx + 8, currentY - 26, 11, true, kpiCards[i].r, kpiCards[i].g, kpiCards[i].b);
      }
      currentY -= cardH + 14;
    }
  }

  function renderTableHeader() {
    const rowH = 20;
    drawRect(MARGIN_X, currentY - rowH, USABLE_WIDTH, rowH, 0.12, 0.23, 0.37, true);

    let curX = MARGIN_X;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const w = colWidths[i];
      drawText(col.header, curX + 4, currentY - 14, 8, true, 1, 1, 1, col.align, w - 8);
      curX += w;
    }
    currentY -= rowH;
  }

  // ---- Build Pages ----
  newPage();
  renderHeader(1);
  renderTableHeader();

  const ROW_H = 18;
  const MIN_BOTTOM = 40;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    // Check page space
    if (currentY - ROW_H < MIN_BOTTOM) {
      newPage();
      renderHeader(pages.length + 1);
      renderTableHeader();
    }

    const isZebra = idx % 2 === 1;
    if (isZebra) {
      drawRect(MARGIN_X, currentY - ROW_H, USABLE_WIDTH, ROW_H, 0.97, 0.98, 0.99, true, false);
    }
    drawLine(MARGIN_X, currentY - ROW_H, MARGIN_X + USABLE_WIDTH, currentY - ROW_H, 0.9, 0.9, 0.9, 0.3);

    let curX = MARGIN_X;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const w = colWidths[c];
      const valStr = col.formatValue(item, idx);

      if (col.key === "itemName") {
        const wrapped = wrapText(valStr, w - 8, 4.4, 1);
        drawText(wrapped[0], curX + 4, currentY - 13, 7.5, false, 0.1, 0.1, 0.1, col.align, w - 8);
      } else {
        drawText(valStr, curX + 4, currentY - 13, 7.5, false, 0.15, 0.15, 0.15, col.align, w - 8);
      }
      curX += w;
    }

    currentY -= ROW_H;
  }

  // Grand Total Row
  if (options?.includeTotals !== false) {
    if (currentY - ROW_H < MIN_BOTTOM) {
      newPage();
      renderHeader(pages.length + 1);
      renderTableHeader();
    }

    drawRect(MARGIN_X, currentY - ROW_H, USABLE_WIDTH, ROW_H, 0.9, 0.93, 0.97, true, false);
    drawLine(MARGIN_X, currentY, MARGIN_X + USABLE_WIDTH, currentY, 0.12, 0.23, 0.37, 1);
    drawLine(MARGIN_X, currentY - ROW_H, MARGIN_X + USABLE_WIDTH, currentY - ROW_H, 0.12, 0.23, 0.37, 1);

    let curX = MARGIN_X;
    let hasLabel = false;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const w = colWidths[c];

      if (col.key === "sr" || (c === 0 && !hasLabel)) {
        drawText("TOTAL", curX + 4, currentY - 13, 8, true, 0.1, 0.2, 0.4, "center", w - 8);
        hasLabel = true;
      } else if (col.totalSupported) {
        const totVal = col.formatTotal(totals);
        drawText(totVal, curX + 4, currentY - 13, 8, true, 0.1, 0.2, 0.4, col.align, w - 8);
      }
      curX += w;
    }
    currentY -= ROW_H;
  }

  // Push final page
  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  const totalPages = pages.length;
  if (totalPages === 0) {
    throw new Error("PDF export failed: report data is empty.");
  }

  // Assemble PDF 1.4 catalog, pages, and streams
  const objects: string[] = [];
  const pageObjIds: number[] = [];

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 5;
  for (let p = 0; p < totalPages; p++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const pageFooter = `BT /F1 8 Tf 0.4 0.4 0.4 rg ${MARGIN_X} 18 Td (Page ${p + 1} of ${totalPages} | BANSIL ENGINEERS - INVENTORY VALUATION STATEMENT) Tj ET\n`;
    const fullContent = pages[p].stream + pageFooter;
    const contentLen = Buffer.byteLength(fullContent, "utf8");

    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${contentLen} >>\nstream\n${fullContent}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`;
  }

  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdfStr = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdfStr, "utf8");
    pdfStr += objects[i];
  }

  const xrefOffset = Buffer.byteLength(pdfStr, "utf8");
  pdfStr += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdfStr += `${offStr} 00000 n \n`;
  }
  pdfStr += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const pdfBuf = Buffer.from(pdfStr, "utf8");
  if (pdfBuf.length < 1500) {
    throw new Error("PDF export failed: generated PDF is unexpectedly small or incomplete.");
  }

  return pdfBuf;
}
