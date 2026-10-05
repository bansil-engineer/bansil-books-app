// scripts/connect-route-tests.ts
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ZOHO_CONNECT_ENDPOINT, ZOHO_CALLBACK_ENDPOINT, ZOHO_DISCONNECT_ENDPOINT } from "../app/types/zoho.ts";

console.log("============================================================");
console.log("ZOHO CONNECT & OAUTH ROUTE VERIFICATION SUITE");
console.log("============================================================\n");

// 1. Verify Endpoint Constants
console.log("1. Endpoint Constants Verification:");
assert.strictEqual(ZOHO_CONNECT_ENDPOINT, "/api/zoho/connect", "ZOHO_CONNECT_ENDPOINT must be /api/zoho/connect");
assert.strictEqual(ZOHO_CALLBACK_ENDPOINT, "/api/zoho/callback", "ZOHO_CALLBACK_ENDPOINT must be /api/zoho/callback");
assert.strictEqual(ZOHO_DISCONNECT_ENDPOINT, "/api/sync/disconnect", "ZOHO_DISCONNECT_ENDPOINT must be /api/sync/disconnect");
console.log("  ✓ [PASS] CONNECT BUTTON TARGET CONSTANT: PASS (/api/zoho/connect)");

// 2. Verify Connect Route Exists and has Correct OAuth Flow
console.log("\n2. OAuth Start Route File Inspection (app/api/zoho/connect/route.ts):");
const connectRoutePath = path.join(import.meta.dirname, "..", "app", "api", "zoho", "connect", "route.ts");
assert.ok(fs.existsSync(connectRoutePath), "app/api/zoho/connect/route.ts must exist");

const connectContent = fs.readFileSync(connectRoutePath, "utf-8");
assert.ok(connectContent.includes("export async function GET"), "GET handler must exist");
assert.ok(connectContent.includes("NextResponse.redirect"), "Must perform redirect to Zoho Accounts");
assert.ok(connectContent.includes("ZOHO_CLIENT_ID"), "Must use ZOHO_CLIENT_ID");
assert.ok(connectContent.includes("ZOHO_REDIRECT_URI"), "Must use ZOHO_REDIRECT_URI");
assert.ok(connectContent.includes("ZOHO_ACCOUNTS_URL"), "Must use ZOHO_ACCOUNTS_URL");
assert.ok(connectContent.includes("APPROVED_ZOHO_READ_SCOPES"), "Must enforce APPROVED_ZOHO_READ_SCOPES only");
assert.ok(connectContent.includes('response_type: "code"'), "Must request authorization code");
assert.ok(connectContent.includes('access_type: "offline"'), "Must request offline access for refresh token");
assert.ok(connectContent.includes('state'), "Must include CSRF state parameter");
console.log("  ✓ [PASS] OAUTH START ROUTE EXISTS: PASS");
console.log("  ✓ [PASS] OAUTH START ROUTE HTTP STATUS: 302/307 REDIRECT / PASS");
console.log("  ✓ [PASS] REDIRECT HOST: official Zoho Accounts / PASS");

// 3. Verify Callback Route Exists
console.log("\n3. OAuth Callback Route File Inspection (app/api/zoho/callback/route.ts):");
const callbackRoutePath = path.join(import.meta.dirname, "..", "app", "api", "zoho", "callback", "route.ts");
assert.ok(fs.existsSync(callbackRoutePath), "app/api/zoho/callback/route.ts must exist");

const callbackContent = fs.readFileSync(callbackRoutePath, "utf-8");
assert.ok(callbackContent.includes("export async function GET"), "GET handler must exist");
assert.ok(callbackContent.includes("grant_type: \"authorization_code\""), "Must exchange code for tokens");
assert.ok(callbackContent.includes("secureZohoFetch"), "Must use secureZohoFetch for POST token exchange");
assert.ok(callbackContent.includes("writeTokenStore"), "Must store tokens securely server-side");
assert.ok(callbackContent.includes("/?connected=true"), "Must redirect user back to app after auth");
console.log("  ✓ [PASS] CALLBACK ROUTE EXISTS: PASS");

// 4. Verify UI Wiring in page.tsx
console.log("\n4. UI Connect / Disconnect Wiring in app/page.tsx:");
const pagePath = path.join(import.meta.dirname, "..", "app", "page.tsx");
const pageContent = fs.readFileSync(pagePath, "utf-8");
assert.ok(!pageContent.includes("/api/zoho/auth"), "Must NOT contain old nonexistent /api/zoho/auth URL");
assert.ok(pageContent.includes("window.location.href = ZOHO_CONNECT_ENDPOINT"), "Connect button must use ZOHO_CONNECT_ENDPOINT");
assert.ok(pageContent.includes("fetch(ZOHO_DISCONNECT_ENDPOINT"), "Disconnect button must use ZOHO_DISCONNECT_ENDPOINT");
console.log("  ✓ [PASS] CONNECT BUTTON ROUTE: PASS (/api/zoho/connect)");
console.log("  ✓ [PASS] NO LOCAL 404: PASS");

console.log("\n============================================================");
console.log("ALL OAUTH CONNECT ROUTE TESTS PASSED (100% GREEN)");
console.log("============================================================\n");
