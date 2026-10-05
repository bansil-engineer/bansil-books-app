import { getEstimationDatabase } from "../../db/estimation-database.ts";
import { extractPdfText } from "../../audit/intake/pdf-text-extractor.ts";
import crypto from "node:crypto";
import { read, utils } from "xlsx";
import type { EstimationDocument } from "./types.ts";

// ============================================================
// Phase 4C — deterministic scope / BOQ / BOM extraction.
// Zero AI calls. Never invents quantity, UOM, make, scope, BOM or
// responsibility. Gaps and contradictions become clarifications.
// No rates, vendors, costing or margin (Phase 4D+).
// ============================================================

export interface PdfExtractionSummary {
  /** The verified digital-PDF text extractor (audit intake, registry B_PDF_READING). */
  extractor: "pdf-text-extractor";
  status: string;
  note: string | null;
  /** Page numbers exactly as reported by the extractor (page-tree order). */
  pages: Array<{ pageNumber: number; status: string }>;
}

export interface ExtractionResult {
  runId: string;
  /** COMPLETED, or a truthful non-success status (OCR_CAPABILITY_REQUIRED, NO_EXTRACTABLE_TEXT, ...). */
  extractionStatus: string;
  scopeItems: any[];
  boqLines: any[];
  bomHeaders: any[];
  bomComponents: any[];
  clarifications: any[];
  pdf?: PdfExtractionSummary;
}

type DbLike = ReturnType<typeof getEstimationDatabase>;

export function startExtractionRun(
  projectId: string,
  document: EstimationDocument,
  fileBuffer: Buffer
): ExtractionResult {
  const db = getEstimationDatabase();
  const runId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO estimation_extraction_runs (extraction_run_id, project_id, document_id, started_at, status, method)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(runId, projectId, document.documentId, new Date().toISOString(), "IN_PROGRESS", "DETERMINISTIC_FIRST");

  const result: ExtractionResult = {
    runId,
    extractionStatus: "IN_PROGRESS",
    scopeItems: [],
    boqLines: [],
    bomHeaders: [],
    bomComponents: [],
    clarifications: []
  };

  // Revision safety (Phase 4A rule): only the current revision of a document
  // family may be extracted for the current estimate. Superseded / withdrawn
  // documents, or a revision with a newer CURRENT revision, are rejected.
  const newerRevision = db.prepare(`
    SELECT document_id FROM estimation_documents
    WHERE project_id = ? AND family_key = ? AND revision > ? AND status = 'CURRENT'
    LIMIT 1
  `).get(projectId, document.familyKey, document.revision);
  if (document.status !== "CURRENT" || document.supersededByDocumentId || newerRevision) {
    db.prepare(`
      UPDATE estimation_extraction_runs
      SET completed_at = ?, status = 'REJECTED_NOT_CURRENT_REVISION', warning_count = warning_count + 1
      WHERE extraction_run_id = ?
    `).run(new Date().toISOString(), runId);
    result.extractionStatus = "REJECTED_NOT_CURRENT_REVISION";
    return result;
  }

  try {
    result.extractionStatus = "COMPLETED";
    if (document.format === "XLSX" || document.format === "CSV") {
      extractSpreadsheet(db, document, fileBuffer, result);
    } else if (document.format === "PDF") {
      extractPdf(document, fileBuffer, result);
      if (result.scopeItems.length) detectScopeConflicts(db, document, result);
    }
    persistClarifications(db, result.clarifications);

    db.prepare(`
      UPDATE estimation_extraction_runs
      SET completed_at = ?, status = ?, warning_count = ?, conflict_count = ?
      WHERE extraction_run_id = ?
    `).run(
      new Date().toISOString(),
      result.extractionStatus,
      result.clarifications.length,
      result.clarifications.filter(c => c.type === "SCOPE_CONFLICT").length,
      runId,
    );
  } catch (err: any) {
    db.prepare(`
      UPDATE estimation_extraction_runs
      SET completed_at = ?, status = 'FAILED', warning_count = warning_count + 1
      WHERE extraction_run_id = ?
    `).run(new Date().toISOString(), runId);
    result.extractionStatus = "FAILED";
  }

  return result;
}

// ==================== shared helpers ====================

const normHeader = (h: unknown): string => String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const compactHeader = (h: string): string => h.replace(/[^a-z]/g, "");
const isBlank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === "";
const normText = (v: unknown): string => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

function isQtyHeader(h: string): boolean {
  return /^(qty\.?|quantity|quantities)$/.test(h) || /^(qty\.?|quantity)\s*\(.*\)$/.test(h);
}
function isUomHeader(h: string): boolean {
  return ["uom", "unit", "units", "u.o.m", "u.o.m."].includes(h);
}
function isMakeHeader(h: string): boolean {
  return ["make", "brand", "make/brand", "make / brand", "preferred make", "approved make"].includes(h);
}
function isSerialHeader(h: string): boolean {
  return ["slno", "sno", "srno", "serialno", "itemno", "lineno"].includes(compactHeader(h));
}

/** Strict quantity parse — "1,200" / "12abc" are never converted to numbers. */
function parseQuantity(raw: string | null): { value: number | null; status: string } {
  if (raw === null || raw.trim() === "") return { value: null, status: "MISSING_QTY" };
  const trimmed = raw.trim();
  if (/^[-+]?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (num === 0) return { value: num, status: "ZERO_QUANTITY" };
    if (num < 0) return { value: num, status: "NEGATIVE_QUANTITY" };
    return { value: num, status: "EXTRACTED" };
  }
  return { value: null, status: /\d/.test(trimmed) ? "MALFORMED_QUANTITY" : "NON_NUMERIC_SOURCE" };
}

function docRef(doc: EstimationDocument, location: string): string {
  return `doc:${doc.documentId}#rev${doc.revision}#${location}`;
}

/** Deterministic id → re-extraction never duplicates the same clarification. */
function makeClarification(projectId: string, type: string, question: string, refs: string[], action: string) {
  const sorted = [...refs].sort();
  return {
    clarification_id: `CLR-${crypto.createHash("sha256").update(JSON.stringify([projectId, type, sorted])).digest("hex").slice(0, 24)}`,
    project_id: projectId,
    type,
    question,
    source_references: JSON.stringify(sorted),
    status: "OPEN",
    recommended_owner_action: action,
  };
}

function persistClarifications(db: DbLike, clarifications: any[]) {
  const ins = db.prepare(`
    INSERT OR IGNORE INTO estimation_clarifications (clarification_id, project_id, type, question, source_references, status, recommended_owner_action)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of clarifications) {
    ins.run(c.clarification_id, c.project_id, c.type, c.question, c.source_references, c.status, c.recommended_owner_action);
  }
}

/** Current applicable documents: status CURRENT and no newer CURRENT revision in the same family. */
function currentDocumentIds(db: DbLike, projectId: string): Set<string> {
  const rows = db.prepare(`
    SELECT d.document_id FROM estimation_documents d
    WHERE d.project_id = ? AND d.status = 'CURRENT' AND d.superseded_by_document_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM estimation_documents n
        WHERE n.project_id = d.project_id AND n.family_key = d.family_key AND n.revision > d.revision AND n.status = 'CURRENT'
      )
  `).all(projectId) as Array<{ document_id: string }>;
  return new Set(rows.map(r => String(r.document_id)));
}

// ==================== spreadsheets (BOQ + explicit BOM) ====================

function findHeaderRow(rows: any[][], predicate: (headers: string[]) => boolean): { idx: number; headers: string[]; raw: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const headers = Array.from(row, c => normHeader(c));
    if (predicate(headers)) return { idx: i, headers, raw: Array.from(row, c => String(c ?? "").trim()) };
  }
  return null;
}

function isBomHeader(headers: string[]): boolean {
  return headers.some(h => h.includes("parent")) &&
    headers.some(h => h.includes("component")) &&
    headers.some(h => /(qty|quantity)/.test(h) && /\bper\b/.test(h));
}

function extractSpreadsheet(db: DbLike, doc: EstimationDocument, buf: Buffer, result: ExtractionResult) {
  const wb = read(buf, { type: "buffer" });
  const bomSheets: Array<{ sheetName: string; rows: any[][] }> = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (rows.length === 0) continue;

    // Explicit BOM tables are parsed after all BOQ sheets (parents must exist first).
    if (findHeaderRow(rows, isBomHeader)) {
      bomSheets.push({ sheetName, rows });
      continue;
    }

    // BOQ header: first row mentioning description / qty / quantity
    const header = findHeaderRow(rows, hs => {
      const text = hs.join(" ");
      return text.includes("description") || text.includes("qty") || text.includes("quantity");
    });
    if (!header) continue;
    const { headers, raw: rawHeaders } = header;
    const headerRowIdx = header.idx;

    const descIdx = headers.findIndex(h => h.includes("description"));
    const qtyIdxs = headers.map((h, i) => (isQtyHeader(h) ? i : -1)).filter(i => i !== -1);
    const uomIdx = headers.findIndex(h => isUomHeader(h));
    const codeIdx = headers.findIndex(h => h.includes("code"));
    const makeIdx = headers.findIndex(h => isMakeHeader(h));
    const serialIdx = headers.findIndex(h => isSerialHeader(h));

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.length) continue;

      const desc = descIdx !== -1 && !isBlank(row[descIdx]) ? String(row[descIdx]) : null;
      if (!desc) continue;

      const sourceLine = `Sheet:${sheetName}:Row:${i + 1}`;

      // Quantity: one or more plausible quantity columns. Conflicting non-empty values are never guessed.
      const qtyCells = qtyIdxs
        .filter(idx => !isBlank(row[idx]))
        .map(idx => ({ column: rawHeaders[idx], column_index: idx, raw: String(row[idx]).trim() }));
      let qtyVal: number | null = null;
      let qtyStatus: string;
      const distinctRaw = new Set(qtyCells.map(c => c.raw));
      if (qtyCells.length === 0) {
        qtyStatus = "MISSING_QTY";
      } else if (distinctRaw.size > 1) {
        qtyStatus = "AMBIGUOUS_QUANTITY";
        result.clarifications.push(makeClarification(
          doc.projectId,
          "AMBIGUOUS_QUANTITY",
          `"${desc}" (${sourceLine}) has conflicting quantity columns: ${qtyCells.map(c => `${c.column}=${c.raw}`).join(", ")}.`,
          qtyCells.map(c => docRef(doc, `${sourceLine}:Col:${c.column}=${c.raw}`)),
          "Confirm the applicable quantity from the tender; extraction does not choose between columns.",
        ));
      } else {
        const parsed = parseQuantity(qtyCells[0].raw);
        qtyVal = parsed.value;
        qtyStatus = parsed.status;
      }

      const rawUom = uomIdx !== -1 && !isBlank(row[uomIdx]) ? String(row[uomIdx]) : null;
      const uomStatus = rawUom ? "EXTRACTED" : "MISSING_UOM";
      const make = makeIdx !== -1 && !isBlank(row[makeIdx]) ? String(row[makeIdx]) : null;

      const boqLine = {
        boq_line_id: crypto.randomUUID(),
        project_id: doc.projectId,
        document_id: doc.documentId,
        revision: doc.revision,
        source_line_number: sourceLine,
        source_location: sheetName,
        source_serial_number: serialIdx !== -1 && !isBlank(row[serialIdx]) ? String(row[serialIdx]).trim() : null,
        item_code: codeIdx !== -1 && !isBlank(row[codeIdx]) ? String(row[codeIdx]) : null,
        description: desc,
        quantity: qtyVal,
        quantity_status: qtyStatus,
        quantity_evidence: qtyCells,
        uom: rawUom,
        uom_status: uomStatus,
        make_brand: make,
        make_source: make ? `${sourceLine}:Col:${rawHeaders[makeIdx]}` : null,
        technical_specification: null,
        remarks: null,
        section: sheetName,
        subsection: null,
        parent_line_id: null,
        duplicate_status: "UNIQUE",
        duplicate_of_line_id: null as string | null,
        line_status: (qtyStatus !== "EXTRACTED" || uomStatus !== "EXTRACTED") ? "CLARIFICATION_REQUIRED" : "EXTRACTED"
      };

      result.boqLines.push(boqLine);
    }
  }

  detectDuplicateBoqLines(doc, result);
  for (const b of bomSheets) extractBomSheet(db, doc, b.sheetName, b.rows, result);
}

/**
 * Exact duplicate source lines: same document, revision, section, serial number
 * (if the BOQ numbers its lines), item code, description, quantity cells and UOM.
 * Duplicates are flagged and kept — never removed. Repeats in another section or
 * with a different line number are intentional and are not flagged.
 */
function detectDuplicateBoqLines(doc: EstimationDocument, result: ExtractionResult) {
  const seen = new Map<string, any>();
  for (const line of result.boqLines) {
    if (line.document_id !== doc.documentId) continue;
    const key = JSON.stringify([
      line.document_id, line.revision, line.section, line.source_serial_number ?? "",
      normText(line.item_code), normText(line.description),
      line.quantity_evidence.map((c: any) => c.raw), normText(line.uom),
    ]);
    const first = seen.get(key);
    if (!first) {
      seen.set(key, line);
      continue;
    }
    line.duplicate_status = "DUPLICATE_OF_SOURCE_LINE";
    line.duplicate_of_line_id = first.boq_line_id;
    line.line_status = "CLARIFICATION_REQUIRED";
    first.duplicate_status = "HAS_DUPLICATE";
    result.clarifications.push(makeClarification(
      doc.projectId,
      "DUPLICATE_BOQ_LINE",
      `"${line.description}" appears identically at ${first.source_line_number} and ${line.source_line_number}.`,
      [docRef(doc, first.source_line_number), docRef(doc, line.source_line_number)],
      "Confirm whether both lines are required; extraction keeps both and removes neither.",
    ));
  }
}

/**
 * Explicit BOM table only (parent + component + qty-per columns). Parent must
 * resolve to exactly one BOQ line of a current document. Components are never
 * inferred; rows with missing / malformed qty or UOM are not created.
 */
function extractBomSheet(db: DbLike, doc: EstimationDocument, sheetName: string, rows: any[][], result: ExtractionResult) {
  const header = findHeaderRow(rows, isBomHeader)!;
  const h = header.headers;
  const parentIdx = h.findIndex(x => x.includes("parent"));
  const compCodeIdx = h.findIndex(x => x.includes("component") && x.includes("code"));
  const compIdx = h.findIndex((x, i) => x.includes("component") && i !== compCodeIdx);
  const qtyPerIdx = h.findIndex(x => /(qty|quantity)/.test(x) && /\bper\b/.test(x));
  const uomIdx = h.findIndex(x => isUomHeader(x));

  // Candidate parents: this extraction + persisted BOQ lines of current documents.
  const current = currentDocumentIds(db, doc.projectId);
  const persisted = (db.prepare(`SELECT boq_line_id, document_id, item_code, description FROM estimation_boq_lines WHERE project_id = ?`)
    .all(doc.projectId) as any[]).filter(r => current.has(String(r.document_id)) && r.document_id !== doc.documentId);
  const candidates = [
    ...result.boqLines.filter(l => l.document_id === doc.documentId),
    ...persisted,
  ];

  const headersByParent = new Map<string, any>();
  for (let i = header.idx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const sourceLine = `Sheet:${sheetName}:Row:${i + 1}`;
    const parentRaw = parentIdx !== -1 && !isBlank(row[parentIdx]) ? String(row[parentIdx]).trim() : null;
    const compDesc = compIdx !== -1 && !isBlank(row[compIdx]) ? String(row[compIdx]) : null;
    if (!parentRaw && !compDesc) continue;

    const issue = (type: string, question: string) => result.clarifications.push(makeClarification(
      doc.projectId, type, question, [docRef(doc, sourceLine)], "Correct or confirm the BOM source row; no component was created.",
    ));
    if (!parentRaw || !compDesc) {
      issue("BOM_ROW_INCOMPLETE", `BOM row ${sourceLine} lacks a parent or component.`);
      continue;
    }
    const byCode = candidates.filter(c => c.item_code && normText(c.item_code) === normText(parentRaw));
    const byDesc = byCode.length ? [] : candidates.filter(c => normText(c.description) === normText(parentRaw));
    const parents = byCode.length ? byCode : byDesc;
    if (parents.length !== 1) {
      issue("BOM_PARENT_UNRESOLVED", `BOM row ${sourceLine}: parent "${parentRaw}" matches ${parents.length} BOQ lines.`);
      continue;
    }
    const qtyRaw = qtyPerIdx !== -1 && !isBlank(row[qtyPerIdx]) ? String(row[qtyPerIdx]) : null;
    const qty = parseQuantity(qtyRaw);
    if (qty.status !== "EXTRACTED" || qty.value === null) {
      issue("BOM_COMPONENT_QTY_INVALID", `BOM row ${sourceLine}: qty per parent "${qtyRaw ?? ""}" is ${qty.status}.`);
      continue;
    }
    const uom = uomIdx !== -1 && !isBlank(row[uomIdx]) ? String(row[uomIdx]) : null;
    if (!uom) {
      issue("BOM_COMPONENT_UOM_MISSING", `BOM row ${sourceLine}: component UOM missing.`);
      continue;
    }

    const parent = parents[0];
    let bomHeader = headersByParent.get(parent.boq_line_id);
    if (!bomHeader) {
      bomHeader = {
        bom_id: crypto.randomUUID(),
        project_id: doc.projectId,
        parent_boq_line_id: parent.boq_line_id,
        source: docRef(doc, `Sheet:${sheetName}`),
        source_document_id: doc.documentId,
        revision: doc.revision,
        verification_status: "EXTRACTED_FROM_EXPLICIT_SOURCE",
      };
      headersByParent.set(parent.boq_line_id, bomHeader);
      result.bomHeaders.push(bomHeader);
    }
    result.bomComponents.push({
      bom_component_id: crypto.randomUUID(),
      bom_id: bomHeader.bom_id,
      component_item_code: compCodeIdx !== -1 && !isBlank(row[compCodeIdx]) ? String(row[compCodeIdx]) : null,
      component_description: compDesc,
      qty_per_parent: qty.value,
      uom,
      wastage: null,
      provenance: JSON.stringify({
        document_id: doc.documentId,
        revision: doc.revision,
        sha256: doc.sha256,
        sheet: sheetName,
        row: i + 1,
        source_line_number: sourceLine,
        parent_source_value: parentRaw,
      }),
    });
  }
}

// ==================== PDF scope ====================

const SCOPE_MARKER = /Scope\s*:\s*(Included|Excluded)|\b(Contractor(?:'s)?\s+Scope|By\s+Contractor)\b|\b(Customer(?:'s)?\s+Scope|Client(?:'s)?\s+Scope|Owner(?:'s)?\s+Scope|By\s+(?:Customer|Client|Owner|Purchaser))\b/gi;

/** Subject = text before the first scope marker on the line (separators stripped). */
export function scopeSubjectOf(line: string): string {
  SCOPE_MARKER.lastIndex = 0;
  const m = SCOPE_MARKER.exec(line);
  SCOPE_MARKER.lastIndex = 0;
  const before = m ? line.slice(0, m.index) : "";
  return normText(before.replace(/[\s\-–—:|,;]+$/g, ""));
}

/**
 * Digital-PDF scope extraction. The PDF bytes are parsed ONLY by the verified
 * digital-PDF extractor (extractPdfText); raw bytes are never decoded as text.
 * Scope markers are read from the extracted text, line by line:
 * "Scope: Included/Excluded" → scope status; "Contractor Scope" / "By Customer"
 * etc. → stated responsibility. Nothing is inferred, no OCR is attempted, and
 * page numbers come only from the extractor.
 */
function extractPdf(doc: EstimationDocument, buf: Buffer, result: ExtractionResult) {
  const pdf = extractPdfText(buf);
  result.pdf = {
    extractor: "pdf-text-extractor",
    status: pdf.status,
    note: pdf.note ?? null,
    pages: pdf.pages.map(p => ({ pageNumber: p.pageNumber, status: p.status })),
  };

  if (pdf.status === "UNSUPPORTED_STRUCTURE" || pdf.status === "ENCRYPTED_NOT_SUPPORTED") {
    result.extractionStatus = pdf.status === "UNSUPPORTED_STRUCTURE" ? "PDF_UNSUPPORTED_STRUCTURE" : "PDF_ENCRYPTED_NOT_SUPPORTED";
    result.clarifications.push(makeClarification(
      doc.projectId,
      result.extractionStatus,
      `PDF could not be read as a digital-text PDF (${pdf.note ?? pdf.status}). No text was extracted.`,
      [docRef(doc, "document")],
      "Provide a digital-text PDF (or XLSX/CSV); no text was fabricated.",
    ));
    return;
  }

  const textPages = pdf.pages.filter(p => p.status === "EXTRACTED" && p.text.trim() !== "");
  const ocrPages = pdf.pages.filter(p => p.status === "OCR_REQUIRED");

  if (ocrPages.length) {
    result.clarifications.push(makeClarification(
      doc.projectId,
      "PDF_OCR_CAPABILITY_REQUIRED",
      `PDF page(s) ${ocrPages.map(p => p.pageNumber).join(", ")} contain images without digital text; OCR is not available in this phase.`,
      ocrPages.map(p => docRef(doc, `Page ${p.pageNumber}`)),
      "Provide a digital-text version or a manual transcription; no OCR was performed and no text was fabricated.",
    ));
  }
  if (textPages.length === 0) {
    result.extractionStatus = ocrPages.length ? "OCR_CAPABILITY_REQUIRED" : "NO_EXTRACTABLE_TEXT";
    return;
  }
  result.extractionStatus = ocrPages.length ? "PARTIAL_OCR_CAPABILITY_REQUIRED" : "COMPLETED";

  for (const page of textPages) {
    page.text.split(/\r?\n/).forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line) return;
      const subject = scopeSubjectOf(line);
      SCOPE_MARKER.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SCOPE_MARKER.exec(line)) !== null) {
        const status = m[1] ? (m[1].toLowerCase() === "included" ? "INCLUDED" : "EXCLUDED") : "RESPONSIBILITY_STATED";
        const responsibility = m[2] ? "CONTRACTOR" : m[3] ? "CUSTOMER" : null;
        result.scopeItems.push({
          scope_item_id: crypto.randomUUID(),
          project_id: doc.projectId,
          category: "GENERAL",
          description: line,
          scope_status: status,
          responsibility,
          source_document_id: doc.documentId,
          source_revision: doc.revision,
          source_sha256: doc.sha256,
          source_page_number: page.pageNumber,
          source_location: `Page ${page.pageNumber}:ExtractedLine ${idx + 1}`,
          extraction_method: "pdf-text-extractor",
          evidence_text: line,
          marker_text: m[0],
          scope_subject: subject,
          conflict_status: null as string | null,
          clarification_id: null as string | null,
        });
      }
      SCOPE_MARKER.lastIndex = 0;
    });
  }
}

/**
 * Deterministic contradiction detection for one subject:
 * INCLUDED vs EXCLUDED, or CONTRACTOR vs CUSTOMER responsibility,
 * within this document and against persisted scope items of OTHER current
 * documents. Items from superseded revisions are not applicable (revision
 * precedence) and never raise a conflict. Conflicts are not resolved here.
 */
function detectScopeConflicts(db: DbLike, doc: EstimationDocument, result: ExtractionResult) {
  const current = currentDocumentIds(db, doc.projectId);
  const persisted = (db.prepare(`
    SELECT s.*, d.revision AS doc_revision FROM estimation_scope_items s
    JOIN estimation_documents d ON d.document_id = s.source_document_id
    WHERE s.project_id = ? AND s.source_document_id <> ?
  `).all(doc.projectId, doc.documentId) as any[])
    .filter(s => current.has(String(s.source_document_id)))
    .map(s => ({
      ...s,
      scope_subject: scopeSubjectOf(String(s.evidence_text ?? "")),
      source_revision: s.source_revision ?? s.doc_revision,
    }));

  const all = [...result.scopeItems, ...persisted];
  const subjects = new Set(result.scopeItems.map(s => s.scope_subject));
  for (const subject of subjects) {
    const group = all.filter(s => s.scope_subject === subject);
    const statuses = new Set(group.map(s => s.scope_status).filter(s => s === "INCLUDED" || s === "EXCLUDED"));
    const resp = new Set(group.map(s => s.responsibility).filter(Boolean));
    const kinds: string[] = [];
    if (statuses.size > 1) kinds.push("INCLUDED_VS_EXCLUDED");
    if (resp.size > 1) kinds.push("CONTRACTOR_VS_CUSTOMER");
    if (!kinds.length) continue;

    const involved = group.filter(s =>
      (kinds.includes("INCLUDED_VS_EXCLUDED") && (s.scope_status === "INCLUDED" || s.scope_status === "EXCLUDED")) ||
      (kinds.includes("CONTRACTOR_VS_CUSTOMER") && s.responsibility));
    const refs = involved.map(s => `doc:${s.source_document_id}#rev${s.source_revision}#${s.source_location}: ${s.evidence_text}`);
    const clar = makeClarification(
      doc.projectId,
      "SCOPE_CONFLICT",
      `Conflicting scope statements for "${subject || "(unspecified subject)"}" (${kinds.join(", ")}).`,
      refs,
      "Owner to decide which statement applies; both sources are current and revision precedence does not resolve the conflict.",
    );
    result.clarifications.push(clar);
    for (const s of result.scopeItems) {
      if (s.scope_subject === subject && involved.includes(s)) {
        s.conflict_status = "CONFLICT_OPEN";
        s.clarification_id = clar.clarification_id;
      }
    }
  }
}
