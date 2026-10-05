// ============================================================
// Phase 4D — Vendor / Historical Rate Engine tests
// Isolation: temp estimation DB, temp synthetic business/audit
// fixture DBs (exact numerical cases), and the immutable READ-ONLY
// snapshot scratch/claude-readonly-rate-source-20261004 for the real
// data sentinel. Never touches data/bansil_books.db, data/audit_workspace.db,
// the live runtime folder, Zoho, email, or any external service.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getEstimationDatabase, closeEstimationDatabase } from "../app/lib/db/estimation-database.ts";
import { getEstimationDbPath } from "../app/lib/db/db-resolver.ts";
import { isZohoWriteAllowed } from "../app/lib/ai/ceo/authority-policy.ts";
import { checkEstimationAuthority, routeEstimationTask } from "../app/lib/ai/estimation/authority.ts";
import { rateAgeDays } from "../app/lib/ai/estimation/evidence.ts";
import { RateSourceReader } from "../app/lib/ai/estimation/rate-source-reader.ts";
import { RateEvidenceStore } from "../app/lib/ai/estimation/rate-store.ts";
import {
  aliasKeyForName,
  applyCheckerReview,
  assessComparability,
  buildManualRateEvidence,
  canPromoteRateEvidenceToVerified,
  computeSeries,
  determineDocumentTaxBasis,
  enforceProvenanceGate,
  getRateReviewHook,
  guardAiRateSuggestion,
  isLandedChargeName,
  isProvenanceComplete,
  loadBoqLinesForRateLookup,
  lookupBoqLineRate,
  recordAiItemMatchSuggestion,
  recordManualRate,
  resolveItemMatch,
  runRateLookup,
  type ManualRateInput,
} from "../app/lib/ai/estimation/rate-engine.ts";
import {
  RATE_SOURCE_CAPABILITIES,
  listAdvertisedRateSourceTypes,
  type BoqLineRateInput,
  type RateEvidenceRecord,
} from "../app/lib/ai/estimation/rate-types.ts";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    fail++;
    console.log(`  ❌ [FAIL] ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
}
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const section = (t: string) => console.log(`\n=== ${t} ===`);

const ROOT = process.cwd();
const AS_OF = "2026-10-01";
const SNAPSHOT_DIR = path.join(ROOT, "scratch", "claude-readonly-rate-source-20261004");
const SNAP_BOOKS = path.join(SNAPSHOT_DIR, "bansil_books.db");
const SNAP_AUDIT = path.join(SNAPSHOT_DIR, "audit_workspace.db");
const OPERATIONAL_AI_DB = path.join(ROOT, "data", "ai_workspace.db");
const DEFAULT_EST_DB = path.join(ROOT, "data", "estimation", "estimation.sqlite");

// ---------- isolation (before any DB use) ----------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "phase4d-"));
process.env.ESTIMATION_DB_PATH = path.join(TMP, "estimation_4d.sqlite");
process.env.AI_WORKSPACE_DB_PATH = path.join(TMP, "ai_workspace_4d.db");
const FIX_BOOKS = path.join(TMP, "fixture_bansil_books.db");
const FIX_AUDIT = path.join(TMP, "fixture_audit_workspace.db");

// ---------- synthetic fixtures (real snapshot DDL subset) ----------
function buildFixtures(): void {
  const b = new DatabaseSync(FIX_BOOKS);
  b.exec(`
    CREATE TABLE purchase_bills (
      bill_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, bill_number TEXT NOT NULL, date TEXT NOT NULL,
      due_date TEXT, vendor_id TEXT NOT NULL, vendor_name TEXT NOT NULL, reference_number TEXT, status TEXT NOT NULL,
      total REAL NOT NULL, balance REAL NOT NULL, bill_url TEXT, is_verified_link INTEGER DEFAULT 0, created_time TEXT,
      last_modified_time TEXT, synced_at TEXT NOT NULL, source TEXT DEFAULT 'ZOHO_BOOKS', content_fingerprint TEXT, purchaseorder_id TEXT);
    CREATE TABLE purchase_bill_line_items (
      line_item_id TEXT PRIMARY KEY, bill_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL, sku TEXT,
      quantity REAL NOT NULL, rate REAL NOT NULL, line_total REAL NOT NULL, bbt_customer_id TEXT, bbt_customer_name TEXT,
      description TEXT, customer_data_status TEXT NOT NULL DEFAULT 'VERIFIED', synced_at TEXT NOT NULL, source TEXT DEFAULT 'ZOHO_BOOKS',
      purchase_line_customer_id TEXT, purchase_line_customer_name TEXT, unit TEXT, purchaseorder_item_id TEXT,
      FOREIGN KEY (bill_id) REFERENCES purchase_bills(bill_id) ON DELETE CASCADE);
  `);
  const bill = b.prepare(`INSERT INTO purchase_bills (bill_id, organization_id, bill_number, date, vendor_id, vendor_name, status, total, balance, last_modified_time, synced_at)
                          VALUES (?, 'ORG', ?, ?, ?, ?, 'paid', ?, 0, ?, '2026-09-30T00:00:00Z')`);
  const line = b.prepare(`INSERT INTO purchase_bill_line_items (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, description, unit, purchaseorder_item_id, synced_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-30T00:00:00Z')`);
  const V1 = ["V1", "Alpha Electricals"], V2 = ["V2", "Beta Traders"], V3 = ["V3", "Gamma Supplies"];
  // bill_id, no, date, vendor, total(header)
  const bills: Array<[string, string, string, string[], number]> = [
    ["B1", "BILL-001", "2026-06-01", V1, 6490],      // (5000 + 500) × 1.18
    ["B2", "BILL-002", "2026-08-15", V2, 10620],     // 9000 × 1.18
    ["B3", "BILL-003", "2026-09-10", V1, 3245],      // 2750 × 1.18
    ["B4", "BILL-004", "2025-01-10", V3, 47200],     // 40000 × 1.18 (ROLL)
    ["B5", "BILL-005", "2026-07-01", V2, 1440],      // header == lines → tax basis unknown
    ["B6", "BILL-006", "2026-07-05", V1, 613.6],     // unit missing
    ["B7", "BILL-007", "2026-07-06", V1, 531],       // qty×rate ≠ line_total
    ["B8", "BILL-008", "2026-09-02", V1, 1416],      // LUG V1 @12 (latest)
    ["B9", "BILL-009", "2026-09-01", V2, 1180],      // LUG V2 @10 (cheaper, older)
    ["B10", "BILL-010", "2026-05-05", V3, 3540],     // name-only MCB line
    ["B11", "BILL-011", "2026-04-04", V2, 1888],     // MCB
    ["B12", "BILL-012", "2026-06-20", V1, 2950],     // BOX
  ];
  for (const [id, no, d, v, t] of bills) bill.run(id, no, d, v[0], v[1], t, `${d}T10:00:00+0530`);
  // line, bill, item_id, item_name, sku, qty, rate, line_total, description, unit, po_line
  const lines: Array<[string, string, string, string, string | null, number, number, number, string | null, string | null, string | null]> = [
    ["L1", "B1", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 100, 50, 5000, null, "M", "PL1"],
    ["L1T", "B1", "I-TRANS", "Transportation", null, 1, 500, 500, null, "Nos", null],
    ["L2", "B2", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 200, 45, 9000, null, "M", null],
    ["L3", "B3", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 50, 55, 2750, null, "Mtr", null],
    ["L4", "B4", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 10, 4000, 40000, null, "Roll", null],
    ["L5", "B5", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 30, 48, 1440, null, "M", null],
    ["L6", "B6", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 10, 52, 520, null, null, null],
    ["L7", "B7", "I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", 10, 50, 450, null, "M", null],
    ["L8", "B8", "I-LUG", "Alu Lug", "LUG-01", 100, 12, 1200, null, "Nos", null],
    ["L9", "B9", "I-LUG", "Alu Lug", "LUG-01", 100, 10, 1000, null, "NOS", null],
    ["L10", "B10", "", "MCB 6A SP", null, 20, 150, 3000, null, "Nos", null],
    ["L11", "B11", "I-MCB", "MCB 6A SP", "MCB-6A", 10, 160, 1600, "6A SP C-curve", "Nos", null],
    ["L12", "B12", "I-BOX", "Junction Box 4 Way", "JB-4W", 5, 500, 2500, null, "Box", null],
  ];
  for (const l of lines) line.run(...l);
  b.close();

  const a = new DatabaseSync(FIX_AUDIT);
  a.exec(`
    CREATE TABLE audit_item_master (item_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT, sku TEXT, unit TEXT, status TEXT,
      rate TEXT, item_type TEXT, product_type TEXT, last_modified_time TEXT, synced_at TEXT NOT NULL);
    CREATE TABLE audit_purchase_orders (purchaseorder_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, purchaseorder_number TEXT,
      vendor_id TEXT, vendor_name TEXT, date TEXT, status TEXT, reference_number TEXT, total TEXT, last_modified_time TEXT, synced_at TEXT NOT NULL);
    CREATE TABLE audit_purchase_order_lines (line_item_id TEXT PRIMARY KEY,
      purchaseorder_id TEXT NOT NULL REFERENCES audit_purchase_orders(purchaseorder_id) ON DELETE CASCADE,
      item_id TEXT, sku TEXT, description TEXT, quantity TEXT, unit TEXT, rate TEXT, amount TEXT, item_order INTEGER, synced_at TEXT NOT NULL,
      salesorder_item_id TEXT);
  `);
  const item = a.prepare("INSERT INTO audit_item_master (item_id, organization_id, name, sku, unit, status, rate, synced_at) VALUES (?, 'ORG', ?, ?, ?, 'active', ?, '2026-09-30')");
  for (const it of [
    ["I-CABLE", "Copper Cable 4 sq mm", "CBL-4SQ", "M", "99"],
    ["I-MCB", "MCB 6A SP", "MCB-6A", "Nos", "999"],
    ["I-BOX", "Junction Box 4 Way", "JB-4W", "Box", "0"],
    ["I-LUG", "Alu Lug", "LUG-01", "Nos", "0"],
    ["I-TRAY", "Cable Tray 100mm", "CT-100", "M", "0"],
    ["I-DUP1", "Duplicate Name Item", "DUP-1", "Nos", "0"],
    ["I-DUP2", "Duplicate Name Item", "DUP-2", "Nos", "0"],
    ["I-TRANS", "Transportation", null, "Nos", "0"],
    ["I-FAP", "Fire Alarm Panel", "FAP-01", "Nos", "0"],
  ]) item.run(...it);
  const po = a.prepare("INSERT INTO audit_purchase_orders (purchaseorder_id, organization_id, purchaseorder_number, vendor_id, vendor_name, date, status, total, last_modified_time, synced_at) VALUES (?, 'ORG', ?, ?, ?, ?, ?, ?, ?, '2026-09-30')");
  const pol = a.prepare("INSERT INTO audit_purchase_order_lines (line_item_id, purchaseorder_id, item_id, sku, description, quantity, unit, rate, amount, item_order, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '2026-09-30')");
  po.run("PO1", "PO-001", "V1", "Alpha Electricals", "2026-05-20", "billed", "5900", "2026-05-20T10:00:00+0530");
  pol.run("PL1", "PO1", "I-CABLE", "CBL-4SQ", null, "100", "M", "50", "5000");
  po.run("PO2", "PO-002", "V2", "Beta Traders", "2026-09-20", "open", "15576", "2026-09-20T10:00:00+0530");
  pol.run("PL2", "PO2", "I-CABLE", "CBL-4SQ", null, "300", "M", "44", "13200");
  po.run("PO3", "PO-003", "V3", "Gamma Supplies", "2026-09-21", "cancelled", "1180", "2026-09-21T10:00:00+0530");
  pol.run("PL3", "PO3", "I-CABLE", "CBL-4SQ", null, "20", "M", "50", "1000");
  po.run("PO4", "PO-004", "V3", "Gamma Supplies", "2026-09-22", "draft", "1180", "2026-09-22T10:00:00+0530");
  pol.run("PL4", "PO4", "I-CABLE", "CBL-4SQ", null, "20", "M", "50", "1000");
  po.run("PO5", "PO-005", "V2", "Beta Traders", "2026-09-25", "open", "14160", "2026-09-25T10:00:00+0530");
  pol.run("PL5", "PO5", "I-TRAY", "CT-100", null, "40", "M", "300", "12000");
  a.close();
}

function line(id: string, description: string, uom: string | null, extra: Partial<BoqLineRateInput> = {}): BoqLineRateInput {
  return { boq_line_id: id, project_id: "P4D-TEST", description, uom, ...extra };
}
const ev = (r: { evidence: RateEvidenceRecord[] }, recordId: string) => r.evidence.find((e) => e.source_record_id === recordId);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}
/** Module specifiers of every import in a source file. */
function importLines(src: string): string[] {
  return [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

async function main(): Promise<void> {
  console.log("PHASE 4D — VENDOR / HISTORICAL RATE ENGINE TESTS");
  console.log(`temp dir: ${TMP}`);
  const opAiBefore = fs.existsSync(OPERATIONAL_AI_DB) ? sha(OPERATIONAL_AI_DB) : null;
  const defaultEstExistedBefore = fs.existsSync(DEFAULT_EST_DB);
  const snapshotAvailable = fs.existsSync(SNAP_BOOKS) && fs.existsSync(SNAP_AUDIT);
  const snapBooksBefore = snapshotAvailable ? sha(SNAP_BOOKS) : null;
  const snapAuditBefore = snapshotAvailable ? sha(SNAP_AUDIT) : null;

  buildFixtures();
  const fixBooksBefore = sha(FIX_BOOKS);
  const fixAuditBefore = sha(FIX_AUDIT);

  const estDb = getEstimationDatabase();
  const store = new RateEvidenceStore(estDb);
  const reader = new RateSourceReader({ bansilBooksDbPath: FIX_BOOKS, auditWorkspaceDbPath: FIX_AUDIT });
  const base = { reader, asOfDate: AS_OF };

  // ======================================================
  section("1. Item matching");
  const m1 = resolveItemMatch(reader, { itemId: "I-CABLE" });
  assert(m1.status === "MATCHED" && m1.method === "EXACT_ITEM_ID" && m1.item?.item_id === "I-CABLE", "1 exact item_id match", m1);
  const m2 = resolveItemMatch(reader, { itemCode: " mcb-6a " });
  assert(m2.status === "MATCHED" && m2.method === "EXACT_ITEM_CODE" && m2.item?.item_id === "I-MCB", "2 exact item_code match", m2);

  const aliasCand = store.addCandidate({ queryKey: aliasKeyForName("4 sqmm Cu cable"), candidateItemId: "I-CABLE", method: "OWNER_ALIAS", suggestedBy: "Owner" });
  let approveWithoutStampBlocked = false;
  try { store.approveCandidate(aliasCand, "", ""); } catch { approveWithoutStampBlocked = true; }
  store.approveCandidate(aliasCand, "Owner", "2026-09-30T10:00:00Z");
  const m3 = resolveItemMatch(reader, { description: "4 SQMM cu-cable" }, store.listApprovedAliases());
  assert(approveWithoutStampBlocked && m3.status === "MATCHED" && m3.method === "APPROVED_ALIAS" && m3.item?.item_id === "I-CABLE", "3 approved alias match (approval stamp mandatory)", m3);

  const fuzzy = lookupBoqLineRate(base, line("BQ-FUZZY", "Copper Cable 6 sq mm", "M"));
  assert(fuzzy.item_match_status === "CANDIDATE_ONLY" && fuzzy.item_match.candidates.some((c) => c.item_id === "I-CABLE" && c.status === "CANDIDATE_ONLY") &&
    fuzzy.evidence.length === 0 && fuzzy.best_available_evidence === null && fuzzy.rate_status === "CANDIDATE_ONLY", "4 fuzzy match not verified (CANDIDATE_ONLY, no evidence)", fuzzy.item_match);

  const unresolved = lookupBoqLineRate(base, line("BQ-UNRES", "Hydraulic Excavator 20T", "Nos"));
  assert(unresolved.item_match_status === "UNRESOLVED" && unresolved.rate_status === "UNRESOLVED_ITEM" && unresolved.evidence.length === 0 &&
    unresolved.last_purchase === null && unresolved.possible_next_actions.some((a) => a.action === "OWNER_ITEM_MAPPING" && !a.executed), "5 unresolved item safe", unresolved.rate_status);

  const amb = resolveItemMatch(reader, { description: "duplicate name item" });
  assert(amb.status === "AMBIGUOUS" && amb.item === null, "5b ambiguous exact name stays unresolved (no auto-pick)", amb);

  // ======================================================
  section("2. Bill / PO evidence");
  const cable = lookupBoqLineRate(base, line("BQ-CABLE", "Copper Cable 4 sq mm", "M", { item_id: "I-CABLE" }));
  const lp = cable.last_purchase;
  assert(!!lp && lp.source_record_id === "L3" && lp.rate === 55 && lp.vendor_id === "V1" && lp.vendor_name === "Alpha Electricals" &&
    lp.date === "2026-09-10" && lp.quantity === 50 && lp.uom === "Mtr" && lp.source_type === "BILL_RATE" && lp.source_document === "BILL-003" &&
    lp.tax_basis === "GST_EXCLUSIVE" && lp.freight_basis === "UNKNOWN" && lp.age_days === 21, "6 last Bill rate fully explained", lp);
  assert(cable.po_series.last?.source_record_id === "PL2" && cable.po_series.last?.rate === 44 && cable.po_series.count === 2, "7 last PO rate", cable.po_series);
  const pl2 = ev(cable, "PL2");
  const tray = lookupBoqLineRate(base, line("BQ-TRAY", "Cable Tray 100mm", "M"));
  assert(pl2?.verification_status === "PROVISIONAL" && pl2.commitment_status === "PROVISIONAL_PO" && pl2.warnings.includes("PO_NOT_BILLED_PROVISIONAL") &&
    tray.rate_status === "MISSING_RATE" && tray.po_series.count === 1 && tray.bill_series.count === 0 && tray.warnings.includes("ONLY_PROVISIONAL_OR_ASSUMPTION_EVIDENCE"),
    "8 PO without Bill provisional (not verified, line stays MISSING_RATE)", { pl2: pl2?.verification_status, tray: tray.rate_status });
  const l1 = ev(cable, "L1");
  const pl1 = ev(cable, "PL1");
  assert(!!l1 && !!pl1 && l1.source_type === "BILL_RATE" && pl1.source_type === "PO_RATE" && l1.rate_evidence_id !== pl1.rate_evidence_id &&
    l1.linked_po_line_id === "PL1" && pl1.linked_bill_line_ids.join() === "L1" && pl1.commitment_status === "COMMITTED_PO" &&
    !cable.bill_series.points.some((p) => p.source_record_id.startsWith("PL")) && !cable.po_series.points.some((p) => p.source_record_id.startsWith("L")),
    "9 Bill and PO remain separate", { l1: l1?.linked_po_line_id, pl1: pl1?.linked_bill_line_ids });
  const l2 = ev(cable, "L2")!;
  assert(l2.vendor_id === "V2" && l2.vendor_name === "Beta Traders", "10 vendor identity preserved");
  assert(l2.source_date === "2026-08-15", "11 source date preserved");
  assert(l2.source_record_id === "L2" && l2.provenance?.recordId === "L2" && l2.source_document === "BILL-002" && l2.source_document_id === "B2",
    "12 source record ID preserved", l2.provenance);
  assert(l2.rate === 45 && l2.quantity === 200 && pl2?.rate === 44, "13 rate exact (no rounding / blending)");
  const l3 = ev(cable, "L3")!;
  const l3c = cable.comparable.find((c) => c.rate_evidence_id === l3.rate_evidence_id)!;
  assert(l3.uom === "Mtr" && l3c.status === "COMPARABLE" && l3c.comparable_uom === "M", "14 UOM exact (source UOM preserved; spelling alias canonical only)", { uom: l3.uom, c: l3c });

  // ======================================================
  section("3. UOM / pack safety");
  const rmtNo = assessComparability(l2, "Rmt");
  const rmtYes = assessComparability(l2, "Rmt", { uomAliases: [{ alias: "Rmt", canonical: "M", approvedBy: "Owner", approvedAt: "2026-09-30T00:00:00Z" }] });
  const rmtUnstamped = assessComparability(l2, "Rmt", { uomAliases: [{ alias: "Rmt", canonical: "M", approvedBy: "", approvedAt: "" }] });
  assert(rmtNo.status === "RATE_NOT_COMPARABLE" && rmtYes.status === "COMPARABLE" && rmtYes.comparable_rate === 45 &&
    rmtYes.conversion_applied === "APPROVED_UOM_ALIAS" && rmtUnstamped.status === "RATE_NOT_COMPARABLE", "15 approved UOM alias (unapproved alias ignored)", { rmtNo, rmtYes });
  const l4 = ev(cable, "L4")!;
  const rollNo = cable.comparable.find((c) => c.rate_evidence_id === l4.rate_evidence_id)!;
  const rollYes = assessComparability(l4, "M", { uomConversions: [{ fromUom: "Roll", toUom: "M", factor: 100, itemRef: "I-CABLE", approvedBy: "Owner", approvedAt: "2026-09-30" }] });
  const box = lookupBoqLineRate(base, line("BQ-BOX", "Junction Box 4 Way", "Nos"));
  assert(rollNo.status === "RATE_NOT_COMPARABLE" && rollNo.reasons.some((r) => r.startsWith("UOM_MISMATCH_NO_APPROVED_CONVERSION")) &&
    rollYes.status === "COMPARABLE" && rollYes.comparable_rate === 40 && rollYes.comparable_quantity === 1000 &&
    box.rate_status === "RATE_NOT_COMPARABLE" && box.comparable_evidence_count === 0, "16 unapproved conversion blocked (Roll→M, Box→Nos)", { rollNo, box: box.rate_status });

  const ctx = { asOfDate: AS_OF, freshnessPolicy: null };
  const manualBase: ManualRateInput = {
    sourceType: "PROVISIONAL_RATE", itemId: "I-BOX", description: "Junction box", rate: 500, uom: "Box", taxBasis: "GST_EXCLUSIVE",
    freightBasis: "UNKNOWN", sourceDate: "2026-09-28", basis: "Phone enquiry note", enteredBy: "Estimator", enteredAt: "2026-09-28T09:00:00Z",
  };
  const packUnknown = buildManualRateEvidence({ ...manualBase, pack: { rate_per: "PACK", pack_quantity: null, pack_uom: null } }, ctx);
  const packKnown = buildManualRateEvidence({ ...manualBase, pack: { rate_per: "PACK", pack_quantity: 10, pack_uom: "Nos" } }, ctx);
  const pu = assessComparability(packUnknown, "Nos");
  const pk = assessComparability(packKnown, "Nos");
  assert(pu.status === "RATE_NOT_COMPARABLE" && pu.reasons.includes("PACK_SIZE_UNKNOWN") && pk.status === "COMPARABLE" && pk.comparable_rate === 50,
    "17 pack-size mismatch blocked (divides only with explicit pack qty)", { pu, pk });

  // ======================================================
  section("4. Tax / freight / landed");
  assert(l2.tax_basis === "GST_EXCLUSIVE" && l2.gst_rate_percent === null && l2.tax_basis_source.startsWith("HEADER_TOTAL_EXCEEDS") &&
    cable.comparable.find((c) => c.rate_evidence_id === l2.rate_evidence_id)?.comparable_rate === 45, "18 GST-exclusive supported", l2.tax_basis_source);
  const incl = buildManualRateEvidence({ ...manualBase, uom: "Nos", rate: 118, taxBasis: "GST_INCLUSIVE", gstRatePercent: 18 }, ctx);
  const inclNoRate = buildManualRateEvidence({ ...manualBase, uom: "Nos", rate: 118, taxBasis: "GST_INCLUSIVE" }, ctx);
  const ic = assessComparability(incl, "Nos");
  const inc = assessComparability(inclNoRate, "Nos");
  assert(ic.status === "COMPARABLE" && ic.comparable_rate === 100 && inc.status === "RATE_NOT_COMPARABLE" && inc.reasons.includes("GST_RATE_NOT_EXPLICIT"),
    "19 GST-inclusive conversion only with explicit rate", { ic, inc });
  const l5 = ev(cable, "L5")!;
  const dbEvidence = cable.evidence.filter((e) => e.source_type === "BILL_RATE" || e.source_type === "PO_RATE");
  assert(dbEvidence.every((e) => e.gst_rate_percent === null) && l5.tax_basis === "UNKNOWN" && l5.verification_status === "REQUIRES_OWNER_REVIEW" &&
    cable.comparable.find((c) => c.rate_evidence_id === l5.rate_evidence_id)?.status === "RATE_NOT_COMPARABLE" &&
    determineDocumentTaxBasis(100, 100).basis === "UNKNOWN" && determineDocumentTaxBasis(140, 100).basis === "UNKNOWN",
    "20 GST never assumed (no 18% default; ambiguous header → UNKNOWN)", l5.tax_basis_source);
  const fIn = buildManualRateEvidence({ ...manualBase, freightBasis: "INCLUDED" }, ctx);
  const fEx = buildManualRateEvidence({ ...manualBase, freightBasis: "EXCLUDED" }, ctx);
  assert(fIn.freight_basis === "INCLUDED" && fIn.freight_basis_source === "DECLARED_BY_ENTRY", "21 freight included preserved");
  assert(fEx.freight_basis === "EXCLUDED", "22 freight excluded preserved");
  assert(dbEvidence.every((e) => e.freight_basis === "UNKNOWN" && e.freight_basis_source === "NO_FREIGHT_FIELD_ON_SOURCE"), "23 unknown freight remains unknown");
  const trans = lookupBoqLineRate(base, line("BQ-TRANS", "Transportation", "Nos"));
  assert(l1!.same_document_landed_charges.length === 1 && l1!.same_document_landed_charges[0].source_record_id === "L1T" &&
    l1!.same_document_landed_charges[0].amount === 500 && l1!.rate === 50 && l1!.landed_cost_basis !== "DECLARED_INCLUDES_LANDED" &&
    !cable.evidence.some((e) => e.source_record_id === "L1T") && isLandedChargeName("Transportation Inward") &&
    trans.evidence.length > 0 && trans.evidence.every((e) => e.is_landed_charge_line && e.verification_status === "REQUIRES_OWNER_REVIEW") && trans.bill_series.count === 0,
    "24 landed charges separate (listed, never allocated)", l1!.same_document_landed_charges);

  // ======================================================
  section("5. Freshness");
  assert(l3.age_days === 21 && l2.age_days === 47 && rateAgeDays("2026-06-01", AS_OF) === 122, "25 age_days correct", { l3: l3.age_days, l2: l2.age_days });
  assert(cable.evidence.every((e) => e.freshness === "UNKNOWN") && cable.warnings.includes("FRESHNESS_POLICY_NOT_CONFIGURED"), "26 freshness threshold not invented");
  const policy = { currentMaxAgeDays: 30, agingMaxAgeDays: 90, policyRef: "TEST-POLICY-ONLY" };
  const cableP = lookupBoqLineRate({ ...base, freshnessPolicy: policy }, line("BQ-CABLE", "Copper Cable 4 sq mm", "M", { item_id: "I-CABLE" }));
  assert(ev(cableP, "L3")?.freshness === "CURRENT" && ev(cableP, "L2")?.freshness === "AGING" && ev(cableP, "L1")?.freshness === "STALE" &&
    !!ev(cableP, "L1")?.warnings.some((w) => w.startsWith("STALE_BY_POLICY:TEST-POLICY-ONLY")) && cableP.warnings.includes("STALE_EVIDENCE_PRESENT") &&
    !cable.evidence.some((e) => e.freshness === "STALE"), "27 stale evidence flagged only with policy");

  // ======================================================
  section("6. Historical series");
  const s = cable.bill_series;
  assert(s.points.map((p) => p.source_record_id).join() === "L1,L2,L3" && s.count === 3, "28 series sort correct (date asc)", s.points);
  assert(s.min === 45, "29 min", s.min);
  assert(s.max === 55, "30 max", s.max);
  assert(s.median === 50 && computeSeries([10, 20, 30, 40].map((r, i) => ({ rate_evidence_id: `x${i}`, source_record_id: `x${i}`, date: `2026-01-0${i + 1}`, rate: r, quantity: 1, vendor_id: null })), "ACTUAL_PURCHASE_BILL", "M").median === 25,
    "31 median (odd and even counts)", s.median);
  assert(s.weighted_average === 47.8571 && s.total_quantity === 350, "32 weighted average = Σ(rate×qty)/Σqty", s.weighted_average);
  assert(s.last?.source_record_id === "L3" && s.last.rate === 55 && s.is_tender_rate === false, "33 last", s.last);

  // ======================================================
  section("7. Vendor history");
  const lug = lookupBoqLineRate(base, line("BQ-LUG", "Alu Lug", "Nos"));
  assert(lug.vendor_history.length === 2 && lug.vendor_history[0].vendor_id === "V1" && lug.vendor_history[1].vendor_id === "V2" &&
    lug.vendor_history[0].bill_series.last?.rate === 12 && lug.vendor_history[1].bill_series.last?.rate === 10, "34 multi-vendor evidence preserved", lug.vendor_history.map((v) => v.vendor_name));
  const cheapest = lug.evidence.filter((e) => e.verification_status === "VERIFIED").sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0];
  const bestLug = lug.evidence.find((e) => e.rate_evidence_id === lug.best_available_evidence?.rate_evidence_id);
  assert(lug.vendor_auto_selected === false && !!bestLug && bestLug.source_record_id === "L8" && bestLug.rate_evidence_id !== cheapest.rate_evidence_id &&
    lug.best_available_evidence?.use_as_tender_rate === false && lug.best_available_evidence.decision === "ESTIMATOR_DECISION_REQUIRED",
    "35 cheapest vendor not auto-selected", lug.best_available_evidence);
  const mcb = lookupBoqLineRate(base, line("BQ-MCB", "MCB 6A SP", "Nos"));
  assert(!!ev(mcb, "L10") && ev(mcb, "L10")!.item_match_method === "EXACT_NORMALIZED_NAME" && mcb.best_available_evidence === null &&
    mcb.warnings.includes("ITEM_SPECIFICATION_HETEROGENEOUS"), "35b heterogeneous specifications → no best-evidence pointer", mcb.warnings);

  // ======================================================
  section("8. Missing / manual / AI");
  const fap = lookupBoqLineRate(base, line("BQ-FAP", "Fire Alarm Panel", "Nos"));
  const rfqAction = fap.possible_next_actions.find((a) => a.action === "VENDOR_RFQ");
  assert(fap.rate_status === "MISSING_RATE" && fap.evidence.length === 0 && fap.last_purchase === null && fap.best_available_evidence === null &&
    fap.bill_series.count === 0 && !!rfqAction && rfqAction.executed === false && rfqAction.requires_owner_approval === true &&
    fap.possible_next_actions.some((a) => a.action === "OWNER_APPROVED_MANUAL_ASSUMPTION"), "36 MISSING_RATE (no number forced)", fap.possible_next_actions);

  const unapproved = recordManualRate(store, "P4D-TEST", "I-FAP", { ...manualBase, sourceType: "MANUAL_APPROVED_RATE", itemId: "I-FAP", uom: "Nos", rate: 25000, description: "FAP budget" }, AS_OF);
  const fapWithAssumption = lookupBoqLineRate({ ...base, store }, line("BQ-FAP", "Fire Alarm Panel", "Nos"));
  assert(unapproved.verification_status === "ASSUMPTION" && unapproved.warnings.includes("OWNER_APPROVAL_MISSING") &&
    fapWithAssumption.rate_status === "MISSING_RATE" && fapWithAssumption.evidence.some((e) => e.verification_status === "ASSUMPTION") &&
    fapWithAssumption.best_available_evidence === null, "37 unapproved manual rate stays assumption", unapproved.verification_status);

  const approved = recordManualRate(store, "P4D-TEST", "I-FAP", { ...manualBase, sourceType: "MANUAL_APPROVED_RATE", itemId: "I-FAP", uom: "Nos", rate: 24000,
    description: "FAP Owner figure", ownerApproval: { approvedBy: "Owner", approvedAt: "2026-09-30T12:00:00Z" } }, AS_OF);
  let verifiedManualRejected = false;
  try { store.putManualRate("P4D-TEST", "I-FAP", { ...approved, verification_status: "VERIFIED" }); } catch { verifiedManualRejected = true; }
  assert(approved.verification_status === "OWNER_APPROVED_MANUAL_RATE" && approved.approval?.approvedBy === "Owner" && approved.approval.approvedAt === "2026-09-30T12:00:00Z" &&
    approved.provenance?.tier === "APPROVED_ESTIMATOR_ASSUMPTION" && !canPromoteRateEvidenceToVerified(approved).allowed && verifiedManualRejected,
    "38 Owner-approved manual rate labelled (never VERIFIED, provenance tracked)", approved.approval);

  const aiGuard = guardAiRateSuggestion("Typical market rate is ₹999 per metre");
  const aiEvidence: RateEvidenceRecord = { ...l2, verification_status: "VERIFIED", provenance: { ...l2.provenance!, tier: "AI_INFERENCE" } };
  assert(aiGuard.value === null && aiGuard.status === "MISSING_RATE" && !canPromoteRateEvidenceToVerified(aiEvidence).allowed, "39 AI cannot create verified rate", aiGuard);
  const aiCand = recordAiItemMatchSuggestion(store, { projectId: "P4D-TEST", boqLineId: "BQ-AI", description: "Smoke detector photoelectric", itemId: "I-FAP", model: "test-model" });
  const aiRow = store.getCandidate(aiCand)!;
  const aiLookup = lookupBoqLineRate({ ...base, store, approvedAliases: store.listApprovedAliases(), aiItemSuggestions: { "BQ-AI": [{ item_id: "I-FAP" }] } },
    line("BQ-AI", "Smoke detector photoelectric", "Nos"));
  assert(aiRow.status === "CANDIDATE" && aiRow.method === "AI_SUGGESTION" && !store.listApprovedAliases().some((a) => a.query_key === aliasKeyForName("Smoke detector photoelectric")) &&
    aiLookup.item_match_status === "CANDIDATE_ONLY" && aiLookup.item_match.candidates.some((c) => c.method === "AI_SUGGESTION") &&
    aiLookup.evidence.length === 0, "40 AI suggestion candidate-only", aiLookup.item_match);

  // ======================================================
  section("9. Provenance");
  const factual = cable.evidence.filter((e) => e.source_type === "BILL_RATE" || e.source_type === "PO_RATE");
  assert(factual.length > 0 && factual.every((e) => isProvenanceComplete(e.provenance)) &&
    cable.evidence.filter((e) => e.verification_status === "VERIFIED").every((e) => isProvenanceComplete(e.provenance)), "41 provenance mandatory");
  const noProv = enforceProvenanceGate({ ...l2, provenance: null });
  assert(l2.verification_status === "VERIFIED" && noProv.verification_status === "REQUIRES_OWNER_REVIEW" && noProv.warnings.includes("PROVENANCE_MISSING") &&
    !canPromoteRateEvidenceToVerified({ ...l2, provenance: null }).allowed, "42 missing provenance blocks verified status");

  // ======================================================
  section("10. BOQ integration (Phase 4C lines) & boundaries");
  estDb.prepare(`INSERT INTO estimation_boq_lines (boq_line_id, project_id, document_id, revision, description, quantity, uom, item_code, line_status)
                 VALUES (?, 'P4D-BOQ', 'DOC-1', 1, ?, ?, ?, ?, 'EXTRACTED')`).run("BOQ-0001", "Copper Cable 4 sq mm", 500, "Mtr", null);
  estDb.prepare(`INSERT INTO estimation_boq_lines (boq_line_id, project_id, document_id, revision, description, quantity, uom, item_code, line_status)
                 VALUES (?, 'P4D-BOQ', 'DOC-1', 1, ?, ?, ?, ?, 'EXTRACTED')`).run("BOQ-0002", "Fire Alarm Panel", 1, "Nos", "FAP-01");
  const boqLines = loadBoqLinesForRateLookup(estDb, "P4D-BOQ", "DOC-1");
  const run1 = runRateLookup({ ...base, store, projectId: "P4D-BOQ", boqLines });
  const sel = store.listSelections(run1.run_id);
  assert(run1.results.map((r) => r.boq_line_id).join() === "BOQ-0001,BOQ-0002" && sel.map((r) => r.boq_line_id).join() === "BOQ-0001,BOQ-0002" &&
    run1.results[0].comparable_evidence_count >= 3 && Array.isArray(run1.results[0].warnings) && Array.isArray(run1.results[0].clarifications) &&
    run1.results[1].rate_status === "MISSING_RATE" && sel.every((r) => Number(r.use_as_tender_rate) === 0 && Number(r.vendor_auto_selected) === 0),
    "43 boq_line_id preserved (+ item_match_status, comparable count, warnings, clarifications)", sel.map((r) => [r.boq_line_id, r.rate_status]));

  const keysDeep = (o: unknown, acc = new Set<string>()): Set<string> => {
    if (Array.isArray(o)) o.forEach((x) => keysDeep(x, acc));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { acc.add(k.toLowerCase()); keysDeep(v, acc); }
    return acc;
  };
  const allKeys = keysDeep(run1);
  const engineSrc = fs.readFileSync(path.join(ROOT, "app/lib/ai/estimation/rate-engine.ts"), "utf8");
  const readerSrc = fs.readFileSync(path.join(ROOT, "app/lib/ai/estimation/rate-source-reader.ts"), "utf8");
  const storeSrc = fs.readFileSync(path.join(ROOT, "app/lib/ai/estimation/rate-store.ts"), "utf8");
  const typesSrc = fs.readFileSync(path.join(ROOT, "app/lib/ai/estimation/rate-types.ts"), "utf8");
  const newImports = [engineSrc, readerSrc, storeSrc, typesSrc].flatMap(importLines);
  assert(![...allKeys].some((k) => /total_cost|project_cost|line_amount|extended|cost_line|amount_total|qty_x_rate/.test(k)) &&
    !newImports.some((l) => /costing/.test(l)), "44 no project costing (no qty × rate totals, costing.ts not imported)", [...allKeys].filter((k) => /cost|amount/.test(k)));
  assert(![...allKeys].some((k) => k.includes("margin") || k.includes("markup")) && !/margin/i.test(stripComments(engineSrc)), "45 no margin");
  const po = checkEstimationAuthority("PLACE_PO", "rate-test", []);
  assert(!po.allowed && !run1.results.some((r) => r.possible_next_actions.some((a) => (a.action as string) === "PLACE_PO" || a.executed)) &&
    !/purchase_?order_?(create|approve)|placePurchaseOrder|createPurchaseOrder/i.test(stripComments(engineSrc)), "46 no purchase action");
  const rfq = checkEstimationAuthority("SEND_VENDOR_RFQ", "rate-test", []);
  assert(!rfq.allowed && rfq.requiresApproval && run1.results.every((r) => r.possible_next_actions.every((a) => a.executed === false)) &&
    ![engineSrc, readerSrc, storeSrc].some((s) => /\bfetch\(|nodemailer|sendMail|sendEmail|https?:\/\//.test(stripComments(s))), "47 no external RFQ (listed only, Owner approval required)");
  const runRow = store.getRun(run1.run_id)!;
  assert(run1.model_calls === 0 && Number(runRow.model_calls) === 0 && run1.results.every((r) => r.model_calls === 0) &&
    routeEstimationTask("RATE_LOOKUP").maxModelCalls === 0 &&
    !newImports.some((l) => /providers|model-router|agent-router|anthropic|openai|gemini/i.test(l)), "48 deterministic model calls = 0", runRow.model_calls);

  // ======================================================
  section("11. Cache");
  const cableLine = [line("BQ-CABLE", "Copper Cable 4 sq mm", "M", { item_id: "I-CABLE" })];
  const c1 = runRateLookup({ ...base, store, projectId: "P4D-CACHE", boqLines: cableLine });
  const c2 = runRateLookup({ ...base, store, projectId: "P4D-CACHE", boqLines: cableLine });
  const sameEvidence = JSON.stringify(c1.results[0].evidence.map((e) => [e.rate_evidence_id, e.rate])) === JSON.stringify(c2.results[0].evidence.map((e) => [e.rate_evidence_id, e.rate]));
  assert(c2.cache_hits === c2.results[0].evidence.length - c2.results[0].evidence.filter((e) => e.commitment_status === "MANUAL").length &&
    c2.cache_misses === 0 && c2.cache_invalidated === 0 && sameEvidence, "49 valid cache reuse (unchanged fingerprints)", { hits: c2.cache_hits, misses: c2.cache_misses });

  // read-only proofs + fixture hash BEFORE the harness mutates its own fixture for test 50
  let booksWriteBlocked = false;
  let auditWriteBlocked = false;
  try { (reader as unknown as { books: DatabaseSync }).books.exec("CREATE TABLE p4d_probe (x)"); } catch { booksWriteBlocked = true; }
  try { (reader as unknown as { audit: DatabaseSync }).audit.exec("UPDATE audit_purchase_order_lines SET rate = '1'"); } catch { auditWriteBlocked = true; }
  const readerCode = stripComments(readerSrc);
  const readerHasNoWriteSql = !/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|REINDEX|VACUUM|ATTACH)\b/.test(readerCode) &&
    !/\.run\(/.test(readerCode) && (readerCode.match(/\.exec\(/g) ?? []).length === 1 && readerCode.includes('exec("PRAGMA query_only = ON")');
  const fixBooksAfterEngine = sha(FIX_BOOKS);
  const fixAuditAfterEngine = sha(FIX_AUDIT);

  // Test harness (not the engine) edits ITS OWN temp fixture to simulate a source change.
  const w = new DatabaseSync(FIX_BOOKS);
  w.prepare("UPDATE purchase_bill_line_items SET rate = 46, line_total = 9200 WHERE line_item_id = 'L2'").run();
  w.prepare("UPDATE purchase_bills SET total = 10856 WHERE bill_id = 'B2'").run();
  w.close();
  const reader2 = new RateSourceReader({ bansilBooksDbPath: FIX_BOOKS, auditWorkspaceDbPath: FIX_AUDIT });
  const c3 = runRateLookup({ reader: reader2, asOfDate: AS_OF, store, projectId: "P4D-CACHE", boqLines: cableLine });
  const invalidRow = estDb.prepare("SELECT cache_status, invalidated_reason FROM estimation_rate_evidence WHERE rate_evidence_id = ? AND cache_status = 'INVALIDATED'")
    .get(ev(c1.results[0], "L2")!.rate_evidence_id) as Record<string, unknown> | undefined;
  assert(c3.cache_invalidated === 1 && c3.cache_misses === 1 && ev(c3.results[0], "L2")?.rate === 46 && invalidRow?.invalidated_reason === "SOURCE_FINGERPRINT_CHANGED" &&
    c3.source_fingerprint_books !== c1.source_fingerprint_books, "50 stale cache invalidated (fingerprint changed)", { inv: c3.cache_invalidated, row: invalidRow });
  reader2.close();

  // ======================================================
  section("12. Review / checker");
  const hookTender = getRateReviewHook(cable, "TENDER_RATE_RECOMMENDATION");
  assert(hookTender.reviewRequired && hookTender.riskLevel === "HIGH" && lug.review_hook.kind === "VENDOR_COMPARISON" &&
    fap.review_hook.kind === "HISTORICAL_RATE_LOOKUP" && fap.review_hook.reviewRequired === false, "51 high-risk recommendation review hook", { hookTender, lug: lug.review_hook, fap: fap.review_hook });
  const checked = applyCheckerReview(fap, { outcome: "PASS", proposedRate: 25000, proposedVendorId: "V9" });
  assert(checked.fabricationRejected && checked.result.rate_status === "MISSING_RATE" && checked.result.evidence.length === 0 &&
    checked.result.last_purchase === null && checked.result.best_available_evidence === null && checked.result.warnings.includes("CHECKER_RATE_PROPOSAL_REJECTED"),
    "52 checker cannot fabricate missing rate");

  // ======================================================
  section("13. Source / DB safety");
  assert(booksWriteBlocked && readerHasNoWriteSql && fixBooksAfterEngine === fixBooksBefore, "53 business DB read-only (write rejected, no write SQL, hash unchanged by engine)", { booksWriteBlocked, readerHasNoWriteSql, hashSame: fixBooksAfterEngine === fixBooksBefore });
  assert(auditWriteBlocked && fixAuditAfterEngine === fixAuditBefore, "54 audit DB read-only (write rejected, hash unchanged by engine)");
  const estTables = (estDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'estimation_rate%' OR name = 'estimation_item_match_candidates'").all() as Array<{ name: string }>).map((r) => r.name).sort();
  assert(getEstimationDbPath() === path.resolve(process.env.ESTIMATION_DB_PATH!) && getEstimationDbPath().startsWith(TMP) &&
    estTables.join() === "estimation_item_match_candidates,estimation_rate_evidence,estimation_rate_lookup_runs,estimation_rate_selections" &&
    fs.existsSync(DEFAULT_EST_DB) === defaultEstExistedBefore, "55 estimation DB isolated (temp path, 4D tables only there)", estTables);

  // ---------- real-data sentinel (immutable snapshot, read-only) ----------
  section("14. Real data sentinel (READ-ONLY snapshot)");
  if (snapshotAvailable) {
    const snap = new RateSourceReader({ bansilBooksDbPath: SNAP_BOOKS, auditWorkspaceDbPath: SNAP_AUDIT, immutable: true });
    const probeUrl = (p: string) => { const u = pathToFileURL(p); u.searchParams.set("mode", "ro"); u.searchParams.set("immutable", "1"); return u; };
    const raw = new DatabaseSync(probeUrl(SNAP_BOOKS), { readOnly: true });
    const top = raw.prepare(`
      SELECT l.item_id, l.item_name, l.unit, COUNT(*) AS n FROM purchase_bill_line_items l
       WHERE l.item_id <> '' AND l.unit IS NOT NULL AND TRIM(l.unit) <> '' AND ABS(l.quantity * l.rate - l.line_total) <= 0.5
       GROUP BY l.item_id, l.unit ORDER BY n DESC, l.item_id LIMIT 3`).all() as Array<{ item_id: string; item_name: string; unit: string }>;
    const sentinelRows: unknown[] = [];
    let crossChecked = 0;
    let crossMismatch = 0;
    for (const t of top) {
      const r = lookupBoqLineRate({ reader: snap, asOfDate: AS_OF }, line(`SENT-${t.item_id}`, t.item_name, t.unit, { item_id: t.item_id }));
      const lpr = r.last_purchase;
      sentinelRows.push(lpr
        ? { item: t.item_name, item_id: t.item_id, vendor: lpr.vendor_name, date: lpr.date, rate: lpr.rate, uom: lpr.uom, source: `${lpr.source_type} ${lpr.source_document} line ${lpr.source_record_id}`, tax_basis: lpr.tax_basis, freight: lpr.freight_basis, age_days: lpr.age_days, verified_bill_points: r.bill_series.count, po_points: r.po_series.count, vendors: r.vendor_history.length, best_pointer: r.best_available_evidence ? "SET" : `NONE (${r.warnings.filter((x) => /HETEROGENEOUS|CONFLICT/.test(x)).join(",") || "n/a"})` }
        : { item: t.item_name, item_id: t.item_id, status: r.rate_status });
      for (const e of r.evidence.filter((x) => x.source_type === "BILL_RATE" && x.verification_status === "VERIFIED")) {
        const row = raw.prepare(`SELECT l.rate, b.date, b.vendor_id FROM purchase_bill_line_items l JOIN purchase_bills b ON b.bill_id = l.bill_id WHERE l.line_item_id = ?`)
          .get(e.source_record_id) as { rate: number; date: string; vendor_id: string };
        crossChecked++;
        if (!row || row.rate !== e.rate || row.date !== e.source_date || row.vendor_id !== e.vendor_id || !isProvenanceComplete(e.provenance)) crossMismatch++;
      }
      if (r.model_calls !== 0) crossMismatch++;
    }
    raw.close();
    snap.close();
    console.log("  Sentinel (last verified purchase per item, as of " + AS_OF + "):");
    for (const row of sentinelRows) console.log("   ", JSON.stringify(row));
    assert(top.length > 0 && crossChecked > 0 && crossMismatch === 0, `S1 real snapshot evidence cross-checked against raw rows (${crossChecked} verified bill lines, 0 AI calls)`, { crossChecked, crossMismatch });
    const sb = sha(SNAP_BOOKS);
    const sa = sha(SNAP_AUDIT);
    const sideFiles = ["-wal", "-shm"].some((x) => fs.existsSync(SNAP_BOOKS + x) || fs.existsSync(SNAP_AUDIT + x));
    assert(sb === snapBooksBefore && !sideFiles, `56 runtime business DB unchanged (snapshot sha256 ${sb.slice(0, 12)}…, no -wal/-shm created)`);
    assert(sa === snapAuditBefore && !sideFiles, `57 runtime audit DB unchanged (snapshot sha256 ${sa.slice(0, 12)}…)`);
  } else {
    console.log("  SKIP: snapshot not present — sentinel and 56/57 not evaluated (counted as FAIL, not PASS)");
    assert(false, "56 runtime business DB unchanged (snapshot unavailable)");
    assert(false, "57 runtime audit DB unchanged (snapshot unavailable)");
  }

  section("15. Zoho / capability truth");
  const zw = checkEstimationAuthority("ZOHO_WRITE", "rate-test", []);
  assert(isZohoWriteAllowed() === false && !zw.allowed && zw.category === "PROHIBITED" && !newImports.some((l) => /zoho/i.test(l)), "58 ZOHO WRITE = 0");
  const advertised = listAdvertisedRateSourceTypes();
  const na = RATE_SOURCE_CAPABILITIES.filter((c) => c.availability === "NOT_AVAILABLE").map((c) => c.sourceType).sort();
  assert(na.join() === "CONTRACT_RATE,CURRENT_VENDOR_QUOTE,LIST_RATE" && !na.some((t) => advertised.includes(t)) &&
    !run1.results.flatMap((r) => r.evidence).some((e) => na.includes(e.source_type)), "59 unavailable source types not advertised / never returned", advertised);
  const pl3 = ev(cable, "PL3");
  const pl4 = ev(cable, "PL4");
  assert(pl3 === undefined && pl4?.verification_status === "REQUIRES_OWNER_REVIEW" && pl4.commitment_status === "UNAPPROVED_PO", "60 cancelled PO excluded; draft PO requires review");
  const itemMasterRate = cable.evidence.some((e) => e.rate === 99);
  assert(!itemMasterRate, "61 item-master sales rate never used as purchase evidence");
  const l6 = ev(cable, "L6")!;
  const l7 = ev(cable, "L7")!;
  assert(l6.warnings.includes("UOM_MISSING") && l6.verification_status === "REQUIRES_OWNER_REVIEW" && l7.warnings.includes("RATE_ARITHMETIC_MISMATCH") &&
    l7.verification_status === "REQUIRES_OWNER_REVIEW", "62 missing UOM / arithmetic mismatch never VERIFIED");

  // ---------- cleanup & operational invariants ----------
  reader.close();
  closeEstimationDatabase();
  const opAiAfter = fs.existsSync(OPERATIONAL_AI_DB) ? sha(OPERATIONAL_AI_DB) : null;
  assert(opAiAfter === opAiBefore, "63 operational data/ai_workspace.db unchanged", { before: opAiBefore, after: opAiAfter });

  console.log(`\nTEST SUMMARY: ${pass} PASSED, ${fail} FAILED (of ${pass + fail})`);
  if (snapshotAvailable) console.log(`SNAPSHOT HASHES: bansil_books ${snapBooksBefore} | audit_workspace ${snapAuditBefore}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
