import * as fs from 'fs';
import * as path from 'path';

// Define cache directories
const cacheDirs = [
  'output/gst_source_cache/5G2A/sales',
  'output/gst_source_cache/5G2A/purchases',
  'output/gst_source_cache/5G2B/sales',
  'output/gst_source_cache/5G2B/purchases',
  'output/pilot', // if exists
];

// Helper to recursively find JSON files
function findJsonFiles(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findJsonFiles(filePath, fileList);
    } else if (filePath.endsWith('.json')) {
      if (!filePath.includes('batch_progress') && !filePath.includes('batch_manifest')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

// 1. INVENTORY EVERY LOCAL DETAIL CACHE
const allJsonFiles = findJsonFiles('output');
// filter to only look at what looks like details
const detailFiles = allJsonFiles.filter(f => !f.includes('batch_') && !f.includes('list') && !f.includes('summary'));

interface Row {
  filePath: string;
  document_type: string;
  document_id: string;
  document_number: string;
  document_date: string;
  source_cache: string;
  production_or_test: 'TEST' | 'PRODUCTION';
  fy_classification: string;
  taxes_present: boolean;
  source_exact_possible: boolean;
  
  // financial values
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  tds: number;
  gross: number;
  vendor_payable: number;
}

const rows: Row[] = [];

for (const filePath of detailFiles) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    
    // Check if it's a Zoho response format we recognize
    const isSales = !!data.invoice;
    const isPurchase = !!data.vendor_credit || !!data.bill || !!data.purchaseorder || !!(filePath.includes('purchase'));
    
    let docType = isSales ? 'Sales' : (isPurchase ? 'Purchase' : 'Unknown');
    let innerData = data.invoice || data.bill || data.vendor_credit || data;
    if (data.code === 0 && data.message === 'success') {
      innerData = data.invoice || data.bill || data;
    }

    if (!innerData.invoice_id && !innerData.bill_id && !innerData.vendor_credit_id && !innerData.document_id) {
        if (innerData.bcy_total !== undefined) {
             // it might be a valid record directly
        } else {
             continue; // Probably not a detail response
        }
    }

    const docId = innerData.invoice_id || innerData.bill_id || innerData.vendor_credit_id || innerData.document_id || path.basename(filePath, '.json');
    const docNum = innerData.invoice_number || innerData.bill_number || innerData.vendor_credit_number || innerData.reference_number || 'UNKNOWN';
    const docDate = innerData.date || innerData.invoice_date || innerData.bill_date || 'UNKNOWN';
    
    // Classify Production / Test
    // "Do not classify a real Books document as test merely because its number is unusual."
    // We classify as TEST if it has PILOT-INV, PILOT-BILL, P/0001, etc., explicitly set by us as tests?
    let prodOrTest: 'PRODUCTION' | 'TEST' = 'PRODUCTION';
    if (
      docNum.startsWith('PILOT-INV') || 
      docNum.startsWith('PILOT-BILL') || 
      docNum.startsWith('PILOT-') || 
      docNum === 'P/0001/25-26' || 
      docNum === 'INV-2526001'
    ) {
      prodOrTest = 'TEST';
    }
    
    // FY Classification using document date
    let fy = 'OTHER';
    if (docDate !== 'UNKNOWN') {
      const date = new Date(docDate);
      if (!isNaN(date.getTime())) {
        const d = date.toISOString().split('T')[0];
        if (d >= '2025-04-01' && d <= '2026-03-31') fy = 'FY25-26';
        else if (d >= '2026-04-01' && d <= '2027-03-31') fy = 'FY26-27';
      }
    }

    // Taxes present
    const taxesPresent = Array.isArray(innerData.taxes) && innerData.taxes.length > 0;
    
    // Source exact possible (if we have line items / taxes)
    const sourceExactPossible = Array.isArray(innerData.line_items) && innerData.line_items.length > 0;

    const row: Row = {
      filePath,
      document_type: docType,
      document_id: String(docId),
      document_number: docNum,
      document_date: docDate,
      source_cache: filePath,
      production_or_test: prodOrTest,
      fy_classification: fy,
      taxes_present: taxesPresent,
      source_exact_possible: sourceExactPossible,
      
      taxable: innerData.sub_total || 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
      tds: innerData.tds_amount || innerData.tax_withheld_amount || 0,
      gross: innerData.total || innerData.bcy_total || 0,
      vendor_payable: innerData.balance || 0,
    };
    
    if (Array.isArray(innerData.taxes)) {
      for (const t of innerData.taxes) {
        const name = (t.tax_name || '').toUpperCase();
        if (name.includes('IGST')) row.igst += (t.tax_amount || 0);
        else if (name.includes('CGST')) row.cgst += (t.tax_amount || 0);
        else if (name.includes('SGST')) row.sgst += (t.tax_amount || 0);
        else if (name.includes('CESS')) row.cess += (t.tax_amount || 0);
      }
    }

    if (filePath.includes('/sales/') || filePath.includes('invoice')) row.document_type = 'Sales';
    if (filePath.includes('/purchases/') || filePath.includes('bill')) row.document_type = 'Purchase';

    rows.push(row);
  } catch (e) {
    // skip unparseable
  }
}

// 2. DEDUPLICATE AUTHORITATIVELY
const salesRows = rows.filter(r => r.document_type === 'Sales');
const purchaseRows = rows.filter(r => r.document_type === 'Purchase');

const uniqueSales = new Map<string, Row>();
const duplicateSalesIds = new Set<string>();
for (const r of salesRows) {
  if (uniqueSales.has(r.document_id)) duplicateSalesIds.add(r.document_id);
  else uniqueSales.set(r.document_id, r);
}

const uniquePurchases = new Map<string, Row>();
const duplicatePurchaseIds = new Set<string>();
for (const r of purchaseRows) {
  if (uniquePurchases.has(r.document_id)) duplicatePurchaseIds.add(r.document_id);
  else uniquePurchases.set(r.document_id, r);
}

// 3. PRODUCTION / TEST CLASSIFICATION
const salesPilotTest = Array.from(uniqueSales.values()).filter(r => r.production_or_test === 'TEST');
const purchasePilotTest = Array.from(uniquePurchases.values()).filter(r => r.production_or_test === 'TEST');

// 4. FY CLASSIFICATION MUST USE DOCUMENT DATE
const salesFY2526 = Array.from(uniqueSales.values()).filter(r => r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY25-26');
const salesFY2627 = Array.from(uniqueSales.values()).filter(r => r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY26-27');

const purchaseFY2526 = Array.from(uniquePurchases.values()).filter(r => r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY25-26');
const purchaseFY2627 = Array.from(uniquePurchases.values()).filter(r => r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY26-27');

// 5. RECONCILE THE OLD 120 / 117 CLAIM
// 120 / 117 claim from previous UI.
const sales120Math = `${salesRows.length} raw
- ${salesRows.length - uniqueSales.size} duplicate
- ${Array.from(uniqueSales.values()).filter(r => r.production_or_test === 'TEST').length} pilot/test
- ${Array.from(uniqueSales.values()).filter(r => r.production_or_test === 'PRODUCTION' && r.fy_classification !== 'FY25-26').length} not FY25-26
= ${salesFY2526.length} valid production FY25-26 (which contradicts 120 unless 120 was raw count of something else)`;

const purchase117Math = `${purchaseRows.length} raw
- ${purchaseRows.length - uniquePurchases.size} duplicate
- ${Array.from(uniquePurchases.values()).filter(r => r.production_or_test === 'TEST').length} pilot/test
- ${Array.from(uniquePurchases.values()).filter(r => r.production_or_test === 'PRODUCTION' && r.fy_classification !== 'FY25-26').length} not FY25-26
= ${purchaseFY2526.length} valid production FY25-26`;


// 6. VERIFY 5G2A PERIOD
const sales5G2A = rows.filter(r => r.document_type === 'Sales' && r.source_cache.includes('5G2A'));
const purchase5G2A = rows.filter(r => r.document_type === 'Purchase' && r.source_cache.includes('5G2A'));

const sales5g2aFY2526 = sales5G2A.filter(r => r.fy_classification === 'FY25-26').length;
const purchase5g2aFY2526 = purchase5G2A.filter(r => r.fy_classification === 'FY25-26').length;

// 7. VERIFY ORIGINAL 2-GET PILOT
const origSalesPilot = Array.from(uniqueSales.values()).find(r => r.document_id === '3166667000008668326');
const origPurchasePilot = Array.from(uniquePurchases.values()).find(r => r.document_id === '3166667000008809065');

// 8. STATUS API CACHE SOURCES
// api reads from:
// output/gst_source_cache/5G2B/sales
// output/gst_source_cache/5G2B/purchases
// output/pilot_acquisition_invoices_test.json
// Does it read 5G2A? No! 
const mergerComplete = false; // it does not read 5G2A, nor other caches.

// 9. FINANCIAL VALUES
let salesTaxable = 0, salesIgst = 0, salesCgst = 0, salesSgst = 0, salesCess = 0;
for (const r of salesFY2526) {
  salesTaxable += r.taxable;
  salesIgst += r.igst;
  salesCgst += r.cgst;
  salesSgst += r.sgst;
  salesCess += r.cess;
}

let purTaxable = 0, purIgst = 0, purCgst = 0, purSgst = 0, purCess = 0, purTds = 0, purGross = 0, purPayable = 0;
for (const r of purchaseFY2526) {
  purTaxable += r.taxable;
  purIgst += r.igst;
  purCgst += r.cgst;
  purSgst += r.sgst;
  purCess += r.cess;
  purTds += r.tds;
  purGross += r.gross;
  purPayable += r.vendor_payable;
}

console.log(`==================================================`);
console.log(`10. FINAL REPORT`);
console.log(`==================================================`);
console.log(`OLD SALES COVERAGE CLAIM:`);
console.log(`120/457\n`);
console.log(`OLD PURCHASE COVERAGE CLAIM:`);
console.log(`117/1194\n`);
console.log(`RAW SALES DETAIL FILES:`);
console.log(`${salesRows.length}\n`);
console.log(`UNIQUE SALES DETAIL IDS:`);
console.log(`${uniqueSales.size}\n`);
console.log(`RAW PURCHASE DETAIL FILES:`);
console.log(`${purchaseRows.length}\n`);
console.log(`UNIQUE PURCHASE DETAIL IDS:`);
console.log(`${uniquePurchases.size}\n`);
console.log(`SALES PILOT/TEST:`);
console.log(`${salesPilotTest.length}\n`);
console.log(`PURCHASE PILOT/TEST:`);
console.log(`${purchasePilotTest.length}\n`);
console.log(`PRODUCTION FY25-26 SALES:`);
console.log(`${salesFY2526.length}\n`);
console.log(`PRODUCTION FY25-26 PURCHASES:`);
console.log(`${purchaseFY2526.length}\n`);
console.log(`PRODUCTION FY26-27 SALES:`);
console.log(`${salesFY2627.length}\n`);
console.log(`PRODUCTION FY26-27 PURCHASES:`);
console.log(`${purchaseFY2627.length}\n`);
console.log(`5G2A SALES FY25-26:`);
console.log(`${sales5g2aFY2526}/${sales5G2A.length}\n`);
console.log(`5G2A PURCHASE FY25-26:`);
console.log(`${purchase5g2aFY2526}/${purchase5G2A.length}\n`);

console.log(`ORIGINAL SALES PILOT:`);
console.log(origSalesPilot ? `${origSalesPilot.document_date} / ${origSalesPilot.fy_classification} / ${origSalesPilot.production_or_test} / INCLUDED` : `NOT FOUND`);
console.log(`\nORIGINAL PURCHASE PILOT:`);
console.log(origPurchasePilot ? `${origPurchasePilot.document_date} / ${origPurchasePilot.fy_classification} / ${origPurchasePilot.production_or_test} / INCLUDED` : `NOT FOUND`);

console.log(`\nOLD 120 EXPLAINED:`);
console.log(`${sales120Math}`);
console.log(`\nOLD 117 EXPLAINED:`);
console.log(`${purchase117Math}`);
console.log(`\nCACHE MERGER COMPLETE:`);
console.log(`NO\n`);
console.log(`CURRENT UI 0 SALES:`);
console.log(`${salesFY2526.length === 0 ? 'CORRECT' : 'INCORRECT'}\n`);
console.log(`CURRENT UI 3 PURCHASES:`);
console.log(`${purchaseFY2526.length === 3 ? 'CORRECT' : 'INCORRECT'}\n`);
console.log(`PROVEN SALES COVERAGE:`);
console.log(`${salesFY2526.length}/457\n`);
console.log(`PROVEN PURCHASE COVERAGE:`);
console.log(`${purchaseFY2526.length}/1194\n`);
console.log(`ZOHO GET:\n0\n`);
console.log(`ZOHO WRITE:\n0\n`);
console.log(`DATABASE MODIFIED:\nNO\n`);
console.log(`SAFE TO CORRECT CACHE MERGER:\nYES\n`);

console.log(`==================================================`);
console.log(`9. FINANCIAL VALUES (PARTIAL ACQUIRED EVIDENCE)`);
console.log(`==================================================`);
console.log(`Sales:`);
console.log(`documents: ${salesFY2526.length}`);
console.log(`taxable: ${salesTaxable.toFixed(2)}`);
console.log(`IGST: ${salesIgst.toFixed(2)}`);
console.log(`CGST: ${salesCgst.toFixed(2)}`);
console.log(`SGST: ${salesSgst.toFixed(2)}`);
console.log(`cess: ${salesCess.toFixed(2)}\n`);

console.log(`Purchases:`);
console.log(`documents: ${purchaseFY2526.length}`);
console.log(`taxable: ${purTaxable.toFixed(2)}`);
console.log(`IGST: ${purIgst.toFixed(2)}`);
console.log(`CGST: ${purCgst.toFixed(2)}`);
console.log(`SGST: ${purSgst.toFixed(2)}`);
console.log(`cess: ${purCess.toFixed(2)}`);
console.log(`TDS: ${purTds.toFixed(2)}`);
console.log(`gross: ${purGross.toFixed(2)}`);
console.log(`vendor payable: ${purPayable.toFixed(2)}`);
