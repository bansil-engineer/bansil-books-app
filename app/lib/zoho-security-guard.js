"use strict";
// ============================================================
// Zoho Read-Only Security Guard — Hardened Security Layer
// Enforces ABSOLUTE READ-ONLY access to Zoho Books.
// Zero authorization for write, mutation, or scope expansion.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZOHO_SECURITY_POLICY = exports.APPROVED_ZOHO_READ_SCOPES = void 0;
exports.assertApprovedScopes = assertApprovedScopes;
exports.logBlockedSecurityAttempt = logBlockedSecurityAttempt;
exports.getSecurityLogEntries = getSecurityLogEntries;
exports.isZohoHost = isZohoHost;
exports.isZohoAccountsHost = isZohoAccountsHost;
exports.assertZohoReadOnlyRequest = assertZohoReadOnlyRequest;
exports.secureZohoFetch = secureZohoFetch;
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
// ============================================================
// 1. Immutable Approved Scopes
// ============================================================
exports.APPROVED_ZOHO_READ_SCOPES = Object.freeze([
    "ZohoBooks.settings.READ",
    "ZohoBooks.invoices.READ",
    "ZohoBooks.bills.READ",
    "ZohoBooks.reports.READ",
    "ZohoBooks.accountants.READ",
    "ZohoBooks.banking.READ",
    "ZohoBooks.customerpayments.READ",
    "ZohoBooks.vendorpayments.READ",
    "ZohoBooks.creditnotes.READ",
    "ZohoBooks.debitnotes.READ",
    "ZohoBooks.salesorders.READ",
    "ZohoBooks.purchaseorders.READ",
    "ZohoBooks.expenses.READ",
]);
function assertApprovedScopes(scopes) {
    for (var _i = 0, scopes_1 = scopes; _i < scopes_1.length; _i++) {
        var s = scopes_1[_i];
        var upper = s.toUpperCase().trim();
        if (upper.includes(".ALL") ||
            upper.includes(".CREATE") ||
            upper.includes(".UPDATE") ||
            upper.includes(".DELETE") ||
            !upper.endsWith(".READ")) {
            var msg = "SECURITY POLICY VIOLATION: Scope '".concat(s, "' contains write or unapproved permissions.");
            logBlockedSecurityAttempt("OAUTH_SCOPE_CHECK", "SCOPE_VIOLATION", msg);
            throw new Error(msg);
        }
    }
}
// ============================================================
// Security Policy Status
// ============================================================
exports.ZOHO_SECURITY_POLICY = {
    ACCESS_MODE: "READ ONLY",
    WRITE_ACCESS: "DISABLED",
    CREATE: "BLOCKED",
    UPDATE: "BLOCKED",
    DELETE: "BLOCKED",
    VOID: "BLOCKED",
    PAYMENT_WRITE: "BLOCKED",
    SOURCE_DATA_MODIFICATION: "BLOCKED",
    AI_DATA_SHARING: "DISABLED",
    LOCAL_DATABASE_WRITES: "ENABLED",
};
var SECURITY_LOG_FILE = path_1.default.join(process.cwd(), ".security-audit.log");
/**
 * Appends a blocked mutation attempt to the local runtime audit log.
 * Strictly avoids logging secrets, tokens, auth headers, or payloads.
 */
function logBlockedSecurityAttempt(method, sanitizedCategory, reason) {
    try {
        var entry = {
            timestamp: new Date().toISOString(),
            method: (method || "UNKNOWN").toUpperCase(),
            sanitizedCategory: sanitizedCategory,
            reason: reason,
        };
        var line = JSON.stringify(entry) + "\n";
        fs_1.default.appendFileSync(SECURITY_LOG_FILE, line, "utf-8");
    }
    catch (err) {
        console.error("[SecurityGuard] Failed to write security log:", err);
    }
}
/**
 * Returns recent security audit log entries.
 */
function getSecurityLogEntries() {
    try {
        if (!fs_1.default.existsSync(SECURITY_LOG_FILE))
            return [];
        var content = fs_1.default.readFileSync(SECURITY_LOG_FILE, "utf-8");
        return content
            .split("\n")
            .filter(function (l) { return l.trim().length > 0; })
            .map(function (l) { return JSON.parse(l); });
    }
    catch (_a) {
        return [];
    }
}
// Strict domain regex patterns preventing malicious subdomains/suffixes
var ZOHO_DOMAIN_REGEX = /^(?:[a-zA-Z0-9-]+\.)*(?:zoho|zohoapis)\.(com|in|eu|com\.au|jp|ca|uk)$/i;
var ZOHO_ACCOUNTS_REGEX = /^accounts\.zoho\.(com|in|eu|com\.au|jp|ca|uk)$/i;
/**
 * Strict parsed hostname validation.
 * Rejects suffix tricks like zoho.com.evil.example or evilzoho.com.
 */
function isZohoHost(hostname) {
    if (!hostname || typeof hostname !== "string")
        return false;
    var clean = hostname.trim().toLowerCase();
    return ZOHO_DOMAIN_REGEX.test(clean);
}
/**
 * Validates whether the host is an official Zoho Accounts host.
 */
function isZohoAccountsHost(hostname) {
    if (!hostname || typeof hostname !== "string")
        return false;
    var clean = hostname.trim().toLowerCase();
    return ZOHO_ACCOUNTS_REGEX.test(clean);
}
/**
 * Extracts and inspects headers for method override attempts.
 */
function hasMethodOverrideHeaders(headers) {
    if (!headers)
        return false;
    var forbiddenHeaders = [
        "x-http-method-override",
        "x-method-override",
        "x-http-method",
        "_method",
    ];
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
        for (var _i = 0, forbiddenHeaders_1 = forbiddenHeaders; _i < forbiddenHeaders_1.length; _i++) {
            var h = forbiddenHeaders_1[_i];
            if (headers.has(h))
                return true;
        }
        return false;
    }
    if (Array.isArray(headers)) {
        for (var _a = 0, headers_1 = headers; _a < headers_1.length; _a++) {
            var key = headers_1[_a][0];
            if (forbiddenHeaders.includes(key.toLowerCase()))
                return true;
        }
        return false;
    }
    if (typeof headers === "object") {
        for (var _b = 0, _c = Object.keys(headers); _b < _c.length; _b++) {
            var key = _c[_b];
            if (forbiddenHeaders.includes(key.toLowerCase()))
                return true;
        }
    }
    return false;
}
/**
 * Centralized security guard:
 * Inspects target URL, Request objects, hostname, and HTTP method.
 *
 * ALLOWED:
 * - GET requests to Zoho Books API (/books/v3/*, /books/v4/*)
 * - POST requests ONLY to official Zoho Accounts OAuth token endpoint (/oauth/v2/token)
 *
 * BLOCKED:
 * - ANY POST, PUT, PATCH, DELETE, or other mutation to Zoho Books API.
 * - Method override headers (X-HTTP-Method-Override).
 * - Non-token POST endpoints on accounts.zoho.*.
 * - Malformed, un-normalized, or untrusted hostnames.
 */
function assertZohoReadOnlyRequest(target, initOrMethod, headers) {
    var rawUrl;
    var method = "GET";
    var checkHeaders = headers;
    // Extract from Request object if provided
    if (typeof Request !== "undefined" && target instanceof Request) {
        rawUrl = target.url;
        method = target.method;
        checkHeaders = target.headers;
    }
    else if (typeof target === "string") {
        rawUrl = target;
    }
    else if (target instanceof URL) {
        rawUrl = target.href;
    }
    else if (typeof target === "object" && target !== null && "url" in target) {
        var reqObj = target;
        rawUrl = reqObj.url;
        if (reqObj.method)
            method = reqObj.method;
        if (reqObj.headers)
            checkHeaders = reqObj.headers;
    }
    else {
        rawUrl = String(target);
    }
    // Check initOrMethod overrides
    if (typeof initOrMethod === "string") {
        method = initOrMethod;
    }
    else if (initOrMethod && typeof initOrMethod === "object") {
        if (initOrMethod.method) {
            method = initOrMethod.method;
        }
        if (initOrMethod.headers) {
            checkHeaders = initOrMethod.headers;
        }
    }
    var upperMethod = (method || "GET").toUpperCase().trim();
    // 1. Check for Method Override headers
    if (hasMethodOverrideHeaders(checkHeaders)) {
        var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Method override headers (e.g. X-HTTP-Method-Override) are strictly prohibited";
        logBlockedSecurityAttempt(upperMethod, "METHOD_OVERRIDE_HEADER", errorMsg);
        throw new Error(errorMsg);
    }
    // 2. Parse URL safely
    var parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    }
    catch (_a) {
        var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Invalid URL format";
        logBlockedSecurityAttempt(upperMethod, "INVALID_URL", errorMsg);
        throw new Error(errorMsg);
    }
    var hostname = parsedUrl.hostname.toLowerCase();
    // 3. Inspect hostname with strict regex
    if (!isZohoHost(hostname)) {
        var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Untrusted non-Zoho host ".concat(hostname);
        logBlockedSecurityAttempt(upperMethod, "UNTRUSTED_HOST", errorMsg);
        throw new Error(errorMsg);
    }
    // 4. Path normalization & decode protection
    var normalizedPath;
    try {
        var decoded = decodeURIComponent(parsedUrl.pathname);
        normalizedPath = path_1.default.posix.normalize(decoded).toLowerCase();
    }
    catch (_b) {
        var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Malformed or unparseable URL path";
        logBlockedSecurityAttempt(upperMethod, "MALFORMED_PATH", errorMsg);
        throw new Error(errorMsg);
    }
    // 5. Narrow OAuth POST Exception:
    // POST is permitted ONLY to legitimate /oauth/v2/token on accounts.zoho.*
    var isAccountsHost = isZohoAccountsHost(hostname);
    var isTokenEndpoint = normalizedPath === "/oauth/v2/token";
    if (isAccountsHost) {
        if (isTokenEndpoint) {
            if (upperMethod === "POST") {
                return; // Permitted ONLY for token exchange and refresh
            }
            var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Method ".concat(upperMethod, " not allowed on OAuth token endpoint (POST only)");
            logBlockedSecurityAttempt(upperMethod, "OAUTH_TOKEN_ENDPOINT", errorMsg);
            throw new Error(errorMsg);
        }
        // Any other accounts endpoint with mutation is blocked
        if (upperMethod !== "GET") {
            var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: ".concat(upperMethod, " is prohibited on Accounts endpoint ").concat(normalizedPath);
            logBlockedSecurityAttempt(upperMethod, "ACCOUNTS_ENDPOINT", errorMsg);
            throw new Error(errorMsg);
        }
    }
    // 6. Zoho Books Service API Endpoints (/books/v3/*, /books/v4/*, etc.)
    var isBooksEndpoint = normalizedPath.includes("/books/") ||
        normalizedPath.startsWith("/books/v3") ||
        normalizedPath.startsWith("/books/v4");
    if (isBooksEndpoint) {
        if (upperMethod !== "GET") {
            var sanitizedCat = normalizedPath.includes("/invoices")
                ? "BOOKS_INVOICES"
                : normalizedPath.includes("/bills")
                    ? "BOOKS_BILLS"
                    : normalizedPath.includes("/payments")
                        ? "BOOKS_PAYMENTS"
                        : normalizedPath.includes("/contacts")
                            ? "BOOKS_CONTACTS"
                            : "BOOKS_API_MUTATION";
            var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: ".concat(upperMethod, " is strictly prohibited on Zoho Books API. Zoho Books access is READ-ONLY.");
            logBlockedSecurityAttempt(upperMethod, sanitizedCat, errorMsg);
            throw new Error(errorMsg);
        }
        return; // GET on Books API is permitted
    }
    // 7. Any other Zoho endpoint: Allow only GET
    if (upperMethod !== "GET") {
        var errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: ".concat(upperMethod, " is prohibited on endpoint ").concat(normalizedPath);
        logBlockedSecurityAttempt(upperMethod, "UNKNOWN_ZOHO_ENDPOINT", errorMsg);
        throw new Error(errorMsg);
    }
}
/**
 * Secure wrapper around fetch for all Zoho requests.
 * - Passes request through assertZohoReadOnlyRequest before sending.
 * - Uses redirect: "manual" and validates redirect destinations to prevent redirect/SSRF bypass.
 */
function secureZohoFetch(input, init) {
    return __awaiter(this, void 0, void 0, function () {
        var options, response, location_1, currentUrl, nextUrl;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // 1. Validate initial request
                    assertZohoReadOnlyRequest(input, init);
                    options = __assign(__assign({}, init), { redirect: "manual" });
                    return [4 /*yield*/, require("./external-connections.cjs").connectionFetch("zoho", input, options)];
                case 1:
                    response = _a.sent();
                    // 3. Validate redirects (301, 302, 303, 307, 308)
                    if (response.status >= 300 &&
                        response.status < 400 &&
                        response.headers.has("location")) {
                        location_1 = response.headers.get("location");
                        currentUrl = void 0;
                        if (typeof input === "string")
                            currentUrl = input;
                        else if (input instanceof URL)
                            currentUrl = input.href;
                        else
                            currentUrl = input.url;
                        nextUrl = new URL(location_1, currentUrl);
                        // Validate that the redirect destination is trusted and read-only
                        assertZohoReadOnlyRequest(nextUrl, "GET");
                        // Re-fetch next location safely
                        return [2 /*return*/, require("./external-connections.cjs").connectionFetch("zoho", nextUrl.href, __assign(__assign({}, init), { method: "GET", redirect: "manual" }))];
                    }
                    return [2 /*return*/, response];
            }
        });
    });
}
