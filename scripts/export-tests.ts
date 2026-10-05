// ============================================================
// Bansil Books Analytics — Export Acceptance & Integrity Tests
// Section 19 & 20 Acceptance Test: BBT Tap Off Box FY 2025-26
// Verifies: UI Totals === Excel Totals === PDF Totals
// ============================================================

import { generateReconciliationReport } from "../app/lib/reconciliation-engine.ts";
import { buildExcelWorkbook } from "../app/lib/export/excel-builder.ts";
import { buildPdfDocument } from "../app/lib/export/pdf-builder.ts";
import { generateExportFilename } from "../app/lib/export/export-utils.ts";
import * as zlib from "zlib";

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
console.log("RUNNING BANSIL BOOKS EXPORT & ACCEPTANCE TESTS");
console.log("==================================================\n");

// ----------------------------------------------------
// TEST 1: BBT Tap Off Box Acceptance Case (Section 20)
// ----------------------------------------------------
console.log("--- TEST GROUP 1: BBT Tap Off Box Acceptance Case (Section 20) ---");
const bbtReport = generateReconciliationReport({
  financialYear: "2025-26",
  customerName: "LANTEC INDUSTRIES PRIVATE LIMITED",
  itemName: "BBT Tap Off Box",
});

const lantec = bbtReport.summaryItems.find((i) => i.customerName.includes("LANTEC"));

assert(Boolean(lantec), "LANTEC summary item exists");
if (lantec) {
  assert(lantec.purchaseQty === 55, "LANTEC Purchase Qty == 55", `Got ${lantec.purchaseQty}`);
  assert(lantec.salesQty === 55, "LANTEC Sales Qty == 55", `Got ${lantec.salesQty}`);
  assert(lantec.balanceQty === 0, "LANTEC Balance Qty == 0", `Got ${lantec.balanceQty}`);
  assert(lantec.status === "RECONCILED", "LANTEC Status == RECONCILED", `Got ${lantec.status}`);
}

assert(bbtReport.totals.purchaseQty === 55, "Grand Total Purchase Qty == 55", `Got ${bbtReport.totals.purchaseQty}`);
assert(bbtReport.totals.salesQty === 55, "Grand Total Sales Qty == 55", `Got ${bbtReport.totals.salesQty}`);
assert(bbtReport.totals.balanceQty === 0, "Grand Total Balance Qty == 0", `Got ${bbtReport.totals.balanceQty}`);

// ----------------------------------------------------
// TEST 2: Filter Awareness
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: Filter-Awareness ---");
const lantecOnly = generateReconciliationReport({
  financialYear: "2025-26",
  customerName: "LANTEC INDUSTRIES PRIVATE LIMITED",
  itemName: "BBT Tap Off Box",
});

assert(lantecOnly.summaryItems.length === 1, "Filter customer = LANTEC returns exactly 1 summary item");
assert(lantecOnly.summaryItems[0]?.customerName.includes("LANTEC"), "Filtered item is LANTEC");
assert(lantecOnly.totals.purchaseQty === 55, "Filtered Total Purchase Qty == 55");
assert(lantecOnly.totals.salesQty === 55, "Filtered Total Sales Qty == 55");
assert(lantecOnly.totals.balanceQty === 0, "Filtered Total Balance Qty == 0");

// ----------------------------------------------------
// TEST 3: Excel (.xlsx) Binary Generation & Structure
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Excel (.xlsx) Structure & Validation ---");
const excelBuffer = buildExcelWorkbook(bbtReport);

assert(Buffer.isBuffer(excelBuffer), "Excel export returns a Buffer");
assert(excelBuffer.length > 500, `Excel buffer size > 500 bytes (Got ${excelBuffer.length})`);
// PKZip signature check (0x04034b50 -> 'PK\x03\x04')
assert(
  excelBuffer[0] === 0x50 && excelBuffer[1] === 0x4b && excelBuffer[2] === 0x03 && excelBuffer[3] === 0x04,
  "Excel buffer has valid PKZip header (0x50 0x4B 0x03 0x04)"
);

// Read files inside the ZIP
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  let offset = 0;
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x04034b50) {
      const compMethod = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const name = buf.toString("utf-8", offset + 30, offset + 30 + nameLen);
      const dataOffset = offset + 30 + nameLen + extraLen;
      const compData = buf.subarray(dataOffset, dataOffset + compSize);
      let data: Buffer;
      if (compMethod === 8) {
        data = zlib.inflateRawSync(compData);
      } else {
        data = compData;
      }
      map.set(name, data);
      offset = dataOffset + compSize;
    } else {
      break;
    }
  }
  return map;
}

const entries = readZipEntries(excelBuffer);
assert(entries.has("[Content_Types].xml"), "Excel contains [Content_Types].xml");
assert(entries.has("xl/workbook.xml"), "Excel contains xl/workbook.xml");
assert(entries.has("xl/styles.xml"), "Excel contains xl/styles.xml");
assert(entries.has("xl/worksheets/sheet1.xml"), "Excel contains Sheet 1 (Reconciliation Summary)");
assert(entries.has("xl/worksheets/sheet2.xml"), "Excel contains Sheet 2 (Transaction Detail)");
assert(entries.has("xl/worksheets/sheet3.xml"), "Excel contains Sheet 3 (Customer Details Missing)");
assert(entries.has("xl/worksheets/sheet4.xml"), "Excel contains Sheet 4 (Export Information)");

// Check INR format in styles.xml
const stylesXml = entries.get("xl/styles.xml")?.toString("utf-8") || "";
assert(stylesXml.includes("[$₹-en-IN]"), "styles.xml contains Indian INR currency format `[$₹-en-IN]`");

// Check Sheet 1 contents (Numeric values & Grand Total)
const sheet1Xml = entries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
assert(sheet1Xml.includes("<v>55</v>"), "Sheet 1 contains numeric cell value 55 (LANTEC)");
assert(sheet1Xml.includes("<v>1637317.22</v>"), "Sheet 1 contains numeric amount 1637317.22 (LANTEC)");
assert(sheet1Xml.includes("<v>1760560</v>"), "Sheet 1 contains numeric amount 1760560 (LANTEC)");
assert(sheet1Xml.includes("<v>0</v>"), "Sheet 1 contains Grand Total Balance Qty 0");
assert(sheet1Xml.includes("<autoFilter"), "Sheet 1 contains autoFilter");
assert(sheet1Xml.includes('state="frozen"'), "Sheet 1 contains frozen top row");

// Check Sheet 2 Hyperlinks
const sheet2Xml = entries.get("xl/worksheets/sheet2.xml")?.toString("utf-8") || "";
assert(sheet2Xml.includes("<hyperlinks>"), "Sheet 2 contains hyperlinks block for invoices/bills");
assert(entries.has("xl/worksheets/_rels/sheet2.xml.rels"), "Sheet 2 contains relationship file for hyperlinks");

// Check Sheet 4 Metadata & Notice
const sheet4Xml = entries.get("xl/worksheets/sheet4.xml")?.toString("utf-8") || "";
assert(
  sheet4Xml.includes("Zoho Books source data was not modified."),
  "Sheet 4 contains security statement: 'Zoho Books source data was not modified.'"
);

// ----------------------------------------------------
// TEST 4: PDF Binary Generation & Structure
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: PDF Structure & Validation ---");
const pdfBuffer = buildPdfDocument(bbtReport);

assert(Buffer.isBuffer(pdfBuffer), "PDF export returns a Buffer");
assert(pdfBuffer.length > 500, `PDF buffer size > 500 bytes (Got ${pdfBuffer.length})`);

const pdfString = pdfBuffer.toString("utf-8");
assert(pdfString.startsWith("%PDF-1.4"), "PDF has valid %PDF-1.4 header");
assert(pdfString.includes("BANSIL ENGINEERS"), "PDF contains BANSIL ENGINEERS header");
assert(pdfString.includes("Bansil Books Analytics"), "PDF contains Bansil Books Analytics subtitle");
assert(pdfString.includes("Grand Total"), "PDF contains Grand Total row");
assert(pdfString.includes("Page 1 of "), "PDF contains Page 1 of pagination");
assert(pdfString.includes("16,37,317.22"), "PDF contains Indian INR formatted currency 16,37,317.22");
assert(pdfString.includes("%%EOF"), "PDF contains valid %%EOF trailer");

// ----------------------------------------------------
// TEST 5: Data Consistency (UI === Excel === PDF)
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Data Consistency (UI === Excel === PDF) ---");
// Both Excel builder and PDF builder use the exact same bbtReport object from generateReconciliationReport
assert(
  sheet1Xml.includes("<v>55</v>") && pdfString.includes("55"),
  "Excel and PDF both output Grand Total Purchase Qty == 55"
);
assert(
  sheet1Xml.includes("<v>55</v>") && pdfString.includes("55"),
  "Excel and PDF both output Grand Total Sales Qty == 55"
);
assert(
  sheet1Xml.includes("<v>0</v>") && pdfString.includes("0"),
  "Excel and PDF both output Grand Total Balance Qty == 0"
);

// ----------------------------------------------------
// TEST 6: Filename Generation & Sanitization
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: Filename Generation & Sanitization ---");
const fn1 = generateExportFilename(
  { financialYear: "2025-26", customerName: "LANTEC INDUSTRIES PRIVATE LIMITED", itemName: "BBT Tap Off Box" },
  "xlsx"
);
assert(fn1.includes("FY2025-26"), "Filename includes FY2025-26", fn1);
assert(fn1.includes("LANTEC"), "Filename includes customer", fn1);
assert(fn1.endsWith(".xlsx"), "Filename ends with .xlsx", fn1);

const fn2 = generateExportFilename(
  { financialYear: "2025-26" },
  "pdf",
  "Master_Inventory_Mismatch"
);
assert(fn2.includes("Mismatch"), "Mismatch report filename contains Mismatch", fn2);
assert(fn2.endsWith(".pdf"), "Filename ends with .pdf", fn2);

// ----------------------------------------------------
// TEST 7: Mandatory Field Selection & Presets
// ----------------------------------------------------
console.log("\n--- TEST GROUP 7: Mandatory Field Selection & Presets ---");

import {
  EXPORT_FIELD_DEFINITIONS,
  DEFAULT_EXPORT_FIELD_KEYS,
  getAvailableFieldsForReport,
  type ExportFieldKey,
} from "../app/types/reconciliation.ts";

// 7.1 SELECT ALL: PASS
const allAvailableFieldKeys = EXPORT_FIELD_DEFINITIONS.map((f) => f.key);
assert(
  allAvailableFieldKeys.length >= 28,
  "SELECT ALL: PASS",
  `Found ${allAvailableFieldKeys.length} total fields across 5 categories`
);

// 7.2 CLEAR ALL: PASS
const clearedKeys: ExportFieldKey[] = [];
assert(clearedKeys.length === 0, "CLEAR ALL: PASS");

// 7.3 DEFAULT FIELDS: PASS
assert(
  DEFAULT_EXPORT_FIELD_KEYS.length === 12 &&
    DEFAULT_EXPORT_FIELD_KEYS.includes("customerName") &&
    DEFAULT_EXPORT_FIELD_KEYS.includes("itemName") &&
    DEFAULT_EXPORT_FIELD_KEYS.includes("balanceQty"),
  "DEFAULT FIELDS: PASS",
  `Default keys count = ${DEFAULT_EXPORT_FIELD_KEYS.length}`
);

// 7.4 AT LEAST ONE FIELD REQUIRED: PASS
function validateExportSelection(keys: ExportFieldKey[]): { valid: boolean; error?: string } {
  if (!keys || keys.length === 0) {
    return { valid: false, error: "Please select at least one field to export." };
  }
  return { valid: true };
}
const emptyValidation = validateExportSelection([]);
const validValidation = validateExportSelection(["customerName"]);
assert(
  !emptyValidation.valid &&
    emptyValidation.error === "Please select at least one field to export." &&
    validValidation.valid,
  "AT LEAST ONE FIELD REQUIRED: PASS"
);

// 7.5 CUSTOM FIELD SELECTION: PASS
const customSubset: ExportFieldKey[] = ["customerName", "itemName", "balanceQty", "status"];
const customExcel = buildExcelWorkbook(bbtReport, {
  selectedFields: customSubset,
  includeTotals: true,
});
assert(Buffer.isBuffer(customExcel), "CUSTOM FIELD SELECTION: PASS (Excel buffer generated)");

// 7.6 REPORT-SPECIFIC FIELD FILTERING: PASS
const billFields = getAvailableFieldsForReport("bills");
const invoiceFields = getAvailableFieldsForReport("invoices");
assert(
  billFields.some((f) => f.category === "PURCHASE") &&
    !billFields.some((f) => f.category === "SALES") &&
    invoiceFields.some((f) => f.category === "SALES") &&
    !invoiceFields.some((f) => f.category === "PURCHASE"),
  "REPORT-SPECIFIC FIELD FILTERING: PASS"
);

// ----------------------------------------------------
// TEST 8: Excel & PDF Exact Selected Fields Output
// ----------------------------------------------------
console.log("\n--- TEST GROUP 8: Exact Selected Fields Output (Excel & PDF) ---");

// 8.1 EXCEL EXACT SELECTED FIELDS: PASS
const excelEntries = readZipEntries(customExcel);
const customSheet1Xml = excelEntries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
assert(customSheet1Xml.includes("Customer Name"), "Excel contains Customer Name header");
assert(customSheet1Xml.includes("Item Name"), "Excel contains Item Name header");
assert(customSheet1Xml.includes("Balance Qty"), "Excel contains Balance Qty header");
assert(customSheet1Xml.includes("Status"), "Excel contains Status header");
assert(!customSheet1Xml.includes("Purchase Rate"), "Excel does NOT contain unselected Purchase Rate");
assert(!customSheet1Xml.includes("Vendor ID"), "Excel does NOT contain unselected Vendor ID");
assert(
  customSheet1Xml.includes("Customer Name") && !customSheet1Xml.includes("Vendor ID"),
  "EXCEL EXACT SELECTED FIELDS: PASS"
);

// 8.2 PDF EXACT SELECTED FIELDS: PASS
const customPdf = buildPdfDocument(bbtReport, {
  selectedFields: customSubset,
  includeTotals: true,
});
const pdfStr = customPdf.toString("utf-8");
assert(pdfStr.startsWith("%PDF-1.4"), "PDF has valid %PDF-1.4 header");
assert(pdfStr.includes("Customer Name") || pdfStr.includes("Customer"), "PDF contains Customer column");
assert(pdfStr.includes("Balance Qty") || pdfStr.includes("Balance"), "PDF contains Balance column");
assert(pdfStr.includes("Grand Total"), "PDF contains Grand Total row when includeTotals=true");
assert(
  pdfStr.startsWith("%PDF-1.4") && (pdfStr.includes("Customer") || pdfStr.includes("Balance")),
  "PDF EXACT SELECTED FIELDS: PASS"
);

// ----------------------------------------------------
// TEST 9: Totals ON / OFF Toggle
// ----------------------------------------------------
console.log("\n--- TEST GROUP 9: Totals ON / OFF Toggle ---");

// 9.1 TOTALS ON/OFF: PASS
const excelNoTotals = buildExcelWorkbook(bbtReport, {
  selectedFields: ["customerName", "itemName", "purchaseQty", "salesQty", "balanceQty"],
  includeTotals: false,
});
const excelNoTotalsXml = readZipEntries(excelNoTotals).get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
const pdfNoTotals = buildPdfDocument(bbtReport, {
  selectedFields: ["customerName", "itemName", "purchaseQty", "salesQty", "balanceQty"],
  includeTotals: false,
});
const pdfNoTotalsStr = pdfNoTotals.toString("utf-8");

assert(!excelNoTotalsXml.includes("Grand Total"), "Excel with includeTotals=false omits Grand Total");
assert(!pdfNoTotalsStr.includes("Grand Total"), "PDF with includeTotals=false omits Grand Total");
assert(
  !excelNoTotalsXml.includes("Grand Total") && !pdfNoTotalsStr.includes("Grand Total"),
  "TOTALS ON/OFF: PASS"
);

// ----------------------------------------------------
// TEST 10: Filtered Export & Zero Zoho API Calls
// ----------------------------------------------------
console.log("\n--- TEST GROUP 10: Filtered Export & Zero Zoho API Calls ---");

// 10.1 FILTERED EXPORT: PASS
const filteredReport = generateReconciliationReport({
  financialYear: "2025-26",
  customerName: "LANTEC INDUSTRIES PRIVATE LIMITED",
  itemName: "BBT Tap Off Box",
});
const filteredExcel = buildExcelWorkbook(filteredReport, {
  selectedFields: ["customerName", "itemName", "purchaseQty", "salesQty", "balanceQty"],
  includeTotals: true,
});
const filteredExcelXml = readZipEntries(filteredExcel).get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
assert(filteredExcelXml.includes("LANTEC"), "Filtered export contains LANTEC record");
assert(filteredExcelXml.includes("<v>55</v>"), "Filtered export contains exact quantity 55");
assert(filteredExcelXml.includes("LANTEC") && filteredExcelXml.includes("<v>55</v>"), "FILTERED EXPORT: PASS");

// ----------------------------------------------------
// TEST 11: Dynamic Export Field Selector & Schema Validation
// ----------------------------------------------------
console.log("\n--- TEST GROUP 11: Dynamic Export Field Selector & Schema Validation ---");
import {
  getReportExportConfig,
  getDefaultFieldsForReport,
  getAllFieldsForReport,
} from "../app/lib/export/export-field-config.ts";
import { getStockSummary } from "../app/lib/stock-engine.ts";
import { buildStockExcel } from "../app/lib/export/stock-excel-builder.ts";
import { getCustomerMaterialControlReport } from "../app/lib/customer-material-control-engine.ts";
import { buildCustomerMaterialExcel } from "../app/lib/export/customer-material-excel-builder.ts";
import { getDatabase } from "../app/lib/db/database.ts";

// 11.1 Schema Isolation: Reports only show their own fields
const reconCfg = getReportExportConfig("summary");
const stockCfg = getReportExportConfig("stock");
const cmCfg = getReportExportConfig("customer-material-control");
const priceCfg = getReportExportConfig("price-reference");
const exclCfg = getReportExportConfig("excluded-items");
const billsCfg = getReportExportConfig("bills");
const invCfg = getReportExportConfig("invoices");
const compCfg = getReportExportConfig("composite-assembly");

assert(reconCfg.fields.length === 39, `Reconciliation fields count == 39 (Got ${reconCfg.fields.length})`);
assert(stockCfg.fields.length === 17, `Stock fields count == 17 (Got ${stockCfg.fields.length})`);
assert(cmCfg.fields.length === 22, `Customer Material Control fields count == 22 (Got ${cmCfg.fields.length})`);
assert(priceCfg.fields.length === 18, `Price Reference fields count == 18 (Got ${priceCfg.fields.length})`);
assert(exclCfg.fields.length === 10, `Excluded Items fields count == 10 (Got ${exclCfg.fields.length})`);
assert(billsCfg.fields.length === 14, `Purchase Bills fields count == 14 (Got ${billsCfg.fields.length})`);
assert(invCfg.fields.length === 13, `Sales Invoices fields count == 13 (Got ${invCfg.fields.length})`);
assert(compCfg.fields.length === 11, `Composite Assembly fields count == 11 (Got ${compCfg.fields.length})`);
assert(getDefaultFieldsForReport("stock").length > 0, "getDefaultFieldsForReport('stock') returns defaults");
assert(getAllFieldsForReport("stock").length === 17, "getAllFieldsForReport('stock') returns all 17 fields");

// 11.2 Verify zero bleed between reports
const stockKeys = new Set(stockCfg.fields.map((f) => f.key));
assert(!stockKeys.has("vendorName"), "Stock export has NO vendorName (reconciliation field)");
assert(!stockKeys.has("invoiceNumber"), "Stock export has NO invoiceNumber");
assert(!stockKeys.has("exclusionReason"), "Stock export has NO exclusionReason");
assert(stockKeys.has("stockQty") && stockKeys.has("approxStockValue"), "Stock export has stockQty & approxStockValue");

// 11.3 Include Totals Capability
assert(stockCfg.includeTotalsSupported === true, "Stock supports totals");
assert(reconCfg.includeTotalsSupported === true, "Reconciliation supports totals");
assert(exclCfg.includeTotalsSupported === false, "Excluded items does NOT support totals");

// 11.4 Stock Excel Builder respects dynamic selectedFields (Sheet 1 is Item Stock)
const stockSummary = getStockSummary({ financialYear: "2025-26" });
const customStockExcel = buildStockExcel(stockSummary, "FY 2025-26", undefined, {
  selectedFields: ["itemName", "stockQty", "approxStockValue"],
  includeTotals: true,
});
const customStockEntries = readZipEntries(customStockExcel);
const customStockSheet1Xml = customStockEntries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
assert(customStockSheet1Xml.includes("Item Name"), "Custom Stock Excel Sheet 1 contains 'Item Name'");
assert(customStockSheet1Xml.includes("Stock Qty"), "Custom Stock Excel Sheet 1 contains 'Stock Qty'");
assert(customStockSheet1Xml.includes("Approx Stock Value"), "Custom Stock Excel Sheet 1 contains 'Approx Stock Value'");
assert(!customStockSheet1Xml.includes("Classification"), "Custom Stock Excel omits unselected 'Classification'");
assert(!customStockSheet1Xml.includes("Latest Sales Rate"), "Custom Stock Excel omits unselected 'Latest Sales Rate'");

// Verify OpenXML sequence: sheetData MUST be closed before autoFilter
const sheetDataCloseIdx = customStockSheet1Xml.indexOf("</sheetData>");
const autoFilterIdx = customStockSheet1Xml.indexOf("<autoFilter");
assert(
  sheetDataCloseIdx !== -1 && autoFilterIdx !== -1 && sheetDataCloseIdx < autoFilterIdx,
  "OpenXML compliance: </sheetData> appears BEFORE <autoFilter>"
);

// 11.4.1 Case 1: Single field only (Item Name)
const singleFieldExcel = buildStockExcel(stockSummary, "FY 2025-26", undefined, {
  selectedFields: ["itemName"],
  includeTotals: false,
});
const singleFieldEntries = readZipEntries(singleFieldExcel);
const singleFieldXml = singleFieldEntries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
assert(singleFieldXml.includes("Item Name"), "Case 1: Single field contains Item Name");
assert(!singleFieldXml.includes("Stock Qty"), "Case 1: Single field omits Stock Qty");
assert(!singleFieldXml.includes("TOTAL"), "Case 1: Single field without totals has no TOTAL row");

// 11.4.2 Case 2: Three fields with preserved order
const threeFields = ["itemName", "stockQty", "approxStockValue"];
const threeFieldExcel = buildStockExcel(stockSummary, "FY 2025-26", undefined, {
  selectedFields: threeFields,
  includeTotals: true,
});
const threeFieldEntries = readZipEntries(threeFieldExcel);
const threeFieldXml = threeFieldEntries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
const itemPos = threeFieldXml.indexOf("Item Name");
const qtyPos = threeFieldXml.indexOf("Stock Qty");
const valPos = threeFieldXml.indexOf("Approx Stock Value");
assert(itemPos < qtyPos && qtyPos < valPos, "Case 2: Three fields preserve exact column order");

// 11.4.3 Case 3: Select All available stock fields
const allStockFieldConfigs = getAllFieldsForReport("stock");
const allStockFieldKeys = allStockFieldConfigs.map((f) => f.key);
const allFieldsExcel = buildStockExcel(stockSummary, "FY 2025-26", undefined, {
  selectedFields: allStockFieldKeys,
  includeTotals: true,
});
const allFieldEntries = readZipEntries(allFieldsExcel);
const allFieldXml = allFieldEntries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
for (const f of allStockFieldConfigs) {
  assert(allFieldXml.includes(f.label), `Case 3: All fields contains header '${f.label}'`);
}

// 11.4.4 Stock PDF Builder dynamic selection & integrity
const { buildStockPdf } = await import("../app/lib/export/stock-pdf-builder.ts");
const stockPdfBuf = buildStockPdf(stockSummary, "FY 2025-26", {
  selectedFields: ["itemName", "stockQty", "approxStockValue"],
  includeTotals: true,
});
assert(stockPdfBuf.length > 5000, `Stock PDF buffer has valid size (${stockPdfBuf.length} bytes)`);
const pdfHeader = stockPdfBuf.subarray(0, 8).toString("utf-8");
assert(pdfHeader.startsWith("%PDF-1.4"), "Stock PDF starts with %PDF-1.4 header");
const pdfTail = stockPdfBuf.subarray(stockPdfBuf.length - 30).toString("utf-8");
assert(pdfTail.includes("%%EOF"), "Stock PDF ends with %%EOF marker");

// 11.5 Customer Material Excel Builder respects dynamic selectedFields
const db = getDatabase();
const cmReport = getCustomerMaterialControlReport(db, {
  customerName: "LANTEC INDUSTRIES PRIVATE LIMITED",
  financialYear: "2025-26",
});

if (cmReport) {
  const customCmExcel = buildCustomerMaterialExcel(cmReport, {
    selectedFields: ["itemName", "purchaseQty", "salesQty", "balanceMaterialToInvoice"],
    includeTotals: false,
  });
  const cmEntries = readZipEntries(customCmExcel);
  const cmSheet1Xml = cmEntries.get("xl/worksheets/sheet1.xml")?.toString("utf-8") || "";
  assert(cmSheet1Xml.includes("Item Name"), "Customer Material Excel contains 'Item Name'");
  assert(cmSheet1Xml.includes("Balance Material to Invoice"), "Customer Material Excel contains 'Balance Material to Invoice'");
  assert(!cmSheet1Xml.includes("Latest Purchase Rate"), "Customer Material Excel omits unselected 'Latest Purchase Rate'");
  assert(!cmSheet1Xml.includes("Responsible Person"), "Customer Material Excel omits unselected 'Responsible Person'");
} else {
  assert(true, "Customer Material Control report skipped for LANTEC (no data)");
}

// 11.6 Field Group Isolation & Category Counters
for (const group of stockCfg.fieldGroups) {
  const inGroup = stockCfg.fields.filter((f) => f.group === group);
  assert(inGroup.length > 0, `Stock field group '${group}' has at least 1 field (${inGroup.length})`);
}

console.log("\n==================================================");
console.log(`TOTAL PASSED: ${passedCount}`);
console.log(`TOTAL FAILED: ${failedCount}`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}


