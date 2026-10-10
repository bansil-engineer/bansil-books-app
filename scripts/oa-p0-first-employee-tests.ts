// ============================================================
// OA P0 — First employee live: end-to-end lifecycle (ISOLATED)
//
// Exercises, in the DB user store (AUTH_USER_STORE=db set for THIS
// PROCESS ONLY, temp auth.db, synthetic users):
//   Owner creates employee → assigns module + function permissions →
//   secure invitation (one-time token in the URL #fragment) → employee
//   sets own password → logs in → Dashboard data allowed, everything
//   else blocked (guard + real route handlers) → permission change and
//   deactivation revoke access immediately → audit history recorded →
//   login rate limiting → Owner access preserved.
//
// First employee profile (Owner P0 spec): Viewer / Read Only,
// module Dashboard, action View. No Owner/Admin privileges.
//
// Never touches production: every DB path points into a temp dir,
// network is disabled (fetch spy), no invitations are sent anywhere.
// ============================================================

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "oa-p0-first-employee-"));
const DATA = path.join(TMP, "data");
fs.mkdirSync(DATA, { recursive: true });
for (const k of ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"]) delete process.env[k];
process.env.BANSIL_RUNTIME_DB_DIR = DATA;
process.env.BANSIL_BOOKS_DB_PATH = path.join(DATA, "books.db");
process.env.AUDIT_WORKSPACE_DB_PATH = path.join(DATA, "audit.db");
process.env.AI_WORKSPACE_DB_PATH = path.join(DATA, "ai.db");
process.env.ESTIMATION_DB_PATH = path.join(DATA, "estimation.sqlite");
process.env.AUTH_DB_PATH = path.join(DATA, "auth.db");
process.env.BANSIL_ZOHO_TOKEN_FILE = path.join(DATA, ".tokens.json");
process.env.BANSIL_READ_ONLY_SESSION = "1";
process.env.AUTH_SECRET = randomBytes(32).toString("hex");

let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("network disabled in OA P0 tests");
}) as typeof fetch;

const lib = (p: string) => pathToFileURL(path.join(ROOT, "app/lib", p)).href;
const auth = await import(lib("auth.ts"));
const { openAuthDatabaseAt } = await import(lib("db/auth-database.ts"));
const { AuthRepository } = await import(lib("auth-repository.ts"));
const svc = await import(lib("auth-service.ts"));
const store = await import(lib("auth-store.ts"));
const rl = await import(lib("auth-ratelimit.ts"));
const { guardRoute } = await import(lib("route-guard.ts"));
const { ROUTE_POLICIES, policyFor } = await import(lib("route-policy-manifest.ts"));

let passed = 0, failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; failures.push(name.split(" ")[0]); console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : String(e)}`); }
}
const section = (s: string) => console.log(`\n${s}`);

// ---------------------------------------------------------------- fixture
const OWNER = "owner@synthetic.test";
const OWNER_PW = "Synthetic-Owner-Passphrase-1";
const EMP = "first.employee@synthetic.test";
const EMP_PW = "First-Employee-Synthetic-Pass-01";
const salt = auth.generateSalt();
process.env.AUTH_USERS = JSON.stringify([{ email: OWNER, name: "Synthetic Owner", role: "super_admin", salt, hash: auth.hashPassword(OWNER_PW, salt), modules: ["*"] }]);

const authDb = openAuthDatabaseAt(process.env.AUTH_DB_PATH!);
const repo = new AuthRepository(authDb);
assert.ok(repo.importFromAuthUsersJson(process.env.AUTH_USERS, { email: "p0-test@local", role: "system", correlationId: "p0-setup-01" }).ok);
process.env.AUTH_USER_STORE = "db"; // THIS PROCESS ONLY (temp auth.db)
store.__setAuthRepositoryForTests(repo);

function ctx(opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  return { cookie: (n: string) => (n === "bansil_auth" ? opts.token : undefined), header: (n: string) => headers[n.toLowerCase()] ?? null, body: opts.body };
}
async function login(email: string, password: string, headers: Record<string, string> = {}) {
  return svc.dbLogin(repo, ctx({ body: { email, password }, headers }));
}
const req = (url: string, token?: string, method = "GET") =>
  new Request(`http://localhost${url}`, { method, headers: token ? { cookie: `bansil_auth=${token}` } : {} });

// Real route handlers (plain node, test shim for next/server when the package is absent)
const useShim = !fs.existsSync(path.join(ROOT, "node_modules", "next", "server.js"));
register(pathToFileURL(path.join(ROOT, "scripts/lib/rbac-route-loader.mjs")).href,
  { data: { root: ROOT, shimDir: path.join(ROOT, "scripts/lib/next-shim"), useShim } });
const { NextRequest } = await import("next/server");
const route = async (key: string) => import(pathToFileURL(path.join(ROOT, "app/api", key, "route.ts")).href).catch(() => null);
function nreq(url: string, method: string, token?: string, body: unknown = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
  if (token) headers.cookie = `bansil_auth=${encodeURIComponent(token)}`;
  return new NextRequest(`http://localhost${url}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) });
}
const rctx = { params: Promise.resolve({ id: "synthetic-id", segments: ["tasks"] }) };
function snapshot(): string {
  const h = createHash("sha256");
  const walk = (d: string) => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (p === process.env.AUTH_DB_PATH || p.startsWith(process.env.AUTH_DB_PATH + "-")) continue; const st = fs.statSync(p); if (st.isDirectory()) walk(p); else h.update(p).update(fs.readFileSync(p)); } };
  walk(DATA);
  return h.digest("hex");
}
const DASH_SOURCES = [
  ["reconciliation", "/api/reconciliation?financialYear=2026-27"],
  ["inventory-mismatch", "/api/inventory-mismatch?financialYear=2026-27"],
  ["transactions", "/api/transactions?type=recent&financialYear=2026-27"],
] as const;

console.log("OA P0 — first employee lifecycle (isolated temp DBs, synthetic users)");

// ================================================================== Phase 2
section("1. Owner session");
let OWNER_TOKEN = "";
await test("1a Owner logs in (DB store, imported from synthetic AUTH_USERS) and passes Owner-only checks", async () => {
  const r = await login(OWNER, OWNER_PW);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  OWNER_TOKEN = r.cookie.value;
  assert.equal((await guardRoute(req("/api/sync", OWNER_TOKEN), policyFor("sync", "GET"))).ok, true);
  assert.equal(svc.dbUsersGet(repo, ctx({ token: OWNER_TOKEN })).status, 200);
});

section("2. Owner creates the employee and assigns rights");
let INVITE_PATH = "";
await test("2a over-broad grants for a Viewer are REJECTED (no Owner/Admin rights, viewer ceiling, no '*')", async () => {
  for (const [role, modules] of [["viewer", ["dashboard:view,edit"]], ["viewer", ["*"]], ["super_admin", ["dashboard:view"]],
    ["viewer", ["dashboard:view,delete"]], ["viewer", ["not-a-module:view"]], ["viewer", ["dashboard:approve"]]] as const) {
    const r = await svc.dbUsersPost(repo, ctx({ token: OWNER_TOKEN, body: { email: "reject.me@synthetic.test", name: "X", role, modules } }));
    assert.equal(r.status >= 400 && r.status < 500, true, `${role} ${modules} → ${r.status}`);
  }
  assert.equal(repo.getUser("reject.me@synthetic.test"), null);
});
await test("2b Owner creates Viewer + Dashboard:view, no password → status 'invited' + one-time link", async () => {
  const r = await svc.dbUsersPost(repo, ctx({ token: OWNER_TOKEN, body: { email: EMP, name: "First Employee", role: "viewer", modules: ["dashboard:view"] } }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.status, "invited");
  assert.equal(r.body.user.role, "viewer");
  assert.deepEqual(r.body.user.modules, ["dashboard:view"]);
  INVITE_PATH = r.body.invitation.path;
  const s = JSON.stringify(r.body);
  for (const bad of ["scrypt$", "password_hash", "token_hash", "\"salt\"", "\"hash\""]) assert.ok(!s.includes(bad), `leaked ${bad}`);
});
await test("2c invitation token travels ONLY in the URL #fragment (never sent to the server / logs); only its hash is stored", async () => {
  assert.match(INVITE_PATH, /^\/invite#token=[A-Za-z0-9_-]{32,}$/);
  const tok = INVITE_PATH.split("#token=")[1];
  const raw = fs.readFileSync(process.env.AUTH_DB_PATH!);
  assert.equal(raw.includes(Buffer.from(tok)), false, "raw invitation token stored in auth.db");
  assert.equal(fetchCalls, 0, "no email / network send");
});
await test("2d employee cannot log in before accepting (no password set) → 401", async () => {
  assert.equal((await login(EMP, EMP_PW)).status, 401);
});

section("3. Employee sets own password and logs in");
let EMP_TOKEN = "";
await test("3a weak password rejected; strong password accepted; token is single-use", async () => {
  const tok = INVITE_PATH.split("#token=")[1];
  const weak = await svc.dbInvitationAccept(repo, ctx({ body: { token: tok, password: "short" } }));
  assert.equal(weak.status, 400);
  const ok = await svc.dbInvitationAccept(repo, ctx({ body: { token: tok, password: EMP_PW } }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(repo.getUser(EMP).status, "active");
  const again = await svc.dbInvitationAccept(repo, ctx({ body: { token: tok, password: "Another-Synthetic-Pass-02" } }));
  assert.equal(again.status, 400);
});
await test("3b employee logs in; /me shows ONLY viewer + dashboard:view; session is 8h with sv/jti", async () => {
  const r = await login(EMP, EMP_PW);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  EMP_TOKEN = r.cookie.value;
  const me = svc.dbMe(repo, ctx({ token: EMP_TOKEN }));
  assert.equal(me.status, 200);
  assert.equal(me.body.role, "viewer");
  assert.deepEqual(me.body.modules, ["dashboard:view"]);
  const p = auth.verifyToken(EMP_TOKEN);
  assert.equal(p.exp - p.iat, 8 * 3600);
  assert.ok(p.sv !== undefined && typeof p.jti === "string");
});

section("4. What the employee can and cannot reach");
await test("4a Dashboard data sources: guard ALLOWS (reconciliation, inventory-mismatch, recent transactions)", async () => {
  for (const [k, url] of DASH_SOURCES) assert.equal((await guardRoute(req(url, EMP_TOKEN), policyFor(k, "GET"), k)).ok, true, k);
});
await test("4b Dashboard real handlers serve the employee (temp books DB) — no 401/403", async () => {
  for (const [k, url] of DASH_SOURCES) {
    const mod = await route(k); assert.ok(mod, `${k} loadable`);
    const res = await mod.GET(nreq(url, "GET", EMP_TOKEN), rctx);
    assert.ok(res.status !== 401 && res.status !== 403, `${k} → ${res.status}`);
  }
});
await test("4c transactions beyond the Dashboard's 'recent' panel → 403 (bills, invoices, detail, all, duplicate type)", async () => {
  const mod = await route("transactions");
  for (const q of ["", "?type=all", "?type=bills", "?type=invoices", "?type=bill-detail&docId=1", "?type=recent&type=all"]) {
    assert.equal((await mod.GET(nreq(`/api/transactions${q}`, "GET", EMP_TOKEN), rctx)).status, 403, q);
  }
});
await test("4d EVERY other route-guarded method → 403 for the employee (DB store, guard level, all methods)", async () => {
  let n = 0;
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      if (p.enforcement !== "route-guard" || p.classification === "AUTHENTICATED") continue;
      if (DASH_SOURCES.some(([dk]) => dk === k) && m === "GET") continue;
      const g = await guardRoute(req(`/api/${k}`, EMP_TOKEN, m), policyFor(k, m), `${k} ${m}`);
      assert.equal(g.status, 403, `${k} ${m}`); n++;
    }
  }
  assert.ok(n >= 125, `checked ${n}`);
});
await test("4e high-risk real handlers refuse the employee with no data change and no network (Sync, Export, Settings, Approvals, AI governance, Zoho, search, stock, customers)", async () => {
  const cases: Array<[string, string, string]> = [
    ["sync", "GET", "/api/sync"], ["sync", "POST", "/api/sync"], ["sync/backfill", "GET", "/api/sync/backfill"], ["sync/backfill", "POST", "/api/sync/backfill"],
    ["export/excel", "GET", "/api/export/excel"], ["export/excel", "POST", "/api/export/excel"], ["export/pdf", "POST", "/api/export/pdf"],
    ["settings", "POST", "/api/settings"], ["ai/approvals/[id]/approve", "POST", "/api/ai/approvals/x/approve"],
    ["ai/approvals/[id]/reject", "POST", "/api/ai/approvals/x/reject"], ["ai/agents/[id]/capabilities/grant", "POST", "/api/ai/agents/x/capabilities/grant"],
    ["ai/workforce", "GET", "/api/ai/workforce"], ["zoho/status", "GET", "/api/zoho/status"], ["zoho/data", "GET", "/api/zoho/data"],
    ["zoho/disconnect", "POST", "/api/zoho/disconnect"], ["zoho/select-org", "POST", "/api/zoho/select-org"], ["connections", "POST", "/api/connections"],
    ["search", "GET", "/api/search?q=a"], ["stock", "GET", "/api/stock"], ["customer-details", "GET", "/api/customer-details"],
    ["exclusions", "POST", "/api/exclusions"], ["audit/cash", "GET", "/api/audit/cash"], ["audit/workspaces", "GET", "/api/audit/workspaces"],
  ];
  let ran = 0; const skipped: string[] = [];
  for (const [k, m, url] of cases) {
    const mod = await route(k); if (!mod || typeof mod[m] !== "function") { skipped.push(`${k} ${m}`); continue; }
    const before = snapshot(); const net = fetchCalls;
    const res = await mod[m](nreq(url, m, EMP_TOKEN, { mode: "SMART", key: "x", enabled: true, settings: { x: true }, role: "super_admin" }), rctx);
    assert.ok(res.status === 401 || res.status === 403, `${k} ${m} → ${res.status}`);
    assert.equal(snapshot(), before, `${k} ${m} changed data`);
    assert.equal(fetchCalls, net, `${k} ${m} network`);
    ran++;
  }
  assert.ok(ran >= 15, `ran ${ran}`);
  console.log(`      ran ${ran}; not loadable in plain node (covered by 4d guard check + static gate Q3): ${skipped.join(", ")}`);
});
await test("4f user management, invitations and the audit log are Owner-only (employee 403)", async () => {
  const t = EMP_TOKEN;
  assert.equal(svc.dbUsersGet(repo, ctx({ token: t })).status, 403);
  assert.equal((await svc.dbUsersPost(repo, ctx({ token: t, body: { email: "x@synthetic.test", name: "x", role: "viewer", modules: [] } }))).status, 403);
  assert.equal(svc.dbUsersPatch(repo, ctx({ token: t, body: { email: EMP, role: "admin", modules: ["*"] } })).status, 403);
  assert.equal(svc.dbInvitationsPost(repo, ctx({ token: t, body: { email: EMP } })).status, 403);
  assert.equal(svc.dbAuditGet(repo, ctx({ token: t }), 50).status, 403);
  assert.equal(repo.getUser(EMP).role, "viewer");
});
await test("4g a forged/self-elevated JWT (role super_admin, modules '*') for the employee is rejected", async () => {
  const forged = auth.createToken({ email: EMP, name: "x", role: "super_admin", modules: ["*"] });
  assert.equal((await guardRoute(req("/api/sync", forged), policyFor("sync", "GET"))).status, 401); // no sv/jti → not a DB session
});

section("5. Revocation");
await test("5a Owner adds reports:view → employee's EXISTING token is revoked on the very next request (401); re-login gets new rights", async () => {
  const r = svc.dbUsersPatch(repo, ctx({ token: OWNER_TOKEN, body: { email: EMP, name: "First Employee", role: "viewer", modules: ["dashboard:view", "reports:view"] } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await guardRoute(req(DASH_SOURCES[0][1], EMP_TOKEN), policyFor("reconciliation", "GET"))).status, 401);
  EMP_TOKEN = (await login(EMP, EMP_PW)).cookie.value;
  assert.equal((await guardRoute(req("/api/price-reference", EMP_TOKEN), policyFor("price-reference", "GET"))).ok, true);
  // back to the P0 profile
  assert.equal(svc.dbUsersPatch(repo, ctx({ token: OWNER_TOKEN, body: { email: EMP, name: "First Employee", role: "viewer", modules: ["dashboard:view"] } })).status, 200);
  assert.equal((await guardRoute(req("/api/price-reference", EMP_TOKEN), policyFor("price-reference", "GET"))).status, 401);
  EMP_TOKEN = (await login(EMP, EMP_PW)).cookie.value;
  assert.equal((await guardRoute(req("/api/price-reference", EMP_TOKEN), policyFor("price-reference", "GET"))).status, 403);
});
await test("5b employee password change revokes the previous session", async () => {
  const old = EMP_TOKEN;
  const r = await svc.dbChangePassword(repo, ctx({ token: old, body: { currentPassword: EMP_PW, newPassword: "First-Employee-Synthetic-Pass-02" } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await guardRoute(req(DASH_SOURCES[0][1], old), policyFor("reconciliation", "GET"))).status, 401);
  EMP_TOKEN = r.cookie?.action === "set" ? r.cookie.value : (await login(EMP, "First-Employee-Synthetic-Pass-02")).cookie.value;
  assert.equal((await guardRoute(req(DASH_SOURCES[0][1], EMP_TOKEN), policyFor("reconciliation", "GET"))).ok, true);
});
await test("5c Owner DEACTIVATES the employee → every protected request 401 immediately (guard, real handler, /me); login refused", async () => {
  const r = svc.dbUsersPatch(repo, ctx({ token: OWNER_TOKEN, body: { email: EMP, action: "deactivate" } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const [k, url] of DASH_SOURCES) assert.equal((await guardRoute(req(url, EMP_TOKEN), policyFor(k, "GET"))).status, 401, k);
  const mod = await route("reconciliation");
  assert.equal((await mod.GET(nreq(DASH_SOURCES[0][1], "GET", EMP_TOKEN), rctx)).status, 401);
  assert.equal(svc.dbMe(repo, ctx({ token: EMP_TOKEN })).status, 401);
  assert.equal((await login(EMP, "First-Employee-Synthetic-Pass-02")).status, 401);
});
await test("5d logout (jti revocation) is honoured by the guard", async () => {
  assert.equal(svc.dbUsersPatch(repo, ctx({ token: OWNER_TOKEN, body: { email: EMP, action: "activate" } })).status, 200);
  const t = (await login(EMP, "First-Employee-Synthetic-Pass-02")).cookie.value;
  assert.equal((await guardRoute(req(DASH_SOURCES[0][1], t), policyFor("reconciliation", "GET"))).ok, true);
  svc.dbLogout(repo, ctx({ token: t }));
  assert.equal((await guardRoute(req(DASH_SOURCES[0][1], t), policyFor("reconciliation", "GET"))).status, 401);
});

section("6. Audit history");
await test("6a audit log records create, invitation acceptance, logins, permission changes, deactivation, access denials — with actors", async () => {
  const rows = repo.listAudit(500) as any[];
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["user.create", "invitation.accept", "auth.login", "user.update", "password.change", "access.denied", "auth.logout"]) assert.ok(actions.has(a), `missing ${a} in ${[...actions].join(",")}`);
  assert.ok([...actions].some((a) => /deactivat|activ|status/.test(a)), "deactivation not audited");
  const create = rows.find((r) => r.action === "user.create" && (r.target_email ?? r.targetEmail) === EMP);
  assert.ok(create && (create.actor_email ?? create.actorEmail) === OWNER, "create row must name the Owner as actor");
  assert.ok(!JSON.stringify(rows).includes(EMP_PW) && !JSON.stringify(rows).includes("First-Employee-Synthetic-Pass-02"), "password in audit log");
});
await test("6b audit log is append-only (UPDATE/DELETE rejected by DB triggers)", async () => {
  assert.throws(() => authDb.exec("UPDATE auth_audit_log SET action = 'x'"));
  assert.throws(() => authDb.exec("DELETE FROM auth_audit_log"));
});

section("7. Login rate limiting");
await test("7a repeated wrong passwords → 429 with Retry-After; the CORRECT password is also refused during lockout", async () => {
  rl.__resetLoginRateLimiterForTests();
  const H = { "x-forwarded-for": "203.0.113.7" };
  let last: any;
  for (let i = 0; i < 8; i++) last = await login(EMP, `Wrong-Synthetic-${i}-xxxxxx`, H);
  assert.equal(last.status, 429);
  assert.ok(last.headers?.["Retry-After"] || last.headers?.["retry-after"], "Retry-After");
  assert.equal((await login(EMP, "First-Employee-Synthetic-Pass-02", H)).status, 429);
  rl.__resetLoginRateLimiterForTests();
  assert.equal((await login(EMP, "First-Employee-Synthetic-Pass-02", H)).status, 200);
});
await test("7b an attacker hammering the employee does not lock the Owner out (separate account keys)", async () => {
  rl.__resetLoginRateLimiterForTests();
  const H = { "x-forwarded-for": "203.0.113.8" };
  for (let i = 0; i < 8; i++) await login(EMP, `Wrong-Synthetic-${i}-yyyyyy`, H);
  assert.equal((await login(OWNER, OWNER_PW, { "x-forwarded-for": "198.51.100.1" })).status, 200);
  rl.__resetLoginRateLimiterForTests();
});

section("8. Safety");
await test("8a Owner access preserved end-to-end (DB store): Owner passes every route-guarded policy", async () => {
  const t = (await login(OWNER, OWNER_PW)).cookie.value;
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) for (const [m, p] of Object.entries(ms) as [string, any][]) {
    if (p.enforcement !== "route-guard") continue;
    assert.equal((await guardRoute(req(`/api/${k}?type=all`, t, m), policyFor(k, m))).ok, true, `${k} ${m}`);
  }
});
await test("8b every DB this run touched lives in the temp dir; no network; AUTH_USER_STORE change is process-local", async () => {
  for (const k of ["AUTH_DB_PATH", "BANSIL_BOOKS_DB_PATH", "AUDIT_WORKSPACE_DB_PATH", "AI_WORKSPACE_DB_PATH"]) assert.ok(process.env[k]!.startsWith(TMP), k);
  assert.equal(fetchCalls, 0);
  assert.equal(fs.existsSync(path.join(ROOT, "data", "auth.db")) && fs.statSync(path.join(ROOT, "data", "auth.db")).mtimeMs > Date.now() - 600_000, false, "repo data/auth.db touched");
});

// ---------------------------------------------------------------- summary
store.__setAuthRepositoryForTests(null);
console.log(`\n${"─".repeat(56)}\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log(`network attempts during run: ${fetchCalls}`);
fs.rmSync(TMP, { recursive: true, force: true });
if (failed) { console.log(`FAILED: ${failures.join(", ")}`); process.exit(1); }
console.log("ALL PASS");
