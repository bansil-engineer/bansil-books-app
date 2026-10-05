// ============================================================
// Bansil Books Analytics — Internal Review Report: PDF Builder
// Milestone D. Renders from the SAME AuditReportData shape the Excel
// builder uses — no independent business logic here. Self-contained
// PDF 1.4 object writer (no third-party dependency), the same
// low-level technique used elsewhere in this app's export layer, kept
// independent from the locked Reports module's own PDF builder.
// ============================================================

import type { AuditReportData } from "./audit-report-data.ts";
import { FINDINGS_FIELDS, ACTIONS_FIELDS, COVERAGE_FIELDS, MATCHING_SUMMARY_FIELDS, type TableFieldConfig } from "../report-field-selector.ts";
import { getFindingCell, getActionCell, getCoverageCell, getMatchingSummaryCell } from "./report-table-values.ts";

export interface TableColumnSelections {
  findings?: string[];
  action_taken?: string[];
  scope_coverage?: string[];
  matching_summary?: string[];
}

const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const TOP_MARGIN = 40;
const BOTTOM_MARGIN = 40;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function sanitize(input: unknown): string {
  if (input === null || input === undefined) return "-";
  let text = String(input);
  text = text.replace(/₹/g, "Rs. ").replace(/[‒-―]/g, "-").replace(/[^\x20-\x7E\n]/g, " ");
  return text.replace(/[ \t]+/g, " ").trim() || "-";
}
function escPdf(text: string): string {
  return sanitize(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function wrapText(text: string, maxChars: number): string[] {
  const clean = sanitize(text);
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur ? cur + " " : "") .length + w.length <= maxChars) {
      cur = cur ? `${cur} ${w}` : w;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ["-"];
}

class PdfPageWriter {
  pages: string[] = [];
  private stream = "";
  private y = PAGE_HEIGHT - TOP_MARGIN;
  private pageIndex = 0;

  get cursorY(): number {
    return this.y;
  }

  newPage(): void {
    if (this.stream) this.pages.push(this.stream);
    this.stream = "";
    this.y = PAGE_HEIGHT - TOP_MARGIN;
    this.pageIndex++;
  }

  ensureSpace(height: number): void {
    if (this.y - height < BOTTOM_MARGIN) this.newPage();
  }

  /** Peeks whether the next `height` of content would overflow the current page, without mutating state. */
  willOverflow(height: number): boolean {
    return this.y - height < BOTTOM_MARGIN;
  }

  text(x: number, size: number, line: string, bold = false, color = "0 0 0"): void {
    const font = bold ? "/F2" : "/F1";
    this.stream += `BT ${font} ${size} Tf ${color} rg ${x} ${this.y - size} Td (${escPdf(line)}) Tj ET\n`;
  }

  advance(amount: number): void {
    this.y -= amount;
  }

  rule(): void {
    this.stream += `0.7 0.7 0.7 RG 0.5 w ${MARGIN_X} ${this.y} m ${MARGIN_X + USABLE_WIDTH} ${this.y} l S\n`;
  }

  heading(title: string): void {
    this.ensureSpace(40);
    this.stream += `0.92 0.94 0.98 rg ${MARGIN_X} ${this.y - 20} ${USABLE_WIDTH} 20 re f\n`;
    this.text(MARGIN_X + 6, 11, title, true, "0.1 0.15 0.4");
    this.advance(26);
  }

  paragraph(label: string, value: string, maxChars = 100): void {
    const lines = wrapText(`${label}: ${value}`, maxChars);
    for (const line of lines) {
      this.ensureSpace(14);
      this.text(MARGIN_X, 9, line);
      this.advance(13);
    }
  }

  /**
   * Renders one HARD-TRUNCATED (never wrapped) cell without moving the
   * cursor's Y — caller advances after the row. A table cell is always a
   * single line: unlike `paragraph`, wrapping a table cell would misalign
   * every following row, so an over-length value is truncated with "..."
   * instead — this is what actually prevents adjacent columns from
   * visually overlapping (the bug a render-only text-extraction check
   * would never catch).
   */
  cell(x: number, value: string, width: number): void {
    const maxChars = Math.max(3, Math.floor(width / 4.3));
    const clean = sanitize(value);
    const truncated = clean.length > maxChars ? `${clean.slice(0, Math.max(1, maxChars - 3))}...` : clean;
    this.text(x, 8, truncated);
  }

  finish(): string[] {
    if (this.stream) this.pages.push(this.stream);
    return this.pages;
  }
}

/** Scales a column-width array down proportionally so it never exceeds the printable page width — the structural fix for a table that would otherwise run off the page edge. */
function fitWidthsToPage(widths: number[]): number[] {
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= USABLE_WIDTH || total === 0) return widths;
  const scale = USABLE_WIDTH / total;
  return widths.map((w) => Math.max(30, Math.floor(w * scale)));
}

function drawTableHeaderRow(writer: PdfPageWriter, headers: string[], widths: number[]): void {
  let x = MARGIN_X;
  headers.forEach((h, i) => {
    writer.cell(x, h, widths[i]);
    x += widths[i];
  });
  writer.advance(16);
  writer.rule();
}

/** Renders a table with its header row repeated on every page it spans, so a multi-page table stays usable without scrolling back. Column widths are scaled to fit the page before anything is drawn. */
function renderTable(writer: PdfPageWriter, headers: string[], rawWidths: number[], rows: string[][]): void {
  const widths = fitWidthsToPage(rawWidths);
  const rowH = 16;
  writer.ensureSpace(rowH + 4);
  drawTableHeaderRow(writer, headers, widths);

  for (const row of rows) {
    if (writer.willOverflow(rowH)) {
      writer.newPage();
      drawTableHeaderRow(writer, headers, widths);
    }
    let cx = MARGIN_X;
    row.forEach((cell, i) => {
      writer.cell(cx, cell, widths[i]);
      cx += widths[i];
    });
    writer.advance(rowH);
  }
}

const WIDE_TEXT_COLUMNS = new Set(["title", "action_comment", "limitations", "source_coverage_note", "evidence_ref", "tests_performed"]);

function pdfWidthForColumn(col: TableFieldConfig): number {
  if (WIDE_TEXT_COLUMNS.has(col.key)) return 100;
  if (col.type === "currency" || col.type === "number") return 60;
  return 65;
}

/** Renders one columnar section (Findings/Actions/Coverage/Matching Summary) using the SAME field config + cell-value getters as the Excel builder, including a totals row for additive columns only. */
function renderColumnarSection(
  writer: PdfPageWriter,
  title: string,
  allFields: TableFieldConfig[],
  selectedKeys: string[],
  rows: Array<Record<string, unknown>>,
  getCell: (columnKey: string, row: Record<string, unknown>) => { display: string; numeric: number | null }
): void {
  writer.heading(title);
  const columns = allFields.filter((f) => selectedKeys.includes(f.key));
  if (rows.length === 0) {
    writer.paragraph(title, "(none recorded)");
    return;
  }
  const headers = columns.map((c) => c.label);
  const widths = fitWidthsToPage(columns.map(pdfWidthForColumn));
  const tableRows = rows.map((row) => columns.map((c) => getCell(c.key, row).display));
  renderTable(writer, headers, widths, tableRows);

  const totalsByCol = columns.map((c) => (c.totalSupported ? rows.reduce((sum, row) => sum + (getCell(c.key, row).numeric ?? 0), 0) : null));
  if (totalsByCol.some((t) => t !== null)) {
    writer.ensureSpace(16);
    let labelPlaced = false;
    let x = MARGIN_X;
    columns.forEach((c, i) => {
      const val = totalsByCol[i] !== null ? String(Math.round((totalsByCol[i] as number) * 100) / 100) : !labelPlaced ? ((labelPlaced = true), "TOTAL") : "";
      writer.cell(x, val, widths[i]);
      x += widths[i];
    });
    writer.advance(16);
  }
}

function buildAssumptionsAndLimitations(writer: PdfPageWriter, data: AuditReportData): void {
  writer.heading("Assumptions, Limitations & Exclusions");
  writer.paragraph("Assumptions", data.assumptions);
  writer.paragraph("Limitations", data.limitations);
  writer.paragraph("Exclusions", data.exclusions);
  writer.paragraph("Not-Tested Domains", data.notTestedDomains.join(", ") || "(none)");
  writer.advance(6);
}

function renderSection(writer: PdfPageWriter, section: string, data: AuditReportData, tableColumns: TableColumnSelections): void {
  switch (section) {
    case "summary": {
      writer.heading("Summary");
      writer.paragraph("Report ID", data.reportId);
      writer.paragraph("Report Version", String(data.reportVersion));
      writer.paragraph("Status", data.status);
      writer.paragraph("Entity", data.entityName);
      writer.paragraph("Period", `${data.periodFrom} to ${data.periodTo}`);
      writer.paragraph("Purpose", data.purpose);
      writer.paragraph("Comparison Mode(s)", data.comparisonModes.join(", ") || "-");
      writer.paragraph("Generated At", data.generatedAt);
      writer.advance(4);
      writer.text(MARGIN_X, 8, "This is an INTERNAL REVIEW WORKING PAPER — it is not a statutory audit opinion.", true, "0.6 0.1 0.1");
      writer.advance(16);
      break;
    }
    case "scope_coverage": {
      const cols = tableColumns.scope_coverage ?? COVERAGE_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
      renderColumnarSection(writer, "Scope & Coverage Matrix", COVERAGE_FIELDS, cols, data.domainCoverage, getCoverageCell);
      writer.advance(8);
      break;
    }
    case "sources": {
      writer.heading("Source Register");
      if (data.sourceRegister.length === 0) {
        writer.paragraph("Sources", "No source versions were recorded against this report's run/domain reviews at generation time.", 110);
        break;
      }
      renderTable(
        writer,
        ["Source ID", "Version", "Type", "Origin", "Role", "Original Ref", "Frozen", "Raw/Norm/Exc", "Completeness"],
        [55, 34, 55, 44, 50, 90, 34, 60, 60],
        data.sourceRegister.map((s) => [
          sanitize(s.source_id).slice(0, 8),
          `v${sanitize(s.version_number)}`,
          sanitize(s.source_type),
          sanitize(s.origin),
          sanitize(s.role_label),
          sanitize(s.original_reference ?? "-"),
          s.frozen ? "YES" : "NO",
          `${sanitize(s.raw_record_count ?? 0)}/${sanitize(s.normalized_record_count ?? 0)}/${sanitize(s.exception_count ?? 0)}`,
          sanitize(s.completeness_status),
        ])
      );
      writer.advance(8);
      break;
    }
    case "matching_summary":
    case "unmatched_residual": {
      const ms = data.matchingSummary as Record<string, unknown>;
      const rows = (ms.rows as Array<Record<string, unknown>>) ?? [];
      const cols = tableColumns.matching_summary ?? MATCHING_SUMMARY_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
      renderColumnarSection(writer, section === "matching_summary" ? "Matching Summary" : "Unmatched / Residual", MATCHING_SUMMARY_FIELDS, cols, rows, getMatchingSummaryCell);
      writer.paragraph("Net Difference (signed)", String(ms.netDifference ?? "0"));
      writer.paragraph("Absolute Residual (unsigned)", String(ms.absoluteResidual ?? "0"));
      writer.text(MARGIN_X, 8, "Net difference and absolute residual are shown separately; neither is forced toward zero.", false, "0.3 0.3 0.3");
      writer.advance(16);
      break;
    }
    case "findings": {
      const cols = tableColumns.findings ?? FINDINGS_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
      renderColumnarSection(writer, "Findings", FINDINGS_FIELDS, cols, data.findings, getFindingCell);
      writer.advance(8);
      break;
    }
    case "action_taken": {
      const cols = tableColumns.action_taken ?? ACTIONS_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
      renderColumnarSection(writer, "Action Taken", ACTIONS_FIELDS, cols, data.actions, getActionCell);
      writer.advance(8);
      break;
    }
    case "reviewer_decisions": {
      writer.heading("Reviewer Decisions");
      if (data.reviewerDecisions.length === 0) {
        writer.paragraph("Reviewer Decisions", "(none recorded)");
        break;
      }
      renderTable(
        writer,
        ["Entity", "Reviewer", "Decision", "Comment"],
        [110, 90, 90, 170],
        data.reviewerDecisions.map((d) => [`${sanitize(d.entity_type)}:${sanitize(d.entity_id)}`, sanitize(d.reviewer), sanitize(d.decision), sanitize(d.comment ?? "-")])
      );
      writer.advance(8);
      break;
    }
  }
}

/** Builds the internal review report PDF for the caller-resolved sections/columns, same immutable dataset as the Excel export. */
export function buildAuditReportPdf(data: AuditReportData, sections: string[], tableColumns: TableColumnSelections = {}): Buffer {
  const writer = new PdfPageWriter();

  // Header block (page 1)
  writer.text(MARGIN_X, 15, "BANSIL BOOKS — INTERNAL REVIEW WORKING PAPER");
  writer.advance(20);
  writer.text(MARGIN_X, 10, `Entity: ${sanitize(data.entityName)}   Period: ${sanitize(data.periodFrom)} to ${sanitize(data.periodTo)}   Report v${data.reportVersion}`);
  writer.advance(18);

  buildAssumptionsAndLimitations(writer, data);

  for (const section of sections) {
    renderSection(writer, section, data, tableColumns);
  }

  const pageStreams = writer.finish();

  // Footers with page numbers
  const totalPages = pageStreams.length || 1;
  const withFooters = pageStreams.map((stream, idx) => {
    const footerY = BOTTOM_MARGIN - 15;
    let footer = `0.8 0.8 0.85 RG 0.5 w ${MARGIN_X} ${footerY + 10} m ${PAGE_WIDTH - MARGIN_X} ${footerY + 10} l S\n`;
    footer += `BT /F1 7 Tf 0.4 0.4 0.4 rg ${MARGIN_X} ${footerY} Td (Bansil Books Analytics - Internal Review Working Paper) Tj ET\n`;
    footer += `BT /F1 7 Tf 0.4 0.4 0.4 rg ${PAGE_WIDTH - MARGIN_X - 70} ${footerY} Td (Page ${idx + 1} of ${totalPages}) Tj ET\n`;
    return stream + footer;
  });

  // ---- Assemble PDF 1.4 binary ----
  const objects: string[] = [];
  const pageObjIds: number[] = [];
  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n`;
  objects[4] = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  let nextId = 6;
  const safePages = withFooters.length > 0 ? withFooters : ["BT /F1 10 Tf 0 0 0 rg 40 800 Td (No content selected) Tj ET\n"];
  for (const stream of safePages) {
    const pageObjId = nextId++;
    const contentObjId = nextId++;
    pageObjIds.push(pageObjId);
    objects[contentObjId] = `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf-8")} >>\nstream\n${stream}\nendstream\nendobj\n`;
    objects[pageObjId] = `${pageObjId} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`;
  }
  objects[3] = `3 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjIds.length} >>\nendobj\n`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];
  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf-8");
    pdf += objects[i];
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let i = 1; i < nextId; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf-8");
}
