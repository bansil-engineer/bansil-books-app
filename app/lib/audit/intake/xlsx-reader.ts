// ============================================================
// Bansil Books Analytics — XLSX Intake Reader (Milestone B)
// Pure Node, no dependency: an XLSX file is itself a ZIP of OOXML
// (well-defined, bounded schema), so this reuses zip-inspect.ts and
// a small regex-based XML reader scoped to exactly the elements the
// OOXML spreadsheet schema defines. No macro, external link, or
// formula is ever evaluated — formula text is preserved as text.
// ============================================================

import { inspectZipBuffer, readZipEntryBytes } from "../zip-inspect.ts";

export interface XlsxCell {
  ref: string; // e.g. "B3"
  column: string; // e.g. "B"
  rawValue: string | null; // literal <v> text (number, boolean, error, or shared-string-resolved text)
  formula: string | null; // formula text, preserved but never evaluated
  isFormula: boolean;
}

export interface XlsxRow {
  rowNumber: number; // 1-indexed physical row, as OOXML declares it
  cells: XlsxCell[];
}

export interface XlsxSheet {
  name: string;
  rows: XlsxRow[];
}

export interface XlsxParseResult {
  sheets: XlsxSheet[];
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siBlocks = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  for (const block of siBlocks) {
    const texts = [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
    strings.push(texts.join(""));
  }
  return strings;
}

function parseWorkbookSheets(xml: string): Array<{ name: string; rId: string }> {
  const sheets: Array<{ name: string; rId: string }> = [];
  const sheetTags = xml.match(/<sheet\b[^>]*\/>/g) ?? [];
  for (const tag of sheetTags) {
    const nameMatch = tag.match(/name="([^"]*)"/);
    const ridMatch = tag.match(/r:id="([^"]*)"/);
    if (nameMatch && ridMatch) {
      sheets.push({ name: unescapeXml(nameMatch[1]), rId: ridMatch[1] });
    }
  }
  return sheets;
}

function parseWorkbookRels(xml: string): Record<string, string> {
  const rels: Record<string, string> = {};
  const relTags = xml.match(/<Relationship\b[^>]*\/>/g) ?? [];
  for (const tag of relTags) {
    const idMatch = tag.match(/Id="([^"]*)"/);
    const targetMatch = tag.match(/Target="([^"]*)"/);
    if (idMatch && targetMatch) {
      rels[idMatch[1]] = targetMatch[1];
    }
  }
  return rels;
}

function columnLetters(ref: string): string {
  const m = ref.match(/^([A-Z]+)/);
  return m ? m[1] : "";
}

function parseSheetXml(xml: string, sharedStrings: string[]): XlsxRow[] {
  const rows: XlsxRow[] = [];
  const rowBlocks = xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g);
  for (const rowMatch of rowBlocks) {
    const rowAttrs = rowMatch[1];
    const rowBody = rowMatch[2];
    const rowNumMatch = rowAttrs.match(/r="(\d+)"/);
    const rowNumber = rowNumMatch ? parseInt(rowNumMatch[1], 10) : rows.length + 1;

    const cells: XlsxCell[] = [];
    const cellBlocks = rowBody.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const cellMatch of cellBlocks) {
      const cellAttrs = cellMatch[1];
      const cellBody = cellMatch[2] ?? "";
      const refMatch = cellAttrs.match(/r="([^"]*)"/);
      const typeMatch = cellAttrs.match(/t="([^"]*)"/);
      const ref = refMatch ? refMatch[1] : "";
      const type = typeMatch ? typeMatch[1] : "n";

      const formulaMatch = cellBody.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
      const formula = formulaMatch ? unescapeXml(formulaMatch[1]) : null;

      let rawValue: string | null = null;
      if (type === "inlineStr") {
        const isMatch = cellBody.match(/<is>([\s\S]*?)<\/is>/);
        if (isMatch) {
          const texts = [...isMatch[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
          rawValue = texts.join("");
        }
      } else {
        const vMatch = cellBody.match(/<v>([\s\S]*?)<\/v>/);
        if (vMatch) {
          const v = unescapeXml(vMatch[1]);
          rawValue = type === "s" ? sharedStrings[parseInt(v, 10)] ?? null : v;
        }
      }

      cells.push({ ref, column: columnLetters(ref), rawValue, formula, isFormula: formula !== null });
    }
    rows.push({ rowNumber, cells });
  }
  return rows;
}

/**
 * Parses an XLSX buffer into sheet name + row/cell structure. Never
 * evaluates a formula or executes an external link — formula text is
 * kept as-is, and the cached <v> value XLSX already stored is what is
 * reported as the cell's value (matching what a spreadsheet last saved,
 * not a re-computation).
 */
export function parseXlsxBuffer(buf: Buffer): XlsxParseResult {
  const inspection = inspectZipBuffer(buf);
  const entryByPath = new Map(inspection.entries.map((e) => [e.path, e]));

  const workbookEntry = entryByPath.get("xl/workbook.xml");
  const relsEntry = entryByPath.get("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relsEntry) {
    throw new Error("Not a valid XLSX file (missing xl/workbook.xml or its relationships)");
  }

  const workbookXml = readZipEntryBytes(buf, workbookEntry).toString("utf8");
  const relsXml = readZipEntryBytes(buf, relsEntry).toString("utf8");
  const sheetDecls = parseWorkbookSheets(workbookXml);
  const rels = parseWorkbookRels(relsXml);

  let sharedStrings: string[] = [];
  const sharedStringsEntry = entryByPath.get("xl/sharedStrings.xml");
  if (sharedStringsEntry) {
    sharedStrings = parseSharedStrings(readZipEntryBytes(buf, sharedStringsEntry).toString("utf8"));
  }

  const sheets: XlsxSheet[] = [];
  for (const decl of sheetDecls) {
    const target = rels[decl.rId];
    if (!target) continue;
    const normalizedTarget = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetEntry = entryByPath.get(normalizedTarget) ?? entryByPath.get(target);
    if (!sheetEntry) continue;
    const sheetXml = readZipEntryBytes(buf, sheetEntry).toString("utf8");
    sheets.push({ name: decl.name, rows: parseSheetXml(sheetXml, sharedStrings) });
  }

  if (sheets.length === 0) {
    throw new Error("No readable worksheets found in this XLSX file");
  }

  return { sheets };
}
