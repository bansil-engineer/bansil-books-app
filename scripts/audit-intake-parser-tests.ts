// ============================================================
// Bansil Books Analytics — Milestone B Intake Parser Tests
// SYNTHETIC FIXTURES ONLY. No production files, no network calls.
// ============================================================

import assert from "node:assert";
import zlib from "node:zlib";
import { parseCsvBuffer } from "../app/lib/audit/intake/csv-parser.ts";
import { parseXlsxBuffer } from "../app/lib/audit/intake/xlsx-reader.ts";
import { extractPdfText } from "../app/lib/audit/intake/pdf-text-extractor.ts";

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

console.log("\n==================================================");
console.log("MILESTONE B INTAKE PARSER TEST SUITE (synthetic fixtures)");
console.log("==================================================");

// ---------------- CSV ----------------
console.log("\n--- CSV Parser ---");

test("parses a normal CSV with headers and preserves physical row numbers", () => {
  const csv = "Date,Party,Amount\n2026-01-01,Vendor A,1000\n2026-01-02,Vendor B,2000\n";
  const result = parseCsvBuffer(Buffer.from(csv, "utf8"));
  assert.deepStrictEqual(result.headers, ["Date", "Party", "Amount"]);
  assert.strictEqual(result.rows.length, 2);
  assert.strictEqual(result.rows[0].physicalRow, 2);
  assert.strictEqual(result.rows[1].physicalRow, 3);
  assert.strictEqual(result.exceptions.length, 0);
});

test("handles quoted fields containing the delimiter and escaped quotes", () => {
  const csv = 'Name,Note\n"Vendor, Inc.","He said ""hi"""\n';
  const result = parseCsvBuffer(Buffer.from(csv, "utf8"));
  assert.strictEqual(result.rows[0].values[0], "Vendor, Inc.");
  assert.strictEqual(result.rows[0].values[1], 'He said "hi"');
});

test("reports a malformed row (wrong column count) as an exception, never auto-repaired", () => {
  const csv = "A,B,C\n1,2,3\n1,2\n";
  const result = parseCsvBuffer(Buffer.from(csv, "utf8"));
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.exceptions.length, 1);
  assert.strictEqual(result.exceptions[0].physicalRow, 3);
});

test("detects semicolon delimiter", () => {
  const csv = "A;B;C\n1;2;3\n";
  const result = parseCsvBuffer(Buffer.from(csv, "utf8"));
  assert.strictEqual(result.delimiter, ";");
  assert.deepStrictEqual(result.headers, ["A", "B", "C"]);
});

// ---------------- XLSX ----------------
console.log("\n--- XLSX Reader ---");

function buildMinimalXlsx(sheetXml: string, sharedStringsXml: string | null): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${sharedStringsXml ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : ""}</Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml,
  };
  if (sharedStringsXml) files["xl/sharedStrings.xml"] = sharedStringsXml;

  // Reuse the same minimal store-method ZIP builder pattern as the Milestone A skill-guard tests.
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

test("reads a shared-string cell and a numeric cell from a synthetic XLSX", () => {
  const sharedStrings = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Vendor A</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1000</v></c></row></sheetData></worksheet>`;
  const buf = buildMinimalXlsx(sheet, sharedStrings);
  const result = parseXlsxBuffer(buf);
  assert.strictEqual(result.sheets.length, 1);
  assert.strictEqual(result.sheets[0].name, "Sheet1");
  const row = result.sheets[0].rows[0];
  assert.strictEqual(row.cells[0].rawValue, "Vendor A");
  assert.strictEqual(row.cells[1].rawValue, "1000");
});

test("preserves formula text without evaluating it, alongside the cached value", () => {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>SUM(B1:B2)</f><v>42</v></c></row></sheetData></worksheet>`;
  const buf = buildMinimalXlsx(sheet, null);
  const result = parseXlsxBuffer(buf);
  const cell = result.sheets[0].rows[0].cells[0];
  assert.strictEqual(cell.isFormula, true);
  assert.strictEqual(cell.formula, "SUM(B1:B2)");
  assert.strictEqual(cell.rawValue, "42", "the cached value XLSX stored, not a re-computation");
});

test("rejects a structurally invalid XLSX", () => {
  assert.throws(() => parseXlsxBuffer(Buffer.from("not a zip at all")));
});

// ---------------- PDF ----------------
console.log("\n--- PDF Text Extractor ---");

function buildMinimalDigitalPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const compressed = zlib.deflateSync(Buffer.from(content, "latin1"));

  const objects: string[] = [];
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  objects.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << >> >>\nendobj\n`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  const streamObjHeader = `4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`;
  const streamObjFooter = `\nendstream\nendobj\n`;

  const preStreamBuf = Buffer.from(pdf + streamObjHeader, "latin1");
  const postStreamBuf = Buffer.from(streamObjFooter, "latin1");
  const xrefOffset = preStreamBuf.length + compressed.length + postStreamBuf.length;

  const trailer = `\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.concat([preStreamBuf, compressed, postStreamBuf, Buffer.from(trailer, "latin1")]);
}

test("extracts text from a synthetic digital PDF (FlateDecode content stream)", () => {
  const buf = buildMinimalDigitalPdf("Invoice Total 1234.50");
  const result = extractPdfText(buf);
  assert.strictEqual(result.status, "EXTRACTED");
  assert.strictEqual(result.pages.length, 1);
  assert.strictEqual(result.pages[0].status, "EXTRACTED");
  assert.ok(result.pages[0].text.includes("Invoice Total 1234.50"));
});

test("rejects a non-PDF buffer with a clear status, not fabricated text", () => {
  const result = extractPdfText(Buffer.from("this is not a pdf"));
  assert.strictEqual(result.status, "UNSUPPORTED_STRUCTURE");
  assert.strictEqual(result.pages.length, 0);
});

test("detects an /Encrypt trailer and refuses rather than emitting garbage text", () => {
  const buf = Buffer.from("%PDF-1.4\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF", "latin1");
  const result = extractPdfText(buf);
  assert.strictEqual(result.status, "ENCRYPTED_NOT_SUPPORTED");
});

// --- PDF SAFETY PROOF (owner verification pass) ---
// Builds a page with an /XObject Image reference and NO text-showing
// operators (i.e. a scanned/image-only page), vs. a genuinely blank page
// with neither text nor an image XObject.
function buildPdfWithOnePage(opts: { hasText: boolean; hasImageXObject: boolean }): Buffer {
  const content = opts.hasText ? "BT /F1 12 Tf 72 700 Td (Some digital text) Tj ET" : "";
  const compressed = zlib.deflateSync(Buffer.from(content, "latin1"));

  const resourcesDict = opts.hasImageXObject ? "<< /XObject << /Im0 5 0 R >> >>" : "<< >>";
  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources ${resourcesDict} >>\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  for (const obj of objects) pdf += obj;
  const streamObjHeader = `4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`;
  const streamObjFooter = `\nendstream\nendobj\n`;
  const imageObj = opts.hasImageXObject ? `5 0 obj\n<< /Type /XObject /Subtype /Image /Width 10 /Height 10 /Filter /DCTDecode /Length 0 >>\nstream\n\nendstream\nendobj\n` : "";

  const preStreamBuf = Buffer.from(pdf + streamObjHeader, "latin1");
  const postStreamBuf = Buffer.from(streamObjFooter + imageObj, "latin1");
  const trailer = `\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  return Buffer.concat([preStreamBuf, compressed, postStreamBuf, Buffer.from(trailer, "latin1")]);
}

test("PDF SAFETY: a scanned/image-only page (no text operators, has an image XObject) is reported OCR_REQUIRED, never fabricated text", () => {
  const buf = buildPdfWithOnePage({ hasText: false, hasImageXObject: true });
  const result = extractPdfText(buf);
  assert.strictEqual(result.status, "OCR_REQUIRED");
  assert.strictEqual(result.pages[0].status, "OCR_REQUIRED");
  assert.strictEqual(result.pages[0].text, "", "an OCR_REQUIRED page must carry zero fabricated text");
});

test("PDF SAFETY: a genuinely blank page (no text, no image) is EMPTY, not misclassified as OCR_REQUIRED", () => {
  const buf = buildPdfWithOnePage({ hasText: false, hasImageXObject: false });
  const result = extractPdfText(buf);
  assert.strictEqual(result.pages[0].status, "EMPTY", "a blank page must not be over-claimed as needing OCR");
});

test("PDF SAFETY: a digital page with real text is never routed through OCR", () => {
  const buf = buildPdfWithOnePage({ hasText: true, hasImageXObject: false });
  const result = extractPdfText(buf);
  assert.strictEqual(result.pages[0].status, "EXTRACTED");
});

test("PDF SAFETY: a %PDF- file with a header but no resolvable object table is UNSUPPORTED_STRUCTURE, not guessed content", () => {
  const buf = Buffer.from("%PDF-1.4\nthis has a valid header but is otherwise garbage\n%%EOF", "latin1");
  const result = extractPdfText(buf);
  assert.strictEqual(result.status, "UNSUPPORTED_STRUCTURE");
  assert.strictEqual(result.pages.length, 0, "no page/row evidence may be invented when structure cannot be resolved");
});

test("PDF SAFETY: no bounding-box coordinates are ever reported (only page number + text)", () => {
  const buf = buildMinimalDigitalPdf("Some text");
  const result = extractPdfText(buf);
  const page = result.pages[0] as unknown as Record<string, unknown>;
  assert.ok(!("bbox" in page) && !("x" in page) && !("y" in page), "the extractor must never claim spatial coordinates it does not actually compute");
});

console.log("\n==================================================");
console.log(`RESULTS: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");
if (failedCount > 0) process.exit(1);
