// ============================================================
// Bansil Books Analytics — Customer Material Control PDF Builder
// A4 Landscape · Site-Friendly Practical Format
// Pure Node PDF 1.4 Generation · Zero external libraries
// ============================================================

import type { CustomerMaterialControlReport } from "../customer-material-control-engine.ts";
import { formatDisplayDate, formatDisplayDateTime } from "../date-utils.ts";

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 36;
const TOP_MARGIN = 36;
const BOTTOM_MARGIN = 36;
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

function formatDisplayQty(qty: number | string): string {
  const n = Number(qty);
  if (isNaN(n) || Math.abs(n) < 0.001) return "0";
  const rounded = parseFloat(n.toFixed(3));
  if (Math.abs(rounded) < 0.001) return "0";
  return String(rounded);
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
      if (word.length > maxCharsPerLine) {
        currentLine = word.slice(0, maxCharsPerLine);
      } else {
        currentLine = word;
      }
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

export interface CustomerMaterialPdfOptions {
  selectedFields?: string[];
  includeTotals?: boolean;
}

export function buildCustomerMaterialPdf(
  report: CustomerMaterialControlReport,
  _options?: CustomerMaterialPdfOptions
): Buffer {
  if (!report || !report.customer || !report.items || report.items.length === 0) {
    throw new Error("PDF export failed: report data is empty.");
  }

  const { summary, items } = report;
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

  function drawText(text: string, x: number, y: number, size = 10, isBold = false, r = 0, g = 0, b = 0) {
    const fontName = isBold ? "/F2" : "/F1";
    currentStream += `BT ${fontName} ${size} Tf ${r} ${g} ${b} rg ${x} ${y} Td (${esc(text)}) Tj ET\n`;
  }

  function drawRect(x: number, y: number, w: number, h: number, r = 0.95, g = 0.95, b = 0.95, fill = true, stroke = false) {
    currentStream += `${r} ${g} ${b} rg\n`;
    if (fill) {
      currentStream += `${x} ${y} ${w} ${h} re f\n`;
    }
    if (stroke) {
      currentStream += `0.8 0.8 0.8 RG 0.5 w ${x} ${y} ${w} ${h} re s\n`;
    }
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number, r = 0.8, g = 0.8, b = 0.8, w = 0.5) {
    currentStream += `${r} ${g} ${b} RG ${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
  }

  function renderHeader(pageNum: number, totalPagesEst: number) {
    // Top banner
    drawRect(MARGIN_X, PAGE_HEIGHT - 48, USABLE_WIDTH, 32, 0.06, 0.46, 0.43, true);
    drawText("BANSIL ENGINEERS", MARGIN_X + 12, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
    drawText("CUSTOMER MATERIAL CONTROL REPORT", MARGIN_X + 160, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
    drawText("Prepared for: Site Engineer / Site In-charge", MARGIN_X + USABLE_WIDTH - 220, PAGE_HEIGHT - 32, 9, false, 0.9, 0.9, 0.9);

    // Customer & Period subheader
    currentY = PAGE_HEIGHT - 65;
    drawText(`Customer: ${summary.customer_name} (${summary.customer_id})`, MARGIN_X, currentY, 10, true, 0.1, 0.15, 0.2);
    drawText(`Period: ${summary.period_label} (${summary.from_date} to ${summary.to_date})`, MARGIN_X + 380, currentY, 9, false, 0.3, 0.35, 0.4);
    drawText(`Generated: ${formatDisplayDateTime(new Date().toISOString())}`, MARGIN_X + USABLE_WIDTH - 140, currentY, 8, false, 0.4, 0.4, 0.4);
    drawLine(MARGIN_X, currentY - 6, MARGIN_X + USABLE_WIDTH, currentY - 6);
    currentY -= 18;
  }

  // ---- Page 1: Overview & KPIs ----
  newPage();
  renderHeader(1, 4);

  // Top Summary Cards Grid
  const cardW = (USABLE_WIDTH - 24) / 4;
  const cardH = 46;

  const kpiList = [
    { label: "TOTAL ITEMS", val: String(summary.total_items), col: [0.06, 0.46, 0.43] },
    { label: "PURCHASE QTY", val: formatDisplayQty(summary.total_purchase_qty), col: [0.1, 0.3, 0.6] },
    { label: "INVOICED / SALES QTY", val: formatDisplayQty(summary.total_sales_qty), col: [0.1, 0.4, 0.3] },
    { label: "RECONCILED QTY", val: formatDisplayQty(summary.total_reconciled_qty), col: [0.1, 0.6, 0.2] },
    { label: "BALANCE TO INVOICE", val: formatDisplayQty(summary.total_balance_material_to_invoice), col: [0.8, 0.4, 0.0] },
    { label: "SHORTFALL TO PURCHASE", val: formatDisplayQty(summary.total_shortfall_material_to_purchase), col: [0.85, 0.15, 0.15] },
    { label: "APPROX REQUIREMENT VALUE", val: `Rs. ${Math.round(summary.total_approx_purchase_requirement_value).toLocaleString("en-IN")}`, col: [0.8, 0.1, 0.1] },
    { label: "UNMAPPED PURCHASE QTY", val: `${formatDisplayQty(summary.unmapped_purchase_qty)} (${summary.unmapped_purchase_lines_count} lines)`, col: [0.5, 0.5, 0.5] },
  ];

  for (let i = 0; i < kpiList.length; i++) {
    const r = Math.floor(i / 4);
    const c = i % 4;
    const x = MARGIN_X + c * (cardW + 8);
    const y = currentY - (r + 1) * (cardH + 8);
    drawRect(x, y, cardW, cardH, 0.98, 0.98, 0.99, true, true);
    drawText(kpiList[i].label, x + 8, y + cardH - 14, 8, true, 0.4, 0.45, 0.5);
    drawText(kpiList[i].val, x + 8, y + 10, 11, true, kpiList[i].col[0], kpiList[i].col[1], kpiList[i].col[2]);
  }
  currentY -= 2 * (cardH + 8) + 12;

  // Helper to render table sections
  function renderTableSection(
    title: string,
    cols: Array<{ hdr: string; w: number; align?: "left" | "right" | "center" }>,
    rows: Array<Array<string | number | string[]>>,
    sectionBg = [0.06, 0.46, 0.43]
  ) {
    if (currentY < 120) {
      newPage();
      renderHeader(pages.length + 1, 4);
    }

    // Section title banner
    drawRect(MARGIN_X, currentY - 18, USABLE_WIDTH, 18, sectionBg[0], sectionBg[1], sectionBg[2], true);
    drawText(title, MARGIN_X + 8, currentY - 14, 9, true, 1, 1, 1);
    currentY -= 22;

    // Header row
    drawRect(MARGIN_X, currentY - 16, USABLE_WIDTH, 16, 0.93, 0.94, 0.96, true);
    let curX = MARGIN_X;
    for (const c of cols) {
      drawText(c.hdr, curX + 4, currentY - 12, 8, true, 0.2, 0.25, 0.3);
      curX += c.w;
    }
    currentY -= 18;

    if (rows.length === 0) {
      drawText("No items in this section.", MARGIN_X + 8, currentY - 12, 8, false, 0.5, 0.5, 0.5);
      currentY -= 18;
      return;
    }

    // Rows
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];

      // Determine max lines in this row for dynamic height
      let maxLinesInRow = 1;
      for (const cell of row) {
        if (Array.isArray(cell) && cell.length > maxLinesInRow) {
          maxLinesInRow = cell.length;
        }
      }
      const rowHeight = maxLinesInRow > 1 ? 26 : 16;
      const rectH = rowHeight - 2;

      if (currentY - rowHeight < 40) {
        newPage();
        renderHeader(pages.length + 1, 4);
        // re-render header
        drawRect(MARGIN_X, currentY - 16, USABLE_WIDTH, 16, 0.93, 0.94, 0.96, true);
        let rx = MARGIN_X;
        for (const c of cols) {
          drawText(c.hdr, rx + 4, currentY - 12, 8, true, 0.2, 0.25, 0.3);
          rx += c.w;
        }
        currentY -= 18;
      }

      if (r % 2 === 1) {
        drawRect(MARGIN_X, currentY - rectH, USABLE_WIDTH, rectH, 0.98, 0.98, 0.99, true);
      }

      let cx = MARGIN_X;
      for (let c = 0; c < cols.length; c++) {
        const cellVal = row[c];
        const lines = Array.isArray(cellVal) ? cellVal : [String(cellVal ?? "")];
        for (let l = 0; l < lines.length; l++) {
          const textY = maxLinesInRow > 1
            ? (l === 0 ? currentY - 10 : currentY - 20)
            : currentY - 10;
          drawText(lines[l], cx + 4, textY, 8, false, 0.1, 0.1, 0.1);
        }
        cx += cols[c].w;
      }
      drawLine(MARGIN_X, currentY - rectH, MARGIN_X + USABLE_WIDTH, currentY - rectH, 0.92, 0.92, 0.92);
      currentY -= rowHeight;
    }
    currentY -= 10;
  }

  // ---- SECTION A: BALANCE MATERIAL TO INVOICE ----
  const secAItems = items.filter((it) => it.balance_material_to_invoice > 0);
  const colsA = [
    { hdr: "Item Name", w: 220 },
    { hdr: "SKU", w: 80 },
    { hdr: "Purchase Qty", w: 80 },
    { hdr: "Invoiced Qty", w: 80 },
    { hdr: "Balance to Invoice", w: 100 },
    { hdr: "Latest Rate", w: 80 },
    { hdr: "Status", w: 129 },
  ];
  const rowsA = secAItems.map((it) => [
    wrapText(it.item_name, 215, 4.8, 2),
    it.sku || "—",
    formatDisplayQty(it.purchase_qty),
    formatDisplayQty(it.sales_qty),
    formatDisplayQty(it.balance_material_to_invoice),
    it.latest_sales_rate ? `Rs. ${it.latest_sales_rate.toFixed(2)}` : "N/A",
    it.status,
  ]);
  renderTableSection("SECTION A: BALANCE MATERIAL TO INVOICE (Purchased but not yet Invoiced)", colsA, rowsA, [0.8, 0.4, 0.0]);

  // ---- SECTION B: SHORTFALL MATERIAL TO PURCHASE ----
  const secBItems = items.filter((it) => it.shortfall_material_to_purchase > 0);
  const colsB = [
    { hdr: "Item Name", w: 175 },
    { hdr: "SKU", w: 55 },
    { hdr: "Invoiced Qty", w: 55 },
    { hdr: "Purchase Qty", w: 55 },
    { hdr: "Shortfall Qty", w: 60 },
    { hdr: "Latest Rate", w: 75 },
    { hdr: "Approx Req", w: 75 },
    { hdr: "Latest Vendor", w: 219 },
  ];
  const rowsB = secBItems.map((it) => [
    wrapText(it.item_name, 170, 4.8, 2),
    it.sku || "—",
    formatDisplayQty(it.sales_qty),
    formatDisplayQty(it.purchase_qty),
    formatDisplayQty(it.shortfall_material_to_purchase),
    it.latest_purchase_rate ? `Rs. ${it.latest_purchase_rate.toFixed(2)}` : "N/A",
    it.approx_shortfall_value ? `Rs. ${Math.round(it.approx_shortfall_value).toLocaleString("en-IN")}` : "N/A",
    wrapText(it.latest_purchase_vendor || "—", 215, 4.8, 2),
  ]);
  renderTableSection("SECTION B: SHORTFALL MATERIAL TO PURCHASE (Invoiced without Purchase Coverage)", colsB, rowsB, [0.85, 0.15, 0.15]);

  // ---- SECTION C: RECONCILED SUMMARY ----
  const secCItems = items.filter((it) => it.status === "RECONCILED");
  const colsC = [
    { hdr: "Item Name", w: 250 },
    { hdr: "SKU", w: 90 },
    { hdr: "Purchase Qty", w: 80 },
    { hdr: "Invoiced Qty", w: 80 },
    { hdr: "Reconciled Qty", w: 90 },
    { hdr: "Status", w: 179 },
  ];
  const rowsC = secCItems.map((it) => [
    wrapText(it.item_name, 245, 4.8, 2),
    it.sku || "—",
    formatDisplayQty(it.purchase_qty),
    formatDisplayQty(it.sales_qty),
    formatDisplayQty(it.reconciled_qty),
    "RECONCILED",
  ]);
  renderTableSection("SECTION C: RECONCILED SUMMARY (Balanced Items)", colsC, rowsC, [0.1, 0.5, 0.2]);

  // Final push of last page
  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Assemble Standard PDF 1.4 Binary Objects
  const totalPages = pages.length;
  if (totalPages === 0) {
    throw new Error("PDF export failed: report data is empty.");
  }

  const objects: string[] = [];
  const pageObjIds: number[] = [];

  // 1: Catalog
  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;

  // 3: Font F1 (Helvetica)
  objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  // 4: Font F2 (Helvetica-Bold)
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 5;
  for (let p = 0; p < totalPages; p++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    // Add page footer with page number
    const pageFooter = `BT /F1 8 Tf 0.4 0.4 0.4 rg ${MARGIN_X} 20 Td (Page ${p + 1} of ${totalPages} | BANSIL ENGINEERS - CONFIDENTIAL FIELD CONTROL DOCUMENT) Tj ET\n`;
    const fullContent = pages[p].stream + pageFooter;
    const contentLen = Buffer.byteLength(fullContent, "utf8");

    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${contentLen} >>\nstream\n${fullContent}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`;
  }

  // 2: Pages root
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
  if (pdfBuf.length < 2000) {
    throw new Error("PDF export failed: generated PDF is unexpectedly small or incomplete.");
  }

  return pdfBuf;
}

export interface AllPendingCustomersPdfOptions {
  periodLabel: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  unmappedLinesCount?: number;
  unmappedQty?: number;
}

export function buildAllPendingCustomersPdf(
  reports: CustomerMaterialControlReport[],
  options: AllPendingCustomersPdfOptions
): Buffer {
  if (!reports || reports.length === 0) {
    throw new Error("PDF export failed: report data is empty.");
  }

  // Filter out any reports that have zero pending items
  const validReports = reports.filter((r) => {
    if (!r || !r.items) return false;
    const hasBalance = r.items.some((it) => it.balance_material_to_invoice > 0.001);
    const hasShortfall = r.items.some((it) => it.shortfall_material_to_purchase > 0.001);
    return hasBalance || hasShortfall;
  });

  if (validReports.length === 0) {
    throw new Error("PDF export failed: no pending customers found with outstanding balance or shortfall.");
  }

  // Aggregate metrics for cover page
  let totalPendingBalance = 0;
  let totalPendingShortfall = 0;
  let totalPendingApproxReq = 0;
  for (const r of validReports) {
    totalPendingBalance += r.summary.total_balance_material_to_invoice;
    totalPendingShortfall += r.summary.total_shortfall_material_to_purchase;
    totalPendingApproxReq += r.summary.total_approx_purchase_requirement_value;
  }

  const pages: Array<{ stream: string; customerTag: string }> = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;
  let currentTag = "PENDING CUSTOMER SUMMARY";

  function newPage(tag = currentTag) {
    if (currentStream) {
      pages.push({ stream: currentStream, customerTag: currentTag });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
    currentTag = tag;
  }

  function drawText(text: string, x: number, y: number, size = 10, isBold = false, r = 0, g = 0, b = 0) {
    const fontName = isBold ? "/F2" : "/F1";
    currentStream += `BT ${fontName} ${size} Tf ${r} ${g} ${b} rg ${x} ${y} Td (${esc(text)}) Tj ET\n`;
  }

  function drawRect(x: number, y: number, w: number, h: number, r = 0.95, g = 0.95, b = 0.95, fill = true, stroke = false) {
    currentStream += `${r} ${g} ${b} rg\n`;
    if (fill) {
      currentStream += `${x} ${y} ${w} ${h} re f\n`;
    }
    if (stroke) {
      currentStream += `0.8 0.8 0.8 RG 0.5 w ${x} ${y} ${w} ${h} re s\n`;
    }
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number, r = 0.8, g = 0.8, b = 0.8, w = 0.5) {
    currentStream += `${r} ${g} ${b} RG ${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
  }

  // ==========================================
  // PAGE 1: INDEX / SUMMARY OF PENDING CUSTOMERS
  // ==========================================
  newPage("PENDING CUSTOMER SUMMARY");

  function renderIndexHeader() {
    drawRect(MARGIN_X, PAGE_HEIGHT - 48, USABLE_WIDTH, 32, 0.06, 0.46, 0.43, true);
    drawText("BANSIL ENGINEERS", MARGIN_X + 12, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
    drawText("CUSTOMER MATERIAL CONTROL REPORT — PENDING CUSTOMER SUMMARY", MARGIN_X + 160, PAGE_HEIGHT - 32, 11, true, 1, 1, 1);

    currentY = PAGE_HEIGHT - 65;
    drawText(`Period: ${options.periodLabel || "ALL"}`, MARGIN_X, currentY, 10, true, 0.1, 0.15, 0.2);
    drawText(`Pending Customers: ${validReports.length}`, MARGIN_X + 340, currentY, 9, false, 0.3, 0.35, 0.4);
    drawText(`Generated: ${formatDisplayDateTime(new Date().toISOString())}`, MARGIN_X + USABLE_WIDTH - 140, currentY, 8, false, 0.4, 0.4, 0.4);
    drawLine(MARGIN_X, currentY - 6, MARGIN_X + USABLE_WIDTH, currentY - 6);
    currentY -= 18;
  }

  renderIndexHeader();

  // Top Summary Cards Grid
  const cardW = (USABLE_WIDTH - 24) / 4;
  const cardH = 46;

  const kpis = [
    { label: "PENDING CUSTOMERS", val: String(validReports.length), col: [0.06, 0.46, 0.43] },
    { label: "TOTAL BALANCE TO INVOICE", val: formatDisplayQty(totalPendingBalance), col: [0.8, 0.4, 0.0] },
    { label: "TOTAL SHORTFALL TO PURCHASE", val: formatDisplayQty(totalPendingShortfall), col: [0.85, 0.15, 0.15] },
    { label: "APPROX REQUIREMENT VALUE", val: `Rs. ${Math.round(totalPendingApproxReq).toLocaleString("en-IN")}`, col: [0.8, 0.1, 0.1] },
  ];

  for (let i = 0; i < kpis.length; i++) {
    const x = MARGIN_X + i * (cardW + 8);
    const y = currentY - (cardH + 8);
    drawRect(x, y, cardW, cardH, 0.98, 0.98, 0.99, true, true);
    drawText(kpis[i].label, x + 8, y + cardH - 14, 8, true, 0.4, 0.45, 0.5);
    drawText(kpis[i].val, x + 8, y + 10, 11, true, kpis[i].col[0], kpis[i].col[1], kpis[i].col[2]);
  }
  currentY -= cardH + 20;

  // Unmapped line warning note if present
  if (options.unmappedQty && options.unmappedQty > 0) {
    drawRect(MARGIN_X, currentY - 14, USABLE_WIDTH, 14, 0.98, 0.95, 0.9, true);
    drawText(
      `Notice: System has ${options.unmappedLinesCount || 0} unmapped purchase lines (Qty: ${formatDisplayQty(options.unmappedQty)}) with missing customer details. These are tracked separately and not attributed to any customer.`,
      MARGIN_X + 6,
      currentY - 10,
      7.5,
      false,
      0.6,
      0.3,
      0.0
    );
    currentY -= 18;
  }

  // Summary Table Header
  const indexCols = [
    { hdr: "Sr.", w: 34 },
    { hdr: "Customer Name", w: 310 },
    { hdr: "Balance Material to Invoice", w: 135 },
    { hdr: "Shortfall Material to Purchase", w: 140 },
    { hdr: "Approx Requirement Value", w: 150 },
  ];

  drawRect(MARGIN_X, currentY - 16, USABLE_WIDTH, 16, 0.93, 0.94, 0.96, true);
  let curIX = MARGIN_X;
  for (const c of indexCols) {
    drawText(c.hdr, curIX + 4, currentY - 12, 8, true, 0.2, 0.25, 0.3);
    curIX += c.w;
  }
  currentY -= 18;

  for (let idx = 0; idx < validReports.length; idx++) {
    const r = validReports[idx];
    if (currentY < 45) {
      newPage("PENDING CUSTOMER SUMMARY");
      renderIndexHeader();
      drawRect(MARGIN_X, currentY - 16, USABLE_WIDTH, 16, 0.93, 0.94, 0.96, true);
      let rx = MARGIN_X;
      for (const c of indexCols) {
        drawText(c.hdr, rx + 4, currentY - 12, 8, true, 0.2, 0.25, 0.3);
        rx += c.w;
      }
      currentY -= 18;
    }

    if (idx % 2 === 1) {
      drawRect(MARGIN_X, currentY - 14, USABLE_WIDTH, 14, 0.98, 0.98, 0.99, true);
    }

    let cx = MARGIN_X;
    // Sr.
    drawText(String(idx + 1), cx + 4, currentY - 10, 8, false, 0.1, 0.1, 0.1);
    cx += indexCols[0].w;
    // Customer Name
    drawText(r.customer.name.slice(0, 48), cx + 4, currentY - 10, 8, true, 0.1, 0.15, 0.2);
    cx += indexCols[1].w;
    // Balance to Invoice
    drawText(formatDisplayQty(r.summary.total_balance_material_to_invoice), cx + 4, currentY - 10, 8, false, 0.8, 0.4, 0.0);
    cx += indexCols[2].w;
    // Shortfall to Purchase
    drawText(formatDisplayQty(r.summary.total_shortfall_material_to_purchase), cx + 4, currentY - 10, 8, false, 0.85, 0.15, 0.15);
    cx += indexCols[3].w;
    // Approx Req Value
    drawText(r.summary.total_approx_purchase_requirement_value > 0 ? `Rs. ${Math.round(r.summary.total_approx_purchase_requirement_value).toLocaleString("en-IN")}` : "—", cx + 4, currentY - 10, 8, false, 0.1, 0.1, 0.1);

    drawLine(MARGIN_X, currentY - 14, MARGIN_X + USABLE_WIDTH, currentY - 14, 0.92, 0.92, 0.92);
    currentY -= 16;
  }

  // ==========================================
  // CUSTOMER REPORT SECTIONS (ONE PER NEW PAGE)
  // ==========================================
  for (const rep of validReports) {
    const { summary, items } = rep;
    const secAItems = items.filter((it) => it.balance_material_to_invoice > 0.001);
    const secBItems = items.filter((it) => it.shortfall_material_to_purchase > 0.001);

    // CRITICAL: Every customer starts on a brand-new page!
    newPage(summary.customer_name);

    function renderCustHeader() {
      drawRect(MARGIN_X, PAGE_HEIGHT - 48, USABLE_WIDTH, 32, 0.06, 0.46, 0.43, true);
      drawText("BANSIL ENGINEERS", MARGIN_X + 12, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
      drawText("CUSTOMER MATERIAL CONTROL REPORT", MARGIN_X + 160, PAGE_HEIGHT - 32, 12, true, 1, 1, 1);
      drawText("Prepared for: Site Engineer / Site In-charge", MARGIN_X + USABLE_WIDTH - 220, PAGE_HEIGHT - 32, 9, false, 0.9, 0.9, 0.9);

      currentY = PAGE_HEIGHT - 65;
      drawText(`Customer: ${summary.customer_name} (${summary.customer_id})`, MARGIN_X, currentY, 10, true, 0.1, 0.15, 0.2);
      drawText(`Period: ${summary.period_label}`, MARGIN_X + 380, currentY, 9, false, 0.3, 0.35, 0.4);
      drawText(`Generated: ${formatDisplayDateTime(new Date().toISOString())}`, MARGIN_X + USABLE_WIDTH - 140, currentY, 8, false, 0.4, 0.4, 0.4);
      drawLine(MARGIN_X, currentY - 6, MARGIN_X + USABLE_WIDTH, currentY - 6);
      currentY -= 18;
    }

    renderCustHeader();

    // Customer KPI Cards Grid (2 rows of 3)
    const custCardW = (USABLE_WIDTH - 16) / 3;
    const custCardH = 40;
    const custKpis = [
      { label: "TOTAL ITEMS", val: String(summary.total_items), col: [0.06, 0.46, 0.43] },
      { label: "PURCHASE QTY", val: formatDisplayQty(summary.total_purchase_qty), col: [0.1, 0.3, 0.6] },
      { label: "INVOICED / SALES QTY", val: formatDisplayQty(summary.total_sales_qty), col: [0.1, 0.4, 0.3] },
      { label: "BALANCE TO INVOICE", val: formatDisplayQty(summary.total_balance_material_to_invoice), col: [0.8, 0.4, 0.0] },
      { label: "SHORTFALL TO PURCHASE", val: formatDisplayQty(summary.total_shortfall_material_to_purchase), col: [0.85, 0.15, 0.15] },
      { label: "APPROX REQUIREMENT VALUE", val: `Rs. ${Math.round(summary.total_approx_purchase_requirement_value).toLocaleString("en-IN")}`, col: [0.8, 0.1, 0.1] },
    ];

    for (let i = 0; i < custKpis.length; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      const x = MARGIN_X + c * (custCardW + 8);
      const y = currentY - (r + 1) * (custCardH + 6);
      drawRect(x, y, custCardW, custCardH, 0.98, 0.98, 0.99, true, true);
      drawText(custKpis[i].label, x + 8, y + custCardH - 12, 7.5, true, 0.4, 0.45, 0.5);
      drawText(custKpis[i].val, x + 8, y + 8, 10.5, true, custKpis[i].col[0], custKpis[i].col[1], custKpis[i].col[2]);
    }
    currentY -= 2 * (custCardH + 6) + 12;

    // Helper to render section
    function renderSection(
      title: string,
      cols: Array<{ hdr: string; w: number }>,
      rows: Array<Array<string | number | string[]>>,
      sectionBg = [0.06, 0.46, 0.43]
    ) {
      if (currentY < 120) {
        newPage(summary.customer_name);
        renderCustHeader();
      }

      drawRect(MARGIN_X, currentY - 18, USABLE_WIDTH, 18, sectionBg[0], sectionBg[1], sectionBg[2], true);
      drawText(title, MARGIN_X + 8, currentY - 14, 9, true, 1, 1, 1);
      currentY -= 22;

      drawRect(MARGIN_X, currentY - 16, USABLE_WIDTH, 16, 0.93, 0.94, 0.96, true);
      let curX = MARGIN_X;
      for (const c of cols) {
        drawText(c.hdr, curX + 4, currentY - 12, 8, true, 0.2, 0.25, 0.3);
        curX += c.w;
      }
      currentY -= 18;

      if (rows.length === 0) {
        drawText("No items in this section.", MARGIN_X + 8, currentY - 12, 8, false, 0.5, 0.5, 0.5);
        currentY -= 18;
        return;
      }

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        let maxLinesInRow = 1;
        for (const cell of row) {
          if (Array.isArray(cell) && cell.length > maxLinesInRow) {
            maxLinesInRow = cell.length;
          }
        }
        const rowHeight = maxLinesInRow > 1 ? 26 : 16;
        const rectH = rowHeight - 2;

        if (currentY - rowHeight < 40) {
          newPage(summary.customer_name);
          renderCustHeader();
          drawRect(MARGIN_X, currentY - 16, USABLE_WIDTH, 16, 0.93, 0.94, 0.96, true);
          let rx = MARGIN_X;
          for (const c of cols) {
            drawText(c.hdr, rx + 4, currentY - 12, 8, true, 0.2, 0.25, 0.3);
            rx += c.w;
          }
          currentY -= 18;
        }

        if (r % 2 === 1) {
          drawRect(MARGIN_X, currentY - rectH, USABLE_WIDTH, rectH, 0.98, 0.98, 0.99, true);
        }

        let cx = MARGIN_X;
        for (let c = 0; c < cols.length; c++) {
          const cellVal = row[c];
          const lines = Array.isArray(cellVal) ? cellVal : [String(cellVal ?? "")];
          for (let l = 0; l < lines.length; l++) {
            const textY = maxLinesInRow > 1
              ? (l === 0 ? currentY - 10 : currentY - 20)
              : currentY - 10;
            drawText(lines[l], cx + 4, textY, 8, false, 0.1, 0.1, 0.1);
          }
          cx += cols[c].w;
        }
        drawLine(MARGIN_X, currentY - rectH, MARGIN_X + USABLE_WIDTH, currentY - rectH, 0.92, 0.92, 0.92);
        currentY -= rowHeight;
      }
      currentY -= 10;
    }

    // SECTION A: BALANCE MATERIAL TO INVOICE
    if (secAItems.length > 0) {
      const colsA = [
        { hdr: "Item Name", w: 220 },
        { hdr: "SKU", w: 80 },
        { hdr: "Purchase Qty", w: 80 },
        { hdr: "Invoiced Qty", w: 80 },
        { hdr: "Balance to Invoice", w: 100 },
        { hdr: "Latest Rate", w: 80 },
        { hdr: "Status", w: 129 },
      ];
      const rowsA = secAItems.map((it) => [
        wrapText(it.item_name, 215, 4.8, 2),
        it.sku || "—",
        formatDisplayQty(it.purchase_qty),
        formatDisplayQty(it.sales_qty),
        formatDisplayQty(it.balance_material_to_invoice),
        it.latest_sales_rate ? `Rs. ${it.latest_sales_rate.toFixed(2)}` : "N/A",
        it.status,
      ]);
      renderSection("SECTION A: BALANCE MATERIAL TO INVOICE (Purchased but not yet Invoiced)", colsA, rowsA, [0.8, 0.4, 0.0]);
    }

    // SECTION B: SHORTFALL MATERIAL TO PURCHASE
    if (secBItems.length > 0) {
      const colsB = [
        { hdr: "Item Name", w: 175 },
        { hdr: "SKU", w: 55 },
        { hdr: "Invoiced Qty", w: 55 },
        { hdr: "Purchase Qty", w: 55 },
        { hdr: "Shortfall Qty", w: 60 },
        { hdr: "Latest Rate", w: 75 },
        { hdr: "Approx Req", w: 75 },
        { hdr: "Latest Vendor", w: 219 },
      ];
      const rowsB = secBItems.map((it) => [
        wrapText(it.item_name, 170, 4.8, 2),
        it.sku || "—",
        formatDisplayQty(it.sales_qty),
        formatDisplayQty(it.purchase_qty),
        formatDisplayQty(it.shortfall_material_to_purchase),
        it.latest_purchase_rate ? `Rs. ${it.latest_purchase_rate.toFixed(2)}` : "N/A",
        it.approx_shortfall_value ? `Rs. ${Math.round(it.approx_shortfall_value).toLocaleString("en-IN")}` : "N/A",
        wrapText(it.latest_purchase_vendor || "—", 215, 4.8, 2),
      ]);
      renderSection("SECTION B: SHORTFALL MATERIAL TO PURCHASE (Invoiced without Purchase Coverage)", colsB, rowsB, [0.85, 0.15, 0.15]);
    }

    // Site Actions details if any item in report has active site remarks
    const siteActionItems = items.filter(it => it.site_remark || it.action_required);
    if (siteActionItems.length > 0) {
      const colsAct = [
        { hdr: "Item Name", w: 200 },
        { hdr: "Action Required", w: 200 },
        { hdr: "Responsible", w: 120 },
        { hdr: "Target Date", w: 90 },
        { hdr: "Status", w: 159 },
      ];
      const rowsAct = siteActionItems.map(it => [
        wrapText(it.item_name, 195, 4.8, 2),
        wrapText(it.action_required || it.site_remark || "—", 195, 4.8, 2),
        it.responsible_person || "—",
        it.target_date || "—",
        it.action_status,
      ]);
      renderSection("SITE ACTIONS & REMARKS", colsAct, rowsAct, [0.2, 0.3, 0.4]);
    }
  }

  // Final push of last page
  if (currentStream) {
    pages.push({ stream: currentStream, customerTag: currentTag });
  }

  const totalPages = pages.length;
  if (totalPages === 0) {
    throw new Error("PDF export failed: report data is empty.");
  }

  const objects: string[] = [];
  const pageObjIds: number[] = [];

  // 1: Catalog
  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  // 3: Font F1 (Helvetica)
  objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  // 4: Font F2 (Helvetica-Bold)
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 5;
  for (let p = 0; p < totalPages; p++) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);

    const tagStr = pages[p].customerTag ? ` | ${esc(pages[p].customerTag)}` : "";
    const pageFooter = `BT /F1 8 Tf 0.4 0.4 0.4 rg ${MARGIN_X} 20 Td (Page ${p + 1} of ${totalPages}${tagStr} | BANSIL ENGINEERS - CONFIDENTIAL FIELD CONTROL DOCUMENT) Tj ET\n`;
    const fullContent = pages[p].stream + pageFooter;
    const contentLen = Buffer.byteLength(fullContent, "utf8");

    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${contentLen} >>\nstream\n${fullContent}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`;
  }

  // 2: Pages root
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
  if (pdfBuf.length < 2000) {
    throw new Error("PDF export failed: generated PDF is unexpectedly small or incomplete.");
  }

  return pdfBuf;
}

