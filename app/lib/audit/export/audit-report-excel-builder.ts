// ============================================================
// Bansil Books Analytics — Internal Review Report: Excel (.xlsx) Builder
// Milestone D. Generates XLSX purely from the already-frozen report
// snapshot (AuditReportData) — never reruns matching/AI/Zoho/parsing.
// Self-contained OOXML/ZIP writer (no third-party dependency), same
// low-level technique already used in app/lib/export/excel-builder.ts,
// kept independent so this Milestone D module never touches the
// locked Reports module's existing export code.
// ============================================================

import * as zlib from "zlib";
import type { AuditReportData } from "./audit-report-data.ts";
import { FINDINGS_FIELDS, ACTIONS_FIELDS, COVERAGE_FIELDS, MATCHING_SUMMARY_FIELDS, type TableFieldConfig } from "../report-field-selector.ts";
import { getFindingCell, getActionCell, getCoverageCell, getMatchingSummaryCell } from "./report-table-values.ts";

export interface TableColumnSelections {
  findings?: string[];
  action_taken?: string[];
  scope_coverage?: string[];
  matching_summary?: string[];
}

// ---- Minimal ZIP (PKZIP) packer ----
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
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = entry.data;
    const crc = crc32(raw);
    const compressed = zlib.deflateRawSync(raw);
    const pathBuf = Buffer.from(entry.path, "utf-8");

    const lfh = Buffer.alloc(30 + pathBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0x5200, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(pathBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    pathBuf.copy(lfh, 30);
    localParts.push(lfh, compressed);

    const cde = Buffer.alloc(46 + pathBuf.length);
    cde.writeUInt32LE(0x02014b50, 0);
    cde.writeUInt16LE(20, 4);
    cde.writeUInt16LE(20, 6);
    cde.writeUInt16LE(0, 8);
    cde.writeUInt16LE(8, 10);
    cde.writeUInt16LE(0, 12);
    cde.writeUInt16LE(0x5200, 14);
    cde.writeUInt32LE(crc, 16);
    cde.writeUInt32LE(compressed.length, 20);
    cde.writeUInt32LE(raw.length, 24);
    cde.writeUInt16LE(pathBuf.length, 28);
    cde.writeUInt16LE(0, 30);
    cde.writeUInt16LE(0, 32);
    cde.writeUInt16LE(0, 34);
    cde.writeUInt32LE(0, 38);
    cde.writeUInt32LE(offset, 42);
    pathBuf.copy(cde, 46);
    cdParts.push(cde);

    offset += lfh.length + compressed.length;
  }

  const cdStart = offset;
  const cdSize = cdParts.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);

  return Buffer.concat([...localParts, ...cdParts, eocd]);
}

function esc(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function colLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

interface SheetTable {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  widths?: number[];
}

function buildSheetXml(table: SheetTable): string {
  let rows = `<row r="1" ht="22" customHeight="1">`;
  table.headers.forEach((h, i) => {
    rows += `<c r="${colLetter(i)}1" s="1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`;
  });
  rows += `</row>`;

  table.rows.forEach((row, rIdx) => {
    const r = rIdx + 2;
    rows += `<row r="${r}">`;
    row.forEach((cell, cIdx) => {
      const col = colLetter(cIdx);
      if (typeof cell === "number") {
        rows += `<c r="${col}${r}" t="n"><v>${cell}</v></c>`;
      } else {
        rows += `<c r="${col}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
      }
    });
    rows += `</row>`;
  });

  const colsXml = table.headers
    .map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${table.widths?.[i] ?? 22}" customWidth="1"/>`)
    .join("");
  const lastCol = colLetter(Math.max(0, table.headers.length - 1));
  const lastRow = Math.max(1, table.rows.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rows}</sheetData>
  <autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF111827"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;
}

const WIDE_TEXT_COLUMNS = new Set(["title", "action_comment", "limitations", "source_coverage_note", "evidence_ref", "tests_performed"]);

function widthForColumn(col: TableFieldConfig): number {
  if (WIDE_TEXT_COLUMNS.has(col.key)) return 36;
  if (col.type === "currency" || col.type === "number") return 16;
  return 20;
}

/** Builds one columnar sheet (Findings/Actions/Coverage/Matching Summary) from a shared field config + cell-value getter, with a totals row appended only for additive numeric columns. */
function buildColumnarSheet(
  name: string,
  allFields: TableFieldConfig[],
  selectedKeys: string[],
  rows: Array<Record<string, unknown>>,
  getCell: (columnKey: string, row: Record<string, unknown>) => { display: string; numeric: number | null }
): SheetTable {
  const columns = allFields.filter((f) => selectedKeys.includes(f.key));
  const headers = columns.map((c) => c.label);
  const widths = columns.map(widthForColumn);

  const dataRows: (string | number)[][] = rows.map((row) => columns.map((c) => getCell(c.key, row).display));

  const totalsByCol = columns.map((c) => (c.totalSupported ? rows.reduce((sum, row) => sum + (getCell(c.key, row).numeric ?? 0), 0) : null));
  const hasAnyTotal = totalsByCol.some((t) => t !== null);
  if (hasAnyTotal && rows.length > 0) {
    let labelPlaced = false;
    const totalsRow = columns.map((c, i) => {
      if (totalsByCol[i] !== null) return Math.round((totalsByCol[i] as number) * 100) / 100;
      if (!labelPlaced) {
        labelPlaced = true;
        return "TOTAL";
      }
      return "";
    });
    dataRows.push(totalsRow);
  }

  return { name, headers, widths, rows: dataRows };
}

function sectionsToSheets(data: AuditReportData, sections: string[], tableColumns: TableColumnSelections): SheetTable[] {
  const sheets: SheetTable[] = [];

  if (sections.includes("summary")) {
    sheets.push({
      name: "Summary",
      headers: ["Field", "Value"],
      widths: [28, 60],
      rows: [
        ["Report ID", data.reportId],
        ["Report Version", data.reportVersion],
        ["Status", data.status],
        ["Entity", data.entityName],
        ["Period From", data.periodFrom],
        ["Period To", data.periodTo],
        ["Purpose", data.purpose],
        ["Comparison Mode(s)", data.comparisonModes.join(", ") || "-"],
        ["Generated At", data.generatedAt],
        ["Assumptions", data.assumptions],
        ["Limitations", data.limitations],
        ["Exclusions", data.exclusions],
        ["Not-Tested Domains", data.notTestedDomains.join(", ") || "(none)"],
        ["Report Classification", "INTERNAL REVIEW WORKING PAPER — not a statutory audit opinion"],
      ],
    });
  }

  if (sections.includes("scope_coverage")) {
    const cols = tableColumns.scope_coverage ?? COVERAGE_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
    sheets.push(buildColumnarSheet("Scope & Coverage", COVERAGE_FIELDS, cols, data.domainCoverage, getCoverageCell));
  }

  if (sections.includes("sources")) {
    if (data.sourceRegister.length === 0) {
      sheets.push({
        name: "Sources",
        headers: ["Note"],
        widths: [80],
        rows: [["No source versions were recorded against this report's run/domain reviews at generation time."]],
      });
    } else {
      sheets.push({
        name: "Sources",
        headers: [
          "Source ID", "Source Version ID", "Version #", "Source Type", "Origin", "Role", "Entity/Scope",
          "Original Reference", "File Hash", "Provenance", "Mapping Version", "Extraction Method",
          "Frozen", "Frozen At", "Raw Records", "Normalized Records", "Exceptions", "Completeness Status",
          "Coverage Note", "Acquisition Provenance",
        ],
        widths: [20, 20, 10, 16, 12, 14, 24, 30, 20, 24, 14, 18, 10, 20, 12, 16, 12, 18, 30, 40],
        rows: data.sourceRegister.map((s) => [
          String(s.source_id ?? ""),
          String(s.source_version_id ?? ""),
          Number(s.version_number ?? 0),
          String(s.source_type ?? ""),
          String(s.origin ?? ""),
          String(s.role_label ?? ""),
          String(s.entity_scope ?? "-"),
          String(s.original_reference ?? "-"),
          String(s.file_hash ?? "-"),
          String(s.provenance ?? "-"),
          Number(s.mapping_version ?? 0),
          String(s.extraction_method ?? "-"),
          s.frozen ? "YES" : "NO",
          String(s.frozen_at ?? "-"),
          Number(s.raw_record_count ?? 0),
          Number(s.normalized_record_count ?? 0),
          Number(s.exception_count ?? 0),
          String(s.completeness_status ?? "-"),
          String(s.coverage_note ?? "-"),
          s.acquisition_provenance ? JSON.stringify(s.acquisition_provenance) : "-",
        ]),
      });
    }
  }

  if (sections.includes("matching_summary")) {
    const ms = data.matchingSummary as Record<string, unknown>;
    const rows = (ms.rows as Array<Record<string, unknown>>) ?? [];
    const cols = tableColumns.matching_summary ?? MATCHING_SUMMARY_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
    const sheet = buildColumnarSheet("Matching Summary", MATCHING_SUMMARY_FIELDS, cols, rows, getMatchingSummaryCell);
    sheet.rows.push([]);
    sheet.rows.push(["Net Difference (signed)", String(ms.netDifference ?? "0")]);
    sheet.rows.push(["Absolute Residual (unsigned)", String(ms.absoluteResidual ?? "0")]);
    sheets.push(sheet);
  }

  if (sections.includes("findings")) {
    const cols = tableColumns.findings ?? FINDINGS_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
    sheets.push(buildColumnarSheet("Findings", FINDINGS_FIELDS, cols, data.findings, getFindingCell));
  }

  if (sections.includes("action_taken")) {
    const cols = tableColumns.action_taken ?? ACTIONS_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);
    sheets.push(buildColumnarSheet("Action Taken", ACTIONS_FIELDS, cols, data.actions, getActionCell));
  }

  if (sections.includes("unmatched_residual")) {
    const ms = data.matchingSummary as Record<string, unknown>;
    sheets.push({
      name: "Unmatched-Residual",
      headers: ["Metric", "Value"],
      widths: [30, 30],
      rows: [
        ["Unresolved Item Count", Number(ms.unresolvedItemCount ?? 0)],
        ["Ambiguous Item Count", Number(ms.ambiguousItemCount ?? 0)],
        ["Net Difference (signed)", String(ms.netDifference ?? "0")],
        ["Absolute Residual (unsigned)", String(ms.absoluteResidual ?? "0")],
      ] as (string | number)[][],
    });
  }

  if (sections.includes("reviewer_decisions")) {
    sheets.push({
      name: "Reviewer Decisions",
      headers: ["Entity Type", "Entity ID", "Reviewer", "Role Context", "Decision", "Comment", "Created At"],
      widths: [14, 20, 16, 14, 14, 34, 20],
      rows: data.reviewerDecisions.map((d) => [
        String(d.entity_type ?? ""),
        String(d.entity_id ?? ""),
        String(d.reviewer ?? ""),
        String(d.role_context ?? "-"),
        String(d.decision ?? ""),
        String(d.comment ?? "-"),
        String(d.created_at ?? ""),
      ]),
    });
  }

  return sheets;
}

/** Builds the complete .xlsx binary for the internal review report, restricted to the caller-resolved sections and per-table column selections. */
export function buildAuditReportExcel(data: AuditReportData, sections: string[], tableColumns: TableColumnSelections = {}): Buffer {
  const sheets = sectionsToSheets(data, sections, tableColumns);
  const usedSheets = sheets.length > 0 ? sheets : [{ name: "Summary", headers: ["Notice"], rows: [["No report sections were available to export."]] }];

  const sheetXmls = usedSheets.map(buildSheetXml);
  const stylesXml = buildStylesXml();

  const contentTypesOverrides = usedSheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${contentTypesOverrides}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRelsEntries = usedSheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
  workbookRelsEntries.push(`<Relationship Id="rId${usedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelsEntries.join("")}
</Relationships>`;

  const sheetsXmlEntries = usedSheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetsXmlEntries}</sheets>
</workbook>`;

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf-8") },
    { path: "_rels/.rels", data: Buffer.from(rootRels, "utf-8") },
    { path: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf-8") },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf-8") },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf-8") },
    ...sheetXmls.map((xml, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(xml, "utf-8") })),
  ];

  return packZip(entries);
}
