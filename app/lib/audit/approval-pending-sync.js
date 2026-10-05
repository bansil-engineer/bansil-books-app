"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSoRefFromPo = extractSoRefFromPo;
exports.extractSoRefFromCustomFieldsJson = extractSoRefFromCustomFieldsJson;
exports.syncApprovalPending = syncApprovalPending;
exports.syncApprovalPendingDocument = syncApprovalPendingDocument;
var audit_database_ts_1 = require("../db/audit-database.ts");
var zoho_token_store_ts_1 = require("../zoho-token-store.ts");
var zoho_read_transactions_ts_1 = require("./accounts/zoho-read-transactions.ts");
var crypto_1 = __importDefault(require("crypto"));
var so_po_mapping_ts_1 = require("./so-po-mapping.ts");
function extractSoRefFromPo(po) {
    var soRefNumber = null;
    var soRefId = (po === null || po === void 0 ? void 0 : po.salesorder_id) || null;
    if ((po === null || po === void 0 ? void 0 : po.custom_fields) && Array.isArray(po.custom_fields)) {
        var f = po.custom_fields.find(function (cf) {
            var _a, _b;
            return ((_a = cf.label) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "sales order no" ||
                ((_b = cf.label) === null || _b === void 0 ? void 0 : _b.toLowerCase()) === "reference so" ||
                cf.api_name === "cf_sales_order_no";
        });
        if (f && f.value) {
            soRefNumber = String(f.value).trim();
        }
    }
    return { soRefNumber: soRefNumber, soRefId: soRefId };
}
function extractSoRefFromCustomFieldsJson(customFieldsJson) {
    if (!customFieldsJson)
        return null;
    try {
        var cf = JSON.parse(customFieldsJson);
        if (Array.isArray(cf)) {
            var f = cf.find(function (item) {
                var _a, _b;
                return ((_a = item.label) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "sales order no" ||
                    ((_b = item.label) === null || _b === void 0 ? void 0 : _b.toLowerCase()) === "reference so" ||
                    item.api_name === "cf_sales_order_no";
            });
            if (f && f.value)
                return String(f.value).trim();
        }
    }
    catch (e) { }
    return null;
}
function normalizeNarration(desc) {
    if (desc === undefined || desc === null)
        return "";
    return String(desc).trim();
}
function resolveDescState(desc) {
    if (desc !== undefined && desc !== null) {
        if (String(desc).trim() === "") {
            return "CAPTURED_EMPTY";
        }
        return String(desc);
    }
    if (desc === undefined) {
        return "SOURCE DOES NOT PROVIDE NARRATION";
    }
    return "CAPTURED_EMPTY";
}
function narrationMatches(dbDesc, newDesc) {
    if (dbDesc === "SOURCE DOES NOT PROVIDE NARRATION" && newDesc === undefined)
        return true;
    if (dbDesc === "CAPTURED_EMPTY" && (newDesc === null || String(newDesc).trim() === ""))
        return true;
    return normalizeNarration(dbDesc) === normalizeNarration(newDesc);
}
function syncApprovalPending(period, options) {
    return __awaiter(this, void 0, void 0, function () {
        var orgId, apiDomain, tokens, db, source_run_id, fetchedAt, reader, failed, poRes, billRes, invRes, pendingPOs, candidatePoIdsSeen, _i, _a, row, detail, e_1, pendingBills, candidateBillIdsSeen, _b, _c, row, detail, e_2, pendingInvoices, candidateInvIdsSeen, _d, _e, row, detail, e_3, locallyPendingPOs, poStatusUpdates, _loop_1, _f, locallyPendingPOs_1, localPO, locallyPendingBills, billStatusUpdates, _loop_2, _g, locallyPendingBills_1, localBill, locallyPendingInvoices, invoiceStatusUpdates, _loop_3, _h, locallyPendingInvoices_1, localInv, referencedSoIds, referencedPoIds, _j, pendingBills_1, bill, _k, pendingInvoices_1, inv, _l, pendingPOs_1, po, _m, soRefNumber, soRefId, row, searchRes, resolvedSoId, e_4, refPOs, _o, referencedPoIds_1, poId, detail, e_5, refSOs, _p, referencedSoIds_1, soId, detail, e_6, seenDocIds, docsToInsert, docsToUpdate, unchanged, _q, pendingPOs_2, _r, row, po, docId, existing, existingLines, incomingLines, customFieldsJson, deliveryCustomer, oldRef, newRef, referenceChanged, headerChanged, linesChanged, i, el, il, _s, pendingBills_2, _t, row, bill, docId, existing, existingLines, incomingLines, customFieldsJson, oldRef, newRef, referenceChanged, headerChanged, linesChanged, i, el, il, _u, pendingInvoices_2, _v, row, inv, docId, existing, existingLines, incomingLines, customFieldsJson, deliveryCustomer, oldRef, newRef, referenceChanged, headerChanged, linesChanged, i, el, il, _w, refPOs_1, po, existing, existingLines, incomingLines, linesChanged, i, el, il, _x, refSOs_1, so, existing, existingLines, incomingLines, linesChanged, i, el, il, _y, poStatusUpdates_1, update, _z, billStatusUpdates_1, update, _0, invoiceStatusUpdates_1, update, docsToWrite, _1, docsToWrite_1, item, po, customFieldsJson, deliveryCustomerName, _2, _3, line, bill, customFieldsJson, _4, _5, line, inv, customFieldsJson, deliveryCustomerName, _6, _7, line, so, customFieldsJson, deliveryCustomerName, _8, _9, line, created, updated, checked;
        var _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45, _46, _47, _48, _49, _50, _51, _52, _53, _54, _55, _56, _57, _58, _59, _60, _61, _62, _63, _64, _65, _66, _67, _68, _69, _70, _71, _72, _73, _74, _75, _76, _77, _78, _79, _80, _81, _82, _83, _84, _85, _86, _87, _88, _89, _90, _91, _92, _93, _94, _95, _96, _97, _98, _99, _100, _101, _102, _103, _104, _105, _106, _107, _108, _109, _110, _111, _112, _113, _114, _115, _116, _117, _118, _119, _120, _121, _122, _123, _124, _125, _126, _127, _128, _129, _130, _131, _132, _133, _134, _135, _136, _137, _138, _139, _140, _141, _142, _143, _144, _145, _146, _147, _148, _149, _150, _151, _152, _153, _154, _155, _156, _157, _158, _159, _160, _161, _162, _163, _164, _165, _166, _167, _168, _169, _170, _171, _172, _173, _174, _175, _176, _177, _178, _179, _180, _181, _182, _183, _184, _185, _186, _187, _188, _189, _190, _191, _192, _193, _194, _195, _196, _197, _198, _199, _200;
        return __generator(this, function (_201) {
            switch (_201.label) {
                case 0:
                    orgId = options === null || options === void 0 ? void 0 : options.orgId;
                    apiDomain = options === null || options === void 0 ? void 0 : options.apiDomain;
                    if (!(options === null || options === void 0 ? void 0 : options.reader)) {
                        tokens = (0, zoho_token_store_ts_1.readTokenStore)();
                        if (!tokens || !tokens.access_token) {
                            throw new Error("Zoho not connected");
                        }
                        orgId = orgId || tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "774390949";
                        apiDomain = apiDomain || tokens.api_domain || "https://www.zohoapis.com";
                    }
                    else {
                        orgId = orgId || "TEST_ORG";
                        apiDomain = apiDomain || "https://test.zohoapis.com";
                    }
                    db = (options === null || options === void 0 ? void 0 : options.db) || (0, audit_database_ts_1.getAuditDatabase)();
                    source_run_id = "APPROVAL_PENDING_ACTIVE";
                    fetchedAt = new Date().toISOString();
                    reader = (options === null || options === void 0 ? void 0 : options.reader) || {
                        listPurchaseOrders: zoho_read_transactions_ts_1.listPurchaseOrders,
                        getPurchaseOrder: zoho_read_transactions_ts_1.getPurchaseOrder,
                        listBills: zoho_read_transactions_ts_1.listBills,
                        getBill: zoho_read_transactions_ts_1.getBill,
                        listInvoices: zoho_read_transactions_ts_1.listInvoices,
                        getInvoice: zoho_read_transactions_ts_1.getInvoice,
                        listSalesOrders: zoho_read_transactions_ts_1.listSalesOrders,
                        getSalesOrder: zoho_read_transactions_ts_1.getSalesOrder,
                    };
                    failed = 0;
                    return [4 /*yield*/, reader.listPurchaseOrders(orgId, 200)];
                case 1:
                    poRes = _201.sent();
                    return [4 /*yield*/, reader.listBills(orgId, 200)];
                case 2:
                    billRes = _201.sent();
                    return [4 /*yield*/, reader.listInvoices(orgId, 200)];
                case 3:
                    invRes = _201.sent();
                    pendingPOs = [];
                    candidatePoIdsSeen = new Set();
                    _i = 0, _a = poRes.purchaseorders || [];
                    _201.label = 4;
                case 4:
                    if (!(_i < _a.length)) return [3 /*break*/, 9];
                    row = _a[_i];
                    candidatePoIdsSeen.add(row.purchaseorder_id);
                    if (row.status !== "pending_approval" && row.status !== "draft")
                        return [3 /*break*/, 8];
                    _201.label = 5;
                case 5:
                    _201.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, reader.getPurchaseOrder(orgId, row.purchaseorder_id)];
                case 6:
                    detail = _201.sent();
                    if (detail.purchaseorder) {
                        pendingPOs.push({ row: row, po: detail.purchaseorder });
                    }
                    else {
                        failed++;
                    }
                    return [3 /*break*/, 8];
                case 7:
                    e_1 = _201.sent();
                    failed++;
                    return [3 /*break*/, 8];
                case 8:
                    _i++;
                    return [3 /*break*/, 4];
                case 9:
                    pendingBills = [];
                    candidateBillIdsSeen = new Set();
                    _b = 0, _c = billRes.bills || [];
                    _201.label = 10;
                case 10:
                    if (!(_b < _c.length)) return [3 /*break*/, 15];
                    row = _c[_b];
                    candidateBillIdsSeen.add(row.bill_id);
                    if (row.status !== "pending_approval" && row.status !== "draft" && row.status !== "open")
                        return [3 /*break*/, 14];
                    _201.label = 11;
                case 11:
                    _201.trys.push([11, 13, , 14]);
                    return [4 /*yield*/, reader.getBill(orgId, row.bill_id)];
                case 12:
                    detail = _201.sent();
                    if (detail.bill) {
                        pendingBills.push({ row: row, bill: detail.bill });
                    }
                    else {
                        failed++;
                    }
                    return [3 /*break*/, 14];
                case 13:
                    e_2 = _201.sent();
                    failed++;
                    return [3 /*break*/, 14];
                case 14:
                    _b++;
                    return [3 /*break*/, 10];
                case 15:
                    pendingInvoices = [];
                    candidateInvIdsSeen = new Set();
                    _d = 0, _e = invRes.invoices || [];
                    _201.label = 16;
                case 16:
                    if (!(_d < _e.length)) return [3 /*break*/, 21];
                    row = _e[_d];
                    candidateInvIdsSeen.add(row.invoice_id);
                    if (row.status !== "pending_approval" && row.status !== "draft")
                        return [3 /*break*/, 20];
                    _201.label = 17;
                case 17:
                    _201.trys.push([17, 19, , 20]);
                    return [4 /*yield*/, reader.getInvoice(orgId, row.invoice_id)];
                case 18:
                    detail = _201.sent();
                    if (detail.invoice) {
                        pendingInvoices.push({ row: row, inv: detail.invoice });
                    }
                    else {
                        failed++;
                    }
                    return [3 /*break*/, 20];
                case 19:
                    e_3 = _201.sent();
                    failed++;
                    return [3 /*break*/, 20];
                case 20:
                    _d++;
                    return [3 /*break*/, 16];
                case 21:
                    locallyPendingPOs = db.prepare("\n    SELECT purchaseorder_id, status FROM audit_zoho_purchase_orders\n    WHERE source_run_id = ? AND LOWER(status) IN ('pending_approval', 'draft')\n  ").all(source_run_id);
                    poStatusUpdates = [];
                    _loop_1 = function (localPO) {
                        var listMatch, detail, e_7;
                        return __generator(this, function (_202) {
                            switch (_202.label) {
                                case 0:
                                    if (!candidatePoIdsSeen.has(localPO.purchaseorder_id)) return [3 /*break*/, 1];
                                    listMatch = (poRes.purchaseorders || []).find(function (p) { return p.purchaseorder_id === localPO.purchaseorder_id; });
                                    if (listMatch && listMatch.status !== "pending_approval" && listMatch.status !== "draft") {
                                        poStatusUpdates.push({ id: localPO.purchaseorder_id, status: listMatch.status });
                                    }
                                    return [3 /*break*/, 4];
                                case 1:
                                    _202.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, reader.getPurchaseOrder(orgId, localPO.purchaseorder_id)];
                                case 2:
                                    detail = _202.sent();
                                    if (detail.purchaseorder) {
                                        if (detail.purchaseorder.status !== "pending_approval" && detail.purchaseorder.status !== "draft") {
                                            poStatusUpdates.push({ id: localPO.purchaseorder_id, status: detail.purchaseorder.status });
                                        }
                                        else {
                                            pendingPOs.push({ row: detail.purchaseorder, po: detail.purchaseorder });
                                        }
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    e_7 = _202.sent();
                                    if (e_7.message && e_7.message.includes("404")) {
                                        poStatusUpdates.push({ id: localPO.purchaseorder_id, status: "deleted" });
                                    }
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    _f = 0, locallyPendingPOs_1 = locallyPendingPOs;
                    _201.label = 22;
                case 22:
                    if (!(_f < locallyPendingPOs_1.length)) return [3 /*break*/, 25];
                    localPO = locallyPendingPOs_1[_f];
                    return [5 /*yield**/, _loop_1(localPO)];
                case 23:
                    _201.sent();
                    _201.label = 24;
                case 24:
                    _f++;
                    return [3 /*break*/, 22];
                case 25:
                    locallyPendingBills = db.prepare("\n    SELECT bill_id, status FROM audit_zoho_bills\n    WHERE source_run_id = ? AND LOWER(status) IN ('pending_approval', 'draft')\n  ").all(source_run_id);
                    billStatusUpdates = [];
                    _loop_2 = function (localBill) {
                        var listMatch, detail, e_8;
                        return __generator(this, function (_203) {
                            switch (_203.label) {
                                case 0:
                                    if (!candidateBillIdsSeen.has(localBill.bill_id)) return [3 /*break*/, 1];
                                    listMatch = (billRes.bills || []).find(function (b) { return b.bill_id === localBill.bill_id; });
                                    if (listMatch && listMatch.status !== "pending_approval" && listMatch.status !== "draft" && listMatch.status !== "open") {
                                        billStatusUpdates.push({ id: localBill.bill_id, status: listMatch.status });
                                    }
                                    return [3 /*break*/, 4];
                                case 1:
                                    _203.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, reader.getBill(orgId, localBill.bill_id)];
                                case 2:
                                    detail = _203.sent();
                                    if (detail.bill) {
                                        if (detail.bill.status !== "pending_approval" && detail.bill.status !== "draft" && detail.bill.status !== "open") {
                                            billStatusUpdates.push({ id: localBill.bill_id, status: detail.bill.status });
                                        }
                                        else {
                                            pendingBills.push({ row: detail.bill, bill: detail.bill });
                                        }
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    e_8 = _203.sent();
                                    if (e_8.message && e_8.message.includes("404")) {
                                        billStatusUpdates.push({ id: localBill.bill_id, status: "deleted" });
                                    }
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    _g = 0, locallyPendingBills_1 = locallyPendingBills;
                    _201.label = 26;
                case 26:
                    if (!(_g < locallyPendingBills_1.length)) return [3 /*break*/, 29];
                    localBill = locallyPendingBills_1[_g];
                    return [5 /*yield**/, _loop_2(localBill)];
                case 27:
                    _201.sent();
                    _201.label = 28;
                case 28:
                    _g++;
                    return [3 /*break*/, 26];
                case 29:
                    locallyPendingInvoices = db.prepare("\n    SELECT invoice_id, status FROM audit_zoho_invoices\n    WHERE source_run_id = ? AND LOWER(status) IN ('pending_approval', 'draft')\n  ").all(source_run_id);
                    invoiceStatusUpdates = [];
                    _loop_3 = function (localInv) {
                        var listMatch, detail, e_9;
                        return __generator(this, function (_204) {
                            switch (_204.label) {
                                case 0:
                                    if (!candidateInvIdsSeen.has(localInv.invoice_id)) return [3 /*break*/, 1];
                                    listMatch = (invRes.invoices || []).find(function (i) { return i.invoice_id === localInv.invoice_id; });
                                    if (listMatch && listMatch.status !== "pending_approval" && listMatch.status !== "draft") {
                                        invoiceStatusUpdates.push({ id: localInv.invoice_id, status: listMatch.status });
                                    }
                                    return [3 /*break*/, 4];
                                case 1:
                                    _204.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, reader.getInvoice(orgId, localInv.invoice_id)];
                                case 2:
                                    detail = _204.sent();
                                    if (detail.invoice) {
                                        if (detail.invoice.status !== "pending_approval" && detail.invoice.status !== "draft") {
                                            invoiceStatusUpdates.push({ id: localInv.invoice_id, status: detail.invoice.status });
                                        }
                                        else {
                                            pendingInvoices.push({ row: detail.invoice, inv: detail.invoice });
                                        }
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    e_9 = _204.sent();
                                    if (e_9.message && e_9.message.includes("404")) {
                                        invoiceStatusUpdates.push({ id: localInv.invoice_id, status: "deleted" });
                                    }
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    _h = 0, locallyPendingInvoices_1 = locallyPendingInvoices;
                    _201.label = 30;
                case 30:
                    if (!(_h < locallyPendingInvoices_1.length)) return [3 /*break*/, 33];
                    localInv = locallyPendingInvoices_1[_h];
                    return [5 /*yield**/, _loop_3(localInv)];
                case 31:
                    _201.sent();
                    _201.label = 32;
                case 32:
                    _h++;
                    return [3 /*break*/, 30];
                case 33:
                    referencedSoIds = new Set();
                    referencedPoIds = new Set();
                    for (_j = 0, pendingBills_1 = pendingBills; _j < pendingBills_1.length; _j++) {
                        bill = pendingBills_1[_j].bill;
                        if (bill.purchaseorder_id)
                            referencedPoIds.add(bill.purchaseorder_id);
                    }
                    for (_k = 0, pendingInvoices_1 = pendingInvoices; _k < pendingInvoices_1.length; _k++) {
                        inv = pendingInvoices_1[_k].inv;
                        if (inv.salesorder_id)
                            referencedSoIds.add(inv.salesorder_id);
                    }
                    _l = 0, pendingPOs_1 = pendingPOs;
                    _201.label = 34;
                case 34:
                    if (!(_l < pendingPOs_1.length)) return [3 /*break*/, 40];
                    po = pendingPOs_1[_l].po;
                    _m = extractSoRefFromPo(po), soRefNumber = _m.soRefNumber, soRefId = _m.soRefId;
                    if (soRefId)
                        referencedSoIds.add(soRefId);
                    if (!soRefNumber) return [3 /*break*/, 39];
                    row = db.prepare("SELECT salesorder_id FROM audit_zoho_sales_orders WHERE salesorder_number = ? LIMIT 1").get(soRefNumber);
                    if (!(row && row.salesorder_id)) return [3 /*break*/, 35];
                    referencedSoIds.add(row.salesorder_id);
                    return [3 /*break*/, 39];
                case 35:
                    if (!reader.getSalesOrderByNumber) return [3 /*break*/, 39];
                    _201.label = 36;
                case 36:
                    _201.trys.push([36, 38, , 39]);
                    return [4 /*yield*/, reader.getSalesOrderByNumber(orgId, soRefNumber)];
                case 37:
                    searchRes = _201.sent();
                    resolvedSoId = (searchRes === null || searchRes === void 0 ? void 0 : searchRes.salesorder_id) || ((_10 = searchRes === null || searchRes === void 0 ? void 0 : searchRes.salesorder) === null || _10 === void 0 ? void 0 : _10.salesorder_id);
                    if (resolvedSoId) {
                        referencedSoIds.add(resolvedSoId);
                    }
                    return [3 /*break*/, 39];
                case 38:
                    e_4 = _201.sent();
                    return [3 /*break*/, 39];
                case 39:
                    _l++;
                    return [3 /*break*/, 34];
                case 40:
                    refPOs = [];
                    _o = 0, referencedPoIds_1 = referencedPoIds;
                    _201.label = 41;
                case 41:
                    if (!(_o < referencedPoIds_1.length)) return [3 /*break*/, 46];
                    poId = referencedPoIds_1[_o];
                    _201.label = 42;
                case 42:
                    _201.trys.push([42, 44, , 45]);
                    return [4 /*yield*/, reader.getPurchaseOrder(orgId, poId)];
                case 43:
                    detail = _201.sent();
                    if (detail.purchaseorder)
                        refPOs.push(detail.purchaseorder);
                    return [3 /*break*/, 45];
                case 44:
                    e_5 = _201.sent();
                    failed++;
                    return [3 /*break*/, 45];
                case 45:
                    _o++;
                    return [3 /*break*/, 41];
                case 46:
                    refSOs = [];
                    _p = 0, referencedSoIds_1 = referencedSoIds;
                    _201.label = 47;
                case 47:
                    if (!(_p < referencedSoIds_1.length)) return [3 /*break*/, 52];
                    soId = referencedSoIds_1[_p];
                    _201.label = 48;
                case 48:
                    _201.trys.push([48, 50, , 51]);
                    return [4 /*yield*/, reader.getSalesOrder(orgId, soId)];
                case 49:
                    detail = _201.sent();
                    if (detail.salesorder)
                        refSOs.push(detail.salesorder);
                    return [3 /*break*/, 51];
                case 50:
                    e_6 = _201.sent();
                    failed++;
                    return [3 /*break*/, 51];
                case 51:
                    _p++;
                    return [3 /*break*/, 47];
                case 52:
                    seenDocIds = new Set();
                    docsToInsert = [];
                    docsToUpdate = [];
                    unchanged = 0;
                    // Process POs
                    for (_q = 0, pendingPOs_2 = pendingPOs; _q < pendingPOs_2.length; _q++) {
                        _r = pendingPOs_2[_q], row = _r.row, po = _r.po;
                        docId = po.purchaseorder_id || row.purchaseorder_id;
                        if (seenDocIds.has(docId))
                            continue;
                        seenDocIds.add(docId);
                        existing = db.prepare("\n      SELECT * FROM audit_zoho_purchase_orders\n      WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ? AND source_run_id = ?\n      ORDER BY fetched_at DESC LIMIT 1\n    ").get(orgId, docId, source_run_id);
                        if (!existing) {
                            docsToInsert.push({ type: "PO", data: po, lines: po.line_items || [] });
                            continue;
                        }
                        existingLines = db.prepare("\n      SELECT * FROM audit_zoho_purchase_order_lines\n      WHERE purchaseorder_id = ? AND source_run_id = ?\n      ORDER BY rowid ASC\n    ").all(docId, source_run_id);
                        incomingLines = po.line_items || [];
                        customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
                        deliveryCustomer = po.delivery_customer_name || null;
                        oldRef = extractSoRefFromCustomFieldsJson(existing.custom_fields_json);
                        newRef = extractSoRefFromPo(po).soRefNumber;
                        referenceChanged = (oldRef !== newRef);
                        headerChanged = (String((_11 = existing.status) !== null && _11 !== void 0 ? _11 : "").toLowerCase() !== String((_13 = (_12 = po.status) !== null && _12 !== void 0 ? _12 : row.status) !== null && _13 !== void 0 ? _13 : "").toLowerCase() ||
                            String((_14 = existing.date) !== null && _14 !== void 0 ? _14 : "") !== String((_16 = (_15 = po.date) !== null && _15 !== void 0 ? _15 : row.date) !== null && _16 !== void 0 ? _16 : "") ||
                            String((_17 = existing.delivery_date) !== null && _17 !== void 0 ? _17 : "") !== String((_18 = po.delivery_date) !== null && _18 !== void 0 ? _18 : "") ||
                            Number((_19 = existing.total) !== null && _19 !== void 0 ? _19 : 0) !== Number((_21 = (_20 = po.total) !== null && _20 !== void 0 ? _20 : row.total) !== null && _21 !== void 0 ? _21 : 0) ||
                            String((_22 = existing.vendor_id) !== null && _22 !== void 0 ? _22 : "") !== String((_24 = (_23 = po.vendor_id) !== null && _23 !== void 0 ? _23 : row.vendor_id) !== null && _24 !== void 0 ? _24 : "") ||
                            String((_25 = existing.vendor_name) !== null && _25 !== void 0 ? _25 : "") !== String((_27 = (_26 = po.vendor_name) !== null && _26 !== void 0 ? _26 : row.vendor_name) !== null && _27 !== void 0 ? _27 : "") ||
                            String((_28 = existing.delivery_customer_name) !== null && _28 !== void 0 ? _28 : "") !== String(deliveryCustomer !== null && deliveryCustomer !== void 0 ? deliveryCustomer : "") ||
                            String((_29 = existing.submitter_id) !== null && _29 !== void 0 ? _29 : "") !== String((_30 = po.submitter_id) !== null && _30 !== void 0 ? _30 : "") ||
                            String((_31 = existing.submitted_by_name) !== null && _31 !== void 0 ? _31 : "") !== String((_32 = po.submitted_by_name) !== null && _32 !== void 0 ? _32 : "") ||
                            String((_33 = existing.custom_fields_json) !== null && _33 !== void 0 ? _33 : "") !== String(customFieldsJson !== null && customFieldsJson !== void 0 ? customFieldsJson : ""));
                        linesChanged = false;
                        if (existingLines.length !== incomingLines.length) {
                            linesChanged = true;
                        }
                        else {
                            for (i = 0; i < existingLines.length; i++) {
                                el = existingLines[i];
                                il = incomingLines[i];
                                if (String((_34 = el.item_id) !== null && _34 !== void 0 ? _34 : "") !== String((_35 = il.item_id) !== null && _35 !== void 0 ? _35 : "") ||
                                    String((_36 = el.item_name) !== null && _36 !== void 0 ? _36 : "") !== String((_37 = il.name) !== null && _37 !== void 0 ? _37 : "") ||
                                    normalizeNarration(el.description) !== normalizeNarration(il.description) ||
                                    String((_38 = el.sku) !== null && _38 !== void 0 ? _38 : "") !== String((_39 = il.sku) !== null && _39 !== void 0 ? _39 : "") ||
                                    Number((_40 = el.quantity) !== null && _40 !== void 0 ? _40 : 0) !== Number((_41 = il.quantity) !== null && _41 !== void 0 ? _41 : 0) ||
                                    Number((_42 = el.rate) !== null && _42 !== void 0 ? _42 : 0) !== Number((_43 = il.rate) !== null && _43 !== void 0 ? _43 : 0) ||
                                    Number((_44 = el.amount) !== null && _44 !== void 0 ? _44 : 0) !== Number((_45 = il.item_total) !== null && _45 !== void 0 ? _45 : 0)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        if (referenceChanged || headerChanged || linesChanged) {
                            docsToUpdate.push({ type: "PO", data: po, lines: incomingLines });
                        }
                        else {
                            unchanged++;
                        }
                    }
                    // Process Bills
                    for (_s = 0, pendingBills_2 = pendingBills; _s < pendingBills_2.length; _s++) {
                        _t = pendingBills_2[_s], row = _t.row, bill = _t.bill;
                        docId = bill.bill_id || row.bill_id;
                        if (seenDocIds.has(docId))
                            continue;
                        seenDocIds.add(docId);
                        existing = db.prepare("\n      SELECT * FROM audit_zoho_bills\n      WHERE (organization_id = ? OR organization_id = '') AND bill_id = ? AND source_run_id = ?\n      ORDER BY fetched_at DESC LIMIT 1\n    ").get(orgId, docId, source_run_id);
                        if (!existing) {
                            docsToInsert.push({ type: "BILL", data: bill, lines: bill.line_items || [] });
                            continue;
                        }
                        existingLines = db.prepare("\n      SELECT * FROM audit_zoho_bill_lines\n      WHERE bill_id = ? AND source_run_id = ?\n      ORDER BY rowid ASC\n    ").all(docId, source_run_id);
                        incomingLines = bill.line_items || [];
                        customFieldsJson = bill.custom_fields ? JSON.stringify(bill.custom_fields) : null;
                        oldRef = existing.purchaseorder_id || null;
                        newRef = bill.purchaseorder_id || null;
                        referenceChanged = (oldRef !== newRef);
                        headerChanged = (String((_46 = existing.status) !== null && _46 !== void 0 ? _46 : "").toLowerCase() !== String((_48 = (_47 = bill.status) !== null && _47 !== void 0 ? _47 : row.status) !== null && _48 !== void 0 ? _48 : "").toLowerCase() ||
                            String((_49 = existing.date) !== null && _49 !== void 0 ? _49 : "") !== String((_51 = (_50 = bill.date) !== null && _50 !== void 0 ? _50 : row.date) !== null && _51 !== void 0 ? _51 : "") ||
                            String((_52 = existing.due_date) !== null && _52 !== void 0 ? _52 : "") !== String((_53 = bill.due_date) !== null && _53 !== void 0 ? _53 : "") ||
                            Number((_54 = existing.total) !== null && _54 !== void 0 ? _54 : 0) !== Number((_56 = (_55 = bill.total) !== null && _55 !== void 0 ? _55 : row.total) !== null && _56 !== void 0 ? _56 : 0) ||
                            Number((_57 = existing.balance) !== null && _57 !== void 0 ? _57 : 0) !== Number((_59 = (_58 = bill.balance) !== null && _58 !== void 0 ? _58 : row.balance) !== null && _59 !== void 0 ? _59 : 0) ||
                            String((_60 = existing.vendor_id) !== null && _60 !== void 0 ? _60 : "") !== String((_62 = (_61 = bill.vendor_id) !== null && _61 !== void 0 ? _61 : row.vendor_id) !== null && _62 !== void 0 ? _62 : "") ||
                            String((_63 = existing.vendor_name) !== null && _63 !== void 0 ? _63 : "") !== String((_65 = (_64 = bill.vendor_name) !== null && _64 !== void 0 ? _64 : row.vendor_name) !== null && _65 !== void 0 ? _65 : "") ||
                            String((_66 = existing.purchaseorder_id) !== null && _66 !== void 0 ? _66 : "") !== String((_67 = bill.purchaseorder_id) !== null && _67 !== void 0 ? _67 : "") ||
                            String((_68 = existing.submitter_id) !== null && _68 !== void 0 ? _68 : "") !== String((_69 = bill.submitter_id) !== null && _69 !== void 0 ? _69 : "") ||
                            String((_70 = existing.submitted_by_name) !== null && _70 !== void 0 ? _70 : "") !== String((_71 = bill.submitted_by_name) !== null && _71 !== void 0 ? _71 : "") ||
                            String((_72 = existing.custom_fields_json) !== null && _72 !== void 0 ? _72 : "") !== String(customFieldsJson !== null && customFieldsJson !== void 0 ? customFieldsJson : ""));
                        linesChanged = false;
                        if (existingLines.length !== incomingLines.length) {
                            linesChanged = true;
                        }
                        else {
                            for (i = 0; i < existingLines.length; i++) {
                                el = existingLines[i];
                                il = incomingLines[i];
                                if (String((_73 = el.item_id) !== null && _73 !== void 0 ? _73 : "") !== String((_74 = il.item_id) !== null && _74 !== void 0 ? _74 : "") ||
                                    String((_75 = el.item_name) !== null && _75 !== void 0 ? _75 : "") !== String((_76 = il.name) !== null && _76 !== void 0 ? _76 : "") ||
                                    normalizeNarration(el.description) !== normalizeNarration(il.description) ||
                                    Number((_77 = el.quantity) !== null && _77 !== void 0 ? _77 : 0) !== Number((_78 = il.quantity) !== null && _78 !== void 0 ? _78 : 0) ||
                                    Number((_79 = el.rate) !== null && _79 !== void 0 ? _79 : 0) !== Number((_80 = il.rate) !== null && _80 !== void 0 ? _80 : 0) ||
                                    Number((_81 = el.amount) !== null && _81 !== void 0 ? _81 : 0) !== Number((_82 = il.item_total) !== null && _82 !== void 0 ? _82 : 0)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        if (referenceChanged || headerChanged || linesChanged) {
                            docsToUpdate.push({ type: "BILL", data: bill, lines: incomingLines });
                        }
                        else {
                            unchanged++;
                        }
                    }
                    // Process Invoices
                    for (_u = 0, pendingInvoices_2 = pendingInvoices; _u < pendingInvoices_2.length; _u++) {
                        _v = pendingInvoices_2[_u], row = _v.row, inv = _v.inv;
                        docId = inv.invoice_id || row.invoice_id;
                        if (seenDocIds.has(docId))
                            continue;
                        seenDocIds.add(docId);
                        existing = db.prepare("\n      SELECT * FROM audit_zoho_invoices\n      WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ? AND source_run_id = ?\n      ORDER BY fetched_at DESC LIMIT 1\n    ").get(orgId, docId, source_run_id);
                        if (!existing) {
                            docsToInsert.push({ type: "INVOICE", data: inv, lines: inv.line_items || [] });
                            continue;
                        }
                        existingLines = db.prepare("\n      SELECT * FROM audit_zoho_invoice_lines\n      WHERE invoice_id = ? AND source_run_id = ?\n      ORDER BY rowid ASC\n    ").all(docId, source_run_id);
                        incomingLines = inv.line_items || [];
                        customFieldsJson = inv.custom_fields ? JSON.stringify(inv.custom_fields) : null;
                        deliveryCustomer = ((_83 = inv.shipping_address) === null || _83 === void 0 ? void 0 : _83.customer_name) || inv.customer_name || null;
                        oldRef = existing.salesorder_id || null;
                        newRef = inv.salesorder_id || null;
                        referenceChanged = (oldRef !== newRef);
                        headerChanged = (String((_84 = existing.status) !== null && _84 !== void 0 ? _84 : "").toLowerCase() !== String((_86 = (_85 = inv.status) !== null && _85 !== void 0 ? _85 : row.status) !== null && _86 !== void 0 ? _86 : "").toLowerCase() ||
                            String((_87 = existing.date) !== null && _87 !== void 0 ? _87 : "") !== String((_89 = (_88 = inv.date) !== null && _88 !== void 0 ? _88 : row.date) !== null && _89 !== void 0 ? _89 : "") ||
                            String((_90 = existing.due_date) !== null && _90 !== void 0 ? _90 : "") !== String((_91 = inv.due_date) !== null && _91 !== void 0 ? _91 : "") ||
                            Number((_92 = existing.total) !== null && _92 !== void 0 ? _92 : 0) !== Number((_94 = (_93 = inv.total) !== null && _93 !== void 0 ? _93 : row.total) !== null && _94 !== void 0 ? _94 : 0) ||
                            Number((_95 = existing.balance) !== null && _95 !== void 0 ? _95 : 0) !== Number((_97 = (_96 = inv.balance) !== null && _96 !== void 0 ? _96 : row.balance) !== null && _97 !== void 0 ? _97 : 0) ||
                            String((_98 = existing.customer_id) !== null && _98 !== void 0 ? _98 : "") !== String((_100 = (_99 = inv.customer_id) !== null && _99 !== void 0 ? _99 : row.customer_id) !== null && _100 !== void 0 ? _100 : "") ||
                            String((_101 = existing.salesorder_id) !== null && _101 !== void 0 ? _101 : "") !== String((_102 = inv.salesorder_id) !== null && _102 !== void 0 ? _102 : "") ||
                            String((_103 = existing.delivery_customer_name) !== null && _103 !== void 0 ? _103 : "") !== String(deliveryCustomer !== null && deliveryCustomer !== void 0 ? deliveryCustomer : "") ||
                            String((_104 = existing.submitter_id) !== null && _104 !== void 0 ? _104 : "") !== String((_105 = inv.submitter_id) !== null && _105 !== void 0 ? _105 : "") ||
                            String((_106 = existing.submitted_by_name) !== null && _106 !== void 0 ? _106 : "") !== String((_107 = inv.submitted_by_name) !== null && _107 !== void 0 ? _107 : "") ||
                            String((_108 = existing.custom_fields_json) !== null && _108 !== void 0 ? _108 : "") !== String(customFieldsJson !== null && customFieldsJson !== void 0 ? customFieldsJson : ""));
                        linesChanged = false;
                        if (existingLines.length !== incomingLines.length) {
                            linesChanged = true;
                        }
                        else {
                            for (i = 0; i < existingLines.length; i++) {
                                el = existingLines[i];
                                il = incomingLines[i];
                                if (String((_109 = el.item_id) !== null && _109 !== void 0 ? _109 : "") !== String((_110 = il.item_id) !== null && _110 !== void 0 ? _110 : "") ||
                                    String((_111 = el.item_name) !== null && _111 !== void 0 ? _111 : "") !== String((_112 = il.name) !== null && _112 !== void 0 ? _112 : "") ||
                                    normalizeNarration(el.description) !== normalizeNarration(il.description) ||
                                    Number((_113 = el.quantity) !== null && _113 !== void 0 ? _113 : 0) !== Number((_114 = il.quantity) !== null && _114 !== void 0 ? _114 : 0) ||
                                    Number((_115 = el.rate) !== null && _115 !== void 0 ? _115 : 0) !== Number((_116 = il.rate) !== null && _116 !== void 0 ? _116 : 0) ||
                                    Number((_117 = el.amount) !== null && _117 !== void 0 ? _117 : 0) !== Number((_118 = il.item_total) !== null && _118 !== void 0 ? _118 : 0)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        if (referenceChanged || headerChanged || linesChanged) {
                            docsToUpdate.push({ type: "INVOICE", data: inv, lines: incomingLines });
                        }
                        else {
                            unchanged++;
                        }
                    }
                    // Process Referenced POs
                    for (_w = 0, refPOs_1 = refPOs; _w < refPOs_1.length; _w++) {
                        po = refPOs_1[_w];
                        if (seenDocIds.has(po.purchaseorder_id))
                            continue;
                        seenDocIds.add(po.purchaseorder_id);
                        existing = db.prepare("\n      SELECT * FROM audit_zoho_purchase_orders\n      WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ? AND source_run_id = ?\n      ORDER BY fetched_at DESC LIMIT 1\n    ").get(orgId, po.purchaseorder_id, source_run_id);
                        if (!existing) {
                            docsToInsert.push({ type: "PO", data: po, lines: po.line_items || [] });
                            continue;
                        }
                        existingLines = db.prepare("\n      SELECT * FROM audit_zoho_purchase_order_lines\n      WHERE purchaseorder_id = ? AND source_run_id = ?\n      ORDER BY rowid ASC\n    ").all(po.purchaseorder_id, source_run_id);
                        incomingLines = po.line_items || [];
                        linesChanged = existingLines.length !== incomingLines.length;
                        if (!linesChanged) {
                            for (i = 0; i < existingLines.length; i++) {
                                el = existingLines[i];
                                il = incomingLines[i];
                                if (String((_119 = el.item_id) !== null && _119 !== void 0 ? _119 : "") !== String((_120 = il.item_id) !== null && _120 !== void 0 ? _120 : "") ||
                                    Number((_121 = el.quantity) !== null && _121 !== void 0 ? _121 : 0) !== Number((_122 = il.quantity) !== null && _122 !== void 0 ? _122 : 0) ||
                                    Number((_123 = el.rate) !== null && _123 !== void 0 ? _123 : 0) !== Number((_124 = il.rate) !== null && _124 !== void 0 ? _124 : 0) ||
                                    normalizeNarration(el.description) !== normalizeNarration(il.description)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        if (linesChanged || String((_125 = existing.status) !== null && _125 !== void 0 ? _125 : "") !== String((_126 = po.status) !== null && _126 !== void 0 ? _126 : "")) {
                            docsToUpdate.push({ type: "PO", data: po, lines: incomingLines });
                        }
                        else {
                            unchanged++;
                        }
                    }
                    // Process Referenced SOs
                    for (_x = 0, refSOs_1 = refSOs; _x < refSOs_1.length; _x++) {
                        so = refSOs_1[_x];
                        if (seenDocIds.has(so.salesorder_id))
                            continue;
                        seenDocIds.add(so.salesorder_id);
                        existing = db.prepare("\n      SELECT * FROM audit_zoho_sales_orders\n      WHERE (organization_id = ? OR organization_id = '') AND salesorder_id = ? AND source_run_id = ?\n      ORDER BY fetched_at DESC LIMIT 1\n    ").get(orgId, so.salesorder_id, source_run_id);
                        if (!existing) {
                            docsToInsert.push({ type: "SO", data: so, lines: so.line_items || [] });
                            continue;
                        }
                        existingLines = db.prepare("\n      SELECT * FROM audit_zoho_sales_order_lines\n      WHERE salesorder_id = ? AND source_run_id = ?\n      ORDER BY rowid ASC\n    ").all(so.salesorder_id, source_run_id);
                        incomingLines = so.line_items || [];
                        linesChanged = existingLines.length !== incomingLines.length;
                        if (!linesChanged) {
                            for (i = 0; i < existingLines.length; i++) {
                                el = existingLines[i];
                                il = incomingLines[i];
                                if (String((_127 = el.item_id) !== null && _127 !== void 0 ? _127 : "") !== String((_128 = il.item_id) !== null && _128 !== void 0 ? _128 : "") ||
                                    Number((_129 = el.quantity) !== null && _129 !== void 0 ? _129 : 0) !== Number((_130 = il.quantity) !== null && _130 !== void 0 ? _130 : 0) ||
                                    Number((_131 = el.rate) !== null && _131 !== void 0 ? _131 : 0) !== Number((_132 = il.rate) !== null && _132 !== void 0 ? _132 : 0) ||
                                    normalizeNarration(el.description) !== normalizeNarration(il.description)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        if (linesChanged || String((_133 = existing.status) !== null && _133 !== void 0 ? _133 : "") !== String((_134 = so.status) !== null && _134 !== void 0 ? _134 : "")) {
                            docsToUpdate.push({ type: "SO", data: so, lines: incomingLines });
                        }
                        else {
                            unchanged++;
                        }
                    }
                    // Process documents leaving pending approval status
                    for (_y = 0, poStatusUpdates_1 = poStatusUpdates; _y < poStatusUpdates_1.length; _y++) {
                        update = poStatusUpdates_1[_y];
                        if (!seenDocIds.has(update.id)) {
                            seenDocIds.add(update.id);
                            db.prepare("\n        UPDATE audit_zoho_purchase_orders SET status = ?, fetched_at = ?\n        WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ? AND source_run_id = ?\n      ").run(update.status, fetchedAt, orgId, update.id, source_run_id);
                            docsToUpdate.push({ type: "PO", data: { purchaseorder_id: update.id, status: update.status }, lines: [] });
                        }
                    }
                    for (_z = 0, billStatusUpdates_1 = billStatusUpdates; _z < billStatusUpdates_1.length; _z++) {
                        update = billStatusUpdates_1[_z];
                        if (!seenDocIds.has(update.id)) {
                            seenDocIds.add(update.id);
                            db.prepare("\n        UPDATE audit_zoho_bills SET status = ?, fetched_at = ?\n        WHERE (organization_id = ? OR organization_id = '') AND bill_id = ? AND source_run_id = ?\n      ").run(update.status, fetchedAt, orgId, update.id, source_run_id);
                            docsToUpdate.push({ type: "BILL", data: { bill_id: update.id, status: update.status }, lines: [] });
                        }
                    }
                    for (_0 = 0, invoiceStatusUpdates_1 = invoiceStatusUpdates; _0 < invoiceStatusUpdates_1.length; _0++) {
                        update = invoiceStatusUpdates_1[_0];
                        if (!seenDocIds.has(update.id)) {
                            seenDocIds.add(update.id);
                            db.prepare("\n        UPDATE audit_zoho_invoices SET status = ?, fetched_at = ?\n        WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ? AND source_run_id = ?\n      ").run(update.status, fetchedAt, orgId, update.id, source_run_id);
                            docsToUpdate.push({ type: "INVOICE", data: { invoice_id: update.id, status: update.status }, lines: [] });
                        }
                    }
                    docsToWrite = __spreadArray(__spreadArray([], docsToInsert, true), docsToUpdate.filter(function (d) { return d.lines.length > 0; }), true);
                    if (docsToWrite.length > 0 || docsToInsert.length > 0) {
                        db.exec("BEGIN IMMEDIATE TRANSACTION");
                        try {
                            // 1. Source run upsert
                            db.prepare("\n        INSERT INTO audit_zoho_source_runs (\n          source_run_id, organization_id, source_type, started_at, completed_at,\n          status, api_domain, records_seen, records_written\n        ) VALUES (?, ?, 'approval_pending_sync', ?, ?, 'SUCCESS', ?, ?, ?)\n        ON CONFLICT(source_run_id) DO UPDATE SET\n          completed_at=excluded.completed_at,\n          records_seen=excluded.records_seen,\n          records_written=excluded.records_written\n      ").run(source_run_id, orgId, fetchedAt, fetchedAt, apiDomain, seenDocIds.size, docsToInsert.length + docsToUpdate.length);
                            // 2. Persist documents
                            for (_1 = 0, docsToWrite_1 = docsToWrite; _1 < docsToWrite_1.length; _1++) {
                                item = docsToWrite_1[_1];
                                if (item.type === "PO") {
                                    po = item.data;
                                    customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
                                    deliveryCustomerName = po.delivery_customer_name || null;
                                    db.prepare("\n            INSERT INTO audit_zoho_purchase_orders (\n              organization_id, purchaseorder_id, source_run_id, purchaseorder_number,\n              vendor_id, vendor_name, delivery_customer_name, date, delivery_date,\n              status, currency, total, custom_fields_json, source_endpoint, fetched_at,\n              submitter_id, submitted_by_name\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET\n              purchaseorder_number=excluded.purchaseorder_number,\n              vendor_id=excluded.vendor_id,\n              vendor_name=excluded.vendor_name,\n              delivery_customer_name=excluded.delivery_customer_name,\n              date=excluded.date,\n              delivery_date=excluded.delivery_date,\n              status=excluded.status,\n              currency=excluded.currency,\n              total=excluded.total,\n              custom_fields_json=excluded.custom_fields_json,\n              fetched_at=excluded.fetched_at,\n              submitter_id=excluded.submitter_id,\n              submitted_by_name=excluded.submitted_by_name\n          ").run(orgId, po.purchaseorder_id, source_run_id, (_135 = po.purchaseorder_number) !== null && _135 !== void 0 ? _135 : null, (_136 = po.vendor_id) !== null && _136 !== void 0 ? _136 : null, (_137 = po.vendor_name) !== null && _137 !== void 0 ? _137 : null, deliveryCustomerName, (_138 = po.date) !== null && _138 !== void 0 ? _138 : null, (_139 = po.delivery_date) !== null && _139 !== void 0 ? _139 : null, (_140 = po.status) !== null && _140 !== void 0 ? _140 : null, (_141 = po.currency) !== null && _141 !== void 0 ? _141 : null, (_142 = po.total) !== null && _142 !== void 0 ? _142 : null, customFieldsJson, "/books/v3/purchaseorders", fetchedAt, (_143 = po.submitter_id) !== null && _143 !== void 0 ? _143 : null, (_144 = po.submitted_by_name) !== null && _144 !== void 0 ? _144 : null);
                                    // Atomic line replacement to prevent ghost lines
                                    db.prepare("\n            DELETE FROM audit_zoho_purchase_order_lines\n            WHERE organization_id = ? AND purchaseorder_id = ? AND source_run_id = ?\n          ").run(orgId, po.purchaseorder_id, source_run_id);
                                    for (_2 = 0, _3 = item.lines; _2 < _3.length; _2++) {
                                        line = _3[_2];
                                        db.prepare("\n              INSERT INTO audit_zoho_purchase_order_lines (\n                organization_id, line_item_id, purchaseorder_id, source_run_id,\n                item_id, item_name, description, sku, quantity, rate, amount\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ").run(orgId, line.line_item_id || ("po_line_" + crypto_1.default.randomUUID()), po.purchaseorder_id, source_run_id, (_145 = line.item_id) !== null && _145 !== void 0 ? _145 : null, (_146 = line.name) !== null && _146 !== void 0 ? _146 : null, resolveDescState(line.description), (_147 = line.sku) !== null && _147 !== void 0 ? _147 : null, (_148 = line.quantity) !== null && _148 !== void 0 ? _148 : null, (_149 = line.rate) !== null && _149 !== void 0 ? _149 : null, (_150 = line.item_total) !== null && _150 !== void 0 ? _150 : null);
                                    }
                                }
                                else if (item.type === "BILL") {
                                    bill = item.data;
                                    customFieldsJson = bill.custom_fields ? JSON.stringify(bill.custom_fields) : null;
                                    db.prepare("\n            INSERT INTO audit_zoho_bills (\n              organization_id, bill_id, source_run_id, bill_number,\n              vendor_id, vendor_name, purchaseorder_id, date, due_date,\n              status, currency, total, balance, custom_fields_json,\n              source_endpoint, fetched_at, submitter_id, submitted_by_name\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, bill_id, source_run_id) DO UPDATE SET\n              bill_number=excluded.bill_number,\n              vendor_id=excluded.vendor_id,\n              vendor_name=excluded.vendor_name,\n              purchaseorder_id=excluded.purchaseorder_id,\n              date=excluded.date,\n              due_date=excluded.due_date,\n              status=excluded.status,\n              currency=excluded.currency,\n              total=excluded.total,\n              balance=excluded.balance,\n              custom_fields_json=excluded.custom_fields_json,\n              fetched_at=excluded.fetched_at,\n              submitter_id=excluded.submitter_id,\n              submitted_by_name=excluded.submitted_by_name\n          ").run(orgId, bill.bill_id, source_run_id, (_151 = bill.bill_number) !== null && _151 !== void 0 ? _151 : null, (_152 = bill.vendor_id) !== null && _152 !== void 0 ? _152 : null, (_153 = bill.vendor_name) !== null && _153 !== void 0 ? _153 : null, (_154 = bill.purchaseorder_id) !== null && _154 !== void 0 ? _154 : null, (_155 = bill.date) !== null && _155 !== void 0 ? _155 : null, (_156 = bill.due_date) !== null && _156 !== void 0 ? _156 : null, (_157 = bill.status) !== null && _157 !== void 0 ? _157 : null, (_159 = (_158 = bill.currency_code) !== null && _158 !== void 0 ? _158 : bill.currency) !== null && _159 !== void 0 ? _159 : null, (_160 = bill.total) !== null && _160 !== void 0 ? _160 : null, (_161 = bill.balance) !== null && _161 !== void 0 ? _161 : null, customFieldsJson, "/books/v3/bills", fetchedAt, (_162 = bill.submitter_id) !== null && _162 !== void 0 ? _162 : null, (_163 = bill.submitted_by_name) !== null && _163 !== void 0 ? _163 : null);
                                    db.prepare("\n            DELETE FROM audit_zoho_bill_lines\n            WHERE organization_id = ? AND bill_id = ? AND source_run_id = ?\n          ").run(orgId, bill.bill_id, source_run_id);
                                    for (_4 = 0, _5 = item.lines; _4 < _5.length; _4++) {
                                        line = _5[_4];
                                        db.prepare("\n              INSERT INTO audit_zoho_bill_lines (\n                organization_id, line_item_id, bill_id, source_run_id,\n                item_id, item_name, description, quantity, rate, amount\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ").run(orgId, line.line_item_id || ("bill_line_" + crypto_1.default.randomUUID()), bill.bill_id, source_run_id, (_164 = line.item_id) !== null && _164 !== void 0 ? _164 : null, (_165 = line.name) !== null && _165 !== void 0 ? _165 : null, resolveDescState(line.description), (_166 = line.quantity) !== null && _166 !== void 0 ? _166 : null, (_167 = line.rate) !== null && _167 !== void 0 ? _167 : null, (_168 = line.item_total) !== null && _168 !== void 0 ? _168 : null);
                                    }
                                }
                                else if (item.type === "INVOICE") {
                                    inv = item.data;
                                    customFieldsJson = inv.custom_fields ? JSON.stringify(inv.custom_fields) : null;
                                    deliveryCustomerName = ((_169 = inv.shipping_address) === null || _169 === void 0 ? void 0 : _169.customer_name) || inv.customer_name || null;
                                    db.prepare("\n            INSERT INTO audit_zoho_invoices (\n              organization_id, invoice_id, source_run_id, invoice_number,\n              customer_id, delivery_customer_name, salesorder_id, date, due_date,\n              status, total, balance, currency_code, custom_fields_json,\n              source_endpoint, fetched_at, submitter_id, submitted_by_name\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, invoice_id, source_run_id) DO UPDATE SET\n              invoice_number=excluded.invoice_number,\n              customer_id=excluded.customer_id,\n              delivery_customer_name=excluded.delivery_customer_name,\n              salesorder_id=excluded.salesorder_id,\n              date=excluded.date,\n              due_date=excluded.due_date,\n              status=excluded.status,\n              total=excluded.total,\n              balance=excluded.balance,\n              currency_code=excluded.currency_code,\n              custom_fields_json=excluded.custom_fields_json,\n              fetched_at=excluded.fetched_at,\n              submitter_id=excluded.submitter_id,\n              submitted_by_name=excluded.submitted_by_name\n          ").run(orgId, inv.invoice_id, source_run_id, (_170 = inv.invoice_number) !== null && _170 !== void 0 ? _170 : null, (_171 = inv.customer_id) !== null && _171 !== void 0 ? _171 : null, deliveryCustomerName, (_172 = inv.salesorder_id) !== null && _172 !== void 0 ? _172 : null, (_173 = inv.date) !== null && _173 !== void 0 ? _173 : null, (_174 = inv.due_date) !== null && _174 !== void 0 ? _174 : null, (_175 = inv.status) !== null && _175 !== void 0 ? _175 : null, (_176 = inv.total) !== null && _176 !== void 0 ? _176 : null, (_177 = inv.balance) !== null && _177 !== void 0 ? _177 : null, (_178 = inv.currency_code) !== null && _178 !== void 0 ? _178 : null, customFieldsJson, "/books/v3/invoices", fetchedAt, (_179 = inv.submitter_id) !== null && _179 !== void 0 ? _179 : null, (_180 = inv.submitted_by_name) !== null && _180 !== void 0 ? _180 : null);
                                    db.prepare("\n            DELETE FROM audit_zoho_invoice_lines\n            WHERE organization_id = ? AND invoice_id = ? AND source_run_id = ?\n          ").run(orgId, inv.invoice_id, source_run_id);
                                    for (_6 = 0, _7 = item.lines; _6 < _7.length; _6++) {
                                        line = _7[_6];
                                        db.prepare("\n              INSERT INTO audit_zoho_invoice_lines (\n                organization_id, line_item_id, invoice_id, source_run_id,\n                item_id, item_name, description, quantity, rate, amount\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ").run(orgId, line.line_item_id || ("inv_line_" + crypto_1.default.randomUUID()), inv.invoice_id, source_run_id, (_181 = line.item_id) !== null && _181 !== void 0 ? _181 : null, (_182 = line.name) !== null && _182 !== void 0 ? _182 : null, resolveDescState(line.description), (_183 = line.quantity) !== null && _183 !== void 0 ? _183 : null, (_184 = line.rate) !== null && _184 !== void 0 ? _184 : null, (_185 = line.item_total) !== null && _185 !== void 0 ? _185 : null);
                                    }
                                }
                                else if (item.type === "SO") {
                                    so = item.data;
                                    customFieldsJson = so.custom_fields ? JSON.stringify(so.custom_fields) : null;
                                    deliveryCustomerName = ((_186 = so.shipping_address) === null || _186 === void 0 ? void 0 : _186.customer_name) || so.customer_name || null;
                                    db.prepare("\n            INSERT INTO audit_zoho_sales_orders (\n              organization_id, salesorder_id, source_run_id, salesorder_number,\n              customer_id, customer_name, delivery_customer_name, date, shipment_date,\n              status, currency, total, custom_fields_json, source_endpoint, fetched_at\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, salesorder_id, source_run_id) DO UPDATE SET\n              salesorder_number=excluded.salesorder_number,\n              customer_id=excluded.customer_id,\n              customer_name=excluded.customer_name,\n              delivery_customer_name=excluded.delivery_customer_name,\n              date=excluded.date,\n              shipment_date=excluded.shipment_date,\n              status=excluded.status,\n              currency=excluded.currency,\n              total=excluded.total,\n              custom_fields_json=excluded.custom_fields_json,\n              fetched_at=excluded.fetched_at\n          ").run(orgId, so.salesorder_id, source_run_id, (_187 = so.salesorder_number) !== null && _187 !== void 0 ? _187 : null, (_188 = so.customer_id) !== null && _188 !== void 0 ? _188 : null, (_189 = so.customer_name) !== null && _189 !== void 0 ? _189 : null, deliveryCustomerName, (_190 = so.date) !== null && _190 !== void 0 ? _190 : null, (_191 = so.shipment_date) !== null && _191 !== void 0 ? _191 : null, (_192 = so.status) !== null && _192 !== void 0 ? _192 : null, (_193 = so.currency) !== null && _193 !== void 0 ? _193 : null, (_194 = so.total) !== null && _194 !== void 0 ? _194 : null, customFieldsJson, "/books/v3/salesorders", fetchedAt);
                                    db.prepare("\n            DELETE FROM audit_zoho_sales_order_lines\n            WHERE organization_id = ? AND salesorder_id = ? AND source_run_id = ?\n          ").run(orgId, so.salesorder_id, source_run_id);
                                    for (_8 = 0, _9 = item.lines; _8 < _9.length; _8++) {
                                        line = _9[_8];
                                        db.prepare("\n              INSERT INTO audit_zoho_sales_order_lines (\n                organization_id, line_item_id, salesorder_id, source_run_id,\n                item_id, item_name, description, sku, quantity, rate, amount\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ").run(orgId, line.line_item_id || ("so_line_" + crypto_1.default.randomUUID()), so.salesorder_id, source_run_id, (_195 = line.item_id) !== null && _195 !== void 0 ? _195 : null, (_196 = line.name) !== null && _196 !== void 0 ? _196 : null, resolveDescState(line.description), (_197 = line.sku) !== null && _197 !== void 0 ? _197 : null, (_198 = line.quantity) !== null && _198 !== void 0 ? _198 : null, (_199 = line.rate) !== null && _199 !== void 0 ? _199 : null, (_200 = line.item_total) !== null && _200 !== void 0 ? _200 : null);
                                    }
                                }
                            }
                            db.exec("COMMIT");
                        }
                        catch (e) {
                            db.exec("ROLLBACK");
                            throw e;
                        }
                    }
                    created = docsToInsert.length;
                    updated = docsToUpdate.length;
                    checked = created + updated + unchanged + failed;
                    return [2 /*return*/, { created: created, updated: updated, unchanged: unchanged, failed: failed, checked: checked }];
            }
        });
    });
}
function syncApprovalPendingDocument(targetDoc, options) {
    return __awaiter(this, void 0, void 0, function () {
        var completedAt, orgId, apiDomain, tokens, db, reader, docData, docLines, docNumber, result, referenceRefreshed, referenceDocumentRefreshed, refDocToPersist, detail, _a, newSoRefNumber, newSoRefId, newRefText, existingRow, existingLines, oldRefText, oldNormRef, newNormRef, headerChanged, linesChanged, i, el, nl, soDetail, e_10, soIdToFetch, localSo, normKey_1, allLocalSos, candidates, foundSo, resolvedId, e_11, soDetail, e_12, detail, existingRow, existingLines, oldPoId, newPoId, headerChanged, linesChanged, i, el, nl, poDetail, e_13, detail, existingRow, existingLines, oldSoId, newSoId, headerChanged, linesChanged, i, el, nl, soDetail, e_14, fetchedAt, source_run_id, customFieldsJson, deliveryCustomerName, _i, docLines_1, line, customFieldsJson, _b, docLines_2, line, customFieldsJson, deliveryCustomerName, _c, docLines_3, line, so, customFieldsJson, deliveryCustomerName, _d, _e, line, po, customFieldsJson, deliveryCustomerName, _f, _g, line, err_1;
        var _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45, _46, _47, _48, _49, _50, _51, _52, _53, _54, _55, _56, _57, _58, _59, _60, _61, _62, _63, _64, _65, _66;
        return __generator(this, function (_67) {
            switch (_67.label) {
                case 0:
                    completedAt = new Date().toISOString();
                    // 1. Validation
                    if (!targetDoc || !targetDoc.id || !["PO", "BILL", "INVOICE"].includes(targetDoc.type)) {
                        return [2 /*return*/, {
                                status: "FAILED",
                                documentType: (targetDoc === null || targetDoc === void 0 ? void 0 : targetDoc.type) || "PO",
                                documentId: (targetDoc === null || targetDoc === void 0 ? void 0 : targetDoc.id) || "",
                                documentNumber: targetDoc === null || targetDoc === void 0 ? void 0 : targetDoc.number,
                                result: "FAILED",
                                referenceRefreshed: false,
                                referenceDocumentRefreshed: false,
                                completedAt: completedAt,
                                error: "Invalid target document parameters"
                            }];
                    }
                    // Identifier sanitization check
                    if (!/^[a-zA-Z0-9_\-\.]+$/.test(targetDoc.id)) {
                        return [2 /*return*/, {
                                status: "FAILED",
                                documentType: targetDoc.type,
                                documentId: targetDoc.id,
                                documentNumber: targetDoc.number,
                                result: "FAILED",
                                referenceRefreshed: false,
                                referenceDocumentRefreshed: false,
                                completedAt: completedAt,
                                error: "Document identifier contains invalid characters"
                            }];
                    }
                    orgId = options === null || options === void 0 ? void 0 : options.orgId;
                    apiDomain = options === null || options === void 0 ? void 0 : options.apiDomain;
                    if (!(options === null || options === void 0 ? void 0 : options.reader)) {
                        tokens = (0, zoho_token_store_ts_1.readTokenStore)();
                        if (!tokens || !tokens.access_token) {
                            return [2 /*return*/, {
                                    status: "FAILED",
                                    documentType: targetDoc.type,
                                    documentId: targetDoc.id,
                                    documentNumber: targetDoc.number,
                                    result: "FAILED",
                                    referenceRefreshed: false,
                                    referenceDocumentRefreshed: false,
                                    completedAt: completedAt,
                                    error: "Zoho not connected"
                                }];
                        }
                        orgId = orgId || tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "774390949";
                        apiDomain = apiDomain || tokens.api_domain || "https://www.zohoapis.com";
                    }
                    else {
                        orgId = orgId || "TEST_ORG";
                        apiDomain = apiDomain || "https://test.zohoapis.com";
                    }
                    db = (options === null || options === void 0 ? void 0 : options.db) || (0, audit_database_ts_1.getAuditDatabase)();
                    reader = (options === null || options === void 0 ? void 0 : options.reader) || {
                        listPurchaseOrders: zoho_read_transactions_ts_1.listPurchaseOrders,
                        getPurchaseOrder: zoho_read_transactions_ts_1.getPurchaseOrder,
                        listBills: zoho_read_transactions_ts_1.listBills,
                        getBill: zoho_read_transactions_ts_1.getBill,
                        listInvoices: zoho_read_transactions_ts_1.listInvoices,
                        getInvoice: zoho_read_transactions_ts_1.getInvoice,
                        listSalesOrders: zoho_read_transactions_ts_1.listSalesOrders,
                        getSalesOrder: zoho_read_transactions_ts_1.getSalesOrder,
                        getSalesOrderByNumber: zoho_read_transactions_ts_1.getSalesOrderByNumber,
                    };
                    _67.label = 1;
                case 1:
                    _67.trys.push([1, 28, , 29]);
                    docData = null;
                    docLines = [];
                    docNumber = targetDoc.number || "";
                    result = "UNCHANGED";
                    referenceRefreshed = false;
                    referenceDocumentRefreshed = false;
                    refDocToPersist = null;
                    if (!(targetDoc.type === "PO")) return [3 /*break*/, 16];
                    return [4 /*yield*/, reader.getPurchaseOrder(orgId, targetDoc.id)];
                case 2:
                    detail = _67.sent();
                    docData = detail === null || detail === void 0 ? void 0 : detail.purchaseorder;
                    if (!docData) {
                        return [2 /*return*/, {
                                status: "FAILED",
                                documentType: "PO",
                                documentId: targetDoc.id,
                                documentNumber: targetDoc.number,
                                result: "FAILED",
                                referenceRefreshed: false,
                                referenceDocumentRefreshed: false,
                                completedAt: new Date().toISOString(),
                                error: "Purchase order ".concat(targetDoc.id, " not found in Zoho")
                            }];
                    }
                    docLines = docData.line_items || [];
                    docNumber = docData.purchaseorder_number || docNumber;
                    _a = extractSoRefFromPo(docData), newSoRefNumber = _a.soRefNumber, newSoRefId = _a.soRefId;
                    newRefText = newSoRefNumber || docData.reference_number || null;
                    existingRow = db.prepare("\n        SELECT * FROM audit_zoho_purchase_orders\n        WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ?\n        ORDER BY fetched_at DESC LIMIT 1\n      ").get(orgId, targetDoc.id);
                    existingLines = db.prepare("\n        SELECT * FROM audit_zoho_purchase_order_lines\n        WHERE (organization_id = ? OR organization_id = '') AND purchaseorder_id = ?\n        ORDER BY line_item_id\n      ").all(orgId, targetDoc.id);
                    oldRefText = existingRow ? (extractSoRefFromCustomFieldsJson(existingRow.custom_fields_json) || existingRow.purchaseorder_number || null) : null;
                    if (!existingRow) {
                        result = "NEW";
                        referenceRefreshed = Boolean(newRefText);
                    }
                    else {
                        oldNormRef = (oldRefText || "").trim().toUpperCase();
                        newNormRef = (newRefText || "").trim().toUpperCase();
                        referenceRefreshed = oldNormRef !== newNormRef;
                        headerChanged = false;
                        if ((existingRow.status || null) !== (docData.status || null))
                            headerChanged = true;
                        if ((existingRow.date || null) !== (docData.date || null))
                            headerChanged = true;
                        if ((existingRow.vendor_id || null) !== (docData.vendor_id || null))
                            headerChanged = true;
                        if (Math.abs((existingRow.total || 0) - (docData.total || 0)) > 0.001)
                            headerChanged = true;
                        if ((existingRow.submitted_by_name || null) !== (docData.submitted_by_name || null))
                            headerChanged = true;
                        if ((existingRow.submitter_id || null) !== (docData.submitter_id || null))
                            headerChanged = true;
                        if (referenceRefreshed)
                            headerChanged = true; // Reference change MUST trigger UPDATED!
                        linesChanged = false;
                        if (existingLines.length !== docLines.length) {
                            linesChanged = true;
                        }
                        else {
                            for (i = 0; i < docLines.length; i++) {
                                el = existingLines[i];
                                nl = docLines[i];
                                if (el.item_id !== nl.item_id ||
                                    Math.abs((el.quantity || 0) - (nl.quantity || 0)) > 0.001 ||
                                    Math.abs((el.rate || 0) - (nl.rate || 0)) > 0.001 ||
                                    Math.abs((el.amount || 0) - (nl.item_total || nl.amount || 0)) > 0.001 ||
                                    !narrationMatches(el.description, nl.description)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        result = (headerChanged || linesChanged) ? "UPDATED" : "UNCHANGED";
                    }
                    if (!newSoRefId) return [3 /*break*/, 7];
                    _67.label = 3;
                case 3:
                    _67.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, reader.getSalesOrder(orgId, newSoRefId)];
                case 4:
                    soDetail = _67.sent();
                    if (soDetail === null || soDetail === void 0 ? void 0 : soDetail.salesorder) {
                        refDocToPersist = {
                            type: "SO",
                            data: soDetail.salesorder,
                            lines: soDetail.salesorder.line_items || []
                        };
                        referenceDocumentRefreshed = true;
                    }
                    return [3 /*break*/, 6];
                case 5:
                    e_10 = _67.sent();
                    console.warn("Failed to fetch referenced SO ".concat(newSoRefId, ":"), e_10);
                    return [3 /*break*/, 6];
                case 6: return [3 /*break*/, 15];
                case 7:
                    if (!newSoRefNumber) return [3 /*break*/, 15];
                    soIdToFetch = null;
                    localSo = db.prepare("\n          SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders\n          WHERE (organization_id = ? OR organization_id = '') AND salesorder_number = ?\n          ORDER BY fetched_at DESC LIMIT 1\n        ").get(orgId, newSoRefNumber);
                    if (localSo === null || localSo === void 0 ? void 0 : localSo.salesorder_id) {
                        soIdToFetch = localSo.salesorder_id;
                    }
                    else {
                        normKey_1 = (0, so_po_mapping_ts_1.normalizeSoReference)(newSoRefNumber);
                        if (normKey_1) {
                            allLocalSos = db.prepare("\n              SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders\n              WHERE (organization_id = ? OR organization_id = '')\n              ORDER BY fetched_at DESC\n            ").all(orgId);
                            candidates = allLocalSos.filter(function (s) { return (0, so_po_mapping_ts_1.normalizeSoReference)(s.salesorder_number) === normKey_1; });
                            if (candidates.length === 1) {
                                soIdToFetch = candidates[0].salesorder_id;
                            }
                        }
                    }
                    if (!(!soIdToFetch && reader.getSalesOrderByNumber)) return [3 /*break*/, 11];
                    _67.label = 8;
                case 8:
                    _67.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, reader.getSalesOrderByNumber(orgId, newSoRefNumber)];
                case 9:
                    foundSo = _67.sent();
                    resolvedId = (foundSo === null || foundSo === void 0 ? void 0 : foundSo.salesorder_id) || ((_h = foundSo === null || foundSo === void 0 ? void 0 : foundSo.salesorder) === null || _h === void 0 ? void 0 : _h.salesorder_id);
                    if (resolvedId) {
                        soIdToFetch = resolvedId;
                    }
                    return [3 /*break*/, 11];
                case 10:
                    e_11 = _67.sent();
                    console.warn("Could not locate SO by number ".concat(newSoRefNumber, ":"), e_11);
                    return [3 /*break*/, 11];
                case 11:
                    if (!soIdToFetch) return [3 /*break*/, 15];
                    _67.label = 12;
                case 12:
                    _67.trys.push([12, 14, , 15]);
                    return [4 /*yield*/, reader.getSalesOrder(orgId, soIdToFetch)];
                case 13:
                    soDetail = _67.sent();
                    if (soDetail === null || soDetail === void 0 ? void 0 : soDetail.salesorder) {
                        refDocToPersist = {
                            type: "SO",
                            data: soDetail.salesorder,
                            lines: soDetail.salesorder.line_items || []
                        };
                        referenceDocumentRefreshed = true;
                    }
                    return [3 /*break*/, 15];
                case 14:
                    e_12 = _67.sent();
                    console.warn("Failed to fetch referenced SO ".concat(soIdToFetch, ":"), e_12);
                    return [3 /*break*/, 15];
                case 15: return [3 /*break*/, 27];
                case 16:
                    if (!(targetDoc.type === "BILL")) return [3 /*break*/, 22];
                    return [4 /*yield*/, reader.getBill(orgId, targetDoc.id)];
                case 17:
                    detail = _67.sent();
                    docData = detail === null || detail === void 0 ? void 0 : detail.bill;
                    if (!docData) {
                        return [2 /*return*/, {
                                status: "FAILED",
                                documentType: "BILL",
                                documentId: targetDoc.id,
                                documentNumber: targetDoc.number,
                                result: "FAILED",
                                referenceRefreshed: false,
                                referenceDocumentRefreshed: false,
                                completedAt: new Date().toISOString(),
                                error: "Bill ".concat(targetDoc.id, " not found in Zoho")
                            }];
                    }
                    docLines = docData.line_items || [];
                    docNumber = docData.bill_number || docNumber;
                    existingRow = db.prepare("\n        SELECT * FROM audit_zoho_bills\n        WHERE (organization_id = ? OR organization_id = '') AND bill_id = ?\n        ORDER BY fetched_at DESC LIMIT 1\n      ").get(orgId, targetDoc.id);
                    existingLines = db.prepare("\n        SELECT * FROM audit_zoho_bill_lines\n        WHERE (organization_id = ? OR organization_id = '') AND bill_id = ?\n        ORDER BY line_item_id\n      ").all(orgId, targetDoc.id);
                    oldPoId = (existingRow === null || existingRow === void 0 ? void 0 : existingRow.purchaseorder_id) || null;
                    newPoId = docData.purchaseorder_id || null;
                    if (!existingRow) {
                        result = "NEW";
                        referenceRefreshed = Boolean(newPoId);
                    }
                    else {
                        referenceRefreshed = oldPoId !== newPoId;
                        headerChanged = false;
                        if ((existingRow.status || null) !== (docData.status || null))
                            headerChanged = true;
                        if ((existingRow.date || null) !== (docData.date || null))
                            headerChanged = true;
                        if ((existingRow.vendor_id || null) !== (docData.vendor_id || null))
                            headerChanged = true;
                        if (Math.abs((existingRow.total || 0) - (docData.total || 0)) > 0.001)
                            headerChanged = true;
                        if ((existingRow.submitted_by_name || null) !== (docData.submitted_by_name || null))
                            headerChanged = true;
                        if ((existingRow.submitter_id || null) !== (docData.submitter_id || null))
                            headerChanged = true;
                        if (referenceRefreshed)
                            headerChanged = true;
                        linesChanged = false;
                        if (existingLines.length !== docLines.length) {
                            linesChanged = true;
                        }
                        else {
                            for (i = 0; i < docLines.length; i++) {
                                el = existingLines[i];
                                nl = docLines[i];
                                if (el.item_id !== nl.item_id ||
                                    Math.abs((el.quantity || 0) - (nl.quantity || 0)) > 0.001 ||
                                    Math.abs((el.rate || 0) - (nl.rate || 0)) > 0.001 ||
                                    Math.abs((el.amount || 0) - (nl.item_total || nl.amount || 0)) > 0.001 ||
                                    !narrationMatches(el.description, nl.description)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        result = (headerChanged || linesChanged) ? "UPDATED" : "UNCHANGED";
                    }
                    if (!newPoId) return [3 /*break*/, 21];
                    _67.label = 18;
                case 18:
                    _67.trys.push([18, 20, , 21]);
                    return [4 /*yield*/, reader.getPurchaseOrder(orgId, newPoId)];
                case 19:
                    poDetail = _67.sent();
                    if (poDetail === null || poDetail === void 0 ? void 0 : poDetail.purchaseorder) {
                        refDocToPersist = {
                            type: "PO",
                            data: poDetail.purchaseorder,
                            lines: poDetail.purchaseorder.line_items || []
                        };
                        referenceDocumentRefreshed = true;
                    }
                    return [3 /*break*/, 21];
                case 20:
                    e_13 = _67.sent();
                    console.warn("Failed to fetch referenced PO ".concat(newPoId, ":"), e_13);
                    return [3 /*break*/, 21];
                case 21: return [3 /*break*/, 27];
                case 22:
                    if (!(targetDoc.type === "INVOICE")) return [3 /*break*/, 27];
                    return [4 /*yield*/, reader.getInvoice(orgId, targetDoc.id)];
                case 23:
                    detail = _67.sent();
                    docData = detail === null || detail === void 0 ? void 0 : detail.invoice;
                    if (!docData) {
                        return [2 /*return*/, {
                                status: "FAILED",
                                documentType: "INVOICE",
                                documentId: targetDoc.id,
                                documentNumber: targetDoc.number,
                                result: "FAILED",
                                referenceRefreshed: false,
                                referenceDocumentRefreshed: false,
                                completedAt: new Date().toISOString(),
                                error: "Invoice ".concat(targetDoc.id, " not found in Zoho")
                            }];
                    }
                    docLines = docData.line_items || [];
                    docNumber = docData.invoice_number || docNumber;
                    existingRow = db.prepare("\n        SELECT * FROM audit_zoho_invoices\n        WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ?\n        ORDER BY fetched_at DESC LIMIT 1\n      ").get(orgId, targetDoc.id);
                    existingLines = db.prepare("\n        SELECT * FROM audit_zoho_invoice_lines\n        WHERE (organization_id = ? OR organization_id = '') AND invoice_id = ?\n        ORDER BY line_item_id\n      ").all(orgId, targetDoc.id);
                    oldSoId = (existingRow === null || existingRow === void 0 ? void 0 : existingRow.salesorder_id) || null;
                    newSoId = docData.salesorder_id || null;
                    if (!existingRow) {
                        result = "NEW";
                        referenceRefreshed = Boolean(newSoId);
                    }
                    else {
                        referenceRefreshed = oldSoId !== newSoId;
                        headerChanged = false;
                        if ((existingRow.status || null) !== (docData.status || null))
                            headerChanged = true;
                        if ((existingRow.date || null) !== (docData.date || null))
                            headerChanged = true;
                        if ((existingRow.customer_id || null) !== (docData.customer_id || null))
                            headerChanged = true;
                        if (Math.abs((existingRow.total || 0) - (docData.total || 0)) > 0.001)
                            headerChanged = true;
                        if ((existingRow.submitted_by_name || null) !== (docData.submitted_by_name || null))
                            headerChanged = true;
                        if ((existingRow.submitter_id || null) !== (docData.submitter_id || null))
                            headerChanged = true;
                        if (referenceRefreshed)
                            headerChanged = true;
                        linesChanged = false;
                        if (existingLines.length !== docLines.length) {
                            linesChanged = true;
                        }
                        else {
                            for (i = 0; i < docLines.length; i++) {
                                el = existingLines[i];
                                nl = docLines[i];
                                if (el.item_id !== nl.item_id ||
                                    Math.abs((el.quantity || 0) - (nl.quantity || 0)) > 0.001 ||
                                    Math.abs((el.rate || 0) - (nl.rate || 0)) > 0.001 ||
                                    Math.abs((el.amount || 0) - (nl.item_total || nl.amount || 0)) > 0.001 ||
                                    !narrationMatches(el.description, nl.description)) {
                                    linesChanged = true;
                                    break;
                                }
                            }
                        }
                        result = (headerChanged || linesChanged) ? "UPDATED" : "UNCHANGED";
                    }
                    if (!newSoId) return [3 /*break*/, 27];
                    _67.label = 24;
                case 24:
                    _67.trys.push([24, 26, , 27]);
                    return [4 /*yield*/, reader.getSalesOrder(orgId, newSoId)];
                case 25:
                    soDetail = _67.sent();
                    if (soDetail === null || soDetail === void 0 ? void 0 : soDetail.salesorder) {
                        refDocToPersist = {
                            type: "SO",
                            data: soDetail.salesorder,
                            lines: soDetail.salesorder.line_items || []
                        };
                        referenceDocumentRefreshed = true;
                    }
                    return [3 /*break*/, 27];
                case 26:
                    e_14 = _67.sent();
                    console.warn("Failed to fetch referenced SO ".concat(newSoId, ":"), e_14);
                    return [3 /*break*/, 27];
                case 27:
                    fetchedAt = new Date().toISOString();
                    source_run_id = "APPROVAL_PENDING_ACTIVE";
                    db.exec("BEGIN IMMEDIATE TRANSACTION");
                    try {
                        db.prepare("\n        INSERT INTO audit_zoho_source_runs (\n          source_run_id, organization_id, source_type, started_at, completed_at,\n          status, api_domain, records_seen, records_written\n        ) VALUES (?, ?, 'approval_pending_sync', ?, ?, 'SUCCESS', ?, 1, 1)\n        ON CONFLICT(source_run_id) DO UPDATE SET\n          completed_at=excluded.completed_at,\n          records_seen=audit_zoho_source_runs.records_seen + 1,\n          records_written=audit_zoho_source_runs.records_written + 1\n      ").run(source_run_id, orgId, fetchedAt, fetchedAt, apiDomain);
                        if (targetDoc.type === "PO") {
                            if (orgId) {
                                db.prepare("DELETE FROM audit_zoho_purchase_orders WHERE organization_id = '' AND purchaseorder_id = ?").run(docData.purchaseorder_id);
                                db.prepare("DELETE FROM audit_zoho_purchase_order_lines WHERE organization_id = '' AND purchaseorder_id = ?").run(docData.purchaseorder_id);
                            }
                            customFieldsJson = docData.custom_fields ? JSON.stringify(docData.custom_fields) : null;
                            deliveryCustomerName = docData.delivery_customer_name || null;
                            try {
                                db.exec("ALTER TABLE audit_zoho_purchase_orders ADD COLUMN reference_number TEXT;");
                            }
                            catch (_68) { }
                            db.prepare("\n          INSERT INTO audit_zoho_purchase_orders (\n            organization_id, purchaseorder_id, source_run_id, purchaseorder_number,\n            vendor_id, vendor_name, delivery_customer_name, date, delivery_date,\n            status, currency, total, custom_fields_json, source_endpoint, fetched_at,\n            submitter_id, submitted_by_name, reference_number\n          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n          ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET\n            purchaseorder_number=excluded.purchaseorder_number,\n            vendor_id=excluded.vendor_id,\n            vendor_name=excluded.vendor_name,\n            delivery_customer_name=excluded.delivery_customer_name,\n            date=excluded.date,\n            delivery_date=excluded.delivery_date,\n            status=excluded.status,\n            currency=excluded.currency,\n            total=excluded.total,\n            custom_fields_json=excluded.custom_fields_json,\n            fetched_at=excluded.fetched_at,\n            submitter_id=excluded.submitter_id,\n            submitted_by_name=excluded.submitted_by_name,\n            reference_number=excluded.reference_number\n        ").run(orgId, docData.purchaseorder_id, source_run_id, (_j = docData.purchaseorder_number) !== null && _j !== void 0 ? _j : null, (_k = docData.vendor_id) !== null && _k !== void 0 ? _k : null, (_l = docData.vendor_name) !== null && _l !== void 0 ? _l : null, deliveryCustomerName, (_m = docData.date) !== null && _m !== void 0 ? _m : null, (_o = docData.delivery_date) !== null && _o !== void 0 ? _o : null, (_p = docData.status) !== null && _p !== void 0 ? _p : null, (_q = docData.currency) !== null && _q !== void 0 ? _q : null, (_r = docData.total) !== null && _r !== void 0 ? _r : null, customFieldsJson, "/books/v3/purchaseorders", fetchedAt, (_s = docData.submitter_id) !== null && _s !== void 0 ? _s : null, (_t = docData.submitted_by_name) !== null && _t !== void 0 ? _t : null, (_u = docData.reference_number) !== null && _u !== void 0 ? _u : null);
                            db.prepare("\n          DELETE FROM audit_zoho_purchase_order_lines\n          WHERE organization_id = ? AND purchaseorder_id = ? AND source_run_id = ?\n        ").run(orgId, docData.purchaseorder_id, source_run_id);
                            for (_i = 0, docLines_1 = docLines; _i < docLines_1.length; _i++) {
                                line = docLines_1[_i];
                                db.prepare("\n            INSERT INTO audit_zoho_purchase_order_lines (\n              organization_id, line_item_id, purchaseorder_id, source_run_id,\n              item_id, item_name, description, sku, quantity, rate, amount\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n          ").run(orgId, line.line_item_id || ("po_line_" + crypto_1.default.randomUUID()), docData.purchaseorder_id, source_run_id, (_v = line.item_id) !== null && _v !== void 0 ? _v : null, (_w = line.name) !== null && _w !== void 0 ? _w : null, resolveDescState(line.description), (_x = line.sku) !== null && _x !== void 0 ? _x : null, (_y = line.quantity) !== null && _y !== void 0 ? _y : null, (_z = line.rate) !== null && _z !== void 0 ? _z : null, (_0 = line.item_total) !== null && _0 !== void 0 ? _0 : null);
                            }
                        }
                        else if (targetDoc.type === "BILL") {
                            if (orgId) {
                                db.prepare("DELETE FROM audit_zoho_bills WHERE organization_id = '' AND bill_id = ?").run(docData.bill_id);
                                db.prepare("DELETE FROM audit_zoho_bill_lines WHERE organization_id = '' AND bill_id = ?").run(docData.bill_id);
                            }
                            customFieldsJson = docData.custom_fields ? JSON.stringify(docData.custom_fields) : null;
                            db.prepare("\n          INSERT INTO audit_zoho_bills (\n            organization_id, bill_id, source_run_id, bill_number,\n            vendor_id, vendor_name, purchaseorder_id, date, due_date,\n            status, currency, total, balance, custom_fields_json,\n            source_endpoint, fetched_at, submitter_id, submitted_by_name\n          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n          ON CONFLICT(organization_id, bill_id, source_run_id) DO UPDATE SET\n            bill_number=excluded.bill_number,\n            vendor_id=excluded.vendor_id,\n            vendor_name=excluded.vendor_name,\n            purchaseorder_id=excluded.purchaseorder_id,\n            date=excluded.date,\n            due_date=excluded.due_date,\n            status=excluded.status,\n            currency=excluded.currency,\n            total=excluded.total,\n            balance=excluded.balance,\n            custom_fields_json=excluded.custom_fields_json,\n            fetched_at=excluded.fetched_at,\n            submitter_id=excluded.submitter_id,\n            submitted_by_name=excluded.submitted_by_name\n        ").run(orgId, docData.bill_id, source_run_id, (_1 = docData.bill_number) !== null && _1 !== void 0 ? _1 : null, (_2 = docData.vendor_id) !== null && _2 !== void 0 ? _2 : null, (_3 = docData.vendor_name) !== null && _3 !== void 0 ? _3 : null, (_4 = docData.purchaseorder_id) !== null && _4 !== void 0 ? _4 : null, (_5 = docData.date) !== null && _5 !== void 0 ? _5 : null, (_6 = docData.due_date) !== null && _6 !== void 0 ? _6 : null, (_7 = docData.status) !== null && _7 !== void 0 ? _7 : null, (_9 = (_8 = docData.currency_code) !== null && _8 !== void 0 ? _8 : docData.currency) !== null && _9 !== void 0 ? _9 : null, (_10 = docData.total) !== null && _10 !== void 0 ? _10 : null, (_11 = docData.balance) !== null && _11 !== void 0 ? _11 : null, customFieldsJson, "/books/v3/bills", fetchedAt, (_12 = docData.submitter_id) !== null && _12 !== void 0 ? _12 : null, (_13 = docData.submitted_by_name) !== null && _13 !== void 0 ? _13 : null);
                            db.prepare("\n          DELETE FROM audit_zoho_bill_lines\n          WHERE organization_id = ? AND bill_id = ? AND source_run_id = ?\n        ").run(orgId, docData.bill_id, source_run_id);
                            for (_b = 0, docLines_2 = docLines; _b < docLines_2.length; _b++) {
                                line = docLines_2[_b];
                                db.prepare("\n            INSERT INTO audit_zoho_bill_lines (\n              organization_id, line_item_id, bill_id, source_run_id,\n              item_id, item_name, description, quantity, rate, amount\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n          ").run(orgId, line.line_item_id || ("bill_line_" + crypto_1.default.randomUUID()), docData.bill_id, source_run_id, (_14 = line.item_id) !== null && _14 !== void 0 ? _14 : null, (_15 = line.name) !== null && _15 !== void 0 ? _15 : null, resolveDescState(line.description), (_16 = line.quantity) !== null && _16 !== void 0 ? _16 : null, (_17 = line.rate) !== null && _17 !== void 0 ? _17 : null, (_18 = line.item_total) !== null && _18 !== void 0 ? _18 : null);
                            }
                        }
                        else if (targetDoc.type === "INVOICE") {
                            if (orgId) {
                                db.prepare("DELETE FROM audit_zoho_invoices WHERE organization_id = '' AND invoice_id = ?").run(docData.invoice_id);
                                db.prepare("DELETE FROM audit_zoho_invoice_lines WHERE organization_id = '' AND invoice_id = ?").run(docData.invoice_id);
                            }
                            customFieldsJson = docData.custom_fields ? JSON.stringify(docData.custom_fields) : null;
                            deliveryCustomerName = ((_19 = docData.shipping_address) === null || _19 === void 0 ? void 0 : _19.customer_name) || docData.customer_name || null;
                            db.prepare("\n          INSERT INTO audit_zoho_invoices (\n            organization_id, invoice_id, source_run_id, invoice_number,\n            customer_id, delivery_customer_name, salesorder_id, date, due_date,\n            status, total, balance, currency_code, custom_fields_json,\n            source_endpoint, fetched_at, submitter_id, submitted_by_name\n          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n          ON CONFLICT(organization_id, invoice_id, source_run_id) DO UPDATE SET\n            invoice_number=excluded.invoice_number,\n            customer_id=excluded.customer_id,\n            delivery_customer_name=excluded.delivery_customer_name,\n            salesorder_id=excluded.salesorder_id,\n            date=excluded.date,\n            due_date=excluded.due_date,\n            status=excluded.status,\n            total=excluded.total,\n            balance=excluded.balance,\n            currency_code=excluded.currency_code,\n            custom_fields_json=excluded.custom_fields_json,\n            fetched_at=excluded.fetched_at,\n            submitter_id=excluded.submitter_id,\n            submitted_by_name=excluded.submitted_by_name\n        ").run(orgId, docData.invoice_id, source_run_id, (_20 = docData.invoice_number) !== null && _20 !== void 0 ? _20 : null, (_21 = docData.customer_id) !== null && _21 !== void 0 ? _21 : null, deliveryCustomerName, (_22 = docData.salesorder_id) !== null && _22 !== void 0 ? _22 : null, (_23 = docData.date) !== null && _23 !== void 0 ? _23 : null, (_24 = docData.due_date) !== null && _24 !== void 0 ? _24 : null, (_25 = docData.status) !== null && _25 !== void 0 ? _25 : null, (_26 = docData.total) !== null && _26 !== void 0 ? _26 : null, (_27 = docData.balance) !== null && _27 !== void 0 ? _27 : null, (_28 = docData.currency_code) !== null && _28 !== void 0 ? _28 : null, customFieldsJson, "/books/v3/invoices", fetchedAt, (_29 = docData.submitter_id) !== null && _29 !== void 0 ? _29 : null, (_30 = docData.submitted_by_name) !== null && _30 !== void 0 ? _30 : null);
                            db.prepare("\n          DELETE FROM audit_zoho_invoice_lines\n          WHERE organization_id = ? AND invoice_id = ? AND source_run_id = ?\n        ").run(orgId, docData.invoice_id, source_run_id);
                            for (_c = 0, docLines_3 = docLines; _c < docLines_3.length; _c++) {
                                line = docLines_3[_c];
                                db.prepare("\n            INSERT INTO audit_zoho_invoice_lines (\n              organization_id, line_item_id, invoice_id, source_run_id,\n              item_id, item_name, description, quantity, rate, amount\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n          ").run(orgId, line.line_item_id || ("inv_line_" + crypto_1.default.randomUUID()), docData.invoice_id, source_run_id, (_31 = line.item_id) !== null && _31 !== void 0 ? _31 : null, (_32 = line.name) !== null && _32 !== void 0 ? _32 : null, resolveDescState(line.description), (_33 = line.quantity) !== null && _33 !== void 0 ? _33 : null, (_34 = line.rate) !== null && _34 !== void 0 ? _34 : null, (_35 = line.item_total) !== null && _35 !== void 0 ? _35 : null);
                            }
                        }
                        // If refDocToPersist was fetched (e.g. newly referenced SO or PO):
                        if (refDocToPersist) {
                            if (refDocToPersist.type === "SO") {
                                so = refDocToPersist.data;
                                if (orgId) {
                                    db.prepare("DELETE FROM audit_zoho_sales_orders WHERE organization_id = '' AND salesorder_id = ?").run(so.salesorder_id);
                                    db.prepare("DELETE FROM audit_zoho_sales_order_lines WHERE organization_id = '' AND salesorder_id = ?").run(so.salesorder_id);
                                }
                                customFieldsJson = so.custom_fields ? JSON.stringify(so.custom_fields) : null;
                                deliveryCustomerName = ((_36 = so.shipping_address) === null || _36 === void 0 ? void 0 : _36.customer_name) || so.customer_name || null;
                                db.prepare("\n            INSERT INTO audit_zoho_sales_orders (\n              organization_id, salesorder_id, source_run_id, salesorder_number,\n              customer_id, customer_name, delivery_customer_name, date, shipment_date,\n              status, currency, total, custom_fields_json, source_endpoint, fetched_at\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, salesorder_id, source_run_id) DO UPDATE SET\n              salesorder_number=excluded.salesorder_number,\n              customer_id=excluded.customer_id,\n              customer_name=excluded.customer_name,\n              delivery_customer_name=excluded.delivery_customer_name,\n              date=excluded.date,\n              shipment_date=excluded.shipment_date,\n              status=excluded.status,\n              currency=excluded.currency,\n              total=excluded.total,\n              custom_fields_json=excluded.custom_fields_json,\n              fetched_at=excluded.fetched_at\n          ").run(orgId, so.salesorder_id, source_run_id, (_37 = so.salesorder_number) !== null && _37 !== void 0 ? _37 : null, (_38 = so.customer_id) !== null && _38 !== void 0 ? _38 : null, (_39 = so.customer_name) !== null && _39 !== void 0 ? _39 : null, deliveryCustomerName, (_40 = so.date) !== null && _40 !== void 0 ? _40 : null, (_41 = so.shipment_date) !== null && _41 !== void 0 ? _41 : null, (_42 = so.status) !== null && _42 !== void 0 ? _42 : null, (_43 = so.currency) !== null && _43 !== void 0 ? _43 : null, (_44 = so.total) !== null && _44 !== void 0 ? _44 : null, customFieldsJson, "/books/v3/salesorders", fetchedAt);
                                db.prepare("\n            DELETE FROM audit_zoho_sales_order_lines\n            WHERE organization_id = ? AND salesorder_id = ? AND source_run_id = ?\n          ").run(orgId, so.salesorder_id, source_run_id);
                                for (_d = 0, _e = refDocToPersist.lines; _d < _e.length; _d++) {
                                    line = _e[_d];
                                    db.prepare("\n              INSERT INTO audit_zoho_sales_order_lines (\n                organization_id, line_item_id, salesorder_id, source_run_id,\n                item_id, item_name, description, sku, quantity, rate, amount\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ").run(orgId, line.line_item_id || ("so_line_" + crypto_1.default.randomUUID()), so.salesorder_id, source_run_id, (_45 = line.item_id) !== null && _45 !== void 0 ? _45 : null, (_46 = line.name) !== null && _46 !== void 0 ? _46 : null, resolveDescState(line.description), (_47 = line.sku) !== null && _47 !== void 0 ? _47 : null, (_48 = line.quantity) !== null && _48 !== void 0 ? _48 : null, (_49 = line.rate) !== null && _49 !== void 0 ? _49 : null, (_50 = line.item_total) !== null && _50 !== void 0 ? _50 : null);
                                }
                            }
                            else if (refDocToPersist.type === "PO") {
                                po = refDocToPersist.data;
                                if (orgId) {
                                    db.prepare("DELETE FROM audit_zoho_purchase_orders WHERE organization_id = '' AND purchaseorder_id = ?").run(po.purchaseorder_id);
                                    db.prepare("DELETE FROM audit_zoho_purchase_order_lines WHERE organization_id = '' AND purchaseorder_id = ?").run(po.purchaseorder_id);
                                }
                                customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
                                deliveryCustomerName = po.delivery_customer_name || null;
                                db.prepare("\n            INSERT INTO audit_zoho_purchase_orders (\n              organization_id, purchaseorder_id, source_run_id, purchaseorder_number,\n              vendor_id, vendor_name, delivery_customer_name, date, delivery_date,\n              status, currency, total, custom_fields_json, source_endpoint, fetched_at,\n              submitter_id, submitted_by_name\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET\n              purchaseorder_number=excluded.purchaseorder_number,\n              vendor_id=excluded.vendor_id,\n              vendor_name=excluded.vendor_name,\n              delivery_customer_name=excluded.delivery_customer_name,\n              date=excluded.date,\n              delivery_date=excluded.delivery_date,\n              status=excluded.status,\n              currency=excluded.currency,\n              total=excluded.total,\n              custom_fields_json=excluded.custom_fields_json,\n              fetched_at=excluded.fetched_at,\n              submitter_id=excluded.submitter_id,\n              submitted_by_name=excluded.submitted_by_name\n          ").run(orgId, po.purchaseorder_id, source_run_id, (_51 = po.purchaseorder_number) !== null && _51 !== void 0 ? _51 : null, (_52 = po.vendor_id) !== null && _52 !== void 0 ? _52 : null, (_53 = po.vendor_name) !== null && _53 !== void 0 ? _53 : null, deliveryCustomerName, (_54 = po.date) !== null && _54 !== void 0 ? _54 : null, (_55 = po.delivery_date) !== null && _55 !== void 0 ? _55 : null, (_56 = po.status) !== null && _56 !== void 0 ? _56 : null, (_57 = po.currency) !== null && _57 !== void 0 ? _57 : null, (_58 = po.total) !== null && _58 !== void 0 ? _58 : null, customFieldsJson, "/books/v3/purchaseorders", fetchedAt, (_59 = po.submitter_id) !== null && _59 !== void 0 ? _59 : null, (_60 = po.submitted_by_name) !== null && _60 !== void 0 ? _60 : null);
                                db.prepare("\n            DELETE FROM audit_zoho_purchase_order_lines\n            WHERE organization_id = ? AND purchaseorder_id = ? AND source_run_id = ?\n          ").run(orgId, po.purchaseorder_id, source_run_id);
                                for (_f = 0, _g = refDocToPersist.lines; _f < _g.length; _f++) {
                                    line = _g[_f];
                                    db.prepare("\n              INSERT INTO audit_zoho_purchase_order_lines (\n                organization_id, line_item_id, purchaseorder_id, source_run_id,\n                item_id, item_name, description, sku, quantity, rate, amount\n              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ").run(orgId, line.line_item_id || ("po_line_" + crypto_1.default.randomUUID()), po.purchaseorder_id, source_run_id, (_61 = line.item_id) !== null && _61 !== void 0 ? _61 : null, (_62 = line.name) !== null && _62 !== void 0 ? _62 : null, resolveDescState(line.description), (_63 = line.sku) !== null && _63 !== void 0 ? _63 : null, (_64 = line.quantity) !== null && _64 !== void 0 ? _64 : null, (_65 = line.rate) !== null && _65 !== void 0 ? _65 : null, (_66 = line.item_total) !== null && _66 !== void 0 ? _66 : null);
                                }
                            }
                        }
                        db.exec("COMMIT");
                    }
                    catch (e) {
                        db.exec("ROLLBACK");
                        throw e;
                    }
                    return [2 /*return*/, {
                            status: "SUCCESS",
                            documentType: targetDoc.type,
                            documentId: targetDoc.id,
                            documentNumber: docNumber,
                            result: result,
                            referenceRefreshed: referenceRefreshed,
                            referenceDocumentRefreshed: referenceDocumentRefreshed,
                            completedAt: fetchedAt
                        }];
                case 28:
                    err_1 = _67.sent();
                    return [2 /*return*/, {
                            status: "FAILED",
                            documentType: targetDoc.type,
                            documentId: targetDoc.id,
                            documentNumber: targetDoc.number,
                            result: "FAILED",
                            referenceRefreshed: false,
                            referenceDocumentRefreshed: false,
                            completedAt: new Date().toISOString(),
                            error: err_1.message || String(err_1)
                        }];
                case 29: return [2 /*return*/];
            }
        });
    });
}
