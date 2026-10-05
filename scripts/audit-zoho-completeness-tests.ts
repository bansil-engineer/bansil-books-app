// ============================================================
// Bansil Books Analytics — Zoho Acquisition Completeness Proof
// (Owner verification pass, Milestone B)
//
// MOCKED HTTP ONLY. global.fetch is replaced with a synthetic queue of
// responses for this process — no real network call is made, and no
// live Zoho credentials are read (a throwaway .tokens.json is written
// to an isolated temp directory this process chdir's into). Proves the
// pagination/coverage/counter logic in isolation, exactly as the owner
// requested, without touching the real connected org.
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import { createWorkspace, addWorkspaceSource } from "../app/lib/audit/audit-service.ts";

let passedCount = 0;
let failedCount = 0;
function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
  passedCount++;
}
function fail(name: string, err: unknown) {
  console.error(`  ✗ FAIL: ${name}`, err);
  failedCount++;
}
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

function tmpDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bansil-zoho-completeness-${label}-`));
  return path.join(dir, "audit_workspace.db");
}

// Isolated cwd so getValidAccessToken() reads a throwaway, obviously-fake
// token file — never the real project's .tokens.json.
//
// IMPORTANT: zoho-token-store.ts resolves its TOKEN_FILE path from
// process.cwd() at MODULE-EVALUATION time (a top-level `const`). A static
// `import ... from "zoho-audit-adapter.ts"` at the top of this file would
// therefore capture the REAL project's .tokens.json path, because ES
// module imports are hoisted and evaluate before this chdir() call runs —
// an isolation bug caught during this exact verification pass (it never
// made a real network call or write, since fetch is fully mocked below,
// but it was silently reading the real file's expiry instead of the fake
// one, which is not the isolation this suite claims). Fix: chdir FIRST,
// then dynamically import the Zoho modules so their module-level path
// constants resolve against the fake root instead.
const FAKE_PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bansil-zoho-completeness-root-"));
process.chdir(FAKE_PROJECT_ROOT);
fs.writeFileSync(
  path.join(FAKE_PROJECT_ROOT, ".tokens.json"),
  JSON.stringify({
    access_token: "fake-test-token-never-sent-anywhere-real",
    refresh_token: "fake-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
    api_domain: "https://www.zohoapis.com", // pattern-only — global.fetch is mocked below, so no real request is ever dispatched
    accounts_url: "https://accounts.zoho.com",
    location: "com",
    organization_id: "000000000",
  })
);

const { acquireZohoAccountingSource, createZohoSourceVersion } = await import("../app/lib/audit/zoho-audit-adapter.ts");
const { getNormalizedRows } = await import("../app/lib/audit/intake-service.ts");

type MockResponse = { ok: boolean; status: number; headers: { has: () => boolean }; json: () => Promise<any> };
function mockResponse(status: number, body: any): MockResponse {
  return { ok: status >= 200 && status < 300, status, headers: { has: () => false }, json: async () => body };
}

function makeInvoice(id: string, date: string) {
  return { invoice_id: id, invoice_number: `INV-${id}`, customer_name: "Synthetic Test Customer", date, total: 100, balance: 0, currency_code: "INR" };
}

const originalFetch = globalThis.fetch;
function installMockFetch(responses: MockResponse[]) {
  let call = 0;
  (globalThis as any).fetch = async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return r as unknown as Response;
  };
  return () => call; // returns a getter for how many times fetch was called
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function makeSource(conn: any) {
  const ws = createWorkspace({ name: "Zoho completeness test", comparisonMode: "INTERNAL_EXTERNAL", sources: [] }, conn);
  const source = addWorkspaceSource(ws.workspace_id, { roleLabel: "SOURCE_A", sourceOrigin: "INTERNAL" }, "OWNER", conn);
  return { workspaceId: ws.workspace_id, sourceId: source.source_id };
}

console.log("\n==================================================");
console.log("ZOHO ACQUISITION COMPLETENESS PROOF (mocked HTTP, no live calls)");
console.log("==================================================");

await test("COMPLETE requires pagination to actually exhaust (has_more_page: false) — proven with a real 2-page sequence", async () => {
  const conn = openAuditDatabaseAt(tmpDbPath("complete-1"));
  const { workspaceId, sourceId } = makeSource(conn);
  const getCallCount = installMockFetch([
    mockResponse(200, { code: 0, invoices: [makeInvoice("1", "2026-01-01"), makeInvoice("2", "2026-01-02")], page_context: { has_more_page: true } }),
    mockResponse(200, { code: 0, invoices: [makeInvoice("3", "2026-01-03")], page_context: { has_more_page: false } }),
  ]);
  try {
    const result = await acquireZohoAccountingSource(workspaceId, sourceId, "774390949", "sales_invoices", "2026-01-01", "2026-01-31", "OWNER", conn);
    assert.strictEqual(result.status, "SUCCESS");
    assert.strictEqual(result.coverageStatus, "COMPLETE");
    assert.strictEqual(result.pageCount, 2, "both pages must actually have been fetched");
    assert.strictEqual(result.apiCallCount, 2);
    assert.strictEqual(getCallCount(), 2, "the mock proves exactly 2 real fetch() calls occurred — pagination was not assumed complete after page 1");
    assert.strictEqual(result.recordCount, 3, "raw record count across all pages");

    const row = conn.prepare(`SELECT * FROM audit_zoho_acquisitions WHERE acquisition_id = ?`).get(result.acquisitionId) as any;
    assert.strictEqual(row.organization_id, "774390949", "requested organization is recorded");
    assert.strictEqual(row.requested_period_from, "2026-01-01");
    assert.strictEqual(row.requested_period_to, "2026-01-31");
    assert.strictEqual(row.page_count, 2);
    assert.strictEqual(row.api_call_count, 2);
    assert.strictEqual(row.record_count, 3);
    assert.strictEqual(row.coverage_status, "COMPLETE");
  } finally {
    restoreFetch();
    conn.close();
  }
});

await test("a 401 on the very first page yields BLOCKED coverage and FAILED status — never COMPLETE", async () => {
  const conn = openAuditDatabaseAt(tmpDbPath("blocked-1"));
  const { workspaceId, sourceId } = makeSource(conn);
  installMockFetch([mockResponse(401, { code: 57, message: "invalid token" })]);
  try {
    const result = await acquireZohoAccountingSource(workspaceId, sourceId, "774390949", "sales_invoices", "2026-01-01", "2026-01-31", "OWNER", conn);
    assert.strictEqual(result.coverageStatus, "BLOCKED");
    assert.strictEqual(result.status, "FAILED");
    assert.strictEqual(result.recordCount, 0, "a 401 must never be treated as an empty-but-complete result");

    const row = conn.prepare(`SELECT * FROM audit_zoho_acquisitions WHERE acquisition_id = ?`).get(result.acquisitionId) as any;
    assert.strictEqual(row.coverage_status, "BLOCKED");
    assert.strictEqual(row.status, "FAILED");
  } finally {
    restoreFetch();
    conn.close();
  }
});

await test("a failure on page 2 (after page 1 succeeded) yields INCOMPLETE, not COMPLETE — partial data is never silently accepted as the whole picture", async () => {
  const conn = openAuditDatabaseAt(tmpDbPath("incomplete-1"));
  const { workspaceId, sourceId } = makeSource(conn);
  installMockFetch([
    mockResponse(200, { code: 0, invoices: [makeInvoice("1", "2026-01-01")], page_context: { has_more_page: true } }),
    mockResponse(500, { code: 1, message: "internal error" }),
  ]);
  try {
    const result = await acquireZohoAccountingSource(workspaceId, sourceId, "774390949", "sales_invoices", "2026-01-01", "2026-01-31", "OWNER", conn);
    assert.strictEqual(result.coverageStatus, "INCOMPLETE");
    assert.strictEqual(result.recordCount, 1, "the one successfully fetched page's records are kept, but coverage is honestly marked incomplete");
    assert.notStrictEqual(result.coverageStatus, "COMPLETE");
  } finally {
    restoreFetch();
    conn.close();
  }
});

await test("hitting the page safety cap before has_more_page becomes false is INCOMPLETE, not COMPLETE", async () => {
  const conn = openAuditDatabaseAt(tmpDbPath("cap-1"));
  const { workspaceId, sourceId } = makeSource(conn);
  // Every page claims there's more — this must never resolve to COMPLETE.
  installMockFetch([mockResponse(200, { code: 0, invoices: [makeInvoice("x", "2026-01-01")], page_context: { has_more_page: true } })]);
  try {
    const result = await acquireZohoAccountingSource(workspaceId, sourceId, "774390949", "sales_invoices", "2026-01-01", "2026-01-31", "OWNER", conn);
    assert.strictEqual(result.coverageStatus, "INCOMPLETE");
    assert.ok(result.pageCount > 1, "the safety cap must actually have been exercised across multiple pages");
  } finally {
    restoreFetch();
    conn.close();
  }
});

await test("record_count (raw) and normalized-row count match after mapping — no silent row loss or duplication", async () => {
  const conn = openAuditDatabaseAt(tmpDbPath("counts-1"));
  const { workspaceId, sourceId } = makeSource(conn);
  installMockFetch([
    mockResponse(200, { code: 0, invoices: [makeInvoice("1", "2026-01-01"), makeInvoice("2", "2026-01-02")], page_context: { has_more_page: false } }),
  ]);
  try {
    const result = await acquireZohoAccountingSource(workspaceId, sourceId, "774390949", "sales_invoices", "2026-01-01", "2026-01-31", "OWNER", conn);
    const versionId = createZohoSourceVersion(sourceId, result, "sales_invoices", "OWNER", conn);
    const rows = getNormalizedRows(versionId, 100, conn);
    assert.strictEqual(rows.length, result.recordCount, "one normalized-row placeholder per raw record — no loss, no duplication");
  } finally {
    restoreFetch();
    conn.close();
  }
});

console.log("\n==================================================");
console.log(`RESULTS: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");
if (failedCount > 0) process.exit(1);
