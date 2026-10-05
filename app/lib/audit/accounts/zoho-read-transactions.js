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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCustomerPayments = listCustomerPayments;
exports.getCustomerPayment = getCustomerPayment;
exports.listVendorPayments = listVendorPayments;
exports.getVendorPayment = getVendorPayment;
exports.listCreditNotes = listCreditNotes;
exports.getCreditNote = getCreditNote;
exports.listVendorCredits = listVendorCredits;
exports.getVendorCredit = getVendorCredit;
exports.listSalesOrders = listSalesOrders;
exports.getSalesOrder = getSalesOrder;
exports.getSalesOrderByNumber = getSalesOrderByNumber;
exports.listPurchaseOrders = listPurchaseOrders;
exports.getPurchaseOrder = getPurchaseOrder;
exports.listJournals = listJournals;
exports.getJournal = getJournal;
exports.listExpenses = listExpenses;
exports.getExpense = getExpense;
exports.listBills = listBills;
exports.getBill = getBill;
exports.listInvoices = listInvoices;
exports.getInvoice = getInvoice;
exports.listBankTransactions = listBankTransactions;
var zoho_api_ts_1 = require("../../zoho-api.ts");
var zoho_security_guard_ts_1 = require("../../zoho-security-guard.ts");
function baseGet(endpoint_1, organizationId_1) {
    return __awaiter(this, arguments, void 0, function (endpoint, organizationId, page, perPage) {
        var _a, token, store, url, res;
        if (page === void 0) { page = 1; }
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain).concat(endpoint, "?organization_id=").concat(organizationId, "&page=").concat(page, "&per_page=").concat(perPage);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: { Authorization: "Zoho-oauthtoken ".concat(token) }
                        })];
                case 2:
                    res = _b.sent();
                    if (!res.ok)
                        throw new Error("GET ".concat(endpoint, " failed: HTTP ").concat(res.status));
                    return [2 /*return*/, res.json()];
            }
        });
    });
}
function baseGetDetail(endpoint, id, organizationId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, url, res;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain).concat(endpoint, "/").concat(id, "?organization_id=").concat(organizationId);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: { Authorization: "Zoho-oauthtoken ".concat(token) }
                        })];
                case 2:
                    res = _b.sent();
                    if (!res.ok)
                        throw new Error("GET ".concat(endpoint, "/").concat(id, " failed: HTTP ").concat(res.status));
                    return [2 /*return*/, res.json()];
            }
        });
    });
}
function listCustomerPayments(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/customerpayments", orgId, 1, perPage)];
        });
    });
}
function getCustomerPayment(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/customerpayments", id, orgId)];
        });
    });
}
function listVendorPayments(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/vendorpayments", orgId, 1, perPage)];
        });
    });
}
function getVendorPayment(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/vendorpayments", id, orgId)];
        });
    });
}
function listCreditNotes(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/creditnotes", orgId, 1, perPage)];
        });
    });
}
function getCreditNote(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/creditnotes", id, orgId)];
        });
    });
}
function listVendorCredits(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/vendorcredits", orgId, 1, perPage)];
        });
    });
}
function getVendorCredit(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/vendorcredits", id, orgId)];
        });
    });
}
function listSalesOrders(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/salesorders", orgId, 1, perPage)];
        });
    });
}
function getSalesOrder(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/salesorders", id, orgId)];
        });
    });
}
function getSalesOrderByNumber(orgId, soNumber) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, url, res, data, so, cleanDigits, fallbackNumber, so;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain, "/books/v3/salesorders?organization_id=").concat(orgId, "&salesorder_number=").concat(encodeURIComponent(soNumber));
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: { Authorization: "Zoho-oauthtoken ".concat(token) }
                        })];
                case 2:
                    res = _b.sent();
                    if (!res.ok)
                        throw new Error("GET salesorders by number failed: HTTP ".concat(res.status));
                    return [4 /*yield*/, res.json()];
                case 3:
                    data = _b.sent();
                    if (data.salesorders && data.salesorders.length > 0) {
                        so = data.salesorders[0];
                        return [2 /*return*/, { salesorder: so, salesorder_id: so.salesorder_id }];
                    }
                    cleanDigits = soNumber.replace(/\D/g, "");
                    if (!(cleanDigits.length >= 7 && !soNumber.toUpperCase().startsWith("SO-"))) return [3 /*break*/, 6];
                    fallbackNumber = "SO-".concat(cleanDigits.slice(-7));
                    url = "".concat(store.api_domain, "/books/v3/salesorders?organization_id=").concat(orgId, "&salesorder_number=").concat(encodeURIComponent(fallbackNumber));
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: { Authorization: "Zoho-oauthtoken ".concat(token) }
                        })];
                case 4:
                    res = _b.sent();
                    if (!res.ok) return [3 /*break*/, 6];
                    return [4 /*yield*/, res.json()];
                case 5:
                    data = _b.sent();
                    if (data.salesorders && data.salesorders.length > 0) {
                        so = data.salesorders[0];
                        return [2 /*return*/, { salesorder: so, salesorder_id: so.salesorder_id }];
                    }
                    _b.label = 6;
                case 6: return [2 /*return*/, { salesorder: null, salesorder_id: null }];
            }
        });
    });
}
function listPurchaseOrders(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/purchaseorders", orgId, 1, perPage)];
        });
    });
}
function getPurchaseOrder(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/purchaseorders", id, orgId)];
        });
    });
}
function listJournals(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/journals", orgId, 1, perPage)];
        });
    });
}
function getJournal(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/journals", id, orgId)];
        });
    });
}
function listExpenses(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/expenses", orgId, 1, perPage)];
        });
    });
}
function getExpense(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/expenses", id, orgId)];
        });
    });
}
function listBills(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/bills", orgId, 1, perPage)];
        });
    });
}
function getBill(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/bills", id, orgId)];
        });
    });
}
function listInvoices(orgId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, perPage) {
        if (perPage === void 0) { perPage = 3; }
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGet("/books/v3/invoices", orgId, 1, perPage)];
        });
    });
}
function getInvoice(orgId, id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, baseGetDetail("/books/v3/invoices", id, orgId)];
        });
    });
}
function listBankTransactions(orgId_1, accountId_1) {
    return __awaiter(this, arguments, void 0, function (orgId, accountId, page, perPage) {
        var _a, token, store, url, res;
        if (page === void 0) { page = 1; }
        if (perPage === void 0) { perPage = 200; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain, "/books/v3/bankaccounts/").concat(accountId, "/transactions?organization_id=").concat(orgId, "&page=").concat(page, "&per_page=").concat(perPage);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: { Authorization: "Zoho-oauthtoken ".concat(token) }
                        })];
                case 2:
                    res = _b.sent();
                    if (!res.ok)
                        throw new Error("GET bankaccounts/".concat(accountId, "/transactions failed: HTTP ").concat(res.status));
                    return [2 /*return*/, res.json()];
            }
        });
    });
}
