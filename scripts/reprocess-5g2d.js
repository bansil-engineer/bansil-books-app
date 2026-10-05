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
var PUR_DIR = path.resolve('output', 'gst_source_cache', '5G2D_FY2526', 'purchases');
var files = fs.readdirSync(PUR_DIR).filter(function (f) { return f.endsWith('.json'); });
var pPass = 0, pMis = 0, pUnc = 0;
var pTdsFailures = 0;
for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
    var file = files_1[_i];
    var raw = fs.readFileSync(path.join(PUR_DIR, file), 'utf8');
    var data = JSON.parse(raw);
    var innerData = data.bill || data;
    var taxes = innerData.taxes || [];
    var igst = 0, cgst = 0, sgst = 0, cess = 0;
    for (var _a = 0, taxes_1 = taxes; _a < taxes_1.length; _a++) {
        var t = taxes_1[_a];
        var nm = (t.tax_name || '').toUpperCase();
        if (nm.includes('IGST'))
            igst += t.tax_amount;
        else if (nm.includes('CGST'))
            cgst += t.tax_amount;
        else if (nm.includes('SGST'))
            sgst += t.tax_amount;
        else if (nm.includes('CESS'))
            cess += t.tax_amount;
    }
    var totalTax = igst + cgst + sgst + cess;
    var taxable = innerData.sub_total || 0;
    var discount = innerData.discount_amount || 0;
    var shipping = innerData.shipping_charge || 0;
    var adjustment = innerData.adjustment || 0;
    var calcGross = taxable - discount + shipping + totalTax + adjustment;
    var reportedGross = innerData.total || innerData.bcy_total || 0;
    var tds = innerData.tds_amount || innerData.tax_withheld_amount || 0;
    // Check if TDS semantics break anything
    if (tds > 0) {
        var mismatchBecauseOfTDS = Math.abs(reportedGross - calcGross) > 0.1 && Math.abs((reportedGross + tds) - calcGross) > 0.1;
        if (mismatchBecauseOfTDS) {
            pTdsFailures++;
        }
    }
    var match1 = Math.abs((reportedGross + tds) - calcGross) <= 0.1;
    var match2 = Math.abs(calcGross - reportedGross) <= 0.1;
    if (match1 || match2) {
        pPass++;
    }
    else {
        pMis++;
    }
}
console.log("AFTER OFFLINE CORRECTION:\nPASS: ".concat(pPass, "/250\nMISMATCH: ").concat(pMis, "\nNOT COMPUTABLE: ").concat(pUnc));
console.log("TDS SEMANTIC FAILURES: ".concat(pTdsFailures));
