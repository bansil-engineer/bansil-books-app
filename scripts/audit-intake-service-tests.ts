// ============================================================
// Bansil Books Analytics — Milestone B Intake Service Tests
// ISOLATED TEMP SQLITE + TEMP FILE STORAGE ONLY. No production data,
// no network calls (Zoho acquisition DB-side logic is tested with a
// synthetic ZohoAcquisitionResult, never a live call).
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import { createWorkspace, addWorkspaceSource, getWorkspaceSources } from "../app/lib/audit/audit-service.ts";
import {
  addWorkspaceSourceFile,
  getMappingPreview,
  getRawRowsPreview,
  approveSourceMapping,
  computeCompleteness,
  freezeSourceVersion,
  listSourceVersions,
  getNormalizedRows,
  IntakeError,
  HeaderAmbiguousError,
} from "../app/lib/audit/intake-service.ts";
import { createZohoSourceVersion, DEFAULT_ZOHO_FIELD_MAPS, type ZohoAcquisitionResult } from "../app/lib/audit/zoho-audit-adapter.ts";

let passedCount = 0;
let failedCount = 0;
function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
  passedCount++;
}
function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}
function test(name: string, fn: () => void) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

function tmpDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bansil-intake-test-${label}-`));
  return path.join(dir, "audit_workspace.db");
}

// Redirect immutable file storage to an isolated temp dir for the whole
// suite (never data/audit_uploads/ in the real project).
const TEMP_UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-intake-uploads-"));
process.chdir(TEMP_UPLOAD_ROOT); // file-storage.ts resolves paths from process.cwd()

function makeSourceInWorkspace(conn: DatabaseSync): string {
  const ws = createWorkspace({ name: "Intake test workspace", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);
  const source = addWorkspaceSource(ws.workspace_id, { roleLabel: "SOURCE_A", sourceOrigin: "EXTERNAL" }, "OWNER", conn);
  return source.source_id;
}

console.log("\n==================================================");
console.log("MILESTONE B INTAKE SERVICE TEST SUITE (isolated)");
console.log("==================================================");

// ---------------- CSV end-to-end ----------------
console.log("\n--- CSV intake end-to-end ---");

test("CSV upload creates a source version with correct extraction counts", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-1"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Debit,Credit\n2026-01-01,Vendor A,1000,\n2026-01-02,Vendor B,,500\n";
  const { versionId, extraction } = addWorkspaceSourceFile(sourceId, "statement.csv", Buffer.from(csv), "OWNER", conn);

  assert.strictEqual(extraction.status, "EXTRACTED");
  assert.strictEqual(extraction.parsedRowCount, 2);

  const versions = listSourceVersions(sourceId, conn);
  assert.strictEqual(versions.length, 1);
  assert.strictEqual((versions[0] as any).version_number, 1);
  assert.strictEqual((versions[0] as any).mapping_status, "UNMAPPED");
  assert.ok(versionId);
  conn.close();
});

test("mapping preview shows raw headers and sample rows without requiring approval first", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-2"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Amount\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);

  const preview = getMappingPreview(versionId, conn);
  assert.deepStrictEqual(preview.table?.headers, ["Date", "Party", "Amount"]);
  assert.strictEqual(preview.table?.sampleRows.length, 1);
  conn.close();
});

test("approved mapping produces normalized rows; unmapped fields stay missing, never defaulted", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-3"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Amount\n2026-01-01,Vendor A,1000\n2026-01-02,,2000\n"; // second row has no party
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);

  approveSourceMapping(versionId, { fieldMap: { transaction_date: "Date", party_name_raw: "Party", debit_raw: "Amount" } }, "OWNER", conn);

  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 2);
  const normalized0 = JSON.parse((rows[0] as any).normalized_json);
  assert.strictEqual(normalized0.party_name_raw, "Vendor A");
  assert.strictEqual(normalized0.debit_raw, "1000");

  const normalized1 = JSON.parse((rows[1] as any).normalized_json);
  assert.strictEqual("party_name_raw" in normalized1, false, "a blank source cell must leave the normalized key absent, not empty-string or null");
  conn.close();
});

test("re-approving a mapping before freeze creates a new mapping_version and regenerates rows", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-4"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Amount\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);

  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" } }, "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party", debit_raw: "Amount" } }, "OWNER", conn);

  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 1, "re-mapping must not duplicate rows");
  const normalized = JSON.parse((rows[0] as any).normalized_json);
  assert.strictEqual(normalized.mapping_version, 2);
  assert.strictEqual(normalized.debit_raw, "1000");
  conn.close();
});

test("completeness check: balanced control totals report COMPLETE, never forced", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-5"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Amount,Type\n2026-01-01,1000,debit\n2026-01-02,400,credit\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { debit_raw: "Amount" } }, "OWNER", conn); // both rows mapped as debit for this synthetic test

  const check = computeCompleteness(versionId, { openingBalance: 0, closingBalance: 1400 }, "OWNER", conn);
  assert.strictEqual((check as any).status, "COMPLETE");
  assert.strictEqual((check as any).discrepancy, 0);
  conn.close();
});

test("completeness check: a real mismatch reports INCOMPLETE with the discrepancy shown, not zeroed", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-6"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Amount\n2026-01-01,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { debit_raw: "Amount" } }, "OWNER", conn);

  const check = computeCompleteness(versionId, { openingBalance: 0, closingBalance: 5000 }, "OWNER", conn);
  assert.strictEqual((check as any).status, "INCOMPLETE");
  assert.strictEqual((check as any).discrepancy, 4000);
  conn.close();
});

test("completeness check without opening/closing supplied reports NOT_AVAILABLE, never a guessed status", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-7"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Amount\n2026-01-01,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { debit_raw: "Amount" } }, "OWNER", conn);

  const check = computeCompleteness(versionId, {}, "OWNER", conn);
  assert.strictEqual((check as any).status, "NOT_AVAILABLE");
  conn.close();
});

test("freezing requires an approved mapping first", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-8"));
  const sourceId = makeSourceInWorkspace(conn);
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from("A,B\n1,2\n"), "OWNER", conn);
  assert.throws(() => freezeSourceVersion(versionId, "OWNER", conn), IntakeError);
  conn.close();
});

test("a frozen source version can never be re-mapped again", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-9"));
  const sourceId = makeSourceInWorkspace(conn);
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from("A,B\n1,2\n"), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "A" } }, "OWNER", conn);
  freezeSourceVersion(versionId, "OWNER", conn);

  assert.throws(
    () => approveSourceMapping(versionId, { fieldMap: { party_name_raw: "B" } }, "OWNER", conn),
    IntakeError,
    "a frozen snapshot must be immutable — a new version is required for further change"
  );
  conn.close();
});

test("identical re-uploaded file is deduplicated to the same file_id, but still creates a new version", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-10"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = Buffer.from("A,B\n1,2\n");
  const first = addWorkspaceSourceFile(sourceId, "s.csv", csv, "OWNER", conn);
  const second = addWorkspaceSourceFile(sourceId, "s.csv", csv, "OWNER", conn);
  assert.strictEqual(first.fileId, second.fileId, "identical bytes must dedupe to the same immutable file");
  assert.notStrictEqual(first.versionId, second.versionId, "each acquisition is still its own version");
  conn.close();
});

test("a malformed CSV row is reported as a parse exception, never silently repaired", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("csv-11"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "A,B,C\n1,2,3\n1,2\n"; // second row missing a column
  const { extraction } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  assert.strictEqual(extraction.parsedRowCount, 1);
  assert.strictEqual(extraction.exceptionCount, 1);
  conn.close();
});

// ---------------- Source origin metadata ----------------
console.log("\n--- Source Origin / Provenance ---");

test("EXTERNAL source stays EXTERNAL regardless of file type uploaded to it", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("origin-1"));
  const ws = createWorkspace({ name: "Origin test", comparisonMode: "EXTERNAL_EXTERNAL", sources: [] }, conn);
  const source = addWorkspaceSource(ws.workspace_id, { roleLabel: "SOURCE_A", sourceOrigin: "EXTERNAL", provenance: "Vendor emailed PDF statement" }, "OWNER", conn);
  const sources = getWorkspaceSources(ws.workspace_id, conn);
  assert.strictEqual(sources[0].source_origin, "EXTERNAL");
  assert.strictEqual(source.source_origin, "EXTERNAL");
  conn.close();
});

// ---------------- Zoho acquisition (DB-side only — no live call) ----------------
console.log("\n--- Zoho Source Version (synthetic acquisition result, no live call) ---");

test("createZohoSourceVersion persists one normalized-row placeholder per fetched record", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("zoho-1"));
  const sourceId = makeSourceInWorkspace(conn);

  const fakeAcquisition: ZohoAcquisitionResult = {
    acquisitionId: "fake-acq-1",
    status: "SUCCESS",
    coverageStatus: "COMPLETE",
    recordCount: 2,
    pageCount: 1,
    apiCallCount: 1,
    firstRecordDate: "2026-01-01",
    lastRecordDate: "2026-01-05",
    records: [
      { invoice_id: "inv-1", invoice_number: "INV-001", customer_name: "Synthetic Test Customer Co", date: "2026-01-01", total: 1000, balance: 0, currency_code: "INR" },
      { invoice_id: "inv-2", invoice_number: "INV-002", customer_name: "Synthetic Test Customer Co", date: "2026-01-05", total: 2000, balance: 500, currency_code: "INR" },
    ],
  };

  const versionId = createZohoSourceVersion(sourceId, fakeAcquisition, "sales_invoices", "OWNER", conn);
  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 2);
  assert.ok((rows[0] as any).evidence_locator.startsWith("zoho:sales_invoices:"));

  const preview = getMappingPreview(versionId, conn);
  assert.ok(preview.table, "a ZOHO-origin version must also expose a mapping-preview table (regression: this was missing until caught in live browser testing)");
  assert.ok(preview.table!.headers.includes("invoice_number"));
  assert.strictEqual(preview.table!.totalRows, 2);

  approveSourceMapping(versionId, { fieldMap: DEFAULT_ZOHO_FIELD_MAPS.sales_invoices }, "OWNER", conn);
  const mapped = getNormalizedRows(versionId, 10, conn);
  const normalized = JSON.parse((mapped[0] as any).normalized_json);
  assert.strictEqual(normalized.document_number_raw, "INV-001");
  assert.strictEqual(normalized.party_name_raw, "Synthetic Test Customer Co");

  conn.close();
});

// ---------------- PDF orchestration safety (owner verification pass) ----------------
console.log("\n--- PDF Intake Orchestration Safety ---");

function buildTestPdfPages(pages: Array<{ hasText: boolean; hasImageXObject: boolean }>): Buffer {
  const pageObjNums = pages.map((_, i) => 3 + i * 2);
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  const objects = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`;
  let nextFreeObj = 3 + pages.length * 2;

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n" + objects, "latin1")];

  pages.forEach((p, i) => {
    const pageObjNum = pageObjNums[i];
    const contentObjNum = pageObjNum + 1;
    const content = p.hasText ? `BT /F1 12 Tf 72 700 Td (Page ${i + 1} text) Tj ET` : "";
    const compressed = zlib.deflateSync(Buffer.from(content, "latin1"));
    const resourcesDict = p.hasImageXObject ? `<< /XObject << /Im0 ${nextFreeObj} 0 R >> >>` : "<< >>";
    const pageObj = `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentObjNum} 0 R /Resources ${resourcesDict} >>\nendobj\n`;
    const streamHeader = `${contentObjNum} 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`;
    const streamFooter = `\nendstream\nendobj\n`;
    chunks.push(Buffer.from(pageObj + streamHeader, "latin1"), compressed, Buffer.from(streamFooter, "latin1"));
    if (p.hasImageXObject) {
      chunks.push(Buffer.from(`${nextFreeObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 0 >>\nstream\n\nendstream\nendobj\n`, "latin1"));
      nextFreeObj++;
    }
  });

  chunks.push(Buffer.from(`\ntrailer\n<< /Size ${nextFreeObj} /Root 1 0 R >>\nstartxref\n0\n%%EOF`, "latin1"));
  return Buffer.concat(chunks);
}

test("all-scanned PDF (every page is image-only) reports OCR_NOT_AVAILABLE — never fabricated text, never silently EXTRACTED", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("pdf-1"));
  const sourceId = makeSourceInWorkspace(conn);
  const buf = buildTestPdfPages([{ hasText: false, hasImageXObject: true }, { hasText: false, hasImageXObject: true }]);
  const { extraction } = addWorkspaceSourceFile(sourceId, "scanned.pdf", buf, "OWNER", conn);
  assert.strictEqual(extraction.status, "OCR_NOT_AVAILABLE");
  assert.strictEqual(extraction.parsedRowCount, 0, "zero pages may be claimed as successfully parsed when none had real text");
  conn.close();
});

test("mixed PDF (one digital page + one scanned page) reports OCR_REQUIRED with the exact split counted, not averaged away", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("pdf-2"));
  const sourceId = makeSourceInWorkspace(conn);
  const buf = buildTestPdfPages([{ hasText: true, hasImageXObject: false }, { hasText: false, hasImageXObject: true }]);
  const { extraction } = addWorkspaceSourceFile(sourceId, "mixed.pdf", buf, "OWNER", conn);
  assert.strictEqual(extraction.status, "OCR_REQUIRED");
  assert.strictEqual(extraction.rawRowCount, 2, "total page count");
  assert.strictEqual(extraction.parsedRowCount, 1, "only the genuinely digital page counts as parsed");
  assert.strictEqual(extraction.exceptionCount, 1, "the scanned page is counted as an exception, not silently dropped");
  conn.close();
});

test("a fully digital multi-page PDF maps one normalized row per page — a page total is never merged into an adjacent transaction row", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("pdf-3"));
  const sourceId = makeSourceInWorkspace(conn);
  const buf = buildTestPdfPages([{ hasText: true, hasImageXObject: false }, { hasText: true, hasImageXObject: false }]);
  const { versionId, extraction } = addWorkspaceSourceFile(sourceId, "statement.pdf", buf, "OWNER", conn);
  assert.strictEqual(extraction.status, "EXTRACTED");

  // PDF pages are exposed as one page_text pseudo-row each (never auto-split
  // into "transaction" rows) — the human maps description_raw to page_text
  // explicitly; nothing here guesses which lines are totals vs transactions.
  approveSourceMapping(versionId, { fieldMap: { description_raw: "page_text" } }, "OWNER", conn);
  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 2, "one row per page — no line-item splitting invented by this parser");
  assert.ok((rows[0] as any).evidence_locator.startsWith("page:"));
  conn.close();
});

test("a structurally malformed PDF upload fails extraction cleanly (FAILED), never crashes and never claims EXTRACTED", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("pdf-4"));
  const sourceId = makeSourceInWorkspace(conn);
  const buf = Buffer.from("%PDF-1.4\nnot a real pdf body at all\n%%EOF", "latin1");
  const { extraction } = addWorkspaceSourceFile(sourceId, "broken.pdf", buf, "OWNER", conn);
  assert.strictEqual(extraction.status, "FAILED");
  assert.ok(extraction.note, "a FAILED extraction must explain why, not fail silently");
  conn.close();
});

// ---------------- Header / data-start row selection (owner verification pass) ----------------
console.log("\n--- Header / Data-Start Row Selection ---");

test("header on row 1 (default) works exactly as before — no regression", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-1"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Amount\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" } }, "OWNER", conn);
  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual((rows[0] as any).evidence_locator, "row:2");
  conn.close();
});

test("a report with title rows above the real header: owner picks header row 3, data starts row 4", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-2"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Bansil Engineers - Vendor Statement\nGenerated 2026-09-14\nDate,Party,Amount\n2026-01-01,Vendor A,1000\n2026-01-02,Vendor B,2000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "report.csv", Buffer.from(csv), "OWNER", conn);

  const preview = getRawRowsPreview(versionId, 30, conn);
  assert.strictEqual(preview.supported, true);
  assert.strictEqual(preview.rows?.[0].values[0], "Bansil Engineers - Vendor Statement", "raw preview must show title rows too — nothing pre-filtered");

  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" }, headerRowNumber: 3, dataStartRowNumber: 4 }, "OWNER", conn);
  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 2, "only the 2 real data rows — title rows never became transactions");
  assert.strictEqual((rows[0] as any).evidence_locator, "row:4", "physical evidence row is the ORIGINAL file row number, not renumbered from the header offset");
  conn.close();
});

test("blank rows between the header and the real data are skipped, not treated as data", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-3"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Amount\n\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" }, headerRowNumber: 1, dataStartRowNumber: 3 }, "OWNER", conn);
  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual((rows[0] as any).evidence_locator, "row:3", "the skipped blank row (row 2) is excluded, not counted as a data row");
  conn.close();
});

test("duplicate header names are detected as ambiguous -> NEEDS_REVIEW, never silently picked", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-4"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Amount,Amount\n2026-01-01,1000,2000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);

  assert.throws(
    () => approveSourceMapping(versionId, { fieldMap: { debit_raw: "Amount" } }, "OWNER", conn),
    HeaderAmbiguousError,
    "duplicate header names must never be silently resolved to 'whichever column matched first'"
  );

  const version = listSourceVersions(sourceId, conn)[0] as any;
  assert.strictEqual(version.mapping_status, "NEEDS_REVIEW", "the version must visibly reflect the hold, not stay UNMAPPED as if nothing happened");
  conn.close();
});

test("an ambiguous header can be explicitly acknowledged and overridden by the owner", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-5"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Amount,Amount\n2026-01-01,1000,2000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);

  approveSourceMapping(versionId, { fieldMap: {}, acknowledgeAmbiguousHeader: true }, "OWNER", conn);
  const version = listSourceVersions(sourceId, conn)[0] as any;
  assert.strictEqual(version.mapping_status, "APPROVED");
  conn.close();
});

test("a genuinely blank picked header row is ambiguous -> NEEDS_REVIEW", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-6"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = ",,\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  assert.throws(() => approveSourceMapping(versionId, { fieldMap: {} }, "OWNER", conn), HeaderAmbiguousError);
  conn.close();
});

test("a header row with a partially blank cell (simulating a merged XLSX header) is flagged ambiguous", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-7"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,,Amount\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  try {
    approveSourceMapping(versionId, { fieldMap: {} }, "OWNER", conn);
    assert.fail("expected HeaderAmbiguousError for a partially blank header row");
  } catch (err) {
    assert.ok(err instanceof HeaderAmbiguousError);
    assert.ok(err.reasons.some((r) => r.includes("Blank header cell")));
  }
  conn.close();
});

test("a frozen source version rejects any header/data-start change — must create a new version instead", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-8"));
  const sourceId = makeSourceInWorkspace(conn);
  const csv = "Date,Party,Amount\n2026-01-01,Vendor A,1000\n";
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.csv", Buffer.from(csv), "OWNER", conn);
  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" }, headerRowNumber: 1 }, "OWNER", conn);
  freezeSourceVersion(versionId, "OWNER", conn);

  assert.throws(
    () => approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" }, headerRowNumber: 2 }, "OWNER", conn),
    IntakeError,
    "a frozen version can never be silently reinterpreted with a different header row"
  );
  conn.close();
});

function buildMinimalXlsxFile(sheetXml: string): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml,
  };
  const chunks: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(content, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([localHeader, nameBuf, dataBuf]);
    chunks.push(localRecord);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(Buffer.concat([central, nameBuf]));
    offset += localRecord.length;
  }
  const centralDir = Buffer.concat(centralEntries);
  const centralDirOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralDir, eocd]);
}

test("XLSX: header row 2 (row 1 is a report title) is honored, with correct physical evidence rows", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-xlsx-1"));
  const sourceId = makeSourceInWorkspace(conn);
  const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Vendor Statement Report</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Party</t></is></c><c r="B2" t="inlineStr"><is><t>Amount</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Vendor A</t></is></c><c r="B3"><v>1000</v></c></row>
  </sheetData></worksheet>`;
  const buf = buildMinimalXlsxFile(sheetXml);
  const { versionId } = addWorkspaceSourceFile(sourceId, "report.xlsx", buf, "OWNER", conn);

  approveSourceMapping(versionId, { fieldMap: { party_name_raw: "Party" }, headerRowNumber: 2, dataStartRowNumber: 3 }, "OWNER", conn);
  const rows = getNormalizedRows(versionId, 10, conn);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual((rows[0] as any).evidence_locator, "row:3", "XLSX physical row number is preserved exactly as in the file");
  const normalized = JSON.parse((rows[0] as any).normalized_json);
  assert.strictEqual(normalized.party_name_raw, "Vendor A");
  conn.close();
});

test("PDF sources never expose a header/data-start picker — no invented tabular header", () => {
  const conn = openAuditDatabaseAt(tmpDbPath("hdr-9"));
  const sourceId = makeSourceInWorkspace(conn);
  const buf = buildTestPdfPages([{ hasText: true, hasImageXObject: false }]);
  const { versionId } = addWorkspaceSourceFile(sourceId, "s.pdf", buf, "OWNER", conn);
  const preview = getRawRowsPreview(versionId, 30, conn);
  assert.strictEqual(preview.supported, false, "PDF has no header-row concept — must say so, not fabricate one");
  conn.close();
});

console.log("\n==================================================");
console.log(`RESULTS: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");
if (failedCount > 0) process.exit(1);
