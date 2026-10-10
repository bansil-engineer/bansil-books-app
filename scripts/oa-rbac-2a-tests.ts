// ============================================================
// OA-RBAC-2a — centralized authorization, live revocation and route
// coverage gate: isolated test suite.
//
// Run: node --experimental-strip-types scripts/oa-rbac-2a-tests.ts
//
// ISOLATION: all databases live in a fresh os.tmpdir() directory; every DB
// path env var points there BEFORE any app module loads. AUTH_SECRET and
// AUTH_USERS are synthetic. Outbound network (fetch) is disabled and
// counted. No production data, no Zoho, no real credentials.
// ============================================================

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "oa-rbac-2a-"));
for (const k of ["AUTH_USER_STORE", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "BANSIL_ZOHO_TOKEN_FILE"]) delete process.env[k];
process.env.BANSIL_RUNTIME_DB_DIR = path.join(TMP, "data");
process.env.BANSIL_BOOKS_DB_PATH = path.join(TMP, "data", "books.db");
process.env.AUDIT_WORKSPACE_DB_PATH = path.join(TMP, "data", "audit.db");
process.env.AI_WORKSPACE_DB_PATH = path.join(TMP, "data", "ai.db");
process.env.ESTIMATION_DB_PATH = path.join(TMP, "data", "estimation.sqlite");
process.env.AUTH_DB_PATH = path.join(TMP, "data", "auth.db");
process.env.BANSIL_ZOHO_TOKEN_FILE = path.join(TMP, "data", ".tokens.json");
process.env.BANSIL_READ_ONLY_SESSION = "1";
process.env.AUTH_SECRET = randomBytes(32).toString("hex");
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });

// Outbound network is disabled; any attempt is counted and fails.
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  throw new Error("network disabled in OA-RBAC-2a tests");
}) as typeof fetch;

const lib = (p: string) => pathToFileURL(path.join(ROOT, "app/lib", p)).href;
const auth = await import(lib("auth.ts"));
const { guardRoute, ACTION_TO_FUNCTION } = await import(lib("route-guard.ts"));
const { ROUTE_POLICIES, policyFor } = await import(lib("route-policy-manifest.ts"));
const store = await import(lib("auth-store.ts"));
const svc = await import(lib("auth-service.ts"));
const rl = await import(lib("auth-ratelimit.ts"));

// ------------------------------------------------------------------ harness
let passed = 0, failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  rl.__resetLoginRateLimiterForTests();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);
const BASE = "5ca41c900005003215a0accabef7ca636ef74a48"; // pre-RBAC-2a commit: "unchanged" checks compare against it (stays valid after a commit)


// ------------------------------------------------------------------ fixtures (env store)
const OWNER = "owner@synthetic.test";
const EMP = "employee@synthetic.test";   // admin: customers view+edit, reports view
const VIEW = "viewer@synthetic.test";    // viewer: reports view
const DASH = "dashboard.viewer@synthetic.test"; // P0 first employee: viewer, dashboard:view only
const NOGRANT = "nogrant.viewer@synthetic.test"; // viewer: services:view (no API route maps to services)
function legacyUser(email: string, name: string, role: string, modules: string[], pw = "Synthetic-Pass-0001") {
  const salt = auth.generateSalt();
  return { email, name, role, salt, hash: auth.hashPassword(pw, salt), modules };
}
const BASE_USERS = [
  legacyUser(OWNER, "Owner", "super_admin", ["*"]),
  legacyUser(EMP, "Employee", "admin", ["customers:view,edit", "reports:view"]),
  legacyUser(VIEW, "Viewer", "viewer", ["reports:view"]),
  legacyUser(DASH, "Dashboard Viewer", "viewer", ["dashboard:view"]),
  legacyUser(NOGRANT, "No-grant Viewer", "viewer", ["services:view"]),
];
function setAuthUsers(users: unknown[]) { process.env.AUTH_USERS = JSON.stringify(users); }
setAuthUsers(BASE_USERS);

const tok = (email: string, role: string, modules: string[], ttlH = 24) =>
  auth.createToken({ email, name: email, role, modules }, ttlH);
const T_OWNER = tok(OWNER, "super_admin", ["*"]);
const T_EMP = tok(EMP, "admin", ["customers:view,edit", "reports:view"]);
const T_VIEW = tok(VIEW, "viewer", ["reports:view"]);
// P0 first employee profile: Viewer / Read Only, Dashboard module, View only.
const T_DASH = tok(DASH, "viewer", ["dashboard:view"]);
// A viewer whose only grant (services) no API route maps to — denied everywhere.
const T_NOGRANT = tok(NOGRANT, "viewer", ["services:view"]);

function req(token?: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers ?? {}) };
  if (token) headers.cookie = `bansil_auth=${encodeURIComponent(token)}`;
  return new Request("http://localhost/api/test", {
    method: init.method ?? "POST",
    headers,
    body: init.method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
  });
}
const OWNER_ONLY = { classification: "OWNER_ONLY" as const };
const P = (k: string, m: string) => policyFor(k, m);

// ==================================================================
console.log("OA-RBAC-2a — centralized authorization tests");
console.log(`temp dir: ${TMP}`);

section("A. Valid Owner access");
await test("A1 Owner passes OWNER_ONLY (env store, live AUTH_USERS record)", async () => {
  const g = await guardRoute(req(T_OWNER), OWNER_ONLY);
  assert.equal(g.ok, true);
  assert.equal(g.principal.isOwner, true);
});
await test("A2 Owner passes every hardened policy (incl. MODULE_RESTRICTED and SPECIAL_GOVERNANCE)", async () => {
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      if (p.enforcement !== "route-guard") continue;
      assert.equal((await guardRoute(req(T_OWNER), P(k, m))).ok, true, `${k} ${m}`);
    }
  }
});

section("B. Valid authorized employee access");
await test("B1 employee with customers:edit passes action-taken POST (MODULE_RESTRICTED customers/edit)", async () => {
  const g = await guardRoute(req(T_EMP), P("action-taken", "POST"));
  assert.equal(g.ok, true);
  assert.equal(g.principal.email, EMP);
});

section("C. Unauthorized module access");
await test("C1 employee without reports:edit → 403 on reports/customer-material-control POST", async () => {
  const g = await guardRoute(req(T_EMP), P("reports/customer-material-control", "POST"));
  assert.equal(g.ok, false); assert.equal(g.status, 403);
});
await test("C2 viewer (reports only) → 403 on customers route", async () => {
  assert.equal((await guardRoute(req(T_VIEW), P("action-taken", "POST"))).status, 403);
});

section("D. Unauthorized function access");
await test("D1 viewer with reports:view → 403 on reports edit (function not granted + viewer ceiling)", async () => {
  assert.equal((await guardRoute(req(T_VIEW), P("reports/customer-material-control", "POST"))).status, 403);
});
await test("D2 employee customers view+edit → 403 for customers delete/export", async () => {
  for (const action of ["delete", "export"]) {
    const g = await guardRoute(req(T_EMP), { classification: "MODULE_RESTRICTED", module: "customers", action });
    assert.equal(g.status, 403, action);
  }
});
await test("D3 approve / reject / manage / sync have no approved grant → non-Owner always 403", async () => {
  for (const action of ["approve", "reject", "manage", "sync"]) {
    assert.equal(ACTION_TO_FUNCTION[action], undefined);
    const full = tok(EMP, "admin", ["*"]);
    setAuthUsers([BASE_USERS[0], { ...BASE_USERS[1], modules: ["*"] }, BASE_USERS[2]]);
    try {
      assert.equal((await guardRoute(req(full), { classification: "MODULE_RESTRICTED", module: "customers", action })).status, 403, action);
    } finally { setAuthUsers(BASE_USERS); }
  }
});

section("E. Direct API bypass attempts");
await test("E1 validly-signed JWT claiming super_admin/* for an employee → still 403 (live record, not claims)", async () => {
  const claims = tok(EMP, "super_admin", ["*"]);
  assert.equal((await guardRoute(req(claims), OWNER_ONLY)).status, 403);
});
await test("E2 client-supplied role/user headers and body fields are ignored", async () => {
  const r = req(T_EMP, { body: { role: "super_admin", user: OWNER, isOwner: true }, headers: { "x-user-role": "super_admin", "x-user-email": OWNER } });
  assert.equal((await guardRoute(r, OWNER_ONLY)).status, 403);
});
await test("E3 no cookie / empty cookie / cookie for another name → 401 (cookie cleared)", async () => {
  for (const r of [req(), req(""), new Request("http://localhost/x", { method: "POST", headers: { cookie: "other=1" } })]) {
    const g = await guardRoute(r, OWNER_ONLY);
    assert.equal(g.status, 401);
    assert.match(g.response.headers.get("set-cookie") ?? "", /bansil_auth=; Path=\/; Max-Age=0/);
  }
});

section("F. Disabled / removed user with existing JWT");
await test("F1 env store: user removed from AUTH_USERS → existing JWT rejected (401)", async () => {
  setAuthUsers([BASE_USERS[0], BASE_USERS[2]]);
  try { assert.equal((await guardRoute(req(T_EMP), P("action-taken", "POST"))).status, 401); }
  finally { setAuthUsers(BASE_USERS); }
});

section("G/H. Role / permission change with stale JWT (env store: live record)");
await test("G1 env: employee demoted admin→viewer in AUTH_USERS → stale admin JWT gets 403 on edit", async () => {
  setAuthUsers([BASE_USERS[0], { ...BASE_USERS[1], role: "viewer", modules: ["customers:view"] }, BASE_USERS[2]]);
  try { assert.equal((await guardRoute(req(T_EMP), P("action-taken", "POST"))).status, 403); }
  finally { setAuthUsers(BASE_USERS); }
});
await test("G3 env: stale JWT role claim (admin) cannot override a live demotion to viewer (module still listed)", async () => {
  // Live record: viewer with a whole-module 'customers' grant → the viewer ceiling must block edit.
  // A stale token still claims role admin; if the guard trusted the claim, edit would be allowed.
  setAuthUsers([BASE_USERS[0], { ...BASE_USERS[1], role: "viewer", modules: ["customers"] }, BASE_USERS[2]]);
  try { assert.equal((await guardRoute(req(T_EMP), P("action-taken", "POST"))).status, 403); }
  finally { setAuthUsers(BASE_USERS); }
});
await test("H1 env: customers:edit grant removed → stale JWT (claiming edit) gets 403", async () => {
  setAuthUsers([BASE_USERS[0], { ...BASE_USERS[1], modules: ["customers:view"] }, BASE_USERS[2]]);
  try { assert.equal((await guardRoute(req(T_EMP), P("action-taken", "POST"))).status, 403); }
  finally { setAuthUsers(BASE_USERS); }
});

section("J/K. Expired and forged tokens");
await test("J1 expired JWT → 401", async () => {
  assert.equal((await guardRoute(req(tok(OWNER, "super_admin", ["*"], -1)), OWNER_ONLY)).status, 401);
});
await test("K1 forged JWT (other secret), alg:none, tampered payload, garbage → 401", async () => {
  const real = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  const forged = tok(OWNER, "super_admin", ["*"]);
  process.env.AUTH_SECRET = real;
  const [h, b, s] = T_EMP.split(".");
  const tampered = [h, Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), sub: OWNER, role: "super_admin" })).toString("base64url"), s].join(".");
  const none = [Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url"), b, ""].join(".");
  for (const t of [forged, tampered, none, "garbage", "a.b.c"]) {
    assert.equal((await guardRoute(req(t), OWNER_ONLY)).status, 401, t.slice(0, 20));
  }
});

section("L. Object / project scope");
await test("L1 scope hook denies cross-project access (403) even for a permitted module", async () => {
  const policy = { classification: "MODULE_RESTRICTED", module: "customers", action: "edit",
    scope: (p: any, r: Request) => new URL(r.url).searchParams.get("project") === "P-ASSIGNED" && p.email === EMP };
  const own = new Request("http://localhost/api/x?project=P-ASSIGNED", { method: "POST", headers: { cookie: `bansil_auth=${T_EMP}` } });
  const other = new Request("http://localhost/api/x?project=P-OTHER", { method: "POST", headers: { cookie: `bansil_auth=${T_EMP}` } });
  assert.equal((await guardRoute(own, policy)).ok, true);
  assert.equal((await guardRoute(other, policy)).status, 403);
});
await test("L2 throwing scope hook fails closed (403)", async () => {
  const policy = { classification: "AUTHENTICATED", scope: () => { throw new Error("boom"); } };
  assert.equal((await guardRoute(req(T_EMP), policy)).status, 403);
});

section("N. No privilege escalation / fail closed");
await test("N1 policyFor() on unknown route or non-guard entry → Owner-only (never open)", async () => {
  for (const [k, m] of [["does/not/exist", "POST"], ["auth/login", "POST"], ["action-taken", "DELETE"]]) {
    assert.deepEqual(policyFor(k, m), { classification: "OWNER_ONLY" });
    assert.equal((await guardRoute(req(T_EMP), policyFor(k, m))).status, 403);
  }
});
await test("N2 unknown classification / malformed MODULE_RESTRICTED → non-Owner 403", async () => {
  assert.equal((await guardRoute(req(T_EMP), { classification: "SOMETHING" } as any)).status, 403);
  assert.equal((await guardRoute(req(T_EMP), { classification: "MODULE_RESTRICTED" } as any)).status, 403);
  assert.equal((await guardRoute(req(T_EMP), { classification: "MODULE_RESTRICTED", module: "not-a-module", action: "edit" } as any)).status, 403);
});
await test("N3 viewer ceiling holds even with tampered live grant (viewer + customers:edit)", async () => {
  setAuthUsers([BASE_USERS[0], BASE_USERS[1], { ...BASE_USERS[2], modules: ["customers"] }]);
  try { assert.equal((await guardRoute(req(T_VIEW), P("action-taken", "POST"))).status, 403); }
  finally { setAuthUsers(BASE_USERS); }
});

section("P. Legacy-mode compatibility");
await test("P1 default store is env; auth.db never created by the guard", async () => {
  assert.equal(store.getUserStoreMode(), "env");
  await guardRoute(req(T_OWNER), OWNER_ONLY);
  assert.equal(fs.existsSync(process.env.AUTH_DB_PATH!), false);
});
await test("P2 legacy Owner login + JWT verification + Owner passphrase functions unchanged vs base 5ca41c9", async () => {
  const diff = execFileSync("git", ["diff", BASE, "--", "app/lib/auth.ts", "app/lib/auth-edge.ts",
    "app/api/auth/login/route.ts", "app/lib/audit/owner-auth.ts"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(diff, "", "auth/login/owner-auth must be untouched by OA-RBAC-2a / P0");
  assert.ok(auth.authenticate(OWNER, "Synthetic-Pass-0001"));
});
await test("P4 middleware change is ONLY the /api static-suffix exemption fix (JWT verification + PUBLIC_PATHS unchanged)", async () => {
  const diff = execFileSync("git", ["diff", "-U0", BASE, "--", "middleware.ts"], { cwd: ROOT, encoding: "utf8" });
  const changed = diff.split("\n").filter((l) => /^[+-][^+-]/.test(l)).join("\n");
  assert.doesNotMatch(changed, /verifyTokenEdge|PUBLIC_PATHS|bansil_auth|Unauthorized/, "verification / public paths must not change");
  assert.match(changed, /isApi/);
});
await test("P6 api-guard change is ADDITIVE only: live-Owner check added before the unchanged passphrase checks", async () => {
  const diff = execFileSync("git", ["diff", "-U0", BASE, "--", "app/lib/audit/api-guard.ts"], { cwd: ROOT, encoding: "utf8" });
  const removed = diff.split("\n").filter((l) => /^-[^-]/.test(l));
  assert.deepEqual(removed, [], "no existing api-guard line may be removed");
  const src = fs.readFileSync(path.join(ROOT, "app/lib/audit/api-guard.ts"), "utf8");
  assert.match(src, /export function requireOwnerSession\(req: NextRequest\): NextResponse \| null \{\n  const notOwner = liveOwnerDenied\(req\);\n  if \(notOwner\) return notOwner;/);
  assert.match(src, /isValidOwnerSession\(token\)/);
});
await test("P5 malformed or missing AUTH_USERS → 503 fail-closed, caller's cookie NOT cleared", async () => {
  for (const bad of ["{not json", JSON.stringify({ email: OWNER }), JSON.stringify([{ name: "no email" }]), ""]) {
    process.env.AUTH_USERS = bad;
    try {
      const g = await guardRoute(req(T_OWNER), OWNER_ONLY);
      assert.equal(g.status, 503, bad.slice(0, 20));
      assert.equal(g.response.headers.get("set-cookie"), null);
    } finally { setAuthUsers(BASE_USERS); }
  }
});
await test("E4 duplicate bansil_auth cookies (e.g. Owner + employee) → 401, never ambiguous", async () => {
  for (const order of [[T_OWNER, T_EMP], [T_EMP, T_OWNER], [T_OWNER, T_OWNER]]) {
    const r = new Request("http://localhost/x", { method: "POST", headers: { cookie: `bansil_auth=${order[0]}; theme=1; bansil_auth=${order[1]}` } });
    assert.equal((await guardRoute(r, OWNER_ONLY)).status, 401);
  }
});
await test("E5 email matching against the live record is case-insensitive (no lockout, no duplicate identity)", async () => {
  const upper = tok(OWNER.toUpperCase(), "super_admin", ["*"]);
  const g = await guardRoute(req(upper), OWNER_ONLY);
  assert.equal(g.ok, true);
  assert.equal(g.principal.email, OWNER);
});
await test("P3 invalid AUTH_USER_STORE → 503 (fail closed)", async () => {
  process.env.AUTH_USER_STORE = "database";
  try { assert.equal((await guardRoute(req(T_OWNER), OWNER_ONLY)).status, 503); }
  finally { delete process.env.AUTH_USER_STORE; }
});

// ------------------------------------------------------------------ DB store: immediate revocation
section("F/G/H/I. DB store — immediate revocation on every guarded request");
process.env.AUTH_USER_STORE = "db";
const repo = store.getAuthRepository();
assert.ok(repo.importFromAuthUsersJson(JSON.stringify([BASE_USERS[0]]), { email: "m@l", role: "system", correlationId: "seed-0001" }).ok);
const OWNER_ACTOR = { email: OWNER, role: "super_admin", correlationId: "seed-0002" };
await repo.createUser(OWNER_ACTOR, { email: EMP, name: "Employee", role: "admin", modules: ["customers:view,edit", "reports:view"], password: "Employee-Synthetic-1" });
async function dbLogin(email: string, pw: string) {
  const r = await svc.dbLogin(repo, { cookie: () => undefined, header: (h: string) => (h === "content-type" ? "application/json" : null), body: { email, password: pw } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.cookie.value as string;
}
const D_OWNER = await dbLogin(OWNER, "Synthetic-Pass-0001");
await test("A3 DB store: Owner passes OWNER_ONLY; employee passes MODULE_RESTRICTED customers/edit", async () => {
  assert.equal((await guardRoute(req(D_OWNER), OWNER_ONLY)).ok, true);
  assert.equal((await guardRoute(req(await dbLogin(EMP, "Employee-Synthetic-1")), P("action-taken", "POST"))).ok, true);
});
await test("F2 DB store: deactivation → existing JWT rejected on the very next guarded request (401)", async () => {
  const t = await dbLogin(EMP, "Employee-Synthetic-1");
  assert.equal((await guardRoute(req(t), P("action-taken", "POST"))).ok, true);
  assert.ok(repo.setActive(OWNER_ACTOR, EMP, false).ok);
  assert.equal((await guardRoute(req(t), P("action-taken", "POST"))).status, 401);
  assert.ok(repo.setActive(OWNER_ACTOR, EMP, true).ok);
});
await test("G2 DB store: role change → stale JWT 401", async () => {
  const t = await dbLogin(EMP, "Employee-Synthetic-1");
  assert.ok(repo.updateUser(OWNER_ACTOR, { email: EMP, role: "viewer", modules: ["customers:view"] }).ok);
  assert.equal((await guardRoute(req(t), P("action-taken", "POST"))).status, 401);
  assert.ok(repo.updateUser(OWNER_ACTOR, { email: EMP, role: "admin", modules: ["customers:view,edit", "reports:view"] }).ok);
});
await test("H2 DB store: permission change → stale JWT 401; fresh login gets the NEW rights only", async () => {
  const t = await dbLogin(EMP, "Employee-Synthetic-1");
  assert.ok(repo.updateUser(OWNER_ACTOR, { email: EMP, modules: ["customers:view", "reports:view"] }).ok);
  assert.equal((await guardRoute(req(t), P("action-taken", "POST"))).status, 401);
  const fresh = await dbLogin(EMP, "Employee-Synthetic-1");
  assert.equal((await guardRoute(req(fresh), P("action-taken", "POST"))).status, 403, "edit no longer granted");
  assert.ok(repo.updateUser(OWNER_ACTOR, { email: EMP, modules: ["customers:view,edit", "reports:view"] }).ok);
});
await test("I1 DB store: password change revokes prior sessions (401); reset link acceptance too", async () => {
  const t1 = await dbLogin(EMP, "Employee-Synthetic-1");
  assert.ok((await repo.changeOwnPassword({ email: EMP, role: "admin", correlationId: "pw-0001" }, "Employee-Synthetic-1", "Employee-Synthetic-2")).ok);
  assert.equal((await guardRoute(req(t1), P("action-taken", "POST"))).status, 401);
  const t2 = await dbLogin(EMP, "Employee-Synthetic-2");
  const inv = repo.issueInvitation(OWNER_ACTOR, EMP, "reset");
  assert.ok((await repo.acceptInvitation(inv.token, "Employee-Synthetic-3", "pw-0002")).ok);
  assert.equal((await guardRoute(req(t2), P("action-taken", "POST"))).status, 401);
});
await test("I2 DB store: logout (jti revocation) → token rejected by the guard", async () => {
  const t = await dbLogin(EMP, "Employee-Synthetic-3");
  svc.dbLogout(repo, { cookie: (n: string) => (n === "bansil_auth" ? t : undefined), header: () => null, body: {} });
  assert.equal((await guardRoute(req(t), P("action-taken", "POST"))).status, 401);
});
await test("J2/K2 DB store: expired, env-issued and forged tokens → 401", async () => {
  const rec = repo.getUserRecord(EMP);
  const expired = auth.createToken({ email: EMP, name: "E", role: "admin", modules: [] }, -1, { sv: rec.sessionVersion, jti: "x-expired" });
  const envTok = tok(EMP, "admin", ["*"]);
  for (const t of [expired, envTok, "garbage"]) assert.equal((await guardRoute(req(t), OWNER_ONLY)).status, 401);
});
await test("N4 DB store: validly-signed super_admin claim for a non-owner → 403; denial audited", async () => {
  const rec = repo.getUserRecord(EMP);
  const claim = auth.createToken({ email: EMP, name: "E", role: "super_admin", modules: ["*"] }, 8, { sv: rec.sessionVersion, jti: "claim-1" });
  assert.equal((await guardRoute(req(claim), OWNER_ONLY, "test-route POST")).status, 403);
  assert.ok(repo.listAudit(5).some((a: any) => a.action === "access.denied" && a.actor_email === EMP && /test-route POST/.test(a.detail)));
});
delete process.env.AUTH_USER_STORE;

// ------------------------------------------------------------------ route-level: real handlers
section("E/M/O. Route level — real hardened handlers (forbidden requests cannot read or mutate)");
const useShim = !fs.existsSync(path.join(ROOT, "node_modules", "next", "server.js"));
register(pathToFileURL(path.join(ROOT, "scripts/lib/rbac-route-loader.mjs")).href,
  { data: { root: ROOT, shimDir: path.join(ROOT, "scripts/lib/next-shim"), useShim } });
const { NextRequest } = await import("next/server");
function nreq(key: string, method: string, token?: string, body: unknown = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
  if (token) headers.cookie = `bansil_auth=${encodeURIComponent(token)}`;
  return new NextRequest(`http://localhost/api/${key.replace(/\[\[?\.{0,3}(\w+)\]?\]/g, "x")}`,
    { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) });
}
const ctx = { params: Promise.resolve({ id: "synthetic-id", segments: ["tasks"] }) };
function snapshot(): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(p).update(fs.readFileSync(p));
    }
  };
  walk(path.join(TMP, "data"));
  // Repo-relative locations some handlers write to (GST cache, orchestrator data):
  // hashed recursively, contents included.
  for (const extra of ["output", "tools/chatgpt-antigravity-orchestrator/data"]) {
    const p = path.join(ROOT, extra);
    h.update(extra);
    if (fs.existsSync(p)) walk(p);
  }
  return h.digest("hex");
}

const hardened: Array<{ key: string; method: string; policy: any }> = [];
for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
  for (const [m, p] of Object.entries(ms) as [string, any][]) if (p.enforcement === "route-guard") hardened.push({ key: k, method: m, policy: p });
}
const loaded = new Map<string, any>();
const notLoadable: string[] = [];
for (const { key } of hardened) {
  if (loaded.has(key) || notLoadable.includes(key)) continue;
  try { loaded.set(key, await import(pathToFileURL(path.join(ROOT, "app/api", key, "route.ts")).href)); }
  catch { notLoadable.push(key); }
}
console.log(`  (real handlers loaded: ${loaded.size}/${new Set(hardened.map((h) => h.key)).size}; ` +
  `next/server: ${useShim ? "test shim" : "real package"}; not loadable in plain node: ${notLoadable.length})`);

await test("R1 every loadable hardened handler: no session → 401, and NO data/file change, NO network", async () => {
  let checked = 0;
  for (const h of hardened) {
    const mod = loaded.get(h.key); if (!mod) continue;
    const before = snapshot(); const net = fetchCalls;
    const res = await mod[h.method](nreq(h.key, h.method), ctx);
    assert.equal(res.status, 401, `${h.key} ${h.method}`);
    assert.equal(snapshot(), before, `${h.key} ${h.method} changed data`);
    assert.equal(fetchCalls, net, `${h.key} ${h.method} made a network call`);
    checked++;
  }
  assert.ok(checked >= 40, `only ${checked} handlers exercised`);
});
await test("R2 every loadable hardened handler: authenticated non-permitted employee → 403, NO data change, NO network", async () => {
  for (const h of hardened) {
    const mod = loaded.get(h.key); if (!mod) continue;
    if (h.policy.classification === "AUTHENTICATED") continue; // any live user — see FE3
    const who = h.policy.classification === "MODULE_RESTRICTED" ? T_NOGRANT : T_EMP;
    const before = snapshot(); const net = fetchCalls;
    const res = await mod[h.method](nreq(h.key, h.method, who, { role: "super_admin", approvedBy: OWNER }), ctx);
    assert.equal(res.status, 403, `${h.key} ${h.method}`);
    assert.equal(snapshot(), before, `${h.key} ${h.method} changed data`);
    assert.equal(fetchCalls, net, `${h.key} ${h.method} made a network call`);
  }
});
await test("R3 AI approval: employee cannot approve (row unchanged); Owner can (end-to-end on temp DB)", async () => {
  const { getAiDatabase } = await import(lib("db/ai-database.ts"));
  const db = getAiDatabase();
  const cols = (db.prepare("PRAGMA table_info(ai_approvals)").all() as any[]).map((c) => c.name);
  assert.ok(cols.includes("status"), "ai_approvals table present");
  const row: Record<string, unknown> = { id: "appr-synthetic-1", status: "PENDING" };
  for (const c of db.prepare("PRAGMA table_info(ai_approvals)").all() as any[]) {
    if (!(c.name in row) && c.notnull && c.dflt_value === null && !c.pk) row[c.name] = c.type.toUpperCase().includes("INT") ? 0 : "synthetic";
  }
  const names = Object.keys(row);
  // Test fixture only: the parent ai_runs row is irrelevant to the approval
  // decision, so seed with FK checks off for this one insert, then restore.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.prepare(`INSERT INTO ai_approvals (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...names.map((n) => row[n] as any));
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  const mod = loaded.get("ai/approvals/[id]/approve");
  const c2 = { params: Promise.resolve({ id: "appr-synthetic-1" }) };
  assert.equal((await mod.POST(nreq("ai/approvals/[id]/approve", "POST", T_EMP), c2)).status, 403);
  assert.equal((db.prepare("SELECT status FROM ai_approvals WHERE id='appr-synthetic-1'").get() as any).status, "PENDING");
  assert.equal((await mod.POST(nreq("ai/approvals/[id]/approve", "POST", T_OWNER), c2)).status, 200);
  assert.equal((db.prepare("SELECT status FROM ai_approvals WHERE id='appr-synthetic-1'").get() as any).status, "APPROVED");
});
await test("M1 Owner passphrase gate preserved: employee 403 before passphrase; Owner still needs the passphrase", async () => {
  const mod = loaded.get("audit/auth/login");
  const e = await mod.POST(nreq("audit/auth/login", "POST", T_EMP, { passphrase: "anything" }));
  assert.equal(e.status, 403);
  const o = await mod.POST(nreq("audit/auth/login", "POST", T_OWNER, { passphrase: "wrong-passphrase-123" }));
  assert.equal(o.status, 401, "wrong passphrase still rejected for the Owner");
  assert.match(JSON.stringify(await o.json()), /Invalid passphrase/);
});
await test("M2 existing Owner-session / C-1 routes still carry their passphrase guards (unchanged files)", async () => {
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    const kinds = new Set(Object.values(ms).map((p: any) => p.enforcement));
    const src = fs.readFileSync(path.join(ROOT, "app/api", k, "route.ts"), "utf8");
    if (kinds.has("owner-session")) assert.match(src, /requireOwnerSession\(/, k);
    if (kinds.has("owner-session+jwt-role")) assert.match(src, /requireOwnerSessionOrForbid\(/, k);
  }
  const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "app/api"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of changed) {
    const k = f.replace(/^app\/api\//, "").replace(/\/route\.ts$/, "");
    assert.ok(Object.values(ROUTE_POLICIES[k] ?? {}).some((p: any) => p.rbac2a === "HARDENED"), `${f} changed but is not a 2a-hardened route`);
  }
});
await test("O1 Zoho-touching hardened routes deny non-Owners before any network call", async () => {
  let n = 0;
  for (const [key, m] of [["zoho/select-org", "POST"], ["audit/evidence/zoho-sync", "POST"], ["activity", "POST"], ["activity/backfill", "POST"],
    ["zoho/data", "GET"], ["zoho/organizations", "GET"], ["zoho/api-usage", "GET"], ["audit/order-comparison", "GET"], ["audit/order-quantities", "GET"]]) {
    const mod = loaded.get(key); if (!mod) continue;
    const net = fetchCalls;
    assert.equal((await mod[m](nreq(key, m, T_EMP, { organizationId: "123" }), ctx)).status, 403, `${key} ${m}`);
    assert.equal(fetchCalls, net, key);
    n++;
  }
  assert.ok(n >= 5, `only ${n} Zoho routes exercised`);
});
await test("MW1 real middleware: /api path with a static-file suffix no longer skips JWT verification", async () => {
  const { middleware } = await import(pathToFileURL(path.join(ROOT, "middleware.ts")).href);
  const call = async (p: string, token?: string) => {
    const headers: Record<string, string> = token ? { cookie: `bansil_auth=${token}` } : {};
    return middleware(new NextRequest(`http://localhost${p}`, { headers }));
  };
  for (const p of ["/api/ai/conversations/abc.png", "/api/ai/memory/x.js", "/api/zoho/data.css", "/api/orchestrator/tasks.woff2"]) {
    assert.equal((await call(p)).status, 401, p);
  }
  assert.equal((await call("/api/ai/conversations/abc.png", T_OWNER)).status, 200, "valid session still passes");
  for (const p of ["/logo.png", "/app.css", "/_next/static/chunk.js", "/favicon.ico", "/api/auth/login"]) {
    assert.equal((await call(p)).status, 200, `${p} must stay exempt/public`);
  }
  const page = await call("/dashboard");
  assert.equal(page.status, 307, "unauthenticated page still redirects to /login");
});
await test("O2 guard and manifest contain no Zoho client, fetch or HTTP write methods", async () => {
  for (const f of ["app/lib/route-guard.ts", "app/lib/route-policy-manifest.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/zoho-api|zoho-token-store|\bfetch\(|node:https?/.test(src), f);
  }
});

// ------------------------------------------------------------------ Q. coverage gate
section("Q. Automated route coverage gate");
const routeFiles: string[] = [];
(function walk(d: string) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f === "route.ts" || f === "route.js") routeFiles.push(path.relative(path.join(ROOT, "app/api"), path.dirname(p)).split(path.sep).join("/"));
  }
})(path.join(ROOT, "app/api"));
const exported = (src: string) => [
  ...[...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]),
  ...[...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)].map((m) => m[1]),
];
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Write methods knowingly left Edge-JWT-only in 2a — each needs a stated reason. Adding to this list is a review event. */
const WRITE_ALLOWLIST_2B: Record<string, string> = {
  // P0: emptied — both former entries (audit/auth/logout POST, ai/estimation/technical-equivalence POST)
  // now run the live guard. Adding an entry here is a review event.
};

await test("Q1 every route file has a manifest entry and every manifest entry has a route file", async () => {
  const keys = Object.keys(ROUTE_POLICIES);
  assert.deepEqual(routeFiles.filter((r) => !keys.includes(r)), [], "unclassified route files");
  assert.deepEqual(keys.filter((k) => !routeFiles.includes(k)), [], "manifest entries without a route file");
  assert.equal(routeFiles.length, 172);
});
await test("Q2 every exported HTTP method is classified (and no phantom methods)", async () => {
  for (const r of routeFiles) {
    const ms = exported(fs.readFileSync(path.join(ROOT, "app/api", r, "route.ts"), "utf8"));
    assert.deepEqual([...new Set(ms)].sort(), Object.keys(ROUTE_POLICIES[r]).sort(), r);
  }
});
await test("Q3 every route-guard entry is actually enforced as the FIRST statement of its handler", async () => {
  let n = 0;
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    const src = fs.readFileSync(path.join(ROOT, "app/api", k, "route.ts"), "utf8");
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      if (p.enforcement !== "route-guard") continue;
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Guard must be the first statement AND be immediately followed by its return check.
      const tail = `, "[^"]*"\\);\\n\\s*if \\(!rbacGuard\\.ok\\) return rbacGuard\\.response;`;
      const direct = new RegExp(
        `export\\s+async\\s+function\\s+${m}\\s*\\([\\s\\S]*?\\)\\s*(?::[^{]+)?\\{\\s*//[^\\n]*\\n\\s*const rbacGuard = await guardRoute\\(\\w+, policyFor\\("${esc}", "${m}"\\)${tail}`);
      const dispatch = new RegExp(`async function handle\\([^)]*\\)\\s*\\{\\s*//[^\\n]*\\n\\s*const rbacGuard = await guardRoute\\(request, policyFor\\("${esc}", request\\.method\\)${tail}`);
      assert.ok(direct.test(src) || (dispatch.test(src) && new RegExp(`export const ${m} = handle;`).test(src)), `${k} ${m}: guard not first statement / not followed by return`);
      n++;
    }
  }
  const expected = Object.values(ROUTE_POLICIES).flatMap((ms: any) => Object.values(ms)).filter((p: any) => p.rbac2a === "HARDENED").length;
  assert.equal(n, expected);
  assert.ok(n >= 65, `hardened methods ${n}`);
  // Every guard call site in app/api is accounted for by a HARDENED manifest entry.
  const sites = execFileSync("grep", ["-rho", "policyFor(\"[^\"]*\", [^)]*)", path.join(ROOT, "app/api")], { encoding: "utf8" }).trim().split("\n");
  for (const s of sites) {
    const [, key, meth] = s.match(/policyFor\("([^"]+)", "?([A-Za-z.]+)"?\)/)!;
    const ms = Object.entries(ROUTE_POLICIES[key] ?? {}).filter(([mm, p]: [string, any]) => p.rbac2a === "HARDENED" && (meth === "request.method" || mm === meth));
    assert.ok(ms.length > 0, `guard call ${s} has no HARDENED manifest entry`);
  }
});
await test("Q4 non-guard enforcement claims are visible in the route source", async () => {
  const MW = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");
  const publicPaths = [...MW.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    const src = fs.readFileSync(path.join(ROOT, "app/api", k, "route.ts"), "utf8");
    for (const p of Object.values(ms) as any[]) {
      const need: Record<string, RegExp> = {
        "owner-session": /requireOwnerSession\(/, "owner-session+jwt-role": /requireOwnerSessionOrForbid\(/,
        "auth-service": /runDbHandler|isDbStore/, "jwt-super-admin": /role\s*!==?\s*"super_admin"/,
        "custom-owner-session": /hasReadOnlyOwnerSession/,
      };
      if (need[p.enforcement]) assert.match(src, need[p.enforcement], `${k}: ${p.enforcement}`);
      if (p.classification === "PUBLIC") assert.ok(publicPaths.includes(`/api/${k}`), `${k} PUBLIC but not in middleware PUBLIC_PATHS`);
    }
  }
});
/** Source of one exported handler (up to the next top-level export). */
function handlerBody(src: string, m: string): string | null {
  const i = src.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`));
  if (i < 0) { const c = src.search(new RegExp(`export\\s+const\\s+${m}\\s*=`)); return c < 0 ? null : src.slice(c, c + 4000); }
  const rest = src.slice(i + 10); const j = rest.search(/\nexport\s/); return src.slice(i, j < 0 ? undefined : i + 10 + j);
}
await test("Q9 PER-METHOD: every pre-existing enforcement claim is present inside THAT method's handler (not just somewhere in the file)", async () => {
  const NEED: Record<string, RegExp> = {
    "owner-session": /requireOwnerSession(OrForbid)?\(/, "owner-session+jwt-role": /requireOwnerSessionOrForbid\(/,
    "auth-service": /runDbHandler|isDbStore/, "jwt-super-admin": /requireSuperAdmin\(|role\s*!==?\s*"super_admin"/,
    "custom-owner-session": /hasReadOnlyOwnerSession|requireOwner/,
  };
  const missing: string[] = [];
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    const src = fs.readFileSync(path.join(ROOT, "app/api", k, "route.ts"), "utf8");
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      const need = NEED[p.enforcement]; if (!need) continue;
      const b = handlerBody(src, m);
      if (!b || !need.test(b)) missing.push(`${k} ${m} (${p.enforcement})`);
    }
  }
  assert.deepEqual(missing, []);
  // negative control: the pre-P0 sync GET (no guard in its body) must be flagged
  const pre = execFileSync("git", ["show", `${BASE}:app/api/sync/route.ts`], { cwd: ROOT, encoding: "utf8" });
  assert.ok(!NEED["owner-session+jwt-role"].test(handlerBody(pre, "GET")!), "control: HEAD sync GET must be detected as unguarded");
});
await test("Q5 no write method is Edge-JWT-only except the reviewed allowlist", async () => {
  const offenders: string[] = [];
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      if (WRITE.has(m) && p.enforcement === "middleware-only" && !WRITE_ALLOWLIST_2B[`${k} ${m}`]) offenders.push(`${k} ${m}`);
    }
  }
  assert.deepEqual(offenders, []);
});
await test("Q6 MODULE_RESTRICTED entries use a real module and a delegable (mapped) action", async () => {
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    for (const p of Object.values(ms) as any[]) {
      if (p.classification !== "MODULE_RESTRICTED") continue;
      assert.ok((auth.ALL_MODULES as readonly string[]).includes(p.module), `${k} module`);
      assert.ok(ACTION_TO_FUNCTION[p.action], `${k} action ${p.action} not delegable`);
    }
  }
});
await test("Q7 a newly added unguarded write route fails the gate (simulated)", async () => {
  const fake = { ...ROUTE_POLICIES, "new/sensitive": { POST: { classification: "AUTHENTICATED", enforcement: "middleware-only", rbac2a: "PENDING_2B", note: "" } } };
  const offenders = Object.entries(fake).flatMap(([k, ms]: [string, any]) => Object.entries(ms)
    .filter(([m, p]: [string, any]) => WRITE.has(m) && p.enforcement === "middleware-only" && !WRITE_ALLOWLIST_2B[`${k} ${m}`]).map(([m]) => `${k} ${m}`));
  assert.deepEqual(offenders, ["new/sensitive POST"]);
  const unclassified = [...routeFiles, "brand/new"].filter((r) => !Object.keys(ROUTE_POLICIES).includes(r));
  assert.deepEqual(unclassified, ["brand/new"]);
});
await test("Q8 P0: NO route method is left Edge-JWT-only (PENDING_2B = 0); every method is guard-, owner-session- or auth-service-enforced", async () => {
  const pending = Object.entries(ROUTE_POLICIES).flatMap(([k, ms]: [string, any]) =>
    Object.entries(ms).filter(([, p]: [string, any]) => p.rbac2a === "PENDING_2B" || p.enforcement === "middleware-only").map(([m]) => `${k} ${m}`));
  assert.deepEqual(pending, []);
  const holds = Object.entries(ROUTE_POLICIES).flatMap(([k, ms]: [string, any]) =>
    Object.entries(ms).filter(([, p]: [string, any]) => p.rbac2a === "GOVERNANCE_HOLD").map(([m]) => `${k} ${m}`));
  console.log(`      governance hold (own Owner-session check, untouched): ${holds.length}; not loadable here: ${notLoadable.join(", ") || "none"}`);
});

// ------------------------------------------------------------------ P0: first employee (viewer, dashboard:view)
section("P0 — first employee: Viewer / Dashboard / View only (env store, live AUTH_USERS)");
const DASH_SOURCES: Record<string, string> = {
  "reconciliation GET": "/api/reconciliation?financialYear=2026-27",
  "inventory-mismatch GET": "/api/inventory-mismatch?financialYear=2026-27",
  "transactions GET": "/api/transactions?type=recent&financialYear=2026-27",
};
const dreq = (url: string, token = T_DASH) => new Request(`http://localhost${url}`, { headers: { cookie: `bansil_auth=${token}` } });
await test("FE1 guard level: dashboard viewer is DENIED on every route-guard method except the 3 Dashboard data sources + AUTHENTICATED session routes", async () => {
  let denied = 0;
  for (const h of hardened) {
    const id = `${h.key} ${h.method}`;
    if (DASH_SOURCES[id] || h.policy.classification === "AUTHENTICATED") continue;
    const g = await guardRoute(dreq(`/api/${h.key}`), P(h.key, h.method), id);
    assert.equal(g.ok, false, id); assert.equal(g.status, 403, id); denied++;
  }
  assert.ok(denied >= 120, `denied ${denied}`);
});
await test("FE2 dashboard viewer may read ONLY the Dashboard's data sources; transactions only with exactly type=recent", async () => {
  for (const [id, url] of Object.entries(DASH_SOURCES)) {
    const [k, m] = id.split(" ");
    assert.equal((await guardRoute(dreq(url), P(k, m), id)).ok, true, id);
  }
  for (const url of ["/api/transactions", "/api/transactions?type=all", "/api/transactions?type=bills", "/api/transactions?type=bill-detail&docId=1",
    "/api/transactions?type=recent&type=all", "/api/transactions?type=all&type=recent", "/api/transactions?type=RECENT", "/api/transactions?type=recent%20"]) {
    const g = await guardRoute(dreq(url), P("transactions", "GET"), url);
    assert.equal(g.status, 403, url);
  }
  // a viewer WITHOUT dashboard gets none of them
  for (const [id, url] of Object.entries(DASH_SOURCES)) {
    const [k, m] = id.split(" ");
    assert.equal((await guardRoute(dreq(url, T_NOGRANT), P(k, m), id)).status, 403, id);
  }
});
await test("FE3 AUTHENTICATED session routes accept any LIVE user, still reject removed users (401)", async () => {
  const auths = hardened.filter((h) => h.policy.classification === "AUTHENTICATED");
  assert.ok(auths.length >= 2);
  for (const h of auths) assert.equal((await guardRoute(dreq(`/api/${h.key}`), P(h.key, h.method))).ok, true, h.key);
  setAuthUsers(BASE_USERS.filter((u: any) => u.email !== DASH));
  try { for (const h of auths) assert.equal((await guardRoute(dreq(`/api/${h.key}`), P(h.key, h.method))).status, 401, h.key); }
  finally { setAuthUsers(BASE_USERS); }
});
const feSkipped: string[] = [];
const feOffenders: string[] = [];
await test("FE4 real handlers: dashboard viewer gets 403 (or Owner-session 401) on every loadable non-dashboard route — no data change, no network", async () => {
  let n = 0;
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    const mod = loaded.get(k) ?? await import(pathToFileURL(path.join(ROOT, "app/api", k, "route.ts")).href).catch(() => null);
    if (!mod) { feSkipped.push(k); continue; }
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      if (DASH_SOURCES[`${k} ${m}`] || p.classification === "AUTHENTICATED" || p.classification === "PUBLIC") continue;
      if (typeof mod[m] !== "function") continue;
      const before = snapshot(); const net = fetchCalls;
      let status: number;
      try { status = (await mod[m](nreq(k, m, T_DASH, { role: "super_admin" }), ctx)).status; }
      catch { status = -1; } // a throw before any data access is still "not served"
      // 409 = DB-store-only user management refusing in env mode (no data served; DB-mode Owner gate is covered by test:auth-db)
      const envRefusal = status === 409 && p.enforcement === "auth-service";
      if (!(status === 401 || status === 403 || status === -1 || envRefusal)) feOffenders.push(`${k} ${m} → ${status}`);
      if (snapshot() !== before) feOffenders.push(`${k} ${m} changed data`);
      if (fetchCalls !== net) feOffenders.push(`${k} ${m} network`);
      n++;
    }
  }
  assert.deepEqual(feOffenders, [], "served to the dashboard viewer");
  assert.ok(n >= 150, `exercised ${n}`);
  console.log(`      FE4 exercised ${n} methods; route files not loadable in plain node (static gate only): ${feSkipped.length} — ${feSkipped.join(", ")}`);
});
await test("FE6 Dashboard grant is limited to the Dashboard's own query: extra filters / drill-downs / duplicate FY → 403", async () => {
  for (const url of ["/api/reconciliation?financialYear=2026-27", "/api/reconciliation", "/api/inventory-mismatch?financialYear=2025-26",
    "/api/transactions?type=recent", "/api/transactions?financialYear=2026-27&type=recent"]) {
    const k = url.split("?")[0].replace("/api/", "");
    assert.equal((await guardRoute(dreq(url), P(k, "GET"), url)).ok, true, url);
  }
  for (const url of ["/api/reconciliation?financialYear=2026-27&customerId=C1", "/api/reconciliation?vendorName=x",
    "/api/inventory-mismatch?financialYear=2026-27&breakdownItemId=I1&breakdownCustomerId=C1", "/api/inventory-mismatch?itemId=I1",
    "/api/reconciliation?financialYear=2026-27&financialYear=2025-26", "/api/transactions?type=recent&limit=100000",
    "/api/transactions?type=recent&customerId=C1"]) {
    const k = url.split("?")[0].replace("/api/", "");
    assert.equal((await guardRoute(dreq(url), P(k, "GET"), url)).status, 403, url);
  }
  // a real reconciliation:view grant still allows filters
  const recon = tok(EMP, "admin", ["reconciliation:view"]);
  setAuthUsers([...BASE_USERS.filter((u: any) => u.email !== EMP), legacyUser(EMP, "Employee", "admin", ["reconciliation:view"])]);
  try { assert.equal((await guardRoute(dreq("/api/reconciliation?customerId=C1", recon), P("reconciliation", "GET"))).ok, true); }
  finally { setAuthUsers(BASE_USERS); }
});
await test("SB1 shared browser: employee signed in while the Owner's passphrase-session cookie is still present → Owner-session routes 403 (H1)", async () => {
  const oa = await import(lib("audit/owner-auth.ts"));
  if (!oa.isOwnerBootstrapped()) oa.bootstrapOwnerPassphrase("Synthetic-Owner-Passphrase-123");
  const sess = oa.attemptOwnerLogin("Synthetic-Owner-Passphrase-123");
  assert.ok(sess && oa.isValidOwnerSession(sess.token), "fixture owner session");
  const both = (key: string, m: string, jwt: string, body: unknown = {}) => new NextRequest(`http://localhost/api/${key.replace(/\[\[?\.{0,3}(\w+)\]?\]/g, "x")}`,
    { method: m, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: `bansil_auth=${encodeURIComponent(jwt)}; bansil_owner_session=${sess!.token}` },
      body: m === "GET" ? undefined : JSON.stringify(body) });
  let n = 0;
  for (const [k, ms] of Object.entries(ROUTE_POLICIES) as [string, any][]) {
    for (const [m, p] of Object.entries(ms) as [string, any][]) {
      if (p.enforcement !== "owner-session" && p.enforcement !== "owner-session+jwt-role") continue;
      const mod = loaded.get(k) ?? await import(pathToFileURL(path.join(ROOT, "app/api", k, "route.ts")).href).catch(() => null);
      if (!mod || typeof mod[m] !== "function") continue;
      const before = snapshot();
      const res = await mod[m](both(k, m, T_DASH, { passphrase: "x", name: "x" }), ctx);
      assert.equal(res.status, 403, `${k} ${m} served the employee with the Owner's passphrase session`);
      assert.equal(snapshot(), before, `${k} ${m} changed data`);
      n++;
    }
  }
  assert.ok(n >= 50, `exercised ${n}`);
  // the Owner with the same session cookie still passes the gate (not 401/403)
  const findings = await import(pathToFileURL(path.join(ROOT, "app/api/audit/findings/route.ts")).href);
  const ok = await findings.GET(both("audit/findings", "GET", T_OWNER), ctx);
  assert.ok(ok.status !== 401 && ok.status !== 403, `Owner blocked: ${ok.status}`);
  oa.destroyOwnerSession(sess!.token);
});
await test("FE5 dashboard viewer: removal from AUTH_USERS revokes the 3 Dashboard sources immediately (401)", async () => {
  setAuthUsers(BASE_USERS.filter((u: any) => u.email !== DASH));
  try {
    for (const [id, url] of Object.entries(DASH_SOURCES)) { const [k, m] = id.split(" "); assert.equal((await guardRoute(dreq(url), P(k, m))).status, 401, id); }
  } finally { setAuthUsers(BASE_USERS); }
});

// ------------------------------------------------------------------ P0-SECURITY-FINAL
section("P0-SECURITY-FINAL — Zoho OAuth callback + orchestrator token");
{
  const oa = await import(lib("audit/owner-auth.ts"));
  if (!oa.isOwnerBootstrapped()) oa.bootstrapOwnerPassphrase("Synthetic-Owner-Passphrase-123");
  const sess = oa.attemptOwnerLogin("Synthetic-Owner-Passphrase-123")!;
  const TOKEN_FILE = process.env.BANSIL_ZOHO_TOKEN_FILE!;
  const cb = await import(pathToFileURL(path.join(ROOT, "app/api/zoho/callback/route.ts")).href);
  const STATE = "3f1c2b7e-5d4a-4e8f-9a1b-2c3d4e5f6a7b";
  const call = async (q: string, cookies: Record<string, string>) => {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    return cb.GET(new NextRequest(`http://localhost/api/zoho/callback?${q}`, { headers: cookie ? { cookie } : {} }));
  };
  const attack = `code=ATTACKER-CODE&state=${STATE}&accounts-server=${encodeURIComponent("https://accounts.zoho.com")}&location=com`;
  // before === null: an authenticated Owner passphrase session legitimately refreshes its own
  // last_seen_at in the (temp) audit DB, so only the token store + network are asserted.
  const noTouch = (label: string, net: number, before: string | null) => {
    assert.equal(fs.existsSync(TOKEN_FILE), false, `${label}: token store written`);
    assert.equal(fetchCalls, net, `${label}: network/token exchange attempted`);
    if (before !== null) assert.equal(snapshot(), before, `${label}: data changed`);
  };
  await test("Z1 callback with NO session (the curl attack, attacker-chosen state cookie) → 401; no exchange; tokens untouched", async () => {
    const net = fetchCalls, before = snapshot();
    const r = await call(attack, { zoho_oauth_state: STATE });
    assert.equal(r.status, 401);
    noTouch("Z1", net, before);
  });
  await test("Z2 callback as an authenticated NON-Owner (employee / dashboard viewer) → 403; no exchange", async () => {
    for (const t of [T_EMP, T_DASH, T_VIEW]) {
      const net = fetchCalls, before = snapshot();
      const r = await call(attack, { bansil_auth: t, zoho_oauth_state: STATE, bansil_owner_session: sess.token });
      assert.equal(r.status, 403);
      noTouch("Z2", net, before);
    }
  });
  await test("Z3 live Owner but NO state cookie (state not issued by the passphrase-gated connect) → refused; forged super_admin JWT for a removed user → 401", async () => {
    let net = fetchCalls, before = snapshot();
    const r0 = await call(attack, { bansil_auth: T_OWNER });
    assert.equal(r0.status, 307); assert.match(decodeURIComponent(r0.headers.get("location") ?? ""), /state validation failed/);
    noTouch("Z3a", net, before);
    net = fetchCalls; before = snapshot();
    const ghost = tok("ghost@synthetic.test", "super_admin", ["*"]);
    assert.equal((await call(attack, { bansil_auth: ghost, zoho_oauth_state: STATE, bansil_owner_session: sess.token })).status, 401);
    noTouch("Z3b", net, before);
  });
  // Real redirect from Zoho: the SameSite=Strict passphrase cookie is NOT sent; the Lax login cookie is.
  const owner = { bansil_auth: T_OWNER };
  await test("Z4 Owner + passphrase session but state missing / mismatched → refused (redirect with error); no exchange", async () => {
    for (const [q, c] of [[attack, {}], [attack, { zoho_oauth_state: "other-state" }], [`code=X&accounts-server=${encodeURIComponent("https://accounts.zoho.com")}`, { zoho_oauth_state: STATE }]] as const) {
      const net = fetchCalls, before = null;
      process.env.ZOHO_CLIENT_ID = "synthetic-client-id"; process.env.ZOHO_CLIENT_SECRET = "synthetic-client-secret"; process.env.ZOHO_REDIRECT_URI = "http://localhost/api/zoho/callback";
      let r: Response;
      try { r = await call(q, { ...owner, ...c }); }
      finally { delete process.env.ZOHO_CLIENT_ID; delete process.env.ZOHO_CLIENT_SECRET; delete process.env.ZOHO_REDIRECT_URI; }
      assert.equal(r.status, 307);
      // must be refused BY THE STATE CHECK (credentials are configured, so nothing later would refuse it)
      assert.match(decodeURIComponent(r.headers.get("location") ?? ""), /state validation failed/);
      noTouch("Z4", net, before);
    }
  });
  await test("Z5 Owner + valid state but non-Zoho / malformed accounts-server → refused BEFORE any exchange (client secret never sent)", async () => {
    for (const bad of ["https://evil.example", "https://accounts.zoho.com.evil.test", "http://accounts.zoho.com", "https://accounts.zoho.com:8443",
      "https://user@accounts.zoho.com", "https://accounts.zoho.com/oauth", "https://accounts.zoho.com/?x=1", "https://www.zohoapis.com", "not a url"]) {
      const net = fetchCalls, before = null;
      const r = await call(`code=X&state=${STATE}&accounts-server=${encodeURIComponent(bad)}`, { ...owner, zoho_oauth_state: STATE });
      assert.equal(r.status, 307, bad);
      assert.match(decodeURIComponent(r.headers.get("location") ?? ""), /unexpected accounts-server/, bad);
      assert.match(r.headers.get("set-cookie") ?? "", /zoho_oauth_state=;/, bad);
      noTouch(`Z5 ${bad}`, net, before);
    }
  });
  await test("Z6 Owner-supervised flow preserved (real redirect: Lax login cookie only) + valid state + official accounts host → reaches the token exchange (network stubbed); failure leaves tokens untouched", async () => {
    process.env.ZOHO_CLIENT_ID = "synthetic-client-id"; process.env.ZOHO_CLIENT_SECRET = "synthetic-client-secret"; process.env.ZOHO_REDIRECT_URI = "http://localhost/api/zoho/callback";
    try {
      for (const host of ["https://accounts.zoho.com", "https://accounts.zoho.in", "https://accounts.zoho.eu/"]) {
        const net = fetchCalls;
        const r = await call(`code=OWNER-CODE&state=${STATE}&accounts-server=${encodeURIComponent(host)}&location=in`, { ...owner, zoho_oauth_state: STATE });
        assert.equal(fetchCalls, net + 1, `${host}: exchange must be attempted exactly once`);
        assert.equal(r.status, 307);
        assert.match(r.headers.get("set-cookie") ?? "", /zoho_oauth_state=;/);
        assert.equal(fs.existsSync(TOKEN_FILE), false, "failed exchange must not write tokens");
      }
    } finally { delete process.env.ZOHO_CLIENT_ID; delete process.env.ZOHO_CLIENT_SECRET; delete process.env.ZOHO_REDIRECT_URI; }
  });
  await test("Z7 READ-only OAuth scopes and the connect route are byte-identical to base 5ca41c9 (no new scopes)", async () => {
    const d = execFileSync("git", ["diff", BASE, "--", "app/lib/zoho-security-guard.ts", "app/api/zoho/connect/route.ts", "app/lib/zoho-token-store.ts"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(d, "");
    const { APPROVED_ZOHO_READ_SCOPES } = await import(lib("zoho-security-guard.ts"));
    assert.ok(APPROVED_ZOHO_READ_SCOPES.length > 0 && APPROVED_ZOHO_READ_SCOPES.every((s: string) => /\.READ$/i.test(s)), APPROVED_ZOHO_READ_SCOPES.join(","));
  });
  await test("Z8 manifest: zoho/callback is Owner-only via the live route guard, no longer PUBLIC; passphrase gate NOT used (Strict cookie absent on Zoho redirect)", async () => {
    const p = (ROUTE_POLICIES as any)["zoho/callback"].GET;
    assert.equal(p.classification, "OWNER_ONLY");
    assert.equal(p.enforcement, "route-guard");
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "app/api/zoho/callback/route.ts"), "utf8"), /requireOwnerSession/);
  });
  oa.destroyOwnerSession(sess.token);

  const orch = await import(pathToFileURL(path.join(ROOT, "app/api/orchestrator/[[...segments]]/route.ts")).href);
  const orchReq = (tokenHeader?: string) => new NextRequest("http://localhost/api/orchestrator/tasks",
    { headers: { cookie: `bansil_auth=${encodeURIComponent(T_OWNER)}`, ...(tokenHeader ? { "x-orchestrator-token": tokenHeader } : {}) } });
  const octx = { params: Promise.resolve({ segments: ["tasks"] }) };
  const ORCH_DATA = path.join(ROOT, "tools/chatgpt-antigravity-orchestrator/data");
  await test("OT1 orchestrator: no hard-coded fallback token remains in source", async () => {
    const src = fs.readFileSync(path.join(ROOT, "app/api/orchestrator/[[...segments]]/route.ts"), "utf8");
    assert.doesNotMatch(src, /ORCHESTRATOR_OWNER_TOKEN\s*\|\|/);
    assert.doesNotMatch(src, /ORCHESTRATOR_OWNER_TOKEN\s*\?\?\s*["'][^"']+["']/);
  });
  await test("OT2 orchestrator fails CLOSED (503) for the Owner when the token is unset, short, or the formerly published value — vault/DB never opened", async () => {
    const saved = process.env.ORCHESTRATOR_OWNER_TOKEN;
    const existedBefore = fs.existsSync(ORCH_DATA);
    try {
      for (const v of [undefined, "", "short-token", "bansil-orchestrator-owner-20260918"]) {
        if (v === undefined) delete process.env.ORCHESTRATOR_OWNER_TOKEN; else process.env.ORCHESTRATOR_OWNER_TOKEN = v;
        const r = await orch.GET(orchReq("bansil-orchestrator-owner-20260918"), octx);
        assert.equal(r.status, 503, String(v));
        assert.match(JSON.stringify(await r.json()), /ORCHESTRATOR_OWNER_TOKEN is not configured/);
      }
      assert.equal(fs.existsSync(ORCH_DATA), existedBefore, "orchestrator data dir must not be created");
    } finally { if (saved === undefined) delete process.env.ORCHESTRATOR_OWNER_TOKEN; else process.env.ORCHESTRATOR_OWNER_TOKEN = saved; }
  });
  await test("OT3 orchestrator: non-Owner still 403 before any token logic (guard unchanged)", async () => {
    const r = await orch.GET(new NextRequest("http://localhost/api/orchestrator/tasks", { headers: { cookie: `bansil_auth=${encodeURIComponent(T_EMP)}` } }), octx);
    assert.equal(r.status, 403);
  });
}

// ------------------------------------------------------------------ summary
console.log(`\n${"─".repeat(56)}\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log(`network attempts during run: ${fetchCalls} (3 expected: Z6's stubbed Owner token exchanges; every other test asserts 0)`);
fs.rmSync(TMP, { recursive: true, force: true });
if (failed) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("ALL PASS");
