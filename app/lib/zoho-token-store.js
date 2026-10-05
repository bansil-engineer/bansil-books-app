"use strict";
// ============================================================
// Zoho Token Store — server-side only
// Stores tokens in .tokens.json in the project root.
// NEVER import this in client components.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTokenStore = readTokenStore;
exports.writeTokenStore = writeTokenStore;
exports.clearTokenStore = clearTokenStore;
exports.isAccessTokenValid = isAccessTokenValid;
exports.updateAccessToken = updateAccessToken;
exports.updateOrganization = updateOrganization;
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
// Token file lives at project root, git-ignored
var TOKEN_FILE = path_1.default.join(process.cwd(), ".tokens.json");
/**
 * Read the token store from disk.
 * Returns null if file doesn't exist or is invalid.
 */
function readTokenStore() {
    try {
        if (!fs_1.default.existsSync(TOKEN_FILE)) {
            return null;
        }
        var raw = fs_1.default.readFileSync(TOKEN_FILE, "utf-8");
        var parsed = JSON.parse(raw);
        // Basic validation
        if (!parsed.access_token || !parsed.refresh_token) {
            return null;
        }
        return parsed;
    }
    catch (_a) {
        // Don't log token content
        console.error("[TokenStore] Failed to read token file");
        return null;
    }
}
/**
 * Write the token store to disk.
 * Merges with existing data so partial updates are safe.
 */
function writeTokenStore(data) {
    var _a;
    try {
        var existing = (_a = readTokenStore()) !== null && _a !== void 0 ? _a : {};
        var updated = __assign(__assign({}, existing), data);
        fs_1.default.writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2), "utf-8");
    }
    catch (_b) {
        console.error("[TokenStore] Failed to write token file");
        throw new Error("Failed to save authentication tokens");
    }
}
/**
 * Delete the token store (disconnect).
 */
function clearTokenStore() {
    try {
        if (fs_1.default.existsSync(TOKEN_FILE)) {
            fs_1.default.unlinkSync(TOKEN_FILE);
        }
    }
    catch (_a) {
        console.error("[TokenStore] Failed to clear token file");
    }
}
/**
 * Check if a valid (non-expired) access token exists.
 * Considers token expired if within 5 minutes of expiry.
 */
function isAccessTokenValid(store) {
    var bufferMs = 5 * 60 * 1000; // 5 minutes
    return Date.now() < store.expires_at - bufferMs;
}
/**
 * Update only the access token fields after a refresh.
 */
function updateAccessToken(accessToken, expiresInSeconds) {
    writeTokenStore({
        access_token: accessToken,
        expires_at: Date.now() + expiresInSeconds * 1000,
    });
}
/**
 * Update the selected organization in the token store.
 */
function updateOrganization(organizationId, organizationName, currencyCode, currencySymbol) {
    writeTokenStore({
        organization_id: organizationId,
        organization_name: organizationName,
        currency_code: currencyCode,
        currency_symbol: currencySymbol,
    });
}
