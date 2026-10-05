// ============================================================
// Bansil Books Analytics — Hard PDF Layout & Encoding Tests
// Validates Section-based layout, customer grouping, max columns <= 12,
// zero mojibake, no raw ISO dates, and real FY2026-27 data inspection.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { generateMasterInventoryMismatchReport } from "../app/lib/inventory-mismatch-engine.ts";
import {
  buildMasterInventoryMismatchPdf,
  buildPdfDocument,
  PDF_SECTIONS,
  sanitizePdfText,
} from "../app/lib/export/pdf-builder.ts";
import {
  EXPORT_FIELD_DEFINITIONS,
  type ExportFieldKey,
} from "../app/types/reconciliation.ts";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ""}`);
    failedCount++;
  }
}

console.log("\n==================================================");
console.log("RUNNING HARD PDF SECTION & LAYOUT VERIFICATION");
console.log("==================================================\n");

// ----------------------------------------------------
// TEST 1: Section Specifications & Column Limits (MAX <= 12)
// ----------------------------------------------------
console.log("--- TEST GROUP 1: Section Specifications & Max Columns <= 12 ---");

assert(PDF_SECTIONS.length === 5, `Defined 5 distinct PDF sections (Got ${PDF_SECTIONS.length})`);

let maxColsInAnySection = 0;
for (const sec of PDF_SECTIONS) {
  const colCount = sec.columns.length;
  if (colCount > maxColsInAnySection) maxColsInAnySection = colCount;
  assert(
    colCount <= 12,
    `Section [${sec.id}] has ${colCount} columns (Limit <= 12)`
  );
}

assert(maxColsInAnySection <= 12, `MAX_COLUMNS_PER_PDF_TABLE <= 12 (Actual max: ${maxColsInAnySection})`);

// ----------------------------------------------------
// TEST 2: Real Data PDF Generation for FY 2026-27 (Select All)
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: Real Data PDF Generation for FY 2026-27 ---");

const report26 = generateMasterInventoryMismatchReport({
  financialYear: "2026-27",
});

assert(report26.items.length > 0, `Loaded real FY 2026-27 data with ${report26.items.length} items`);

// Select All Fields
const allFieldKeys = EXPORT_FIELD_DEFINITIONS.map((f) => f.key);
const pdfBuffer = buildMasterInventoryMismatchPdf(report26, {
  selectedFields: allFieldKeys,
  includeTotals: true,
  format: "pdf",
});

assert(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 1000, `Generated PDF buffer size: ${pdfBuffer.length} bytes`);

// Save test PDF to filesystem for physical verification
const testPdfPath = path.resolve(process.cwd(), "scratch_test_fy26_27.pdf");
fs.writeFileSync(testPdfPath, pdfBuffer);
assert(fs.existsSync(testPdfPath), `Saved real test PDF to ${testPdfPath}`);

// ----------------------------------------------------
// TEST 3: Text Extraction & Structural Invariants
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Extracted Text Invariants & Old Header Check ---");

const pdfString = pdfBuffer.toString("utf-8");

// Extract literal strings in Tj operators
const tjRegex = /\(([^)]*)\)\s*Tj/g;
const extractedStrings: string[] = [];
let match;
while ((match = tjRegex.exec(pdfString)) !== null) {
  extractedStrings.push(match[1]);
}
const fullExtractedText = extractedStrings.join(" ");

// Check Page Count
const pageCountMatch = pdfString.match(/\/Type\s*\/Page\b/g);
const realPageCount = pageCountMatch ? pageCountMatch.length : 0;
assert(realPageCount > 0, `Real Generated PDF Page Count: ${realPageCount}`);

// 1. Old giant header MUST NOT exist
const oldHeaderTerms = "Customer ID Item Name Item ID SKU / Code Status Bill No. Bill Date Vendor Purchase Qty Purchase Rate Vendor ID";
assert(!fullExtractedText.includes(oldHeaderTerms), "Old 30+ column combined header is DISABLED and NOT found");
assert(!fullExtractedText.includes("Customer ID Item Name Item ID"), "Old single-table concatenated header is NOT present");

// 2. All 5 Section titles exist
assert(fullExtractedText.includes("SECTION A: SUMMARY"), "Section A (Summary) present");
assert(fullExtractedText.includes("SECTION B: FINANCIAL"), "Section B (Financial) present");
assert(fullExtractedText.includes("SECTION C: PURCHASE REFERENCE"), "Section C (Purchase Reference) present");
assert(fullExtractedText.includes("SECTION D: SALES REFERENCE"), "Section D (Sales Reference) present");
assert(fullExtractedText.includes("SECTION E: APPROX RATE VALUATION BASIS"), "Section E (Audit & Valuation) present");

// 3. Customer Grouping present
assert(fullExtractedText.includes("CUSTOMER:"), "Customer grouping banners present in PDF");

// ----------------------------------------------------
// TEST 4: Real Customer & Item Inspection
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: Real Customer & Item Inspection ---");

// Check M D INDUSTRIES
const hasMD = fullExtractedText.includes("M D INDUSTRIES");
assert(hasMD, "M D INDUSTRIES present in generated PDF");

// Check TORRECID INDIA PVT LTD
const hasTorrecid = fullExtractedText.includes("TORRECID INDIA PVT LTD");
assert(hasTorrecid, "TORRECID INDIA PVT LTD present in generated PDF");

// Check Cable Gland
const hasCableGland = fullExtractedText.includes("Cable Gland");
assert(hasCableGland, "Cable Gland items present in generated PDF");

// ----------------------------------------------------
// TEST 5: Mojibake & Encoding Invariant
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Mojibake & Encoding Invariant ---");

// Check for broken UTF-8 encoding / mojibake characters
const mojibakePatterns = [/â€/, /Â·/, /â‚/, /Â/, /₹/, /—/, /–/];
let mojibakeCount = 0;
for (const pat of mojibakePatterns) {
  const matches = fullExtractedText.match(pat);
  if (matches) {
    mojibakeCount += matches.length;
    console.error(`  Found mojibake pattern ${pat}: ${matches.length} occurrences`);
  }
}

assert(mojibakeCount === 0, `Mojibake count is 0 (Found ${mojibakeCount})`);

// Test text sanitizer directly
const rawProblematic = "LANTEC — BBT Tap Off Box · ₹ 5,988.81 â€” Â· â‚¹";
const sanitized = sanitizePdfText(rawProblematic);
assert(!sanitized.includes("â€"), "Sanitizer eliminates â€");
assert(!sanitized.includes("Â·"), "Sanitizer eliminates Â·");
assert(!sanitized.includes("â‚¹"), "Sanitizer eliminates â‚¹");
assert(!sanitized.includes("₹"), "Sanitizer converts ₹ to Rs. / safe text");
assert(sanitized.includes("Rs. 5,988.81"), "Sanitizer preserves amount with Rs.");

// ----------------------------------------------------
// TEST 6: Date Format & No Raw ISO Timestamps
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: Date Format & No Raw ISO Timestamps ---");

// Assert zero raw ISO timestamps like 2026-09-11T...
const rawIsoRegex = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g;
const isoMatches = fullExtractedText.match(rawIsoRegex);
const rawIsoCount = isoMatches ? isoMatches.length : 0;
assert(rawIsoCount === 0, `Raw ISO timestamps in PDF text: ${rawIsoCount}`);

// Assert DD/MM/YYYY present
const ddMmYyyyRegex = /\b\d{2}\/\d{2}\/\d{4}\b/;
assert(ddMmYyyyRegex.test(fullExtractedText), "User-facing dates are in DD/MM/YYYY format");

// ----------------------------------------------------
// TEST 7: Title & Footer Metadata
// ----------------------------------------------------
console.log("\n--- TEST GROUP 7: Title & Footer Metadata ---");

assert(fullExtractedText.includes("BANSIL ENGINEERS"), "Header contains BANSIL ENGINEERS");
assert(fullExtractedText.includes("Master Inventory Mismatch"), "Header contains Master Inventory Mismatch");
assert(fullExtractedText.includes("Financial Year:"), "Header contains Financial Year");
assert(fullExtractedText.includes("Data Last Synced:"), "Header contains Data Last Synced");
assert(fullExtractedText.includes("Local SQLite Cache"), "Header/Footer specifies Local SQLite Cache");
assert(fullExtractedText.includes("Page 1 of"), "Footer specifies Page 1 of N");

// ----------------------------------------------------
// TEST 8: Screenshot Regression Test — Exact Selected Fields
// ----------------------------------------------------
console.log("\n--- TEST GROUP 8: Strict Field Selection & Unselected Elimination ---");

const selected12Keys: ExportFieldKey[] = [
  "sr",
  "customerName",
  "itemName",
  "sku",
  "status",
  "purchaseQty",
  "purchaseRate",
  "purchaseAmount",
  "salesQty",
  "salesRate",
  "salesAmount",
  "balanceQty",
];

const pdf12Buffer = buildMasterInventoryMismatchPdf(report26, {
  selectedFields: selected12Keys,
  includeTotals: true,
  format: "pdf",
});

const pdf12String = pdf12Buffer.toString("utf-8");
const tjRegex12 = /\(([^)]*)\)\s*Tj/g;
const extracted12: string[] = [];
let m12;
while ((m12 = tjRegex12.exec(pdf12String)) !== null) {
  extracted12.push(m12[1]);
}
const text12 = extracted12.join(" ");

// Count occurrences of unselected headers
const countOccurrences = (haystack: string, needle: string) => {
  const reg = new RegExp(`\\b${needle}\\b`, "gi");
  const matches = haystack.match(reg);
  return matches ? matches.length : 0;
};

// Assert Unselected Fields ARE ZERO
assert(countOccurrences(text12, "Bill No\\.") === 0, "Bill No. count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Bill Date") === 0, "Bill Date count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Vendor") === 0, "Vendor header count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Invoice No\\.") === 0, "Invoice No. count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Invoice Date") === 0, "Invoice Date count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Approx Shortage Value") === 0, "Approx Shortage Value count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Ref Purch Rate") === 0, "Ref Purch Rate count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Excluded") === 0, "Excluded header count = 0 (Unselected removed)");
assert(countOccurrences(text12, "Exclusion Reason") === 0, "Exclusion Reason count = 0 (Unselected removed)");

// Assert Selected Headers ARE PRESENT
assert(text12.includes("Customer Name"), "Selected 'Customer Name' is present");
assert(text12.includes("Item Name"), "Selected 'Item Name' is present");
assert(text12.includes("SKU / Code"), "Selected 'SKU / Code' is present");
assert(text12.includes("Purchase Qty"), "Selected 'Purchase Qty' is present");
assert(text12.includes("Purchase Rate"), "Selected 'Purchase Rate' is present");
assert(text12.includes("Purchase Amount"), "Selected 'Purchase Amount' is present");
assert(text12.includes("Sales Qty"), "Selected 'Sales Qty' is present");
assert(text12.includes("Sales Rate"), "Selected 'Sales Rate' is present");
assert(text12.includes("Sales Amount"), "Selected 'Sales Amount' is present");
assert(text12.includes("Balance Qty"), "Selected 'Balance Qty' is present");

// ----------------------------------------------------
// TEST 9: Empty & Minimal Custom Field Selection
// ----------------------------------------------------
console.log("\n--- TEST GROUP 9: Minimal & Single Section Selection ---");

const minimalKeys: ExportFieldKey[] = ["customerName", "itemName", "balanceQty", "status"];
const pdfMinBuffer = buildMasterInventoryMismatchPdf(report26, {
  selectedFields: minimalKeys,
  includeTotals: false,
  format: "pdf",
});

const pdfMinString = pdfMinBuffer.toString("utf-8");
const tjRegexMin = /\(([^)]*)\)\s*Tj/g;
const extractedMin: string[] = [];
let mMin;
while ((mMin = tjRegexMin.exec(pdfMinString)) !== null) {
  extractedMin.push(mMin[1]);
}
const textMin = extractedMin.join(" ");

assert(textMin.includes("SECTION A: SUMMARY"), "Minimal export includes Section A (Summary)");
assert(!textMin.includes("SECTION B: FINANCIAL"), "Section B omitted when no financial fields selected");
assert(!textMin.includes("SECTION C: PURCHASE"), "Section C omitted when no purchase fields selected");
assert(!textMin.includes("SECTION D: SALES"), "Section D omitted when no sales fields selected");
assert(!textMin.includes("SECTION E: APPROX"), "Section E omitted when no approx fields selected");

console.log("\n==================================================");
console.log(`PDF LAYOUT TESTS COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

// Clean up scratch test artifact
if (fs.existsSync(testPdfPath)) {
  try {
    fs.unlinkSync(testPdfPath);
  } catch {
    // Ignore error
  }
}

if (failedCount > 0) {
  process.exit(1);
}

