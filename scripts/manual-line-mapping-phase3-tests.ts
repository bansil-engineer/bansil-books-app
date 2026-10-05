// ============================================================
// MANUAL SO↔PO LINE MAPPING — PHASE-3 R1
// Smart Sync stale-mapping validation lifecycle tests.
//
// Executes the REAL production validation service and the REAL sync
// functions (targeted / global Approval Pending, Commercial Trace) against
// isolated temp SQLite DBs with mocked GET-only readers.
//
// Zoho calls: 0 (mock readers only). AI calls: 0.
// Operational data/audit_workspace.db: never opened.
// ============================================================
import { register } from "node:module";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Commercial Trace runtime deps (DB handle, token store, Zoho reader) are
// redirected by the existing maintained test hooks.
register("./ct-writer-safety-test-hooks.mjs", import.meta.url);

const { openAuditDatabaseAt } = await import("../app/lib/db/audit-database.ts");
const svc = await import("../app/lib/audit/manual-line-mapping-service.ts");
const { syncApprovalPending, syncApprovalPendingDocument } = await import("../app/lib/audit/approval-pending-sync.ts");
const { syncCommercialTrace } = await import("../app/lib/audit/commercial-trace-sync-service.ts");
const { getApprovalPendingDocuments } = await import("../app/lib/audit/approval-pending-service.ts");

const {
  createOwnerLineMapping, revokeOwnerLineMapping, markMappingReviewRequired,
  evaluateMappingStaleness, isMappingUsable, validateActiveMappingsForDocuments,
} = svc;

const ORG = "TEST_ORG";
const ORG2 = "OTHER_ORG";
const T0 = "2020-01-01T00:00:00.000Z";
const T1 = "2020-02-01T00:00:00.000Z";
const T2 = "2020-03-01T00:00:00.000Z";
const AP_RUN = "APPROVAL_PENDING_ACTIVE";
const CT_RUN = "COMMERCIAL_TRACE_ACTIVE";

// ── Operational DB sentinel (dynamic, captured in-run) ─────
const OPERATIONAL_DB = path.resolve(process.cwd(), "data", "audit_workspace.db");
function opSentinel(): string {
  const parts: string[] = [];
  for (const f of [OPERATIONAL_DB, OPERATIONAL_DB + "-wal", OPERATIONAL_DB + "-shm"]) {
    if (fs.existsSync(f)) {
      const st = fs.statSync(f);
      parts.push(`${path.basename(f)}:${st.size}:${st.mtimeMs}:${crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`);
    } else parts.push(`${path.basename(f)}:absent`);
  }
  return parts.join("|");
}
const SENTINEL_BEFORE = opSentinel();

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mlm-phase3-"));
let dbN = 0;
function freshDb(): any {
  const f = path.join(TMP_ROOT, `p3-${++dbN}.db`);
  assert.notStrictEqual(path.resolve(f), OPERATIONAL_DB);
  return openAuditDatabaseAt(f);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    ${e?.stack?.split("\n").slice(0, 3).join("\n    ") || e}`);
  }
}

// ── Fixtures ───────────────────────────────────────────────
type L = { id: string; item_id?: string | null; name?: string | null; description?: string | null; quantity?: number | null; rate?: number | null; unit?: string | null };
const BASE: Omit<L, "id"> = { item_id: "itm_1", name: "Steel Plate", description: "8mm plate", quantity: 10, rate: 100, unit: "Nos" };
const ln = (id: string, o: Partial<L> = {}): L => ({ id, ...BASE, ...o });

function ensureRun(db: any, runId: string, org: string) {
  db.prepare(`INSERT OR IGNORE INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, status) VALUES (?, ?, 'phase3_fixture', ?, 'SUCCESS')`)
    .run(runId, org, T0);
}
function seedSo(db: any, a: { org?: string; soId: string; runId: string; fetchedAt: string; lines: L[] }) {
  const org = a.org ?? ORG;
  ensureRun(db, a.runId, org);
  db.prepare(`INSERT OR REPLACE INTO audit_zoho_sales_orders (organization_id, salesorder_id, source_run_id, salesorder_number, status, fetched_at) VALUES (?, ?, ?, ?, 'open', ?)`)
    .run(org, a.soId, a.runId, "SO-" + a.soId, a.fetchedAt);
  for (const l of a.lines) {
    db.prepare(`INSERT OR REPLACE INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, item_name, description, sku, quantity, rate, amount, unit) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
      .run(org, l.id, a.soId, a.runId, l.item_id ?? null, l.name ?? null, l.description ?? null, l.quantity ?? null, l.rate ?? null, (l.quantity ?? 0) * (l.rate ?? 0), l.unit ?? null);
  }
}
function seedPo(db: any, a: { org?: string; poId: string; runId: string; fetchedAt: string; lines: L[] }) {
  const org = a.org ?? ORG;
  ensureRun(db, a.runId, org);
  db.prepare(`INSERT OR REPLACE INTO audit_zoho_purchase_orders (organization_id, purchaseorder_id, source_run_id, purchaseorder_number, status, fetched_at) VALUES (?, ?, ?, ?, 'open', ?)`)
    .run(org, a.poId, a.runId, "PO-" + a.poId, a.fetchedAt);
  for (const l of a.lines) {
    db.prepare(`INSERT OR REPLACE INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, item_name, description, sku, quantity, rate, amount, unit) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
      .run(org, l.id, a.poId, a.runId, l.item_id ?? null, l.name ?? null, l.description ?? null, l.quantity ?? null, l.rate ?? null, (l.quantity ?? 0) * (l.rate ?? 0), l.unit ?? null);
  }
}
function mapLine(db: any, soId: string, soLine: string, poId: string, poLine: string, org = ORG): any {
  const r = createOwnerLineMapping(db, { organizationId: org, salesorderId: soId, soLineItemId: soLine, purchaseorderId: poId, poLineItemId: poLine, mappingKind: "OWNER_FALLBACK" });
  assert.strictEqual(r.outcome, "CREATED", `mapping create failed: ${JSON.stringify(r)}`);
  return (r as any).mapping;
}
const getM = (db: any, id: string) => db.prepare(`SELECT * FROM audit_so_po_line_mappings WHERE mapping_id = ?`).get(id) as any;
const histCount = (db: any, id: string, ev?: string) =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM audit_so_po_line_mapping_history WHERE mapping_id = ?${ev ? " AND event_type = ?" : ""}`).get(...(ev ? [id, ev] : [id])) as any).n);
const validate = (db: any, po: string[], so: string[], org = ORG) =>
  validateActiveMappingsForDocuments(db, { organizationId: org, purchaseorderIds: po, salesorderIds: so });

/** Standard scenario: SO so_A {sl_1, sl_2}, PO po_A {pl_1, pl_2} in RUN_A@T0; mapping pl_1 → sl_1. */
function scenario() {
  const db = freshDb();
  seedSo(db, { soId: "so_A", runId: "RUN_A", fetchedAt: T0, lines: [ln("sl_1"), ln("sl_2", { item_id: "itm_2", name: "Bolt" })] });
  seedPo(db, { poId: "po_A", runId: "RUN_A", fetchedAt: T0, lines: [ln("pl_1"), ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
  const m = mapLine(db, "so_A", "sl_1", "po_A", "pl_1");
  return { db, m };
}
function addScenarioB(db: any) {
  seedSo(db, { soId: "so_B", runId: "RUN_A", fetchedAt: T0, lines: [ln("sl_b1", { item_id: "itm_9", name: "Valve" })] });
  seedPo(db, { poId: "po_B", runId: "RUN_A", fetchedAt: T0, lines: [ln("pl_b1", { item_id: "itm_9", name: "Valve" })] });
  return mapLine(db, "so_B", "sl_b1", "po_B", "pl_b1");
}
/** Make po_B evidence stale in a newer snapshot WITHOUT validating (used to prove unrelated docs are not touched). */
function staleB(db: any) {
  seedPo(db, { poId: "po_B", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_b1", { item_id: "itm_9", name: "Valve", rate: 999 })] });
}

// ── Zoho-shaped document builders + GET-only mock reader ───
const zLine = (l: L) => ({ line_item_id: l.id, item_id: l.item_id, name: l.name, description: l.description, sku: null, quantity: l.quantity, rate: l.rate, item_total: (l.quantity ?? 0) * (l.rate ?? 0), unit: l.unit });
const zPo = (poId: string, lines: L[], extra: Record<string, unknown> = {}) => ({ purchaseorder_id: poId, purchaseorder_number: "PO-" + poId, status: "pending_approval", date: "2020-01-01", total: 0, custom_fields: [], line_items: lines.map(zLine), ...extra });
const zSo = (soId: string, lines: L[], extra: Record<string, unknown> = {}) => ({ salesorder_id: soId, salesorder_number: "SO-" + soId, status: "open", date: "2020-01-01", total: 0, custom_fields: [], line_items: lines.map(zLine), ...extra });

function makeReader(src: { pos?: Record<string, any>; sos?: Record<string, any>; invoices?: Record<string, any>; bills?: Record<string, any>; poList?: any[]; soList?: any[] }, log: string[]) {
  const get = (kind: string, map: Record<string, any> | undefined, key: string) => async (_org: string, id: string) => {
    log.push(`net:${kind}:${id}`);
    const d = map?.[id];
    if (!d) throw new Error(`404 ${kind} ${id}`);
    return { [key]: d };
  };
  return {
    listPurchaseOrders: async () => { log.push("net:listPurchaseOrders"); return { purchaseorders: src.poList ?? [] }; },
    getPurchaseOrder: get("getPurchaseOrder", src.pos, "purchaseorder"),
    listBills: async () => { log.push("net:listBills"); return { bills: [] }; },
    getBill: get("getBill", src.bills, "bill"),
    listInvoices: async () => { log.push("net:listInvoices"); return { invoices: [] }; },
    getInvoice: get("getInvoice", src.invoices, "invoice"),
    listSalesOrders: async () => { log.push("net:listSalesOrders"); return { salesorders: src.soList ?? [] }; },
    getSalesOrder: get("getSalesOrder", src.sos, "salesorder"),
    listExpenses: async () => { log.push("net:listExpenses"); return { expenses: [] }; },
    getExpense: async () => { log.push("net:getExpense"); return {}; },
  };
}

/** Event-order instrumentation on a DB instance (transactions + mapping SQL). */
function instrument(db: any, log: string[]) {
  const ex = db.exec.bind(db);
  db.exec = (sql: string) => {
    const kw = String(sql).trim().split(/\s+/)[0].toUpperCase();
    if (["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"].includes(kw)) log.push("exec:" + kw);
    return ex(sql);
  };
  const pr = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    if (/UPDATE\s+audit_so_po_line_mappings/i.test(sql)) log.push("sql:MAPPING_UPDATE");
    else if (/FROM\s+audit_so_po_line_mappings/i.test(sql) && /status = 'ACTIVE'/.test(sql)) log.push("sql:MAPPING_QUERY");
    return pr(sql);
  };
}
function assertAfterCommitNoNetwork(log: string[]) {
  const firstQ = log.findIndex((e) => e === "sql:MAPPING_QUERY");
  assert.ok(firstQ >= 0, "mapping validation ran");
  const commitIdx = log.lastIndexOf("exec:COMMIT", firstQ);
  assert.ok(commitIdx >= 0 && commitIdx < firstQ, "source COMMIT precedes mapping validation");
  const beginIdx = log.lastIndexOf("exec:BEGIN", firstQ);
  assert.ok(beginIdx < commitIdx, "no source transaction open during validation");
  const netAfter = log.slice(firstQ).filter((e) => e.startsWith("net:"));
  assert.deepStrictEqual(netAfter, [], "no network during/after mapping validation");
}
function addFailTrigger(db: any) {
  db.exec(`CREATE TRIGGER p3_fail_mapping_update BEFORE UPDATE ON audit_so_po_line_mappings BEGIN SELECT RAISE(ABORT, 'simulated mapping validation failure'); END;`);
}
const apLine = (db: any, table: "po" | "so", docId: string, lineId: string) =>
  table === "po"
    ? db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE organization_id = ? AND purchaseorder_id = ? AND line_item_id = ? AND source_run_id = ?`).get(ORG, docId, lineId, AP_RUN) as any
    : db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE organization_id = ? AND salesorder_id = ? AND line_item_id = ? AND source_run_id = ?`).get(ORG, docId, lineId, AP_RUN) as any;

// ============================================================
console.log("\n═══════════════════════════════════════════════");
console.log("  Manual SO↔PO Line Mapping — Phase-3 Tests");
console.log("═══════════════════════════════════════════════\n");

console.log("SECTION 1: Baseline & material stale signals");

await test("01 ACTIVE mapping + identical evidence → remains ACTIVE", () => {
  const { db, m } = scenario();
  const s = validate(db, ["po_A"], ["so_A"]);
  assert.deepStrictEqual(s, { checked: 1, stillValid: 1, markedReviewRequired: 0, missingLines: 0, failed: 0 });
  const after = getM(db, m.mapping_id);
  assert.strictEqual(after.status, "ACTIVE");
  assert.strictEqual(after.updated_at, m.updated_at, "no timestamp churn");
  assert.strictEqual(histCount(db, m.mapping_id), 1, "only MAPPING_CREATED");
});

const FIELD_CASES: Array<[string, Partial<L>]> = [
  ["item_id", { item_id: "itm_X" }],
  ["item_name", { name: "Steel Plate HD" }],
  ["description", { description: "10mm plate" }],
  ["quantity", { quantity: 11 }],
  ["rate", { rate: 101 }],
  ["unit", { unit: "Job" }],
];
let n = 2;
for (const side of ["PO", "SO"] as const) {
  for (const [field, change] of FIELD_CASES) {
    const num = String(n++).padStart(2, "0");
    await test(`${num} ${side} ${field} change → REVIEW_REQUIRED`, () => {
      const { db, m } = scenario();
      if (side === "PO") seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_1", change), ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
      else seedSo(db, { soId: "so_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_1", change), ln("sl_2", { item_id: "itm_2", name: "Bolt" })] });
      const s = validate(db, ["po_A"], ["so_A"]);
      assert.deepStrictEqual(s, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 0, failed: 0 });
      const after = getM(db, m.mapping_id);
      assert.strictEqual(after.status, "REVIEW_REQUIRED");
      assert.ok(after.review_required_at, "review_required_at set");
      assert.notStrictEqual(after.updated_at, null);
      // identity unchanged — never remapped
      assert.strictEqual(after.purchaseorder_id, "po_A"); assert.strictEqual(after.po_line_item_id, "pl_1");
      assert.strictEqual(after.salesorder_id, "so_A"); assert.strictEqual(after.so_line_item_id, "sl_1");
      const note = (db.prepare(`SELECT note FROM audit_so_po_line_mapping_history WHERE mapping_id = ? AND event_type = 'MAPPING_MARKED_REVIEW_REQUIRED'`).get(m.mapping_id) as any).note;
      assert.ok(String(note).includes("EVIDENCE_CHANGED") && String(note).includes(side), `history note names side: ${note}`);
    });
  }
}

console.log("\nSECTION 2: Coherent snapshot selection (deleted lines)");

await test("14 PO mapped line deleted in newest coherent snapshot (older still has it) → REVIEW_REQUIRED", () => {
  const { db, m } = scenario();
  seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
  const old = db.prepare(`SELECT COUNT(*) AS n FROM audit_zoho_purchase_order_lines WHERE line_item_id = 'pl_1' AND source_run_id = 'RUN_A'`).get() as any;
  assert.strictEqual(Number(old.n), 1, "older snapshot still contains pl_1");
  assert.strictEqual(evaluateMappingStaleness(db, getM(db, m.mapping_id)), "MISSING_LINE", "old snapshot must not resurrect pl_1");
  assert.strictEqual(isMappingUsable(db, getM(db, m.mapping_id)), false);
  const s = validate(db, ["po_A"], []);
  assert.deepStrictEqual(s, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 1, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
});

await test("15 SO mapped line deleted in newest coherent snapshot (older still has it) → REVIEW_REQUIRED", () => {
  const { db, m } = scenario();
  seedSo(db, { soId: "so_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_2", { item_id: "itm_2", name: "Bolt" })] });
  assert.strictEqual(evaluateMappingStaleness(db, getM(db, m.mapping_id)), "MISSING_LINE");
  const s = validate(db, [], ["so_A"]);
  assert.deepStrictEqual(s, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 1, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
});

console.log("\nSECTION 3: Non-material evidence");

await test("16 fetched_at-only change → ACTIVE", () => {
  const { db, m } = scenario();
  db.prepare(`UPDATE audit_zoho_purchase_orders SET fetched_at = ? WHERE purchaseorder_id = 'po_A'`).run(T2);
  db.prepare(`UPDATE audit_zoho_sales_orders SET fetched_at = ? WHERE salesorder_id = 'so_A'`).run(T2);
  const s = validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(s.stillValid, 1); assert.strictEqual(s.markedReviewRequired, 0);
  assert.strictEqual(getM(db, m.mapping_id).status, "ACTIVE");
  assert.strictEqual(getM(db, m.mapping_id).updated_at, m.updated_at);
});

await test("17 source_run_id-only change (RUN_A → RUN_B, same material evidence) → ACTIVE", () => {
  const { db, m } = scenario();
  seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_1"), ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
  seedSo(db, { soId: "so_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_1"), ln("sl_2", { item_id: "itm_2", name: "Bolt" })] });
  const s = validate(db, ["po_A"], ["so_A"]);
  assert.deepStrictEqual(s, { checked: 1, stillValid: 1, markedReviewRequired: 0, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "ACTIVE");
});

await test("17b UOM: NULL → Nos is a material change → REVIEW_REQUIRED (no alias/conversion)", () => {
  const db = freshDb();
  seedSo(db, { soId: "so_N", runId: "RUN_A", fetchedAt: T0, lines: [ln("sl_n", { unit: null })] });
  seedPo(db, { poId: "po_N", runId: "RUN_A", fetchedAt: T0, lines: [ln("pl_n", { unit: "Nos" })] });
  const m = mapLine(db, "so_N", "sl_n", "po_N", "pl_n");
  seedSo(db, { soId: "so_N", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_n", { unit: "Nos" })] });
  validate(db, ["po_N"], ["so_N"]);
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
});

console.log("\nSECTION 4: Scope, lifecycle and history");

await test("18 unrelated document change does not affect mapping (document-ID + organization scoped)", () => {
  const { db, m } = scenario();
  const mB = addScenarioB(db);
  staleB(db);
  // org2 mapping on same document IDs, stale in ORG2
  seedSo(db, { org: ORG2, soId: "so_A", runId: "RUN_O", fetchedAt: T0, lines: [ln("sl_1")] });
  seedPo(db, { org: ORG2, poId: "po_A", runId: "RUN_O", fetchedAt: T0, lines: [ln("pl_1")] });
  const mO = mapLine(db, "so_A", "sl_1", "po_A", "pl_1", ORG2);
  seedPo(db, { org: ORG2, poId: "po_A", runId: "RUN_O2", fetchedAt: T1, lines: [ln("pl_1", { rate: 1 })] });

  const s = validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(s.checked, 1, "only the ORG po_A/so_A mapping evaluated");
  assert.strictEqual(getM(db, m.mapping_id).status, "ACTIVE");
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE", "stale po_B mapping untouched (out of scope)");
  assert.strictEqual(getM(db, mB.mapping_id).updated_at, mB.updated_at);
  assert.strictEqual(getM(db, mO.mapping_id).status, "ACTIVE", "other organization untouched");
  // No IDs → no-op, no full-table scan
  assert.deepStrictEqual(validate(db, [], []), { checked: 0, stillValid: 0, markedReviewRequired: 0, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE");
  // Bounded query is index-backed (no full-table SCAN of mappings)
  const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM audit_so_po_line_mappings WHERE organization_id = ? AND purchaseorder_id IN (?) AND status = 'ACTIVE'`).all(ORG, "po_A") as any[]).map((r) => r.detail).join(" ; ");
  assert.ok(/USING INDEX/.test(plan) && !/SCAN audit_so_po_line_mappings(?! USING)/.test(plan), `index-bounded plan: ${plan}`);
  const plan2 = (db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM audit_so_po_line_mappings WHERE organization_id = ? AND salesorder_id IN (?) AND status = 'ACTIVE'`).all(ORG, "so_A") as any[]).map((r) => r.detail).join(" ; ");
  assert.ok(/USING INDEX/.test(plan2), `index-bounded plan: ${plan2}`);
  const src = fs.readFileSync("app/lib/audit/manual-line-mapping-service.ts", "utf8");
  assert.ok(src.includes("WHERE organization_id = ? AND ${column} IN (${placeholders}) AND status = 'ACTIVE'"), "validator query is org + document-ID + ACTIVE bounded");
});

await test("19 REVIEW_REQUIRED mapping skipped (no history, no timestamp change)", () => {
  const { db, m } = scenario();
  markMappingReviewRequired(db, m.mapping_id, "owner flagged");
  const before = getM(db, m.mapping_id);
  seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_1", { rate: 5 })] });
  const s = validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(s.checked, 0);
  assert.deepStrictEqual(getM(db, m.mapping_id), before);
  assert.strictEqual(histCount(db, m.mapping_id, "MAPPING_MARKED_REVIEW_REQUIRED"), 1);
});

await test("20 REVOKED mapping skipped", () => {
  const { db, m } = scenario();
  revokeOwnerLineMapping(db, m.mapping_id, "owner revoke");
  const before = getM(db, m.mapping_id);
  seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_1", { rate: 5 })] });
  const s = validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(s.checked, 0);
  assert.deepStrictEqual(getM(db, m.mapping_id), before);
  assert.strictEqual(histCount(db, m.mapping_id, "MAPPING_MARKED_REVIEW_REQUIRED"), 0);
});

await test("21 stale transition creates exactly one MAPPING_MARKED_REVIEW_REQUIRED event", () => {
  const { db, m } = scenario();
  seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_1", { quantity: 3 }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
  validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(histCount(db, m.mapping_id, "MAPPING_MARKED_REVIEW_REQUIRED"), 1);
  const h = db.prepare(`SELECT previous_status, new_status FROM audit_so_po_line_mapping_history WHERE mapping_id = ? AND event_type = 'MAPPING_MARKED_REVIEW_REQUIRED'`).get(m.mapping_id) as any;
  assert.strictEqual(h.previous_status, "ACTIVE"); assert.strictEqual(h.new_status, "REVIEW_REQUIRED");
});

await test("22 repeat validation: no duplicate history, no timestamp change, no auto-reconfirm", () => {
  const { db, m } = scenario();
  seedPo(db, { poId: "po_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("pl_1", { quantity: 3 }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
  validate(db, ["po_A"], ["so_A"]);
  const snap = getM(db, m.mapping_id);
  const s2 = validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(s2.checked, 0);
  assert.deepStrictEqual(getM(db, m.mapping_id), snap);
  assert.strictEqual(histCount(db, m.mapping_id), 2, "CREATED + one MARKED_REVIEW_REQUIRED");
  // Evidence restored to original → still REVIEW_REQUIRED (only OWNER reconfirm returns to ACTIVE)
  seedPo(db, { poId: "po_A", runId: "RUN_C", fetchedAt: T2, lines: [ln("pl_1"), ln("pl_2", { item_id: "itm_2", name: "Bolt" })] });
  validate(db, ["po_A"], ["so_A"]);
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(histCount(db, m.mapping_id, "MAPPING_RECONFIRMED"), 0);
});

await test("22b markMappingReviewRequired status precondition (non-ACTIVE → null, no history)", () => {
  const { db, m } = scenario();
  assert.ok(markMappingReviewRequired(db, m.mapping_id, "x"));
  assert.strictEqual(markMappingReviewRequired(db, m.mapping_id, "x"), null);
  assert.strictEqual(histCount(db, m.mapping_id, "MAPPING_MARKED_REVIEW_REQUIRED"), 1);
});

await test("22c isMappingUsable safety net: stale ACTIVE mapping (not yet transitioned) is NOT usable", () => {
  const { db, m } = scenario();
  assert.strictEqual(isMappingUsable(db, getM(db, m.mapping_id)), true);
  seedSo(db, { soId: "so_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_1", { unit: "Job" }), ln("sl_2", { item_id: "itm_2", name: "Bolt" })] });
  assert.strictEqual(getM(db, m.mapping_id).status, "ACTIVE");
  assert.strictEqual(isMappingUsable(db, getM(db, m.mapping_id)), false);
});

console.log("\nSECTION 5: Sync hooks (real sync functions, mock GET-only readers)");

const pA = () => [ln("pl_1"), ln("pl_2", { item_id: "itm_2", name: "Bolt" })];
const sA = () => [ln("sl_1"), ln("sl_2", { item_id: "itm_2", name: "Bolt" })];

await test("23 targeted PO sync validates only mappings for target PO", async () => {
  const { db, m } = scenario();
  const mB = addScenarioB(db); staleB(db);
  const log: string[] = [];
  instrument(db, log);
  const reader = makeReader({ pos: { po_A: zPo("po_A", [ln("pl_1", { rate: 120 }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })]) } }, log);
  const r: any = await syncApprovalPendingDocument({ type: "PO", id: "po_A", number: "PO-po_A" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.status, "SUCCESS", r.error);
  assert.deepStrictEqual(r.mappingValidation, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE", "po_B mapping not validated by po_A sync");
  assert.deepStrictEqual(log.filter((e) => e.startsWith("net:")), ["net:getPurchaseOrder:po_A"], "no additional Zoho GET");
  assertAfterCommitNoNetwork(log);
});

await test("23b targeted PO sync with identical evidence (RUN_A → APPROVAL_PENDING_ACTIVE) keeps mapping ACTIVE", async () => {
  const { db, m } = scenario();
  const reader = makeReader({ pos: { po_A: zPo("po_A", pA()) } }, []);
  const r: any = await syncApprovalPendingDocument({ type: "PO", id: "po_A" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.status, "SUCCESS");
  assert.ok(apLine(db, "po", "po_A", "pl_1"), "new AP snapshot written");
  assert.deepStrictEqual(r.mappingValidation, { checked: 1, stillValid: 1, markedReviewRequired: 0, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "ACTIVE");
});

await test("24 targeted PO + referenced SO validates both bounded scopes", async () => {
  const { db, m } = scenario();
  seedPo(db, { poId: "po_C", runId: "RUN_A", fetchedAt: T0, lines: [ln("pl_c1", { item_id: "itm_2", name: "Bolt" })] });
  const mC = mapLine(db, "so_A", "sl_2", "po_C", "pl_c1");
  const mB = addScenarioB(db); staleB(db);
  const log: string[] = [];
  instrument(db, log);
  const reader = makeReader({
    pos: { po_A: zPo("po_A", pA(), { salesorder_id: "so_A" }) },
    sos: { so_A: zSo("so_A", [ln("sl_1", { unit: "Job" }), ln("sl_2", { item_id: "itm_2", name: "Bolt", description: "M12 bolt" })]) },
  }, log);
  const r: any = await syncApprovalPendingDocument({ type: "PO", id: "po_A" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.status, "SUCCESS", r.error);
  assert.strictEqual(r.referenceDocumentRefreshed, true);
  assert.deepStrictEqual(r.mappingValidation, { checked: 2, stillValid: 0, markedReviewRequired: 2, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(getM(db, mC.mapping_id).status, "REVIEW_REQUIRED", "mapping touching refreshed SO validated");
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE");
  assert.deepStrictEqual(log.filter((e) => e.startsWith("net:")), ["net:getPurchaseOrder:po_A", "net:getSalesOrder:so_A"]);
  assertAfterCommitNoNetwork(log);
});

await test("25 targeted Invoice→SO dependency validates only mappings touching refreshed SO", async () => {
  const { db, m } = scenario();
  const mB = addScenarioB(db);
  // mapping touching po_A but a different SO (so_B) — must NOT be validated by an SO-only refresh
  const mX = mapLine(db, "so_B", "sl_b1", "po_A", "pl_2");
  seedSo(db, { soId: "so_B", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_b1", { item_id: "itm_9", name: "Valve", quantity: 77 })] });
  const log: string[] = [];
  instrument(db, log);
  const reader = makeReader({
    invoices: { inv_1: { invoice_id: "inv_1", invoice_number: "INV-1", salesorder_id: "so_A", status: "pending_approval", date: "2020-01-01", total: 0, custom_fields: [], line_items: [zLine(ln("il_1"))] } },
    sos: { so_A: zSo("so_A", [ln("sl_1", { quantity: 12 }), ln("sl_2", { item_id: "itm_2", name: "Bolt" })]) },
  }, log);
  const r: any = await syncApprovalPendingDocument({ type: "INVOICE", id: "inv_1" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.status, "SUCCESS", r.error);
  assert.deepStrictEqual(r.mappingValidation, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(getM(db, mX.mapping_id).status, "ACTIVE", "po_A↔so_B mapping out of SO scope");
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE");
  assert.deepStrictEqual(log.filter((e) => e.startsWith("net:")), ["net:getInvoice:inv_1", "net:getSalesOrder:so_A"]);
  assert.strictEqual(Number((db.prepare(`SELECT COUNT(*) AS n FROM audit_invoice_so_line_mappings`).get() as any).n), 0, "Invoice→SO mapping table exists (schema v11) but sync must not auto-populate it");
  assert.strictEqual(Number((db.prepare(`SELECT COUNT(*) AS n FROM audit_invoice_so_line_mapping_history`).get() as any).n), 0, "Invoice→SO mapping history must remain empty after sync");
  assertAfterCommitNoNetwork(log);
});

await test("26 targeted Bill→PO dependency validates only mappings touching refreshed PO", async () => {
  const { db, m } = scenario();
  // mapping touching so_A via a different PO — must NOT be validated by a PO-only refresh
  seedPo(db, { poId: "po_C", runId: "RUN_A", fetchedAt: T0, lines: [ln("pl_c1", { item_id: "itm_2", name: "Bolt" })] });
  const mC = mapLine(db, "so_A", "sl_2", "po_C", "pl_c1");
  seedSo(db, { soId: "so_A", runId: "RUN_B", fetchedAt: T1, lines: [ln("sl_1"), ln("sl_2", { item_id: "itm_2", name: "Bolt", rate: 1 })] });
  const log: string[] = [];
  instrument(db, log);
  const reader = makeReader({
    bills: { bill_1: { bill_id: "bill_1", bill_number: "BILL-1", purchaseorder_id: "po_A", status: "open", date: "2020-01-01", total: 0, custom_fields: [], line_items: [zLine(ln("bl_1"))] } },
    pos: { po_A: zPo("po_A", [ln("pl_1", { description: "8mm plate (revised)" }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })]) },
  }, log);
  const r: any = await syncApprovalPendingDocument({ type: "BILL", id: "bill_1" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.status, "SUCCESS", r.error);
  assert.deepStrictEqual(r.mappingValidation, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(getM(db, mC.mapping_id).status, "ACTIVE", "so_A↔po_C mapping out of PO scope");
  assert.deepStrictEqual(log.filter((e) => e.startsWith("net:")), ["net:getBill:bill_1", "net:getPurchaseOrder:po_A"]);
  assertAfterCommitNoNetwork(log);
});

await test("27 global Approval Pending validates affected (written) docs only", async () => {
  const { db, m } = scenario();
  const mB = addScenarioB(db); staleB(db);
  const log: string[] = [];
  instrument(db, log);
  const pos = { po_A: zPo("po_A", [ln("pl_1", { unit: "Job" }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })]) };
  const reader = makeReader({ poList: [{ purchaseorder_id: "po_A", status: "pending_approval" }], pos }, log);
  const r: any = await syncApprovalPending({ from: "2020-01-01", to: "2020-12-31" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.created + r.updated, 1, "user-facing counters unchanged in meaning");
  assert.deepStrictEqual(r.mappingValidation, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE", "unrelated stale mapping not scanned");
  assert.deepStrictEqual(log.filter((e) => e.startsWith("net:")), ["net:listPurchaseOrders", "net:listBills", "net:listInvoices", "net:getPurchaseOrder:po_A"]);
  assertAfterCommitNoNetwork(log);
  // Second identical global run: nothing written → nothing validated
  const r2: any = await syncApprovalPending({ from: "2020-01-01", to: "2020-12-31" }, { db, reader: makeReader({ poList: [{ purchaseorder_id: "po_A", status: "pending_approval" }], pos }, []), orgId: ORG });
  assert.strictEqual(r2.unchanged, 1);
  assert.strictEqual(r2.mappingValidation.checked, 0);
});

await test("28 Commercial Trace validates affected (written) docs only, after COMMIT", async () => {
  const { db, m } = scenario();
  const mB = addScenarioB(db); staleB(db);
  const log: string[] = [];
  instrument(db, log);
  const reader = makeReader({
    soList: [{ salesorder_id: "so_A", salesorder_number: "SO-so_A", status: "open" }],
    poList: [{ purchaseorder_id: "po_A", purchaseorder_number: "PO-po_A", status: "open" }],
    sos: { so_A: zSo("so_A", [ln("sl_1", { rate: 130 }), ln("sl_2", { item_id: "itm_2", name: "Bolt" })]) },
    pos: { po_A: zPo("po_A", pA()) },
  }, log);
  (globalThis as any).__CT_SAFETY_TEST__ = { db, orgId: ORG, reader, trackBegin: false };
  const r: any = await syncCommercialTrace({ period: "ALL_PERIODS" });
  assert.deepStrictEqual(r.mappingValidation, { checked: 1, stillValid: 0, markedReviewRequired: 1, missingLines: 0, failed: 0 });
  assert.strictEqual(getM(db, m.mapping_id).status, "REVIEW_REQUIRED");
  assert.strictEqual(getM(db, mB.mapping_id).status, "ACTIVE");
  const ctLine = db.prepare(`SELECT rate FROM audit_zoho_sales_order_lines WHERE line_item_id = 'sl_1' AND source_run_id = ?`).get(CT_RUN) as any;
  assert.strictEqual(ctLine.rate, 130);
  assert.deepStrictEqual(log.filter((e) => e.startsWith("net:")), ["net:listSalesOrders", "net:getSalesOrder:so_A", "net:listPurchaseOrders", "net:getPurchaseOrder:po_A", "net:listInvoices", "net:listBills", "net:listExpenses"]);
  assertAfterCommitNoNetwork(log);
});

console.log("\nSECTION 6: Failure contract");

await test("29/30 targeted PO: validation failure does NOT roll back source evidence; failure surfaced", async () => {
  const { db, m } = scenario();
  addFailTrigger(db);
  const reader = makeReader({ pos: { po_A: zPo("po_A", [ln("pl_1", { rate: 120 }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })]) } }, []);
  const r: any = await syncApprovalPendingDocument({ type: "PO", id: "po_A" }, { db, reader, orgId: ORG });
  assert.strictEqual(r.status, "SUCCESS", "source sync stays successful");
  assert.strictEqual(apLine(db, "po", "po_A", "pl_1").rate, 120, "source evidence committed and preserved");
  const mv = r.mappingValidation;
  assert.ok(mv.failed >= 1, "failed count reported");
  assert.ok(String(mv.error).includes("simulated mapping validation failure"), "error surfaced");
  assert.strictEqual(mv.markedReviewRequired, 0);
  assert.ok(mv.stillValid + mv.markedReviewRequired < mv.checked, "no false claim that all mappings are safe");
  assert.strictEqual(getM(db, m.mapping_id).status, "ACTIVE");
  assert.strictEqual(histCount(db, m.mapping_id, "MAPPING_MARKED_REVIEW_REQUIRED"), 0, "per-mapping transition rolled back atomically");
  assert.strictEqual(isMappingUsable(db, getM(db, m.mapping_id)), false, "safety net: stale mapping still unusable");
});

await test("29/30 global Approval Pending: validation failure surfaced, source preserved", async () => {
  const { db } = scenario();
  addFailTrigger(db);
  const pos = { po_A: zPo("po_A", [ln("pl_1", { quantity: 99 }), ln("pl_2", { item_id: "itm_2", name: "Bolt" })]) };
  const r: any = await syncApprovalPending({}, { db, reader: makeReader({ poList: [{ purchaseorder_id: "po_A", status: "pending_approval" }], pos }, []), orgId: ORG });
  assert.strictEqual(r.created + r.updated, 1);
  assert.strictEqual(apLine(db, "po", "po_A", "pl_1").quantity, 99);
  assert.ok(r.mappingValidation.failed >= 1 && /simulated/.test(r.mappingValidation.error));
});

await test("29/30 Commercial Trace: validation failure surfaced, source preserved", async () => {
  const { db } = scenario();
  addFailTrigger(db);
  const reader = makeReader({
    soList: [{ salesorder_id: "so_A", salesorder_number: "SO-so_A", status: "open" }],
    sos: { so_A: zSo("so_A", [ln("sl_1", { rate: 130 }), ln("sl_2", { item_id: "itm_2", name: "Bolt" })]) },
  }, []);
  (globalThis as any).__CT_SAFETY_TEST__ = { db, orgId: ORG, reader, trackBegin: false };
  const r: any = await syncCommercialTrace({ period: "ALL_PERIODS" });
  assert.strictEqual((db.prepare(`SELECT rate FROM audit_zoho_sales_order_lines WHERE line_item_id = 'sl_1' AND source_run_id = ?`).get(CT_RUN) as any).rate, 130);
  assert.ok(r.mappingValidation.failed >= 1 && /simulated/.test(r.mappingValidation.error));
});

console.log("\nSECTION 7: Network / AI / semantics / safety");

await test("31 no additional Zoho GET: call log identical with vs. without mappings", async () => {
  const run = async (withMapping: boolean) => {
    const db = freshDb();
    seedSo(db, { soId: "so_A", runId: "RUN_A", fetchedAt: T0, lines: sA() });
    seedPo(db, { poId: "po_A", runId: "RUN_A", fetchedAt: T0, lines: pA() });
    if (withMapping) mapLine(db, "so_A", "sl_1", "po_A", "pl_1");
    const log: string[] = [];
    await syncApprovalPendingDocument({ type: "PO", id: "po_A" }, { db, reader: makeReader({ pos: { po_A: zPo("po_A", [ln("pl_1", { rate: 1 })], { salesorder_id: "so_A" }) }, sos: { so_A: zSo("so_A", sA()) } }, log), orgId: ORG });
    return log;
  };
  assert.deepStrictEqual(await run(true), await run(false));
});

await test("32/33 Zoho writes = 0, AI calls = 0 (validator imports, readers GET-only)", () => {
  const importsOf = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter((l) => /^\s*import\s|from\s+["']/.test(l)).join("\n");
  const svcImports = importsOf("app/lib/audit/manual-line-mapping-service.ts");
  assert.ok(!/zoho|fetch|http|axios|anthropic|openai|ai-sdk/i.test(svcImports), `service imports are local-only: ${svcImports}`);
  for (const f of ["app/lib/audit/approval-pending-sync.ts", "app/lib/audit/commercial-trace-sync-service.ts", "app/lib/audit/manual-line-mapping-service.ts"]) {
    assert.ok(!/anthropic|openai|@ai-sdk|ai-runtime/i.test(importsOf(f)), `${f}: no AI imports`);
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(src), `${f}: no write HTTP methods`);
  }
  const r = makeReader({}, []);
  assert.ok(Object.keys(r).every((k) => /^(list|get)/.test(k)), "mock reader is GET-only");
});

await test("37 Approval Pending matching semantics unchanged (mapping not authoritative)", async () => {
  const db = freshDb();
  const reader = makeReader({
    poList: [{ purchaseorder_id: "po_A", status: "pending_approval" }],
    pos: { po_A: zPo("po_A", pA(), { salesorder_id: "so_A" }) },
    sos: { so_A: zSo("so_A", sA()) },
  }, []);
  await syncApprovalPending({}, { db, reader, orgId: ORG });
  const strip = (rep: any) => JSON.parse(JSON.stringify(rep));
  const before = strip(getApprovalPendingDocuments(undefined, db));
  assert.ok(before.documents.length >= 1, "pending PO present");
  // OWNER override deliberately contradicting natural line identity
  mapLine(db, "so_A", "sl_2", "po_A", "pl_1");
  assert.deepStrictEqual(strip(getApprovalPendingDocuments(undefined, db)), before);
  const svcSrc = fs.readFileSync("app/lib/audit/approval-pending-service.ts", "utf8");
  assert.ok(!svcSrc.includes("manual-line-mapping"), "Approval Pending service does not consume manual mappings");
});

await test("38 Rate Guard unchanged (no manual-mapping integration in Rate Guard module)", () => {
  const svcSrc = fs.readFileSync("app/lib/audit/approval-pending-service.ts", "utf8");
  assert.ok(svcSrc.includes("evaluateRateGuard"));
  assert.ok(!/manual-line-mapping|validateActiveMappingsForDocuments|isMappingUsable/.test(svcSrc));
});

await test("34 operational DB unchanged by in-process tests (dynamic sentinel)", () => {
  assert.strictEqual(opSentinel(), SENTINEL_BEFORE);
});

console.log("\nSECTION 8: Delegated regression suites (child processes)");
const runSuite = (script: string, okPattern: RegExp) => {
  const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script], { cwd: process.cwd(), encoding: "utf8", timeout: 120000 });
  const out = (res.stdout || "") + (res.stderr || "");
  assert.strictEqual(res.status, 0, `${script} exit ${res.status}\n${out.slice(-800)}`);
  const m = out.match(okPattern);
  assert.ok(m, `${script}: summary not found`);
  return m![0];
};
await test("35 Phase-1 manual mapping regression PASS", () => { console.log("      " + runSuite("scripts/manual-line-mapping-tests.ts", /Results: \d+ passed, 0 failed[^\n]*/)); });
await test("36 Phase-2 manual mapping regression PASS", () => { console.log("      " + runSuite("scripts/manual-line-mapping-phase2-tests.ts", /Phase 2 Results: \d+ passed, 0 failed/)); });
await test("37b Approval Pending regression PASS", () => {
  const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/approval-pending-tests.ts"], { encoding: "utf8", timeout: 120000 });
  const out = res.stdout + res.stderr;
  assert.strictEqual(res.status, 0); assert.ok(!/\[FAIL\]/.test(out)); console.log(`      ${(out.match(/\[PASS\]/g) || []).length} PASS`);
});
await test("38b Rate Guard regression PASS", () => {
  // node:test summary lines differ by Node version/reporter: TAP "# pass 1" / "# fail 0"
  // (Node 22, non-TTY) vs spec "ℹ pass 1" / "ℹ fail 0" (Node 23+). Require exit 0 AND
  // exactly one pass count >= 1 AND exactly one fail count == 0, in either format.
  const res = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/test-rate-guard.ts"], { cwd: process.cwd(), encoding: "utf8", timeout: 120000 });
  const out = (res.stdout || "") + (res.stderr || "");
  assert.strictEqual(res.status, 0, `test-rate-guard exit ${res.status}\n${out.slice(-800)}`);
  const count = (label: string) => [...out.matchAll(new RegExp(`^(?:#|ℹ)\\s+${label}\\s+(\\d+)\\s*$`, "gm"))].map((m) => Number(m[1]));
  const pass = count("pass");
  const fail = count("fail");
  assert.strictEqual(pass.length, 1, `exactly one pass summary expected: ${JSON.stringify(pass)}`);
  assert.strictEqual(fail.length, 1, `exactly one fail summary expected: ${JSON.stringify(fail)}`);
  assert.ok(pass[0] >= 1, `Rate Guard pass count ${pass[0]}`);
  assert.strictEqual(fail[0], 0, `Rate Guard fail count ${fail[0]}`);
  console.log(`      Rate Guard: ${pass[0]} passed, ${fail[0]} failed`);
});

await test("34b operational DB sentinel unchanged after full suite", () => {
  assert.strictEqual(opSentinel(), SENTINEL_BEFORE);
});

console.log("\n═══════════════════════════════════════════════");
console.log(`  Phase-3 Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log("  ZOHO WRITE: 0 | Zoho GET (live): 0 | AI calls: 0");
console.log("═══════════════════════════════════════════════");
if (failures.length) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); }
try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
process.exit(failed > 0 ? 1 : 0);
