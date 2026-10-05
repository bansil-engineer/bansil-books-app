import { getEstimationDatabase, closeEstimationDatabase } from "../app/lib/db/estimation-database.ts";
import { getEstimationDbPath } from "../app/lib/db/db-resolver.ts";
import { startExtractionRun } from "../app/lib/ai/estimation/extraction.ts";
import { canonicalizeUom, convertQuantity, selectCurrentRevision } from "../app/lib/ai/estimation/evidence.ts";
import { getEstimationReviewHook, routeEstimationTask } from "../app/lib/ai/estimation/authority.ts";
import { transitionClarification } from "../app/lib/ai/estimation/safety.ts";
import { isZohoWriteAllowed } from "../app/lib/ai/ceo/authority-policy.ts";
import { RateSourceReader } from "../app/lib/ai/estimation/rate-source-reader.ts";
import { aliasKeyForName, resolveItemMatch } from "../app/lib/ai/estimation/rate-engine.ts";
import type { ClarificationRecord, EstimationDocument } from "../app/lib/ai/estimation/types.ts";
import { extractPdfText } from "../app/lib/audit/intake/pdf-text-extractor.ts";
import { diffHashes, snapshotOperationalHashes } from "./test-db-isolation.ts";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { utils, write } from "xlsx";

let failCount = 0;
let passCount = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`[PASS] ${msg}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${msg}`);
    failCount++;
  }
}

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const EXTRACTION_SRC = fs.readFileSync(path.join(process.cwd(), "app/lib/ai/estimation/extraction.ts"), "utf8");
const EXTRACTION_IMPORTS = [...EXTRACTION_SRC.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
const EXTRACTION_CODE = EXTRACTION_SRC.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

type DocInput = Omit<EstimationDocument, "supersededByDocumentId"> & { supersededByDocumentId: string | null; storagePath: string };

function makeDoc(over: Partial<DocInput> & { buf: Buffer }): DocInput {
  return {
    documentId: crypto.randomUUID(),
    projectId: "PROJ-101",
    type: "TENDER",
    familyKey: "BOQ_DOC",
    revision: 1,
    revisionLabel: "R1",
    format: "XLSX",
    sourceId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    sha256: sha256(over.buf),
    supersededByDocumentId: null,
    status: "CURRENT",
    storagePath: "/tmp/fake.xlsx",
    ...over,
  };
}

function insertDoc(db: DatabaseSync, d: DocInput) {
  db.prepare(`
    INSERT INTO estimation_documents (document_id, project_id, type, family_key, revision, format, source_id, received_at, sha256, superseded_by_document_id, status, storage_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.documentId, d.projectId, d.type, d.familyKey, d.revision, d.format, d.sourceId, d.receivedAt, d.sha256, d.supersededByDocumentId, d.status, d.storagePath);
}

function xlsx(sheets: Record<string, unknown[][]>): Buffer {
  const wb = utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), name);
  return Buffer.from(write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ---------- minimal real PDF builder (digital text / image-only / empty pages) ----------
type PdfPageSpec = string[] | "IMAGE" | "EMPTY";
const pdfEscape = (t: string) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Builds a structurally valid PDF. Text pages use FlateDecode streams, so the raw bytes never contain the text. */
function makePdf(pages: PdfPageSpec[]): Buffer {
  const objs: Array<{ num: number; dict: string; stream?: Buffer }> = [];
  let next = 3;
  const kids: number[] = [];
  for (const spec of pages) {
    const pageNum = next++;
    const contentNum = next++;
    kids.push(pageNum);
    if (spec === "IMAGE") {
      const imgNum = next++;
      objs.push({ num: pageNum, dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R /Resources << /XObject << /Im1 ${imgNum} 0 R >> >> >>` });
      const content = Buffer.from("q 612 0 0 792 0 0 cm /Im1 Do Q", "latin1");
      objs.push({ num: contentNum, dict: `<< /Length ${content.length} >>`, stream: content });
      const jpegLike = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      objs.push({ num: imgNum, dict: `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegLike.length} >>`, stream: jpegLike });
    } else if (spec === "EMPTY") {
      objs.push({ num: pageNum, dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R >>` });
      const content = Buffer.from("q Q", "latin1");
      objs.push({ num: contentNum, dict: `<< /Length ${content.length} >>`, stream: content });
    } else {
      objs.push({ num: pageNum, dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>` });
      // Each line is shown with Tj and followed by a relative move (Td) to the next line.
      const ops = `BT /F1 11 Tf 50 750 Td ${spec.map(l => `(${pdfEscape(l)}) Tj 0 -14 Td`).join(" ")} ET`;
      const compressed = zlib.deflateSync(Buffer.from(ops, "latin1"));
      objs.push({ num: contentNum, dict: `<< /Length ${compressed.length} /Filter /FlateDecode >>`, stream: compressed });
    }
  }
  objs.unshift({ num: 2, dict: `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>` });
  objs.unshift({ num: 1, dict: "<< /Type /Catalog /Pages 2 0 R >>" });
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  for (const o of objs) {
    parts.push(Buffer.from(`${o.num} 0 obj\n${o.dict}\n`, "latin1"));
    if (o.stream) parts.push(Buffer.from("stream\n", "latin1"), o.stream, Buffer.from("\nendstream\n", "latin1"));
    parts.push(Buffer.from("endobj\n", "latin1"));
  }
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}

function keysOf(objs: object[]): string[] {
  return [...new Set(objs.flatMap((o) => Object.keys(o).map((k) => k.toLowerCase())))];
}

async function run() {
  console.log("=== PHASE 4C TESTS ===");

  // Isolation: unique temp estimation DB (and AI workspace path) per run.
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "phase4c-"));
  process.env.ESTIMATION_DB_PATH = path.join(TMP, "test_estimation_4c.sqlite");
  process.env.AI_WORKSPACE_DB_PATH = path.join(TMP, "ai_workspace_4c.db");
  const operationalBefore = snapshotOperationalHashes();

  const db = getEstimationDatabase();

  // Sheet 1: Valid BOQ
  const xlsxBuf = xlsx({
    "Electrical BOQ": [
      ["Title", "Not relevant"],
      ["Item Code", "Description", "Quantity", "UOM", "Remarks"],
      ["ITM-01", "Transformer 500kVA", 2, "Nos", "ABB"],
      ["ITM-02", "Cables", "Lot", "Set", "Include lugs"], // Lot is non-numeric quantity
      ["ITM-03", "Panels", null, "Nos", "Unknown Qty"],
      ["ITM-04", "Switchgear", 10, null, "Missing UOM"],
      ["ITM-05", "TestItem", 0, "M", "Zero qty"],
      ["ITM-06", "BadItem", -5, "M", "Negative qty"],
    ],
    // Sheet 2: Not a BOQ
    References: [["Some reference data", "More data"], ["Foo", "Bar"]],
  });
  const FIXTURE_UOM: Record<string, string | null> = { "ITM-01": "Nos", "ITM-02": "Set", "ITM-03": "Nos", "ITM-04": null, "ITM-05": "M", "ITM-06": "M" };

  const doc = makeDoc({ buf: xlsxBuf });
  insertDoc(db, doc);

  // 1. structured XLSX BOQ extracted
  const result = startExtractionRun(doc.projectId, doc as any, Buffer.from(xlsxBuf));

  assert(result.boqLines.length > 0, "1. structured XLSX BOQ extracted");
  assert(result.boqLines.find(l => l.description === "Transformer 500kVA") !== undefined, "11. item description preserved");
  assert(result.boqLines.find(l => l.quantity === 2) !== undefined, "12. explicit quantity preserved");

  // Non-numeric "Lot"
  const lotItem = result.boqLines.find(l => l.description === "Cables");
  assert(lotItem && lotItem.quantity === null && lotItem.quantity_status === "NON_NUMERIC_SOURCE", "14. nonnumeric Lot not converted to fake numeric quantity");

  // Missing quantity
  const missingQty = result.boqLines.find(l => l.description === "Panels");
  assert(missingQty && missingQty.quantity === null && missingQty.quantity_status === "MISSING_QTY", "13. missing quantity not invented");

  // Missing UOM
  const missingUom = result.boqLines.find(l => l.description === "Switchgear");
  assert(missingUom && missingUom.uom === null && missingUom.uom_status === "MISSING_UOM", "16. missing UOM not invented");

  // Zero/Negative qty
  const zeroItem = result.boqLines.find(l => l.description === "TestItem");
  assert(zeroItem && zeroItem.quantity_status === "ZERO_QUANTITY", "34. zero quantity flagged");

  const negItem = result.boqLines.find(l => l.description === "BadItem");
  assert(negItem && negItem.quantity_status === "NEGATIVE_QUANTITY", "35. negative quantity flagged");

  // 32. multi-sheet workbook does not classify every sheet as BOQ
  const referenceLines = result.boqLines.filter(l => l.section === "References");
  assert(referenceLines.length === 0, "32. multi-sheet workbook does not classify every sheet as BOQ");

  // ---------- provenance ----------
  const transformer = result.boqLines.find(l => l.item_code === "ITM-01")!;
  assert(result.boqLines.every(l => l.document_id === doc.documentId && l.project_id === doc.projectId), "4. source document id preserved");
  assert(result.boqLines.every(l => l.revision === doc.revision), "5. revision preserved");
  assert(transformer.source_location === "Electrical BOQ" && result.boqLines.every(l => String(l.source_line_number).startsWith("Sheet:Electrical BOQ:Row:")),
    "7. XLSX sheet provenance preserved");
  assert(transformer.source_line_number === "Sheet:Electrical BOQ:Row:3" && lotItem.source_line_number === "Sheet:Electrical BOQ:Row:4",
    "8. XLSX row provenance preserved (exact spreadsheet row)");
  assert(transformer.uom === "Nos" && lotItem.uom === "Set" && result.boqLines.every(l => l.uom === FIXTURE_UOM[l.item_code]),
    "15. explicit UOM preserved (exact source label)");
  assert(transformer.uom === "Nos" && transformer.uom_status === "EXTRACTED" && canonicalizeUom(transformer.uom) === "NOS" && transformer.quantity === 2,
    "17. approved UOM alias may normalize label (label only; stored source UOM and qty untouched)");
  assert(convertQuantity(2, "Set", "Nos", []).ok === false && lotItem.uom === "Set" && result.boqLines.every(l => l.uom === FIXTURE_UOM[l.item_code]),
    "18. unapproved UOM conversion blocked (no conversion during extraction; no rule ⇒ refused)");
  assert(result.boqLines.map(l => l.item_code).sort().join() === "ITM-01,ITM-02,ITM-03,ITM-04,ITM-05,ITM-06", "19. item code preserved");
  assert(result.boqLines.every(l => l.make_brand === null), "20a. make not invented when source is silent");
  assert(result.boqLines.every(l => l.section === "Electrical BOQ"), "31. BOQ section preserved");
  assert(result.boqLines.filter(l => l.quantity_status !== "EXTRACTED" || l.uom_status !== "EXTRACTED").every(l => l.line_status === "CLARIFICATION_REQUIRED") &&
    transformer.line_status === "EXTRACTED", "16b. gaps (qty/UOM) raise CLARIFICATION_REQUIRED; clean lines stay EXTRACTED");

  // ---------- malformed quantities (no quantity invention) ----------
  const malBuf = xlsx({ Malformed: [["Item Code", "Description", "Quantity", "UOM"], ["M-01", "Cable 4C", "1,200", "M"], ["M-02", "Lug", "12abc", "Nos"]] });
  const malDoc = makeDoc({ buf: malBuf, familyKey: "MALFORMED_DOC" });
  insertDoc(db, malDoc);
  const mal = startExtractionRun(malDoc.projectId, malDoc as any, malBuf);
  assert(mal.boqLines.length === 2 && mal.boqLines.every(l => l.quantity === null && l.quantity_status === "MALFORMED_QUANTITY" && l.line_status === "CLARIFICATION_REQUIRED"),
    "36. malformed quantity flagged (\"1,200\" / \"12abc\" never become 1 / 12)");

  // ---------- CSV ----------
  const csvBuf = Buffer.from("Item Code,Description,Quantity,UOM\nC-01,Cable Tray 300mm,25,M\nC-02,Tray Bend,,Nos\n");
  const csvDoc = makeDoc({ buf: csvBuf, familyKey: "CSV_BOQ", format: "CSV", storagePath: "/tmp/fake.csv" });
  insertDoc(db, csvDoc);
  const csv = startExtractionRun(csvDoc.projectId, csvDoc as any, csvBuf);
  const c1 = csv.boqLines.find(l => l.item_code === "C-01");
  const c2 = csv.boqLines.find(l => l.item_code === "C-02");
  assert(csv.boqLines.length === 2 && c1?.quantity === 25 && c1?.uom === "M" && c2?.quantity === null && c2?.quantity_status === "MISSING_QTY", "2. CSV BOQ extracted");
  assert(/:Row:2$/.test(c1?.source_line_number ?? "") && /:Row:3$/.test(c2?.source_line_number ?? "") && csv.boqLines.every(l => l.document_id === csvDoc.documentId),
    "9. CSV row provenance preserved");

  // ---------- make column ----------
  const makeBuf = xlsx({ Make: [["Item Code", "Description", "Qty", "UOM", "Make"], ["K-01", "ACB 800A", 1, "Nos", "ABB"], ["K-02", "MCCB 100A", 2, "Nos", null]] });
  const makeDocR = makeDoc({ buf: makeBuf, familyKey: "MAKE_DOC" });
  insertDoc(db, makeDocR);
  const mk = startExtractionRun(makeDocR.projectId, makeDocR as any, makeBuf);
  const mk1 = mk.boqLines.find(l => l.item_code === "K-01");
  const mk2 = mk.boqLines.find(l => l.item_code === "K-02");
  assert(mk.boqLines.length === 2 && mk1?.make_brand === "ABB" && mk1?.make_source === "Sheet:Make:Row:2:Col:Make" &&
    mk1?.document_id === makeDocR.documentId && mk2?.make_brand === null && mk2?.make_source === null,
    "20b. make preserved when source states it (exact value, sheet/row/document provenance; blank stays null)");

  // ---------- duplicates / ambiguous headers ----------
  const dupBuf = xlsx({
    Dup: [["Item Code", "Description", "Qty", "UOM"], ["E-01", "Earthing Pit", 1, "Nos"], ["E-01", "Earthing Pit", 1, "Nos"]],
    "Dup Section 2": [["Item Code", "Description", "Qty", "UOM"], ["E-01", "Earthing Pit", 1, "Nos"]],
    Numbered: [["Sl No", "Item Code", "Description", "Qty", "UOM"], [1, "E-02", "Lightning Arrester", 1, "Nos"], [2, "E-02", "Lightning Arrester", 1, "Nos"]],
  });
  const dupDoc = makeDoc({ buf: dupBuf, familyKey: "DUP_DOC" });
  insertDoc(db, dupDoc);
  const dup = startExtractionRun(dupDoc.projectId, dupDoc as any, dupBuf);
  const dupFlagged = dup.boqLines.filter(l => l.duplicate_status === "DUPLICATE_OF_SOURCE_LINE");
  const dupFirst = dup.boqLines.find(l => l.source_line_number === "Sheet:Dup:Row:2");
  const dupClar = dup.clarifications.filter(c => c.type === "DUPLICATE_BOQ_LINE");
  assert(dup.boqLines.length === 5 &&
    dup.boqLines.filter(l => l.section !== "Dup").every(l => l.duplicate_status === "UNIQUE" && l.line_status === "EXTRACTED"),
    "30. intentional repeated items not incorrectly deduplicated (other section / different line number kept and unflagged)");
  assert(dupFlagged.length === 1 && dupFlagged[0].source_line_number === "Sheet:Dup:Row:3" && dupFlagged[0].duplicate_of_line_id === dupFirst?.boq_line_id &&
    dupFlagged[0].line_status === "CLARIFICATION_REQUIRED" && dupFirst?.duplicate_status === "HAS_DUPLICATE" && dupClar.length === 1 &&
    JSON.parse(dupClar[0].source_references).length === 2,
    "29. duplicate exact source line detected (flagged with clarification, not removed)");

  const ambBuf = xlsx({ Amb: [["Description", "Qty", "Quantity", "UOM"], ["GI Pipe 50mm", 5, 7, "M"], ["GI Pipe 25mm", 3, 3, "M"], ["GI Elbow", null, 4, "Nos"]] });
  const ambDoc = makeDoc({ buf: ambBuf, familyKey: "AMB_DOC" });
  insertDoc(db, ambDoc);
  const amb = startExtractionRun(ambDoc.projectId, ambDoc as any, ambBuf);
  const amb50 = amb.boqLines.find(l => l.description === "GI Pipe 50mm");
  const amb25 = amb.boqLines.find(l => l.description === "GI Pipe 25mm");
  const ambElbow = amb.boqLines.find(l => l.description === "GI Elbow");
  const ambClar = amb.clarifications.filter(c => c.type === "AMBIGUOUS_QUANTITY");
  const ambRefs: string[] = ambClar.length ? JSON.parse(ambClar[0].source_references) : [];
  assert(amb.boqLines.length === 3 && amb50?.quantity === null && amb50?.quantity_status === "AMBIGUOUS_QUANTITY" && amb50?.line_status === "CLARIFICATION_REQUIRED" &&
    amb50?.quantity_evidence.map((c: any) => `${c.column}=${c.raw}`).join() === "Qty=5,Quantity=7" &&
    ambClar.length === 1 && ambRefs.some(r => r.endsWith("Col:Qty=5")) && ambRefs.some(r => r.endsWith("Col:Quantity=7")) &&
    amb25?.quantity === 3 && amb25?.quantity_status === "EXTRACTED" && ambElbow?.quantity === 4,
    "33. ambiguous quantity columns flagged (conflict not guessed, both values preserved; agreeing/single values used)");

  // ---------- PDF scope ----------
  const pdfText = "Scope: Included and Scope: Excluded";
  const pdfBuf = makePdf([[pdfText]]);
  const docPdf = makeDoc({ buf: pdfBuf, familyKey: "SCOPE_DOC", format: "PDF", storagePath: "/tmp/fake.pdf" });
  insertDoc(db, docPdf);

  const resultPdf = startExtractionRun(docPdf.projectId, docPdf as any, pdfBuf);
  assert(resultPdf.scopeItems.length > 0, "3. PDF scope text extraction supported");
  assert(resultPdf.scopeItems.find(s => s.scope_status === "INCLUDED") !== undefined, "21. scope included extracted");
  assert(resultPdf.scopeItems.find(s => s.scope_status === "EXCLUDED") !== undefined, "22. scope excluded extracted");
  assert(resultPdf.scopeItems.every(s => s.source_document_id === docPdf.documentId && s.source_revision === 1 && s.source_page_number === 1 &&
    s.source_location === "Page 1:ExtractedLine 1" && pdfText.includes(s.evidence_text)),
    "10. PDF page provenance preserved where available (document, revision, extractor page, verbatim evidence)");
  assert(resultPdf.scopeItems.every(s => pdfText.includes(s.description) && s.responsibility === null),
    "10b. scope description is source text; responsibility not inferred");

  const conflictText = "Earthing - Scope: Included\nEarthing - Scope: Excluded";
  const conflictBuf = makePdf([conflictText.split("\n")]);
  const conflictDoc = makeDoc({ buf: conflictBuf, familyKey: "CONFLICT_DOC", format: "PDF", storagePath: "/tmp/conflict.pdf" });
  insertDoc(db, conflictDoc);
  const conflict = startExtractionRun(conflictDoc.projectId, conflictDoc as any, conflictBuf);
  const clarRows = db.prepare("SELECT * FROM estimation_clarifications WHERE project_id = ?").all(conflictDoc.projectId) as any[];
  const scClar = conflict.clarifications.filter(c => c.type === "SCOPE_CONFLICT");
  assert(conflict.scopeItems.length === 2 && conflict.scopeItems.every(s => s.scope_subject === "EARTHING" && s.conflict_status === "CONFLICT_OPEN") &&
    new Set(conflict.scopeItems.map(s => s.scope_status)).size === 2 && scClar.length === 1 &&
    conflict.scopeItems.every(s => s.clarification_id === scClar[0].clarification_id),
    "23. contradictory scope creates conflict (INCLUDED vs EXCLUDED, both statements kept)");

  // Cross-document: two CURRENT documents disagree on responsibility → conflict.
  // A SUPERSEDED revision that disagrees is resolved by revision precedence → no conflict.
  const insScope = db.prepare(`INSERT INTO estimation_scope_items (scope_item_id, project_id, category, description, scope_status, responsibility, source_document_id, source_revision, source_location, evidence_text, clarification_id)
    VALUES (?, ?, 'GENERAL', ?, ?, ?, ?, ?, ?, ?, NULL)`);
  const specText = "Cabling - Contractor Scope";
  const specBuf = makePdf([[specText]]);
  const specDoc = makeDoc({ buf: specBuf, familyKey: "SPEC_DOC", format: "PDF", storagePath: "/tmp/spec.pdf" });
  insertDoc(db, specDoc);
  const spec = startExtractionRun(specDoc.projectId, specDoc as any, specBuf);
  for (const si of spec.scopeItems) insScope.run(si.scope_item_id, si.project_id, si.description, si.scope_status, si.responsibility, si.source_document_id, si.source_revision, si.source_location, si.evidence_text);
  const oldGcc = makeDoc({ buf: Buffer.from("Lighting - Scope: Excluded"), familyKey: "GCC_DOC", revision: 1, status: "SUPERSEDED" });
  const newGcc = makeDoc({ buf: Buffer.from("Lighting - Scope: Included"), familyKey: "GCC_DOC", revision: 2, format: "PDF" });
  oldGcc.supersededByDocumentId = newGcc.documentId;
  insertDoc(db, oldGcc);
  insScope.run(crypto.randomUUID(), oldGcc.projectId, "Lighting - Scope: Excluded", "EXCLUDED", null, oldGcc.documentId, 1, "Line 1", "Lighting - Scope: Excluded");
  const addText = "Cabling - By Customer\nLighting - Scope: Included";
  const addBuf = makePdf([addText.split("\n")]);
  const addDoc = makeDoc({ buf: addBuf, familyKey: "ADDENDUM_DOC", format: "PDF", storagePath: "/tmp/add.pdf" });
  insertDoc(db, addDoc);
  const add = startExtractionRun(addDoc.projectId, addDoc as any, addBuf);
  const crossClar = add.clarifications.filter(c => c.type === "SCOPE_CONFLICT");
  const cabling = add.scopeItems.find(s => s.scope_subject === "CABLING");
  const lighting = add.scopeItems.find(s => s.scope_subject === "LIGHTING");
  const clarRowsAll = db.prepare("SELECT * FROM estimation_clarifications WHERE project_id = ? AND type = 'SCOPE_CONFLICT'").all(conflictDoc.projectId) as any[];
  assert(cabling?.responsibility === "CUSTOMER" && cabling?.conflict_status === "CONFLICT_OPEN" && crossClar.length === 1 &&
    lighting?.conflict_status === null && spec.scopeItems[0]?.responsibility === "CONTRACTOR" &&
    clarRowsAll.some(r => r.clarification_id === scClar[0]?.clarification_id && r.status === "OPEN") &&
    clarRowsAll.some(r => r.clarification_id === crossClar[0]?.clarification_id) && clarRows.length >= 1,
    "24. conflict creates clarification (persisted OPEN; within document and across current documents; superseded revision does not conflict)");
  const refsWithin: string[] = scClar.length ? JSON.parse(scClar[0].source_references) : [];
  const refsCross: string[] = crossClar.length ? JSON.parse(crossClar[0].source_references) : [];
  assert(refsWithin.length === 2 && refsWithin.some(r => r.endsWith("Line 1: Earthing - Scope: Included")) && refsWithin.some(r => r.endsWith("Line 2: Earthing - Scope: Excluded")) &&
    refsCross.length === 2 && refsCross.some(r => r.startsWith(`doc:${specDoc.documentId}#rev1#`) && r.endsWith(specText)) &&
    refsCross.some(r => r.startsWith(`doc:${addDoc.documentId}#rev1#`) && r.endsWith("Cabling - By Customer")),
    "25. clarification retains both sources (document, revision, location, verbatim text)");

  // ---------- persistence / SHA linkage ----------
  // Persist the results and query the DB to ensure isolation and correctness
  for (const boq of result.boqLines) {
    db.prepare(`
      INSERT INTO estimation_boq_lines (boq_line_id, project_id, document_id, revision, source_line_number, source_location, item_code, description, quantity, quantity_status, uom, uom_status, make_brand, technical_specification, remarks, section, subsection, parent_line_id, line_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(boq.boq_line_id, boq.project_id, boq.document_id, boq.revision, boq.source_line_number, boq.source_location, boq.item_code, boq.description, boq.quantity, boq.quantity_status, boq.uom, boq.uom_status, boq.make_brand, boq.technical_specification, boq.remarks, boq.section, boq.subsection, boq.parent_line_id, boq.line_status);
  }

  const boqCount = db.prepare("SELECT COUNT(*) as c FROM estimation_boq_lines WHERE document_id = ?").get(doc.documentId) as { c: number };
  assert(boqCount.c === 6, "DB insert works and exact rows returned");

  const linked = db.prepare(`SELECT b.boq_line_id, d.sha256 FROM estimation_boq_lines b JOIN estimation_documents d ON d.document_id = b.document_id WHERE b.document_id = ?`).all(doc.documentId) as any[];
  assert(linked.length === 6 && linked.every(r => r.sha256 === sha256(xlsxBuf)), "6. SHA source linkage preserved (BOQ row → document sha256 of exact bytes)");

  // ---------- reparse / audit trail ----------
  const persistedBefore = JSON.stringify(db.prepare("SELECT * FROM estimation_boq_lines WHERE document_id = ? ORDER BY boq_line_id").all(doc.documentId));
  const docRowBefore = JSON.stringify(db.prepare("SELECT * FROM estimation_documents WHERE document_id = ?").get(doc.documentId));
  const rerun = startExtractionRun(doc.projectId, doc as any, Buffer.from(xlsxBuf));
  const runs = db.prepare("SELECT extraction_run_id, status, method FROM estimation_extraction_runs WHERE document_id = ? ORDER BY rowid").all(doc.documentId) as any[];
  assert(runs.length === 2 && runs.every(r => r.status === "COMPLETED") && runs[0].extraction_run_id === result.runId && runs[1].extraction_run_id === rerun.runId,
    "27. previous extraction remains auditable");
  assert(JSON.stringify(db.prepare("SELECT * FROM estimation_documents WHERE document_id = ?").get(doc.documentId)) === docRowBefore && rerun.boqLines.length === 6 &&
    rerun.boqLines.every(l => l.document_id === doc.documentId), "54. reparse preserves original source");
  assert(JSON.stringify(db.prepare("SELECT * FROM estimation_boq_lines WHERE document_id = ? ORDER BY boq_line_id").all(doc.documentId)) === persistedBefore,
    "55. no source row overwritten");

  // ---------- revisions ----------
  const rev1Buf = xlsx({ BOQ: [["Item Code", "Description", "Qty", "UOM"], ["R-01", "Cable Tray", 10, "M"]] });
  const rev2Buf = xlsx({ BOQ: [["Item Code", "Description", "Qty", "UOM"], ["R-01", "Cable Tray", 12, "M"]] });
  const rev2 = makeDoc({ buf: rev2Buf, familyKey: "REV_FAMILY", revision: 2, revisionLabel: "R2" });
  const rev1 = makeDoc({ buf: rev1Buf, familyKey: "REV_FAMILY", revision: 1, status: "SUPERSEDED", supersededByDocumentId: rev2.documentId });
  insertDoc(db, rev1);
  insertDoc(db, rev2);
  const r1 = startExtractionRun(rev1.projectId, rev1 as any, rev1Buf);
  const r1Run = db.prepare("SELECT status FROM estimation_extraction_runs WHERE extraction_run_id = ?").get(r1.runId) as any;
  const stale = makeDoc({ buf: rev1Buf, familyKey: "REV_FAMILY", revision: 0, revisionLabel: "R0-still-marked-current" });
  insertDoc(db, stale);
  const r0 = startExtractionRun(stale.projectId, stale as any, rev1Buf);
  assert(r1.boqLines.length === 0 && r1Run.status === "REJECTED_NOT_CURRENT_REVISION" && r0.boqLines.length === 0,
    "26. superseded document not used as current source (incl. older revision still marked CURRENT)");
  const current = selectCurrentRevision([rev1 as any, rev2 as any, stale as any], "REV_FAMILY");
  const r2 = startExtractionRun(rev2.projectId, rev2 as any, rev2Buf);
  assert(current?.documentId === rev2.documentId && r2.boqLines.length === 1 && r2.boqLines[0].revision === 2 && r2.boqLines[0].quantity === 12,
    "28. current revision selected");

  // ---------- BOM ----------
  const bomBuf = xlsx({
    BOQ: [["Item Code", "Description", "Qty", "UOM"], ["PNL-1", "LT Panel-1", 1, "Nos"]],
    BOM: [["Parent Item", "Component", "Qty Per", "UOM"], ["PNL-1", "MCB 6A", 4, "Nos"], ["PNL-1", "Busbar", "4 runs", "Set"], ["PNL-9", "MCCB", 1, "Nos"]],
  });
  const bomDoc = makeDoc({ buf: bomBuf, familyKey: "BOM_DOC" });
  insertDoc(db, bomDoc);
  const bom = startExtractionRun(bomDoc.projectId, bomDoc as any, bomBuf);
  const pnl = bom.boqLines.find(l => l.item_code === "PNL-1");
  assert(bom.boqLines.length === 1 && !!pnl && bom.bomHeaders.length === 1 && bom.bomHeaders[0]?.parent_boq_line_id === pnl.boq_line_id &&
    bom.bomHeaders[0]?.verification_status === "EXTRACTED_FROM_EXPLICIT_SOURCE" && bom.bomHeaders[0]?.source_document_id === bomDoc.documentId &&
    bom.bomHeaders[0]?.revision === 1, "41. explicit BOM source creates BOM (linked to parent BOQ line; BOM sheet not read as BOQ)");
  const bomProv = bom.bomComponents.map(c => JSON.parse(c.provenance));
  assert(bom.bomComponents.length === 1 && bomProv[0]?.document_id === bomDoc.documentId && bomProv[0]?.revision === 1 && bomProv[0]?.sheet === "BOM" &&
    bomProv[0]?.row === 2 && bomProv[0]?.sha256 === bomDoc.sha256 && bom.bomComponents[0]?.bom_id === bom.bomHeaders[0]?.bom_id,
    "42. BOM component provenance preserved (document, revision, sheet, row, sha256)");
  const bomClarTypes = bom.clarifications.map(c => c.type).sort().join();
  assert(bom.bomComponents[0]?.qty_per_parent === 4 && bom.bomComponents[0]?.uom === "Nos" && bom.bomComponents[0]?.component_description === "MCB 6A" &&
    bom.bomComponents[0]?.wastage === null && bomClarTypes === "BOM_COMPONENT_QTY_INVALID,BOM_PARENT_UNRESOLVED",
    "43. BOM quantity preserved (malformed qty / unresolved parent create clarifications, never components)");
  const bomRows = (db.prepare("SELECT (SELECT COUNT(*) FROM estimation_bom_headers) AS h, (SELECT COUNT(*) FROM estimation_bom_components) AS c").get()) as any;
  assert(result.bomHeaders.length === 0 && result.bomComponents.length === 0 && Number(bomRows.h) === 0 && Number(bomRows.c) === 0 &&
    [csv, mk, dup, amb, rerun, r2].every(r => r.bomHeaders.length === 0 && r.bomComponents.length === 0),
    "44. missing BOM does not fabricate components (no explicit BOM table ⇒ no BOM)");
  const aiImports = EXTRACTION_IMPORTS.filter(m => /providers|model-router|agent-router|anthropic|openai|gemini/i.test(m));
  assert(aiImports.length === 0 && result.bomComponents.length === 0, "45. AI cannot invent BOM (no AI path; no components)");
  assert(!/audit_bom|getAuditDatabase|audit_workspace/i.test(EXTRACTION_CODE) && result.bomHeaders.length === 0, "46. historical BOM not silently override tender BOM (no historical BOM source read)");

  // ---------- item mapping (approved alias via Phase 4D resolver) ----------
  const itemDbPath = path.join(TMP, "items_fixture.db");
  const idb = new DatabaseSync(itemDbPath);
  idb.exec("CREATE TABLE audit_item_master (item_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT, sku TEXT, unit TEXT, status TEXT, rate TEXT, item_type TEXT, product_type TEXT, last_modified_time TEXT, synced_at TEXT NOT NULL)");
  idb.prepare("INSERT INTO audit_item_master (item_id, organization_id, name, sku, unit, status, synced_at) VALUES ('I-TR', 'ORG', 'Oil Cooled Transformer 500 kVA', 'TR-500', 'Nos', 'active', 'x')").run();
  idb.close();
  const reader = new RateSourceReader({ bansilBooksDbPath: path.join(TMP, "absent_books.db"), auditWorkspaceDbPath: itemDbPath });
  const alias = { query_key: aliasKeyForName(transformer.description), item_id: "I-TR", approved_by: "Owner", approved_at: "2026-10-01T00:00:00Z" };
  const mApproved = resolveItemMatch(reader, { description: transformer.description, itemCode: transformer.item_code }, [alias]);
  const mNoAlias = resolveItemMatch(reader, { description: transformer.description, itemCode: transformer.item_code }, []);
  assert(mApproved.status === "MATCHED" && mApproved.method === "APPROVED_ALIAS" && mApproved.item?.item_id === "I-TR" && mNoAlias.status !== "MATCHED",
    "47. exact approved item alias may be reused (and only with approval)");
  const mPanels = resolveItemMatch(reader, { description: "Panels" }, []);
  assert(mPanels.status !== "MATCHED" && mPanels.item === null && result.boqLines.every(l => !("item_id" in l)), "48. uncertain mapping remains unresolved");
  reader.close();

  // ---------- determinism / AI / review ----------
  assert(runs.every(r => r.method === "DETERMINISTIC_FIRST") && aiImports.length === 0 && !/\bfetch\(/.test(EXTRACTION_CODE),
    "49. deterministic clean XLSX uses zero model calls");
  const aiRoute = routeEstimationTask("TENDER_TEXT_INTERPRETATION");
  assert(aiRoute.route === "AI_ASSIST" && aiRoute.aiOutputStatus === "AI_INFERENCE" && aiImports.length === 0,
    "50. AI-assisted text extraction is review-tagged (AI route labelled AI_INFERENCE; extraction has no AI path)");
  assert([...result.boqLines, ...csv.boqLines].every(l => !!l.document_id && !!l.source_line_number) &&
    resultPdf.scopeItems.every(s => !!s.source_document_id && !!s.evidence_text), "51. AI-assisted result requires source citation (every output carries its source citation)");
  const hook = getEstimationReviewHook("TENDER_RISK_SUMMARY");
  assert(hook.reviewRequired && hook.riskLevel === "HIGH", "52. high-risk scope summary requires checker");
  const ownerClar: ClarificationRecord = {
    clarificationId: "CL-1", kind: "CLARIFICATION", subject: "Earthing scope",
    raisedFrom: { sourceId: "s", tier: "CURRENT_TENDER_DOCUMENT", recordRef: conflictDoc.documentId, recordDate: "2026-10-01" },
    status: "OWNER_DECISION_REQUIRED",
  };
  const attempt = (rec: ClarificationRecord, to: "ACCEPTED" | "REJECTED", role?: "OWNER" | "CHECKER" | "REVIEWER" | "ESTIMATOR"): string => {
    try {
      transitionClarification(rec, to, { decidedBy: role ?? "INDEPENDENT_CHECKER", decidedAt: "2026-10-01T00:00:00Z", decision: "decision", ...(role ? { deciderRole: role } : {}) });
      return "ALLOWED";
    } catch (e: any) {
      return String(e.message).split(":")[0];
    }
  };
  const reviewedClar: ClarificationRecord = { ...ownerClar, status: "REVIEWED" };
  const ownerAccepted = transitionClarification(ownerClar, "ACCEPTED", { decidedBy: "Owner", decidedAt: "2026-10-01T00:00:00Z", decision: "Include earthing", deciderRole: "OWNER" });
  assert(attempt(ownerClar, "ACCEPTED", "CHECKER") === "CHECKER_CANNOT_DECIDE_CLARIFICATION" && attempt(ownerClar, "REJECTED", "REVIEWER") === "CHECKER_CANNOT_DECIDE_CLARIFICATION" &&
    attempt(ownerClar, "ACCEPTED") === "OWNER_DECISION_REQUIRES_OWNER" && attempt(ownerClar, "ACCEPTED", "ESTIMATOR") === "OWNER_DECISION_REQUIRES_OWNER" &&
    attempt(reviewedClar, "ACCEPTED", "CHECKER") === "CHECKER_CANNOT_DECIDE_CLARIFICATION" &&
    ownerAccepted.status === "ACCEPTED" && ownerAccepted.decidedByRole === "OWNER",
    "53. checker cannot resolve Owner clarification (only an OWNER decider can)");

  // ---------- leakage / boundaries ----------
  const outKeys = keysOf([...result.boqLines, ...csv.boqLines, ...resultPdf.scopeItems]);
  const boqCols = (db.prepare("PRAGMA table_info(estimation_boq_lines)").all() as any[]).map(c => String(c.name).toLowerCase());
  assert(![...outKeys, ...boqCols].some(k => /rate|price/.test(k)), "37. no rate created");
  assert(![...outKeys, ...boqCols].some(k => /vendor|supplier/.test(k)), "38. no vendor selected");
  assert(![...outKeys, ...boqCols].some(k => /cost|amount|total|value/.test(k)), "39. no costing performed");
  assert(![...outKeys, ...boqCols].some(k => /margin|markup/.test(k)), "40. no margin calculated");
  assert(getEstimationDbPath() === path.resolve(process.env.ESTIMATION_DB_PATH!) && getEstimationDbPath().startsWith(TMP), "56. estimation DB isolated");
  assert(!/\bfetch\(|https?:\/\/|sendMail|sendEmail|nodemailer/.test(EXTRACTION_CODE), "60. no external send");
  assert(isZohoWriteAllowed() === false && !EXTRACTION_IMPORTS.some(m => /zoho/i.test(m)), "61. no Zoho write");
  assert(EXTRACTION_IMPORTS.every(m => /estimation-database|audit\/intake\/pdf-text-extractor|^node:|^xlsx$|\.\/types/.test(m)) && !EXTRACTION_IMPORTS.some(m => /inventory|customer|report/i.test(m)),
    "62. locked modules untouched (extraction imports only estimation DB, digital-PDF extractor, xlsx, node, types)");

  // ---------- PDF pipeline: parsed digital text only (Phase 4C PDF fix) ----------
  const pdfProject = "PROJ-PDF";
  const runPdf = (buf: Buffer, familyKey: string) => {
    const d = makeDoc({ buf, projectId: pdfProject, familyKey, format: "PDF", storagePath: `/tmp/${familyKey}.pdf` });
    insertDoc(db, d);
    const r = startExtractionRun(d.projectId, d as any, buf);
    const runRow = db.prepare("SELECT status, method FROM estimation_extraction_runs WHERE extraction_run_id = ?").get(r.runId) as any;
    return { d, r, runRow };
  };
  const PDF_SYNTAX = /\b(Tj|TJ|BT|ET|obj|endobj|stream|endstream|FlateDecode)\b|%PDF/;

  // P1: raw bytes are never interpreted as text
  const rawText = "Earthing - Scope: Included";
  const p1a = runPdf(Buffer.from(rawText, "utf8"), "RAW_TEXT_AS_PDF");
  const p1Lines = ["Earthing - Scope: Included", "Cable trays - Scope: Excluded"];
  const p1Buf = makePdf([p1Lines]);
  const p1b = runPdf(p1Buf, "DIGITAL_PDF");
  assert(p1a.r.scopeItems.length === 0 && p1a.r.extractionStatus === "PDF_UNSUPPORTED_STRUCTURE" && p1a.runRow.status === "PDF_UNSUPPORTED_STRUCTURE" &&
    !p1Buf.toString("latin1").includes("Scope: Included") && p1b.r.scopeItems.length === 2 &&
    p1b.r.scopeItems.every(s => !PDF_SYNTAX.test(s.evidence_text) && !PDF_SYNTAX.test(s.description)) &&
    !/toString\(\s*["']utf-?8["']\s*\)/i.test(EXTRACTION_CODE),
    "P1. raw PDF bytes are never interpreted as normal text (plain bytes rejected; compressed digital text found only via parsing)");

  // P2: valid digital PDF uses the existing digital-PDF extractor
  const p1Parsed = extractPdfText(p1Buf);
  const parsedLines = p1Parsed.pages.flatMap(pg => pg.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
  assert(EXTRACTION_IMPORTS.some(m => /audit\/intake\/pdf-text-extractor/.test(m)) && p1b.r.pdf?.extractor === "pdf-text-extractor" &&
    p1b.r.pdf?.status === p1Parsed.status && p1b.r.extractionStatus === "COMPLETED" && p1b.runRow.status === "COMPLETED" &&
    p1b.r.scopeItems.every(s => s.extraction_method === "pdf-text-extractor" && parsedLines.includes(s.evidence_text)),
    "P2. valid digital PDF uses the existing digital-PDF extractor (extractPdfText)");

  // P3: extracted scope text equals source PDF text exactly
  assert(p1b.r.scopeItems.map(s => s.evidence_text).join("|") === p1Lines.join("|") && p1b.r.scopeItems.map(s => s.description).join("|") === p1Lines.join("|") &&
    parsedLines.join("|") === p1Lines.join("|"),
    "P3. extracted scope text equals source PDF text");

  // P4: image-only (scanned-like) PDF → OCR_CAPABILITY_REQUIRED; mixed PDF keeps only digital pages
  const p4 = runPdf(makePdf(["IMAGE"]), "SCANNED_PDF");
  const p4mixed = runPdf(makePdf([["Earthing - Scope: Included"], "IMAGE"]), "MIXED_PDF");
  assert(p4.r.extractionStatus === "OCR_CAPABILITY_REQUIRED" && p4.runRow.status === "OCR_CAPABILITY_REQUIRED" && p4.r.scopeItems.length === 0 &&
    p4.r.clarifications.some(c => c.type === "PDF_OCR_CAPABILITY_REQUIRED") && p4.r.pdf?.pages.map(pg => pg.status).join() === "OCR_REQUIRED" &&
    p4mixed.r.extractionStatus === "PARTIAL_OCR_CAPABILITY_REQUIRED" && p4mixed.r.scopeItems.length === 1 && p4mixed.r.scopeItems[0].source_page_number === 1,
    "P4. image/scanned-like PDF returns OCR_CAPABILITY_REQUIRED (no OCR, no fabricated text)");

  // P5: empty extraction is never a successful scope extraction
  const p5 = runPdf(makePdf(["EMPTY"]), "EMPTY_PDF");
  assert(p5.r.extractionStatus === "NO_EXTRACTABLE_TEXT" && p5.runRow.status === "NO_EXTRACTABLE_TEXT" && p5.runRow.status !== "COMPLETED" &&
    p5.r.scopeItems.length === 0 && p5.r.clarifications.every(c => c.type !== "SCOPE_CONFLICT"),
    "P5. empty extraction does not become successful scope extraction");

  // P6: page numbers come only from the extractor
  const p6Buf = makePdf([["General conditions apply to all works."], ["Earthing - By Customer"]]);
  const p6 = runPdf(p6Buf, "TWO_PAGE_PDF");
  const p6Parsed = extractPdfText(p6Buf);
  assert(p6.r.scopeItems.length === 1 && p6.r.scopeItems[0].source_page_number === 2 && p6Parsed.pages[1].pageNumber === 2 &&
    p6.r.scopeItems[0].source_location === "Page 2:ExtractedLine 1" &&
    [...p1b.r.scopeItems, ...p6.r.scopeItems, ...p4mixed.r.scopeItems].every(s => p1Parsed.pages.concat(p6Parsed.pages).some(pg => pg.pageNumber === s.source_page_number && pg.status === "EXTRACTED")) &&
    p1a.r.pdf?.pages.length === 0 && p1a.r.scopeItems.every(s => s.source_page_number === undefined),
    "P6. PDF page number is never fabricated (extractor page only; none when unreadable)");

  // P7: document / revision / SHA provenance
  assert(p1b.r.scopeItems.every(s => s.source_document_id === p1b.d.documentId && s.source_revision === p1b.d.revision &&
    s.source_sha256 === p1b.d.sha256 && s.source_sha256 === sha256(p1Buf)),
    "P7. document/revision/SHA provenance preserved");

  // P8–P11: nothing invented from PDF text
  const p8Lines = ["Cable 4C x 300 sqmm 250 Rmt - Scope: Included", "Panel PCC-1 make ABB 2 Nos - Scope: Excluded"];
  const p8 = runPdf(makePdf([p8Lines]), "NUMERIC_PDF");
  const p8Keys = keysOf(p8.r.scopeItems);
  assert(p8.r.scopeItems.length === 2 && p8.r.boqLines.length === 0 && !p8Keys.some(k => /qty|quantity/.test(k)),
    "P8. no quantity invented from PDF");
  assert(!p8Keys.some(k => /uom|unit/.test(k)) && p8.r.boqLines.length === 0, "P9. no UOM invented from PDF");
  assert([p1b, p4, p4mixed, p5, p6, p8].every(x => x.r.bomHeaders.length === 0 && x.r.bomComponents.length === 0),
    "P10. no BOM invented from PDF");
  assert(p8.r.scopeItems.every(s => s.responsibility === null) && p1b.r.scopeItems.every(s => s.responsibility === null) &&
    p6.r.scopeItems[0].responsibility === "CUSTOMER" && p6.r.scopeItems[0].evidence_text === "Earthing - By Customer" &&
    !p8Keys.some(k => /make|brand|item_code/.test(k)),
    "P11. no responsibility (or make / item code) invented — only explicit wording");

  // P12: deterministic PDF path, zero model calls
  assert([p1a, p1b, p4, p4mixed, p5, p6, p8].every(x => x.runRow.method === "DETERMINISTIC_FIRST") && aiImports.length === 0 &&
    !/\bfetch\(|anthropic|openai|gemini|model-router|agent-router/i.test(EXTRACTION_CODE),
    "P12. deterministic PDF path uses 0 model calls");

  closeEstimationDatabase();
  const changed = diffHashes(operationalBefore, snapshotOperationalHashes());
  assert(!changed.some(f => f.startsWith("data/bansil_books")), "57. business DB unchanged");
  assert(!changed.some(f => f.startsWith("data/audit_workspace")), "58. audit DB unchanged");
  assert(!changed.some(f => f.startsWith("data/ai_workspace")), "59. ai_workspace DB unchanged unless explicit governance audit");
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\nTEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);

  if (failCount > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
