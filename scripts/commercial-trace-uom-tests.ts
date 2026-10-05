// ============================================================
// AP-UOM-BRIDGE-I1R — Commercial Trace shared-writer UOM consistency.
// Runs the REAL syncCommercialTrace() persistence path against an isolated
// temp DB (module hooks stub only the DB handle, token store and Zoho reader).
// Zoho calls: 0. Operational data/audit_workspace.db: never opened.
// Optional: CT_SERVICE_PATH=<abs path> runs the same cases against another
// copy of the writer (used only for out-of-repo diagnostics).
// ============================================================
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

register("./commercial-trace-uom-test-hooks.mjs", import.meta.url);

const { openAuditDatabaseAt } = await import("../app/lib/db/audit-database.ts");
const { syncApprovalPending } = await import("../app/lib/audit/approval-pending-sync.ts");
const { getApprovalPendingDocuments } = await import("../app/lib/audit/approval-pending-service.ts");
const servicePath = process.env.CT_SERVICE_PATH || path.join(process.cwd(), "app/lib/audit/commercial-trace-sync-service.ts");
const { syncCommercialTrace } = await import(pathToFileURL(servicePath).href);

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ct-uom-"));
const OPERATIONAL_DB = path.resolve(process.cwd(), "data", "audit_workspace.db");
const ORG = "TEST_ORG";
let n = 0;
function freshDb(): any {
  const f = path.join(TMP_ROOT, `ct-${++n}.db`);
  assert.notStrictEqual(path.resolve(f), OPERATIONAL_DB);
  return openAuditDatabaseAt(f);
}

function ln(id: string, itemId: string, rate: number, unit?: string) {
  const l: Record<string, unknown> = { line_item_id: id, item_id: itemId, name: "Service Item", description: "d", sku: "", quantity: 1, rate, item_total: rate };
  if (unit !== undefined) l.unit = unit;
  return l;
}
function so(lines: unknown[]) {
  return { salesorder_id: "so_1", salesorder_number: "SO-CT-1", customer_id: "c1", customer_name: "Cust", date: "2026-09-01", status: "open", currency: "INR", total: 100, line_items: lines };
}
function po(lines: unknown[]) {
  return { purchaseorder_id: "po_1", purchaseorder_number: "PO-CT-1", vendor_id: "v1", vendor_name: "Vend", date: "2026-09-02", status: "pending_approval", currency: "INR", total: 80,
    custom_fields: [{ label: "Sales Order No", api_name: "cf_sales_order_no", value: "SO-CT-1" }], line_items: lines };
}
function reader(p: any, s: any) {
  let calls = 0;
  const r = {
    get calls() { return calls; },
    listSalesOrders: async () => { calls++; return { salesorders: [{ ...s, line_items: undefined }] }; },
    getSalesOrder: async () => { calls++; return { salesorder: s }; },
    listPurchaseOrders: async () => { calls++; return { purchaseorders: [{ ...p, line_items: undefined }] }; },
    getPurchaseOrder: async () => { calls++; return { purchaseorder: p }; },
    listBills: async () => ({ bills: [] }), getBill: async () => ({ bill: null }),
    listInvoices: async () => ({ invoices: [] }), getInvoice: async () => ({ invoice: null }),
    getSalesOrderByNumber: async () => ({ salesorder_id: s.salesorder_id }),
  };
  return r;
}
async function runCt(db: any, p: any, s: any) {
  (globalThis as any).__CT_UOM_TEST__ = { db, orgId: ORG, reader: reader(p, s) };
  return syncCommercialTrace({});
}
const unitOf = (db: any, table: string, lineId: string) =>
  (db.prepare(`SELECT unit FROM ${table} WHERE line_item_id = ? AND source_run_id = 'COMMERCIAL_TRACE_ACTIVE'`).get(lineId) as any)?.unit;

let passed = 0, total = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  total++;
  try { await fn(); passed++; console.log(`  ✓ [PASS] ${name}`); }
  catch (e: any) { console.error(`  ✗ [FAIL] ${name}\n      ${e?.message || e}`); }
}

console.log(`COMMERCIAL TRACE UOM WRITER TESTS (${servicePath === path.join(process.cwd(), "app/lib/audit/commercial-trace-sync-service.ts") ? "repo writer" : servicePath})\n`);

await t("1/2. CT SO + PO line unit 'job' persists 'job'", async () => {
  const db = freshDb();
  await runCt(db, po([ln("pl1", "A", 80, "job")]), so([ln("sl1", "A", 100, "job")]));
  assert.strictEqual(unitOf(db, "audit_zoho_sales_order_lines", "sl1"), "job");
  assert.strictEqual(unitOf(db, "audit_zoho_purchase_order_lines", "pl1"), "job");
});

await t("3/5. Missing source unit → NULL (no fake default)", async () => {
  const db = freshDb();
  await runCt(db, po([ln("pl1", "A", 80)]), so([ln("sl1", "A", 100)]));
  assert.strictEqual(unitOf(db, "audit_zoho_sales_order_lines", "sl1"), null);
  assert.strictEqual(unitOf(db, "audit_zoho_purchase_order_lines", "pl1"), null);
});

await t("4. Source unit job → nos: re-sync (ON CONFLICT update) persists 'nos'", async () => {
  const db = freshDb();
  await runCt(db, po([ln("pl1", "A", 80, "job")]), so([ln("sl1", "A", 100, "job")]));
  await runCt(db, po([ln("pl1", "A", 80, "nos")]), so([ln("sl1", "A", 100, "nos")]));
  assert.strictEqual(unitOf(db, "audit_zoho_sales_order_lines", "sl1"), "nos");
  assert.strictEqual(unitOf(db, "audit_zoho_purchase_order_lines", "pl1"), "nos");
});

async function crossWriter(ctUnit: string) {
  const db = freshDb();
  const p0 = po([ln("pl1", "A", 120, "job")]), s0 = so([ln("sl1", "A", 100, "job")]);
  await syncApprovalPending({}, { db, orgId: ORG, reader: reader(p0, s0) as any });
  const before = getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-CT-1").documents[0].items[0];
  assert.strictEqual(before.unit, "job"); assert.strictEqual(before.refUnit, "job");
  await new Promise((r) => setTimeout(r, 5)); // guarantee strictly newer fetched_at
  await runCt(db, po([ln("pl1", "A", 120, ctUnit)]), so([ln("sl1", "A", 100, ctUnit)]));
  const hdr = db.prepare("SELECT source_run_id FROM audit_zoho_purchase_orders WHERE purchaseorder_id='po_1' ORDER BY fetched_at DESC LIMIT 1").get() as any;
  assert.strictEqual(hdr.source_run_id, "COMMERCIAL_TRACE_ACTIVE", "newest snapshot is the Commercial Trace one");
  return getApprovalPendingDocuments(undefined, db, undefined, undefined, "PO-CT-1").documents[0].items[0];
}

await t("7/11. AP snapshot unit 'job' then newer CT snapshot source 'job' → latest selection still 'job'", async () => {
  const item = await crossWriter("job");
  assert.strictEqual(item.unit, "job"); assert.strictEqual(item.refUnit, "job");
  assert.strictEqual(item.uomStatus, "UOM_MATCH");
  assert.strictEqual(item.rateCheckStatus, "ALERT", "Rate Guard does not regress to CANNOT_DETERMINE");
});

await t("8. Same sequence with CT source 'nos' → latest selection exposes 'nos'", async () => {
  const item = await crossWriter("nos");
  assert.strictEqual(item.unit, "nos"); assert.strictEqual(item.refUnit, "nos");
  assert.strictEqual(item.uomStatus, "UOM_MATCH");
});

fs.rmSync(TMP_ROOT, { recursive: true, force: true });
console.log(`\nCommercial Trace UOM writer: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
