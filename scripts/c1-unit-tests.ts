// ============================================================
// C-1 Security Hardening — Unit Tests (Mocked Runtime)
//
// Tests guard logic with mocked NextRequest/NextResponse and
// mocked verifyTokenEdge. No real imports from the app.
//
// Run: node --experimental-strip-types scripts/c1-unit-tests.ts
//   or: npx tsx scripts/c1-unit-tests.ts
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ FAIL: ${label}`);
  }
}

// ============================================================
// Mock infrastructure
// ============================================================

class MockHeaders {
  private store: Map<string, string>;
  constructor(init?: Record<string, string>) {
    this.store = new Map(Object.entries(init ?? {}));
  }
  get(name: string): string | undefined { return this.store.get(name); }
  has(name: string): boolean { return this.store.has(name); }
  set(name: string, value: string): void { this.store.set(name, value); }
}

class MockCookieJar {
  private jar: Map<string, string>;
  constructor(cookies?: Record<string, string>) {
    this.jar = new Map(Object.entries(cookies ?? {}));
  }
  get(name: string): { value: string } | undefined {
    const v = this.jar.get(name);
    return v !== undefined ? { value: v } : undefined;
  }
}

function mockRequest(cookies: Record<string, string>): any {
  return {
    cookies: new MockCookieJar(cookies),
    headers: new MockHeaders(),
    url: "http://localhost:3000/api/sync",
    method: "POST",
  };
}

// ============================================================
// Inline guard implementation (mirrors api-guard.ts logic)
// for isolated unit testing without importing app code
// ============================================================

const OWNER_SESSION_COOKIE = "bansil_owner_session";
const AUTH_COOKIE = "bansil_auth";

// Mock session store
const validOwnerSessions = new Set<string>();

function isValidOwnerSession(token: string | undefined): boolean {
  if (!token) return false;
  return validOwnerSessions.has(token);
}

// Mock verifyTokenEdge — controlled per test
type JWTPayload = {
  sub: string;
  name: string;
  role: string;
  modules: string[];
  iat: number;
  exp: number;
};

let mockVerifyResult: JWTPayload | null = null;

function setMockJwtResult(result: JWTPayload | null): void {
  mockVerifyResult = result;
}

async function verifyTokenEdge(_token: string): Promise<JWTPayload | null> {
  return mockVerifyResult;
}

// The guard under test — mirrors the production code exactly
async function requireOwnerSessionOrForbid(req: any): Promise<{ status: number; body: any } | null> {
  // Layer 1: JWT presence and cryptographic verification
  const jwt = req.cookies.get(AUTH_COOKIE)?.value;
  if (!jwt) {
    return { status: 401, body: { success: false, error: "Unauthorized." } };
  }

  const payload = await verifyTokenEdge(jwt);
  if (!payload) {
    return { status: 401, body: { success: false, error: "Unauthorized. Invalid or expired credentials." } };
  }

  // Layer 2: Role-based identity binding
  if (payload.role !== "super_admin") {
    return { status: 403, body: { success: false, error: "Forbidden. Only the Owner can perform this action." } };
  }

  // Layer 3: Owner session passphrase gate
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  if (!isValidOwnerSession(token)) {
    return { status: 403, body: { success: false, error: "Forbidden. Only the Owner can perform this action." } };
  }

  return null; // All three layers passed
}

// Old sync guard — for backward compat testing
function requireOwnerSession(req: any): { status: number; body: any } | null {
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  if (!isValidOwnerSession(token)) {
    return { status: 401, body: { success: false, error: "Owner session required." } };
  }
  return null;
}

// Helper JWT payload
function adminPayload(): JWTPayload {
  return {
    sub: "owner@bansilengineers.com",
    name: "Owner",
    role: "super_admin",
    modules: ["zoho_sync"],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function viewerPayload(): JWTPayload {
  return {
    sub: "viewer@bansilengineers.com",
    name: "Viewer",
    role: "viewer",
    modules: ["dashboard"],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function editorPayload(): JWTPayload {
  return {
    sub: "editor@bansilengineers.com",
    name: "Editor",
    role: "editor",
    modules: ["reports"],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

// ============================================================
// Suite 1: No JWT cookie → 401
// ============================================================

console.log("\n=== Suite 1: Unauthenticated — no JWT → 401 ===\n");

await (async () => {
  // No cookies at all
  setMockJwtResult(null);
  const result1 = await requireOwnerSessionOrForbid(mockRequest({}));
  assert(result1 !== null, "1.1: Returns denial when no cookies");
  assert(result1?.status === 401, "1.2: Status is 401");
  assert(result1?.body?.error === "Unauthorized.", "1.3: Error message is 'Unauthorized.'");

  // Only owner session cookie, no JWT
  validOwnerSessions.add("valid-session-token");
  const result2 = await requireOwnerSessionOrForbid(
    mockRequest({ [OWNER_SESSION_COOKIE]: "valid-session-token" })
  );
  assert(result2 !== null, "1.4: Returns denial when only owner session cookie (no JWT)");
  assert(result2?.status === 401, "1.5: Status is 401 even with valid owner session");
  validOwnerSessions.clear();
})();

// ============================================================
// Suite 2: Invalid/forged JWT → 401
// ============================================================

console.log("\n=== Suite 2: Invalid/forged JWT → 401 ===\n");

await (async () => {
  setMockJwtResult(null); // Simulates forged/expired/invalid JWT

  const result = await requireOwnerSessionOrForbid(
    mockRequest({ [AUTH_COOKIE]: "forged.jwt.token" })
  );
  assert(result !== null, "2.1: Returns denial for forged JWT");
  assert(result?.status === 401, "2.2: Status is 401");
  assert(result?.body?.error?.includes("Invalid or expired"), "2.3: Error mentions invalid/expired");

  // With valid owner session but bad JWT
  validOwnerSessions.add("valid-session-token");
  const result2 = await requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "expired.jwt.token",
      [OWNER_SESSION_COOKIE]: "valid-session-token",
    })
  );
  assert(result2 !== null, "2.4: Denied even with valid owner session if JWT is bad");
  assert(result2?.status === 401, "2.5: Status is 401 (JWT check comes before session check)");
  validOwnerSessions.clear();
})();

// ============================================================
// Suite 3: Valid JWT, non-admin role → 403
// ============================================================

console.log("\n=== Suite 3: Non-admin role → 403 ===\n");

await (async () => {
  // Viewer role
  setMockJwtResult(viewerPayload());
  const result1 = await requireOwnerSessionOrForbid(
    mockRequest({ [AUTH_COOKIE]: "valid.jwt.viewer" })
  );
  assert(result1 !== null, "3.1: Returns denial for viewer role");
  assert(result1?.status === 403, "3.2: Status is 403 (forbidden, not unauthorized)");
  assert(result1?.body?.error?.includes("Forbidden"), "3.3: Error contains 'Forbidden'");

  // Editor role
  setMockJwtResult(editorPayload());
  const result2 = await requireOwnerSessionOrForbid(
    mockRequest({ [AUTH_COOKIE]: "valid.jwt.editor" })
  );
  assert(result2 !== null, "3.4: Returns denial for editor role");
  assert(result2?.status === 403, "3.5: Status is 403 for editor");

  // Non-admin with stolen owner session cookie
  setMockJwtResult(viewerPayload());
  validOwnerSessions.add("stolen-session-token");
  const result3 = await requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "valid.jwt.viewer",
      [OWNER_SESSION_COOKIE]: "stolen-session-token",
    })
  );
  assert(result3 !== null, "3.6: CRITICAL — non-admin with stolen owner session cookie is DENIED");
  assert(result3?.status === 403, "3.7: CRITICAL — status is 403 (role check catches theft)");
  validOwnerSessions.clear();
})();

// ============================================================
// Suite 4: Admin without Owner session → 403
// ============================================================

console.log("\n=== Suite 4: Admin without Owner session → 403 ===\n");

await (async () => {
  setMockJwtResult(adminPayload());

  // Admin JWT but no owner session cookie
  const result1 = await requireOwnerSessionOrForbid(
    mockRequest({ [AUTH_COOKIE]: "valid.jwt.admin" })
  );
  assert(result1 !== null, "4.1: Admin without owner session is denied");
  assert(result1?.status === 403, "4.2: Status is 403");

  // Admin JWT with invalid owner session cookie
  const result2 = await requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "valid.jwt.admin",
      [OWNER_SESSION_COOKIE]: "expired-or-invalid-token",
    })
  );
  assert(result2 !== null, "4.3: Admin with invalid owner session is denied");
  assert(result2?.status === 403, "4.4: Status is 403");
})();

// ============================================================
// Suite 5: Admin with valid Owner session → ALLOWED (null)
// ============================================================

console.log("\n=== Suite 5: Admin + valid Owner session → allowed ===\n");

await (async () => {
  setMockJwtResult(adminPayload());
  validOwnerSessions.add("valid-session-for-admin");

  const result = await requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "valid.jwt.admin",
      [OWNER_SESSION_COOKIE]: "valid-session-for-admin",
    })
  );
  assert(result === null, "5.1: Returns null (allowed) for admin with valid owner session");
  validOwnerSessions.clear();
})();

// ============================================================
// Suite 6: Guard is async
// ============================================================

console.log("\n=== Suite 6: Guard async behavior ===\n");

await (async () => {
  setMockJwtResult(adminPayload());
  validOwnerSessions.add("async-test-session");

  const promise = requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "valid.jwt.admin",
      [OWNER_SESSION_COOKIE]: "async-test-session",
    })
  );
  assert(promise instanceof Promise, "6.1: requireOwnerSessionOrForbid returns a Promise");

  const resolved = await promise;
  assert(resolved === null, "6.2: Promise resolves to null for valid request");
  validOwnerSessions.clear();
})();

// ============================================================
// Suite 7: Old requireOwnerSession (backward compat)
// ============================================================

console.log("\n=== Suite 7: Original requireOwnerSession unchanged ===\n");

{
  // Without valid session
  const result1 = requireOwnerSession(mockRequest({}));
  assert(result1 !== null, "7.1: Old guard denies without session");
  assert(result1?.status === 401, "7.2: Old guard returns 401 (not 403)");

  // With valid session
  validOwnerSessions.add("legacy-session");
  const result2 = requireOwnerSession(
    mockRequest({ [OWNER_SESSION_COOKIE]: "legacy-session" })
  );
  assert(result2 === null, "7.3: Old guard allows with valid session");
  validOwnerSessions.clear();

  // Sync (not async)
  const returnVal = requireOwnerSession(mockRequest({}));
  assert(!(returnVal instanceof Promise), "7.4: Old guard is synchronous (not a Promise)");
}

// ============================================================
// Suite 8: Layer ordering — 401 before 403
// ============================================================

console.log("\n=== Suite 8: Layer ordering — auth before authz ===\n");

await (async () => {
  // No JWT, no session → should get 401 (not 403)
  setMockJwtResult(null);
  const result = await requireOwnerSessionOrForbid(mockRequest({}));
  assert(result?.status === 401, "8.1: Missing JWT gives 401 before checking session");

  // Bad JWT, valid session → should get 401 (JWT checked first)
  validOwnerSessions.add("session-present");
  setMockJwtResult(null);
  const result2 = await requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "bad.jwt",
      [OWNER_SESSION_COOKIE]: "session-present",
    })
  );
  assert(result2?.status === 401, "8.2: Invalid JWT gives 401 even with valid session");

  // Valid JWT non-admin, valid session → 403 (role checked before session)
  setMockJwtResult(viewerPayload());
  const result3 = await requireOwnerSessionOrForbid(
    mockRequest({
      [AUTH_COOKIE]: "viewer.jwt",
      [OWNER_SESSION_COOKIE]: "session-present",
    })
  );
  assert(result3?.status === 403, "8.3: Non-admin role gives 403 (role check before session check)");
  validOwnerSessions.clear();
})();

// ============================================================
// Suite 9: Source file structure validation
// ============================================================

console.log("\n=== Suite 9: Production api-guard.ts matches test assumptions ===\n");

{
  const PROJECT_ROOT = path.resolve(
    import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
    ".."
  );
  const guardSource = fs.readFileSync(
    path.join(PROJECT_ROOT, "app/lib/audit/api-guard.ts"),
    "utf-8"
  );

  // Verify the production code uses the same cookie names we test against
  assert(
    guardSource.includes(`"bansil_auth"`),
    "9.1: Production uses bansil_auth cookie name"
  );
  assert(
    guardSource.includes("OWNER_SESSION_COOKIE"),
    "9.2: Production uses OWNER_SESSION_COOKIE constant"
  );
  assert(
    guardSource.includes("verifyTokenEdge"),
    "9.3: Production calls verifyTokenEdge"
  );
  assert(
    guardSource.includes("payload.role"),
    "9.4: Production checks payload.role"
  );
  assert(
    guardSource.includes('"super_admin"'),
    "9.5: Production compares against super_admin"
  );

  // Verify layer order in source
  const fnStart = guardSource.indexOf("export async function requireOwnerSessionOrForbid");
  const fnBody = guardSource.substring(fnStart);
  const jwtPos = fnBody.indexOf("verifyTokenEdge");
  const rolePos = fnBody.indexOf('payload.role !== "super_admin"');
  const sessionPos = fnBody.indexOf("isValidOwnerSession");
  assert(jwtPos < rolePos, "9.6: Source: JWT check before role check");
  assert(rolePos < sessionPos, "9.7: Source: role check before session check");

  // Verify the function is async
  assert(
    guardSource.includes("export async function requireOwnerSessionOrForbid"),
    "9.8: Production function is async"
  );
}

// ============================================================
// Suite 10: No unauthorized SQLite writes
// ============================================================

console.log("\n=== Suite 10: No SQLite write operations in guard ===\n");

{
  const PROJECT_ROOT = path.resolve(
    import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
    ".."
  );
  const guardSource = fs.readFileSync(
    path.join(PROJECT_ROOT, "app/lib/audit/api-guard.ts"),
    "utf-8"
  );

  const writeOps = ["INSERT", "UPDATE", "DELETE", "CREATE TABLE", "ALTER TABLE", "DROP"];
  for (const op of writeOps) {
    assert(
      !guardSource.includes(op),
      `10: Guard does not contain ${op} statement`
    );
  }
}

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\n  FAILURES:");
  for (const f of failures) {
    console.log(`    ❌ ${f}`);
  }
}
console.log("=".repeat(60) + "\n");

process.exit(failed > 0 ? 1 : 0);
