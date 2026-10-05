// ============================================================
// Bansil Books Analytics — PROJECT-WIDE Feature Controls Tests
// Pure registry/logic tests: no DB, no server, no Zoho, no AI, and
// critically NO PRODUCTION DATA — every check below uses the registry
// itself (app/lib/feature-registry.ts) and synthetic settings objects
// only. Live route-level bypass proof and browser acceptance are
// covered separately (see PROJECT_FEATURE_CONTROLS.md §14) since the
// non-audit API routes share the single production DB singleton and
// must never be exercised by an automated test.
// ============================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_REGISTRY, isFeatureEffectivelyEnabled, getFeatureDefinition, featuresByModule, allModuleKeys } from "../app/lib/feature-registry.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
function test(name: string, fn: () => void) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

console.log("\n==================================================");
console.log("PROJECT-WIDE FEATURE CONTROLS TESTS (registry logic only, zero DB/network)");
console.log("==================================================");

// ---------------- Registry completeness ----------------

/**
 * Extracts every `featureKey: "..."` (or `featureKey: '...'`) string
 * literal actually present in Sidebar.tsx's source RIGHT NOW — not a
 * hardcoded snapshot. This means a future PR that adds a new nav item
 * with a new featureKey and forgets to register it in
 * app/lib/feature-registry.ts makes THIS test fail automatically, on
 * its own, with no maintenance of a second list required.
 */
function extractSidebarFeatureKeys(): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, "app/components/Sidebar.tsx"), "utf8");
  const matches = [...source.matchAll(/featureKey:\s*["']([a-zA-Z0-9_]+)["']/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

test("registry contains every featureKey CURRENTLY PRESENT in Sidebar.tsx's source (parsed live, not a hardcoded snapshot)", () => {
  const sidebarFeatureKeys = extractSidebarFeatureKeys();
  assert.ok(sidebarFeatureKeys.length > 30, `sanity check: expected 30+ distinct featureKeys in Sidebar.tsx, found ${sidebarFeatureKeys.length} — the parser itself may be broken`);
  const registryKeys = new Set(FEATURE_REGISTRY.map((f) => f.feature_key));
  const missing = sidebarFeatureKeys.filter((k) => !registryKeys.has(k));
  assert.deepStrictEqual(missing, [], `Sidebar.tsx references featureKey(s) [${missing.join(", ")}] that are missing from FEATURE_REGISTRY — a future nav item added without a matching registry entry fails exactly this way`);
});

test("every feature_key in the registry is unique (no accidental duplicate/collision)", () => {
  const keys = FEATURE_REGISTRY.map((f) => f.feature_key);
  assert.strictEqual(new Set(keys).size, keys.length, "duplicate feature_key found in the central registry");
});

test("every parent_feature_key reference points to a real, existing feature_key in the registry", () => {
  const keys = new Set(FEATURE_REGISTRY.map((f) => f.feature_key));
  for (const f of FEATURE_REGISTRY) {
    if (f.parent_feature_key) {
      assert.ok(keys.has(f.parent_feature_key), `${f.feature_key} declares parent "${f.parent_feature_key}" which does not exist in the registry`);
    }
  }
});

test("all top-level Bansil modules from the owner's required list are present", () => {
  const required = ["dashboard", "reconciliation", "transactions", "services", "inventory", "customers", "reports", "sync", "audit", "settings"];
  const present = new Set(allModuleKeys());
  for (const m of required) {
    assert.ok(present.has(m), `module_key "${m}" is missing from the registry`);
  }
});

test("Inventory, Customers, and Reports (LOCKED modules) each have at least one server_guard_required feature", () => {
  for (const moduleKey of ["inventory", "customers", "reports"]) {
    const defs = featuresByModule(moduleKey);
    assert.ok(defs.some((d) => d.server_guard_required), `LOCKED module "${moduleKey}" has no server-guarded feature at all`);
  }
});

// ---------------- Parent/child logic (generic, project-wide) ----------------

test("parent ON + child ON -> feature accessible (project-wide, non-audit example)", () => {
  const settings = { module_inventory: true, sub_inv_stock: true };
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_inv_stock", settings), true);
});

test("parent OFF -> child inaccessible even though the child's own bit is ON (project-wide, non-audit example)", () => {
  const settings = { module_customers: false, sub_cust_customer_details: true };
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_cust_customer_details", settings), false);
});

test("parent re-enabled -> previous child state preserved (project-wide)", () => {
  const off = { module_reports: false, sub_rep_price_reference: false };
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_rep_price_reference", off), false);
  const parentBackOn = { ...off, module_reports: true };
  assert.strictEqual(parentBackOn.sub_rep_price_reference, false, "child's own stored value must be untouched by the parent's change");
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_rep_price_reference", parentBackOn), false, "child remains OFF because its own bit is still off — correctly preserved");
  const childRestored = { ...parentBackOn, sub_rep_price_reference: true };
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_rep_price_reference", childRestored), true);
});

test("child OFF -> only that feature disabled, siblings unaffected (project-wide)", () => {
  const settings = { module_reconciliation: true, sub_recon_composite_assembly: false, sub_recon_master: true };
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_recon_composite_assembly", settings), false);
  assert.strictEqual(isFeatureEffectivelyEnabled("sub_recon_master", settings), true);
});

// ---------------- Defaults / NOT_IMPLEMENTED ----------------

test("every currently-approved IMPLEMENTED feature defaults to ON (preserves existing behavior)", () => {
  for (const def of FEATURE_REGISTRY) {
    if (def.implementation_status === "IMPLEMENTED" && def.feature_key !== "module_ai_insights" && def.feature_key !== "sync_auto_on_page_open" && def.feature_key !== "sync_historical_rescan") {
      assert.strictEqual(def.default_enabled, true, `${def.feature_key} is IMPLEMENTED and already-approved but does not default ON`);
    }
  }
});

test("Findings & Action Taken / Review Reports (Milestone D) are IMPLEMENTED and server-guarded, never masquerading as incomplete", () => {
  const findings = getFeatureDefinition("sub_audit_findings")!;
  const reports = getFeatureDefinition("sub_audit_reports")!;
  assert.strictEqual(findings.implementation_status, "IMPLEMENTED");
  assert.strictEqual(reports.implementation_status, "IMPLEMENTED");
  assert.strictEqual(findings.server_guard_required, true);
  assert.strictEqual(reports.server_guard_required, true);
});

// ---------------- No fake toggles ----------------

test("every ACTION-visibility feature that performs a real side effect is marked server_guard_required", () => {
  const actionFeatures = FEATURE_REGISTRY.filter((f) => f.visibility_type === "ACTION" && f.implementation_status === "IMPLEMENTED");
  for (const f of actionFeatures) {
    assert.ok(f.server_guard_required, `ACTION feature "${f.feature_key}" performs a real side effect but has no server guard requirement`);
  }
});

// ---------------- Meta-test: prove the completeness check actually fails when it should ----------------

test("registry-completeness assertion logic genuinely fails for a synthetic unregistered key (proves the test isn't a tautology)", () => {
  const registryKeys = new Set(FEATURE_REGISTRY.map((f) => f.feature_key));
  const syntheticSidebarKeys = [...extractSidebarFeatureKeys(), "feature_key_nobody_registered_yet"];
  const missing = syntheticSidebarKeys.filter((k) => !registryKeys.has(k));
  assert.deepStrictEqual(missing, ["feature_key_nobody_registered_yet"], "the completeness check must catch an unregistered key when one is present, and only that one");
});

// ---------------- Shared-route consumer matrix: static verification (no DB, no server) ----------------
// See PROJECT_FEATURE_CONTROLS.md's shared-route consumer matrix for the
// full reasoning. These tests confirm the source code actually contains
// the exclusive-branch gates the matrix says it does, and that they
// reference only real, registered feature keys — without executing the
// routes themselves (which would touch the production DB singleton).

test("/api/transactions declares exactly the 4 exclusive-type feature gates the consumer matrix requires, referencing only registered keys", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "app/api/transactions/route.ts"), "utf8");
  assert.ok(source.includes("EXCLUSIVE_TYPE_FEATURE"), "expected the exclusive-type feature gate table to exist in the route");
  const registryKeys = new Set(FEATURE_REGISTRY.map((f) => f.feature_key));
  for (const key of ["module_dashboard", "sub_trans_purchase_bills", "sub_trans_sales_invoices", "sub_trans_transaction_detail", "module_transactions"]) {
    assert.ok(source.includes(`"${key}"`), `expected route source to reference "${key}"`);
    assert.ok(registryKeys.has(key), `"${key}" referenced by the route guard is not a registered feature`);
  }
});

test("/api/inventory-mismatch and /api/reconciliation declare the 7 exclusive operationalTab feature gates, referencing only registered keys", () => {
  const registryKeys = new Set(FEATURE_REGISTRY.map((f) => f.feature_key));
  const exclusiveSubKeys = ["sub_recon_balance", "sub_recon_yet_to_purchase", "sub_recon_yet_to_sale", "sub_recon_purchase_only", "sub_recon_sale_only", "sub_recon_reconciled", "sub_recon_customer_missing"];
  for (const file of ["app/api/inventory-mismatch/route.ts", "app/api/reconciliation/route.ts"]) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    assert.ok(source.includes("EXCLUSIVE_OPERATIONAL_TAB_FEATURE"), `expected ${file} to declare the exclusive-operationalTab gate table`);
    for (const key of exclusiveSubKeys) {
      assert.ok(source.includes(`"${key}"`), `expected ${file} to reference "${key}"`);
      assert.ok(registryKeys.has(key), `"${key}" is not a registered feature`);
    }
  }
});

test("the genuinely-ambiguous shared branches (bill-detail/invoice-detail, ALL_MISMATCHES, classification=SERVICE) are NOT gated by a spoofable client-supplied feature-key parameter", () => {
  for (const file of ["app/api/transactions/route.ts", "app/api/inventory-mismatch/route.ts", "app/api/reconciliation/route.ts"]) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    // The only feature-key-shaped strings in these files must come from the
    // route's own hardcoded exclusive-mapping tables (verified above) or
    // requireFeaturesEnabled(...) calls with literal keys — never a
    // searchParams-derived value used directly as a feature key.
    assert.ok(!/requireFeaturesEnabled\(\s*searchParams/.test(source), `${file} must never pass a raw client-supplied query param straight into the feature guard`);
  }
});

console.log("\n==================================================");
console.log(`RESULTS: ${passedCount} passed, ${failedCount} failed`);
console.log("==================================================\n");
if (failedCount > 0) process.exit(1);
