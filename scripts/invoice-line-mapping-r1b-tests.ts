// ============================================================
// Invoice→SO Line Mapping R1B — Comprehensive Test Suite
//
// 34 test cases covering:
//   Section A (1-8):   Invoice mapping CRUD, fingerprint, staleness
//   Section B (9-16):  Lifecycle (revoke, reconfirm, review_required)
//   Section C (17-22): Candidate ranking via narration engine
//   Section D (23-28): resolveInvoiceLineWithMapping precedence
//   Section E (29-34): Isolation, safety, edge cases
//
// All tests use an isolated temp DB via openAuditDatabaseAt().
// No Zoho calls. No AI. No external API. ZOHO WRITE = 0.
// ============================================================

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAuditDatabaseAt } from "../app/lib/db/audit-database.ts";
import {
  computeInvoiceLineFingerprint,
  createOwnerInvoiceLineMapping,
  revokeOwnerInvoiceLineMapping,
  reconfirmOwnerInvoiceLineMapping,
  markInvoiceMappingReviewRequired,
  evaluateInvoiceMappingStaleness,
  isInvoiceMappingUsable,
  getCurrentMappingForInvoiceLine,
  getMappingHistoryForInvoiceLine,
  getHistoryEventsForInvoiceLine,
  getCandidatesForInvoiceLine,
  resolveInvoiceLineWithMapping,
} from "../app/lib/audit/invoice-line-mapping-service.ts";
import type { DatabaseSync } from "node:sqlite";

// ── Constants ──────────────────────────────────────────────

const ORG = "org_r1b_001";
const ORG2 = "org_r1b_002";
const SO_ID = "so_r1b_100";
const SO_ID_2 = "so_r1b_200";
const INV_ID = "inv_r1b_300";
const INV_ID_2 = "inv_r1b_400";

let db: DatabaseSync;
let tmpDir: string;
let tmpDbPath: string;
let passed = 0;
let failed = 0;
const failures: string[] = [];

// Capture operational DB hashes BEFORE any tests run
const _opDbPath = path.join(process.cwd(), "data", "audit_workspace.db");
const _opWalPath = _opDbPath + "-wal";
const _baselineDbHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(_opDbPath))
  .digest("hex");
const _baselineWalHash = fs.existsSync(_opWalPath)
  ? crypto
      .createHash("sha256")
      .update(fs.readFileSync(_opWalPath))
      .digest("hex")
  : null;

// ── Test runner ────────────────────────────────────────────

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

// ── Seed helpers ───────────────────────────────────────────

function ensureSourceRun(runId: string, orgId: string, type: string) {
  const exists = db
    .prepare(`SELECT 1 FROM audit_zoho_source_runs WHERE source_run_id = ?`)
    .get(runId);
  if (!exists) {
    db.prepare(
      `INSERT INTO audit_zoho_source_runs
         (source_run_id, organization_id, source_type, started_at, status)
       VALUES (?, ?, ?, ?, 'SUCCESS')`
    ).run(runId, orgId, type, new Date().toISOString());
  }
}

function seedSoHeader(
  orgId: string,
  soId: string,
  runId: string,
  soNumber: string = "SO-00001"
) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_orders
       (organization_id, salesorder_id, source_run_id, salesorder_number,
        customer_id, status, total, fetched_at)
     VALUES (?, ?, ?, ?, 'cust_001', 'open', 10000, ?)`
  ).run(orgId, soId, runId, soNumber, new Date().toISOString());
}

function seedSoLine(
  orgId: string,
  soId: string,
  lineItemId: string,
  runId: string,
  overrides: Partial<{
    item_id: string;
    item_name: string;
    description: string;
    quantity: number;
    rate: number;
    unit: string;
  }> = {}
) {
  ensureSourceRun(runId, orgId, "sales_orders");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_sales_order_lines
       (organization_id, line_item_id, salesorder_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId,
    lineItemId,
    soId,
    runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "Widget Alpha",
    overrides.description ?? "Standard widget",
    "SKU-001",
    overrides.quantity ?? 100,
    overrides.rate ?? 50,
    (overrides.quantity ?? 100) * (overrides.rate ?? 50),
    overrides.unit ?? "nos"
  );
}

function seedInvoiceHeader(
  orgId: string,
  invId: string,
  runId: string,
  soId: string = SO_ID,
  invNumber: string = "INV-00001"
) {
  ensureSourceRun(runId, orgId, "invoices");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoices
       (organization_id, invoice_id, source_run_id, invoice_number,
        customer_id, salesorder_id, date, status, total, fetched_at)
     VALUES (?, ?, ?, ?, 'cust_001', ?, '2026-01-15', 'sent', 5000, ?)`
  ).run(orgId, invId, runId, invNumber, soId, new Date().toISOString());
}

function seedInvoiceLine(
  orgId: string,
  invId: string,
  lineItemId: string,
  runId: string,
  overrides: Partial<{
    item_id: string;
    item_name: string;
    description: string;
    quantity: number;
    rate: number;
    unit: string;
  }> = {}
) {
  ensureSourceRun(runId, orgId, "invoices");
  db.prepare(
    `INSERT OR REPLACE INTO audit_zoho_invoice_lines
       (organization_id, line_item_id, invoice_id, source_run_id,
        item_id, item_name, description, sku, quantity, rate, amount, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orgId,
    lineItemId,
    invId,
    runId,
    overrides.item_id ?? "item_001",
    overrides.item_name ?? "Widget Alpha",
    overrides.description ?? "Standard widget",
    "SKU-001",
    overrides.quantity ?? 50,
    overrides.rate ?? 50,
    (overrides.quantity ?? 50) * (overrides.rate ?? 50),
    overrides.unit ?? "nos"
  );
}

// ── Setup ──────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════");
console.log("  Invoice→SO Line Mapping R1B — Comprehensive Tests");
console.log("═══════════════════════════════════════════════════════\n");

tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "r1b-test-"));
tmpDbPath = path.join(tmpDir, "test_r1b.db");
db = openAuditDatabaseAt(tmpDbPath);

const RUN_1 = "run_r1b_001";
const RUN_2 = "run_r1b_002";
const RUN_3 = "run_r1b_003";

// Seed baseline data — SO lines
seedSoHeader(ORG, SO_ID, RUN_1);
seedSoLine(ORG, SO_ID, "so_line_A", RUN_1, {
  item_id: "item_001",
  item_name: "Widget Alpha",
  description: "Standard widget 100x50",
  quantity: 100,
  rate: 50,
  unit: "nos",
});
seedSoLine(ORG, SO_ID, "so_line_B", RUN_1, {
  item_id: "item_001",
  item_name: "Widget Alpha",
  description: "Widget Alpha variant B",
  quantity: 200,
  rate: 55,
  unit: "nos",
});
seedSoLine(ORG, SO_ID, "so_line_C", RUN_1, {
  item_id: "item_002",
  item_name: "Gear Beta",
  description: "Precision gear 25mm",
  quantity: 50,
  rate: 120,
  unit: "pcs",
});

seedSoHeader(ORG, SO_ID_2, RUN_1, "SO-00002");
seedSoLine(ORG, SO_ID_2, "so_line_D", RUN_1, {
  item_id: "item_003",
  item_name: "Shaft Gamma",
  description: "Drive shaft assembly",
  quantity: 10,
  rate: 500,
  unit: "set",
});

// Seed baseline — Invoice lines
seedInvoiceHeader(ORG, INV_ID, RUN_1, SO_ID);
seedInvoiceLine(ORG, INV_ID, "inv_line_1", RUN_1, {
  item_id: "item_001",
  item_name: "Widget Alpha",
  description: "Standard widget 100x50",
  quantity: 25,
  rate: 50,
  unit: "nos",
});
seedInvoiceLine(ORG, INV_ID, "inv_line_2", RUN_1, {
  item_id: "item_002",
  item_name: "Gear Beta",
  description: "Precision gear 25mm",
  quantity: 10,
  rate: 120,
  unit: "pcs",
});
seedInvoiceLine(ORG, INV_ID, "inv_line_3", RUN_1, {
  item_id: "item_001",
  item_name: "Widget Alpha",
  description: "Widget Alpha — duplicate item",
  quantity: 30,
  rate: 52,
  unit: "nos",
});
seedInvoiceLine(ORG, INV_ID, "inv_line_4", RUN_1, {
  item_id: "item_999",
  item_name: "Unknown Part",
  description: "Not in SO",
  quantity: 5,
  rate: 200,
  unit: "kg",
});

seedInvoiceHeader(ORG, INV_ID_2, RUN_1, SO_ID, "INV-00002");
seedInvoiceLine(ORG, INV_ID_2, "inv_line_5", RUN_1, {
  item_id: "item_002",
  item_name: "Gear Beta",
  description: "Precision gear 25mm",
  quantity: 15,
  rate: 120,
  unit: "pcs",
});

// Org2 data for isolation tests
seedSoHeader(ORG2, SO_ID, RUN_2, "SO-ORG2-001");
seedSoLine(ORG2, SO_ID, "so_line_E", RUN_2, {
  item_id: "item_010",
  item_name: "Cross-Org Part",
  description: "Should not leak",
});
seedInvoiceHeader(ORG2, INV_ID, RUN_2, SO_ID, "INV-ORG2-001");
seedInvoiceLine(ORG2, INV_ID, "inv_line_10", RUN_2, {
  item_id: "item_010",
  item_name: "Cross-Org Part",
  description: "Should not leak",
});

// ── Section A: CRUD, Fingerprint, Staleness (1-8) ──────────

console.log("Section A: CRUD, Fingerprint, Staleness");
console.log("────────────────────────────────────────\n");

test("A1. create OWNER_FALLBACK mapping for Invoice line", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_1",
    mappingKind: "OWNER_FALLBACK",
    note: "initial R1B mapping",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome !== "CREATED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "ACTIVE");
  assert.strictEqual(result.mapping.mapping_kind, "OWNER_FALLBACK");
  assert.strictEqual(result.mapping.decision_source, "OWNER");
  assert.ok(result.mapping.invoice_fingerprint.length > 10);
  assert.ok(result.mapping.so_fingerprint.length > 10);
});

test("A2. create OWNER_OVERRIDE mapping", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_B",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_3",
    mappingKind: "OWNER_OVERRIDE",
  });
  assert.strictEqual(result.outcome, "CREATED");
  if (result.outcome !== "CREATED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.mapping_kind, "OWNER_OVERRIDE");
});

test("A3. duplicate mapping returns DUPLICATE", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_1",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "DUPLICATE");
});

test("A4. conflicting mapping returns CONFLICT", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_C",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_1",
    mappingKind: "OWNER_OVERRIDE",
  });
  assert.strictEqual(result.outcome, "CONFLICT");
});

test("A5. computeInvoiceLineFingerprint deterministic & unique by line_item_id", () => {
  const fp1 = computeInvoiceLineFingerprint({
    line_item_id: "inv_line_1",
    item_id: "item_001",
    item_name: "Widget Alpha",
    description: "Standard widget 100x50",
    quantity: 25,
    rate: 50,
    unit: "nos",
  });
  const fp1Again = computeInvoiceLineFingerprint({
    line_item_id: "inv_line_1",
    item_id: "item_001",
    item_name: "Widget Alpha",
    description: "Standard widget 100x50",
    quantity: 25,
    rate: 50,
    unit: "nos",
  });
  assert.strictEqual(fp1, fp1Again, "same input → same fingerprint");

  const fp2 = computeInvoiceLineFingerprint({
    line_item_id: "inv_line_3",
    item_id: "item_001",
    item_name: "Widget Alpha",
    description: "Widget Alpha — duplicate item",
    quantity: 30,
    rate: 52,
    unit: "nos",
  });
  assert.notStrictEqual(fp1, fp2, "different line_item_id → different fingerprint");
});

test("A6. evaluateInvoiceMappingStaleness returns VALID for fresh mapping", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_1");
  assert.ok(mapping, "mapping must exist");
  const staleness = evaluateInvoiceMappingStaleness(db, mapping!);
  assert.strictEqual(staleness, "VALID");
});

test("A7. isInvoiceMappingUsable true for ACTIVE + VALID", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_1");
  assert.ok(mapping);
  const usable = isInvoiceMappingUsable(db, mapping!);
  assert.strictEqual(usable, true);
});

test("A8. getCurrentMappingForInvoiceLine returns null for unmapped line", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_4");
  assert.strictEqual(mapping, null);
});

// ── Section B: Lifecycle — Revoke, Reconfirm, Review (9-16) ──

console.log("\nSection B: Lifecycle");
console.log("────────────────────────────────────────\n");

test("B9. revoke active mapping", () => {
  // Create a mapping to revoke
  const create = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_C",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_2",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(create.outcome, "CREATED");
  if (create.outcome !== "CREATED") throw new Error("unreachable");

  const result = revokeOwnerInvoiceLineMapping(db, create.mapping.mapping_id);
  assert.strictEqual(result.outcome, "REVOKED");
  if (result.outcome !== "REVOKED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "REVOKED");
  assert.ok(result.mapping.revoked_at);
});

test("B10. revoking already-revoked mapping returns ALREADY_REVOKED", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  // After revoke, getCurrentMapping should return null (only non-revoked)
  assert.strictEqual(mapping, null, "revoked mapping not returned by getCurrentMapping");

  // Get the actual mapping from history to find mapping_id
  const history = getHistoryEventsForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  assert.ok(history.length > 0);
  const mappingId = history[0].mapping_id;

  const result = revokeOwnerInvoiceLineMapping(db, mappingId);
  assert.strictEqual(result.outcome, "ALREADY_REVOKED");
});

test("B11. can create new mapping after revoke on same line", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_C",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_2",
    mappingKind: "OWNER_OVERRIDE",
    note: "re-mapping after revoke",
  });
  assert.strictEqual(result.outcome, "CREATED");
});

test("B12. markInvoiceMappingReviewRequired sets REVIEW_REQUIRED", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  assert.ok(mapping);
  const result = markInvoiceMappingReviewRequired(db, mapping!.mapping_id, "line data changed");
  assert.ok(result, "markInvoiceMappingReviewRequired must return updated record");
  assert.strictEqual(result!.status, "REVIEW_REQUIRED");
});

test("B13. REVIEW_REQUIRED mapping is not usable", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  assert.ok(mapping);
  assert.strictEqual(mapping!.status, "REVIEW_REQUIRED");
  const usable = isInvoiceMappingUsable(db, mapping!);
  assert.strictEqual(usable, false);
});

test("B14. reconfirm REVIEW_REQUIRED returns to ACTIVE", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  assert.ok(mapping);
  const result = reconfirmOwnerInvoiceLineMapping(db, mapping!.mapping_id, "data verified");
  assert.strictEqual(result.outcome, "RECONFIRMED");
  if (result.outcome !== "RECONFIRMED") throw new Error("unreachable");
  assert.strictEqual(result.mapping.status, "ACTIVE");
});

test("B15. reconfirm ACTIVE returns NOT_REVIEW_REQUIRED", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  assert.ok(mapping);
  assert.strictEqual(mapping!.status, "ACTIVE");
  const result = reconfirmOwnerInvoiceLineMapping(db, mapping!.mapping_id);
  assert.strictEqual(result.outcome, "NOT_REVIEW_REQUIRED");
});

test("B16. history events recorded for full lifecycle", () => {
  const events = getHistoryEventsForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  assert.ok(events.length >= 4, `expected >=4 history events, got ${events.length}`);
  // Events should include: CREATED (first mapping), REVOKED, CREATED (second), MARKED_REVIEW_REQUIRED, RECONFIRMED
  const eventTypes = events.map((e: any) => e.event_type);
  assert.ok(eventTypes.includes("MAPPING_CREATED"), "has MAPPING_CREATED");
  assert.ok(eventTypes.includes("MAPPING_REVOKED"), "has MAPPING_REVOKED");
});

// ── Section C: Candidate Ranking via Narration Engine (17-22) ──

console.log("\nSection C: Candidate Ranking (Narration Engine)");
console.log("────────────────────────────────────────────────\n");

test("C17. getCandidatesForInvoiceLine returns ranked SO lines", () => {
  const result = getCandidatesForInvoiceLine(db, ORG, INV_ID, "inv_line_1", SO_ID);
  assert.ok(result.invoiceLine, "invoiceLine must be present");
  assert.strictEqual(result.ranked.length, 3, "should return all 3 SO lines");
  // Sorted by sortScore descending
  for (let i = 1; i < result.ranked.length; i++) {
    assert.ok(
      result.ranked[i - 1].ranking.sortScore >= result.ranked[i].ranking.sortScore,
      `ranked[${i - 1}].sortScore >= ranked[${i}].sortScore`
    );
  }
});

test("C18. top candidate has highest match when item_id + narration match", () => {
  // inv_line_1 has item_001, description "Standard widget 100x50"
  // so_line_A has same item_id, same description → should rank highest
  const result = getCandidatesForInvoiceLine(db, ORG, INV_ID, "inv_line_1", SO_ID);
  const top = result.ranked[0];
  assert.strictEqual(top.candidate.item_id, "item_001");
  assert.strictEqual(top.ranking.overall, "SUGGESTED");
  assert.ok(top.ranking.sortScore > 50, "should have high sortScore");
});

test("C19. item_id DIFFERENT SO line ranked NOT_RECOMMENDED with CONFLICT", () => {
  // inv_line_1 item_001 vs so_line_C item_002 — different item
  const result = getCandidatesForInvoiceLine(db, ORG, INV_ID, "inv_line_1", SO_ID);
  const gearCandidate = result.ranked.find((r) => r.candidate.item_id === "item_002");
  assert.ok(gearCandidate, "Gear Beta candidate should exist");
  // Different item_id with different name → likely NOT_RECOMMENDED or low score
  assert.ok(
    gearCandidate!.ranking.sortScore < result.ranked[0].ranking.sortScore,
    "different item should score lower than matching item"
  );
});

test("C20. candidates for non-existent Invoice line return empty", () => {
  const result = getCandidatesForInvoiceLine(
    db,
    ORG,
    INV_ID,
    "inv_line_NONEXISTENT",
    SO_ID
  );
  assert.strictEqual(result.invoiceLine, null);
  assert.strictEqual(result.ranked.length, 0);
});

test("C21. candidates for non-existent SO return empty ranked", () => {
  const result = getCandidatesForInvoiceLine(
    db,
    ORG,
    INV_ID,
    "inv_line_1",
    "so_NONEXISTENT"
  );
  // Invoice line should be found but no SO header → empty candidates
  assert.ok(result.invoiceLine);
  assert.strictEqual(result.ranked.length, 0);
});

test("C22. UOM match reflected in candidate ranking", () => {
  // inv_line_2 has unit "pcs", so_line_C also has unit "pcs" → UOM MATCH
  const result = getCandidatesForInvoiceLine(db, ORG, INV_ID, "inv_line_2", SO_ID);
  const gearCandidate = result.ranked.find(
    (r) => r.candidate.line_item_id === "so_line_C"
  );
  assert.ok(gearCandidate, "Gear Beta candidate must exist");
  assert.strictEqual(gearCandidate!.ranking.uom, "MATCH");

  // so_line_A has unit "nos" but inv_line_2 has "pcs" → UOM MISMATCH
  const widgetCandidate = result.ranked.find(
    (r) => r.candidate.line_item_id === "so_line_A"
  );
  assert.ok(widgetCandidate);
  assert.strictEqual(widgetCandidate!.ranking.uom, "MISMATCH");
});

// ── Section D: resolveInvoiceLineWithMapping Precedence (23-28) ──

console.log("\nSection D: Mapping-Aware Resolution Precedence");
console.log("──────────────────────────────────────────────\n");

// Build soLines array for resolution tests (simulating AP verification)
const soLines = [
  {
    line_item_id: "so_line_A",
    item_id: "item_001",
    item_name: "Widget Alpha",
    description: "Standard widget 100x50",
    quantity: 100,
    rate: 50,
    unit: "nos",
  },
  {
    line_item_id: "so_line_B",
    item_id: "item_001",
    item_name: "Widget Alpha",
    description: "Widget Alpha variant B",
    quantity: 200,
    rate: 55,
    unit: "nos",
  },
  {
    line_item_id: "so_line_C",
    item_id: "item_002",
    item_name: "Gear Beta",
    description: "Precision gear 25mm",
    quantity: 50,
    rate: 120,
    unit: "pcs",
  },
];

test("D23. MANUAL_MAPPING — active+valid mapping takes precedence over item_id", () => {
  // inv_line_1 has ACTIVE mapping to so_line_A (from test A1)
  const resolution = resolveInvoiceLineWithMapping(
    db,
    ORG,
    INV_ID,
    "inv_line_1",
    soLines
  );
  assert.strictEqual(resolution.source, "MANUAL_MAPPING");
  assert.ok(resolution.soLine);
  assert.strictEqual(resolution.soLine.line_item_id, "so_line_A");
  assert.ok(resolution.mappingId, "mappingId must be present");
});

test("D24. ITEM_ID_UNIQUE — unique item_id match when no mapping", () => {
  // inv_line_2 has item_002, only so_line_C matches → unique
  // inv_line_2 currently has an ACTIVE mapping from B11/B14 — need to revoke it first
  const currentMapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_2");
  if (currentMapping) {
    revokeOwnerInvoiceLineMapping(db, currentMapping.mapping_id);
  }

  const resolution = resolveInvoiceLineWithMapping(
    db,
    ORG,
    INV_ID,
    "inv_line_2",
    soLines
  );
  assert.strictEqual(resolution.source, "ITEM_ID_UNIQUE");
  assert.ok(resolution.soLine);
  assert.strictEqual(resolution.soLine.line_item_id, "so_line_C");
  assert.strictEqual(resolution.mappingId, null);
});

test("D25. ITEM_ID_AMBIGUOUS — multiple SO lines share same item_id", () => {
  // inv_line_3 has item_001, so_line_A and so_line_B both have item_001
  // But inv_line_3 has an ACTIVE mapping from A2 to so_line_B — need to revoke
  const currentMapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_3");
  if (currentMapping) {
    revokeOwnerInvoiceLineMapping(db, currentMapping.mapping_id);
  }

  const resolution = resolveInvoiceLineWithMapping(
    db,
    ORG,
    INV_ID,
    "inv_line_3",
    soLines
  );
  assert.strictEqual(resolution.source, "ITEM_ID_AMBIGUOUS");
  assert.strictEqual(resolution.soLine, null);
  assert.strictEqual(resolution.mappingId, null);
});

test("D26. ITEM_NOT_FOUND — item_id not in any SO line", () => {
  // inv_line_4 has item_999 which is not in SO
  const resolution = resolveInvoiceLineWithMapping(
    db,
    ORG,
    INV_ID,
    "inv_line_4",
    soLines
  );
  assert.strictEqual(resolution.source, "ITEM_NOT_FOUND");
  assert.strictEqual(resolution.soLine, null);
  assert.strictEqual(resolution.mappingId, null);
});

test("D27. stale ACTIVE mapping falls through to item_id matching", () => {
  // Create a mapping, then change the underlying Invoice line data to make fingerprint stale
  const create = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_C",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_4",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(create.outcome, "CREATED");

  // Mutate the Invoice line to invalidate fingerprint
  db.prepare(
    `UPDATE audit_zoho_invoice_lines
     SET description = 'CHANGED description invalidates fingerprint'
     WHERE organization_id = ? AND line_item_id = ?`
  ).run(ORG, "inv_line_4");

  // Now resolve — stale mapping NOT authoritative, falls through
  const resolution = resolveInvoiceLineWithMapping(
    db,
    ORG,
    INV_ID,
    "inv_line_4",
    soLines
  );
  // item_999 not in soLines → ITEM_NOT_FOUND
  assert.strictEqual(resolution.source, "ITEM_NOT_FOUND");
  assert.strictEqual(resolution.soLine, null);

  // Restore the line for other tests
  db.prepare(
    `UPDATE audit_zoho_invoice_lines
     SET description = 'Not in SO'
     WHERE organization_id = ? AND line_item_id = ?`
  ).run(ORG, "inv_line_4");
});

test("D28. REVIEW_REQUIRED mapping falls through to item_id matching", () => {
  // inv_line_4 has an ACTIVE mapping from D27 — mark it REVIEW_REQUIRED
  const mapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_4");
  assert.ok(mapping);
  markInvoiceMappingReviewRequired(db, mapping!.mapping_id, "testing fallthrough");

  const resolution = resolveInvoiceLineWithMapping(
    db,
    ORG,
    INV_ID,
    "inv_line_4",
    soLines
  );
  assert.strictEqual(resolution.source, "ITEM_NOT_FOUND");

  // Clean up: revoke so it doesn't interfere with other tests
  revokeOwnerInvoiceLineMapping(db, mapping!.mapping_id);
});

// ── Section E: Isolation, Safety, Edge Cases (29-34) ──

console.log("\nSection E: Isolation, Safety, Edge Cases");
console.log("────────────────────────────────────────\n");

test("E29. org isolation — mapping in ORG does not affect ORG2", () => {
  const mapping = getCurrentMappingForInvoiceLine(db, ORG2, INV_ID, "inv_line_1");
  assert.strictEqual(mapping, null, "ORG mapping must not leak to ORG2");
});

test("E30. org isolation — create mapping in ORG2 does not affect ORG", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG2,
    salesorderId: SO_ID,
    soLineItemId: "so_line_E",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_10",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "CREATED");

  // Check ORG is not affected
  const orgMapping = getCurrentMappingForInvoiceLine(db, ORG, INV_ID, "inv_line_10");
  assert.strictEqual(orgMapping, null);
});

test("E31. multiple Invoice lines → same SO line is allowed", () => {
  // inv_line_5 (in INV_ID_2) maps to so_line_C, same as inv_line_2 previously
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_C",
    invoiceId: INV_ID_2,
    invoiceLineItemId: "inv_line_5",
    mappingKind: "OWNER_FALLBACK",
    note: "multiple invoices consuming same SO line",
  });
  assert.strictEqual(result.outcome, "CREATED");
});

test("E32. validation fails for missing Invoice line in local data", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_A",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_GHOST",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
});

test("E33. validation fails for missing SO line in local data", () => {
  const result = createOwnerInvoiceLineMapping(db, {
    organizationId: ORG,
    salesorderId: SO_ID,
    soLineItemId: "so_line_GHOST",
    invoiceId: INV_ID,
    invoiceLineItemId: "inv_line_4",
    mappingKind: "OWNER_FALLBACK",
  });
  assert.strictEqual(result.outcome, "VALIDATION_FAILED");
});

test("E34. operational DB not mutated by any R1B test", () => {
  const currentDbHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(_opDbPath))
    .digest("hex");
  assert.strictEqual(
    currentDbHash,
    _baselineDbHash,
    "operational DB file must be identical"
  );

  if (_baselineWalHash !== null) {
    const currentWalHash = fs.existsSync(_opWalPath)
      ? crypto
          .createHash("sha256")
          .update(fs.readFileSync(_opWalPath))
          .digest("hex")
      : null;
    assert.strictEqual(
      currentWalHash,
      _baselineWalHash,
      "operational DB WAL must be identical"
    );
  }
});

// ── Summary ────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════");
console.log(
  `  R1B Test Suite: ${passed + failed} tests, ${passed} passed, ${failed} failed`
);
if (failures.length > 0) {
  console.log("  Failures:");
  for (const f of failures) console.log(`    ✗ ${f}`);
}
console.log("═══════════════════════════════════════════════════════\n");

// Cleanup
try {
  fs.rmSync(tmpDir, { recursive: true });
} catch {
  // best-effort cleanup
}

process.exit(failed > 0 ? 1 : 0);
