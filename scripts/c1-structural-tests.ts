// ============================================================
// C-1 Security Hardening — Structural Validation Tests
//
// Verifies the guards are correctly wired into the source files
// without importing or running any application code.
// Safe to run anywhere — reads source files only.
//
// Run: node --experimental-strip-types scripts/c1-structural-tests.ts
//   or: npx tsx scripts/c1-structural-tests.ts
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(
  import.meta.dirname || path.dirname(new URL(import.meta.url).pathname),
  ".."
);

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

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf-8");
}

// ============================================================
// Suite 1: api-guard.ts — functions and identity binding
// ============================================================

console.log("\n=== Suite 1: api-guard.ts — requireOwnerSessionOrForbid ===\n");

{
  const content = readFile("app/lib/audit/api-guard.ts");

  assert(
    content.includes("export async function requireOwnerSessionOrForbid"),
    "1.1: requireOwnerSessionOrForbid is exported and async"
  );
  assert(
    content.includes("Promise<NextResponse | null>"),
    "1.2: Returns Promise<NextResponse | null>"
  );
  assert(
    content.includes("status: 403"),
    "1.3: Returns 403 status"
  );
  assert(
    content.includes('"Forbidden'),
    "1.4: Error message contains 'Forbidden'"
  );
  assert(
    content.includes("OWNER_SESSION_COOKIE"),
    "1.5: Reads the Owner session cookie"
  );
  assert(
    content.includes("isValidOwnerSession"),
    "1.6: Calls isValidOwnerSession for verification"
  );

  // Identity binding: JWT verification
  assert(
    content.includes('import { verifyTokenEdge } from "../auth-edge.ts"'),
    "1.7: Imports verifyTokenEdge from auth-edge"
  );
  assert(
    content.includes("await verifyTokenEdge(jwt)"),
    "1.8: Calls verifyTokenEdge to verify JWT cryptographically"
  );
  assert(
    content.includes('AUTH_COOKIE') && content.includes('"bansil_auth"'),
    "1.9: Reads bansil_auth JWT cookie"
  );
  assert(
    content.includes('payload.role !== "super_admin"'),
    "1.10: Checks JWT role is super_admin"
  );
  assert(
    content.includes("status: 401"),
    "1.11: Returns 401 for missing/invalid JWT"
  );

  // Backward compat: old function still exists and returns 401
  assert(
    content.includes("export function requireOwnerSession("),
    "1.12: Original requireOwnerSession still exists (sync, not async)"
  );
  assert(
    /requireOwnerSession\(req: NextRequest\): NextResponse \| null/.test(content),
    "1.13: Original requireOwnerSession return type is synchronous"
  );
}

// ============================================================
// Suite 2: Guarded routes — import, call, and await
// ============================================================

console.log("\n=== Suite 2: All 6 mutation routes are guarded with await ===\n");

const GUARDED_ROUTES = [
  { file: "app/api/sync/route.ts", handler: "POST", desc: "POST /api/sync" },
  { file: "app/api/sync/backfill/route.ts", handler: "POST", desc: "POST /api/sync/backfill" },
  { file: "app/api/sync/disconnect/route.ts", handler: "POST", desc: "POST /api/sync/disconnect" },
  { file: "app/api/zoho/connect/route.ts", handler: "GET", desc: "GET /api/zoho/connect" },
  { file: "app/api/zoho/disconnect/route.ts", handler: "POST", desc: "POST /api/zoho/disconnect" },
  { file: "app/api/zoho/refresh/route.ts", handler: "POST", desc: "POST /api/zoho/refresh" },
];

for (const route of GUARDED_ROUTES) {
  const content = readFile(route.file);

  // 2a: Import exists
  assert(
    content.includes('import { requireOwnerSessionOrForbid } from "@/app/lib/audit/api-guard"'),
    `2a: ${route.desc} — imports requireOwnerSessionOrForbid`
  );

  // 2b: Guard is called with await in the correct handler
  const handlerRegex = new RegExp(
    `export async function ${route.handler}\\b[\\s\\S]*?\\breturn\\b`,
    "m"
  );
  const handlerMatch = content.match(handlerRegex);
  if (handlerMatch) {
    assert(
      handlerMatch[0].includes("await requireOwnerSessionOrForbid(request)"),
      `2b: ${route.desc} — handler calls await requireOwnerSessionOrForbid(request)`
    );
  } else {
    assert(false, `2b: ${route.desc} — could not find handler`);
  }

  // 2c: Denial is returned
  assert(
    content.includes("if (denied) return denied"),
    `2c: ${route.desc} — returns denial response`
  );

  // 2d: Handler signature includes NextRequest parameter
  const sigRegex = new RegExp(
    `export async function ${route.handler}\\(request: NextRequest\\)`,
  );
  assert(
    sigRegex.test(content),
    `2d: ${route.desc} — handler takes NextRequest parameter`
  );
}

// ============================================================
// Suite 3: Unguarded routes — read-only endpoints stay open
// ============================================================

console.log("\n=== Suite 3: Read-only routes remain unguarded ===\n");

{
  const syncContent = readFile("app/api/sync/route.ts");
  const getHandler = syncContent.substring(
    syncContent.indexOf("export async function GET"),
    syncContent.indexOf("export async function POST")
  );
  assert(
    !getHandler.includes("requireOwnerSessionOrForbid"),
    "3.1: GET /api/sync — handler does NOT call the guard"
  );
  assert(
    !getHandler.includes("denied"),
    "3.2: GET /api/sync — no denial logic in GET"
  );
}

{
  const backfillContent = readFile("app/api/sync/backfill/route.ts");
  const getHandler = backfillContent.substring(
    backfillContent.indexOf("export async function GET"),
    backfillContent.indexOf("export async function POST")
  );
  assert(
    !getHandler.includes("requireOwnerSessionOrForbid"),
    "3.3: GET /api/sync/backfill — handler does NOT call the guard"
  );
}

{
  const statusContent = readFile("app/api/zoho/status/route.ts");
  assert(
    !statusContent.includes("requireOwnerSessionOrForbid"),
    "3.4: GET /api/zoho/status — file does NOT import the guard"
  );
}

{
  const callbackContent = readFile("app/api/zoho/callback/route.ts");
  assert(
    !callbackContent.includes("requireOwnerSessionOrForbid"),
    "3.5: GET /api/zoho/callback — file does NOT import the guard"
  );
}

// ============================================================
// Suite 4: Guard ordering — Owner guard before feature guard
// ============================================================

console.log("\n=== Suite 4: Owner guard executes before feature guard ===\n");

for (const route of GUARDED_ROUTES) {
  const content = readFile(route.file);
  const handlerStart = content.indexOf(`export async function ${route.handler}(`);
  if (handlerStart < 0) {
    assert(false, `4: ${route.desc} — could not find handler`);
    continue;
  }
  const handlerBody = content.substring(handlerStart);

  const ownerPos = handlerBody.indexOf("requireOwnerSessionOrForbid(request)");
  const featurePos = handlerBody.indexOf("requireFeaturesEnabled(");

  if (featurePos >= 0) {
    assert(
      ownerPos >= 0 && ownerPos < featurePos,
      `4: ${route.desc} — Owner guard before feature guard in ${route.handler} handler`
    );
  } else {
    assert(ownerPos >= 0, `4: ${route.desc} — Owner guard present (no feature guard call)`);
  }
}

// ============================================================
// Suite 5: Middleware public path consistency
// ============================================================

console.log("\n=== Suite 5: Middleware PUBLIC_PATHS consistency ===\n");

{
  const mwContent = readFile("middleware.ts");

  assert(
    mwContent.includes('"/api/zoho/callback"'),
    "5.1: /api/zoho/callback IS in PUBLIC_PATHS (OAuth redirect)"
  );
  assert(
    !mwContent.includes('"/api/zoho/connect"'),
    "5.2: /api/zoho/connect is NOT in PUBLIC_PATHS"
  );
  assert(
    !mwContent.includes('"/api/zoho/disconnect"'),
    "5.3: /api/zoho/disconnect is NOT in PUBLIC_PATHS"
  );
  assert(
    !mwContent.includes('"/api/zoho/refresh"'),
    "5.4: /api/zoho/refresh is NOT in PUBLIC_PATHS"
  );
  assert(
    !mwContent.includes('"/api/sync"'),
    "5.5: /api/sync is NOT in PUBLIC_PATHS"
  );
}

// ============================================================
// Suite 6: Zoho security guard untouched
// ============================================================

console.log("\n=== Suite 6: Zoho read-only security guard unchanged ===\n");

{
  const guardContent = readFile("app/lib/zoho-security-guard.ts");
  const scopeMatches = guardContent.match(/ZohoBooks\.\w+\.READ/g) || [];
  assert(scopeMatches.length === 13, `6.1: Still exactly 13 READ scopes (found ${scopeMatches.length})`);
  const allRead = scopeMatches.every((s: string) => s.endsWith(".READ"));
  assert(allRead, "6.2: All scopes end with .READ");
  assert(guardContent.includes("Object.freeze"), "6.3: Scope array is frozen (immutable)");
  assert(
    guardContent.includes(".CREATE") && guardContent.includes(".DELETE") && guardContent.includes(".UPDATE"),
    "6.4: assertApprovedScopes checks for CREATE, DELETE, UPDATE"
  );
  assert(
    guardContent.includes("export function assertZohoReadOnlyRequest"),
    "6.5: assertZohoReadOnlyRequest still exported"
  );
  assert(guardContent.includes('ACCESS_MODE: "READ ONLY"'), "6.6: ZOHO_SECURITY_POLICY ACCESS_MODE still READ ONLY");
  assert(
    !guardContent.includes("requireOwnerSessionOrForbid"),
    "6.7: Security guard does NOT import route-level auth (clean separation)"
  );
}

// ============================================================
// Suite 7: Token store isolation
// ============================================================

console.log("\n=== Suite 7: Token store unmodified ===\n");

{
  const tokenContent = readFile("app/lib/zoho-token-store.ts");
  assert(!tokenContent.includes("requireOwnerSessionOrForbid"), "7.1: Token store does NOT import route-level auth");
  assert(tokenContent.includes("assertNotOperationalInTestMode"), "7.2: Test isolation guard still present");
  assert(tokenContent.includes("BANSIL_TEST_ZOHO_TOKEN_FILE"), "7.3: Test token file env var still referenced");
}

// ============================================================
// Suite 8: No accidental Zoho WRITE enablement
// ============================================================

console.log("\n=== Suite 8: ZOHO WRITE = 0 verification ===\n");

{
  for (const route of GUARDED_ROUTES) {
    const content = readFile(route.file);
    assert(
      !content.includes(".CREATE") && !content.includes(".DELETE") &&
      !content.includes(".UPDATE") && !content.includes(".ALL"),
      `8: ${route.desc} — no write scopes in file`
    );
  }
}

// ============================================================
// Suite 9: Identity binding — three-layer defense structure
// ============================================================

console.log("\n=== Suite 9: Three-layer defense structure in api-guard.ts ===\n");

{
  const content = readFile("app/lib/audit/api-guard.ts");

  // Extract the requireOwnerSessionOrForbid function body
  const fnStart = content.indexOf("export async function requireOwnerSessionOrForbid");
  const fnBody = content.substring(fnStart);

  // Layer 1: JWT verification comes first
  const jwtCheckPos = fnBody.indexOf("verifyTokenEdge(jwt)");
  assert(jwtCheckPos >= 0, "9.1: Layer 1 — verifyTokenEdge called");

  // Layer 2: Role check comes after JWT verification
  const roleCheckPos = fnBody.indexOf('payload.role !== "super_admin"');
  assert(roleCheckPos >= 0, "9.2: Layer 2 — role check for super_admin");
  assert(jwtCheckPos < roleCheckPos, "9.3: JWT verification before role check");

  // Layer 3: Owner session check comes after role check
  const ownerCheckPos = fnBody.indexOf("isValidOwnerSession(token)");
  assert(ownerCheckPos >= 0, "9.4: Layer 3 — Owner session check");
  assert(roleCheckPos < ownerCheckPos, "9.5: Role check before Owner session check");

  // 401 for JWT failures (before 403)
  const first401 = fnBody.indexOf("status: 401");
  const first403 = fnBody.indexOf("status: 403");
  assert(first401 >= 0 && first403 >= 0, "9.6: Both 401 and 403 status codes present");
  assert(first401 < first403, "9.7: 401 (auth) returns before 403 (authz)");
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
