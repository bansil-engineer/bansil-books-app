// ============================================================
// OA-U2 — DB-backed user management: isolated test suite
//
// Run: node --experimental-strip-types scripts/oa-u2-auth-db-tests.ts
//
// ISOLATION: every database is a fresh file under os.tmpdir(); all DB
// path env vars are pointed at the temp dir BEFORE any app module loads.
// AUTH_SECRET is a random synthetic value. Synthetic users only.
// No network, no Zoho, no production files.
// ============================================================

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "oa-u2-auth-"));
process.env.BANSIL_RUNTIME_DB_DIR = TMP;
process.env.AUTH_DB_PATH = path.join(TMP, "never-opened-auth.db");
process.env.BANSIL_BOOKS_DB_PATH = path.join(TMP, "unused-books.db");
process.env.AUDIT_WORKSPACE_DB_PATH = path.join(TMP, "unused-audit.db");
process.env.AUTH_SECRET = randomBytes(32).toString("hex");
delete process.env.AUTH_USER_STORE;
const SYNTH_AUTH_USERS_BEFORE = process.env.AUTH_USERS;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = (p: string) => path.join(ROOT, "app/lib", p);

const { migrateAuthDatabase, openAuthDatabaseAt, backupAuthDatabase, migrationChecksum, AUTH_MIGRATIONS } =
  await import(lib("db/auth-database.ts"));
const { AuthRepository, hashInvitationToken } = await import(lib("auth-repository.ts"));
const svc = await import(lib("auth-service.ts"));
const auth = await import(lib("auth.ts"));
const { isAllowed, parsePermissions } = await import(lib("auth-permissions.ts"));
const { CURRENT_PARAMS, verifyPasswordV1, needsRehash } = await import(lib("auth-password.ts"));
const store = await import(lib("auth-store.ts"));
const rl = await import(lib("auth-ratelimit.ts"));
const pw = await import(lib("auth-password.ts"));
const inviteTok = await import(lib("invite-token.ts"));

// ------------------------------------------------------------------ harness
let passed = 0;
let failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  rl.__resetLoginRateLimiterForTests(); // each test starts with fresh rate-limit state
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

// ------------------------------------------------------------------ fixtures
const OWNER_EMAIL = "owner@synthetic.test";
const OWNER_PW = "Synthetic-Owner-Passphrase-1";
let dbCounter = 0;

function legacyAuthUsersJson(extra: object[] = []): string {
  const salt = auth.generateSalt();
  return JSON.stringify([
    { email: OWNER_EMAIL, name: "Synthetic Owner", role: "super_admin", salt, hash: auth.hashPassword(OWNER_PW, salt), modules: ["*"] },
    ...extra,
  ]);
}

function freshDb(): { db: InstanceType<typeof DatabaseSync>; file: string } {
  const file = path.join(TMP, `t${++dbCounter}.db`);
  return { db: openAuthDatabaseAt(file), file };
}

function freshRepo(clock?: () => Date) {
  const { db, file } = freshDb();
  const repo = new AuthRepository(db, clock);
  const r = repo.importFromAuthUsersJson(legacyAuthUsersJson(), { email: "test@local", role: "system", correlationId: "setup-0001" });
  assert.ok(r.ok, "fixture import");
  return { repo, db, file };
}

function ctx(opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  // Default: a same-origin JSON request, as the app's own fetch() calls send.
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  return {
    cookie: (n: string) => (n === "bansil_auth" ? opts.token : undefined),
    header: (n: string) => headers[n.toLowerCase()] ?? null,
    body: opts.body,
  };
}

async function login(repo: unknown, email: string, password: string): Promise<string> {
  const r = await svc.dbLogin(repo, ctx({ body: { email, password } }));
  assert.equal(r.status, 200, `login ${email} expected 200 got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.cookie?.action, "set");
  return r.cookie.value;
}

/** Fails if any credential-ish material appears in an API body. */
function assertNoSecrets(body: unknown, extra: string[] = []) {
  const s = JSON.stringify(body);
  for (const bad of ["scrypt$", "password_hash", "\"salt\"", "\"hash\"", "AUTH_USERS", "token_hash", ...extra]) {
    assert.ok(!s.includes(bad), `response leaked ${bad}`);
  }
}

const tokenFromPath = (p: string) => p.split("#token=")[1];

// ==================================================================
console.log("OA-U2 DB-backed user management — isolated tests");
console.log(`temp dir: ${TMP}`);

section("A. Store selection / env-mode isolation");
await test("A1 default mode is env (AUTH_USER_STORE unset)", async () => {
  assert.equal(store.getUserStoreMode(), "env");
});
await test("A2 env mode never opens auth.db (getAuthRepository throws, file absent)", async () => {
  assert.throws(() => store.getAuthRepository(), /mode is 'env'/);
  assert.equal(fs.existsSync(process.env.AUTH_DB_PATH!), false);
});
await test("A3 store mode is strict: env/db only; any other value is 'invalid' (fail closed)", async () => {
  for (const [v, exp] of [["db", "db"], ["DB", "db"], [" db ", "db"], ["env", "env"], ["", "env"],
    ["database", "invalid"], ["sqlite", "invalid"], ["true", "invalid"], ["1", "invalid"]]) {
    process.env.AUTH_USER_STORE = v;
    assert.equal(store.getUserStoreMode(), exp, `value ${JSON.stringify(v)}`);
  }
  delete process.env.AUTH_USER_STORE;
});
await test("A4 env-store tokens unchanged: no sv/jti claims", async () => {
  const t = auth.createToken({ email: "a@b.c", name: "n", role: "viewer", modules: [] });
  const p = auth.verifyToken(t);
  assert.ok(p && p.sv === undefined && p.jti === undefined);
});

section("1. Owner login preservation (migration of legacy AUTH_USERS)");
await test("1a imported Owner logs in with the SAME password", async () => {
  const { repo } = freshRepo();
  await login(repo, OWNER_EMAIL, OWNER_PW);
});
await test("1b login is case-insensitive on email", async () => {
  const { repo } = freshRepo();
  await login(repo, "OWNER@Synthetic.Test", OWNER_PW);
});
await test("1c legacy hash params upgraded on first login; password still valid", async () => {
  const { repo, db } = freshRepo();
  const before = (db.prepare("SELECT password_hash FROM auth_users WHERE is_owner=1").get() as { password_hash: string }).password_hash;
  assert.ok(needsRehash(before));
  await login(repo, OWNER_EMAIL, OWNER_PW);
  const after = (db.prepare("SELECT password_hash FROM auth_users WHERE is_owner=1").get() as { password_hash: string }).password_hash;
  assert.ok(after.includes(`N=${CURRENT_PARAMS.N},r=${CURRENT_PARAMS.r},p=${CURRENT_PARAMS.p}`));
  assert.ok(!needsRehash(after));
  await login(repo, OWNER_EMAIL, OWNER_PW);
});
await test("1d Owner is the sole super_admin, active, flagged is_owner", async () => {
  const { repo } = freshRepo();
  const o = repo.getUser(OWNER_EMAIL);
  assert.ok(o && o.isOwner && o.role === "super_admin" && o.status === "active");
  assert.ok(repo.hasActiveOwner());
});
await test("1e wrong Owner password rejected (401)", async () => {
  const { repo } = freshRepo();
  const r = await svc.dbLogin(repo, ctx({ body: { email: OWNER_EMAIL, password: "wrong-password-123" } }));
  assert.equal(r.status, 401);
});
await test("1f env-store authenticate() still works with the untouched AUTH_USERS", async () => {
  const json = legacyAuthUsersJson();
  process.env.AUTH_USERS = json;
  try {
    assert.ok(auth.authenticate(OWNER_EMAIL, OWNER_PW));
  } finally {
    if (SYNTH_AUTH_USERS_BEFORE === undefined) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = SYNTH_AUTH_USERS_BEFORE;
  }
});
await test("1g DB store with no active Owner fails CLOSED (503, no env fallback)", async () => {
  const { db } = freshDb();
  const r = await svc.dbLogin(new AuthRepository(db), ctx({ body: { email: OWNER_EMAIL, password: OWNER_PW } }));
  assert.equal(r.status, 503);
});

section("2. User creation");
let shared: { repo: any; db: any; ownerToken: string };
{
  const f = freshRepo();
  shared = { repo: f.repo, db: f.db, ownerToken: await login(f.repo, OWNER_EMAIL, OWNER_PW) };
}
await test("2a Owner creates active user with password (201)", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "alice@synthetic.test", name: "Alice", role: "admin", modules: ["inventory", "reports:view,export"],
    password: "Alice-Synthetic-Pass-01" } }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.status, "active");
  assert.equal(r.body.invitation, null);
  assertNoSecrets(r.body);
  await login(shared.repo, "alice@synthetic.test", "Alice-Synthetic-Pass-01");
});
await test("2b Owner creates invited user (no password) → one-time link", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "bob@synthetic.test", name: "Bob", role: "viewer", modules: ["dashboard:view"] } }));
  assert.equal(r.status, 201);
  assert.equal(r.body.user.status, "invited");
  assert.match(r.body.invitation.path, /^\/invite#token=[A-Za-z0-9_-]{43}$/);
  assertNoSecrets(r.body);
});
await test("2c invited user cannot log in before accepting", async () => {
  const r = await svc.dbLogin(shared.repo, ctx({ body: { email: "bob@synthetic.test", password: "anything-at-all-1" } }));
  assert.equal(r.status, 401);
});
await test("2d weak initial password rejected (min 12)", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "weak@synthetic.test", name: "Weak", role: "viewer", modules: ["dashboard:view"], password: "short1" } }));
  assert.equal(r.status, 400);
});
await test("2e invalid email / missing name rejected", async () => {
  for (const b of [{ email: "nope", name: "X" }, { email: "x@synthetic.test", name: "  " }]) {
    const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: { ...b, role: "viewer", modules: ["dashboard:view"] } }));
    assert.equal(r.status, 400);
  }
});
await test("2f user list contains no credential material", async () => {
  const r = svc.dbUsersGet(shared.repo, ctx({ token: shared.ownerToken }));
  assert.equal(r.status, 200);
  assert.equal(r.body.store, "db");
  assertNoSecrets(r.body);
});

section("3. Duplicate email rejection");
await test("3a exact duplicate → 409", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "alice@synthetic.test", name: "Alice 2", role: "viewer", modules: ["dashboard:view"] } }));
  assert.equal(r.status, 409);
});
await test("3b case/whitespace variant → 409", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "  ALICE@Synthetic.TEST ", name: "Alice 3", role: "viewer", modules: ["dashboard:view"] } }));
  assert.equal(r.status, 409);
});
await test("3c Owner email cannot be re-registered → 409", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: OWNER_EMAIL, name: "Fake", role: "admin", modules: ["*"] } }));
  assert.equal(r.status, 409);
});

section("4. Secure password storage");
await test("4a stored hashes are versioned scrypt with current params, 16-byte salt", async () => {
  const row = shared.db.prepare("SELECT password_hash FROM auth_users WHERE email_normalized='alice@synthetic.test'").get();
  assert.match(row.password_hash, new RegExp(`^scrypt\\$v=1\\$N=${CURRENT_PARAMS.N},r=8,p=${CURRENT_PARAMS.p}\\$[0-9a-f]{32}\\$[0-9a-f]{128}$`));
});
await test("4b plaintext passwords appear nowhere in the DB file", async () => {
  shared.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const files = fs.readdirSync(TMP).filter((f) => f.startsWith("t")).map((f) => fs.readFileSync(path.join(TMP, f)));
  for (const buf of files) {
    for (const pw of ["Alice-Synthetic-Pass-01", OWNER_PW]) assert.equal(buf.includes(Buffer.from(pw)), false);
  }
});
await test("4c same password → different hashes (unique salts)", async () => {
  const r1 = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "carol@synthetic.test", name: "Carol", role: "viewer", modules: ["dashboard:view"], password: "Alice-Synthetic-Pass-01" } }));
  assert.equal(r1.status, 201);
  const rows = shared.db.prepare("SELECT password_hash FROM auth_users WHERE email_normalized IN ('alice@synthetic.test','carol@synthetic.test')").all();
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
});
await test("4d tampered hash parameters are rejected (fail closed)", async () => {
  assert.equal(verifyPasswordV1("x", "scrypt$v=1$N=2,r=1,p=1$" + "0".repeat(32) + "$" + "0".repeat(128)), false);
  assert.equal(verifyPasswordV1("x", "not-a-hash"), false);
  assert.equal(verifyPasswordV1("x", null), false);
});

section("5. Role assignment / privilege escalation");
await test("5a super_admin cannot be assigned on create (403)", async () => {
  const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "evil@synthetic.test", name: "Evil", role: "super_admin", modules: ["*"], password: "Evil-Synthetic-Pass-1" } }));
  assert.equal(r.status, 403);
});
await test("5b super_admin cannot be assigned on update (403)", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { email: "alice@synthetic.test", role: "super_admin" } }));
  assert.equal(r.status, 403);
});
await test("5c DB constraint blocks a second super_admin even via raw SQL", async () => {
  assert.throws(() => shared.db.prepare(
    "INSERT INTO auth_users (email,email_normalized,name,role,status,is_owner,password_hash,created_at,created_by,updated_at) VALUES ('z@z.z','z@z.z','Z','super_admin','active',0,'x','t','t','t')").run());
});
await test("5d Owner role/permissions cannot be changed (403)", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { email: OWNER_EMAIL, role: "viewer" } }));
  assert.equal(r.status, 403);
  const r2 = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { email: OWNER_EMAIL, modules: ["dashboard:view"] } }));
  assert.equal(r2.status, 403);
});
await test("5e Owner cannot be deactivated (API 403 + DB CHECK)", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { action: "deactivate", email: OWNER_EMAIL } }));
  assert.equal(r.status, 403);
  assert.throws(() => shared.db.prepare("UPDATE auth_users SET status='deactivated' WHERE is_owner=1").run());
});
await test("5f users cannot be hard-deleted (API 405 + DB trigger)", async () => {
  const r = svc.dbUsersDelete(shared.repo, ctx({ token: shared.ownerToken }));
  assert.equal(r.status, 405);
  assert.throws(() => shared.db.prepare("DELETE FROM auth_users WHERE email_normalized='carol@synthetic.test'").run(), /cannot be deleted/);
});
await test("5g role change admin→viewer re-validates grants against viewer ceiling", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { email: "alice@synthetic.test", role: "viewer" } }));
  assert.equal(r.status, 400, "inventory (all functions) must not survive demotion to viewer");
  const r2 = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "alice@synthetic.test", role: "viewer", modules: ["inventory:view", "reports:export,view"] } }));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.deepEqual(r2.body.changed.sort(), ["function_permissions", "role"].sort());
});
await test("5h '*' grant only allowed for admin", async () => {
  assert.equal(parsePermissions(["*"], "viewer").ok, false);
  assert.equal(parsePermissions(["*"], "admin").ok, true);
});

section("6. Module restrictions (deny by default)");
await test("6a granted module allowed, ungranted module denied", async () => {
  assert.equal(isAllowed("admin", ["inventory"], "inventory", "edit"), true);
  assert.equal(isAllowed("admin", ["inventory"], "transactions", "view"), false);
  assert.equal(isAllowed("admin", [], "dashboard", "view"), false);
});
await test("6b unknown module / unknown role denied", async () => {
  assert.equal(isAllowed("admin", ["*"], "zoho-books-write", "view"), false);
  assert.equal(isAllowed("hacker", ["*"], "dashboard", "view"), false);
});
await test("6c authorizeAccess uses LIVE DB permissions, not stale JWT claims", async () => {
  const t = await login(shared.repo, "carol@synthetic.test", "Alice-Synthetic-Pass-01");
  assert.equal(svc.authorizeAccess(shared.repo, ctx({ token: t }), "dashboard", "view").ok, true);
  assert.equal(svc.authorizeAccess(shared.repo, ctx({ token: t }), "inventory", "view").ok, false);
});
await test("6d unknown module strings rejected at write time", async () => {
  assert.equal(parsePermissions(["dashboard", "made-up"], "admin").ok, false);
  assert.equal(parsePermissions(["dashboard:view:edit"], "admin").ok, false);
});

section("7. Function restrictions");
await test("7a dashboard:view allows view, denies edit/delete", async () => {
  assert.equal(isAllowed("admin", ["dashboard:view"], "dashboard", "view"), true);
  assert.equal(isAllowed("admin", ["dashboard:view"], "dashboard", "edit"), false);
  assert.equal(isAllowed("admin", ["dashboard:view"], "dashboard", "delete"), false);
});
await test("7b viewer ceiling enforced at evaluation even if grants were tampered", async () => {
  assert.equal(isAllowed("viewer", ["dashboard"], "dashboard", "edit"), false);
  assert.equal(isAllowed("viewer", ["dashboard"], "dashboard", "export"), true);
});
await test("7c viewer cannot be granted add/edit/delete", async () => {
  const r = parsePermissions(["dashboard:view,edit"], "viewer");
  assert.equal(r.ok, false);
});

section("8. Unauthorized API access denied");
await test("8a no cookie → 401 on every management endpoint", async () => {
  for (const h of [svc.dbUsersGet, svc.dbUsersPost, svc.dbUsersPatch, svc.dbUsersDelete, svc.dbInvitationsPost, svc.dbInvitationsDelete]) {
    assert.equal((await h(shared.repo, ctx({}))).status, 401);
  }
  assert.equal(svc.dbAuditGet(shared.repo, ctx({}), 10).status, 401);
});
await test("8b forged token (wrong secret) → 401", async () => {
  const real = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  const forged = auth.createToken({ email: OWNER_EMAIL, name: "x", role: "super_admin", modules: ["*"] }, 8, { sv: 1, jti: "forged-jti" });
  process.env.AUTH_SECRET = real;
  assert.equal(svc.dbUsersGet(shared.repo, ctx({ token: forged })).status, 401);
});
await test("8c expired token → 401", async () => {
  const sv = shared.repo.getUserRecord(OWNER_EMAIL).sessionVersion;
  const t = auth.createToken({ email: OWNER_EMAIL, name: "x", role: "super_admin", modules: ["*"] }, -1, { sv, jti: "expired-jti" });
  assert.equal(svc.dbUsersGet(shared.repo, ctx({ token: t })).status, 401);
});
await test("8d env-store token (no sv/jti) rejected by DB store → 401", async () => {
  const t = auth.createToken({ email: OWNER_EMAIL, name: "x", role: "super_admin", modules: ["*"] });
  assert.equal(svc.dbUsersGet(shared.repo, ctx({ token: t })).status, 401);
});
await test("8e non-Owner admin → 403 on management, denial audited", async () => {
  const t = await login(shared.repo, "carol@synthetic.test", "Alice-Synthetic-Pass-01");
  assert.equal(svc.dbUsersGet(shared.repo, ctx({ token: t })).status, 403);
  assert.equal((await svc.dbUsersPost(shared.repo, ctx({ token: t, body: { email: "x@synthetic.test", name: "X", role: "admin", modules: ["*"] } }))).status, 403);
  assert.equal(svc.dbInvitationsPost(shared.repo, ctx({ token: t, body: { email: "bob@synthetic.test" } })).status, 403);
  const denied = shared.repo.listAudit(20).filter((a: any) => a.result === "denied" && a.actor_email === "carol@synthetic.test");
  assert.ok(denied.length >= 3);
});
await test("8f JWT claiming super_admin for a non-owner (validly signed) still → 403", async () => {
  const rec = shared.repo.getUserRecord("carol@synthetic.test");
  const t = auth.createToken({ email: rec.email, name: rec.name, role: "super_admin", modules: ["*"] }, 8, { sv: rec.sessionVersion, jti: "claim-jti" });
  assert.equal(svc.dbUsersGet(shared.repo, ctx({ token: t })).status, 403, "role is read live from DB");
});

section("9. User deactivation");
let daveToken = "";
await test("9a deactivate → existing session rejected immediately", async () => {
  await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "dave@synthetic.test", name: "Dave", role: "viewer", modules: ["dashboard:view"], password: "Dave-Synthetic-Pass-01" } }));
  daveToken = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  assert.equal(svc.dbMe(shared.repo, ctx({ token: daveToken })).status, 200);
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { action: "deactivate", email: "dave@synthetic.test" } }));
  assert.equal(r.status, 200);
  const me = svc.dbMe(shared.repo, ctx({ token: daveToken }));
  assert.equal(me.status, 401);
  assert.equal(me.cookie?.action, "clear");
});
await test("9b deactivated user cannot log in", async () => {
  const r = await svc.dbLogin(shared.repo, ctx({ body: { email: "dave@synthetic.test", password: "Dave-Synthetic-Pass-01" } }));
  assert.equal(r.status, 401);
});
await test("9c reactivate → can log in again; old token stays dead", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { action: "activate", email: "dave@synthetic.test" } }));
  assert.equal(r.status, 200);
  await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  assert.equal(svc.dbMe(shared.repo, ctx({ token: daveToken })).status, 401);
});
await test("9d Owner cannot deactivate self", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { action: "deactivate", email: OWNER_EMAIL } }));
  assert.equal(r.status, 403);
});

section("10. Session revocation");
await test("10a rights change (modules) revokes existing sessions", async () => {
  const t = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { email: "dave@synthetic.test", modules: ["dashboard:view", "reports:view"] } }));
  assert.equal(svc.dbMe(shared.repo, ctx({ token: t })).status, 401);
});
await test("10b name-only change does NOT revoke sessions", async () => {
  const t = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { email: "dave@synthetic.test", name: "Dave R." } }));
  assert.deepEqual(r.body.changed, ["identity"]);
  assert.equal(svc.dbMe(shared.repo, ctx({ token: t })).status, 200);
});
await test("10c logout revokes that token server-side (jti)", async () => {
  const t = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  const out = svc.dbLogout(shared.repo, ctx({ token: t }));
  assert.equal(out.cookie?.action, "clear");
  assert.equal(svc.dbMe(shared.repo, ctx({ token: t })).status, 401, "replayed token must fail");
});
await test("10d password change revokes other sessions; returned session works", async () => {
  const t1 = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  const t2 = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-01");
  const r = await svc.dbChangePassword(shared.repo, ctx({ token: t1, body: { currentPassword: "Dave-Synthetic-Pass-01", newPassword: "Dave-Synthetic-Pass-02" } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assertNoSecrets(r.body);
  assert.equal(svc.dbMe(shared.repo, ctx({ token: t2 })).status, 401);
  assert.equal(svc.dbMe(shared.repo, ctx({ token: t1 })).status, 401);
  assert.equal(svc.dbMe(shared.repo, ctx({ token: r.cookie.value })).status, 200);
  await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-02");
});
await test("10e password change with wrong current password → 403", async () => {
  const t = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-02");
  const r = await svc.dbChangePassword(shared.repo, ctx({ token: t, body: { currentPassword: "wrong-wrong-wrong", newPassword: "Another-Synthetic-9" } }));
  assert.equal(r.status, 403);
});
await test("10f DB session TTL is 8h", async () => {
  const t = await login(shared.repo, "dave@synthetic.test", "Dave-Synthetic-Pass-02");
  const p = auth.verifyToken(t);
  assert.equal(p.exp - p.iat, 8 * 3600);
});

section("11. Invitation / password-reset lifecycle");
await test("11a invite → accept → login; token single-use", async () => {
  const c = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "erin@synthetic.test", name: "Erin", role: "viewer", modules: ["dashboard:view"] } }));
  const tok = tokenFromPath(c.body.invitation.path);
  const a = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tok, password: "Erin-Synthetic-Pass-01" } }));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(shared.repo.getUser("erin@synthetic.test").status, "active");
  await login(shared.repo, "erin@synthetic.test", "Erin-Synthetic-Pass-01");
  const again = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tok, password: "Erin-Synthetic-Pass-02" } }));
  assert.equal(again.status, 400);
});
await test("11b raw tokens are never stored — only SHA-256 hashes", async () => {
  const c = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "frank@synthetic.test", name: "Frank", role: "viewer", modules: ["dashboard:view"] } }));
  const tok = tokenFromPath(c.body.invitation.path);
  const rows = shared.db.prepare("SELECT token_hash FROM auth_invitations").all().map((r: any) => r.token_hash);
  assert.ok(rows.includes(hashInvitationToken(tok)));
  assert.ok(!rows.includes(tok));
  shared.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  for (const f of fs.readdirSync(TMP).filter((x) => x.startsWith("t"))) {
    assert.equal(fs.readFileSync(path.join(TMP, f)).includes(Buffer.from(tok)), false);
  }
});
await test("11c resend revokes previous link", async () => {
  const r1 = svc.dbInvitationsPost(shared.repo, ctx({ token: shared.ownerToken, body: { email: "frank@synthetic.test", purpose: "invite" } }));
  assert.equal(r1.status, 201);
  assert.equal(r1.body.resent, true);
  const r2 = svc.dbInvitationsPost(shared.repo, ctx({ token: shared.ownerToken, body: { email: "frank@synthetic.test", purpose: "invite" } }));
  const old = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tokenFromPath(r1.body.invitation.path), password: "Frank-Synthetic-Pass-1" } }));
  assert.equal(old.status, 400);
  const cur = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tokenFromPath(r2.body.invitation.path), password: "Frank-Synthetic-Pass-1" } }));
  assert.equal(cur.status, 200);
});
await test("11d cancellation invalidates outstanding link", async () => {
  const c = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "gina@synthetic.test", name: "Gina", role: "viewer", modules: ["dashboard:view"] } }));
  const x = svc.dbInvitationsDelete(shared.repo, ctx({ token: shared.ownerToken, body: { email: "gina@synthetic.test" } }));
  assert.equal(x.body.cancelled, 1);
  const a = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tokenFromPath(c.body.invitation.path), password: "Gina-Synthetic-Pass-1" } }));
  assert.equal(a.status, 400);
});
await test("11e expired link rejected (injected clock, 72h TTL)", async () => {
  let now = new Date("2026-01-01T00:00:00Z");
  const { repo } = freshRepo(() => now);
  const owner = await login(repo, OWNER_EMAIL, OWNER_PW);
  const c = await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "hank@synthetic.test", name: "Hank", role: "viewer", modules: ["dashboard:view"] } }));
  now = new Date("2026-01-04T00:00:01Z");
  const a = await svc.dbInvitationAccept(repo, ctx({ body: { token: tokenFromPath(c.body.invitation.path), password: "Hank-Synthetic-Pass-1" } }));
  assert.equal(a.status, 400);
  assert.equal(repo.getUser("hank@synthetic.test").status, "invited");
});
await test("11f password reset for active user: old password stops working, sessions revoked", async () => {
  const t = await login(shared.repo, "erin@synthetic.test", "Erin-Synthetic-Pass-01");
  const r = svc.dbInvitationsPost(shared.repo, ctx({ token: shared.ownerToken, body: { email: "erin@synthetic.test", purpose: "reset" } }));
  assert.equal(r.status, 201);
  const a = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tokenFromPath(r.body.invitation.path), password: "Erin-Synthetic-Pass-NEW" } }));
  assert.equal(a.status, 200);
  assert.equal(svc.dbMe(shared.repo, ctx({ token: t })).status, 401);
  const old = await svc.dbLogin(shared.repo, ctx({ body: { email: "erin@synthetic.test", password: "Erin-Synthetic-Pass-01" } }));
  assert.equal(old.status, 401);
  await login(shared.repo, "erin@synthetic.test", "Erin-Synthetic-Pass-NEW");
});
await test("11g Owner credentials cannot be reset via user management", async () => {
  const r = svc.dbInvitationsPost(shared.repo, ctx({ token: shared.ownerToken, body: { email: OWNER_EMAIL, purpose: "reset" } }));
  assert.equal(r.status, 403);
});
await test("11h deactivation revokes outstanding invitation", async () => {
  const c = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "ivy@synthetic.test", name: "Ivy", role: "viewer", modules: ["dashboard:view"] } }));
  svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { action: "deactivate", email: "ivy@synthetic.test" } }));
  const a = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tokenFromPath(c.body.invitation.path), password: "Ivy-Synthetic-Pass-01" } }));
  assert.equal(a.status, 400);
});
await test("11i garbage / missing tokens rejected", async () => {
  for (const token of [undefined, "", "short", "x".repeat(500), randomBytes(32).toString("base64url")]) {
    const a = await svc.dbInvitationAccept(shared.repo, ctx({ body: { token, password: "Whatever-Synthetic-1" } }));
    assert.equal(a.status, 400);
  }
});
await test("11j weak password on accept rejected and token NOT consumed", async () => {
  const c = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "jack@synthetic.test", name: "Jack", role: "viewer", modules: ["dashboard:view"] } }));
  const tok = tokenFromPath(c.body.invitation.path);
  assert.equal((await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tok, password: "short" } }))).status, 400);
  assert.equal((await svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tok, password: "Jack-Synthetic-Pass-1" } }))).status, 200);
});

section("12. Audit logging");
await test("12a every management action recorded with actor, target, categories, result", async () => {
  const actions = new Set(shared.repo.listAudit(1000).map((a: any) => a.action));
  for (const a of ["store.migrate_user", "auth.login", "auth.logout", "user.create", "user.update", "user.activate",
    "user.deactivate", "invitation.issue", "invitation.resend", "invitation.cancel", "invitation.accept",
    "password.change", "password.reset"]) {
    assert.ok(actions.has(a), `missing audit action ${a}`);
  }
  const upd = shared.repo.listAudit(1000).find((a: any) => a.action === "user.update" && a.result === "success"
    && a.changed_categories.includes("role"));
  assert.ok(upd && upd.actor_email === OWNER_EMAIL && upd.target_email === "alice@synthetic.test");
});
await test("12b correlation ID is server-generated; client request id stored separately", async () => {
  const clientId = "test-corr-ABC12345";
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, headers: { "x-correlation-id": clientId },
    body: { email: "dave@synthetic.test", name: "Dave Corr" } }));
  assert.match(r.correlationId, /^[0-9a-f-]{36}$/);
  assert.notEqual(r.correlationId, clientId);
  const row = shared.repo.listAudit(5).find((a: any) => a.correlation_id === r.correlationId);
  assert.ok(row, "audit row carries the server correlation id");
  assert.equal(row.client_request_id, clientId);
});
await test("12c malformed client id is discarded (stored as null)", async () => {
  const r = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, headers: { "x-correlation-id": "<script>" },
    body: { email: "dave@synthetic.test", name: "Dave Corr 2" } }));
  const row = shared.repo.listAudit(5).find((a: any) => a.correlation_id === r.correlationId);
  assert.equal(row.client_request_id, null);
});
await test("12d audit log contains no passwords, hashes or raw tokens", async () => {
  const dump = JSON.stringify(shared.db.prepare("SELECT * FROM auth_audit_log").all());
  for (const bad of ["scrypt$", OWNER_PW, "Alice-Synthetic-Pass-01", "Dave-Synthetic-Pass-02", "Erin-Synthetic-Pass-NEW"]) {
    assert.ok(!dump.includes(bad), `audit leaked ${bad.slice(0, 6)}…`);
  }
  for (const r of shared.db.prepare("SELECT token_hash FROM auth_invitations").all() as any[]) {
    assert.ok(!dump.includes(r.token_hash));
  }
});
await test("12e audit log is append-only (UPDATE/DELETE blocked)", async () => {
  assert.throws(() => shared.db.prepare("UPDATE auth_audit_log SET result='success'").run(), /append-only/);
  assert.throws(() => shared.db.prepare("DELETE FROM auth_audit_log").run(), /append-only/);
});
await test("12f mutation and audit row are atomic (failed audit write rolls back the change)", async () => {
  const { repo, db } = freshRepo();
  db.exec("CREATE TRIGGER t_fail BEFORE INSERT ON auth_audit_log WHEN NEW.action='user.create' BEGIN SELECT RAISE(ABORT,'audit down'); END;");
  await assert.rejects(repo.createUser({ email: OWNER_EMAIL, role: "super_admin", correlationId: "atomic-0001" },
    { email: "kim@synthetic.test", name: "Kim", role: "viewer", modules: ["dashboard:view"], password: "Kim-Synthetic-Pass-01" }));
  assert.equal(repo.getUser("kim@synthetic.test"), null);
});
await test("12g audit read is Owner-only and returns entries", async () => {
  const r = svc.dbAuditGet(shared.repo, ctx({ token: shared.ownerToken }), 50);
  assert.equal(r.status, 200);
  assert.ok(r.body.entries.length > 0);
});

section("13. Migrations, import and rollback");
await test("13a migrations are versioned + checksummed; re-open is idempotent", async () => {
  const { db, file } = freshDb();
  db.close();
  const db2 = openAuthDatabaseAt(file);
  const rows = db2.prepare("SELECT version, checksum FROM auth_schema_migrations").all() as any[];
  assert.equal(rows.length, AUTH_MIGRATIONS.length);
  assert.equal(rows[0].checksum, migrationChecksum(AUTH_MIGRATIONS[0]));
  db2.close();
});
await test("13b failing migration rolls back atomically (no partial schema)", async () => {
  const { db } = freshDb();
  const bad = [...AUTH_MIGRATIONS, { version: 2, name: "broken", sql: "CREATE TABLE half_done (x INT); INSERT INTO no_such_table VALUES (1);" }];
  assert.throws(() => migrateAuthDatabase(db, bad), /rolled back/);
  assert.equal(db.prepare("SELECT MAX(version) v FROM auth_schema_migrations").get().v, 1);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='half_done'").get(), undefined);
});
await test("13c checksum drift refuses to open (fail closed)", async () => {
  const { db, file } = freshDb();
  db.prepare("UPDATE auth_schema_migrations SET checksum='tampered' WHERE version=1").run();
  db.close();
  assert.throws(() => openAuthDatabaseAt(file), /checksum mismatch/);
});
await test("13d DB newer than code refuses to open (downgrade protection)", async () => {
  const { db, file } = freshDb();
  db.prepare("INSERT INTO auth_schema_migrations VALUES (99,'future','x','t')").run();
  db.close();
  assert.throws(() => openAuthDatabaseAt(file), /newer than this application/);
});
await test("13e import fails closed on any invalid record (nothing imported)", async () => {
  const { db } = freshDb();
  const repo = new AuthRepository(db);
  const bad = legacyAuthUsersJson([{ email: "x@synthetic.test", name: "X", role: "viewer", salt: "zz", hash: "zz", modules: [] }]);
  const r = repo.importFromAuthUsersJson(bad, { email: "m@l", role: "system", correlationId: "imp-0000001" });
  assert.equal(r.ok, false);
  assert.equal(repo.countUsers(), 0);
});
await test("13f import rejects zero or multiple super_admins; refuses non-empty DB", async () => {
  const { db } = freshDb();
  const repo = new AuthRepository(db);
  const s = auth.generateSalt();
  const two = legacyAuthUsersJson([{ email: "o2@synthetic.test", name: "O2", role: "super_admin", salt: s, hash: auth.hashPassword("x", s), modules: ["*"] }]);
  assert.equal(repo.importFromAuthUsersJson(two, { email: "m@l", role: "s", correlationId: "imp-0000002" }).ok, false);
  assert.equal(repo.importFromAuthUsersJson("[]", { email: "m@l", role: "s", correlationId: "imp-0000003" }).ok, false);
  assert.equal(repo.importFromAuthUsersJson(legacyAuthUsersJson(), { email: "m@l", role: "s", correlationId: "imp-0000004" }).ok, true);
  assert.equal(repo.importFromAuthUsersJson(legacyAuthUsersJson(), { email: "m@l", role: "s", correlationId: "imp-0000005" }).ok, false);
});
await test("13g backup (VACUUM INTO) + restore returns DB to pre-change state", async () => {
  const { repo, db } = freshRepo();
  const bak = path.join(TMP, "restore-test.bak.db");
  backupAuthDatabase(db, bak);
  const owner = await login(repo, OWNER_EMAIL, OWNER_PW);
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "late@synthetic.test", name: "Late", role: "viewer", modules: ["dashboard:view"], password: "Late-Synthetic-Pass-1" } }));
  assert.ok(repo.getUser("late@synthetic.test"));
  const restored = new AuthRepository(openAuthDatabaseAt(bak));
  assert.equal(restored.getUser("late@synthetic.test"), null);
  assert.ok(restored.hasActiveOwner());
  assert.throws(() => backupAuthDatabase(db, bak), /already exists/);
});
await test("13h cutover rollback: switching back to env leaves AUTH_USERS authoritative", async () => {
  process.env.AUTH_USER_STORE = "db";
  assert.equal(store.getUserStoreMode(), "db");
  process.env.AUTH_USER_STORE = "env";
  assert.equal(store.getUserStoreMode(), "env");
  const json = legacyAuthUsersJson();
  process.env.AUTH_USERS = json;
  try {
    assert.ok(auth.authenticate(OWNER_EMAIL, OWNER_PW), "env store works after rollback");
    assert.equal(process.env.AUTH_USERS, json, "AUTH_USERS untouched");
  } finally {
    delete process.env.AUTH_USER_STORE;
    if (SYNTH_AUTH_USERS_BEFORE === undefined) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = SYNTH_AUTH_USERS_BEFORE;
  }
});
await test("13i migration CLI: plan/apply/verify on temp files, output contains no secrets", async () => {
  const src = path.join(TMP, "synthetic-auth-users.json");
  fs.writeFileSync(src, legacyAuthUsersJson(), { mode: 0o600 });
  const target = path.join(TMP, "cli-auth.db");
  const run = (args: string[]) =>
    execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(ROOT, "scripts/auth-store-migrate.ts"), ...args],
      { encoding: "utf8", env: { ...process.env, AUTH_USERS: "" } });
  const plan = run(["plan", "--from-file", src]);
  assert.match(plan, /PLAN OK: 1 user/);
  assert.equal(fs.existsSync(target), false, "plan writes nothing");
  const apply = run(["apply", "--db", target, "--from-file", src]);
  assert.match(apply, /APPLY OK/);
  const verify = run(["verify", "--db", target]);
  assert.match(verify, /integrity_check=ok foreign_key_violations=0 schema_version=1/);
  assert.match(verify, /active owner: owner@synthetic\.test/);
  for (const out of [plan, apply, verify]) {
    assert.ok(!/scrypt\$|[0-9a-f]{64}/.test(out), "CLI output must not contain hashes/salts");
  }
  let threw = false;
  try { run(["apply", "--db", target, "--from-file", src]); } catch { threw = true; }
  assert.ok(threw, "second apply refused (DB not empty)");
  assert.ok(fs.readdirSync(TMP).some((f) => f.startsWith("cli-auth.db.pre-import-")), "pre-import backup taken");
});

section("14. No Zoho write operations / no secret leakage in new code");
await test("14a OA-U2 files contain no Zoho, fetch or outbound-network calls", async () => {
  const files = ["app/lib/auth-password.ts", "app/lib/auth-permissions.ts", "app/lib/auth-repository.ts",
    "app/lib/auth-service.ts", "app/lib/auth-store.ts", "app/lib/auth-guard.ts", "app/lib/db/auth-database.ts",
    "scripts/auth-store-migrate.ts", "app/api/auth/invitations/route.ts", "app/api/auth/invitations/accept/route.ts",
    "app/api/auth/audit-log/route.ts", "app/lib/auth-ratelimit.ts", "app/lib/invite-token.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/zoho/i.test(src.replace(/\/\/.*$/gm, "")), `${f} references zoho`);
    assert.ok(!/\bfetch\(|https?\.request|node:https|node:http\b/.test(src), `${f} makes network calls`);
  }
});
await test("14b server-side code never console.logs bodies, tokens or passwords", async () => {
  for (const f of ["app/lib/auth-repository.ts", "app/lib/auth-service.ts", "app/lib/auth-guard.ts", "app/lib/auth-password.ts"]) {
    // Whole statement up to the terminating ");" — not just the first ")".
    const logs = fs.readFileSync(path.join(ROOT, f), "utf8").match(/console\.(log|info|warn|error)\([\s\S]*?\);/g) ?? [];
    for (const l of logs) {
      const args = l.replace(/"[^"]*"/g, '""'); // ignore fixed message text, inspect the arguments
      assert.ok(!/body|token|password|hash|ctx|req\b|request/i.test(args), `${f}: ${l}`);
    }
  }
});
await test("14c test run created no file outside the temp dir (no auth.db at default path)", async () => {
  assert.equal(fs.existsSync(path.join(ROOT, "data", "auth.db")), false);
  assert.equal(fs.existsSync(process.env.AUTH_DB_PATH!), false);
});

section("15. Independent-review hardening");
const { capToViewerCeiling } = await import(lib("auth-permissions.ts"));
const { KDF_MAX_QUEUE } = await import(lib("auth-password.ts"));
await test("15a CSRF: cross-site Sec-Fetch-Site rejected on state-changing endpoints (403)", async () => {
  const xs = { "sec-fetch-site": "cross-site" };
  assert.equal((await svc.dbLogin(shared.repo, ctx({ headers: xs, body: { email: OWNER_EMAIL, password: OWNER_PW } }))).status, 403);
  assert.equal((await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, headers: xs, body: {
    email: "csrf@synthetic.test", name: "C", role: "admin", modules: ["*"], password: "Csrf-Synthetic-Pass-1" } }))).status, 403);
  assert.equal(svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, headers: xs, body: { action: "deactivate", email: "dave@synthetic.test" } })).status, 403);
  assert.equal(svc.dbInvitationsPost(shared.repo, ctx({ token: shared.ownerToken, headers: { "sec-fetch-site": "same-site" }, body: { email: "frank@synthetic.test", purpose: "reset" } })).status, 403);
  assert.equal(shared.repo.getUser("csrf@synthetic.test"), null);
  assert.equal(shared.repo.getUser("dave@synthetic.test").status, "active");
});
await test("15b CSRF: Origin/Host mismatch and Origin 'null' rejected when Sec-Fetch-Site absent", async () => {
  const bad = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken,
    headers: { origin: "https://evil.example", host: "books.example" }, body: { email: "dave@synthetic.test", name: "X" } }));
  assert.equal(bad.status, 403);
  const nul = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, headers: { origin: "null" }, body: { email: "dave@synthetic.test", name: "X" } }));
  assert.equal(nul.status, 403);
  const ok = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken,
    headers: { origin: "https://books.example", host: "books.example" }, body: { email: "dave@synthetic.test", name: "Dave OK" } }));
  assert.equal(ok.status, 200);
  const sameOrigin = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken,
    headers: { "sec-fetch-site": "same-origin", origin: "https://other-proxy-host" }, body: { email: "dave@synthetic.test", name: "Dave SO" } }));
  assert.equal(sameOrigin.status, 200, "Sec-Fetch-Site same-origin is trusted over proxy Host header");
});
await test("15c CSRF: non-JSON content types rejected (415) — HTML forms cannot reach handlers", async () => {
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const r = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, headers: { "content-type": ct }, body: {
      email: "form@synthetic.test", name: "F", role: "admin", modules: ["*"], password: "Form-Synthetic-Pass-1" } }));
    assert.equal(r.status, 415, ct);
  }
  assert.equal((await svc.dbInvitationAccept(shared.repo, ctx({ headers: { "content-type": "text/plain" }, body: { token: "x".repeat(43), password: "P".repeat(13) } }))).status, 415);
});
await test("15d login flood: excess requests get 429 and the event loop stays responsive", async () => {
  let maxGap = 0;
  let last = Date.now();
  const timer = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
  const N = KDF_MAX_QUEUE + 6;
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    svc.dbLogin(shared.repo, ctx({ body: { email: `nobody${i}@synthetic.test`, password: "Flood-Synthetic-Pass-1" } }))));
  clearInterval(timer);
  const codes = results.map((r: any) => r.status);
  assert.ok(codes.filter((c: number) => c === 429).length >= 1, `expected some 429s, got ${codes.join(",")}`);
  assert.ok(codes.every((c: number) => c === 429 || c === 401), codes.join(","));
  assert.ok(maxGap < 150, `event loop blocked for ${maxGap} ms`);
});
await test("15e concurrent accepts of the same link: exactly one succeeds", async () => {
  const c = await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "race@synthetic.test", name: "Race", role: "viewer", modules: ["dashboard:view"] } }));
  const tok = tokenFromPath(c.body.invitation.path);
  const rs = await Promise.all([1, 2, 3].map((i) =>
    svc.dbInvitationAccept(shared.repo, ctx({ body: { token: tok, password: `Race-Synthetic-Pass-${i}x` } }))));
  assert.equal(rs.filter((r: any) => r.status === 200).length, 1, rs.map((r: any) => r.status).join(","));
});
await test("15f deactivation during an in-flight login → login denied (conditional write)", async () => {
  await svc.dbUsersPost(shared.repo, ctx({ token: shared.ownerToken, body: {
    email: "inflight@synthetic.test", name: "In Flight", role: "viewer", modules: ["dashboard:view"], password: "Inflight-Synthetic-1" } }));
  const pending = svc.dbLogin(shared.repo, ctx({ body: { email: "inflight@synthetic.test", password: "Inflight-Synthetic-1" } }));
  // Hashing runs off-thread; deactivate before it completes.
  const d = svc.dbUsersPatch(shared.repo, ctx({ token: shared.ownerToken, body: { action: "deactivate", email: "inflight@synthetic.test" } }));
  assert.equal(d.status, 200);
  assert.equal((await pending).status, 401);
});
await test("15g invalid AUTH_USER_STORE: repository refuses to open (routes 503)", async () => {
  process.env.AUTH_USER_STORE = "database";
  try {
    assert.equal(store.getUserStoreMode(), "invalid");
    assert.throws(() => store.getAuthRepository(), /invalid/);
  } finally {
    delete process.env.AUTH_USER_STORE;
  }
});
await test("15h import narrows legacy viewer grants to view/export (never widens) and reports it", async () => {
  assert.deepEqual(capToViewerCeiling(["dashboard", "reports:view,edit", "inventory:delete"]),
    { modules: ["dashboard:view,export", "reports:view"], capped: true });
  assert.deepEqual(capToViewerCeiling(["dashboard:view"]), { modules: ["dashboard:view"], capped: false });
  const { db } = freshDb();
  const s = auth.generateSalt();
  const r = new AuthRepository(db).importFromAuthUsersJson(legacyAuthUsersJson([
    { email: "legacyviewer@synthetic.test", name: "LV", role: "viewer", salt: s, hash: auth.hashPassword("x", s), modules: ["dashboard"] }]),
    { email: "m@l", role: "s", correlationId: "imp-cap-001" });
  assert.ok(r.ok);
  assert.equal(r.summary.find((x: any) => x.email === "legacyviewer@synthetic.test").cappedToViewerCeiling, true);
});
await test("15i failed check against a legacy hash is padded to current cost (no migration-timing oracle)", async () => {
  const { repo } = freshRepo();
  const t0 = Date.now();
  await repo.authenticate(OWNER_EMAIL, "wrong-password-xyz", "timing-0001");   // legacy hash, wrong pw
  const legacyFail = Date.now() - t0;
  const t1 = Date.now();
  await repo.authenticate("missing@synthetic.test", "wrong-password-xyz", "timing-0002"); // dummy path
  const unknown = Date.now() - t1;
  assert.ok(legacyFail >= unknown * 0.8, `legacy fail ${legacyFail}ms vs unknown ${unknown}ms`);
});

// ==================================================================
section("16. OA-U2-F — account recovery (QC F2)");
async function ownerFixture() {
  const f = freshRepo();
  return { ...f, owner: await login(f.repo, OWNER_EMAIL, OWNER_PW) };
}
const auditOf = (repo: any, email: string) =>
  repo.listAudit(1000).filter((a: any) => a.target_email === email).reverse();

await test("16a invited → deactivated → reactivated returns to 'invited' (not active, no sign-in)", async () => {
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "rec@synthetic.test", name: "Rec", role: "viewer", modules: ["dashboard:view"] } }));
  assert.equal(svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "rec@synthetic.test" } })).status, 200);
  const r = svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "rec@synthetic.test" } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.status, "invited");
  assert.equal(r.body.user.pendingInvitation, null, "no live link after reactivation");
  const l = await svc.dbLogin(repo, ctx({ body: { email: "rec@synthetic.test", password: "Anything-Synthetic-1" } }));
  assert.equal(l.status, 401);
});
await test("16b full recovery lifecycle: old link dead, new link single-use + works, login OK", async () => {
  const { repo, owner } = await ownerFixture();
  const c = await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "life@synthetic.test", name: "Life", role: "viewer", modules: ["dashboard:view"] } }));
  const oldTok = tokenFromPath(c.body.invitation.path);
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "life@synthetic.test" } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "life@synthetic.test" } }));
  assert.equal((await svc.dbInvitationAccept(repo, ctx({ body: { token: oldTok, password: "Life-Synthetic-Pass-1" } }))).status, 400,
    "link issued before deactivation must never work again");
  const n = svc.dbInvitationsPost(repo, ctx({ token: owner, body: { email: "life@synthetic.test", purpose: "invite" } }));
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const newTok = tokenFromPath(n.body.invitation.path);
  assert.equal((await svc.dbInvitationAccept(repo, ctx({ body: { token: newTok, password: "Life-Synthetic-Pass-1" } }))).status, 200);
  assert.equal((await svc.dbInvitationAccept(repo, ctx({ body: { token: newTok, password: "Life-Synthetic-Pass-2" } }))).status, 400, "replay rejected");
  await login(repo, "life@synthetic.test", "Life-Synthetic-Pass-1");
  assert.equal(repo.getUser("life@synthetic.test").status, "active");
});
await test("16c new recovery link expires (72h) and a second issue invalidates the first", async () => {
  let now = new Date("2026-03-01T00:00:00Z");
  const f = freshRepo(() => now);
  const owner = await login(f.repo, OWNER_EMAIL, OWNER_PW);
  await svc.dbUsersPost(f.repo, ctx({ token: owner, body: { email: "exp@synthetic.test", name: "Exp", role: "viewer", modules: ["dashboard:view"] } }));
  svc.dbUsersPatch(f.repo, ctx({ token: owner, body: { action: "deactivate", email: "exp@synthetic.test" } }));
  svc.dbUsersPatch(f.repo, ctx({ token: owner, body: { action: "activate", email: "exp@synthetic.test" } }));
  const a = tokenFromPath(svc.dbInvitationsPost(f.repo, ctx({ token: owner, body: { email: "exp@synthetic.test", purpose: "invite" } })).body.invitation.path);
  const b = tokenFromPath(svc.dbInvitationsPost(f.repo, ctx({ token: owner, body: { email: "exp@synthetic.test", purpose: "invite" } })).body.invitation.path);
  assert.equal((await svc.dbInvitationAccept(f.repo, ctx({ body: { token: a, password: "Exp-Synthetic-Pass-1" } }))).status, 400);
  now = new Date("2026-03-04T00:00:01Z");
  assert.equal((await svc.dbInvitationAccept(f.repo, ctx({ body: { token: b, password: "Exp-Synthetic-Pass-1" } }))).status, 400, "expired");
});
await test("16d deactivated user: invite/reset refused with clear message and audited as denied", async () => {
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "deny@synthetic.test", name: "D", role: "viewer", modules: ["dashboard:view"] } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "deny@synthetic.test" } }));
  for (const purpose of ["invite", "reset"]) {
    const r = svc.dbInvitationsPost(repo, ctx({ token: owner, body: { email: "deny@synthetic.test", purpose } }));
    assert.equal(r.status, 409);
    assert.match(r.body.error, /reactivate the user first/);
  }
  assert.ok(auditOf(repo, "deny@synthetic.test").some((a: any) => a.result === "denied" && a.detail === "account deactivated"));
});
await test("16e duplicate creation still blocked during/after recovery; no second account", async () => {
  const { repo, owner, db } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "dup@synthetic.test", name: "Dup", role: "viewer", modules: ["dashboard:view"] } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "dup@synthetic.test" } }));
  assert.equal((await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "DUP@synthetic.test", name: "Dup2", role: "admin", modules: ["*"] } }))).status, 409);
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "dup@synthetic.test" } }));
  assert.equal((await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "dup@synthetic.test", name: "Dup3", role: "admin", modules: ["*"] } }))).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM auth_users WHERE email_normalized='dup@synthetic.test'").get().n, 1);
  assert.equal(repo.getUser("dup@synthetic.test").role, "viewer", "recovery never changes role (no escalation)");
});
await test("16f previously active user: deactivate → reactivate restores 'active' with same password", async () => {
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "act@synthetic.test", name: "A", role: "viewer", modules: ["dashboard:view"], password: "Act-Synthetic-Pass-01" } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "act@synthetic.test" } }));
  const r = svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "act@synthetic.test" } }));
  assert.equal(r.body.user.status, "active");
  await login(repo, "act@synthetic.test", "Act-Synthetic-Pass-01");
});
await test("16g a reset link issued before deactivation cannot be used after reactivation (no takeover)", async () => {
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "tko@synthetic.test", name: "T", role: "viewer", modules: ["dashboard:view"], password: "Tko-Synthetic-Pass-01" } }));
  const rs = svc.dbInvitationsPost(repo, ctx({ token: owner, body: { email: "tko@synthetic.test", purpose: "reset" } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "tko@synthetic.test" } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "tko@synthetic.test" } }));
  assert.equal((await svc.dbInvitationAccept(repo, ctx({ body: { token: tokenFromPath(rs.body.invitation.path), password: "Attacker-Chosen-Pass-1" } }))).status, 400);
  await login(repo, "tko@synthetic.test", "Tko-Synthetic-Pass-01");
});
await test("16h recovery audit trail: status transitions recorded with from→to detail", async () => {
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "aud@synthetic.test", name: "Aud", role: "viewer", modules: ["dashboard:view"] } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "aud@synthetic.test" } }));
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "aud@synthetic.test" } }));
  svc.dbInvitationsPost(repo, ctx({ token: owner, body: { email: "aud@synthetic.test", purpose: "invite" } }));
  const seq = auditOf(repo, "aud@synthetic.test").filter((a: any) => a.result === "success").map((a: any) => `${a.action}${a.detail?.includes("->") ? ` (${a.detail})` : ""}`);
  assert.deepEqual(seq, ["user.create", "user.deactivate (invited -> deactivated)", "user.activate (deactivated -> invited)", "invitation.issue"]);
  for (const a of auditOf(repo, "aud@synthetic.test")) assert.equal(a.actor_email, OWNER_EMAIL);
});
await test("16i Owner protection unchanged (cannot deactivate/reactivate/reset Owner)", async () => {
  const { repo, owner } = await ownerFixture();
  for (const action of ["deactivate", "activate"]) {
    assert.equal(svc.dbUsersPatch(repo, ctx({ token: owner, body: { action, email: OWNER_EMAIL } })).status, 403);
  }
  assert.equal(svc.dbInvitationsPost(repo, ctx({ token: owner, body: { email: OWNER_EMAIL, purpose: "reset" } })).status, 403);
  assert.ok(repo.hasActiveOwner());
});

section("17. OA-U2-F — session messaging (QC F1)");
await test("17a deactivate / rights-change responses carry the accurate limitation notice", async () => {
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "msg@synthetic.test", name: "M", role: "viewer", modules: ["dashboard:view"], password: "Msg-Synthetic-Pass-01" } }));
  const d = svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "deactivate", email: "msg@synthetic.test" } }));
  assert.match(d.body.sessionNotice, /at most 8 hours/);
  svc.dbUsersPatch(repo, ctx({ token: owner, body: { action: "activate", email: "msg@synthetic.test" } }));
  const u = svc.dbUsersPatch(repo, ctx({ token: owner, body: { email: "msg@synthetic.test", modules: ["dashboard:view", "reports:view"] } }));
  assert.match(u.body.sessionNotice, /data pages do not yet re-check/);
  const n = svc.dbUsersPatch(repo, ctx({ token: owner, body: { email: "msg@synthetic.test", name: "Renamed" } }));
  assert.equal(n.body.sessionNotice, undefined, "name-only edit makes no session claim");
});
await test("17b no source file claims immediate sign-out / immediate revocation", async () => {
  const files = ["app/components/UserManagementDbView.tsx", "app/lib/auth-service.ts", "app/lib/auth-repository.ts",
    "app/api/auth/change-password/route.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/signed out immediately|revokes every outstanding session immediately|apply immediately|deactivated and signed out|Other sessions have been signed out/i.test(src), f);
  }
});

section("18. OA-U2-F — login rate limiting (QC F3), adversarial");
const SMALL = {
  perSource: { limit: 6, windowMs: 600_000 },
  perAccountSource: { limit: 3, windowMs: 600_000 },
  perAccount: { limit: 5, windowMs: 600_000 },
  perAccountDevice: { limit: 3, windowMs: 600_000 },
  acceptPerSource: { limit: 4, windowMs: 600_000 },
};
const xff = (ip: string, ...spoofed: string[]) => ({ "x-forwarded-for": [...spoofed, ip].join(", ") });
const tryLogin = (repo: any, email: string, password: string, headers: Record<string, string> = {}, cookie?: string) =>
  svc.dbLogin(repo, { ...ctx({ body: { email, password }, headers }), cookie: (n: string) => (n === "bansil_ld" ? cookie : undefined) });

await test("18a client source: rightmost trusted hop only; spoofed left entries ignored; invalid → unknown", async () => {
  assert.equal(rl.clientSource("203.0.113.7"), "v4:203.0.113.7");
  assert.equal(rl.clientSource("6.6.6.6, 1.2.3.4, 203.0.113.7"), "v4:203.0.113.7");
  assert.equal(rl.clientSource("203.0.113.7, 10.0.0.1", 2), "v4:203.0.113.7");
  assert.equal(rl.clientSource("garbage"), "unknown");
  assert.equal(rl.clientSource(null), "unknown");
  assert.equal(rl.clientSource("1.2.3.4", 2), "unknown");
  assert.equal(rl.clientSource("2001:db8:1:2:aaaa::1"), rl.clientSource("2001:db8:1:2:bbbb::9"), "IPv6 grouped by /64");
  assert.notEqual(rl.clientSource("2001:db8:1:2::1"), rl.clientSource("2001:db8:1:3::1"));
});
await test("18b per-source limit → 429 with Retry-After; other sources unaffected", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo } = freshRepo();
  const rs = await Promise.all(Array.from({ length: 9 }, (_, i) => tryLogin(repo, `nobody${i}@synthetic.test`, "Wrong-Pass-123", xff("198.51.100.9"))));
  const codes = rs.map((r: any) => r.status);
  assert.equal(codes.filter((c: number) => c === 429).length, 3, codes.join(","));
  const r429 = rs.find((r: any) => r.status === 429);
  assert.match(r429.headers["Retry-After"], /^\d+$/);
  assert.ok(Number(r429.headers["Retry-After"]) >= 1 && Number(r429.headers["Retry-After"]) <= 600);
  assert.equal((await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("192.0.2.50"))).status, 200, "different source still works");
});
await test("18c spoofing X-Forwarded-For left entries does NOT bypass the per-source limit", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo } = freshRepo();
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    tryLogin(repo, `x${i}@synthetic.test`, "Wrong-Pass-123", xff("198.51.100.20", `10.9.${i}.${i}`, `172.16.0.${i}`))));
  assert.equal(rs.filter((r: any) => r.status === 429).length, 4);
});
await test("18d concurrent burst against one account from one source: at most the limit reaches the password check", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo, db } = freshRepo();
  const before = db.prepare("SELECT COUNT(*) n FROM auth_audit_log WHERE action='auth.login'").get().n;
  const rs = await Promise.all(Array.from({ length: 6 }, () => tryLogin(repo, OWNER_EMAIL, "Wrong-Pass-123", xff("198.51.100.30"))));
  const after = db.prepare("SELECT COUNT(*) n FROM auth_audit_log WHERE action='auth.login'").get().n;
  assert.equal(rs.filter((r: any) => r.status === 401).length, 3);
  assert.equal(rs.filter((r: any) => r.status === 429).length, 3);
  assert.equal(after - before, 3, "only 3 password checks happened");
});
await test("18e per-account+source block does not affect other accounts from that source or the account elsewhere", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo, owner } = await ownerFixture();
  await svc.dbUsersPost(repo, ctx({ token: owner, body: { email: "peer@synthetic.test", name: "P", role: "viewer", modules: ["dashboard:view"], password: "Peer-Synthetic-Pass-1" } }));
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  for (let i = 0; i < 3; i++) await tryLogin(repo, OWNER_EMAIL, "Wrong-Pass-123", xff("198.51.100.40"));
  assert.equal((await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("198.51.100.40"))).status, 429);
  assert.equal((await tryLogin(repo, "peer@synthetic.test", "Peer-Synthetic-Pass-1", xff("198.51.100.40"))).status, 200);
  assert.equal((await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("192.0.2.77"))).status, 200);
});
await test("18f distributed attack on the Owner account: untrusted sources blocked, Owner's known device still signs in", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo } = freshRepo();
  const ok = await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("192.0.2.10"));
  assert.equal(ok.status, 200);
  const device = ok.deviceCookie;
  assert.ok(device, "device cookie issued on successful login");
  await Promise.all(Array.from({ length: 8 }, (_, i) => tryLogin(repo, OWNER_EMAIL, "Wrong-Pass-123", xff(`203.0.113.${i + 1}`))));
  assert.equal((await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("203.0.113.200"))).status, 429, "new untrusted source blocked");
  assert.equal((await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("203.0.113.200"), device)).status, 200, "known device unaffected");
});
await test("18g device cookie: bound to its account, tamper/expiry rejected, contains no email", async () => {
  const c = rl.issueDeviceCookie(OWNER_EMAIL)!;
  assert.ok(!c.includes("owner") && !c.includes("@"));
  assert.ok(rl.verifyDeviceCookie(c, OWNER_EMAIL));
  assert.ok(rl.verifyDeviceCookie(c, " OWNER@synthetic.test "), "normalised");
  assert.equal(rl.verifyDeviceCookie(c, "someone@synthetic.test"), null, "cookie for one account grants nothing for another");
  const parts = c.split(".");
  assert.equal(rl.verifyDeviceCookie([...parts.slice(0, 4), parts[4].slice(0, -2) + "AA"].join("."), OWNER_EMAIL), null);
  assert.equal(rl.verifyDeviceCookie([parts[0], parts[1], parts[2], "1", parts[4]].join("."), OWNER_EMAIL), null);
  assert.equal(rl.verifyDeviceCookie(c, OWNER_EMAIL, Date.now() + 31 * 86400_000), null, "expired");
  const forged = auth.createToken({ email: OWNER_EMAIL, name: "x", role: "super_admin", modules: [] });
  assert.equal(rl.verifyDeviceCookie(forged, OWNER_EMAIL), null, "a JWT is not a device cookie");
});
await test("18h no account enumeration: 401 and 429 identical for existing vs non-existent accounts", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo } = freshRepo();
  const shape = (r: any) => JSON.stringify({ s: r.status, b: r.body, h: Object.keys(r.headers ?? {}).sort() });
  const e1 = await tryLogin(repo, OWNER_EMAIL, "Wrong-Pass-123", xff("198.51.100.60"));
  const n1 = await tryLogin(repo, "ghost@synthetic.test", "Wrong-Pass-123", xff("198.51.100.61"));
  assert.equal(shape(e1), shape(n1));
  for (let i = 0; i < 3; i++) {
    await tryLogin(repo, OWNER_EMAIL, "Wrong-Pass-123", xff("198.51.100.62"));
    await tryLogin(repo, "ghost@synthetic.test", "Wrong-Pass-123", xff("198.51.100.63"));
  }
  const e2 = await tryLogin(repo, OWNER_EMAIL, "Wrong-Pass-123", xff("198.51.100.62"));
  const n2 = await tryLogin(repo, "ghost@synthetic.test", "Wrong-Pass-123", xff("198.51.100.63"));
  assert.equal(e2.status, 429);
  assert.equal(JSON.stringify(e2.body), JSON.stringify(n2.body));
  assert.equal(e2.status, n2.status);
});
await test("18i multi-user fairness: anonymous KDF flood cannot starve the Owner's known device", async () => {
  const { repo } = freshRepo();
  const first = await tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("192.0.2.10"));
  rl.__resetLoginRateLimiterForTests();
  const flood = Array.from({ length: 30 }, (_, i) => tryLogin(repo, `flood${i}@synthetic.test`, "Wrong-Pass-123", xff(`198.18.${i}.1`)));
  const ownerTry = tryLogin(repo, OWNER_EMAIL, OWNER_PW, xff("192.0.2.10"), first.deviceCookie);
  const [o, ...rest] = await Promise.all([ownerTry, ...flood]);
  assert.equal(o.status, 200, `owner got ${o.status}`);
  assert.ok(rest.some((r: any) => r.status === 429), "flood saturated the untrusted lane");
});
await test("18j KDF never runs two 64 MiB derivations at once (QC F6)", async () => {
  assert.ok(pw.kdfStats().peakActive <= 1, `peak ${pw.kdfStats().peakActive}`);
  await Promise.all(Array.from({ length: 12 }, (_, i) => pw.hashPasswordAsync(`x-${i}-synthetic-pass`, i % 2 ? "trusted" : "untrusted").catch(() => null)));
  assert.equal(pw.kdfStats().peakActive, 1);
  assert.equal(pw.kdfStats().active, 0, "slot released after the queue drains");
});
await test("18k KDF saturation refunds account counters (a flood cannot burn a user's attempts)", async () => {
  const lim = new rl.LoginRateLimiter(Date.now, SMALL);
  const k = { account: rl.accountKey("a@synthetic.test"), source: "v4:1.1.1.1", deviceId: null };
  for (let i = 0; i < 3; i++) { lim.recordAttempt(k); lim.refundAttempt(k); }
  assert.equal(lim.checkLogin({ ...k, source: "v4:1.1.1.1" }), 0, "pair/account not exhausted");
  assert.ok(lim.perSource.blockedFor("v4:1.1.1.1") === 0);
});
await test("18l limiter memory is bounded (10,000 keys)", async () => {
  const lim = new rl.LoginRateLimiter();
  for (let i = 0; i < 10_500; i++) lim.perAccount.hit(`k${i}`);
  assert.ok(lim.perAccount.size() <= 10_000, String(lim.perAccount.size()));
});
await test("18m invitation accept is rate limited per source", async () => {
  rl.__resetLoginRateLimiterForTests(undefined, SMALL);
  const { repo } = freshRepo();
  const rs = [];
  for (let i = 0; i < 6; i++) {
    rs.push(await svc.dbInvitationAccept(repo, ctx({ headers: xff("198.51.100.90"), body: { token: randomBytes(32).toString("base64url"), password: "Whatever-Synthetic-1" } })));
  }
  assert.deepEqual(rs.map((r: any) => r.status), [400, 400, 400, 400, 429, 429]);
});
await test("18n successful login is unaffected by limits under normal use; limiter keys hold no raw emails", async () => {
  const { repo } = freshRepo();
  for (let i = 0; i < 3; i++) await login(repo, OWNER_EMAIL, OWNER_PW);
  assert.match(rl.accountKey(OWNER_EMAIL), /^[0-9a-f]{32}$/);
});
await test("18o existing env-mode login is unchanged by OA-U2-F (no limiter, same authenticate())", async () => {
  const src = fs.readFileSync(path.join(ROOT, "app/api/auth/login/route.ts"), "utf8");
  const envPart = src.slice(src.indexOf("if (isDbStore()) return runDbHandler(request, dbLogin);"));
  assert.ok(!/loginLimiter|auth-ratelimit/.test(envPart), "env path must not use the DB-mode limiter");
  process.env.AUTH_USERS = legacyAuthUsersJson();
  try {
    assert.ok(auth.authenticate(OWNER_EMAIL, OWNER_PW));
  } finally {
    if (SYNTH_AUTH_USERS_BEFORE === undefined) delete process.env.AUTH_USERS; else process.env.AUTH_USERS = SYNTH_AUTH_USERS_BEFORE;
  }
});

section("19. OA-U2-F — minor issues (QC F4, F5)");
await test("19a F4: invite token read once — a Strict-Mode second effect run cannot erase it", async () => {
  const ref = { current: false };
  let hash = "#token=" + "A".repeat(43);
  const seen: string[] = [];
  const effect = () => inviteTok.readTokenOnce(ref, () => hash, (t: string) => seen.push(t), () => { hash = ""; });
  effect(); // first mount
  effect(); // Strict Mode re-run after the hash was stripped
  assert.deepEqual(seen, ["A".repeat(43)]);
  assert.equal(inviteTok.tokenFromHash("#token=short"), "");
  assert.equal(inviteTok.tokenFromHash("#a=1&token=" + "b".repeat(30)), "b".repeat(30));
});
await test("19b F5: if SQLite already rolled back, the ORIGINAL error surfaces (not 'no transaction')", async () => {
  const { repo, db } = freshRepo();
  assert.throws(() => (repo as any).tx(() => { db.exec("ROLLBACK"); throw new Error("ORIGINAL-FAILURE"); }), /ORIGINAL-FAILURE/);
  assert.equal(db.isTransaction, false, "connection left clean");
  assert.throws(() => (repo as any).tx(() => { throw new Error("NORMAL-FAILURE"); }), /NORMAL-FAILURE/);
  assert.equal(db.isTransaction, false);
});

// ------------------------------------------------------------------ summary
console.log(`\n${"─".repeat(56)}\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
fs.rmSync(TMP, { recursive: true, force: true });
if (failed) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("ALL PASS");
