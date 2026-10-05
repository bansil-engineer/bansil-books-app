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
exports.listChartOfAccounts = listChartOfAccounts;
exports.getZohoAccountById = getZohoAccountById;
exports.listBankAccounts = listBankAccounts;
exports.listBankAccountTransactions = listBankAccountTransactions;
exports.listCashAccountTransactions = listCashAccountTransactions;
var zoho_api_ts_1 = require("../../zoho-api.ts");
var zoho_security_guard_ts_1 = require("../../zoho-security-guard.ts");
/**
 * Fetch Chart of Accounts. STRICTLY GET ONLY.
 */
function listChartOfAccounts(organizationId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, allAccountsMap, page, perPage, hasMore, lastStatusCode, rawRecords, completionEstablished, params, url, res, data, accounts, _i, accounts_1, acc, accountId, uniqueRecords, duplicateRecords;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _c.sent(), token = _a.token, store = _a.store;
                    allAccountsMap = new Map();
                    page = 1;
                    perPage = 200;
                    hasMore = true;
                    lastStatusCode = 200;
                    rawRecords = 0;
                    completionEstablished = false;
                    _c.label = 2;
                case 2:
                    if (!hasMore) return [3 /*break*/, 5];
                    params = new URLSearchParams({
                        organization_id: organizationId,
                        per_page: String(perPage),
                        page: String(page),
                        filter_by: "AccountType.All"
                    });
                    url = "".concat(store.api_domain, "/books/v3/chartofaccounts?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET", // Hardcoded GET
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 3:
                    res = _c.sent();
                    lastStatusCode = res.status;
                    if (!res.ok) {
                        if (res.status === 403) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.accountants.READ");
                        }
                        throw new Error("Chart of Accounts API failed: HTTP ".concat(res.status));
                    }
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _c.sent();
                    if (data.code !== 0) {
                        if (data.code === 57 || data.message.includes("privilege")) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.accountants.READ");
                        }
                        throw new Error("Zoho API error: ".concat(data.message));
                    }
                    accounts = (_b = data.chartofaccounts) !== null && _b !== void 0 ? _b : [];
                    rawRecords += accounts.length;
                    // Normalize safely without storing secrets
                    for (_i = 0, accounts_1 = accounts; _i < accounts_1.length; _i++) {
                        acc = accounts_1[_i];
                        accountId = String(acc.account_id);
                        if (!allAccountsMap.has(accountId)) {
                            allAccountsMap.set(accountId, {
                                account_id: accountId,
                                account_name: String(acc.account_name),
                                account_code: String(acc.account_code || ""),
                                account_type: String(acc.account_type),
                                account_sub_type: acc.account_sub_type ? String(acc.account_sub_type) : undefined,
                                parent_account_id: acc.parent_account_id ? String(acc.parent_account_id) : undefined,
                                parent_account_name: acc.parent_account_name ? String(acc.parent_account_name) : undefined,
                                is_active: Boolean(acc.is_active),
                                currency_id: acc.currency_id ? String(acc.currency_id) : undefined,
                                currency_code: acc.currency_code ? String(acc.currency_code) : undefined,
                                current_balance: typeof acc.current_balance === "number" ? acc.current_balance : undefined,
                            });
                        }
                    }
                    // Rely on safe bounds and 0 records instead of unreliable has_more_page
                    if (accounts.length === 0) {
                        hasMore = false;
                        completionEstablished = true;
                    }
                    else {
                        page++;
                        if (page > 50) {
                            hasMore = false;
                            completionEstablished = false; // Forced exit
                        }
                    }
                    return [3 /*break*/, 2];
                case 5:
                    uniqueRecords = allAccountsMap.size;
                    duplicateRecords = rawRecords - uniqueRecords;
                    return [2 /*return*/, {
                            accounts: Array.from(allAccountsMap.values()),
                            statusCode: lastStatusCode,
                            paginationEvidence: {
                                pagesRequested: page,
                                recordsPerPage: perPage,
                                rawRecords: rawRecords,
                                uniqueRecords: uniqueRecords,
                                duplicateRecords: duplicateRecords,
                                completionEstablished: completionEstablished
                            }
                        }];
            }
        });
    });
}
function getZohoAccountById(organizationId, accountId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, url, res, data, acc;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain, "/books/v3/chartofaccounts/").concat(accountId, "?organization_id=").concat(organizationId);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 2:
                    res = _b.sent();
                    if (!res.ok)
                        return [2 /*return*/, null];
                    return [4 /*yield*/, res.json()];
                case 3:
                    data = _b.sent();
                    if (data.code !== 0 || !data.chart_of_account)
                        return [2 /*return*/, null];
                    acc = data.chart_of_account;
                    return [2 /*return*/, {
                            account_id: String(acc.account_id),
                            account_name: String(acc.account_name),
                            account_code: String(acc.account_code || ""),
                            account_type: String(acc.account_type),
                            account_sub_type: acc.account_sub_type ? String(acc.account_sub_type) : undefined,
                            parent_account_id: acc.parent_account_id ? String(acc.parent_account_id) : undefined,
                            parent_account_name: acc.parent_account_name ? String(acc.parent_account_name) : undefined,
                            is_active: Boolean(acc.is_active),
                            currency_id: acc.currency_id ? String(acc.currency_id) : undefined,
                            currency_code: acc.currency_code ? String(acc.currency_code) : undefined,
                            current_balance: typeof acc.current_balance === "number" ? acc.current_balance : undefined,
                        }];
            }
        });
    });
}
/**
 * Fetch Bank Accounts. STRICTLY GET ONLY.
 */
function listBankAccounts(organizationId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, allAccounts, page, hasMore, lastStatusCode, params, url, res, data, accounts, _i, accounts_2, acc, maskedAcctNumber, acctStr;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _d.sent(), token = _a.token, store = _a.store;
                    allAccounts = [];
                    page = 1;
                    hasMore = true;
                    lastStatusCode = 200;
                    _d.label = 2;
                case 2:
                    if (!hasMore) return [3 /*break*/, 5];
                    params = new URLSearchParams({
                        organization_id: organizationId,
                        per_page: "200",
                        page: String(page),
                    });
                    url = "".concat(store.api_domain, "/books/v3/bankaccounts?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET", // Hardcoded GET
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 3:
                    res = _d.sent();
                    lastStatusCode = res.status;
                    if (!res.ok) {
                        // Allow 403 to pass through gracefully for authorization blocker detection
                        if (res.status === 403) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.banking.READ");
                        }
                        throw new Error("Bank Accounts API failed: HTTP ".concat(res.status));
                    }
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _d.sent();
                    if (data.code !== 0) {
                        if (data.code === 57 || data.message.includes("privilege")) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.banking.READ");
                        }
                        throw new Error("Zoho API error: ".concat(data.message));
                    }
                    accounts = (_b = data.bankaccounts) !== null && _b !== void 0 ? _b : [];
                    // Normalize safely, MASK account numbers
                    for (_i = 0, accounts_2 = accounts; _i < accounts_2.length; _i++) {
                        acc = accounts_2[_i];
                        maskedAcctNumber = undefined;
                        if (acc.account_number) {
                            acctStr = String(acc.account_number);
                            maskedAcctNumber = acctStr.length > 4
                                ? "****".concat(acctStr.slice(-4))
                                : "****";
                        }
                        allAccounts.push({
                            account_id: String(acc.account_id),
                            account_name: String(acc.account_name),
                            account_code: String(acc.account_code || ""),
                            account_type: String(acc.account_type),
                            currency_id: String(acc.currency_id || ""),
                            currency_code: String(acc.currency_code || ""),
                            is_active: Boolean(acc.is_active),
                            bank_name: acc.bank_name ? String(acc.bank_name) : undefined,
                            routing_number: acc.routing_number ? String(acc.routing_number) : undefined,
                            uncategorized_transactions: typeof acc.uncategorized_transactions === "number" ? acc.uncategorized_transactions : undefined,
                            balance: typeof acc.balance === "number" ? acc.balance : undefined,
                            masked_account_number: maskedAcctNumber,
                        });
                    }
                    hasMore = ((_c = data.page_context) === null || _c === void 0 ? void 0 : _c.has_more_page) === true;
                    page++;
                    if (page > 50)
                        return [3 /*break*/, 5]; // Safety limit
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, { bankAccounts: allAccounts, statusCode: lastStatusCode }];
            }
        });
    });
}
/**
 * Fetch Bank Transactions for a given account. STRICTLY GET ONLY.
 */
function listBankAccountTransactions(organizationId, accountId, options) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, allTransactions, page, perPage, hasMore, lastStatusCode, params, url, res, data, transactions, _i, transactions_1, tx;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _c.sent(), token = _a.token, store = _a.store;
                    allTransactions = [];
                    page = (options === null || options === void 0 ? void 0 : options.page) || 1;
                    perPage = (options === null || options === void 0 ? void 0 : options.per_page) || 200;
                    hasMore = true;
                    lastStatusCode = 200;
                    _c.label = 2;
                case 2:
                    if (!hasMore) return [3 /*break*/, 5];
                    params = new URLSearchParams({
                        organization_id: organizationId,
                        account_id: accountId,
                        per_page: String(perPage),
                        page: String(page),
                    });
                    if (options === null || options === void 0 ? void 0 : options.from_date) {
                        params.append("from_date", options.from_date);
                    }
                    if (options === null || options === void 0 ? void 0 : options.to_date) {
                        params.append("to_date", options.to_date);
                    }
                    if (options === null || options === void 0 ? void 0 : options.status) {
                        params.append("status", options.status);
                    }
                    url = "".concat(store.api_domain, "/books/v3/banktransactions?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET", // Hardcoded GET
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 3:
                    res = _c.sent();
                    lastStatusCode = res.status;
                    if (!res.ok) {
                        // Allow 403 to pass through gracefully
                        if (res.status === 403) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.banking.READ");
                        }
                        throw new Error("Bank Transactions API failed: HTTP ".concat(res.status));
                    }
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _c.sent();
                    if (data.code !== 0) {
                        if (data.code === 57 || data.message.includes("privilege")) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.banking.READ");
                        }
                        throw new Error("Zoho API error: ".concat(data.message));
                    }
                    transactions = (_b = data.banktransactions) !== null && _b !== void 0 ? _b : [];
                    // Normalize safely without storing secrets, retain provenance
                    for (_i = 0, transactions_1 = transactions; _i < transactions_1.length; _i++) {
                        tx = transactions_1[_i];
                        allTransactions.push({
                            transaction_id: String(tx.transaction_id),
                            account_id: String(tx.account_id),
                            account_name: tx.account_name ? String(tx.account_name) : undefined,
                            date: String(tx.date || tx.transaction_date || ""),
                            amount: Number(tx.amount || 0),
                            transaction_type: String(tx.transaction_type),
                            status: String(tx.status),
                            source: tx.source ? String(tx.source) : undefined,
                            debit_or_credit: tx.debit_or_credit ? String(tx.debit_or_credit) : undefined,
                            reference_number: tx.reference_number ? String(tx.reference_number) : undefined,
                            payee: tx.payee ? String(tx.payee) : undefined,
                            description: tx.description ? String(tx.description) : undefined,
                            currency_id: tx.currency_id ? String(tx.currency_id) : undefined,
                            currency_code: tx.currency_code ? String(tx.currency_code) : undefined,
                            imported_transaction_id: tx.imported_transaction_id ? String(tx.imported_transaction_id) : undefined,
                        });
                    }
                    // Only paginate if caller didn't explicitly request a specific page
                    if (options === null || options === void 0 ? void 0 : options.page) {
                        hasMore = false;
                    }
                    else {
                        if (transactions.length === 0 || transactions.length < perPage) {
                            hasMore = false;
                        }
                        else {
                            hasMore = true;
                            page++;
                            if (page > 50)
                                return [3 /*break*/, 5]; // Safety limit
                        }
                    }
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, { transactions: allTransactions, statusCode: lastStatusCode }];
            }
        });
    });
}
/**
 * Fetch Cash Transactions using the proven bankaccounts/{id}/transactions endpoint.
 */
function listCashAccountTransactions(organizationId, accountId, options) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, allTransactions, page, perPage, hasMore, lastStatusCode, params, url, res, errBody, data, transactions, _i, transactions_2, tx;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, zoho_api_ts_1.getValidAccessToken)()];
                case 1:
                    _a = _c.sent(), token = _a.token, store = _a.store;
                    allTransactions = [];
                    page = (options === null || options === void 0 ? void 0 : options.page) || 1;
                    perPage = (options === null || options === void 0 ? void 0 : options.per_page) || 200;
                    hasMore = true;
                    lastStatusCode = 200;
                    _c.label = 2;
                case 2:
                    if (!hasMore) return [3 /*break*/, 7];
                    params = new URLSearchParams({
                        organization_id: organizationId,
                        per_page: String(perPage),
                        page: String(page),
                    });
                    if (options === null || options === void 0 ? void 0 : options.from_date) {
                        params.append("from_date", options.from_date);
                    }
                    if (options === null || options === void 0 ? void 0 : options.to_date) {
                        params.append("to_date", options.to_date);
                    }
                    if (options === null || options === void 0 ? void 0 : options.status) {
                        params.append("status", options.status);
                    }
                    url = "".concat(store.api_domain, "/books/v3/bankaccounts/").concat(accountId, "/transactions?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            method: "GET",
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 3:
                    res = _c.sent();
                    lastStatusCode = res.status;
                    if (!!res.ok) return [3 /*break*/, 5];
                    if (res.status === 403) {
                        throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.banking.READ");
                    }
                    return [4 /*yield*/, res.text().catch(function () { return ""; })];
                case 4:
                    errBody = _c.sent();
                    throw new Error("Cash Transactions API failed: HTTP ".concat(res.status, " - ").concat(errBody));
                case 5: return [4 /*yield*/, res.json()];
                case 6:
                    data = _c.sent();
                    if (data.code !== 0) {
                        if (data.code === 57 || data.message.includes("privilege")) {
                            throw new Error("AUTHORIZATION BLOCKER: ZohoBooks.banking.READ");
                        }
                        throw new Error("Zoho API error: ".concat(data.message));
                    }
                    transactions = (_b = data.banktransactions) !== null && _b !== void 0 ? _b : [];
                    for (_i = 0, transactions_2 = transactions; _i < transactions_2.length; _i++) {
                        tx = transactions_2[_i];
                        allTransactions.push({
                            transaction_id: String(tx.transaction_id),
                            account_id: String(tx.account_id),
                            account_name: tx.account_name ? String(tx.account_name) : undefined,
                            date: String(tx.date || tx.transaction_date || ""),
                            amount: Number(tx.amount || 0),
                            transaction_type: String(tx.transaction_type),
                            status: String(tx.status),
                            source: tx.source ? String(tx.source) : undefined,
                            debit_or_credit: tx.debit_or_credit ? String(tx.debit_or_credit) : undefined,
                            reference_number: tx.reference_number ? String(tx.reference_number) : undefined,
                            payee: tx.payee ? String(tx.payee) : undefined,
                            description: tx.description ? String(tx.description) : undefined,
                            currency_id: tx.currency_id ? String(tx.currency_id) : undefined,
                            currency_code: tx.currency_code ? String(tx.currency_code) : undefined,
                            imported_transaction_id: tx.imported_transaction_id ? String(tx.imported_transaction_id) : undefined,
                            running_balance: tx.running_balance !== undefined ? Number(tx.running_balance) : undefined,
                        });
                    }
                    if (options === null || options === void 0 ? void 0 : options.page) {
                        hasMore = false;
                    }
                    else {
                        if (transactions.length === 0 || transactions.length < perPage) {
                            hasMore = false;
                        }
                        else {
                            hasMore = true;
                            page++;
                            if (page > 50)
                                return [3 /*break*/, 7]; // Safety limit
                        }
                    }
                    return [3 /*break*/, 2];
                case 7: return [2 /*return*/, { transactions: allTransactions, statusCode: lastStatusCode }];
            }
        });
    });
}
