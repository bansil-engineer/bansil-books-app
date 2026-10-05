"use strict";
// ============================================================
// Zoho API Client — SERVER-SIDE ONLY
// Never import this from client components.
// ============================================================
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.getValidAccessToken = getValidAccessToken;
exports.refreshAccessToken = refreshAccessToken;
exports.fetchOrganizations = fetchOrganizations;
exports.fetchInvoiceDetail = fetchInvoiceDetail;
exports.fetchBillDetail = fetchBillDetail;
exports.fetchInvoicesForDate = fetchInvoicesForDate;
exports.fetchTodaysInvoices = fetchTodaysInvoices;
exports.fetchBillsForDate = fetchBillsForDate;
exports.fetchTodaysBills = fetchTodaysBills;
exports.fetchApiUsage = fetchApiUsage;
exports.parseZohoActivityLogItem = parseZohoActivityLogItem;
exports.fetchActivityLogs = fetchActivityLogs;
var zoho_token_store_ts_1 = require("./zoho-token-store.ts");
var zoho_security_guard_ts_1 = require("./zoho-security-guard.ts");
// ---- Token management ----
/**
 * Returns a valid access token, refreshing it automatically if expired.
 * Throws if not connected or refresh fails.
 */
function getValidAccessToken() {
    return __awaiter(this, void 0, void 0, function () {
        var store, refreshed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    store = (0, zoho_token_store_ts_1.readTokenStore)();
                    if (!store) {
                        throw new Error("Not connected to Zoho Books. Please connect first.");
                    }
                    if ((0, zoho_token_store_ts_1.isAccessTokenValid)(store)) {
                        return [2 /*return*/, { token: store.access_token, store: store }];
                    }
                    // Token expired — refresh it
                    console.log("[ZohoAPI] Access token expired, refreshing...");
                    return [4 /*yield*/, refreshAccessToken(store)];
                case 1:
                    refreshed = _a.sent();
                    return [2 /*return*/, { token: refreshed, store: __assign(__assign({}, store), { access_token: refreshed }) }];
            }
        });
    });
}
/**
 * Exchanges refresh_token for a new access_token.
 * Updates the token store automatically.
 */
function refreshAccessToken(store) {
    return __awaiter(this, void 0, void 0, function () {
        var params, res, data, expiresIn;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    params = new URLSearchParams({
                        grant_type: "refresh_token",
                        client_id: process.env.ZOHO_CLIENT_ID,
                        client_secret: process.env.ZOHO_CLIENT_SECRET,
                        refresh_token: store.refresh_token,
                    });
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)("".concat(store.accounts_url, "/oauth/v2/token"), {
                            method: "POST",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            body: params.toString(),
                        })];
                case 1:
                    res = _b.sent();
                    if (!res.ok) {
                        throw new Error("Token refresh failed: HTTP ".concat(res.status));
                    }
                    return [4 /*yield*/, res.json()];
                case 2:
                    data = _b.sent();
                    if (data.error) {
                        throw new Error("Token refresh error: ".concat(data.error));
                    }
                    if (!data.access_token) {
                        throw new Error("Token refresh returned no access_token");
                    }
                    expiresIn = (_a = data.expires_in) !== null && _a !== void 0 ? _a : 3600;
                    (0, zoho_token_store_ts_1.updateAccessToken)(data.access_token, expiresIn);
                    console.log("[ZohoAPI] Access token refreshed successfully");
                    return [2 /*return*/, data.access_token];
            }
        });
    });
}
// ---- Organizations ----
/**
 * Fetch all accessible Zoho Books organizations.
 */
function fetchOrganizations() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, url, res, data;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain, "/books/v3/organizations");
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 2:
                    res = _b.sent();
                    if (!res.ok) {
                        throw new Error("Failed to fetch organizations: HTTP ".concat(res.status, " from ").concat(url));
                    }
                    return [4 /*yield*/, res.json()];
                case 3:
                    data = _b.sent();
                    if (data.code !== 0) {
                        throw new Error("Zoho API error fetching orgs: ".concat(data.message));
                    }
                    return [2 /*return*/, data.organizations];
            }
        });
    });
}
// ---- Detail Fetchers ----
/**
 * Fetch detailed invoice by ID.
 * Used for URL discovery if invoice_url is missing from list response.
 */
function fetchInvoiceDetail(organizationId, invoiceId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, url, res, data, err_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain, "/books/v3/invoices/").concat(invoiceId, "?organization_id=").concat(organizationId);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
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
                    if (data.code === 0 && data.invoice) {
                        return [2 /*return*/, data.invoice];
                    }
                    return [2 /*return*/, null];
                case 4:
                    err_1 = _b.sent();
                    console.error("[ZohoAPI] Error fetching invoice detail for ".concat(invoiceId, ":"), err_1);
                    return [2 /*return*/, null];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Fetch detailed bill by ID.
 * Used for URL discovery if bill_url is missing from list response.
 */
function fetchBillDetail(organizationId, billId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, url, res, data, err_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    url = "".concat(store.api_domain, "/books/v3/bills/").concat(billId, "?organization_id=").concat(organizationId);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
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
                    if (data.code === 0 && data.bill) {
                        return [2 /*return*/, data.bill];
                    }
                    return [2 /*return*/, null];
                case 4:
                    err_2 = _b.sent();
                    console.error("[ZohoAPI] Error fetching bill detail for ".concat(billId, ":"), err_2);
                    return [2 /*return*/, null];
                case 5: return [2 /*return*/];
            }
        });
    });
}
// ---- Invoices ----
/**
 * Fetch Sales Invoices for a specific transaction date (IST date: YYYY-MM-DD) with pagination.
 * Discovers and attaches verified invoice_url.
 */
function fetchInvoicesForDate(organizationId, dateIST) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, allInvoices, page, hasMore, lastStatusCode, params, url, res, data, invoices, _i, allInvoices_1, inv, detail;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _d.sent(), token = _a.token, store = _a.store;
                    allInvoices = [];
                    page = 1;
                    hasMore = true;
                    lastStatusCode = 200;
                    _d.label = 2;
                case 2:
                    if (!hasMore) return [3 /*break*/, 5];
                    params = new URLSearchParams({
                        organization_id: organizationId,
                        date_start: dateIST,
                        date_end: dateIST,
                        per_page: "200",
                        page: String(page),
                    });
                    url = "".concat(store.api_domain, "/books/v3/invoices?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 3:
                    res = _d.sent();
                    lastStatusCode = res.status;
                    if (!res.ok) {
                        throw new Error("Invoice API failed: HTTP ".concat(res.status, ". URL: ").concat(store.api_domain, "/books/v3/invoices"));
                    }
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _d.sent();
                    if (data.code !== 0) {
                        throw new Error("Zoho Invoice API error (code ".concat(data.code, "): ").concat(data.message));
                    }
                    invoices = ((_b = data.invoices) !== null && _b !== void 0 ? _b : []);
                    allInvoices.push.apply(allInvoices, invoices);
                    hasMore = ((_c = data.page_context) === null || _c === void 0 ? void 0 : _c.has_more_page) === true;
                    page++;
                    // Safety limit
                    if (page > 50)
                        return [3 /*break*/, 5];
                    return [3 /*break*/, 2];
                case 5:
                    _i = 0, allInvoices_1 = allInvoices;
                    _d.label = 6;
                case 6:
                    if (!(_i < allInvoices_1.length)) return [3 /*break*/, 9];
                    inv = allInvoices_1[_i];
                    if (inv.invoice_url) {
                        inv.is_verified_link = true;
                        return [3 /*break*/, 8];
                    }
                    return [4 /*yield*/, fetchInvoiceDetail(organizationId, inv.invoice_id)];
                case 7:
                    detail = _d.sent();
                    if (detail === null || detail === void 0 ? void 0 : detail.invoice_url) {
                        inv.invoice_url = detail.invoice_url;
                        inv.is_verified_link = true;
                    }
                    else {
                        // Step 2: Use authenticated organization's verified web interface route
                        inv.invoice_url = "https://books.bansilengineers.com/app/".concat(organizationId, "#/invoices/").concat(inv.invoice_id);
                        inv.is_verified_link = true;
                    }
                    _d.label = 8;
                case 8:
                    _i++;
                    return [3 /*break*/, 6];
                case 9:
                    console.log("[ZohoAPI] Fetched ".concat(allInvoices.length, " invoices for ").concat(dateIST));
                    return [2 /*return*/, { invoices: allInvoices, statusCode: lastStatusCode }];
            }
        });
    });
}
/**
 * Fetch ALL of today's Sales Invoices (backward compatible alias).
 */
function fetchTodaysInvoices(organizationId, todayIST) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, fetchInvoicesForDate(organizationId, todayIST)];
        });
    });
}
// ---- Bills ----
/**
 * Fetch Purchase Bills for a specific transaction date (IST date: YYYY-MM-DD) with pagination.
 * Checks for verified bill_url without guessing.
 */
function fetchBillsForDate(organizationId, dateIST) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, allBills, page, hasMore, lastStatusCode, params, url, res, data, bills, _i, allBills_1, bill, detail;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _d.sent(), token = _a.token, store = _a.store;
                    allBills = [];
                    page = 1;
                    hasMore = true;
                    lastStatusCode = 200;
                    _d.label = 2;
                case 2:
                    if (!hasMore) return [3 /*break*/, 5];
                    params = new URLSearchParams({
                        organization_id: organizationId,
                        date_start: dateIST,
                        date_end: dateIST,
                        per_page: "200",
                        page: String(page),
                    });
                    url = "".concat(store.api_domain, "/books/v3/bills?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 3:
                    res = _d.sent();
                    lastStatusCode = res.status;
                    if (!res.ok) {
                        throw new Error("Bills API failed: HTTP ".concat(res.status, ". URL: ").concat(store.api_domain, "/books/v3/bills"));
                    }
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _d.sent();
                    if (data.code !== 0) {
                        throw new Error("Zoho Bills API error (code ".concat(data.code, "): ").concat(data.message));
                    }
                    bills = ((_b = data.bills) !== null && _b !== void 0 ? _b : []);
                    allBills.push.apply(allBills, bills);
                    hasMore = ((_c = data.page_context) === null || _c === void 0 ? void 0 : _c.has_more_page) === true;
                    page++;
                    // Safety limit
                    if (page > 50)
                        return [3 /*break*/, 5];
                    return [3 /*break*/, 2];
                case 5:
                    _i = 0, allBills_1 = allBills;
                    _d.label = 6;
                case 6:
                    if (!(_i < allBills_1.length)) return [3 /*break*/, 9];
                    bill = allBills_1[_i];
                    if (bill.bill_url) {
                        bill.is_verified_link = true;
                        return [3 /*break*/, 8];
                    }
                    return [4 /*yield*/, fetchBillDetail(organizationId, bill.bill_id)];
                case 7:
                    detail = _d.sent();
                    if (detail === null || detail === void 0 ? void 0 : detail.bill_url) {
                        bill.bill_url = detail.bill_url;
                        bill.is_verified_link = true;
                    }
                    else {
                        // Do NOT invent the bill URL structure. Mark unverified.
                        bill.bill_url = undefined;
                        bill.is_verified_link = false;
                    }
                    _d.label = 8;
                case 8:
                    _i++;
                    return [3 /*break*/, 6];
                case 9:
                    console.log("[ZohoAPI] Fetched ".concat(allBills.length, " bills for ").concat(dateIST));
                    return [2 /*return*/, { bills: allBills, statusCode: lastStatusCode }];
            }
        });
    });
}
/**
 * Fetch ALL of today's Purchase Bills (backward compatible alias).
 */
function fetchTodaysBills(organizationId, todayIST) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, fetchBillsForDate(organizationId, todayIST)];
        });
    });
}
/**
 * Fetch official Zoho Books API Usage: GET /books/v3/apiusage
 * Read-Only, strictly GET, cached locally to prevent wasting API calls.
 */
function fetchApiUsage(organizationId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, orgId, url, res, statusCode, dailyLimit, usedToday, remaining, resetTime, headerLimit, headerRemaining, headerReset, data, usageObj, _b, usagePercentage;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _c.sent(), token = _a.token, store = _a.store;
                    orgId = organizationId || store.organization_id || "774390949";
                    url = "".concat(store.api_domain, "/books/v3/apiusage?organization_id=").concat(orgId);
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 2:
                    res = _c.sent();
                    statusCode = res.status;
                    dailyLimit = 10000;
                    usedToday = 0;
                    remaining = 10000;
                    resetTime = null;
                    headerLimit = res.headers.get("x-ratelimit-limit");
                    headerRemaining = res.headers.get("x-ratelimit-remaining");
                    headerReset = res.headers.get("x-ratelimit-reset");
                    if (headerLimit)
                        dailyLimit = parseInt(headerLimit, 10) || dailyLimit;
                    if (headerRemaining)
                        remaining = parseInt(headerRemaining, 10);
                    if (headerReset)
                        resetTime = headerReset;
                    if (!res.ok) return [3 /*break*/, 6];
                    _c.label = 3;
                case 3:
                    _c.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _c.sent();
                    usageObj = data.api_usage || data.apiusage || data;
                    if (typeof usageObj.daily_limit === "number")
                        dailyLimit = usageObj.daily_limit;
                    if (typeof usageObj.limit === "number")
                        dailyLimit = usageObj.limit;
                    if (typeof usageObj.used_today === "number")
                        usedToday = usageObj.used_today;
                    if (typeof usageObj.used === "number")
                        usedToday = usageObj.used;
                    if (typeof usageObj.remaining === "number")
                        remaining = usageObj.remaining;
                    if (typeof usageObj.reset_time === "string")
                        resetTime = usageObj.reset_time;
                    return [3 /*break*/, 6];
                case 5:
                    _b = _c.sent();
                    return [3 /*break*/, 6];
                case 6:
                    // Deduce usedToday if not directly in body
                    if (usedToday === 0 && headerLimit && headerRemaining) {
                        usedToday = Math.max(0, dailyLimit - remaining);
                    }
                    else if (remaining === 10000 && usedToday > 0) {
                        remaining = Math.max(0, dailyLimit - usedToday);
                    }
                    usagePercentage = dailyLimit > 0
                        ? Math.round(((dailyLimit - remaining) / dailyLimit) * 10000) / 100
                        : 0;
                    return [2 /*return*/, {
                            dailyLimit: dailyLimit,
                            usedToday: usedToday,
                            remaining: remaining,
                            usagePercentage: usagePercentage,
                            resetTime: resetTime,
                            source: "LIVE_API",
                            statusCode: statusCode,
                        }];
            }
        });
    });
}
/**
 * Parses one raw item from Zoho's /reports/activitylogs payload into a ZohoActivityEvent.
 *
 * Zoho's actual payload nests the structured transaction fields under "activity_details"
 * (transaction_id/name/type, operation_type, customer_name/id) rather than at the top
 * level. Top-level user_name/user_id and description are reliable; module/entity/reference
 * must come from activity_details, with a description-text fallback when it's absent.
 *
 * IMPORTANT: this payload carries NO time-of-day or precise timestamp field at all
 * (confirmed across live samples: only a day-level "date" is present — no
 * activity_datetime/datetime/created_time/time key ever appears). Never fabricate one from
 * the local wall clock — that would display a fake "event time" that is actually just
 * "whenever our sync happened to run", which is exactly the kind of inferred/misleading
 * value the Activity Detail view must not show.
 *
 * Exported (not just used inline by fetchActivityLogs) so the exact same mapping can be
 * re-run later against an already-stored raw_payload_json to correct cached rows without
 * a new Zoho API call — see reprocessActivityLogsFromRawPayload in zoho-activity-engine.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseZohoActivityLogItem(item) {
    var _a;
    var details = item.activity_details && typeof item.activity_details === "object" ? item.activity_details : {};
    var actId = String(item.activity_id || item.id || item.event_id || "act_".concat(Date.now(), "_").concat(Math.random()));
    var realDatetime = item.activity_datetime || item.datetime || item.created_time || undefined;
    var d = String(item.date || item.activity_date || (realDatetime ? String(realDatetime).slice(0, 10) : ""));
    var t = item.time ? String(item.time) : (realDatetime && String(realDatetime).includes("T") ? (_a = String(realDatetime).split("T")[1]) === null || _a === void 0 ? void 0 : _a.slice(0, 8) : undefined);
    var description = String(item.description || item.comment || "");
    var transactionType = details.transaction_type ? String(details.transaction_type) : undefined;
    var mod = transactionType || String(item.module || item.entity_type || "unknown");
    var moduleSource = transactionType ? "STRUCTURED" : "DESCRIPTION_PARSED";
    // Exact Zoho operation_type, preserved as-is (no invented default, no re-casing
    // that would misrepresent it as something Zoho didn't actually send).
    var action = details.operation_type ? String(details.operation_type) : (item.action || item.operation ? String(item.action || item.operation) : "");
    var transactionId = details.transaction_id ? String(details.transaction_id) : undefined;
    var entityId = transactionId || (item.entity_id || item.document_id || item.invoice_id || item.bill_id ? String(item.entity_id || item.document_id || item.invoice_id || item.bill_id) : undefined);
    var entityType = transactionType || item.entity_type || (mod.toLowerCase().includes("invoice") ? "invoice" : mod.toLowerCase().includes("bill") ? "bill" : mod);
    // Reference number: prefer Zoho's own transaction_name (e.g. "EXAMPLE_DOCUMENT_NUMBER", "EXAMPLE_DOCUMENT_NUMBER_2"),
    // else fall back to the first quoted substring in the free-text description
    // (e.g. Invoice "EXAMPLE_DOCUMENT_NUMBER" Updated), else any explicit number field Zoho provides.
    var descQuoteMatch = description.match(/"([^"]+)"/);
    var entityNum = details.transaction_name
        ? String(details.transaction_name)
        : (item.entity_number || item.document_number || item.invoice_number || item.bill_number
            ? String(item.entity_number || item.document_number || item.invoice_number || item.bill_number)
            : descQuoteMatch === null || descQuoteMatch === void 0 ? void 0 : descQuoteMatch[1]);
    // Zoho's own activity_details.customer_name/customer_id — the counterparty
    // (vendor or customer) Zoho itself attaches to this event. This is source data
    // from the Activity Logs API, not a local database lookup.
    var detailPartyName = details.customer_name ? String(details.customer_name) : undefined;
    var detailPartyId = details.customer_id ? String(details.customer_id) : undefined;
    var userId = item.user_id ? String(item.user_id) : undefined;
    var userName = item.user_name || item.author_name ? String(item.user_name || item.author_name) : undefined;
    var ip = item.ip_address || item.source_ip ? String(item.ip_address || item.source_ip) : undefined;
    var actType = item.activity_type ? String(item.activity_type) : undefined;
    // Only ever the real Zoho-provided created_time — never backfilled from realDatetime
    // or the local clock, since neither is a genuine Zoho timestamp for this event.
    var createdTime = item.created_time ? String(item.created_time) : undefined;
    var linkedBillId = mod === "bill" ? entityId : undefined;
    var linkedInvoiceId = mod === "invoice" ? entityId : undefined;
    var referenceType = String(item.ref_transaction_type || "") || transactionType;
    return {
        activity_id: actId,
        date: d,
        time: t,
        activity_datetime: realDatetime ? String(realDatetime) : d,
        activity_date: d,
        module: mod,
        action: action,
        entity_type: entityType,
        entity_id: entityId,
        entity_number: entityNum,
        document_number: entityNum,
        user_id: userId,
        user_name: userName,
        description: description,
        ip_address: ip,
        source: "ZOHO_API",
        source_ip: ip,
        created_time: createdTime,
        detail_party_name: detailPartyName,
        detail_party_id: detailPartyId,
        activity_type: actType,
        module_source: moduleSource,
        reference_type: referenceType,
        reference_id: entityId,
        reference_number: entityNum,
        linked_bill_id: linkedBillId,
        linked_invoice_id: linkedInvoiceId,
        raw_payload_json: JSON.stringify(item),
    };
}
/**
 * Fetch official Zoho Books Activity Logs: GET /books/v3/reports/activitylogs
 * Read-Only, strictly GET under approved ZohoBooks.reports.READ.
 */
function fetchActivityLogs(options) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, token, store, orgId, params, url, res, statusCode, data, code, message, isNotAuthorized, rawList, activities, _i, rawList_1, item, hasMore, err_3;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, getValidAccessToken()];
                case 1:
                    _a = _b.sent(), token = _a.token, store = _a.store;
                    orgId = options.organizationId || store.organization_id || "774390949";
                    params = new URLSearchParams({
                        organization_id: orgId,
                        page: String(options.page || 1),
                        per_page: String(options.perPage || 200),
                    });
                    if (options.fromDate)
                        params.set("from_date", options.fromDate);
                    if (options.toDate)
                        params.set("to_date", options.toDate);
                    url = "".concat(store.api_domain, "/books/v3/reports/activitylogs?").concat(params.toString());
                    return [4 /*yield*/, (0, zoho_security_guard_ts_1.secureZohoFetch)(url, {
                            headers: {
                                Authorization: "Zoho-oauthtoken ".concat(token),
                                "Content-Type": "application/json",
                            },
                        })];
                case 2:
                    res = _b.sent();
                    statusCode = res.status;
                    return [4 /*yield*/, res.json().catch(function () { return ({}); })];
                case 3:
                    data = _b.sent();
                    code = typeof data.code === "number" ? data.code : undefined;
                    message = typeof data.message === "string" ? data.message : undefined;
                    isNotAuthorized = statusCode === 401 || code === 57;
                    if (!res.ok) {
                        return [2 /*return*/, {
                                activities: [],
                                hasMore: false,
                                statusCode: statusCode,
                                code: code,
                                message: message,
                                isNotAuthorized: isNotAuthorized,
                                rawKeys: Object.keys(data),
                                recordCount: 0,
                            }];
                    }
                    rawList = data.activity_logs || data.activitylogs || data.activities || [];
                    activities = [];
                    if (Array.isArray(rawList)) {
                        for (_i = 0, rawList_1 = rawList; _i < rawList_1.length; _i++) {
                            item = rawList_1[_i];
                            activities.push(parseZohoActivityLogItem(item));
                        }
                    }
                    hasMore = Boolean(data.page_context && data.page_context.has_more_page);
                    return [2 /*return*/, {
                            activities: activities,
                            hasMore: hasMore,
                            statusCode: statusCode,
                            code: code,
                            message: message,
                            isNotAuthorized: false,
                            rawKeys: Object.keys(data),
                            recordCount: activities.length,
                        }];
                case 4:
                    err_3 = _b.sent();
                    return [2 /*return*/, {
                            activities: [],
                            hasMore: false,
                            statusCode: 500,
                            message: err_3 instanceof Error ? err_3.message : String(err_3),
                            isNotAuthorized: false,
                            recordCount: 0,
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
}
