// ============================================================
// CT-INVOICE-DESC-R2 — REPAIR-2 Invoice description + UOM
// cross-writer and narration safety tests.
//
// Section 7: Cross-writer regression — AP writes Invoice line first,
// then CT overwrites with newer snapshot. Verify description/unit
// preserved, changed, or NULL as appropriate.
//
// Section 8: Narration safety — CT-origin Invoice description is
// available to candidate narration comparison (compareNarrations,
// rankCandidate). DO NOT alter narration engine.
//
// Runs the REAL syncCommercialTrace() and syncApprovalPending()
// persistence paths against isolated temp DBs.
// Zoho calls: 0. Operational data/audit_workspace.db: never opened.
// ============================================================
import { register } from "node:module";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

register("./ct-writer-safety-test-hooks.mjs", import.meta.url);

const { openAuditDatabaseAt } = await import("../app/lib/db/audit-database.ts");
const { syncApprovalPending } = await import("../app/lib/audit/approval-pending-sync.ts");
const { syncCommercialTrace } = await import("../app/lib/audit/commercial-trace-sync-service.ts");
const { compareNarrations, rankCandidate } = await import("../app/lib/audit/invoice-line-narration-match.ts");

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ct-desc-"));
const OPERATIONAL_DB = path.resolve(process.cwd(), "data", "audit_workspace.db");
const ORG = "TEST_ORG";
let dbN = 0;

function freshDb(): any {
  const f = path.join(TMP_ROOT, `ct-desc-${++dbN}.db`);
  assert.notStrictEqual(path.resolve(f), OPERATIONAL_DB);
  return openAuditDatabaseAt(f);
}

// ---------- fixture helpers ----------

function invLine(
  id: string, itemId: string, rate: number,
  opts?: { description?: string; unit?: string; name?: string }
) {
  const l: Record<string, unknown> = {
    line_item_id: id,
    item_id: itemId,
    name: opts?.name ?? "Cable Tray",
    sku: "CT-01",
    quantity: 10,
    rate,
    item_total: rate * 10,
  };
  if (opts?.description !== undefined) l.description = opts.description;
  if (opts?.unit !== undefined) l.unit = opts.unit;
  return l;
}

function soLine(
  id: string, itemId: string, rate: number,
  opts?: { description?: string; unit?: string; name?: string }
) {
  const l: Record<string, unknown> = {
    line_item_id: id,
    item_id: itemId,
    name: opts?.name ?? "Cable Tray",
    sku: "CT-01",
    quantity: 10,
    rate,
    item_total: rate * 10,
  };
  if (opts?.description !== undefined) l.description = opts.description;
  if (opts?.unit !== undefined) l.unit = opts.unit;
  return l;
}

function makeInv(lines: unknown[], overrides?: Record<string, unknown>) {
  return {
    invoice_id: "inv_1",
    invoice_number: "INV-CT-1",
    customer_id: "c1",
    customer_name: "Cust",
    salesorder_id: "so_1",
    date: "2026-09-01",
    due_date: "2026-09-30",
    status: "pending_approval",
    currency_code: "INR",
    total: 1000,
    balance: 1000,
    sub_total: 900,
    tax_total: 100,
    total_taxable_amount: 900,
    adjustment: 0,
    is_inclusive_tax: false,
    discount_total: 0,
    discount_type: "entity_level",
    is_discount_before_tax: true,
    tds_amount: 0,
    total_retention_amount: 0,
    custom_fields: [],
    shipping_address: { customer_name: "DeliveryCust" },
    line_items: lines,
    ...overrides,
  };
}

function makeSo(lines: unknown[], overrides?: Record<string, unknown>) {
  return {
    salesorder_id: "so_1",
    salesorder_number: "SO-CT-1",
    customer_id: "c1",
    customer_name: "Cust",
    date: "2026-09-01",
    shipment_date: "2026-09-10",
    status: "open",
    currency: "INR",
    total: 1000,
    sub_total: 900,
    tax_total: 100,
    adjustment: 0,
    is_inclusive_tax: false,
    discount_total: 0,
    discount_type: "entity_level",
    is_discount_before_tax: true,
    custom_fields: [],
    shipping_address: { customer_name: "DeliveryCust" },
    line_items: lines,
    ...overrides,
  };
}

// ---------- reader factories ----------

/** Reader for AP sync (passed as parameter, not through hooks). */
function makeApReader(inv: any, so: any) {
  return {
    listSalesOrders: async () => ({ salesorders: [{ ...so, line_items: undefined }] }),
    getSalesOrder: async () => ({ salesorder: so }),
    listPurchaseOrders: async () => ({ purchaseorders: [] }),
    getPurchaseOrder: async () => ({ purchaseorder: null }),
    listBills: async () => ({ bills: [] }),
    getBill: async () => ({ bill: null }),
    listInvoices: async () => ({
      invoices: [{
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        status: inv.status,
        date: inv.date,
        total: inv.total,
        balance: inv.balance,
        currency_code: inv.currency_code,
      }],
    }),
    getInvoice: async () => ({ invoice: inv }),
    getSalesOrderByNumber: async () => ({ salesorder_id: so.salesorder_id }),
  };
}

/** Reader for CT sync (used through hooks via __CT_SAFETY_TEST__). */
function makeCtReader(inv: any, so: any) {
  return {
    listSalesOrders: async () => ({ salesorders: [{ ...so, line_items: undefined }] }),
    getSalesOrder: async () => ({ salesorder: so }),
    listPurchaseOrders: async () => ({ purchaseorders: [] }),
    getPurchaseOrder: async () => ({ purchaseorder: null }),
    listBills: async () => ({ bills: [] }),
    getBill: async () => ({ bill: null }),
    listInvoices: async () => ({
      invoices: [{
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        status: inv.status,
        date: inv.date,
        total: inv.total,
        balance: inv.balance,
        currency_code: inv.currency_code,
      }],
    }),
    getInvoice: async () => ({ invoice: inv }),
    listExpenses: async () => ({ expenses: [] }),
    getExpense: async () => ({ expense: null }),
    getSalesOrderByNumber: async () => ({ salesorder_id: so.salesorder_id }),
  };
}

async function runCt(db: any, inv: any, so: any) {
  const rd = makeCtReader(inv, so);
  (globalThis as any).__CT_SAFETY_TEST__ = {
    db, orgId: ORG, reader: rd, beginSeen: false, callLog: [],
  };
  return syncCommercialTrace({});
}

// ---------- query helpers ----------

const ctInvLine = (db: any, lineId: string) =>
  db.prepare(
    `SELECT description, unit FROM audit_zoho_invoice_lines
     WHERE line_item_id = ? AND source_run_id = 'COMMERCIAL_TRACE_ACTIVE'`
  ).get(lineId) as any;

// ---------- test runner ----------

let passed = 0, total = 0;
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

console.log("CT-INVOICE-DESC-R2 — REPAIR-2 Invoice Description + UOM Tests\n");

// ============================================================
// Section 7: Cross-writer regression
// ============================================================

const CABLE_TRAY_DESC = "Cable Tray 50 x 25 x 1.6 mm Item No 01";

await t("7A/B. AP desc+unit then CT same evidence → description preserved, unit preserved", async () => {
  const db = freshDb();
  const apInv = makeInv([
    invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  const apSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  await syncApprovalPending({}, { db, orgId: ORG, reader: makeApReader(apInv, apSo) as any });

  // Confirm AP wrote the invoice line
  const apRow = db.prepare(
    `SELECT description, unit FROM audit_zoho_invoice_lines
     WHERE line_item_id = 'il1' AND source_run_id = 'APPROVAL_PENDING_ACTIVE'`
  ).get() as any;
  assert.ok(apRow, "AP wrote invoice line");
  assert.ok(apRow.description, "AP description non-null");
  assert.strictEqual(apRow.unit, "Nos");

  await new Promise((r) => setTimeout(r, 10)); // guarantee strictly newer fetched_at

  // CT writes newer snapshot with same evidence
  const ctInv = makeInv(
    [invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" })],
    { status: "sent" }
  );
  const ctSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  await runCt(db, ctInv, ctSo);

  // Verify CT snapshot has the evidence
  const row = ctInvLine(db, "il1");
  assert.ok(row, "CT wrote invoice line");
  assert.strictEqual(row.description, CABLE_TRAY_DESC, "description preserved through CT snapshot");
  assert.strictEqual(row.unit, "Nos", "unit preserved through CT snapshot");

  // Verify CT is the newest snapshot for this invoice
  const hdr = db.prepare(
    `SELECT source_run_id FROM audit_zoho_invoices
     WHERE invoice_id = 'inv_1' ORDER BY fetched_at DESC LIMIT 1`
  ).get() as any;
  assert.strictEqual(hdr.source_run_id, "COMMERCIAL_TRACE_ACTIVE",
    "newest snapshot is the Commercial Trace one");
});

await t("7C. Changed description → newer CT description persisted", async () => {
  const db = freshDb();
  const newDesc = "Cable Tray 100 x 50 x 2.0 mm Item No 02";

  const apInv = makeInv([
    invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  const apSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  await syncApprovalPending({}, { db, orgId: ORG, reader: makeApReader(apInv, apSo) as any });

  await new Promise((r) => setTimeout(r, 10));

  const ctInv = makeInv(
    [invLine("il1", "A", 100, { description: newDesc, unit: "Nos" })],
    { status: "sent" }
  );
  const ctSo = makeSo([
    soLine("sl1", "A", 100, { description: newDesc, unit: "Nos" }),
  ]);
  await runCt(db, ctInv, ctSo);

  const row = ctInvLine(db, "il1");
  assert.strictEqual(row.description, newDesc, "newer CT description persisted");
});

await t("7D. Changed unit → newer CT unit persisted", async () => {
  const db = freshDb();

  const apInv = makeInv([
    invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  const apSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  await syncApprovalPending({}, { db, orgId: ORG, reader: makeApReader(apInv, apSo) as any });

  await new Promise((r) => setTimeout(r, 10));

  const ctInv = makeInv(
    [invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Mtr" })],
    { status: "sent" }
  );
  const ctSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Mtr" }),
  ]);
  await runCt(db, ctInv, ctSo);

  const row = ctInvLine(db, "il1");
  assert.strictEqual(row.unit, "Mtr", "newer CT unit persisted");
});

await t("7E. Missing description → NULL (not stale AP description)", async () => {
  const db = freshDb();

  const apInv = makeInv([
    invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  const apSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  await syncApprovalPending({}, { db, orgId: ORG, reader: makeApReader(apInv, apSo) as any });

  await new Promise((r) => setTimeout(r, 10));

  // CT source omits description entirely
  const ctInv = makeInv(
    [invLine("il1", "A", 100, { unit: "Nos" })],
    { status: "sent" }
  );
  const ctSo = makeSo([
    soLine("sl1", "A", 100, { unit: "Nos" }),
  ]);
  await runCt(db, ctInv, ctSo);

  const row = ctInvLine(db, "il1");
  assert.strictEqual(row.description, null, "missing description → NULL");
});

await t("7F. Missing unit → NULL (not stale AP unit)", async () => {
  const db = freshDb();

  const apInv = makeInv([
    invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  const apSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos" }),
  ]);
  await syncApprovalPending({}, { db, orgId: ORG, reader: makeApReader(apInv, apSo) as any });

  await new Promise((r) => setTimeout(r, 10));

  // CT source omits unit entirely
  const ctInv = makeInv(
    [invLine("il1", "A", 100, { description: CABLE_TRAY_DESC })],
    { status: "sent" }
  );
  const ctSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC }),
  ]);
  await runCt(db, ctInv, ctSo);

  const row = ctInvLine(db, "il1");
  assert.strictEqual(row.unit, null, "missing unit → NULL");
});

// ============================================================
// Section 8: Narration safety — CT-origin description available
// to candidate narration comparison
// ============================================================

await t("8. CT-origin Invoice description available to narration comparison", async () => {
  const db = freshDb();
  const ctInv = makeInv(
    [invLine("il1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos", name: "Cable Tray" })],
    { status: "sent" }
  );
  const ctSo = makeSo([
    soLine("sl1", "A", 100, { description: CABLE_TRAY_DESC, unit: "Nos", name: "Cable Tray" }),
  ]);
  await runCt(db, ctInv, ctSo);

  // Read the CT-written invoice line from DB — same SELECT the mapping service uses
  const invRow = db.prepare(
    `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit
     FROM audit_zoho_invoice_lines
     WHERE line_item_id = 'il1' AND source_run_id = 'COMMERCIAL_TRACE_ACTIVE'`
  ).get() as any;
  assert.ok(invRow, "CT-written invoice line exists");
  assert.strictEqual(invRow.description, CABLE_TRAY_DESC, "description persisted by CT writer");

  // Read the CT-written SO line
  const soRow = db.prepare(
    `SELECT line_item_id, item_id, item_name, description, quantity, rate, unit
     FROM audit_zoho_sales_order_lines
     WHERE line_item_id = 'sl1' AND source_run_id = 'COMMERCIAL_TRACE_ACTIVE'`
  ).get() as any;
  assert.ok(soRow, "CT-written SO line exists");
  assert.strictEqual(soRow.description, CABLE_TRAY_DESC, "SO description also persisted");

  // Use the REAL narration engine against CT-persisted evidence
  const narration = compareNarrations(
    invRow.item_name, invRow.description,
    soRow.item_name, soRow.description,
    invRow.unit, soRow.unit
  );
  assert.strictEqual(narration.level, "EXACT",
    "CT-persisted description yields EXACT narration match against identical SO description");
  assert.ok(narration.score >= 1.0, "score confirms EXACT match");

  // Full candidate ranking using the same DB evidence
  const ranking = rankCandidate(
    {
      line_item_id: invRow.line_item_id, item_id: invRow.item_id,
      item_name: invRow.item_name, description: invRow.description,
      quantity: invRow.quantity, rate: invRow.rate, unit: invRow.unit,
    },
    {
      line_item_id: soRow.line_item_id, item_id: soRow.item_id,
      item_name: soRow.item_name, description: soRow.description,
      quantity: soRow.quantity, rate: soRow.rate, unit: soRow.unit,
    }
  );
  assert.strictEqual(ranking.narration, "EXACT",
    "rankCandidate sees CT-persisted description");
  assert.strictEqual(ranking.narrationDetail.level, "EXACT",
    "narrationDetail confirms EXACT");
  assert.strictEqual(ranking.uom, "MATCH", "UOM evidence available via CT snapshot");
  assert.strictEqual(ranking.overall, "SUGGESTED", "full ranking: SUGGESTED");
});

// ---------- cleanup ----------
fs.rmSync(TMP_ROOT, { recursive: true, force: true });
console.log(`\nCT-INVOICE-DESC-R2: ${passed}/${total} passed`);
if (passed !== total) process.exit(1);
