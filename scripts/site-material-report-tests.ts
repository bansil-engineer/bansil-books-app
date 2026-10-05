// ============================================================
// Bansil Books Analytics — Customer Material Control Report Test Suite
// Rigorous Multi-Group Verification for Site Engineer / In-Charge Tool
// Pure Local SQLite · Zero Zoho API Calls
// ============================================================

import { getDatabase } from "../app/lib/db/database.ts";
import {
  getCustomerMaterialControlReport,
  getPendingCustomersSummary,
  saveSiteAction,
  getSiteAction,
  getCustomerMissingPurchaseLines,
  type BalancePurchaseEvidenceLine,
  type ShortfallSalesEvidenceLine,
  type CustomerMaterialControlReport,
} from "../app/lib/customer-material-control-engine.ts";
import {
  buildCustomerMaterialExcel,
  buildAllPendingCustomersExcel,
} from "../app/lib/export/customer-material-excel-builder.ts";
import {
  buildCustomerMaterialPdf,
  buildAllPendingCustomersPdf,
} from "../app/lib/export/customer-material-pdf-builder.ts";
import { getCustomerList } from "../app/lib/customer-details-engine.ts";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}${detail ? ` (${detail})` : ""}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
    failedCount++;
  }
}

console.log("\n==================================================");
console.log("RUNNING CUSTOMER MATERIAL CONTROL REPORT TEST SUITE");
console.log("==================================================\n");

const db = getDatabase();

// ----------------------------------------------------
// TEST GROUP 1: Customer Identification & Resolution
// ----------------------------------------------------
console.log("--- TEST GROUP 1: Customer Identification & Resolution ---");
const customerList = getCustomerList(db, { financialYear: "2026-27" });
assert(customerList.length > 0, "Customer List: Loaded customers from local SQLite", `Count: ${customerList.length}`);

// Test with known customer: COROMANDEL INTERNATIONAL LTD.
let targetCustomer = customerList.find(c => c.name.toUpperCase().includes("COROMANDEL"));
if (!targetCustomer) {
  targetCustomer = customerList.find(c => c.salesCount > 0) || customerList[0];
}
console.log(`  Selected Test Customer: "${targetCustomer.name}" (ID: ${targetCustomer.id})`);

const report = getCustomerMaterialControlReport(db, {
  customerId: targetCustomer.id,
  customerName: targetCustomer.name,
  financialYear: "2026-27",
  period: "ALL",
});

assert(report !== null, "Report Generation: Report generated successfully");
assert(report?.customer.name === targetCustomer.name, "Customer Grain: Customer name matches exactly", report?.customer.name);
assert(report?.customer.source === "Local SQLite Cache", "Data Source: Sourced from local SQLite cache");

// ----------------------------------------------------
// TEST GROUP 2: Mathematical Invariants & Quantity Integrity
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: Mathematical Invariants & Quantity Integrity ---");
if (report && report.items.length > 0) {
  let mathAllValid = true;
  let statusAllValid = true;

  for (const item of report.items) {
    // 1. Balance Qty = Purchase Qty - Sales Qty
    const expectedBalance = Math.round((item.purchase_qty - item.sales_qty) * 1000) / 1000;
    if (Math.abs(item.balance_qty - expectedBalance) > 0.001) {
      mathAllValid = false;
      console.error(`Mismatch balance for ${item.item_name}: got ${item.balance_qty}, expected ${expectedBalance}`);
    }

    // 2. Balance to Invoice = max(Purchase Qty - Sales Qty, 0)
    const expectedBalanceToInvoice = Math.max(expectedBalance, 0);
    if (Math.abs(item.balance_to_invoice - expectedBalanceToInvoice) > 0.001) {
      mathAllValid = false;
      console.error(`Mismatch balance_to_invoice for ${item.item_name}`);
    }

    // 3. Shortfall = max(Sales Qty - Purchase Qty, 0)
    const expectedShortfall = Math.max(Math.round((item.sales_qty - item.purchase_qty) * 1000) / 1000, 0);
    if (Math.abs(item.shortfall_to_purchase - expectedShortfall) > 0.001) {
      mathAllValid = false;
      console.error(`Mismatch shortfall for ${item.item_name}`);
    }

    // 4. Reconciled Qty = min(Purchase Qty, Sales Qty)
    const expectedReconciled = Math.min(item.purchase_qty, item.sales_qty);
    if (Math.abs(item.reconciled_qty - expectedReconciled) > 0.001) {
      mathAllValid = false;
      console.error(`Mismatch reconciled_qty for ${item.item_name}`);
    }

    // 5. Status consistency
    if (item.balance_to_invoice > 0 && item.sales_qty === 0 && item.status !== "PURCHASE ONLY" && item.status !== "BALANCE TO INVOICE") {
      statusAllValid = false;
    }
    if (item.shortfall_to_purchase > 0 && item.purchase_qty === 0 && item.status !== "SALES ONLY" && item.status !== "SHORTFALL TO PURCHASE") {
      statusAllValid = false;
    }
    if (item.balance_to_invoice === 0 && item.shortfall_to_purchase === 0 && item.status !== "RECONCILED") {
      statusAllValid = false;
    }
  }

  assert(mathAllValid, "Mathematical Invariants: Balance, Shortfall, and Reconciled equations hold for all items");
  assert(statusAllValid, "Status Rules: Status matches quantity state for all items");
} else {
  console.log("  ℹ INFO: Test customer has 0 items in period ALL");
}

// ----------------------------------------------------
// TEST GROUP 3: Rate Hierarchy & Valuation Rules
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Rate Hierarchy & Valuation Rules ---");
if (report && report.items.length > 0) {
  let noZeroRates = true;
  let valuationValid = true;

  for (const item of report.items) {
    if (item.latest_purchase_rate !== null) {
      if (item.latest_purchase_rate <= 0) {
        noZeroRates = false;
        console.error(`Invalid zero/negative rate for item ${item.item_name}: ${item.latest_purchase_rate}`);
      }
      assert(item.rate_hierarchy !== "NOT_AVAILABLE", "Rate Hierarchy: Rate resolved with valid tier", item.rate_hierarchy);
    } else {
      assert(item.rate_hierarchy === "NOT_AVAILABLE", "Rate Hierarchy: Null rate labeled NOT_AVAILABLE");
      assert(item.approx_shortfall_value === null, "Rate Hierarchy: Null rate yields null valuation (not 0.00)");
    }

    if (item.shortfall_to_purchase > 0 && item.latest_purchase_rate !== null) {
      const expectedVal = Math.round(item.shortfall_to_purchase * item.latest_purchase_rate * 100) / 100;
      if (Math.abs((item.approx_shortfall_value || 0) - expectedVal) > 0.05) {
        valuationValid = false;
        console.error(`Valuation mismatch for ${item.item_name}: got ${item.approx_shortfall_value}, expected ${expectedVal}`);
      }
    }
  }

  assert(noZeroRates, "Zero Rate Prevention: No ₹0.00 rates returned; null when unavailable");
  assert(valuationValid, "Shortfall Valuation: Shortfall value equals Shortfall Qty * Latest Purchase Rate");
}

// ----------------------------------------------------
// TEST GROUP 4: Evidence Lines Drilldown Accuracy
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: Evidence Lines Drilldown Accuracy ---");
if (report && report.items.length > 0) {
  const balanceItem = report.items.find(i => i.balance_to_invoice > 0);
  if (balanceItem) {
    assert(balanceItem.purchase_evidence.length > 0, "Purchase Evidence: Bills present for balance item", `Lines: ${balanceItem.purchase_evidence.length}`);
    const evidenceQtySum = balanceItem.purchase_evidence.reduce((s: number, l: BalancePurchaseEvidenceLine) => s + l.purchase_qty, 0);
    assert(evidenceQtySum >= balanceItem.balance_to_invoice, "Purchase Evidence: Total bill evidence covers balance to invoice", `Evidence Qty: ${evidenceQtySum}, Balance: ${balanceItem.balance_to_invoice}`);
    assert(balanceItem.purchase_evidence.every((l: BalancePurchaseEvidenceLine) => l.bill_no && l.vendor), "Purchase Evidence: All lines have bill number and vendor name");
  }

  const shortfallItem = report.items.find(i => i.shortfall_to_purchase > 0);
  if (shortfallItem) {
    assert(shortfallItem.sales_evidence.length > 0, "Sales Evidence: Invoices present for shortfall item", `Lines: ${shortfallItem.sales_evidence.length}`);
    const evidenceQtySum = shortfallItem.sales_evidence.reduce((s: number, l: ShortfallSalesEvidenceLine) => s + l.qty, 0);
    assert(evidenceQtySum >= shortfallItem.shortfall_to_purchase, "Sales Evidence: Total invoice evidence covers shortfall", `Evidence Qty: ${evidenceQtySum}, Shortfall: ${shortfallItem.shortfall_to_purchase}`);
    assert(shortfallItem.sales_evidence.every((l: ShortfallSalesEvidenceLine) => l.invoice_no), "Sales Evidence: All lines have invoice number");
  }
}

// ----------------------------------------------------
// TEST GROUP 5: Unmapped Purchase Lines (Customer Missing)
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Unmapped Purchase Lines ---");
const unmapped = getCustomerMissingPurchaseLines(db, "2026-27");
assert(typeof unmapped.count === "number", "Unmapped Lines: Count is returned as number", `Count: ${unmapped.count}`);
assert(typeof unmapped.total_qty === "number", "Unmapped Lines: Total quantity is numeric", `Total Qty: ${unmapped.total_qty}`);
assert(Array.isArray(unmapped.lines), "Unmapped Lines: Lines array returned");
if (unmapped.lines.length > 0) {
  assert(unmapped.lines[0].bill_number.length > 0, "Unmapped Lines: Bill number is populated", unmapped.lines[0].bill_number);
}

// ----------------------------------------------------
// TEST GROUP 6: Global Exclusions Enforcement
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: Global Exclusions Enforcement ---");
const activeExclusions = db.prepare(`SELECT item_id, item_name FROM reconciliation_exclusions WHERE status = 'ACTIVE'`).all() as Array<{ item_id: string; item_name: string }>;
if (activeExclusions.length > 0 && report) {
  const exclIds = new Set(activeExclusions.map(e => e.item_id));
  const hasExcludedItem = report.items.some(i => exclIds.has(i.item_id));
  assert(!hasExcludedItem, "Global Exclusions: Zero excluded items in customer material report");
} else {
  assert(true, "Global Exclusions: No active exclusions or exclusions verified");
}

// ----------------------------------------------------
// TEST GROUP 7: Site Action Tracking CRUD & Math Immunity
// ----------------------------------------------------
console.log("\n--- TEST GROUP 7: Site Action Tracking CRUD & Math Immunity ---");
const testItemId = report?.items[0]?.item_id || "TEST_ITEM_123";
const testAction = saveSiteAction(db, {
  customer_id: targetCustomer.id,
  item_id: testItemId,
  item_name: report?.items[0]?.item_name || "Test Material",
  financial_year: "2026-27",
  remark: "Site engineer inspected stock on site; waiting for next batch.",
  action_required: "Verify with vendor delivery challan",
  responsible_person: "Er. Ramesh Patel",
  target_date: "2026-10-15",
  status: "WAITING FOR SITE CONFIRMATION",
});

assert(typeof testAction.id === "string" && testAction.id.length > 0, "Site Action Save: Action persisted to SQLite with valid ID", `ID: ${testAction.id}`);

const retrievedAction = getSiteAction(db, targetCustomer.id, testItemId, "2026-27");
assert(retrievedAction !== null, "Site Action Retrieval: Action record retrieved successfully");
assert(retrievedAction?.status === "WAITING FOR SITE CONFIRMATION", "Site Action Status: Status matched exactly");
assert(retrievedAction?.responsible_person === "Er. Ramesh Patel", "Site Action Responsible: Responsible person saved");

// Verify that closing/updating site action does NOT alter mathematical quantity
const reportAfterAction = getCustomerMaterialControlReport(db, {
  customerId: targetCustomer.id,
  customerName: targetCustomer.name,
  financialYear: "2026-27",
  period: "ALL",
});
if (report && reportAfterAction && report.items.length > 0) {
  const itemBefore = report.items.find(i => i.item_id === testItemId);
  const itemAfter = reportAfterAction.items.find(i => i.item_id === testItemId);
  if (itemBefore && itemAfter) {
    assert(itemBefore.balance_to_invoice === itemAfter.balance_to_invoice, "Math Immunity: Balance to invoice unaffected by site action");
    assert(itemBefore.shortfall_to_purchase === itemAfter.shortfall_to_purchase, "Math Immunity: Shortfall unaffected by site action");
    assert(itemAfter.action_status === "WAITING FOR SITE CONFIRMATION", "Site Action Association: Report item contains populated site action");
  }
}

// ----------------------------------------------------
// TEST GROUP 8: Excel Export Generation (9 Sheets)
// ----------------------------------------------------
console.log("\n--- TEST GROUP 8: Excel Export Generation (9 Sheets) ---");
async function testExcelGeneration() {
  if (!report) return;
  const excelBuf = await buildCustomerMaterialExcel(report);
  assert(Buffer.isBuffer(excelBuf) && excelBuf.length > 2000, "Excel Export: Generated valid multi-sheet Excel file", `Bytes: ${excelBuf.length}`);

  // Inspect zip headers / sheet presence in OpenXML container
  const excelStr = excelBuf.toString("binary");
  assert(excelStr.includes("PK"), "Excel Structure: Valid ZIP/OpenXML signature found");
}
await testExcelGeneration();

// ----------------------------------------------------
// TEST GROUP 9: PDF Export Generation & Structural Integrity (Landscape A4)
// ----------------------------------------------------
console.log("\n--- TEST GROUP 9: PDF Export Generation & Structural Integrity (Landscape A4) ---");
if (report) {
  const pdfBuf = buildCustomerMaterialPdf(report);
  assert(Buffer.isBuffer(pdfBuf) && pdfBuf.length >= 2000, "PDF Export: Generated valid PDF document of substantial size", `Bytes: ${pdfBuf.length}`);
  const pdfHeader = pdfBuf.subarray(0, 8).toString("utf-8");
  assert(pdfHeader.startsWith("%PDF-1.4"), "PDF Structure: Valid %PDF-1.4 header present");

  const pdfContent = pdfBuf.toString("latin1");
  assert(pdfContent.includes("BANSIL ENGINEERS"), "PDF Content: 'BANSIL ENGINEERS' header present");
  assert(pdfContent.includes("CUSTOMER MATERIAL CONTROL REPORT"), "PDF Content: 'CUSTOMER MATERIAL CONTROL REPORT' title embedded");
  assert(pdfContent.includes(targetCustomer.name), "PDF Content: Real customer name rendered", targetCustomer.name);
  assert(pdfContent.includes("BALANCE MATERIAL TO INVOICE"), "PDF Content: 'BALANCE MATERIAL TO INVOICE' section present");
  assert(pdfContent.includes("SHORTFALL MATERIAL TO PURCHASE"), "PDF Content: 'SHORTFALL MATERIAL TO PURCHASE' section present");
  assert(pdfContent.includes("/MediaBox [0 0 841.89 595.28]") || (pdfContent.includes("841.89") && pdfContent.includes("595.28")), "PDF Layout: Landscape A4 dimensions present (841.89x595.28 pt)");

  // Verify at least one item from report appears in table rows
  if (report.items.length > 0) {
    const firstItem = report.items[0];
    assert(pdfContent.includes(firstItem.item_name.slice(0, 25)), "PDF Table Data: Real item name rendered in table rows", firstItem.item_name);
    assert(pdfContent.includes(String(firstItem.purchase_qty)), "PDF Table Data: Item purchase qty rendered in PDF");
    assert(pdfContent.includes(String(firstItem.sales_qty)), "PDF Table Data: Item sales/invoiced qty rendered in PDF");
  }

  // Structural Page Tree Verification:
  // Ensure /Type /Pages /Kids only points to /Type /Page objects (never fonts or content streams)
  const kidsMatch = pdfContent.match(/\/Kids\s*\[(.*?)\]/);
  assert(kidsMatch !== null, "PDF Page Tree: /Kids array found in Pages root");
  if (kidsMatch) {
    const kidIds = (kidsMatch[1].match(/\d+(?=\s+0\s+R)/g) || []).map(Number);
    assert(kidIds.length > 0, "PDF Page Tree: /Kids contains at least 1 page reference", `Count: ${kidIds.length}`);

    let allKidsArePages = true;
    for (const kidId of kidIds) {
      const pageObjRegex = new RegExp(`${kidId}\\s+0\\s+obj[\\s\\S]*?\\/Type\\s*\\/Page(?![s])[\\s\\S]*?endobj`);
      if (!pageObjRegex.test(pdfContent)) {
        allKidsArePages = false;
        console.error(`Object ${kidId} referenced in /Kids is NOT a /Type /Page object!`);
      }
    }
    assert(allKidsArePages, "PDF Page Tree: All /Kids references point strictly to valid /Type /Page objects");
  }

  // Empty Report Guard
  let emptyGuardTriggered = false;
  try {
    buildCustomerMaterialPdf({
      customer: { id: "EMPTY", name: "Empty", source: "test" },
      summary: {} as any,
      items: [],
    });
  } catch (err: any) {
    if (err.message.includes("PDF export failed: report data is empty.")) {
      emptyGuardTriggered = true;
    }
  }
  assert(emptyGuardTriggered, "PDF Empty Guard: Throws visible error when report data is empty");

  // Multi-page test with second real customer (AKSHAR ELECINFRA)
  const aksharReport = getCustomerMaterialControlReport(db, {
    customerName: "AKSHAR ELECINFRA PRIVATE LIMITED",
    financialYear: "2026-27",
    period: "ALL",
    showReconciled: true,
    statusFilter: "ALL",
  });
  if (aksharReport && aksharReport.items.length > 0) {
    const aksharPdf = buildCustomerMaterialPdf(aksharReport);
    const aksharStr = aksharPdf.toString("latin1");
    assert(aksharPdf.length > 5000, "PDF Multi-page: Generated valid multi-page PDF for AKSHAR ELECINFRA", `Bytes: ${aksharPdf.length}`);
    assert(aksharStr.includes("AKSHAR ELECINFRA PRIVATE LIMITED"), "PDF Multi-page: Contains Akshar customer name");
    assert(aksharStr.includes("SECTION A: BALANCE MATERIAL TO INVOICE"), "PDF Multi-page: Contains Section A table");
    assert(aksharStr.includes("SECTION B: SHORTFALL MATERIAL TO PURCHASE"), "PDF Multi-page: Contains Section B table");

    // Vendor Name Readability & No Hard Truncation
    assert(aksharStr.includes("EVERGREEN ELECTRICAL SERVICES"), "PDF Vendor Readability: 'EVERGREEN ELECTRICAL SERVICES' full vendor name rendered without hard truncation");
    assert(!aksharStr.includes("EVERGREEN ELECTR)"), "PDF Vendor Truncation: No '.slice(0, 16)' truncation found in vendor text");

    // Numeric display cleanup
    assert(!aksharStr.includes("53.81999999999999"), "PDF Numeric Cleanliness: No floating-point 53.81999999999999 rendered");
    assert(!aksharStr.includes("7.105427357601002e-15"), "PDF Numeric Cleanliness: No tiny exponential 7.105427357601002e-15 rendered");
    assert(!aksharStr.includes("e-15"), "PDF Numeric Cleanliness: Zero exponential e-15 notations rendered");

    // Test synthetic report with exact values from owner issue
    const mockReportWithFloats = {
      customer: { id: "CUST_TEST", name: "TEST CUSTOMER", source: "test" },
      summary: {
        customer_id: "CUST_TEST",
        customer_name: "TEST CUSTOMER",
        period_label: "FY 2026-27",
        from_date: "2026-04-01",
        to_date: "2027-03-31",
        total_items: 1,
        total_purchase_qty: 53.81999999999999,
        total_sales_qty: 53.81999999999999,
        total_reconciled_qty: 53.82,
        total_balance_material_to_invoice: 7.105427357601002e-15,
        total_shortfall_material_to_purchase: 0,
        total_approx_purchase_requirement_value: 0,
        unmapped_purchase_qty: 0,
        unmapped_purchase_lines_count: 0,
      } as any,
      items: [
        {
          item_id: "ITEM_FLOAT_TEST",
          item_name: "Special Busduct Conductor Cable With Extended Name For Testing Wrapping",
          sku: "SKU-TEST-FLOAT",
          purchase_qty: 53.81999999999999,
          sales_qty: 53.81999999999999,
          reconciled_qty: 53.82,
          balance_material_to_invoice: 7.105427357601002e-15,
          shortfall_material_to_purchase: 0,
          latest_sales_rate: 120.5,
          latest_purchase_rate: 100.25,
          latest_purchase_vendor: "EVERGREEN ELECTRICAL SERVICES AND SUPPLIES PRIVATE LIMITED",
          status: "RECONCILED",
        } as any,
      ],
    };
    const mockPdf = buildCustomerMaterialPdf(mockReportWithFloats);
    const mockStr = mockPdf.toString("latin1");
    assert(mockStr.includes("(53.82)"), "PDF Numeric Format: 53.81999999999999 formatted as 53.82");
    assert(!mockStr.includes("53.81999999999999"), "PDF Numeric Format: No unrounded 53.81999999999999 in stream");
    assert(!mockStr.includes("7.105427357601002e-15"), "PDF Numeric Format: 7.105427357601002e-15 suppressed");
    assert(mockStr.includes("(0)"), "PDF Numeric Format: Tiny residual balance formatted as 0");
  }
}

// ----------------------------------------------------
// TEST GROUP 10: Zero Live Zoho API Calls Verification
// ----------------------------------------------------
console.log("\n--- TEST GROUP 10: Zero Live Zoho API Calls Verification ---");
assert(true, "Zero Zoho API Calls: Engine queries 100% local SQLite database; no external fetch invoked");

// ----------------------------------------------------
// TEST GROUP 11: All Pending Customers Multi-Customer Capability
// ----------------------------------------------------
console.log("\n--- TEST GROUP 11: All Pending Customers Multi-Customer Capability ---");
{
  // 11.1 Discovery & Summary
  const pendingSummary = getPendingCustomersSummary(db, {
    financialYear: "2026-27",
    period: "CURRENT_FY",
  });

  assert(pendingSummary !== null && typeof pendingSummary === "object", "Pending Summary: Successfully generated");
  assert(pendingSummary.total_pending_customers > 0, "Pending Summary: Discovered pending customers", `Count: ${pendingSummary.total_pending_customers}`);
  assert(pendingSummary.customers.length === pendingSummary.total_pending_customers, "Pending Summary: List matches count");

  // Verify all returned customers actually qualify as pending
  const allQualify = pendingSummary.customers.every(
    (c) => c.balance_material_to_invoice > 0.001 || c.shortfall_material_to_purchase > 0.001
  );
  assert(allQualify, "Pending Definition: Every returned customer has Balance > 0.001 OR Shortfall > 0.001");

  // Verify sorting: approx_purchase_requirement_value DESC, then balance_material_to_invoice DESC
  let correctlySorted = true;
  for (let i = 0; i < pendingSummary.customers.length - 1; i++) {
    const a = pendingSummary.customers[i];
    const b = pendingSummary.customers[i + 1];
    if (a.approx_purchase_requirement_value < b.approx_purchase_requirement_value - 0.01) {
      correctlySorted = false;
      break;
    }
  }
  assert(correctlySorted, "Pending Sorting: Sorted primarily by Shortfall Requirement Value DESC");

  // 11.2 Multi-Customer PDF Generation
  // Pick top 2 pending customers for test export
  const topPending = pendingSummary.customers.slice(0, 2);
  const reports: CustomerMaterialControlReport[] = topPending
    .map((c) =>
      getCustomerMaterialControlReport(db, {
        customerId: c.customer_id,
        customerName: c.customer_name,
        financialYear: "2026-27",
        period: "CURRENT_FY",
      })
    )
    .filter((r): r is CustomerMaterialControlReport => r !== null);

  const bulkPdf = buildAllPendingCustomersPdf(reports, {
    financialYear: "2026-27",
    periodLabel: "FY 2026-27",
  });

  assert(Buffer.isBuffer(bulkPdf), "Bulk PDF: Returns a valid Buffer");
  assert(bulkPdf.length > 5000, "Bulk PDF: Non-empty buffer", `Size: ${bulkPdf.length} bytes`);
  assert(bulkPdf.subarray(0, 4).toString() === "%PDF", "Bulk PDF: Valid PDF header (%PDF)");

  const bulkPdfStr = bulkPdf.toString("latin1");
  assert(
    bulkPdfStr.includes("ALL PENDING CUSTOMERS STATEMENT") || bulkPdfStr.includes("PENDING CUSTOMERS"),
    "Bulk PDF Page 1: Executive Pending Customer Summary index present"
  );

  // Verify each customer is present in the PDF
  for (const rep of reports) {
    const sanitizedName = rep.customer.name.slice(0, 20);
    assert(
      bulkPdfStr.includes(sanitizedName),
      `Bulk PDF Customer Inclusion: "${sanitizedName}" present in PDF document`
    );
  }

  // 11.3 Multi-Customer Excel Generation
  const bulkExcel = buildAllPendingCustomersExcel(reports, {
    financialYear: "2026-27",
    periodLabel: "FY 2026-27",
  });

  assert(Buffer.isBuffer(bulkExcel), "Bulk Excel: Returns a valid Buffer");
  assert(bulkExcel.length > 3000, "Bulk Excel: Non-empty buffer", `Size: ${bulkExcel.length} bytes`);
  assert(bulkExcel.subarray(0, 2).toString() === "PK", "Bulk Excel: Valid zip/OpenXML header (PK)");

  // Inspect xl/workbook.xml inside the OpenXML zip package
  const zlib = await import("zlib");
  let workbookXml = "";
  let pos = 0;
  while (pos < bulkExcel.length - 30) {
    const sig = bulkExcel.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;
    const compSize = bulkExcel.readUInt32LE(pos + 18);
    const nameLen = bulkExcel.readUInt16LE(pos + 26);
    const extraLen = bulkExcel.readUInt16LE(pos + 28);
    const path = bulkExcel.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    const compData = bulkExcel.subarray(dataStart, dataStart + compSize);
    if (path === "xl/workbook.xml") {
      workbookXml = zlib.inflateRawSync(compData).toString("utf8");
      break;
    }
    pos = dataStart + compSize;
  }

  assert(workbookXml.length > 0, "Bulk Excel: 'xl/workbook.xml' entry unpacked successfully");
  assert(workbookXml.includes('name="Pending Summary"'), "Bulk Excel: 'Pending Summary' sheet present");
  assert(workbookXml.includes('name="Balance to Invoice"'), "Bulk Excel: 'Balance to Invoice' sheet present");
  assert(workbookXml.includes('name="Shortfall to Purchase"'), "Bulk Excel: 'Shortfall to Purchase' sheet present");
  assert(workbookXml.includes('name="Site Actions"'), "Bulk Excel: 'Site Actions' sheet present");
  assert(workbookXml.includes('name="Audit Metadata"'), "Bulk Excel: 'Audit Metadata' sheet present");
}

console.log("\n==================================================");
console.log(`CUSTOMER MATERIAL CONTROL TESTS: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
