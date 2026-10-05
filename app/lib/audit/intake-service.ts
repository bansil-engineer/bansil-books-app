// ============================================================
// Bansil Books Analytics — Evidence Intake & Source Mapping Service
// (Milestone B: file/Zoho source versions, mapping, completeness,
// frozen snapshots. No matching/allocation here — Milestone C.)
// ============================================================

import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { recordAuditEvent } from "./audit-service.ts";
import {
  detectFileType,
  storeUploadedFile,
  readStoredFile,
  MAX_UPLOAD_BYTES,
  MAX_CSV_ROWS,
  MAX_XLSX_ROWS_PER_SHEET,
  MAX_PDF_PAGES,
  type SupportedFileType,
} from "./intake/file-storage.ts";
import { parseCsvRawLines } from "./intake/csv-parser.ts";
import { parseXlsxBuffer } from "./intake/xlsx-reader.ts";
import { extractPdfText } from "./intake/pdf-text-extractor.ts";
import { applyFieldMap, detectHeaderAmbiguity, type FieldMap, type RawTable, type RawTableRow } from "./intake/normalized-fields.ts";

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export class IntakeError extends Error {}

// ---------------- Raw table extraction (CSV/XLSX -> shared shape) ----------------

export interface RawRowsPreview {
  supported: boolean;
  reason?: string;
  /** Every physical row up to `maxRows`, completely unheadered — for the owner to pick header/data-start from. */
  rows?: Array<{ physicalRow: number; values: string[] }>;
  totalRows?: number;
}

/**
 * Returns raw physical rows with NO header assumption, for the header/
 * data-start picker UI. Never guesses which row is the header.
 */
export function getRawRowsPreview(sourceVersionId: string, maxRows: number = 30, conn?: DatabaseSync): RawRowsPreview {
  const db = resolveDb(conn);
  const version = db.prepare(`SELECT * FROM audit_source_versions WHERE version_id = ?`).get(sourceVersionId) as
    | { origin_type: string; file_id: string | null }
    | undefined;
  if (!version) throw new IntakeError(`Source version ${sourceVersionId} not found`);

  if (version.origin_type !== "FILE" || !version.file_id) {
    return { supported: false, reason: "Header/data-start selection only applies to uploaded CSV/XLSX files." };
  }
  const file = db.prepare(`SELECT * FROM audit_source_files WHERE file_id = ?`).get(version.file_id) as
    | { storage_path: string; file_type: SupportedFileType }
    | undefined;
  if (!file) throw new IntakeError("Source file record missing");

  if (file.file_type === "PDF") {
    return { supported: false, reason: "PDF text is not tabular — no header row concept applies; do not invent one." };
  }

  const buffer = readStoredFile(file.storage_path);
  if (file.file_type === "CSV") {
    const { lines } = parseCsvRawLines(buffer);
    return { supported: true, rows: lines.slice(0, maxRows), totalRows: lines.length };
  }
  // XLSX
  const parsed = parseXlsxBuffer(buffer);
  const sheet = parsed.sheets[0];
  const rows = sheet.rows.slice(0, maxRows).map((r) => ({ physicalRow: r.rowNumber, values: r.cells.map((c) => c.rawValue ?? "") }));
  return { supported: true, rows, totalRows: sheet.rows.length };
}

/**
 * Builds the generic {headers, rows} table from raw CSV lines using an
 * EXPLICIT header row and data-start row — never assumed. Rows strictly
 * before `headerRowNumber`, and strictly between the header and
 * `dataStartRowNumber` (e.g. a deliberately-skipped blank/subtotal
 * separator), are excluded from data entirely — never misread as
 * transactions. `physicalRow` on every returned row is always the row
 * number as it appears in the original file, regardless of header offset.
 */
function buildRawTableFromCsv(
  buffer: Buffer,
  headerRowNumber: number = 1,
  dataStartRowNumber?: number
): { table: RawTable; rawRowCount: number; exceptionCount: number } {
  const { lines } = parseCsvRawLines(buffer);
  if (lines.length > MAX_CSV_ROWS) {
    throw new IntakeError(`CSV exceeds the safety limit of ${MAX_CSV_ROWS} rows`);
  }

  const headerLine = lines.find((l) => l.physicalRow === headerRowNumber);
  if (!headerLine) {
    throw new IntakeError(`Header row ${headerRowNumber} does not exist in this file (it has ${lines.length} row(s))`);
  }
  const headers = headerLine.values;
  const effectiveDataStart = dataStartRowNumber ?? headerRowNumber + 1;

  const rows: RawTableRow[] = [];
  const exceptions: number[] = [];
  for (const line of lines) {
    if (line.physicalRow < effectiveDataStart) continue; // title/header/skipped-separator rows — never data
    if (line.values.length !== headers.length) {
      exceptions.push(line.physicalRow);
      continue;
    }
    const values: Record<string, string | null> = {};
    headers.forEach((h, i) => {
      values[h] = line.values[i] ?? null;
    });
    rows.push({ physicalRow: line.physicalRow, values });
  }

  return { table: { headers, rows }, rawRowCount: rows.length + exceptions.length, exceptionCount: exceptions.length };
}

function buildRawTableFromXlsx(
  buffer: Buffer,
  headerRowNumber: number = 1,
  dataStartRowNumber?: number
): { table: RawTable; rawRowCount: number; exceptionCount: number } {
  const parsed = parseXlsxBuffer(buffer);
  const sheet = parsed.sheets[0]; // first sheet (documented v1 limitation)
  if (sheet.rows.length > MAX_XLSX_ROWS_PER_SHEET) {
    throw new IntakeError(`XLSX sheet exceeds the safety limit of ${MAX_XLSX_ROWS_PER_SHEET} rows`);
  }
  const headerRow = sheet.rows.find((r) => r.rowNumber === headerRowNumber);
  if (!headerRow) {
    return { table: { headers: [], rows: [] }, rawRowCount: 0, exceptionCount: 0 };
  }
  const headers = headerRow.cells.map((c) => c.rawValue ?? c.column);
  const columnToHeader = new Map(headerRow.cells.map((c) => [c.column, c.rawValue ?? c.column]));
  const effectiveDataStart = dataStartRowNumber ?? headerRowNumber + 1;

  const rows: RawTableRow[] = sheet.rows
    .filter((r) => r.rowNumber >= effectiveDataStart)
    .map((r) => {
      const values: Record<string, string | null> = {};
      for (const cell of r.cells) {
        const header = columnToHeader.get(cell.column);
        if (header) values[header] = cell.rawValue;
      }
      return { physicalRow: r.rowNumber, values };
    });

  return { table: { headers, rows }, rawRowCount: rows.length, exceptionCount: 0 };
}

/** Exposes each extracted page as one pseudo-row (page_number, page_text) so PDF flows through the same generic mapping path as CSV/XLSX — text isn't naturally tabular, so mapping a PDF source typically only sets description_raw/evidence-style fields. */
function buildRawTableFromPdf(buffer: Buffer): { table: RawTable; rawRowCount: number; exceptionCount: number } {
  const result = extractPdfText(buffer);
  if (result.status === "UNSUPPORTED_STRUCTURE" || result.status === "ENCRYPTED_NOT_SUPPORTED") {
    throw new IntakeError(result.note ?? result.status);
  }
  const rows: RawTableRow[] = result.pages.map((p) => ({
    physicalRow: p.pageNumber,
    values: { page_number: String(p.pageNumber), page_status: p.status, page_text: p.text || null },
  }));
  const exceptionCount = result.pages.filter((p) => p.status === "OCR_REQUIRED").length;
  return { table: { headers: ["page_number", "page_status", "page_text"], rows }, rawRowCount: result.pages.length, exceptionCount };
}

interface ExtractionOutcome {
  status: "EXTRACTED" | "OCR_REQUIRED" | "OCR_NOT_AVAILABLE" | "FAILED";
  method: string;
  rawRowCount: number | null;
  parsedRowCount: number | null;
  exceptionCount: number | null;
  note?: string;
}

function extractByFileType(fileType: SupportedFileType, buffer: Buffer): ExtractionOutcome {
  if (fileType === "CSV") {
    const { table, rawRowCount, exceptionCount } = buildRawTableFromCsv(buffer);
    return { status: "EXTRACTED", method: "csv-parser", rawRowCount, parsedRowCount: table.rows.length, exceptionCount };
  }
  if (fileType === "XLSX") {
    const { table, rawRowCount, exceptionCount } = buildRawTableFromXlsx(buffer);
    return { status: "EXTRACTED", method: "xlsx-reader", rawRowCount, parsedRowCount: table.rows.length, exceptionCount };
  }
  // PDF
  const result = extractPdfText(buffer);
  if (result.status === "UNSUPPORTED_STRUCTURE" || result.status === "ENCRYPTED_NOT_SUPPORTED") {
    return { status: "FAILED", method: "pdf-text-extractor", rawRowCount: null, parsedRowCount: null, exceptionCount: null, note: result.note ?? result.status };
  }
  if (result.pages.length > MAX_PDF_PAGES) {
    return { status: "FAILED", method: "pdf-text-extractor", rawRowCount: null, parsedRowCount: null, exceptionCount: null, note: `Exceeds safety limit of ${MAX_PDF_PAGES} pages` };
  }
  const extractedPages = result.pages.filter((p) => p.status === "EXTRACTED").length;
  const ocrPages = result.pages.filter((p) => p.status === "OCR_REQUIRED").length;
  if (ocrPages > 0 && extractedPages === 0) {
    return { status: "OCR_NOT_AVAILABLE", method: "pdf-text-extractor", rawRowCount: result.pages.length, parsedRowCount: 0, exceptionCount: ocrPages, note: "All pages require OCR; no local OCR engine is available — text was not fabricated" };
  }
  if (ocrPages > 0) {
    return { status: "OCR_REQUIRED", method: "pdf-text-extractor", rawRowCount: result.pages.length, parsedRowCount: extractedPages, exceptionCount: ocrPages };
  }
  return { status: "EXTRACTED", method: "pdf-text-extractor", rawRowCount: result.pages.length, parsedRowCount: extractedPages, exceptionCount: 0 };
}

// ---------------- Source version lifecycle ----------------

export function addWorkspaceSourceFile(
  sourceId: string,
  originalFilename: string,
  buffer: Buffer,
  actor: string,
  conn?: DatabaseSync
): { versionId: string; fileId: string; extraction: ExtractionOutcome } {
  const db = resolveDb(conn);

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new IntakeError(`File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit`);
  }
  const fileType = detectFileType(originalFilename);
  if (!fileType) {
    throw new IntakeError("Only .pdf, .xlsx, and .csv files are supported in this milestone");
  }

  const source = db.prepare(`SELECT source_id FROM audit_workspace_sources WHERE source_id = ?`).get(sourceId);
  if (!source) throw new IntakeError(`Source ${sourceId} not found`);

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const existingFile = db
    .prepare(`SELECT file_id FROM audit_source_files WHERE source_id = ? AND sha256 = ?`)
    .get(sourceId, sha256) as { file_id: string } | undefined;

  const now = new Date().toISOString();
  let fileId: string;

  if (existingFile) {
    fileId = existingFile.file_id; // identical upload — dedupe, no new bytes stored
  } else {
    const stored = storeUploadedFile(buffer);
    fileId = stored.fileId;
    db.prepare(
      `INSERT INTO audit_source_files (file_id, source_id, original_filename, file_type, size_bytes, sha256, storage_path, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, sourceId, originalFilename, fileType, buffer.byteLength, sha256, stored.storagePath, actor, now);
  }

  const maxVersionRow = db
    .prepare(`SELECT MAX(version_number) as m FROM audit_source_versions WHERE source_id = ?`)
    .get(sourceId) as { m: number | null };
  const versionNumber = (maxVersionRow.m ?? 0) + 1;
  const versionId = randomUUID();

  let extraction: ExtractionOutcome;
  try {
    extraction = extractByFileType(fileType, buffer);
  } catch (err) {
    extraction = {
      status: "FAILED",
      method: fileType === "CSV" ? "csv-parser" : fileType === "XLSX" ? "xlsx-reader" : "pdf-text-extractor",
      rawRowCount: null,
      parsedRowCount: null,
      exceptionCount: null,
      note: err instanceof Error ? err.message : String(err),
    };
  }

  db.prepare(
    `INSERT INTO audit_source_versions
      (version_id, source_id, version_number, origin_type, file_id, extraction_status, extraction_method,
       raw_row_count, parsed_row_count, exception_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'FILE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    versionId,
    sourceId,
    versionNumber,
    fileId,
    extraction.status,
    extraction.method,
    extraction.rawRowCount,
    extraction.parsedRowCount,
    extraction.exceptionCount,
    actor,
    now,
    now
  );

  recordAuditEvent(db, "SOURCE_VERSION_CREATED", "source_version", versionId, {
    sourceId,
    versionNumber,
    originalFilename,
    fileType,
    sha256,
    extractionStatus: extraction.status,
    dedupedExistingFile: Boolean(existingFile),
  }, actor);

  return { versionId, fileId, extraction };
}

export interface MappingPreview {
  originType: string;
  extractionStatus: string;
  table?: { headers: string[]; sampleRows: RawTableRow[]; totalRows: number };
  pdfPages?: Array<{ pageNumber: number; status: string; textPreview: string }>;
}

/** Re-derives a preview from the immutable stored original — nothing cached separately. */
export function getMappingPreview(sourceVersionId: string, conn?: DatabaseSync): MappingPreview {
  const db = resolveDb(conn);
  const version = db.prepare(`SELECT * FROM audit_source_versions WHERE version_id = ?`).get(sourceVersionId) as
    | { origin_type: string; extraction_status: string; file_id: string | null }
    | undefined;
  if (!version) throw new IntakeError(`Source version ${sourceVersionId} not found`);

  if (version.origin_type === "ZOHO") {
    // Raw records were already persisted at acquisition time (see
    // createZohoSourceVersion) — build the same generic headers/sampleRows
    // shape from their union of JSON keys, without re-fetching from Zoho.
    const rawRows = db
      .prepare(`SELECT raw_json FROM audit_normalized_rows WHERE source_version_id = ? ORDER BY created_at ASC LIMIT 20`)
      .all(sourceVersionId) as Array<{ raw_json: string }>;
    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM audit_normalized_rows WHERE source_version_id = ?`).get(sourceVersionId) as { c: number };
    const headerSet = new Set<string>();
    const sampleRows: RawTableRow[] = rawRows.map((r, i) => {
      const parsed = JSON.parse(r.raw_json) as Record<string, unknown>;
      const values: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(parsed)) {
        headerSet.add(k);
        values[k] = v === null || v === undefined ? null : String(v);
      }
      return { physicalRow: i + 1, values };
    });
    return {
      originType: version.origin_type,
      extractionStatus: version.extraction_status,
      table: { headers: [...headerSet], sampleRows, totalRows: totalRow.c },
    };
  }

  if (version.origin_type !== "FILE" || !version.file_id) {
    return { originType: version.origin_type, extractionStatus: version.extraction_status };
  }

  const file = db.prepare(`SELECT * FROM audit_source_files WHERE file_id = ?`).get(version.file_id) as
    | { storage_path: string; file_type: SupportedFileType }
    | undefined;
  if (!file) throw new IntakeError("Source file record missing");

  const buffer = readStoredFile(file.storage_path);

  if (file.file_type === "CSV") {
    const { table } = buildRawTableFromCsv(buffer);
    return { originType: version.origin_type, extractionStatus: version.extraction_status, table: { headers: table.headers, sampleRows: table.rows.slice(0, 20), totalRows: table.rows.length } };
  }
  if (file.file_type === "XLSX") {
    const { table } = buildRawTableFromXlsx(buffer);
    return { originType: version.origin_type, extractionStatus: version.extraction_status, table: { headers: table.headers, sampleRows: table.rows.slice(0, 20), totalRows: table.rows.length } };
  }
  // PDF — shown both as the generic mapping table (for field-mapping) and as
  // a human-readable per-page preview.
  const { table } = buildRawTableFromPdf(buffer);
  const pdf = extractPdfText(buffer);
  return {
    originType: version.origin_type,
    extractionStatus: version.extraction_status,
    table: { headers: table.headers, sampleRows: table.rows.slice(0, 20), totalRows: table.rows.length },
    pdfPages: pdf.pages.map((p) => ({ pageNumber: p.pageNumber, status: p.status, textPreview: p.text.slice(0, 500) })),
  };
}

export interface ApproveMappingInput {
  fieldMap: FieldMap;
  amountBasis?: string;
  debitCreditPerspective?: string;
  dateFormatNote?: string;
  warnings?: string[];
  /** 1-indexed physical row that names the columns. FILE/CSV/XLSX only; default 1. */
  headerRowNumber?: number;
  /** 1-indexed physical row where transaction data actually begins. Default headerRowNumber + 1. */
  dataStartRowNumber?: number;
  /** Required to proceed when the picked header row is ambiguous (blank/duplicate cells) — never assumed true. */
  acknowledgeAmbiguousHeader?: boolean;
}

export class HeaderAmbiguousError extends IntakeError {
  reasons: string[];
  constructor(reasons: string[]) {
    super(`Header row is ambiguous: ${reasons.join("; ")}. Re-submit with acknowledgeAmbiguousHeader: true to proceed anyway, or pick a different header row.`);
    this.reasons = reasons;
  }
}

/** Approves (or re-approves, pre-freeze) a field mapping and (re)builds normalized rows from it. */
export function approveSourceMapping(
  sourceVersionId: string,
  input: ApproveMappingInput,
  actor: string,
  conn?: DatabaseSync
): void {
  const db = resolveDb(conn);
  const version = db.prepare(`SELECT * FROM audit_source_versions WHERE version_id = ?`).get(sourceVersionId) as
    | { frozen: number; origin_type: string; file_id: string | null; mapping_version: number }
    | undefined;
  if (!version) throw new IntakeError(`Source version ${sourceVersionId} not found`);
  if (version.frozen) throw new IntakeError("This source version is frozen — mapping can no longer change. Create a new version instead.");

  const now = new Date().toISOString();
  const newMappingVersion = version.mapping_version + 1;
  const headerRowNumber = input.headerRowNumber ?? 1;
  const dataStartRowNumber = input.dataStartRowNumber ?? headerRowNumber + 1;

  // Resolve the table up front (needed for the header-ambiguity check) —
  // for CSV/XLSX only; PDF has no header concept, ZOHO has none either
  // (its "columns" are fixed JSON keys already).
  let fileForFileOrigin:
    | { storage_path: string; file_type: SupportedFileType }
    | undefined;
  let table: RawTable | undefined;

  if (version.origin_type === "FILE" && version.file_id) {
    fileForFileOrigin = db.prepare(`SELECT * FROM audit_source_files WHERE file_id = ?`).get(version.file_id) as
      | { storage_path: string; file_type: SupportedFileType }
      | undefined;
    if (fileForFileOrigin) {
      const buffer = readStoredFile(fileForFileOrigin.storage_path);
      if (fileForFileOrigin.file_type === "CSV") {
        table = buildRawTableFromCsv(buffer, headerRowNumber, input.dataStartRowNumber).table;
      } else if (fileForFileOrigin.file_type === "XLSX") {
        table = buildRawTableFromXlsx(buffer, headerRowNumber, input.dataStartRowNumber).table;
      } else {
        table = buildRawTableFromPdf(buffer).table; // PDF ignores header/data-start entirely
      }

      // Header/data-start selection only makes sense for tabular CSV/XLSX —
      // never invent a header concept for PDF page-text rows.
      if (fileForFileOrigin.file_type === "CSV" || fileForFileOrigin.file_type === "XLSX") {
        const ambiguity = detectHeaderAmbiguity(table.headers);
        if (ambiguity.ambiguous && !input.acknowledgeAmbiguousHeader) {
          db.prepare(`UPDATE audit_source_versions SET mapping_status = 'NEEDS_REVIEW', updated_at = ? WHERE version_id = ?`).run(now, sourceVersionId);
          recordAuditEvent(db, "SOURCE_HEADER_AMBIGUOUS", "source_version", sourceVersionId, {
            headerRowNumber,
            dataStartRowNumber,
            reasons: ambiguity.reasons,
          }, actor);
          throw new HeaderAmbiguousError(ambiguity.reasons);
        }
      }
    }
  }

  const mappingId = randomUUID();
  db.prepare(
    `INSERT INTO audit_source_mappings
      (mapping_id, source_version_id, mapping_version, field_map_json, amount_basis, debit_credit_perspective, date_format_note, warnings_json, header_row_number, data_start_row_number, approved_by, approved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mappingId,
    sourceVersionId,
    newMappingVersion,
    JSON.stringify(input.fieldMap),
    input.amountBasis ?? null,
    input.debitCreditPerspective ?? null,
    input.dateFormatNote ?? null,
    JSON.stringify(input.warnings ?? []),
    headerRowNumber,
    dataStartRowNumber,
    actor,
    now,
    now
  );

  if (version.origin_type === "FILE" && version.file_id) {
    // File-based sources: re-derive the raw table from the immutable
    // original and regenerate normalized rows from scratch.
    db.prepare(`DELETE FROM audit_normalized_rows WHERE source_version_id = ?`).run(sourceVersionId);

    if (fileForFileOrigin && table) {
      const evidencePrefix = fileForFileOrigin.file_type === "PDF" ? "page" : "row";
      const insertStmt = db.prepare(
        `INSERT INTO audit_normalized_rows (row_id, source_version_id, record_uid, evidence_locator, raw_json, normalized_json, parse_status, parse_exception, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'OK', NULL, ?)`
      );
      for (const row of table.rows) {
        const normalized = applyFieldMap(row, input.fieldMap);
        insertStmt.run(
          randomUUID(),
          sourceVersionId,
          randomUUID(),
          `${evidencePrefix}:${row.physicalRow}`,
          JSON.stringify(row.values),
          JSON.stringify({ ...normalized, mapping_version: newMappingVersion }),
          now
        );
      }
    }
  } else if (version.origin_type === "ZOHO") {
    // Zoho-based sources: raw_json already holds each fetched record —
    // just recompute normalized_json against the (possibly revised) map,
    // never re-fetching from Zoho merely to change a mapping.
    const existingRows = db
      .prepare(`SELECT row_id, raw_json FROM audit_normalized_rows WHERE source_version_id = ?`)
      .all(sourceVersionId) as Array<{ row_id: string; raw_json: string }>;
    const updateStmt = db.prepare(`UPDATE audit_normalized_rows SET normalized_json = ? WHERE row_id = ?`);
    for (const row of existingRows) {
      const raw = JSON.parse(row.raw_json) as Record<string, unknown>;
      const values: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(raw)) values[k] = v === null || v === undefined ? null : String(v);
      const normalized = applyFieldMap({ physicalRow: 0, values }, input.fieldMap);
      updateStmt.run(JSON.stringify({ ...normalized, mapping_version: newMappingVersion }), row.row_id);
    }
  }

  db.prepare(`UPDATE audit_source_versions SET mapping_status = 'APPROVED', mapping_version = ?, updated_at = ? WHERE version_id = ?`).run(
    newMappingVersion,
    now,
    sourceVersionId
  );

  recordAuditEvent(db, "SOURCE_MAPPING_APPROVED", "source_version", sourceVersionId, {
    mappingVersion: newMappingVersion,
    fieldMap: input.fieldMap,
  }, actor);
}

export function getNormalizedRows(sourceVersionId: string, limit: number = 200, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_normalized_rows WHERE source_version_id = ? ORDER BY created_at ASC LIMIT ?`)
    .all(sourceVersionId, limit) as unknown as Record<string, unknown>[];
}

export interface CompletenessInput {
  openingBalance?: number;
  closingBalance?: number;
}

export function computeCompleteness(sourceVersionId: string, input: CompletenessInput, actor: string, conn?: DatabaseSync): Record<string, unknown> {
  const db = resolveDb(conn);
  const version = db.prepare(`SELECT * FROM audit_source_versions WHERE version_id = ?`).get(sourceVersionId) as
    | { raw_row_count: number | null; parsed_row_count: number | null; exception_count: number | null }
    | undefined;
  if (!version) throw new IntakeError(`Source version ${sourceVersionId} not found`);

  const rows = getNormalizedRows(sourceVersionId, 1_000_000, db);
  let debitMovement = 0;
  let creditMovement = 0;
  let sawAnyAmount = false;
  for (const r of rows) {
    const normalized = JSON.parse((r as { normalized_json: string }).normalized_json);
    if (normalized.debit_raw) {
      const n = parseFloat(String(normalized.debit_raw).replace(/,/g, ""));
      if (!Number.isNaN(n)) { debitMovement += n; sawAnyAmount = true; }
    }
    if (normalized.credit_raw) {
      const n = parseFloat(String(normalized.credit_raw).replace(/,/g, ""));
      if (!Number.isNaN(n)) { creditMovement += n; sawAnyAmount = true; }
    }
  }

  const now = new Date().toISOString();
  let computedClosing: number | null = null;
  let discrepancy: number | null = null;
  let status: string;

  if (input.openingBalance === undefined || input.closingBalance === undefined || !sawAnyAmount) {
    status = "NOT_AVAILABLE";
  } else {
    computedClosing = input.openingBalance + debitMovement - creditMovement;
    discrepancy = Math.round((input.closingBalance - computedClosing) * 100) / 100;
    if ((version.exception_count ?? 0) > 0) {
      status = "PARTIAL";
    } else if (Math.abs(discrepancy) < 0.01) {
      status = "COMPLETE";
    } else {
      status = "INCOMPLETE";
    }
  }

  const checkId = randomUUID();
  db.prepare(
    `INSERT INTO audit_completeness_checks
      (check_id, source_version_id, raw_record_count, parsed_row_count, ignored_row_count, exception_count,
       opening_balance, debit_movement, credit_movement, closing_balance, computed_closing, discrepancy, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    checkId,
    sourceVersionId,
    version.raw_row_count,
    version.parsed_row_count,
    (version.raw_row_count ?? 0) - (version.parsed_row_count ?? 0),
    version.exception_count,
    input.openingBalance ?? null,
    debitMovement,
    creditMovement,
    input.closingBalance ?? null,
    computedClosing,
    discrepancy,
    status,
    null,
    now
  );
  db.prepare(`UPDATE audit_source_versions SET completeness_status = ?, updated_at = ? WHERE version_id = ?`).run(status, now, sourceVersionId);

  recordAuditEvent(db, "SOURCE_COMPLETENESS_CHECKED", "source_version", sourceVersionId, { status, discrepancy }, actor);

  return db.prepare(`SELECT * FROM audit_completeness_checks WHERE check_id = ?`).get(checkId) as Record<string, unknown>;
}

export function freezeSourceVersion(sourceVersionId: string, actor: string, conn?: DatabaseSync): void {
  const db = resolveDb(conn);
  const version = db.prepare(`SELECT * FROM audit_source_versions WHERE version_id = ?`).get(sourceVersionId) as
    | { mapping_status: string; frozen: number }
    | undefined;
  if (!version) throw new IntakeError(`Source version ${sourceVersionId} not found`);
  if (version.frozen) throw new IntakeError("Already frozen");
  if (version.mapping_status !== "APPROVED") {
    throw new IntakeError("Mapping must be approved before a source version can be frozen");
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE audit_source_versions SET frozen = 1, frozen_at = ?, updated_at = ? WHERE version_id = ?`).run(now, now, sourceVersionId);
  recordAuditEvent(db, "SOURCE_VERSION_FROZEN", "source_version", sourceVersionId, {}, actor);
}

export function listSourceVersions(sourceId: string, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_source_versions WHERE source_id = ? ORDER BY version_number DESC`)
    .all(sourceId) as unknown as Record<string, unknown>[];
}
