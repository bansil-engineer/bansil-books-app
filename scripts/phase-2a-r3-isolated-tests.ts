// ============================================================
// Phase 2A-R3 — ISOLATED Real-Code Behavioral Tests
//
// SAFETY: All token operations use an isolated temporary file.
// The operational .tokens.json is NEVER read or written by these tests.
//
// BEFORE any application module is imported:
//   1. NODE_ENV is set to "test"
//   2. A unique temp directory is created via fs.mkdtempSync
//   3. BANSIL_TEST_ZOHO_TOKEN_FILE points to a file inside that temp dir
//   4. A hard safety assertion verifies the paths differ
//
// Run: cd <project-root> && tsx scripts/phase-2a-r3-isolated-tests.ts
// ============================================================

// ---- STEP 0: Set env BEFORE any app imports ----
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execSync } from "child_process";

process.env.NODE_ENV = "test";

const OPERATIONAL_TOKEN_FILE = path.join(process.cwd(), ".tokens.json");
const TEST_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-test-tokens-"));
const TEST_TOKEN_FILE = path.join(TEST_TMP_DIR, ".tokens.json");

process.env.BANSIL_TEST_ZOHO_TOKEN_FILE = TEST_TOKEN_FILE;

// ---- HARD SAFETY: abort before any work if paths collide ----
if (path.resolve(TEST_TOKEN_FILE) === path.resolve(OPERATIONAL_TOKEN_FILE)) {
  console.error("SAFETY ABORT: Test token path resolves to the operational .tokens.json!");
  process.exit(99);
}

console.log(`[SAFETY] Operational token file: ${OPERATIONAL_TOKEN_FILE}`);
console.log(`[SAFETY] Test token file:        ${TEST_TOKEN_FILE}`);
console.log(`[SAFETY] Paths differ:           YES`);

// ---- Capture operational token file hash BEFORE tests ----
let operationalHashBefore: string | null = null;
let operationalMtimeBefore: number | null = null;

if (fs.existsSync(OPERATIONAL_TOKEN_FILE)) {
  const content = fs.readFileSync(OPERATIONAL_TOKEN_FILE);
  operationalHashBefore = crypto.createHash("sha256").update(content).digest("hex");
  operationalMtimeBefore = fs.statSync(OPERATIONAL_TOKEN_FILE).mtimeMs;
  console.log(`[SAFETY] Operational file hash (before): ${operationalHashBefore.substring(0, 16)}...`);
} else {
  console.log(`[SAFETY] Operational file does not exist (before tests)`);
}

// ---- NOW import application modules ----
import { NextRequest } from "next/server";
import {
  readTokenStore,
  writeTokenStore,
  clearTokenStore,
  isAccessTokenValid,
} from "@/app/lib/zoho-token-store";

// ---- Test infrastructure ----

let passed = 0;
let failed = 0;
const results: { group: string; id: string; label: string; ok: boolean; detail?: string }[] = [];

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function test(group: string, id: string, label: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    results.push({ group, id, label, ok: true });
    console.log(`  ✅ ${id}: ${label}`);
  } catch (err) {
    failed++;
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ group, id, label, ok: false, detail });
    console.log(`  ❌ ${id}: ${label}`);
    console.log(`     ${detail}`);
  }
}

// ---- Fetch mock infrastructure ----

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
let fetchCallLog: { url: string; method: string }[] = [];

function installFetchMock(handler: FetchHandler) {
  fetchCallLog = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || "GET";
    fetchCallLog.push({ url, method });
    return handler(input, init);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  fetchCallLog = [];
}

// ---- Token store manipulation (operates on TEST_TOKEN_FILE only) ----

function nukeTokenStore() {
  // Write invalid credentials to the TEST token file
  // readFromFile returns null when !access_token || !refresh_token
  fs.writeFileSync(TEST_TOKEN_FILE, JSON.stringify({
    access_token: "",
    refresh_token: "",
    expires_at: 0,
    api_domain: "",
    accounts_url: "",
    location: "",
  }), "utf-8");
}

function setupTokenStore(overrides: Record<string, unknown> = {}) {
  const defaults = {
    access_token: "test-access-token-valid",
    refresh_token: "test-refresh-token",
    expires_at: Date.now() + 3600 * 1000,
    api_domain: "https://www.zohoapis.in",
    accounts_url: "https://accounts.zoho.in",
    location: "in",
    organization_id: "774390949",
    organization_name: "Bansil Engineers",
    currency_code: "INR",
    currency_symbol: "₹",
  };
  writeTokenStore({ ...defaults, ...overrides } as any);
}

function setupExpiredTokenStore(overrides: Record<string, unknown> = {}) {
  setupTokenStore({
    access_token: "expired-placeholder",
    expires_at: 0,
    ...overrides,
  });
}

// ---- Response helpers ----

function makeOAuthResponse(accessToken = "refreshed-token-abc") {
  return new Response(JSON.stringify({
    access_token: accessToken,
    expires_in: 3600,
    api_domain: "https://www.zohoapis.in",
    token_type: "Bearer",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeZohoApiResponse(data: object, code = 0) {
  return new Response(JSON.stringify({ code, ...data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

// ============================================================
// GROUP A: Real getValidAccessToken — cold start & refresh
// ============================================================

async function groupA() {
  console.log("\n── GROUP A: Real getValidAccessToken ──");

  const { getValidAccessToken } = await import("@/app/lib/zoho-api");

  await test("A", "A1", "Cold start: expired token triggers exactly one OAuth refresh", async () => {
    nukeTokenStore();
    setupExpiredTokenStore();
    
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/oauth/v2/token")) return makeOAuthResponse("cold-start-refreshed-token");
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      const result = await getValidAccessToken();
      assert(result.token === "cold-start-refreshed-token",
        `Expected 'cold-start-refreshed-token', got '${result.token}'`);
      const oauthCalls = fetchCallLog.filter(c => c.url.includes("/oauth/v2/token"));
      assert(oauthCalls.length === 1, `Expected 1 OAuth call, got ${oauthCalls.length}`);
      assert(oauthCalls[0].method === "POST", `Expected POST, got ${oauthCalls[0].method}`);
    } finally { restoreFetch(); }
  });

  await test("A", "A2", "Valid token: no refresh, returns existing token", async () => {
    nukeTokenStore();
    setupTokenStore({ access_token: "already-valid-token" });
    
    installFetchMock(async () => { throw new Error("fetch should NOT be called"); });
    
    try {
      const result = await getValidAccessToken();
      assert(result.token === "already-valid-token",
        `Expected 'already-valid-token', got '${result.token}'`);
      assert(fetchCallLog.length === 0, `Expected 0 fetch calls, got ${fetchCallLog.length}`);
    } finally { restoreFetch(); }
  });

  await test("A", "A3", "No token store: throws 'Not connected'", async () => {
    nukeTokenStore();
    
    let threw = false;
    let errorMsg = "";
    try {
      await getValidAccessToken();
    } catch (err) {
      threw = true;
      errorMsg = err instanceof Error ? err.message : String(err);
    }
    assert(threw, "Should have thrown an error");
    assert(errorMsg.includes("Not connected"), `Expected 'Not connected', got: ${errorMsg}`);
  });

  await test("A", "A4", "10 concurrent calls, expired token → exactly 1 OAuth POST (single-flight)", async () => {
    nukeTokenStore();
    setupExpiredTokenStore();
    
    let oauthCallCount = 0;
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/oauth/v2/token")) {
        oauthCallCount++;
        await new Promise(r => setTimeout(r, 20));
        return makeOAuthResponse("concurrent-refreshed-token");
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      const promises = Array.from({ length: 10 }, () => getValidAccessToken());
      const allResults = await Promise.all(promises);
      
      for (const r of allResults) {
        assert(r.token === "concurrent-refreshed-token",
          `Expected 'concurrent-refreshed-token', got '${r.token}'`);
      }
      assert(oauthCallCount === 1, `Expected exactly 1 OAuth call, got ${oauthCallCount}`);
    } finally { restoreFetch(); }
  });

  await test("A", "A5", "Refresh failure propagates; refreshInFlight not poisoned for next call", async () => {
    nukeTokenStore();
    setupExpiredTokenStore();
    
    let callNumber = 0;
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/oauth/v2/token")) {
        callNumber++;
        if (callNumber === 1) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        return makeOAuthResponse("retry-success-token");
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      let firstThrew = false;
      try { await getValidAccessToken(); } catch { firstThrew = true; }
      assert(firstThrew, "First call should have thrown");
      
      nukeTokenStore();
      setupExpiredTokenStore();
      
      const result = await getValidAccessToken();
      assert(result.token === "retry-success-token",
        `Expected 'retry-success-token', got '${result.token}'`);
    } finally { restoreFetch(); }
  });
}

// ============================================================
// GROUP B: Real data route GET handler
// ============================================================

async function groupB() {
  console.log("\n── GROUP B: Real data route GET handler ──");

  const { GET } = await import("@/app/api/zoho/data/route");

  await test("B", "B1", "No credentials → 401 with 'No credentials configured'", async () => {
    nukeTokenStore();
    
    const req = new NextRequest("http://localhost:3000/api/zoho/data");
    const res = await GET(req);
    
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    const body = await res.json();
    assert(body.error?.includes("No credentials configured"),
      `Expected 'No credentials configured', got: ${body.error}`);
  });

  await test("B", "B2", "Cold start (expired token) → refresh triggers, not premature 401", async () => {
    nukeTokenStore();
    setupExpiredTokenStore();
    
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/oauth/v2/token")) return makeOAuthResponse("cold-start-route-token");
      if (url.includes("/books/v3/invoices"))
        return makeZohoApiResponse({ invoices: [], page_context: { has_more_page: false } });
      if (url.includes("/books/v3/bills"))
        return makeZohoApiResponse({ bills: [], page_context: { has_more_page: false } });
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      const req = new NextRequest("http://localhost:3000/api/zoho/data");
      const res = await GET(req);
      assert(res.status === 200, `Expected 200 (refresh should happen), got ${res.status}`);
      const body = await res.json();
      assert(body.invoiceCount === 0, `Expected invoiceCount 0, got ${body.invoiceCount}`);
    } finally { restoreFetch(); }
  });

  await test("B", "B3", "Valid token: returns invoices and bills with correct sums", async () => {
    nukeTokenStore();
    setupTokenStore();
    
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/books/v3/invoices"))
        return makeZohoApiResponse({
          invoices: [
            { invoice_id: "INV-001", total: 1000, balance: 500, invoice_url: "https://books.zoho.in/inv1" },
            { invoice_id: "INV-002", total: 2000, balance: 1000, invoice_url: "https://books.zoho.in/inv2" },
          ],
          page_context: { has_more_page: false },
        });
      if (url.includes("/books/v3/bills"))
        return makeZohoApiResponse({
          bills: [
            { bill_id: "BILL-001", total: 500, balance: 250, bill_url: "https://books.zoho.in/bill1" },
          ],
          page_context: { has_more_page: false },
        });
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      const req = new NextRequest("http://localhost:3000/api/zoho/data?date=2025-01-15");
      const res = await GET(req);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body = await res.json();
      assert(body.invoiceCount === 2, `Expected 2 invoices, got ${body.invoiceCount}`);
      assert(body.billCount === 1, `Expected 1 bill, got ${body.billCount}`);
      assert(parseFloat(body.invoiceTotal) === 3000, `Expected invoiceTotal 3000, got ${body.invoiceTotal}`);
      assert(parseFloat(body.billTotal) === 500, `Expected billTotal 500, got ${body.billTotal}`);
      assert(body.date === "2025-01-15", `Expected date '2025-01-15', got '${body.date}'`);
    } finally { restoreFetch(); }
  });

  await test("B", "B4", "Refresh failure → 502, not 401", async () => {
    nukeTokenStore();
    setupExpiredTokenStore();
    
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/oauth/v2/token"))
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      const req = new NextRequest("http://localhost:3000/api/zoho/data");
      const res = await GET(req);
      assert(res.status === 502, `Expected 502, got ${res.status}`);
      const body = await res.json();
      assert(body.error?.includes("Token refresh unsuccessful"),
        `Expected 'Token refresh unsuccessful', got: ${body.error}`);
    } finally { restoreFetch(); }
  });

  await test("B", "B5", "No organization ID → 400", async () => {
    nukeTokenStore();
    const savedOrgId = process.env.ZOHO_DEFAULT_ORG_ID;
    delete process.env.ZOHO_DEFAULT_ORG_ID;
    setupTokenStore({ organization_id: "" });
    
    installFetchMock(async () => { throw new Error("fetch should NOT be called"); });
    
    try {
      const req = new NextRequest("http://localhost:3000/api/zoho/data");
      const res = await GET(req);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      const body = await res.json();
      assert(body.error?.includes("No organization selected"),
        `Expected 'No organization selected', got: ${body.error}`);
    } finally {
      if (savedOrgId !== undefined) process.env.ZOHO_DEFAULT_ORG_ID = savedOrgId;
      restoreFetch();
    }
  });

  await test("B", "B6", "Audit mode → 200 with empty data", async () => {
    nukeTokenStore();
    
    installFetchMock(async () => { throw new Error("fetch should NOT be called in audit mode"); });
    
    try {
      const req = new NextRequest("http://localhost:3000/api/zoho/data?audit=true");
      const res = await GET(req);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body = await res.json();
      assert(body.invoiceCount === 0, `Expected 0 invoices, got ${body.invoiceCount}`);
    } finally { restoreFetch(); }
  });
}

// ============================================================
// GROUP C: Organization ID resolution
// ============================================================

async function groupC() {
  console.log("\n── GROUP C: Organization ID resolution ──");
  const { GET } = await import("@/app/api/zoho/data/route");

  await test("C", "C1", "Org ID from token store takes priority", async () => {
    nukeTokenStore();
    setupTokenStore({ organization_id: "store-org-123" });
    
    let capturedUrl = "";
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/books/v3/")) {
        capturedUrl = url;
        return makeZohoApiResponse({ invoices: [], bills: [], page_context: { has_more_page: false } });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      await GET(new NextRequest("http://localhost:3000/api/zoho/data"));
      assert(capturedUrl.includes("organization_id=store-org-123"),
        `Expected 'store-org-123' in URL, got: ${capturedUrl}`);
    } finally { restoreFetch(); }
  });

  await test("C", "C2", "Fallback to ZOHO_DEFAULT_ORG_ID env var", async () => {
    nukeTokenStore();
    const savedOrgId = process.env.ZOHO_DEFAULT_ORG_ID;
    process.env.ZOHO_DEFAULT_ORG_ID = "env-org-456";
    setupTokenStore({ organization_id: "" });
    
    let capturedUrl = "";
    installFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/books/v3/")) {
        capturedUrl = url;
        return makeZohoApiResponse({ invoices: [], bills: [], page_context: { has_more_page: false } });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });
    
    try {
      await GET(new NextRequest("http://localhost:3000/api/zoho/data"));
      assert(capturedUrl.includes("organization_id=env-org-456"),
        `Expected 'env-org-456' in URL, got: ${capturedUrl}`);
    } finally {
      if (savedOrgId !== undefined) process.env.ZOHO_DEFAULT_ORG_ID = savedOrgId;
      else delete process.env.ZOHO_DEFAULT_ORG_ID;
      restoreFetch();
    }
  });
}

// ============================================================
// GROUP D: Disconnect route (subprocess for IS_VERCEL isolation)
//          Subprocesses ALSO use isolated token files
// ============================================================

async function groupD() {
  console.log("\n── GROUP D: Real disconnect route POST handler ──");

  await test("D", "D1", "Vercel + ZOHO_REFRESH_TOKEN → 409 envManaged (subprocess)", async () => {
    // D1 doesn't touch token file — it returns 409 before any file access
    // But we still set isolation env vars for safety
    const subTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-d1-"));
    const subTokenFile = path.join(subTmpDir, ".tokens.json");
    const script = path.join(process.cwd(), "scripts", "_d1-test.ts");
    fs.writeFileSync(script, `
import { POST } from "@/app/api/zoho/disconnect/route";
async function main() {
  const res = await POST();
  console.log(JSON.stringify({ status: res.status, body: await res.json() }));
}
main();
`);
    try {
      const out = execSync(
        `VERCEL=1 VERCEL_ENV=production ZOHO_REFRESH_TOKEN=prod-token NODE_ENV=test BANSIL_TEST_ZOHO_TOKEN_FILE=${subTokenFile} tsx scripts/_d1-test.ts`,
        { cwd: process.cwd(), encoding: "utf-8", timeout: 15000 }
      ).trim();
      const parsed = JSON.parse(out);
      assert(parsed.status === 409, `Expected 409, got ${parsed.status}`);
      assert(parsed.body.envManaged === true, `Expected envManaged: true`);
      assert(parsed.body.success === false, `Expected success: false`);
    } finally {
      try { fs.unlinkSync(script); } catch {}
      try { fs.rmSync(subTmpDir, { recursive: true }); } catch {}
    }
  });

  await test("D", "D2", "Local dev: disconnect → 200, temp token file deleted (subprocess)", async () => {
    // Create a subprocess with its own isolated temp token file
    const subTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-d2-"));
    const subTokenFile = path.join(subTmpDir, ".tokens.json");
    const script = path.join(process.cwd(), "scripts", "_d2-test.ts");
    fs.writeFileSync(script, `
import fs from "fs";
import { POST } from "@/app/api/zoho/disconnect/route";
import { readTokenStore, writeTokenStore } from "@/app/lib/zoho-token-store";

async function main() {
  // Setup: create a valid token store in the ISOLATED temp file
  writeTokenStore({
    access_token: "test-token",
    refresh_token: "test-refresh",
    expires_at: Date.now() + 3600000,
    api_domain: "https://www.zohoapis.in",
    accounts_url: "https://accounts.zoho.in",
    location: "in",
  } as any);
  
  const tokenPath = process.env.BANSIL_TEST_ZOHO_TOKEN_FILE!;
  const existsBefore = fs.existsSync(tokenPath);
  const before = readTokenStore();
  const res = await POST();
  const existsAfter = fs.existsSync(tokenPath);
  const after = readTokenStore();
  
  console.log(JSON.stringify({
    status: res.status,
    body: await res.json(),
    hadStoreBefore: before !== null && !!before.refresh_token,
    tokenFileExistedBefore: existsBefore,
    tokenFileExistsAfter: existsAfter,
    storeNullAfter: after === null,
  }));
}
main();
`);
    try {
      // Run without VERCEL env vars, but WITH test isolation
      const envClean = { ...process.env };
      delete envClean.VERCEL;
      delete envClean.VERCEL_ENV;
      envClean.NODE_ENV = "test";
      envClean.BANSIL_TEST_ZOHO_TOKEN_FILE = subTokenFile;
      
      const out = execSync(
        `tsx scripts/_d2-test.ts`,
        { cwd: process.cwd(), encoding: "utf-8", timeout: 15000, env: envClean }
      ).trim();
      
      const jsonLine = out.split("\n").filter(l => l.startsWith("{")).pop()!;
      const parsed = JSON.parse(jsonLine);
      assert(parsed.status === 200, `Expected 200, got ${parsed.status}`);
      assert(parsed.body.success === true, `Expected success: true`);
      assert(parsed.hadStoreBefore === true, `Expected store to exist before disconnect`);
      assert(parsed.tokenFileExistedBefore === true, `Expected temp token file to exist before disconnect`);
      // In os.tmpdir(), fs.unlinkSync WORKS (no EPERM — not a device bridge mount)
      assert(parsed.tokenFileExistsAfter === false, `Expected temp token file DELETED after disconnect`);
      assert(parsed.storeNullAfter === true, `Expected readTokenStore() === null after disconnect`);
    } finally {
      try { fs.unlinkSync(script); } catch {}
      try { fs.rmSync(subTmpDir, { recursive: true }); } catch {}
    }
  });
}

// ============================================================
// GROUP E: Security guard — ZOHO WRITE = 0
// ============================================================

async function groupE() {
  console.log("\n── GROUP E: Security guard — ZOHO WRITE = 0 ──");
  const { assertZohoReadOnlyRequest } = await import("@/app/lib/zoho-security-guard");

  await test("E", "E1", "GET to zohoapis.in → allowed", async () => {
    assertZohoReadOnlyRequest("https://www.zohoapis.in/books/v3/invoices", "GET");
  });

  await test("E", "E2", "POST to zohoapis.in → BLOCKED", async () => {
    let threw = false;
    try { assertZohoReadOnlyRequest("https://www.zohoapis.in/books/v3/invoices", "POST"); }
    catch (err) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      assert(msg.includes("BLOCKED"), `Expected 'BLOCKED', got: ${msg}`);
    }
    assert(threw, "Should have thrown for POST");
  });

  await test("E", "E3", "OAuth POST to accounts.zoho.in/oauth/v2/token → allowed", async () => {
    assertZohoReadOnlyRequest(
      "https://accounts.zoho.in/oauth/v2/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
  });

  await test("E", "E4", "PUT to zohoapis → BLOCKED", async () => {
    let threw = false;
    try { assertZohoReadOnlyRequest("https://www.zohoapis.in/books/v3/invoices/123", "PUT"); }
    catch { threw = true; }
    assert(threw, "Should have thrown for PUT");
  });

  await test("E", "E5", "DELETE to zohoapis → BLOCKED", async () => {
    let threw = false;
    try { assertZohoReadOnlyRequest("https://www.zohoapis.in/books/v3/invoices/123", "DELETE"); }
    catch { threw = true; }
    assert(threw, "Should have thrown for DELETE");
  });

  await test("E", "E6", "PATCH to zohoapis → BLOCKED", async () => {
    let threw = false;
    try { assertZohoReadOnlyRequest("https://www.zohoapis.in/books/v3/invoices/123", "PATCH"); }
    catch { threw = true; }
    assert(threw, "Should have thrown for PATCH");
  });

  await test("E", "E7", "POST to accounts.zoho.in/other/path → BLOCKED", async () => {
    let threw = false;
    try { assertZohoReadOnlyRequest("https://accounts.zoho.in/other/path", "POST"); }
    catch { threw = true; }
    assert(threw, "Should have thrown for non-OAuth POST");
  });

  await test("E", "E8", "Multi-DC: GET allowed for .com, .in, .eu, .com.au, .jp", async () => {
    for (const tld of ["com", "in", "eu", "com.au", "jp"]) {
      assertZohoReadOnlyRequest(`https://www.zohoapis.${tld}/books/v3/invoices`, "GET");
    }
  });
}

// ============================================================
// GROUP F: Token store — real dual-mode behavior
// ============================================================

async function groupF() {
  console.log("\n── GROUP F: Token store — real dual-mode ──");

  await test("F", "F1", "isAccessTokenValid: future expires_at → true", async () => {
    assert(isAccessTokenValid({ access_token: "v", refresh_token: "r", expires_at: Date.now() + 3600_000 } as any) === true, "Expected valid");
  });

  await test("F", "F2", "isAccessTokenValid: past expires_at → false", async () => {
    assert(isAccessTokenValid({ access_token: "v", refresh_token: "r", expires_at: Date.now() - 1000 } as any) === false, "Expected invalid");
  });

  await test("F", "F3", "isAccessTokenValid: expires_at=0 (cold start) → false", async () => {
    assert(isAccessTokenValid({ access_token: "", refresh_token: "r", expires_at: 0 } as any) === false, "Expected invalid");
  });

  await test("F", "F4", "writeTokenStore + readTokenStore roundtrip via isolated file", async () => {
    nukeTokenStore();
    setupTokenStore({ access_token: "roundtrip-token", organization_id: "rt-org" });
    const store = readTokenStore();
    assert(store !== null, "Expected non-null store");
    assert(store!.access_token === "roundtrip-token", `Expected 'roundtrip-token'`);
    assert(store!.organization_id === "rt-org", `Expected 'rt-org'`);
    nukeTokenStore();
  });
}

// ============================================================
// GROUP G: Safety regression — operational file untouched
// ============================================================

async function groupG() {
  console.log("\n── GROUP G: Safety — operational token file untouched ──");

  await test("G", "G1", "Operational .tokens.json hash unchanged after all tests", async () => {
    if (operationalHashBefore === null) {
      // File didn't exist before tests — verify it still doesn't
      assert(!fs.existsSync(OPERATIONAL_TOKEN_FILE),
        "Operational token file was CREATED by tests — it should not exist");
      return;
    }
    
    assert(fs.existsSync(OPERATIONAL_TOKEN_FILE),
      "Operational token file was DELETED by tests");
    
    const contentAfter = fs.readFileSync(OPERATIONAL_TOKEN_FILE);
    const hashAfter = crypto.createHash("sha256").update(contentAfter).digest("hex");
    const mtimeAfter = fs.statSync(OPERATIONAL_TOKEN_FILE).mtimeMs;
    
    console.log(`     Hash before: ${operationalHashBefore!.substring(0, 16)}...`);
    console.log(`     Hash after:  ${hashAfter.substring(0, 16)}...`);
    console.log(`     Mtime before: ${operationalMtimeBefore}`);
    console.log(`     Mtime after:  ${mtimeAfter}`);
    
    assert(hashAfter === operationalHashBefore,
      `CRITICAL: Operational .tokens.json was MODIFIED by tests! Hash changed.`);
    assert(mtimeAfter === operationalMtimeBefore,
      `CRITICAL: Operational .tokens.json mtime changed (file was touched).`);
  });
}

// ============================================================
// Run all groups
// ============================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Phase 2A-R3: ISOLATED Real-Code Behavioral Tests           ║");
  console.log("║  Imports & executes actual application modules.              ║");
  console.log("║  Token operations use isolated temp file — NEVER .tokens.json║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const envSnapshot = { ...process.env };

  try {
    await groupA();
    await groupB();
    await groupC();
    await groupD();
    await groupE();
    await groupF();
    await groupG();  // Safety regression MUST be last
  } finally {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    for (const [key, val] of Object.entries(envSnapshot)) {
      process.env[key] = val;
    }
    restoreFetch();
    
    // Cleanup temp directory
    try {
      fs.rmSync(TEST_TMP_DIR, { recursive: true });
      console.log(`[CLEANUP] Removed temp dir: ${TEST_TMP_DIR}`);
    } catch (err) {
      console.log(`[CLEANUP] Warning: could not remove temp dir: ${err}`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("══════════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  ❌ ${r.id}: ${r.label}`);
      if (r.detail) console.log(`     ${r.detail}`);
    }
    process.exit(1);
  } else {
    console.log("\n✅ All tests passed — real code, real modules, isolated token storage.");
    console.log("   OPERATIONAL .tokens.json: UNTOUCHED");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(2);
});
