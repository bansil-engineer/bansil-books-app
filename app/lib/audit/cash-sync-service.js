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
exports.getGenuineCashAccounts = getGenuineCashAccounts;
exports.syncCashAccounts = syncCashAccounts;
var audit_database_1 = require("../db/audit-database");
var zoho_token_store_1 = require("../zoho-token-store");
var zoho_read_source_1 = require("./accounts/zoho-read-source");
var pre_audit_sync_service_1 = require("./pre-audit-sync-service");
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
// 1. Genuine Cash Account identification
function getGenuineCashAccounts() {
    var coaPath = path_1.default.join(process.cwd(), "coa.json");
    var cashAccounts = [];
    var uniqueAccountIds = new Set();
    try {
        var data = JSON.parse(fs_1.default.readFileSync(coaPath, "utf-8"));
        var accounts = Array.isArray(data) ? data : (data.chartofaccounts || []);
        for (var _i = 0, accounts_1 = accounts; _i < accounts_1.length; _i++) {
            var acc = accounts_1[_i];
            if (acc.account_type === "cash" && !uniqueAccountIds.has(acc.account_id)) {
                uniqueAccountIds.add(acc.account_id);
                cashAccounts.push({
                    account_id: acc.account_id,
                    account_name: acc.account_name,
                    account_type: acc.account_type
                });
            }
        }
    }
    catch (e) {
        console.error("Error reading COA for cash accounts:", e);
    }
    return cashAccounts;
}
function syncCashAccounts() {
    return __awaiter(this, arguments, void 0, function (fy) {
        var tokens, orgId, fromDate, toDate, cashAccounts, db, source_run_id, results, _i, cashAccounts_1, account, res, created, updated, reversedTransactions, _a, _b, _c, index, tx, stmt, result, apiErr_1;
        if (fy === void 0) { fy = "2025-26"; }
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    tokens = (0, zoho_token_store_1.readTokenStore)();
                    if (!tokens || !tokens.access_token) {
                        throw new Error("Zoho not connected");
                    }
                    orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "774390949";
                    fromDate = fy === "2025-26" ? "2025-04-01" : "2024-04-01";
                    toDate = fy === "2025-26" ? "2026-03-31" : "2025-03-31";
                    cashAccounts = getGenuineCashAccounts();
                    db = (0, audit_database_1.getAuditDatabase)();
                    source_run_id = "CASH_SYNC_".concat(Date.now());
                    db.prepare("\n    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status, api_domain, records_seen, records_written)\n    VALUES (?, ?, 'cash_sync', ?, ?, 'SUCCESS', ?, 0, 0)\n    ON CONFLICT(source_run_id) DO UPDATE SET completed_at=excluded.completed_at\n  ").run(source_run_id, orgId, new Date().toISOString(), new Date().toISOString(), tokens.api_domain || "");
                    results = [];
                    _i = 0, cashAccounts_1 = cashAccounts;
                    _d.label = 1;
                case 1:
                    if (!(_i < cashAccounts_1.length)) return [3 /*break*/, 6];
                    account = cashAccounts_1[_i];
                    _d.label = 2;
                case 2:
                    _d.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, zoho_read_source_1.listCashAccountTransactions)(orgId, account.account_id, {
                            from_date: fromDate,
                            to_date: toDate
                        })];
                case 3:
                    res = _d.sent();
                    created = 0;
                    updated = 0;
                    db.exec('BEGIN TRANSACTION');
                    try {
                        reversedTransactions = __spreadArray([], res.transactions, true).reverse();
                        for (_a = 0, _b = reversedTransactions.entries(); _a < _b.length; _a++) {
                            _c = _b[_a], index = _c[0], tx = _c[1];
                            stmt = db.prepare("\n            INSERT INTO audit_zoho_bank_transactions (\n              organization_id, transaction_id, source_run_id, account_id, account_name,\n              date, amount, transaction_type, status, source, debit_or_credit,\n              reference_number, payee, description, currency_code, imported_transaction_id, fetched_at, running_balance, api_sequence\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n            ON CONFLICT(organization_id, account_id, transaction_id) DO UPDATE SET\n              source_run_id=excluded.source_run_id,\n              date=excluded.date,\n              amount=excluded.amount,\n              status=excluded.status,\n              fetched_at=excluded.fetched_at,\n              running_balance=excluded.running_balance,\n              api_sequence=excluded.api_sequence\n          ");
                            result = stmt.run(orgId, tx.transaction_id, source_run_id, tx.account_id, tx.account_name || null, tx.date, tx.amount, tx.transaction_type, tx.status, tx.source || null, tx.debit_or_credit || null, tx.reference_number || null, tx.payee || null, tx.description || null, tx.currency_code || null, tx.imported_transaction_id || null, new Date().toISOString(), tx.running_balance !== undefined ? tx.running_balance : null, index);
                            if (result.changes > 0)
                                created++;
                        }
                        db.exec('COMMIT');
                        (0, pre_audit_sync_service_1.advanceWatermarkSuccess)("BANK_TRANSACTIONS", fy, account.account_id, toDate, res.transactions.length, 1, undefined, orgId);
                        results.push({
                            account_id: account.account_id,
                            account_name: account.account_name,
                            records: res.transactions.length,
                            status: "SUCCESS"
                        });
                    }
                    catch (dbErr) {
                        console.error("DB Error on account", account.account_name, dbErr);
                        db.exec('ROLLBACK');
                        (0, pre_audit_sync_service_1.recordWatermarkAttempt)("BANK_TRANSACTIONS", fy, account.account_id, "FAILED", 1, orgId);
                        results.push({
                            account_id: account.account_id,
                            account_name: account.account_name,
                            records: 0,
                            status: "FAILED"
                        });
                    }
                    return [3 /*break*/, 5];
                case 4:
                    apiErr_1 = _d.sent();
                    console.error("API Error on account", account.account_name, apiErr_1);
                    (0, pre_audit_sync_service_1.recordWatermarkAttempt)("BANK_TRANSACTIONS", fy, account.account_id, "FAILED", 1, orgId);
                    results.push({
                        account_id: account.account_id,
                        account_name: account.account_name,
                        records: 0,
                        status: "FAILED"
                    });
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6: return [2 /*return*/, results];
            }
        });
    });
}
