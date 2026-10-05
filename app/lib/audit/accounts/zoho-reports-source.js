"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZohoTrialBalance = getZohoTrialBalance;
const zoho_security_guard_ts_1 = require("../../zoho-security-guard.ts");
const database_ts_1 = require("../../db/database.ts");
function resolveOrganizationId() {
    const db = (0, database_ts_1.getDatabase)();
    const org = db.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get();
    if (!org) {
        throw new Error("No organization context found. Organization ID cannot be resolved.");
    }
    return org.organization_id;
}
const zoho_api_ts_1 = require("../../zoho-api.ts");
async function getZohoTrialBalance(fromDate, toDate) {
    const orgId = resolveOrganizationId();
    const { token, store } = await (0, zoho_api_ts_1.getValidAccessToken)();
    const query = new URLSearchParams({
        organization_id: orgId,
        from_date: fromDate,
        to_date: toDate,
        response_option: '2'
    });
    const response = await (0, zoho_security_guard_ts_1.secureZohoFetch)(`${store.api_domain}/books/v3/reports/trialbalance?${query.toString()}`, {
        headers: {
            Authorization: `Zoho-oauthtoken ${token}`
        }
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch Trial Balance: Status ${response.status} ${response.statusText} - Body: ${errorText}`);
    }
    const data = await response.json();
    if (data.code !== 0) {
        throw new Error(`Zoho API Error: ${data.message}`);
    }
    return data;
}
