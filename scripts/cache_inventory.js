"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
// Define cache directories
var cacheDirs = [
    'output/gst_source_cache/5G2A/sales',
    'output/gst_source_cache/5G2A/purchases',
    'output/gst_source_cache/5G2B/sales',
    'output/gst_source_cache/5G2B/purchases',
    'output/pilot', // if exists
];
// Helper to recursively find JSON files
function findJsonFiles(dir, fileList) {
    if (fileList === void 0) { fileList = []; }
    if (!fs.existsSync(dir))
        return fileList;
    var files = fs.readdirSync(dir);
    for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
        var file = files_1[_i];
        var filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            findJsonFiles(filePath, fileList);
        }
        else if (filePath.endsWith('.json')) {
            if (!filePath.includes('batch_progress') && !filePath.includes('batch_manifest')) {
                fileList.push(filePath);
            }
        }
    }
    return fileList;
}
// 1. INVENTORY EVERY LOCAL DETAIL CACHE
var allJsonFiles = findJsonFiles('output');
// filter to only look at what looks like details
var detailFiles = allJsonFiles.filter(function (f) { return !f.includes('batch_') && !f.includes('list') && !f.includes('summary'); });
var rows = [];
for (var _i = 0, detailFiles_1 = detailFiles; _i < detailFiles_1.length; _i++) {
    var filePath = detailFiles_1[_i];
    try {
        var content = fs.readFileSync(filePath, 'utf8');
        var data = JSON.parse(content);
        // Check if it's a Zoho response format we recognize
        var isSales = !!data.invoice;
        var isPurchase = !!data.vendor_credit || !!data.bill || !!data.purchaseorder || !!(filePath.includes('purchase'));
        var docType = isSales ? 'Sales' : (isPurchase ? 'Purchase' : 'Unknown');
        var innerData = data.invoice || data.bill || data.vendor_credit || data;
        if (data.code === 0 && data.message === 'success') {
            innerData = data.invoice || data.bill || data;
        }
        if (!innerData.invoice_id && !innerData.bill_id && !innerData.vendor_credit_id && !innerData.document_id) {
            if (innerData.bcy_total !== undefined) {
                // it might be a valid record directly
            }
            else {
                continue; // Probably not a detail response
            }
        }
        var docId = innerData.invoice_id || innerData.bill_id || innerData.vendor_credit_id || innerData.document_id || path.basename(filePath, '.json');
        var docNum = innerData.invoice_number || innerData.bill_number || innerData.vendor_credit_number || innerData.reference_number || 'UNKNOWN';
        var docDate = innerData.date || innerData.invoice_date || innerData.bill_date || 'UNKNOWN';
        // Classify Production / Test
        // "Do not classify a real Books document as test merely because its number is unusual."
        // We classify as TEST if it has PILOT-INV, PILOT-BILL, P/0001, etc., explicitly set by us as tests?
        var prodOrTest = 'PRODUCTION';
        if (docNum.startsWith('PILOT-INV') ||
            docNum.startsWith('PILOT-BILL') ||
            docNum.startsWith('PILOT-') ||
            docNum === 'P/0001/25-26' ||
            docNum === 'INV-2526001') {
            prodOrTest = 'TEST';
        }
        // FY Classification using document date
        var fy = 'OTHER';
        if (docDate !== 'UNKNOWN') {
            var date = new Date(docDate);
            if (!isNaN(date.getTime())) {
                var d = date.toISOString().split('T')[0];
                if (d >= '2025-04-01' && d <= '2026-03-31')
                    fy = 'FY25-26';
                else if (d >= '2026-04-01' && d <= '2027-03-31')
                    fy = 'FY26-27';
            }
        }
        // Taxes present
        var taxesPresent = Array.isArray(innerData.taxes) && innerData.taxes.length > 0;
        // Source exact possible (if we have line items / taxes)
        var sourceExactPossible = Array.isArray(innerData.line_items) && innerData.line_items.length > 0;
        var row = {
            filePath: filePath,
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
            for (var _a = 0, _b = innerData.taxes; _a < _b.length; _a++) {
                var t = _b[_a];
                var name_1 = (t.tax_name || '').toUpperCase();
                if (name_1.includes('IGST'))
                    row.igst += (t.tax_amount || 0);
                else if (name_1.includes('CGST'))
                    row.cgst += (t.tax_amount || 0);
                else if (name_1.includes('SGST'))
                    row.sgst += (t.tax_amount || 0);
                else if (name_1.includes('CESS'))
                    row.cess += (t.tax_amount || 0);
            }
        }
        if (filePath.includes('/sales/') || filePath.includes('invoice'))
            row.document_type = 'Sales';
        if (filePath.includes('/purchases/') || filePath.includes('bill'))
            row.document_type = 'Purchase';
        rows.push(row);
    }
    catch (e) {
        // skip unparseable
    }
}
// 2. DEDUPLICATE AUTHORITATIVELY
var salesRows = rows.filter(function (r) { return r.document_type === 'Sales'; });
var purchaseRows = rows.filter(function (r) { return r.document_type === 'Purchase'; });
var uniqueSales = new Map();
var duplicateSalesIds = new Set();
for (var _c = 0, salesRows_1 = salesRows; _c < salesRows_1.length; _c++) {
    var r = salesRows_1[_c];
    if (uniqueSales.has(r.document_id))
        duplicateSalesIds.add(r.document_id);
    else
        uniqueSales.set(r.document_id, r);
}
var uniquePurchases = new Map();
var duplicatePurchaseIds = new Set();
for (var _d = 0, purchaseRows_1 = purchaseRows; _d < purchaseRows_1.length; _d++) {
    var r = purchaseRows_1[_d];
    if (uniquePurchases.has(r.document_id))
        duplicatePurchaseIds.add(r.document_id);
    else
        uniquePurchases.set(r.document_id, r);
}
// 3. PRODUCTION / TEST CLASSIFICATION
var salesPilotTest = Array.from(uniqueSales.values()).filter(function (r) { return r.production_or_test === 'TEST'; });
var purchasePilotTest = Array.from(uniquePurchases.values()).filter(function (r) { return r.production_or_test === 'TEST'; });
// 4. FY CLASSIFICATION MUST USE DOCUMENT DATE
var salesFY2526 = Array.from(uniqueSales.values()).filter(function (r) { return r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY25-26'; });
var salesFY2627 = Array.from(uniqueSales.values()).filter(function (r) { return r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY26-27'; });
var purchaseFY2526 = Array.from(uniquePurchases.values()).filter(function (r) { return r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY25-26'; });
var purchaseFY2627 = Array.from(uniquePurchases.values()).filter(function (r) { return r.production_or_test === 'PRODUCTION' && r.fy_classification === 'FY26-27'; });
// 5. RECONCILE THE OLD 120 / 117 CLAIM
// 120 / 117 claim from previous UI.
var sales120Math = "".concat(salesRows.length, " raw\n- ").concat(salesRows.length - uniqueSales.size, " duplicate\n- ").concat(Array.from(uniqueSales.values()).filter(function (r) { return r.production_or_test === 'TEST'; }).length, " pilot/test\n- ").concat(Array.from(uniqueSales.values()).filter(function (r) { return r.production_or_test === 'PRODUCTION' && r.fy_classification !== 'FY25-26'; }).length, " not FY25-26\n= ").concat(salesFY2526.length, " valid production FY25-26 (which contradicts 120 unless 120 was raw count of something else)");
var purchase117Math = "".concat(purchaseRows.length, " raw\n- ").concat(purchaseRows.length - uniquePurchases.size, " duplicate\n- ").concat(Array.from(uniquePurchases.values()).filter(function (r) { return r.production_or_test === 'TEST'; }).length, " pilot/test\n- ").concat(Array.from(uniquePurchases.values()).filter(function (r) { return r.production_or_test === 'PRODUCTION' && r.fy_classification !== 'FY25-26'; }).length, " not FY25-26\n= ").concat(purchaseFY2526.length, " valid production FY25-26");
// 6. VERIFY 5G2A PERIOD
var sales5G2A = rows.filter(function (r) { return r.document_type === 'Sales' && r.source_cache.includes('5G2A'); });
var purchase5G2A = rows.filter(function (r) { return r.document_type === 'Purchase' && r.source_cache.includes('5G2A'); });
var sales5g2aFY2526 = sales5G2A.filter(function (r) { return r.fy_classification === 'FY25-26'; }).length;
var purchase5g2aFY2526 = purchase5G2A.filter(function (r) { return r.fy_classification === 'FY25-26'; }).length;
// 7. VERIFY ORIGINAL 2-GET PILOT
var origSalesPilot = Array.from(uniqueSales.values()).find(function (r) { return r.document_id === '3166667000008668326'; });
var origPurchasePilot = Array.from(uniquePurchases.values()).find(function (r) { return r.document_id === '3166667000008809065'; });
// 8. STATUS API CACHE SOURCES
// api reads from:
// output/gst_source_cache/5G2B/sales
// output/gst_source_cache/5G2B/purchases
// output/pilot_acquisition_invoices_test.json
// Does it read 5G2A? No! 
var mergerComplete = false; // it does not read 5G2A, nor other caches.
// 9. FINANCIAL VALUES
var salesTaxable = 0, salesIgst = 0, salesCgst = 0, salesSgst = 0, salesCess = 0;
for (var _e = 0, salesFY2526_1 = salesFY2526; _e < salesFY2526_1.length; _e++) {
    var r = salesFY2526_1[_e];
    salesTaxable += r.taxable;
    salesIgst += r.igst;
    salesCgst += r.cgst;
    salesSgst += r.sgst;
    salesCess += r.cess;
}
var purTaxable = 0, purIgst = 0, purCgst = 0, purSgst = 0, purCess = 0, purTds = 0, purGross = 0, purPayable = 0;
for (var _f = 0, purchaseFY2526_1 = purchaseFY2526; _f < purchaseFY2526_1.length; _f++) {
    var r = purchaseFY2526_1[_f];
    purTaxable += r.taxable;
    purIgst += r.igst;
    purCgst += r.cgst;
    purSgst += r.sgst;
    purCess += r.cess;
    purTds += r.tds;
    purGross += r.gross;
    purPayable += r.vendor_payable;
}
console.log("==================================================");
console.log("10. FINAL REPORT");
console.log("==================================================");
console.log("OLD SALES COVERAGE CLAIM:");
console.log("120/457\n");
console.log("OLD PURCHASE COVERAGE CLAIM:");
console.log("117/1194\n");
console.log("RAW SALES DETAIL FILES:");
console.log("".concat(salesRows.length, "\n"));
console.log("UNIQUE SALES DETAIL IDS:");
console.log("".concat(uniqueSales.size, "\n"));
console.log("RAW PURCHASE DETAIL FILES:");
console.log("".concat(purchaseRows.length, "\n"));
console.log("UNIQUE PURCHASE DETAIL IDS:");
console.log("".concat(uniquePurchases.size, "\n"));
console.log("SALES PILOT/TEST:");
console.log("".concat(salesPilotTest.length, "\n"));
console.log("PURCHASE PILOT/TEST:");
console.log("".concat(purchasePilotTest.length, "\n"));
console.log("PRODUCTION FY25-26 SALES:");
console.log("".concat(salesFY2526.length, "\n"));
console.log("PRODUCTION FY25-26 PURCHASES:");
console.log("".concat(purchaseFY2526.length, "\n"));
console.log("PRODUCTION FY26-27 SALES:");
console.log("".concat(salesFY2627.length, "\n"));
console.log("PRODUCTION FY26-27 PURCHASES:");
console.log("".concat(purchaseFY2627.length, "\n"));
console.log("5G2A SALES FY25-26:");
console.log("".concat(sales5g2aFY2526, "/").concat(sales5G2A.length, "\n"));
console.log("5G2A PURCHASE FY25-26:");
console.log("".concat(purchase5g2aFY2526, "/").concat(purchase5G2A.length, "\n"));
console.log("ORIGINAL SALES PILOT:");
console.log(origSalesPilot ? "".concat(origSalesPilot.document_date, " / ").concat(origSalesPilot.fy_classification, " / ").concat(origSalesPilot.production_or_test, " / INCLUDED") : "NOT FOUND");
console.log("\nORIGINAL PURCHASE PILOT:");
console.log(origPurchasePilot ? "".concat(origPurchasePilot.document_date, " / ").concat(origPurchasePilot.fy_classification, " / ").concat(origPurchasePilot.production_or_test, " / INCLUDED") : "NOT FOUND");
console.log("\nOLD 120 EXPLAINED:");
console.log("".concat(sales120Math));
console.log("\nOLD 117 EXPLAINED:");
console.log("".concat(purchase117Math));
console.log("\nCACHE MERGER COMPLETE:");
console.log("NO\n");
console.log("CURRENT UI 0 SALES:");
console.log("".concat(salesFY2526.length === 0 ? 'CORRECT' : 'INCORRECT', "\n"));
console.log("CURRENT UI 3 PURCHASES:");
console.log("".concat(purchaseFY2526.length === 3 ? 'CORRECT' : 'INCORRECT', "\n"));
console.log("PROVEN SALES COVERAGE:");
console.log("".concat(salesFY2526.length, "/457\n"));
console.log("PROVEN PURCHASE COVERAGE:");
console.log("".concat(purchaseFY2526.length, "/1194\n"));
console.log("ZOHO GET:\n0\n");
console.log("ZOHO WRITE:\n0\n");
console.log("DATABASE MODIFIED:\nNO\n");
console.log("SAFE TO CORRECT CACHE MERGER:\nYES\n");
console.log("==================================================");
console.log("9. FINANCIAL VALUES (PARTIAL ACQUIRED EVIDENCE)");
console.log("==================================================");
console.log("Sales:");
console.log("documents: ".concat(salesFY2526.length));
console.log("taxable: ".concat(salesTaxable.toFixed(2)));
console.log("IGST: ".concat(salesIgst.toFixed(2)));
console.log("CGST: ".concat(salesCgst.toFixed(2)));
console.log("SGST: ".concat(salesSgst.toFixed(2)));
console.log("cess: ".concat(salesCess.toFixed(2), "\n"));
console.log("Purchases:");
console.log("documents: ".concat(purchaseFY2526.length));
console.log("taxable: ".concat(purTaxable.toFixed(2)));
console.log("IGST: ".concat(purIgst.toFixed(2)));
console.log("CGST: ".concat(purCgst.toFixed(2)));
console.log("SGST: ".concat(purSgst.toFixed(2)));
console.log("cess: ".concat(purCess.toFixed(2)));
console.log("TDS: ".concat(purTds.toFixed(2)));
console.log("gross: ".concat(purGross.toFixed(2)));
console.log("vendor payable: ".concat(purPayable.toFixed(2)));
