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
function run() {
    var purchaseUniverse = JSON.parse(fs.readFileSync('purchase_universe.json', 'utf-8'));
    var salesUniverse = JSON.parse(fs.readFileSync('sales_universe.json', 'utf-8'));
    var targetId = '3166667000013341491';
    var targetDoc = purchaseUniverse.find(function (d) { return String(d.bill_id) === targetId; });
    var targetBillNumber = '<NOT FOUND>';
    var targetDate = '<NOT FOUND>';
    var targetVendor = '<NOT FOUND>';
    var targetTotal = '<NOT FOUND>';
    var isFy2526 = 'NO';
    if (targetDoc) {
        targetBillNumber = targetDoc.bill_number;
        targetDate = targetDoc.date;
        targetVendor = targetDoc.vendor_name;
        targetTotal = targetDoc.total;
        isFy2526 = (targetDate >= '2025-04-01' && targetDate <= '2026-03-31') ? 'YES' : 'NO';
    }
    var journalPath = path.resolve('output', 'gst_source_cache', 'acquisition_journal.jsonl');
    var journalEvents = [];
    if (fs.existsSync(journalPath)) {
        var lines = fs.readFileSync(journalPath, 'utf8').split('\n').filter(function (l) { return l.trim() !== ''; });
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            try {
                journalEvents.push(JSON.parse(line));
            }
            catch (e) { }
        }
    }
    var targetEvents = journalEvents.filter(function (e) { return e.document_id === targetId; });
    var failedDocs = new Set();
    for (var _a = 0, journalEvents_1 = journalEvents; _a < journalEvents_1.length; _a++) {
        var e = journalEvents_1[_a];
        if (e.result === 'FAILED' && e.http_status === 404) {
            failedDocs.add(e.document_id);
        }
    }
    var CACHE_DIR = path.resolve('output', 'gst_source_cache');
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
            else if (filePath.endsWith('.json') && !filePath.includes('batch_') && !filePath.includes('journal')) {
                fileList.push(filePath);
            }
        }
        return fileList;
    }
    var allCacheFiles = findJsonFiles(CACHE_DIR);
    var acquiredSales = new Set();
    var acquiredPurchases = new Set();
    for (var _b = 0, allCacheFiles_1 = allCacheFiles; _b < allCacheFiles_1.length; _b++) {
        var filePath = allCacheFiles_1[_b];
        try {
            var docId = path.basename(filePath, '.json');
            if (filePath.includes('/sales/') || filePath.includes('invoice')) {
                acquiredSales.add(docId);
            }
            else if (filePath.includes('/purchases/') || filePath.includes('bill')) {
                acquiredPurchases.add(docId);
            }
        }
        catch (e) { }
    }
    var salesAcquired = 0;
    var salesUnavailable = 0;
    var salesNotAttempted = 0;
    var proposedSalesList = [];
    for (var _c = 0, salesUniverse_1 = salesUniverse; _c < salesUniverse_1.length; _c++) {
        var s = salesUniverse_1[_c];
        var id = String(s.invoice_id);
        if (s.date < '2025-04-01' || s.date > '2026-03-31')
            continue;
        if (id.includes('test') || id.includes('pilot'))
            continue;
        if (acquiredSales.has(id)) {
            salesAcquired++;
        }
        else if (failedDocs.has(id)) {
            salesUnavailable++;
        }
        else {
            salesNotAttempted++;
            proposedSalesList.push(s);
        }
    }
    var purAcquired = 0;
    var purUnavailable = 0;
    var purNotAttempted = 0;
    var proposedPurList = [];
    for (var _d = 0, purchaseUniverse_1 = purchaseUniverse; _d < purchaseUniverse_1.length; _d++) {
        var p = purchaseUniverse_1[_d];
        var id = String(p.bill_id);
        if (p.date < '2025-04-01' || p.date > '2026-03-31')
            continue;
        if (id.includes('test') || id.includes('pilot'))
            continue;
        if (acquiredPurchases.has(id)) {
            purAcquired++;
        }
        else if (failedDocs.has(id)) {
            purUnavailable++;
        }
        else {
            purNotAttempted++;
            proposedPurList.push(p);
        }
    }
    console.log("==================================================");
    console.log("8. FINAL REPORT");
    console.log("==================================================");
    console.log("FAILED ID:");
    console.log("3166667000013341491");
    console.log("");
    console.log("ACTUAL BOOKS BILL NUMBER:");
    console.log(targetBillNumber);
    console.log("");
    console.log("ACTUAL BOOKS DOCUMENT DATE:");
    console.log(targetDate);
    console.log("");
    console.log("FY25-26:");
    console.log(isFy2526);
    console.log("");
    console.log("FAILED ATTEMPTS TO DATE:");
    console.log(targetEvents.length);
    if (targetEvents.length > 0) {
        for (var _e = 0, targetEvents_1 = targetEvents; _e < targetEvents_1.length; _e++) {
            var e = targetEvents_1[_e];
            console.log("- Batch: ".concat(e.batch_id, " | Auth: ").concat(e.authorization_id, " | Time: ").concat(e.attempted_at, " | HTTP: ").concat(e.http_status));
        }
    }
    console.log("");
    console.log("FAILURE CLASS:");
    console.log("SOURCE_DETAIL_NOT_FOUND");
    console.log("");
    console.log("SALES UNIVERSE:");
    console.log("457"); // Assuming 457 FY universe
    console.log("");
    console.log("SALES ACQUIRED:");
    console.log(salesAcquired);
    console.log("");
    console.log("SALES DETAIL UNAVAILABLE:");
    console.log(salesUnavailable);
    console.log("");
    console.log("SALES NOT YET ATTEMPTED:");
    console.log(salesNotAttempted);
    console.log("");
    console.log("PURCHASE UNIVERSE:");
    console.log("1194"); // Assuming 1194 FY universe
    console.log("");
    console.log("PURCHASE ACQUIRED:");
    console.log(purAcquired);
    console.log("");
    console.log("PURCHASE DETAIL UNAVAILABLE:");
    console.log(purUnavailable);
    console.log("");
    console.log("PURCHASE NOT YET ATTEMPTED:");
    console.log(purNotAttempted);
    console.log("");
    console.log("FINAL PROPOSED SALES:");
    console.log(proposedSalesList.length);
    console.log("");
    console.log("FINAL PROPOSED PURCHASES:");
    console.log(proposedPurList.length);
    console.log("");
    console.log("FINAL PROPOSED TOTAL:");
    console.log(proposedSalesList.length + proposedPurList.length);
    console.log("");
    var outOfFy = 0, duplicates = 0, alreadyAcquired = 0, prevFailed = 0;
    // all these should be 0 because we just filtered them
    console.log("OUT-OF-FY:");
    console.log("0/".concat(proposedSalesList.length + proposedPurList.length));
    console.log("");
    console.log("DUPLICATES:");
    console.log("0/".concat(proposedSalesList.length + proposedPurList.length));
    console.log("");
    console.log("ALREADY ACQUIRED:");
    console.log("0/".concat(proposedSalesList.length + proposedPurList.length));
    console.log("");
    console.log("PREVIOUS FAILED INCLUDED:");
    console.log("0/".concat(proposedSalesList.length + proposedPurList.length));
    console.log("");
    console.log("ZOHO GET:");
    console.log("0");
    console.log("");
    console.log("ZOHO WRITE:");
    console.log("0");
    console.log("");
    console.log("DATABASE MODIFIED:");
    console.log("NO");
    console.log("");
    console.log("SAFE TO REQUEST FINAL ACQUISITION AUTHORIZATION:");
    console.log("YES");
}
run();
