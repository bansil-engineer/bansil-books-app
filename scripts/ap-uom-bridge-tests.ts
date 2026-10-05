// ============================================================
// AP-UOM-BRIDGE-I1 — Optional SO/PO UOM evidence through the ACTIVE
// Approval Pending path. All tests use isolated temporary databases;
// the operational data/audit_workspace.db is never opened.
// Zoho is never called: every sync uses an in-memory mock reader.
// ============================================================
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAuditDatabaseAt, ensureSoPoLineUnitColumns } from "../app/lib/db/audit-database.ts";
import { syncApprovalPending, syncApprovalPendingDocument } from "../app/lib/audit/approval-pending-sync.ts";
import {
  getApprovalPendingDocuments,
  compareUom,
  normalizeUnit,
  evaluateRateGuard,
} from "../app/lib/audit/approval-pending-service.ts";

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ap-uom-bridge-"));
const OPERATIONAL_DB = path.resolve(process.cwd(), "data", "audit_workspace.db");
const ORG = "TEST_ORG";
let dbCounter = 0;

function freshDb(): DatabaseSync {
  const file = path.join(TMP_ROOT, `uom-${++dbCounter}.db`);
  assert.notStrictEqual(path.resolve(file), OPERATIONAL_DB, "must never use operational DB");
  return openAuditDatabaseAt(file);
}

function colInfo(db: DatabaseSync, table: string, col: string): any {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).find((c) => c.name === col);
}

// ---------- fixtures ----------
function makeSo(opts: { id?: string; number?: string; lines: any[] }) {
  return {
    salesorder_id: opts.id || "so_1",
    salesorder_number: opts.number || "SO-UOM-1",
    customer_id: "cust_1",
    customer_name: "Customer One",
    date: "2026-09-01",
    status: "open",
    currency: "INR",
    total: 1000,
    line_items: opts.lines,
  };
}

function makePo(opts: { id?: string; number?: string; soNumber?: string; lines: any[] }) {
  return {
    purchaseorder_id: opts.id || "po_1",
    purchaseorder_number: opts.number || "PO-UOM-1",
    vendor_id: "ven_1",
    vendor_name: "Vendor One",
    date: "2026-09-02",
    status: "pending_approval",
    currency: "INR",
    total: 800,
    custom_fields: [{ label: "Sales Order No", api_name: "cf_sales_order_no", value: opts.soNumber || "SO-UOM-1" }],
    line_items: opts.lines,
  };
}

function line(id: string, itemId: string, rate: number, unit?: any, name = "Service Item", qty = 1) {
  const l: any = { line_item_id: id, item_id: itemId, name, description: "desc", sku: "", quantity: qty, rate, item_total: rate * qty };
  if (unit !== undefined) l.unit = unit;
  return l;
}

function readerFor(po: any, so: any) {
  return {
    listPurchaseOrders: async () => ({ purchaseorders: [{ purchaseorder_id: po.purchaseorder_id, status: po.status }] }),
    getPurchaseOrder: async (_o: string, id: string) => ({ purchaseorder: id === po.purchaseorder_id ? po : null }),
    listBills: async () => ({ bills: [] }),
    getBill: async () => ({ bill: null }),
    listInvoices: async () => ({ invoices: [] }),
    getInvoice: async () => ({ invoice: null }),
    listSalesOrders: async () => ({ salesorders: [] }),
    getSalesOrder: async (_o: string, id: string) => ({ salesorder: id === so.salesorder_id ? so : null }),
    getSalesOrderByNumber: async (_o: string, num: string) => (num === so.salesorder_number ? { salesorder_id: so.salesorder_id } : null),
  };
}

async function globalSyncAndEvaluate(po: any, so: any) {
  const db = freshDb();
  const res = await syncApprovalPending({}, { db, orgId: ORG, reader: readerFor(po, so) });
  const report = getApprovalPendingDocuments(undefined, db, undefined, undefined, po.purchaseorder_number);
  const doc = report.documents.find((d) => d.id === po.purchaseorder_id)!;
  return { db, res, doc };
}

let passed = 0;
let total = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (e: any) {
    console.error(`  ✗ [FAIL] ${name}\n      ${e?.message || e}`);
  }
}

async function run() {
  console.log("AP-UOM-BRIDGE-I1 TESTS (isolated temp DBs under " + TMP_ROOT + ")\n");

  // 1
  await t("1. Fresh active SO/PO line schema contains nullable unit", () => {
    const db = freshDb();
    for (const table of ["audit_zoho_sales_order_lines", "audit_zoho_purchase_order_lines"]) {
      const c = colInfo(db, table, "unit");
      assert.ok(c, `${table}.unit exists`);
      assert.strictEqual(c.notnull, 0, "nullable");
      assert.strictEqual(c.dflt_value, null, "no default fake unit");
      assert.strictEqual(String(c.type).toUpperCase(), "TEXT");
    }
    db.close();
  });

  // 2
  await t("2. Migration adds unit idempotently to legacy tables; existing rows stay valid (NULL)", () => {
    const file = path.join(TMP_ROOT, "legacy.db");
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE audit_zoho_sales_order_lines (organization_id TEXT NOT NULL, line_item_id TEXT NOT NULL, salesorder_id TEXT NOT NULL, source_run_id TEXT NOT NULL, item_id TEXT, item_name TEXT, sku TEXT, quantity REAL, rate REAL, amount REAL, description TEXT, PRIMARY KEY (organization_id, line_item_id, source_run_id));
      CREATE TABLE audit_zoho_purchase_order_lines (organization_id TEXT NOT NULL, line_item_id TEXT NOT NULL, purchaseorder_id TEXT NOT NULL, source_run_id TEXT NOT NULL, item_id TEXT, item_name TEXT, sku TEXT, quantity REAL, rate REAL, amount REAL, description TEXT, PRIMARY KEY (organization_id, line_item_id, source_run_id));
      INSERT INTO audit_zoho_sales_order_lines (organization_id, line_item_id, salesorder_id, source_run_id, item_id, quantity, rate) VALUES ('o','l1','s1','r1','i1',1,100);
      INSERT INTO audit_zoho_purchase_order_lines (organization_id, line_item_id, purchaseorder_id, source_run_id, item_id, quantity, rate) VALUES ('o','l1','p1','r1','i1',1,80);
    `);
    assert.strictEqual(colInfo(db, "audit_zoho_sales_order_lines", "unit"), undefined);
    ensureSoPoLineUnitColumns(db);
    ensureSoPoLineUnitColumns(db); // second run must be a no-op
    for (const table of ["audit_zoho_sales_order_lines", "audit_zoho_purchase_order_lines"]) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).filter((c) => c.name === "unit");
      assert.strictEqual(cols.length, 1, "exactly one unit column");
      assert.strictEqual(cols[0].notnull, 0);
      const row = db.prepare(`SELECT unit, rate FROM ${table}`).get() as any;
      assert.strictEqual(row.unit, null, "existing row unit is NULL (not fabricated)");
    }
    db.close();
    // Full init re-run on an already-migrated full schema is also idempotent
    const f2 = path.join(TMP_ROOT, "reopen.db");
    openAuditDatabaseAt(f2).close();
    const reopened = openAuditDatabaseAt(f2);
    assert.ok(colInfo(reopened, "audit_zoho_purchase_order_lines", "unit"));
    reopened.close();
  });

  // 3, 4, 14 — global path
  await t("3/4/14. Global Smart Sync persists SO and PO line unit 'job'", async () => {
    const so = makeSo({ lines: [line("sl1", "item_A", 100, "job")] });
    const po = makePo({ lines: [line("pl1", "item_A", 80, "job")] });
    const { db, res } = await globalSyncAndEvaluate(po, so);
    assert.strictEqual(res.failed, 0);
    const soRow = db.prepare("SELECT unit FROM audit_zoho_sales_order_lines WHERE line_item_id='sl1'").get() as any;
    const poRow = db.prepare("SELECT unit FROM audit_zoho_purchase_order_lines WHERE line_item_id='pl1'").get() as any;
    assert.strictEqual(soRow.unit, "job");
    assert.strictEqual(poRow.unit, "job");
    db.close();
  });

  // 5
  await t("5. Missing source unit persists NULL (global + targeted), not ''", async () => {
    const so = makeSo({ lines: [line("sl1", "item_A", 100)] });
    const po = makePo({ lines: [line("pl1", "item_A", 80)] });
    const { db } = await globalSyncAndEvaluate(po, so);
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_sales_order_lines").get() as any).unit, null);
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_purchase_order_lines").get() as any).unit, null);
    db.close();
    const db2 = freshDb();
    const r = await syncApprovalPendingDocument({ type: "PO", id: po.purchaseorder_id }, { db: db2, orgId: ORG, reader: readerFor(po, so) });
    assert.strictEqual(r.status, "SUCCESS");
    assert.strictEqual((db2.prepare("SELECT unit FROM audit_zoho_sales_order_lines").get() as any).unit, null);
    assert.strictEqual((db2.prepare("SELECT unit FROM audit_zoho_purchase_order_lines").get() as any).unit, null);
    db2.close();
  });

  // 15
  await t("15. Targeted PO sync + SO dependency persistence stores unit", async () => {
    const so = makeSo({ lines: [line("sl1", "item_A", 100, "job")] });
    const po = makePo({ lines: [line("pl1", "item_A", 80, "Job")] });
    const db = freshDb();
    const r = await syncApprovalPendingDocument({ type: "PO", id: po.purchaseorder_id, number: po.purchaseorder_number }, { db, orgId: ORG, reader: readerFor(po, so) });
    assert.strictEqual(r.status, "SUCCESS");
    assert.strictEqual(r.referenceDocumentRefreshed, true);
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_purchase_order_lines WHERE line_item_id='pl1'").get() as any).unit, "Job", "source value preserved verbatim");
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_sales_order_lines WHERE line_item_id='sl1'").get() as any).unit, "job");
    const so2 = db.prepare("SELECT source_run_id, organization_id FROM audit_zoho_sales_orders WHERE salesorder_id='so_1'").get() as any;
    const soLine = db.prepare("SELECT source_run_id, organization_id FROM audit_zoho_sales_order_lines WHERE line_item_id='sl1'").get() as any;
    assert.deepStrictEqual({ ...soLine }, { ...so2 }, "line snapshot coherent with header");
    db.close();
  });

  await t("15b. Unit newly provided by source on unchanged doc → global UPDATED and persisted; repeat → UNCHANGED", async () => {
    const db = freshDb();
    const soNoUnit = makeSo({ lines: [line("sl1", "item_A", 100)] });
    const poNoUnit = makePo({ lines: [line("pl1", "item_A", 80)] });
    await syncApprovalPending({}, { db, orgId: ORG, reader: readerFor(poNoUnit, soNoUnit) });
    const so = makeSo({ lines: [line("sl1", "item_A", 100, "job")] });
    const po = makePo({ lines: [line("pl1", "item_A", 80, "job")] });
    const r2 = await syncApprovalPending({}, { db, orgId: ORG, reader: readerFor(po, so) });
    assert.strictEqual(r2.created, 0);
    assert.strictEqual(r2.updated, 2, "PO + referenced SO updated by new UOM evidence");
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_purchase_order_lines").get() as any).unit, "job");
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_sales_order_lines").get() as any).unit, "job");
    const r3 = await syncApprovalPending({}, { db, orgId: ORG, reader: readerFor(po, so) });
    assert.strictEqual(r3.updated, 0);
    assert.strictEqual(r3.unchanged, 2);
    db.close();
  });

  // 6, 7, 8, 9 — pure comparability
  await t("6. Same units job/job → UOM_MATCH (comparable)", () => {
    assert.strictEqual(compareUom("job", "job"), "UOM_MATCH");
  });
  await t("7. Case/whitespace ' Job ' vs 'job' → UOM_MATCH; repeated spaces collapse", () => {
    assert.strictEqual(compareUom(" Job ", "job"), "UOM_MATCH");
    assert.strictEqual(compareUom("Sq  Mtr", "sq mtr"), "UOM_MATCH");
    assert.strictEqual(normalizeUnit("   "), null);
  });
  await t("8. Different units job/nos → UOM_MISMATCH → Rate Guard CANNOT_DETERMINE (no conversions)", () => {
    assert.strictEqual(compareUom("job", "nos"), "UOM_MISMATCH");
    assert.strictEqual(compareUom("Nos", "Pcs"), "UOM_MISMATCH");
    assert.strictEqual(compareUom("Kg", "Gram"), "UOM_MISMATCH");
    assert.strictEqual(evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MISMATCH", refRate: 100, rate: 120 }).rateCheckStatus, "CANNOT_DETERMINE");
  });
  await t("9. One unit missing → UOM_EVIDENCE_MISSING (not mismatch) → CANNOT_DETERMINE", () => {
    assert.strictEqual(compareUom(null, "job"), "UOM_EVIDENCE_MISSING");
    assert.strictEqual(compareUom("job", undefined), "UOM_EVIDENCE_MISSING");
    assert.strictEqual(compareUom("", "job"), "UOM_EVIDENCE_MISSING");
    assert.strictEqual(evaluateRateGuard({ isMapped: true, uomStatus: "UOM_EVIDENCE_MISSING", refRate: 100, rate: 120 }).rateCheckStatus, "CANNOT_DETERMINE");
  });

  // 10, 11 + equal + end-to-end states
  await t("10. Mapped + same unit + SO 100 / PO 80 → OK (end-to-end)", async () => {
    const { db, doc } = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_A", 80, "job")] }),
      makeSo({ lines: [line("sl1", "item_A", 100, "job")] })
    );
    const item = doc.items[0];
    assert.strictEqual(item.uomStatus, "UOM_MATCH");
    assert.strictEqual(item.uomMatch, true);
    assert.strictEqual(item.unit, "job");
    assert.strictEqual(item.refUnit, "job");
    assert.strictEqual(item.rateCheckStatus, "OK");
    assert.strictEqual(doc.verificationStatus, "MATCHED");
    db.close();
  });
  await t("10b. Mapped + same unit + SO 100 / PO 100 → OK", () => {
    assert.strictEqual(evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MATCH", refRate: 100, rate: 100 }).rateCheckStatus, "OK");
  });
  await t("11. Mapped + same unit (' Job ' vs 'job') + SO 100 / PO 120 → ALERT, premium 20 / 20%", async () => {
    const { db, doc } = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_A", 120, "job")] }),
      makeSo({ lines: [line("sl1", "item_A", 100, " Job ")] })
    );
    const item = doc.items[0];
    assert.strictEqual(item.uomStatus, "UOM_MATCH");
    assert.strictEqual(item.rateCheckStatus, "ALERT");
    assert.strictEqual(item.premiumAmount, 20);
    assert.strictEqual(item.premiumPercentage, 20);
    assert.strictEqual(doc.verificationStatus, "MATCHED", "rate alert does not alter qty verification");
    db.close();
  });
  await t("11b. Money precision unchanged: SO 100 / PO 100.01 → ALERT; PO 100.0004 → OK (3-dp rounding, no ₹0.01 grace)", () => {
    assert.strictEqual(evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MATCH", refRate: 100, rate: 100.01 }).rateCheckStatus, "ALERT");
    assert.strictEqual(evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MATCH", refRate: 100, rate: 100.0004 }).rateCheckStatus, "OK");
    assert.strictEqual(evaluateRateGuard({ isMapped: true, uomStatus: "UOM_MATCH", refRate: null, rate: 100 }).rateCheckStatus, "CANNOT_DETERMINE");
  });
  await t("8b/9b. End-to-end: known different units and missing unit → CANNOT_DETERMINE, counts unchanged", async () => {
    const a = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_A", 120, "nos")] }),
      makeSo({ lines: [line("sl1", "item_A", 100, "job")] })
    );
    assert.strictEqual(a.doc.items[0].uomStatus, "UOM_MISMATCH");
    assert.strictEqual(a.doc.items[0].rateCheckStatus, "CANNOT_DETERMINE");
    assert.strictEqual(a.doc.items[0].mismatchType, "MATCHED", "qty grain unaffected");
    assert.strictEqual(a.doc.verificationStatus, "MATCHED");
    a.db.close();
    const b = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_A", 120, "job")] }),
      makeSo({ lines: [line("sl1", "item_A", 100)] })
    );
    assert.strictEqual(b.doc.items[0].uomStatus, "UOM_EVIDENCE_MISSING");
    assert.strictEqual(b.doc.items[0].refUnit, null);
    assert.strictEqual(b.doc.items[0].unit, "job");
    assert.strictEqual(b.doc.items[0].rateCheckStatus, "CANNOT_DETERMINE");
    assert.strictEqual(b.doc.items[0].uomMatch, false);
    b.db.close();
  });

  // 12
  await t("12. Unmapped line with same units/rates → CANNOT_DETERMINE (+ ambiguous)", async () => {
    assert.strictEqual(evaluateRateGuard({ isMapped: false, uomStatus: "UOM_MATCH", refRate: 100, rate: 100 }).rateCheckStatus, "CANNOT_DETERMINE");
    const { db, doc } = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_X", 100, "job")] }),
      makeSo({ lines: [line("sl1", "item_A", 100, "job")] })
    );
    const unmapped = doc.items.find((i) => i.sourceLineId === "pl1")!;
    assert.strictEqual(unmapped.mismatchType, "ITEM_MAPPING_REQUIRED");
    assert.strictEqual(unmapped.rateCheckStatus, "CANNOT_DETERMINE");
    assert.strictEqual(unmapped.uomStatus, null);
    db.close();
    const amb = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_A", 100, "job")] }),
      makeSo({ lines: [line("sl1", "item_A", 100, "job"), line("sl2", "item_A", 100, "job")] })
    );
    const ai = amb.doc.items.find((i) => i.sourceLineId === "pl1")!;
    assert.strictEqual(ai.mismatchType, "AMBIGUOUS_REFERENCE_LINE");
    assert.strictEqual(ai.rateCheckStatus, "CANNOT_DETERMINE");
    amb.db.close();
  });

  // 13
  await t("13. Same-name independent lines keep strict line grain and their own units", async () => {
    const { db, doc } = await globalSyncAndEvaluate(
      makePo({ lines: [line("pl1", "item_A", 80, "job", "Cable Work"), line("pl2", "item_B", 120, "nos", "Cable Work")] }),
      makeSo({ lines: [line("sl1", "item_A", 100, "job", "Cable Work"), line("sl2", "item_B", 100, "mtr", "Cable Work")] })
    );
    const rows = db.prepare("SELECT line_item_id, unit FROM audit_zoho_purchase_order_lines ORDER BY rowid").all() as any[];
    assert.deepStrictEqual(rows.map((r) => [r.line_item_id, r.unit]), [["pl1", "job"], ["pl2", "nos"]]);
    const i1 = doc.items.find((i) => i.sourceLineId === "pl1")!;
    const i2 = doc.items.find((i) => i.sourceLineId === "pl2")!;
    assert.strictEqual(i1.displayLineNumber, 1);
    assert.strictEqual(i2.displayLineNumber, 2);
    assert.strictEqual(i1.refDisplayLineNumber, 1);
    assert.strictEqual(i2.refDisplayLineNumber, 2);
    assert.strictEqual(i1.uomStatus, "UOM_MATCH");
    assert.strictEqual(i1.rateCheckStatus, "OK");
    assert.strictEqual(i2.uomStatus, "UOM_MISMATCH");
    assert.strictEqual(i2.refUnit, "mtr");
    assert.strictEqual(i2.rateCheckStatus, "CANNOT_DETERMINE");
    db.close();
  });

  await t("Local-first: Approval Pending service has no Zoho reader / network dependency", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/lib/audit/approval-pending-service.ts"), "utf-8");
    assert.ok(!/zoho-read-transactions|fetch\(|zohoapis/.test(src), "service must stay local-first (no fetch-on-view for UOM)");
  });

  await t("15c. Targeted BILL sync persists referenced PO dependency unit", async () => {
    const po = makePo({ lines: [line("pl1", "item_A", 80, "job")] });
    const bill = { bill_id: "bill_1", bill_number: "BILL-1", vendor_id: "ven_1", vendor_name: "Vendor One", purchaseorder_id: po.purchaseorder_id, date: "2026-09-03", status: "pending_approval", total: 80, balance: 80, line_items: [line("bl1", "item_A", 80, "job")] };
    const reader: any = { ...readerFor(po, makeSo({ lines: [] })), getBill: async () => ({ bill }) };
    const db = freshDb();
    const r = await syncApprovalPendingDocument({ type: "BILL", id: "bill_1" }, { db, orgId: ORG, reader });
    assert.strictEqual(r.status, "SUCCESS");
    assert.strictEqual((db.prepare("SELECT unit FROM audit_zoho_purchase_order_lines WHERE line_item_id='pl1'").get() as any).unit, "job");
    db.close();
  });

  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  console.log(`\nAP-UOM-BRIDGE-I1: ${passed}/${total} passed`);
  if (passed !== total) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
