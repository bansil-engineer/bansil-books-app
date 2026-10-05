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
var BATCH_DIR = path.resolve('output', 'gst_source_cache', '5G2C_FY2526');
var MANIFEST_PATH = path.join(BATCH_DIR, 'batch_manifest.json');
var PROGRESS_PATH = path.join(BATCH_DIR, 'batch_progress.json');
var manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
console.log("== 1. INVESTIGATE FAILED GET ==");
var failed = manifest.find(function (m) { return m.fetch_status !== 'SUCCESS'; });
if (failed) {
    console.log("Failed Document: ".concat(failed.document_id, " (").concat(failed.document_number, ")"));
    console.log("Date: ".concat(failed.document_date));
    console.log("Status: ".concat(failed.fetch_status));
    console.log("Type: ".concat(failed.document_type));
    // Check if partial exists
    var pPath = path.join(BATCH_DIR, failed.document_type, "".concat(failed.document_id, ".json"));
    console.log("Cache exists: ".concat(fs.existsSync(pPath)));
}
console.log("\n== 2 & 3 & 4 & 5. MISMATCH ANALYSIS ==");
var mismatches = [];
var corrected = [];
var parserTds = 0, sourceDev = 0;
for (var _i = 0, manifest_1 = manifest; _i < manifest_1.length; _i++) {
    var m = manifest_1[_i];
    if (m.document_type !== 'purchases' || m.fetch_status !== 'SUCCESS')
        continue;
    var fPath = path.join(BATCH_DIR, 'purchases', "".concat(m.document_id, ".json"));
    if (!fs.existsSync(fPath))
        continue;
    var data = JSON.parse(fs.readFileSync(fPath, 'utf8'));
    var bill = data.bill || data;
    var taxable = bill.sub_total || 0;
    var adjustment = bill.adjustment || 0;
    var taxes = bill.taxes || [];
    var totalTax = 0;
    for (var _a = 0, taxes_1 = taxes; _a < taxes_1.length; _a++) {
        var t = taxes_1[_a];
        totalTax += t.tax_amount;
    }
    var grossCalc = taxable + totalTax + adjustment;
    var grossReported = bill.total || bill.bcy_total || 0;
    var tds = bill.tds_amount || bill.tax_withheld_amount || 0;
    var paid = bill.payment_made || 0;
    var balance = bill.balance || 0;
    if (Math.abs(grossReported - grossCalc) > 0.1) {
        // Original logic was mismatching here? Wait, original script was:
        // const calc = taxable + totalTax + adjustment;
        // if (Math.abs(gross - calc) > 0.1) mismatch...
        var vendorName = bill.vendor_name;
        mismatches.push({
            id: m.document_id,
            num: m.document_number,
            date: m.document_date,
            vendor: vendorName,
            taxable: taxable,
            totalTax: totalTax,
            adjustment: adjustment,
            calc: grossCalc,
            reported: grossReported,
            tds: tds,
            paid: paid,
            balance: balance
        });
    }
}
console.log("Found ".concat(mismatches.length, " original mismatches."));
for (var _b = 0, mismatches_1 = mismatches; _b < mismatches_1.length; _b++) {
    var mis = mismatches_1[_b];
    console.log("\nBill ID: ".concat(mis.id, " (").concat(mis.num, ") [").concat(mis.date, "] ").concat(mis.vendor));
    console.log("  Taxable: ".concat(mis.taxable, ", Tax: ").concat(mis.totalTax, ", Adj: ").concat(mis.adjustment, " -> Calc: ").concat(mis.calc));
    console.log("  Reported Gross: ".concat(mis.reported, ", TDS: ").concat(mis.tds, ", Paid: ").concat(mis.paid, ", Bal: ").concat(mis.balance));
    // Check if the original logic in phase-5g2c-acquisition.ts was doing what the user said:
    // Wait, the original logic WAS taxable + totalTax + adjustment.
    // If that didn't match `bill.total`, what WAS `bill.total`?
    // Let's print out what we see.
}
