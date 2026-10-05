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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
// 1. BUILD AUTHORITATIVE FY25-26 UNIVERSE
var salesUniverse = JSON.parse(fs.readFileSync('sales_universe.json', 'utf-8'));
var purchaseUniverse = JSON.parse(fs.readFileSync('purchase_universe.json', 'utf-8'));
var salesUniverseIds = new Set(salesUniverse.map(function (r) { return String(r.invoice_id); }));
var purchaseUniverseIds = new Set(purchaseUniverse.map(function (r) { return String(r.bill_id); }));
// 2. EXCLUDE ALREADY ACQUIRED VALID FY DETAILS
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
        else if (filePath.endsWith('.json') && !filePath.includes('batch_')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}
var allCacheFiles = findJsonFiles('output');
var cachedSalesIds = new Set();
var cachedPurchaseIds = new Set();
var rawPurchaseDetails = []; // for step 4
for (var _i = 0, allCacheFiles_1 = allCacheFiles; _i < allCacheFiles_1.length; _i++) {
    var filePath = allCacheFiles_1[_i];
    try {
        var content = fs.readFileSync(filePath, 'utf8');
        var data = JSON.parse(content);
        var innerData = data.invoice || data.bill || data.vendor_credit || data;
        if (data.code === 0 && data.message === 'success') {
            innerData = data.invoice || data.bill || data;
        }
        var docId = String(innerData.invoice_id || innerData.bill_id || innerData.vendor_credit_id || innerData.document_id || path.basename(filePath, '.json'));
        var docDate = innerData.date || innerData.invoice_date || innerData.bill_date || 'UNKNOWN';
        // Test if FY25-26
        var isFY = false;
        if (docDate !== 'UNKNOWN') {
            var d = docDate;
            if (d >= '2025-04-01' && d <= '2026-03-31')
                isFY = true;
        }
        if (isFY) {
            if (filePath.includes('/sales/') || filePath.includes('invoice') || innerData.invoice_id) {
                cachedSalesIds.add(docId);
            }
            else if (filePath.includes('/purchases/') || filePath.includes('bill') || innerData.bill_id) {
                cachedPurchaseIds.add(docId);
                rawPurchaseDetails.push({ filePath: filePath, innerData: innerData });
            }
        }
    }
    catch (e) { }
}
var validSalesAcquired = salesUniverse.filter(function (r) { return cachedSalesIds.has(String(r.invoice_id)); });
var salesRemaining = salesUniverse.filter(function (r) { return !cachedSalesIds.has(String(r.invoice_id)); });
var validPurchasesAcquired = purchaseUniverse.filter(function (r) { return cachedPurchaseIds.has(String(r.bill_id)); });
var purchaseRemaining = purchaseUniverse.filter(function (r) { return !cachedPurchaseIds.has(String(r.bill_id)); });
// 3. PROVE MONTH DISTRIBUTION
var months = [
    '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'
];
var mStats = [];
var _loop_1 = function (m) {
    var sT = salesUniverse.filter(function (r) { return r.date.startsWith(m); }).length;
    var sA = validSalesAcquired.filter(function (r) { return r.date.startsWith(m); }).length;
    var sR = salesRemaining.filter(function (r) { return r.date.startsWith(m); }).length;
    var pT = purchaseUniverse.filter(function (r) { return r.date.startsWith(m); }).length;
    var pA = validPurchasesAcquired.filter(function (r) { return r.date.startsWith(m); }).length;
    var pR = purchaseRemaining.filter(function (r) { return r.date.startsWith(m); }).length;
    mStats.push({ month: m, sTot: sT, sAcq: sA, sRem: sR, pTot: pT, pAcq: pA, pRem: pR });
};
for (var _a = 0, months_1 = months; _a < months_1.length; _a++) {
    var m = months_1[_a];
    _loop_1(m);
}
// 4. INVESTIGATE THE 3 PURCHASE DETAILS
var expOutput = '';
var differenceExplained = 'EXPLAINED';
for (var _b = 0, rawPurchaseDetails_1 = rawPurchaseDetails; _b < rawPurchaseDetails_1.length; _b++) {
    var raw = rawPurchaseDetails_1[_b];
    var d = raw.innerData;
    var taxable = d.sub_total || 0;
    var gst = 0;
    if (Array.isArray(d.taxes)) {
        gst = d.taxes.reduce(function (acc, t) { return acc + (t.tax_amount || 0); }, 0);
    }
    var gross = d.total || d.bcy_total || 0;
    var tds = d.tds_amount || d.tax_withheld_amount || 0;
    var vendorPayable = d.balance || 0;
    var adjustment = d.adjustment || 0;
    // Calculate difference strictly as requested
    var diff = gross - vendorPayable;
    var explained = false;
    var expParts = [];
    if (tds > 0)
        expParts.push("TDS: ".concat(tds));
    // Payments made?
    var paymentMade = d.payment_made || 0;
    if (paymentMade > 0)
        expParts.push("Payment Made: ".concat(paymentMade));
    var diffRemaining = Math.abs(diff - (tds + paymentMade));
    if (diffRemaining < 0.01) {
        explained = true;
    }
    if (!explained && Math.abs(diff) < 0.01) {
        explained = true;
    }
    if (!explained) {
        differenceExplained = 'NOT EXPLAINED';
    }
    expOutput += "\nBill ID: ".concat(d.bill_id, "\nBill Number: ").concat(d.bill_number, "\nDate: ").concat(d.date, "\nTaxable: ").concat(taxable, "\nGST: ").concat(gst, "\nBill Gross: ").concat(gross, "\nTDS: ").concat(tds, "\nVendor Payable: ").concat(vendorPayable, "\nAdjustment: ").concat(adjustment, "\nPayment Made: ").concat(paymentMade, "\nDifference: ").concat(diff, "\nSource Explanation: ").concat(explained ? expParts.join(', ') || 'None (Gross == Payable)' : 'NOT FULLY EXPLAINED', "\n");
}
// 5. ORIGINAL 2-GET PILOT
var origSalesId = '3166667000008668326';
var origPurchId = '3166667000008809065';
var sPilotInUni = salesUniverseIds.has(origSalesId);
var pPilotInUni = purchaseUniverseIds.has(origPurchId);
var sPilotDb = salesUniverse.find(function (r) { return String(r.invoice_id) === origSalesId; });
var pPilotDb = purchaseUniverse.find(function (r) { return String(r.bill_id) === origPurchId; });
// 6. DESIGN NEXT ACQUISITION SELECTION
function selectProportional(remaining, target) {
    var totalRemaining = remaining.length;
    if (totalRemaining <= target)
        return __spreadArray([], remaining, true);
    var selected = [];
    var groupedByMonth = remaining.reduce(function (acc, r) {
        var m = r.date.substring(0, 7);
        if (!acc[m])
            acc[m] = [];
        acc[m].push(r);
        return acc;
    }, {});
    // allocate proportionally
    var taken = 0;
    for (var _i = 0, months_2 = months; _i < months_2.length; _i++) {
        var m = months_2[_i];
        if (!groupedByMonth[m])
            continue;
        var countToTake = Math.floor((groupedByMonth[m].length / totalRemaining) * target);
        selected = selected.concat(groupedByMonth[m].slice(0, countToTake));
        taken += countToTake;
    }
    // add remaining if rounding left us short
    if (taken < target) {
        var diff = target - taken;
        var remainingToPick = remaining.filter(function (r) { return !selected.includes(r); });
        selected = selected.concat(remainingToPick.slice(0, diff));
    }
    return selected;
}
var nextSales = selectProportional(salesRemaining, 100);
var nextPurchases = selectProportional(purchaseRemaining, 100);
// 7. PERMANENT SELECTION GUARD
function guardCheck(doc, alreadyCachedSet) {
    var id = doc.invoice_id || doc.bill_id;
    if (!id)
        return false;
    if (!doc.date)
        return false;
    if (doc.date < '2025-04-01' || doc.date > '2026-03-31')
        return false;
    if (alreadyCachedSet.has(id))
        return false;
    return true;
}
var allProposedFY2526 = true;
var duplicateIds = 0;
var alreadyCachedIds = 0;
var guardPass = true;
var proposedIds = new Set();
for (var _c = 0, nextSales_1 = nextSales; _c < nextSales_1.length; _c++) {
    var s = nextSales_1[_c];
    if (proposedIds.has(s.invoice_id))
        duplicateIds++;
    if (cachedSalesIds.has(s.invoice_id))
        alreadyCachedIds++;
    proposedIds.add(s.invoice_id);
    if (!guardCheck(s, cachedSalesIds))
        guardPass = false;
    if (s.date < '2025-04-01' || s.date > '2026-03-31')
        allProposedFY2526 = false;
}
for (var _d = 0, nextPurchases_1 = nextPurchases; _d < nextPurchases_1.length; _d++) {
    var p = nextPurchases_1[_d];
    if (proposedIds.has(p.bill_id))
        duplicateIds++;
    if (cachedPurchaseIds.has(p.bill_id))
        alreadyCachedIds++;
    proposedIds.add(p.bill_id);
    if (!guardCheck(p, cachedPurchaseIds))
        guardPass = false;
    if (p.date < '2025-04-01' || p.date > '2026-03-31')
        allProposedFY2526 = false;
}
console.log("==================================================");
console.log("8. FINAL REPORT");
console.log("==================================================\n");
console.log("FY25-26 SALES UNIVERSE:");
console.log("".concat(salesUniverse.length, "\n"));
console.log("FY25-26 PURCHASE UNIVERSE:");
console.log("".concat(purchaseUniverse.length, "\n"));
console.log("VALID SALES DETAIL ACQUIRED:");
console.log("".concat(validSalesAcquired.length, "\n"));
console.log("VALID PURCHASE DETAIL ACQUIRED:");
console.log("".concat(validPurchasesAcquired.length, "\n"));
console.log("SALES REMAINING:");
console.log("".concat(salesRemaining.length, "\n"));
console.log("PURCHASE REMAINING:");
console.log("".concat(purchaseRemaining.length, "\n"));
console.log("3-PURCHASE \u20B919,000 DIFFERENCE:");
console.log("".concat(differenceExplained, "\n"));
console.log("EXPLANATION:");
console.log("".concat(expOutput.trim(), "\n"));
console.log("ORIGINAL SALES PILOT IN FY UNIVERSE:");
console.log("".concat(sPilotInUni ? 'YES' : 'NO', " ").concat(sPilotInUni ? "(".concat((sPilotDb === null || sPilotDb === void 0 ? void 0 : sPilotDb.invoice_number) || '', " / ").concat((sPilotDb === null || sPilotDb === void 0 ? void 0 : sPilotDb.date) || '', " / FY25-26 / ").concat((sPilotDb === null || sPilotDb === void 0 ? void 0 : sPilotDb.total) || '', ")") : '', "\n"));
console.log("ORIGINAL PURCHASE PILOT IN FY UNIVERSE:");
console.log("".concat(pPilotInUni ? 'YES' : 'NO', " ").concat(pPilotInUni ? "(".concat((pPilotDb === null || pPilotDb === void 0 ? void 0 : pPilotDb.bill_number) || '', " / ").concat((pPilotDb === null || pPilotDb === void 0 ? void 0 : pPilotDb.date) || '', " / FY25-26 / ").concat((pPilotDb === null || pPilotDb === void 0 ? void 0 : pPilotDb.total) || '', ")") : '', "\n"));
console.log("ORIGINAL PILOT DETAIL EVIDENCE:");
console.log("MISSING\n");
console.log("NEXT PROPOSED SALES:");
console.log("".concat(nextSales.length, "\n"));
console.log("NEXT PROPOSED PURCHASE:");
console.log("".concat(nextPurchases.length, "\n"));
console.log("ALL PROPOSED DOCUMENTS FY25-26:");
console.log("".concat(allProposedFY2526 ? 'YES' : 'NO', "\n"));
console.log("DUPLICATE PROPOSED IDS:");
console.log("".concat(duplicateIds, "/").concat(nextSales.length + nextPurchases.length, "\n"));
console.log("ALREADY-CACHED PROPOSED IDS:");
console.log("".concat(alreadyCachedIds, "/").concat(nextSales.length + nextPurchases.length, "\n"));
console.log("FY GUARD:");
console.log("".concat(guardPass ? 'PASS' : 'FAIL', "\n"));
console.log("ZOHO GET:\n0\n");
console.log("ZOHO WRITE:\n0\n");
console.log("DATABASE MODIFIED:\nNO\n");
console.log("SAFE TO REQUEST OWNER AUTHORIZATION FOR NEXT FY25-26 BATCH:");
console.log("".concat(guardPass && allProposedFY2526 && duplicateIds === 0 && alreadyCachedIds === 0 ? 'YES' : 'NO'));
console.log("\n==================================================");
console.log("3. PROVE MONTH DISTRIBUTION");
console.log("==================================================");
for (var _e = 0, mStats_1 = mStats; _e < mStats_1.length; _e++) {
    var s = mStats_1[_e];
    console.log("".concat(s.month, "\nSales total: ").concat(s.sTot, "\nSales already cached: ").concat(s.sAcq, "\nSales remaining: ").concat(s.sRem, "\nPurchase total: ").concat(s.pTot, "\nPurchase already cached: ").concat(s.pAcq, "\nPurchase remaining: ").concat(s.pRem, "\n"));
}
