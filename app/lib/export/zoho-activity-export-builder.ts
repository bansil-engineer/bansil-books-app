// ============================================================
// Bansil Books Analytics — Zoho Activity Export Builder (Excel & PDF)
// Pure Node OpenXML & PDF 1.4 · Local Only · Zero Zoho Calls
// ============================================================

import * as zlib from "zlib";
import type { ZohoActivityLogRecord } from "../db/database.ts";
import { ZOHO_ACTIVITY_CONFIG, getDefaultFieldsForReport, type ExportFieldConfig } from "./export-field-config.ts";

// ─────────────────────────────────────────────────────────────
// ZIP / OpenXML plumbing for Excel (.xlsx)
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

interface ZipEntry {
  path: string;
  data: Buffer;
}

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
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(c32, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    lh.writeUInt16LE(0, 28);
    nameB.copy(lh, 30);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(c32, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameB.copy(cd, 46);
    locals.push(lh, comp);
    cds.push(cd);
    offset += lh.length + comp.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

function xmlEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getColLetter(colIdx: number): string {
  let s = "";
  let n = colIdx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface ZohoActivityExportOptions {
  selectedFields?: string[];
  financialYear?: string;
  period?: string;
}

/**
 * Resolves fields based on user selection or defaults from ZOHO_ACTIVITY_CONFIG.
 * Explicit user selection overrides defaults.
 */
function resolveExportFields(selectedFields?: string[]): ExportFieldConfig[] {
  const allFields = ZOHO_ACTIVITY_CONFIG.fields;
  if (selectedFields && selectedFields.length > 0) {
    const chosenSet = new Set(selectedFields);
    const filtered = allFields.filter((f) => chosenSet.has(f.key));
    return filtered.length > 0 ? filtered : allFields.filter((f) => f.defaultSelected);
  }
  return allFields.filter((f) => f.defaultSelected);
}

/**
 * Formats one field's export cell value. The "time" column needs its own honest
 * placeholder rather than a blank cell or a generic "—": Zoho's Activity Logs API never
 * returns a time-of-day at all, so an absent value here is a confirmed fact about the
 * source, not missing data — and it must never be confused with an actual (fabricated)
 * timestamp.
 */
function formatExportFieldValue(key: string, rawVal: unknown, emptyPlaceholder: string): string {
  const hasValue = rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "";
  if (hasValue) return String(rawVal);
  if (key === "time") return "Time not provided by Zoho API";
  return emptyPlaceholder;
}

/**
 * Builds an Excel (.xlsx) workbook for Zoho Activity Logs.
 */
export function buildZohoActivityExcel(
  activities: ZohoActivityLogRecord[],
  options: ZohoActivityExportOptions = {}
): Buffer {
  const fields = resolveExportFields(options.selectedFields);
  const period = options.period || options.financialYear || "Current FY (2026-27)";

  // Worksheet rows
  const rowXmls: string[] = [];

  // Title row (Row 1)
  rowXmls.push(
    `<row r="1" ht="28" customHeight="1">` +
      `<c r="A1" t="inlineStr" s="1"><is><t>${xmlEscape("BANSIL BOOKS ANALYTICS — ZOHO BOOKS ACTIVITY LOGS")}</t></is></c>` +
      `</row>`
  );

  // Subtitle row (Row 2)
  rowXmls.push(
    `<row r="2" ht="20" customHeight="1">` +
      `<c r="A2" t="inlineStr" s="2"><is><t>${xmlEscape(`Period: ${period} | Total Records: ${activities.length} | Generated: ${new Date().toISOString()}`)}</t></is></c>` +
      `</row>`
  );

  // Blank row (Row 3)
  rowXmls.push(`<row r="3" ht="10" customHeight="1"></row>`);

  // Header row (Row 4)
  const headerCells = fields.map((f, idx) => {
    const colRef = `${getColLetter(idx)}4`;
    return `<c r="${colRef}" t="inlineStr" s="3"><is><t>${xmlEscape(f.label)}</t></is></c>`;
  });
  rowXmls.push(`<row r="4" ht="22" customHeight="1">${headerCells.join("")}</row>`);

  // Data rows (Row 5 onwards)
  let rowNum = 5;
  for (const act of activities) {
    const cells: string[] = [];
    fields.forEach((f, idx) => {
      const colRef = `${getColLetter(idx)}${rowNum}`;
      const strVal = formatExportFieldValue(f.key, (act as any)[f.key], "");
      cells.push(`<c r="${colRef}" t="inlineStr" s="4"><is><t>${xmlEscape(strVal)}</t></is></c>`);
    });
    rowXmls.push(`<row r="${rowNum}" ht="18" customHeight="1">${cells.join("")}</row>`);
    rowNum++;
  }

  // Column width definitions
  const colDefs = fields
    .map((f, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${Math.max(12, f.widthHint || 16)}" customWidth="1"/>`)
    .join("");

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n` +
    `<cols>${colDefs}</cols>\n` +
    `<sheetData>${rowXmls.join("")}</sheetData>\n` +
    `</worksheet>`;

  // Shared OpenXML files
  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="xml" ContentType="application/xml"/>\n` +
    `  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n` +
    `  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n` +
    `  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n` +
    `  <sheets>\n` +
    `    <sheet name="Zoho Activity Logs" sheetId="1" r:id="rId1"/>\n` +
    `  </sheets>\n` +
    `</workbook>`;

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n` +
    `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n` +
    `</Relationships>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n` +
    `  <fonts count="4">\n` +
    `    <font><sz val="10"/><name val="Arial"/></font>\n` +
    `    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Arial"/></font>\n` +
    `    <font><i/><sz val="9.5"/><color rgb="FF475569"/><name val="Arial"/></font>\n` +
    `    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>\n` +
    `  </fonts>\n` +
    `  <fills count="3">\n` +
    `    <fill><patternFill patternType="none"/></fill>\n` +
    `    <fill><patternFill patternType="gray125"/></fill>\n` +
    `    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>\n` +
    `  </fills>\n` +
    `  <borders count="2">\n` +
    `    <border><left/><right/><top/><bottom/></border>\n` +
    `    <border>` +
    `      <left style="thin"><color rgb="FFE2E8F0"/></left>` +
    `      <right style="thin"><color rgb="FFE2E8F0"/></right>` +
    `      <top style="thin"><color rgb="FFE2E8F0"/></top>` +
    `      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>` +
    `    </border>\n` +
    `  </borders>\n` +
    `  <cellStyleXfs count="1">\n` +
    `    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>\n` +
    `  </cellStyleXfs>\n` +
    `  <cellXfs count="5">\n` +
    `    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n` +
    `    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>\n` + // 1: Title
    `    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>\n` + // 2: Subtitle
    `    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>\n` + // 3: Header
    `    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>\n` + // 4: Data
    `  </cellXfs>\n` +
    `</styleSheet>`;

  return packZip([
    { path: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { path: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { path: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    { path: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);
}

// ─────────────────────────────────────────────────────────────
// PDF 1.4 Generation Plumbing
// ─────────────────────────────────────────────────────────────
const PAGE_WIDTH = 841.89; // Landscape A4
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 36;
const TOP_MARGIN = 36;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function escapePdfText(v: unknown): string {
  let s = String(v ?? "");
  s = s.replace(/[\u2014\u2015\u2012\u2013]/g, "-");
  s = s.replace(/[^\x20-\x7E]/g, " ");
  s = s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  return s.trim();
}

/**
 * Builds a valid PDF 1.4 document for Zoho Activity Logs.
 */
export function buildZohoActivityPdf(
  activities: ZohoActivityLogRecord[],
  options: ZohoActivityExportOptions = {}
): Buffer {
  const fields = resolveExportFields(options.selectedFields);
  const period = options.period || options.financialYear || "Current FY (2026-27)";

  const pages: { stream: string }[] = [];
  let currentStream = "";
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  function newPage() {
    if (currentStream) {
      pages.push({ stream: currentStream });
    }
    currentStream = "";
    currentY = PAGE_HEIGHT - TOP_MARGIN;
  }

  function drawHeader(pageNum: number, totalPages: number) {
    // Title
    currentStream += `0 0 0 rg\n`;
    currentStream += `BT /F2 13 Tf ${MARGIN_X} ${currentY} Td (${escapePdfText("BANSIL BOOKS ANALYTICS — ZOHO BOOKS ACTIVITY LOGS")}) Tj ET\n`;
    currentY -= 14;

    // Subtitle & period
    currentStream += `0.3 0.3 0.3 rg\n`;
    const sub = `Period: ${period} | Total Records: ${activities.length} | Local SQLite Cache | Page ${pageNum} of ${totalPages}`;
    currentStream += `BT /F1 8.5 Tf ${MARGIN_X} ${currentY} Td (${escapePdfText(sub)}) Tj ET\n`;
    currentY -= 14;

    // Line
    currentStream += `0.8 0.8 0.8 RG 1 w\n${MARGIN_X} ${currentY} m ${PAGE_WIDTH - MARGIN_X} ${currentY} l S\n`;
    currentY -= 12;
  }

  // Calculate dynamic column widths to fit USABLE_WIDTH exactly
  const totalHint = fields.reduce((sum, f) => sum + (f.widthHint || 16), 0);
  const colWidths = fields.map((f) => ((f.widthHint || 16) / totalHint) * USABLE_WIDTH);

  function drawTableHeaders() {
    currentStream += `0.06 0.09 0.16 rg ${MARGIN_X} ${currentY - 14} ${USABLE_WIDTH} 16 re f\n`;
    currentStream += `1 1 1 rg\n`;
    let curX = MARGIN_X;
    fields.forEach((f, idx) => {
      const w = colWidths[idx];
      currentStream += `BT /F2 7.5 Tf ${curX + 3} ${currentY - 10} Td (${escapePdfText(f.label)}) Tj ET\n`;
      curX += w;
    });
    currentY -= 18;
  }

  // Split into pages of ~25 rows
  const rowsPerPage = 24;
  const totalPages = Math.max(1, Math.ceil(activities.length / rowsPerPage));

  for (let p = 0; p < totalPages; p++) {
    newPage();
    drawHeader(p + 1, totalPages);
    drawTableHeaders();

    const pageSlice = activities.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    let rowIdx = 0;

    for (const act of pageSlice) {
      const bg = rowIdx % 2 === 0 ? "1 1 1" : "0.97 0.98 0.99";
      currentStream += `${bg} rg ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 14 re f\n`;
      currentStream += `0.9 0.9 0.9 RG 0.5 w ${MARGIN_X} ${currentY - 12} ${USABLE_WIDTH} 14 re S\n`;

      currentStream += `0.1 0.1 0.1 rg\n`;
      let curX = MARGIN_X;
      fields.forEach((f, idx) => {
        const w = colWidths[idx];
        const text = escapePdfText(formatExportFieldValue(f.key, (act as any)[f.key], "—"));
        currentStream += `BT /F1 7 Tf ${curX + 3} ${currentY - 9} Td (${text.slice(0, 35)}) Tj ET\n`;
        curX += w;
      });

      currentY -= 14;
      rowIdx++;
    }
  }

  if (currentStream) {
    pages.push({ stream: currentStream });
  }

  // Assemble PDF 1.4 objects
  const objects: string[] = [];
  objects.push(""); // 1-based index

  // 1: Catalog
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);

  // 2: Pages root (placeholder)
  const pageObjectIndices: number[] = [];
  objects.push(""); // slot 2

  // 3: Font regular (Helvetica)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  // 4: Font bold (Helvetica-Bold)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);

  let nextObj = 5;
  for (const page of pages) {
    const streamLen = Buffer.byteLength(page.stream, "utf8");
    const streamObjIdx = nextObj++;
    const pageObjIdx = nextObj++;

    objects[streamObjIdx] = `<< /Length ${streamLen} >>\nstream\n${page.stream}\nendstream`;
    objects[pageObjIdx] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]\n` +
      `   /Contents ${streamObjIdx} 0 R\n` +
      `   /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>\n` +
      `>>`;
    pageObjectIndices.push(pageObjIdx);
  }

  // Fill in Pages root (object 2)
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectIndices.map((i) => `${i} 0 R`).join(" ")}]\n` +
    `   /Count ${pageObjectIndices.length}\n` +
    `>>`;

  // Build PDF buffer
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}
