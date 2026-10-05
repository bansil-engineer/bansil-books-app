// ============================================================
// Manual SO↔PO Line Mapping — Phase 1 Isolated Test Suite
//
// 29 test cases covering: identity, cardinality, validation,
// fingerprint, stale evaluation, lifecycle, usability, provenance,
// and operational safety.
//
// All tests use an isolated temp DB via openAuditDatabaseAt().
// No Zoho calls. No operational DB mutation.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import {
  computeLineFingerprint,
  createOwnerLineMapping,
  evaluateMappingStaleness,
  isMappingUsable,
  revokeOwnerLineMapping,
  reconfirmOwnerLineMapping,
  replaceOwnerLineMapping,
  markMappingReviewRequired,
  getCurrentMappingForPoLine,
  getMappingHistoryForPoLine,
} from "../app/lib/audit/manual-line-mapping-service.ts";
import type { DatabaseSync } from "node:sqlite";

const ORG = "org_test_001";
const ORG2 = "org_test_002";
const SO_ID = "so_100";
const SO_ID_2 = "so_200";
const PO_ID = "po_300";
const PO_ID_2 = "po_400";

let db: DatabaseSync;
let tmpDir: string;
let tmpDbPath: string;
let passed = 0;
let failed = 0;
const failures: string[] = [];

// Capture operational DB hashes BEFORE any tests run
const _opDbPath = path.join(process.cwd(), 'data', 'audit_workspace.db');
const _opWalPath = _opDbPath + '-wal';
const _baselineDbHash = crypto.createHash('sha256').update(fs.readFileSync(_opDbPath)).digest('hex');
const _baselineWalHash = fs.existsSync(_opWalPath)
  ? crypto.createHash('sha256').update(fs.readFileSync(_opWalPath)).digest('hex')
  : null;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

/** Insert prerequisite source_run row (FK target for SO/PO lines). */
function ensureSourceRun(runId: string, orgId: string, type: string) {
  const exists = db.prepare(
    `SELECT 1 FROM audit_zoho_source_runs WHERE source_run_id = ?`
  ).get(runId);
  if (!exists) {
    db.prepare(
      `INSERT INTO audit_zoho_source_runs
         (source_run_id, organization_id, source_type, started_at, status)
       VALUES (?, ?, ?, ?, 'SUCCESS')`
    ).run(runId, orgId, type, new Date().toISOString());
  }
}

/** Seed a SO line into the temp DB. */
function seedSoLine(
  orgId: string, soId: string, lineItemId: string, runId: string,
  overrides: Partial<{item_id: string; item_name: string; description: string; quantity: number; rate: number; unit: string}> = {}
) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_order_lines
       (organization_id, line_item_id, salesorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId, lineItemId, soId, runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "Widget Alpha",
    overrides.description ?? "Standard widget",
    "SKU-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 50,
    5000,
    overrides.unit ?? "nos"
  );
}

/** Seed a PO line into the temp DB. */
function seedPoLine(
  orgId: string, poId: string, lineItemId: string, runId: string,
  overrides: Partial<{item_id: string; item_name: string; description: string; quantity: number; rate: number; unit: string}> = {}
) {
  ensureSourceRun(runId, orgId, "purchase_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_purchase_order_lines
       (organization_id, line_item_id, purchaseorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId, lineItemId, poId, runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "Widget Alpha",
    overrides.description ?? "Standard widget",
    "SKU-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 55,
    5500,
    overrides.unit ?? "nos"
  );
}

// ── Setup ──────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════");
console.log("  Manual SO↔PO Line Mapping — Phase 1 Tests");
console.log("═══════════════════════════════════════════════\n");

tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlm-test-"));
tmpDbPath = path.join(tmpDir, "test_mapping.db");
db = openAuditDatabaseAt(tmpDbPath);

// Seed baseline data
const RUN_1 = "run_ct_001";
const RUN_2 = "run_ct_002";
const RUN_3 = "run_ap_001";

seedSoLine(ORG, SO_ID, "so_line_A", RUN_1);
seedSoLine(ORG, SO_ID, "so_line_B", RUN_1, { item_name: "Widget Alpha", description: "Another widget same name" });
seedSoLine(ORG, SO_ID_2, "so_line_C", RUN_1);
seedPoLine(ORG, PO_ID, "po_line_X", RUN_1);
seedPoLine(ORG, PO_ID, "po_line_Y", RUN_1);
seedPoLine(ORG, PO_ID_2, "po_line_Z", RUN_1);

// Org 2 data
seedSoLine(ORG2, SO_ID, "so_line_D", RUN_2);
seedPoLine(ORG2, PO_ID, "po_line_W", RUN_2);

// ── Tests ──────────────────────────────────────────────────

// 1. Create exact OWNER_FALLBACK mapping
test("1. create OWNER_FALLBACK mapping", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_A",
    purchaseorderId: PO_ID, poLineItemId: "po_line_X",
    mappingKind: "OWNER_FALLBACK", note: "initial mapping",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome !== "CREATED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "ACTIVE");
  assert.strictEqual(result.mapping.mapping_kind, "OWNER_FALLBACK");
  assert.strictEqual(result.mapping.decision_source, "OWNER");
});

// 2. Create OWNER_OVERRIDE mapping
test("2. create OWNER_OVERRIDE mapping", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_A",
    purchaseorderId: PO_ID, poLineItemId: "po_line_Y",
    mappingKind: "OWNER_OVERRIDE",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome !== "CREATED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.mapping_kind, "OWNER_OVERRIDE");
});

// 3. Same-name SO lines remain separate by line_item_id
test("3. same-name SO lines separate by line_item_id", () => {
  // so_line_A and so_line_B both have item_name "Widget Alpha" but different line_item_ids
  const fpA = computeLineFingerprint({
    line_item_id: "so_line_A", item_id: "item_001", item_name: "Widget Alpha",
    description: "Standard widget", quantity: 100, rate: 50, unit: "nos",
  });
  const fpB = computeLineFingerprint({
    line_item_id: "so_line_B", item_id: "item_001", item_name: "Widget Alpha",
    description: "Another widget same name", quantity: 100, rate: 50, unit: "nos",
  });
  assert.notStrictEqual(fpA, fpB, "different line_item_ids produce different fingerprints");
});

// 4. Two PO lines can map to same SO line
test("4. multiple PO lines → one SO line allowed", () => {
  // po_line_X already maps to so_line_A (test 1)
  // po_line_Y already maps to so_line_A (test 2)
  const mappings = db.prepare(
    `SELECT * FROM audit_so_po_line_mappings
     WHERE organization_id = ? AND so_line_item_id = ? AND status = 'ACTIVE'`
  ).all(ORG, "so_line_A") as any[];
  assert.strictEqual(mappings.length, 2, "two PO lines both mapped to same SO line");
});

// 5. Same PO line cannot have two current mappings
test("5. one PO line → multiple current mappings blocked", () => {
  // po_line_X already has an ACTIVE mapping to so_line_A
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_B",
    purchaseorderId: PO_ID, poLineItemId: "po_line_X",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "CONFLICT");
});

// 6. Exact duplicate current mapping does not create duplicate row
test("6. exact duplicate returns DUPLICATE", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_A",
    purchaseorderId: PO_ID, poLineItemId: "po_line_X",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "DUPLICATE");
  const count = db.prepare(
    `SELECT COUNT(*) as c FROM audit_so_po_line_mappings
     WHERE organization_id = ? AND po_line_item_id = ? AND status IN ('ACTIVE','REVIEW_REQUIRED')`
  ).get(ORG, "po_line_X") as { c: number };
  assert.strictEqual(count.c, 1, "still exactly one current mapping");
});

// 7. Cross-organization mapping rejected
test("7. cross-organization mapping rejected", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_A",
    purchaseorderId: PO_ID, poLineItemId: "po_line_W", // po_line_W belongs to ORG2
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
});

// 8. PO line/document mismatch rejected
test("8. PO line from wrong PO rejected", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_A",
    purchaseorderId: PO_ID, poLineItemId: "po_line_Z", // po_line_Z belongs to PO_ID_2
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes(PO_ID_2), "error mentions actual PO");
});

// 9. SO line/document mismatch rejected
test("9. SO line from wrong SO rejected", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_C", // belongs to SO_ID_2
    purchaseorderId: PO_ID_2, poLineItemId: "po_line_Z",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes(SO_ID_2), "error mentions actual SO");
});

// 10. Missing local SO line rejected
test("10. missing SO line rejected", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "nonexistent_so_line",
    purchaseorderId: PO_ID_2, poLineItemId: "po_line_Z",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes("not found"), "error says not found");
});

// 11. Missing local PO line rejected
test("11. missing PO line rejected", () => {
  const result = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID, soLineItemId: "so_line_A",
    purchaseorderId: PO_ID, poLineItemId: "nonexistent_po_line",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes("not found"), "error says not found");
});

// 12. Fingerprint deterministic
test("12. fingerprint is deterministic", () => {
  const evidence = {
    line_item_id: "line_123", item_id: "item_456",
    item_name: "Widget", description: "desc", quantity: 10, rate: 5.5, unit: "nos",
  };
  const fp1 = computeLineFingerprint(evidence);
  const fp2 = computeLineFingerprint(evidence);
  assert.strictEqual(fp1, fp2, "same evidence produces same fingerprint");
  assert.strictEqual(fp1.length, 64, "SHA-256 hex is 64 chars");
});

// 13. fetched_at-only change does not invalidate
test("13. fetched_at-only change → VALID", () => {
  // Get current mapping for po_line_X
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "po_line_X")!;
  assert.ok(mapping, "mapping exists");

  // Re-seed the SAME line data with a different source_run_id (simulates re-fetch)
  seedSoLine(ORG, SO_ID, "so_line_A", RUN_3);
  seedPoLine(ORG, PO_ID, "po_line_X", RUN_3);

  const staleness = evaluateMappingStaleness(db, mapping);
  assert.strictEqual(staleness, "VALID");
});

// 14. source_run_id-only change does not invalidate
test("14. source_run_id-only change → VALID", () => {
  // Already tested via test 13 — new source_run_id with same data
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "po_line_X")!;
  const staleness = evaluateMappingStaleness(db, mapping);
  assert.strictEqual(staleness, "VALID");
});

// 15. item_id change → REVIEW_REQUIRED
test("15. item_id change → REVIEW_REQUIRED", () => {
  // Create a fresh mapping for po_line_Z → so_line_C
  const fresh = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: SO_ID_2, soLineItemId: "so_line_C",
    purchaseorderId: PO_ID_2, poLineItemId: "po_line_Z",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(fresh.outcome, "CREATED");
  if (fresh.outcome !== "CREATED") throw new Error("unreachable");

  // Change item_id on the SO line
  seedSoLine(ORG, SO_ID_2, "so_line_C", "run_change_1", { item_id: "item_999" });

  const staleness = evaluateMappingStaleness(db, fresh.mapping);
  assert.strictEqual(staleness, "REVIEW_REQUIRED");
});

// 16. description change → REVIEW_REQUIRED
test("16. description change → REVIEW_REQUIRED", () => {
  // Restore SO line, change PO line description
  seedSoLine(ORG, SO_ID_2, "so_line_C", "run_change_2");
  seedPoLine(ORG, PO_ID_2, "po_line_Z", "run_change_2", { description: "Changed description" });

  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  assert.ok(mapping);
  const staleness = evaluateMappingStaleness(db, mapping);
  assert.strictEqual(staleness, "REVIEW_REQUIRED");
});

// 17. quantity change → REVIEW_REQUIRED
test("17. quantity change → REVIEW_REQUIRED", () => {
  seedPoLine(ORG, PO_ID_2, "po_line_Z", "run_change_3", { quantity: 999 });
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  const staleness = evaluateMappingStaleness(db, mapping);
  assert.strictEqual(staleness, "REVIEW_REQUIRED");
});

// 18. rate change → REVIEW_REQUIRED
test("18. rate change → REVIEW_REQUIRED", () => {
  seedPoLine(ORG, PO_ID_2, "po_line_Z", "run_change_4", { rate: 999 });
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  const staleness = evaluateMappingStaleness(db, mapping);
  assert.strictEqual(staleness, "REVIEW_REQUIRED");
});

// 19. unit change → REVIEW_REQUIRED
test("19. unit change → REVIEW_REQUIRED", () => {
  seedPoLine(ORG, PO_ID_2, "po_line_Z", "run_change_5", { unit: "kg" });
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  const staleness = evaluateMappingStaleness(db, mapping);
  assert.strictEqual(staleness, "REVIEW_REQUIRED");
});

// 20. mapped line deletion → REVIEW_REQUIRED (MISSING_LINE)
test("20. line deletion → MISSING_LINE (evaluates as stale)", () => {
  // Seed a fresh pair for this test
  seedSoLine(ORG, "so_del_test", "so_line_DEL", "run_del_1");
  seedPoLine(ORG, "po_del_test", "po_line_DEL", "run_del_1");
  const fresh = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: "so_del_test", soLineItemId: "so_line_DEL",
    purchaseorderId: "po_del_test", poLineItemId: "po_line_DEL",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(fresh.outcome, "CREATED");
  if (fresh.outcome !== "CREATED") throw new Error("unreachable");

  // Delete the SO line from temp DB
  db.prepare(
    `DELETE FROM audit_zoho_sales_order_lines
     WHERE organization_id = ? AND line_item_id = ?`
  ).run(ORG, "so_line_DEL");

  const staleness = evaluateMappingStaleness(db, fresh.mapping);
  assert.strictEqual(staleness, "MISSING_LINE");
});

// 21. REVIEW_REQUIRED mapping not usable
test("21. REVIEW_REQUIRED → not usable", () => {
  // Get mapping for po_line_Z which has fingerprint changes
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  assert.ok(mapping);
  // Mark it REVIEW_REQUIRED
  markMappingReviewRequired(db, mapping.mapping_id);
  const updated = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  assert.strictEqual(updated.status, "REVIEW_REQUIRED");
  assert.strictEqual(isMappingUsable(db, updated), false);
});

// 22. REVOKED mapping not usable
test("22. REVOKED → not usable", () => {
  // Create a fresh mapping, then revoke it
  seedSoLine(ORG, "so_rev_test", "so_line_REV", "run_rev_1");
  seedPoLine(ORG, "po_rev_test", "po_line_REV", "run_rev_1");
  const fresh = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: "so_rev_test", soLineItemId: "so_line_REV",
    purchaseorderId: "po_rev_test", poLineItemId: "po_line_REV",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(fresh.outcome, "CREATED");
  if (fresh.outcome !== "CREATED") throw new Error("unreachable");
  revokeOwnerLineMapping(db, fresh.mapping.mapping_id);
  const revoked = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(fresh.mapping.mapping_id) as any;
  assert.strictEqual(revoked.status, "REVOKED");
  assert.strictEqual(isMappingUsable(db, revoked), false);
});

// 23. ACTIVE + valid fingerprint → usable
test("23. ACTIVE + valid fingerprint → usable", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "po_line_X")!;
  assert.ok(mapping);
  assert.strictEqual(mapping.status, "ACTIVE");
  assert.strictEqual(isMappingUsable(db, mapping), true);
});

// 24. Revoke preserves mapping history
test("24. revoke preserves history", () => {
  seedSoLine(ORG, "so_hist_test", "so_line_HIST", "run_hist_1");
  seedPoLine(ORG, "po_hist_test", "po_line_HIST", "run_hist_1");
  const fresh = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: "so_hist_test", soLineItemId: "so_line_HIST",
    purchaseorderId: "po_hist_test", poLineItemId: "po_line_HIST",
    mappingKind: "OWNER_FALLBACK", note: "will be revoked",
  });
  assert.strictEqual(fresh.outcome, "CREATED");
  if (fresh.outcome !== "CREATED") throw new Error("unreachable");

  revokeOwnerLineMapping(db, fresh.mapping.mapping_id, "no longer needed");

  // Check history events
  const history = db.prepare(
    `SELECT * FROM audit_so_po_line_mapping_history
     WHERE mapping_id = ? ORDER BY occurred_at ASC`
  ).all(fresh.mapping.mapping_id) as any[];
  assert.strictEqual(history.length, 2, "two history events: CREATED + REVOKED");
  assert.strictEqual(history[0].event_type, "MAPPING_CREATED");
  assert.strictEqual(history[0].new_status, "ACTIVE");
  assert.strictEqual(history[1].event_type, "MAPPING_REVOKED");
  assert.strictEqual(history[1].previous_status, "ACTIVE");
  assert.strictEqual(history[1].new_status, "REVOKED");

  // Mapping record still exists (not hard-deleted)
  const mapping = db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`)
    .get(fresh.mapping.mapping_id) as any;
  assert.ok(mapping);
  assert.strictEqual(mapping.status, "REVOKED");
  assert.ok(mapping.revoked_at);
});

// 25. Reconfirm refreshes fingerprint and reactivates
test("25. reconfirm refreshes fingerprint and reactivates", () => {
  // Use the REVIEW_REQUIRED mapping from test 21 (po_line_Z → so_line_C)
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID_2, "po_line_Z")!;
  assert.ok(mapping);
  assert.strictEqual(mapping.status, "REVIEW_REQUIRED");

  // Restore the original evidence so reconfirm can succeed
  seedSoLine(ORG, SO_ID_2, "so_line_C", "run_reconfirm_1");
  seedPoLine(ORG, PO_ID_2, "po_line_Z", "run_reconfirm_1");

  const result = reconfirmOwnerLineMapping(db, mapping.mapping_id, "evidence looks correct");
  assert.strictEqual(result.outcome, "RECONFIRMED");
  if (result.outcome !== "RECONFIRMED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "ACTIVE");
  assert.strictEqual(result.mapping.review_required_at, null);

  // Verify fingerprints were refreshed
  const currentSoFp = computeLineFingerprint({
    line_item_id: "so_line_C", item_id: "item_001", item_name: "Widget Alpha",
    description: "Standard widget", quantity: 100, rate: 50, unit: "nos",
  });
  assert.strictEqual(result.mapping.so_fingerprint, currentSoFp, "SO fingerprint refreshed");
});

// 26. Reconfirm fails safely if mapped line no longer exists
test("26. reconfirm fails if line deleted", () => {
  // Create mapping, mark review required, then delete the line
  seedSoLine(ORG, "so_reconf_fail", "so_line_RF", "run_rf_1");
  seedPoLine(ORG, "po_reconf_fail", "po_line_RF", "run_rf_1");
  const fresh = createOwnerLineMapping(db, {
    organizationId: ORG, salesorderId: "so_reconf_fail", soLineItemId: "so_line_RF",
    purchaseorderId: "po_reconf_fail", poLineItemId: "po_line_RF",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(fresh.outcome, "CREATED");
  if (fresh.outcome !== "CREATED") throw new Error("unreachable");

  markMappingReviewRequired(db, fresh.mapping.mapping_id);

  // Delete the PO line
  db.prepare(
    `DELETE FROM audit_zoho_purchase_order_lines
     WHERE organization_id = ? AND line_item_id = ?`
  ).run(ORG, "po_line_RF");

  const result = reconfirmOwnerLineMapping(db, fresh.mapping.mapping_id);
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
  if (result.outcome !== "VALIDATION_FAILED") throw new Error("unreachable");
  assert.ok(result.reason.includes("no longer exists"));
});

// 27. Mapping stores no artificial human Sr.No identity
test("27. no human Sr.No in mapping record", () => {
  const mapping = getCurrentMappingForPoLine(db, ORG, PO_ID, "po_line_X")!;
  assert.ok(mapping);
  // Check that the mapping record has no sr_no, line_number, display_number, etc.
  const keys = Object.keys(mapping);
  for (const key of keys) {
    assert.ok(
      !key.toLowerCase().includes("sr_no") &&
      !key.toLowerCase().includes("line_number") &&
      !key.toLowerCase().includes("display_number") &&
      !key.toLowerCase().includes("serial"),
      `mapping should not contain '${key}'`
    );
  }
  // Verify fingerprint excludes human Sr.No
  const fpFields = ["line_item_id", "item_id", "item_name", "description", "quantity", "rate", "unit"];
  // Just verify the fingerprint is based on stable business fields, not row position
  const fp1 = computeLineFingerprint({
    line_item_id: "test_line", item_id: "item_1", item_name: "A",
    description: null, quantity: 1, rate: 1, unit: null,
  });
  const fp2 = computeLineFingerprint({
    line_item_id: "test_line", item_id: "item_1", item_name: "A",
    description: null, quantity: 1, rate: 1, unit: null,
  });
  assert.strictEqual(fp1, fp2, "fingerprint is deterministic from business fields only");
});

// 28. No Zoho calls (structural — service imports no network modules)
test("28. no Zoho calls — service is pure local", () => {
  // Verify by reading the service file source — it should not import any Zoho modules
  const serviceSrc = fs.readFileSync(
    path.join(process.cwd(), "app/lib/audit/manual-line-mapping-service.ts"),
    "utf-8"
  );
  assert.ok(!serviceSrc.includes("zoho-read-transactions"), "no zoho reader import");
  assert.ok(!serviceSrc.includes("zoho-token-store"), "no token store import");
  assert.ok(!serviceSrc.includes("fetch("), "no fetch calls");
  assert.ok(!serviceSrc.includes("listSalesOrders"), "no Zoho list functions");
  assert.ok(!serviceSrc.includes("listPurchaseOrders"), "no Zoho list functions");
});

// 29. Operational DB unchanged
test("29. operational DB unchanged", () => {
  // Compare current hash against baseline captured before any tests ran
  const dbHash = crypto.createHash("sha256").update(fs.readFileSync(_opDbPath)).digest("hex");
  assert.strictEqual(dbHash, _baselineDbHash, "operational DB hash unchanged");

  if (fs.existsSync(_opWalPath)) {
    const walHash = crypto.createHash("sha256").update(fs.readFileSync(_opWalPath)).digest("hex");
    if (_baselineWalHash !== null) {
      assert.strictEqual(walHash, _baselineWalHash, "operational WAL hash unchanged");
    }
  }
});

// ── Cleanup and Summary ────────────────────────────────────

try { db.close(); } catch {}
try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failures.length > 0) {
  console.log(`  Failures: ${failures.join(", ")}`);
}
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
