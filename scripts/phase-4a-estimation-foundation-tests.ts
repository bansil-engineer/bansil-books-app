// ============================================================
// Bansil Books Analytics — Phase 4A: Estimation & Tender Foundation Tests
// Real assertions for source truthfulness, revision control,
// provenance, rate evidence, tax/landed cost, cost layers, margin,
// clarification flow, authority, checker, deterministic-first,
// self-correction and ZOHO WRITE = 0.
//
// Safety: operational DBs are opened READ-ONLY only; their SHA-256 is
// recorded before/after and must be unchanged. The AI workspace DB is
// redirected to an isolated temp path (estimation code never opens it).
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";

process.env.AI_WORKSPACE_DB_PATH = path.join(
  os.tmpdir(),
  `phase4a_isolated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`,
);

const ROOT = process.cwd();
const OP_DBS = ["ai_workspace.db", "bansil_books.db", "audit_workspace.db"].map((f) => path.join(ROOT, "data", f));
const hashFile = (p: string) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const opHashesBefore = OP_DBS.map(hashFile);

type T = () => void | Promise<void>;
const tests: Array<{ name: string; fn: T }> = [];
const test = (name: string, fn: T) => tests.push({ name, fn });

async function main() {
  // Dynamic imports AFTER env isolation is in place.
  const reg = await import("../app/lib/ai/estimation/source-registry");
  const ev = await import("../app/lib/ai/estimation/evidence");
  const cost = await import("../app/lib/ai/estimation/costing");
  const auth = await import("../app/lib/ai/estimation/authority");
  const safety = await import("../app/lib/ai/estimation/safety");
  const types = await import("../app/lib/ai/estimation/types");
  const policy = await import("../app/lib/ai/ceo/authority-policy");
  const checker = await import("../app/lib/ai/ceo/independent-checker");
  const xlsxReader = await import("../app/lib/audit/intake/xlsx-reader");

  type Doc = import("../app/lib/ai/estimation/types").EstimationDocument;
  type Rate = import("../app/lib/ai/estimation/types").RateEvidence;
  type Prov = import("../app/lib/ai/estimation/types").Provenance;
  type CostLine = import("../app/lib/ai/estimation/types").CostLine;
  type Assumption = import("../app/lib/ai/estimation/types").CommercialAssumption;
  type Grant = import("../app/lib/ai/ceo/governance-types").ApprovalGrant;

  // ---------- fixtures ----------
  const sha = (s: string) => ev.fingerprintContent(s);
  const mkDoc = (o: Partial<Doc>): Doc => ({
    documentId: "D1", projectId: "P1", type: "BOQ", familyKey: "BOQ", revision: 0, format: "XLSX",
    sourceId: "A_TENDER_RFQ_UPLOAD", receivedAt: "2026-09-01", sha256: sha("boq-rev0"), status: "CURRENT", ...o,
  });
  const billProv: Prov = {
    sourceId: "BANSIL_BOOKS_DB", tier: "VERIFIED_HISTORICAL_PURCHASE",
    recordRef: "bansil_books.purchase_bill_line_items#L123", recordDate: "2026-08-10",
    basis: "GST-exclusive taxable line rate",
  };
  const mkRate = (o: Partial<Rate> = {}): Rate => ({
    rateId: "R1", itemRef: "MCB-32A", vendorName: "Vendor A", rateClass: "BILL_RATE",
    verificationStatus: "VERIFIED", rate: 450, currency: "INR", uom: "NOS", quantityBasis: 10,
    taxBasis: "GST_EXCLUSIVE", freightBasis: "FREIGHT_EXTRA", rateDate: "2026-08-10", provenance: billProv, ...o,
  });
  const approvedAssumption = (o: Partial<Assumption> = {}): Assumption => ({
    assumptionId: "AS1", type: "RATE", value: 500, basis: "Owner instruction for budgetary rate",
    approvalStatus: "OWNER_APPROVED", approval: { approvedBy: "Owner", approvedAt: "2026-10-01T10:00:00Z" },
    createdAt: "2026-10-01T09:00:00Z", ...o,
  });
  const mkLine = (layer: CostLine["layer"], amount: number, o: Partial<CostLine> = {}): CostLine => ({
    costLineId: `${layer}-1`, layer, description: layer, quantity: 1, uom: "LOT", unitCost: amount, amount,
    nonRecoverableTax: 0, verificationStatus: "VERIFIED", provenance: billProv, ...o,
  });
  const grant = (target: string, actionType: Grant["scope"]["actionType"]): Grant => ({
    id: "G1", requestId: "REQ1", approvedBy: "Owner", approvedAt: "2026-10-01T00:00:00Z", consumed: false,
    scope: { actionType, target, singleUse: true },
  });
  const ESTIMATION_DIR = path.join(ROOT, "app", "lib", "ai", "estimation");
  const estimationSources = fs.readdirSync(ESTIMATION_DIR).filter((f) => f.endsWith(".ts"))
    .map((f) => ({ f, src: fs.readFileSync(path.join(ESTIMATION_DIR, f), "utf8") }));

  // ==================== SOURCES ====================
  test("01 Zoho source is READ ONLY", () => {
    const z = reg.getEstimationSource("ZOHO_BOOKS_READ_ONLY")!;
    assert.strictEqual(z.writeCapability, false);
    assert.strictEqual(z.readCapability, true);
    assert.throws(() => reg.assertEstimationReadOnly("ZOHO_BOOKS_READ_ONLY", true), /ESTIMATION_READ_ONLY/);
    assert.doesNotThrow(() => reg.assertEstimationReadOnly("ZOHO_BOOKS_READ_ONLY", false));
  });

  test("02 no estimation path can enable Zoho write", () => {
    assert.strictEqual(policy.isZohoWriteAllowed(), false);
    for (const s of reg.ESTIMATION_SOURCE_REGISTRY) assert.strictEqual(s.writeCapability, false, s.id);
    // Even an exact, Owner-signed grant cannot authorize ZOHO_WRITE.
    const t = auth.estimationTarget("ZOHO_WRITE", "P1");
    const r = auth.checkEstimationAuthority("ZOHO_WRITE", "P1", [grant(t, "ZOHO_WRITE"), grant("*", "ZOHO_WRITE")]);
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.category, "PROHIBITED");
    const sg = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: [], usedDocumentIds: [], boqItems: [], rates: [], scope: [], clarifications: [],
      isFinalCosting: false, zohoWriteRequested: true,
    });
    assert.ok(sg.violations.includes("ZOHO_WRITE_PROHIBITED"));
    // Static: no estimation module performs HTTP or Zoho mutation.
    for (const { f, src } of estimationSources) {
      assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not fetch`);
      assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src), `${f} must not mutate remote`);
      assert.ok(!/zoho\/(connect|sync)|zoho-client/i.test(src), `${f} must not import Zoho client`);
    }
  });

  test("03 historical business DB source classified correctly", () => {
    const b = reg.getEstimationSource("BANSIL_BOOKS_DB")!;
    assert.strictEqual(b.availability, "VERIFIED_AVAILABLE");
    assert.strictEqual(b.tier, "VERIFIED_HISTORICAL_PURCHASE");
    assert.strictEqual(reg.getEstimationSource("I_BILL_HISTORY")!.availability, "VERIFIED_AVAILABLE");
    // Vendor rates are PARTIAL: UOM missing on many bill lines.
    assert.strictEqual(reg.getEstimationSource("G_VENDOR_HISTORICAL_RATES")!.availability, "AVAILABLE_PARTIAL");
  });

  test("03b registry VERIFIED claims backed by real read-only data", () => {
    const bb = path.join(ROOT, "data", "bansil_books.db");
    const aw = path.join(ROOT, "data", "audit_workspace.db");
    if (!fs.existsSync(bb) || !fs.existsSync(aw)) { console.log("   (skipped: operational DBs not present)"); return; }
    const count = (p: string, sql: string) => {
      const db = new DatabaseSync(p, { readOnly: true });
      try { return (db.prepare(sql).get() as { c: number }).c; } finally { db.close(); }
    };
    assert.ok(count(bb, "SELECT count(*) c FROM purchase_bill_line_items WHERE rate > 0") > 0);
    assert.ok(count(bb, "SELECT count(*) c FROM sales_invoices") > 0);
    assert.ok(count(aw, "SELECT count(*) c FROM audit_item_master") > 0);
    assert.ok(count(aw, "SELECT count(*) c FROM audit_purchase_order_lines") > 0);
    // Claimed-empty / absent sources really are empty / absent.
    assert.strictEqual(count(aw, "SELECT count(*) c FROM audit_bom_components"), 0);
    assert.strictEqual(count(bb, "SELECT count(*) c FROM purchase_bills WHERE purchaseorder_id IS NOT NULL AND purchaseorder_id <> ''"), 0);
    for (const p of [bb, aw]) {
      assert.strictEqual(count(p, "SELECT count(*) c FROM sqlite_master WHERE type='table' AND (name LIKE '%estimat%' OR name LIKE '%quotation%' OR name LIKE '%tender%')"), 0);
    }
    // Missing-unit share justifies PARTIAL for vendor rates.
    const missingUnit = count(bb, "SELECT count(*) c FROM purchase_bill_line_items WHERE unit IS NULL OR trim(unit) = ''");
    assert.ok(missingUnit > 0);
  });

  test("03c Excel (XLSX) reading is genuinely VERIFIED", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Line", "Description", "Qty", "UOM"], [1, "MCB 32A", 12, "Nos"]]), "BOQ");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", bookSST: true }) as Buffer;
    const parsed = xlsxReader.parseXlsxBuffer(buf);
    const flat = parsed.sheets.flatMap((s) => s.rows.flatMap((r) => r.cells.map((c) => c.rawValue)));
    assert.ok(flat.includes("MCB 32A"));
    assert.ok(flat.includes("12"));
    assert.strictEqual(reg.getEstimationSource("C_EXCEL_READING")!.availability, "VERIFIED_AVAILABLE");
  });

  test("04 unavailable source is not presented as available", () => {
    const mustBeUnavailable = ["D_WORD_READING", "E_DRAWINGS_IMAGES", "N_PREVIOUS_QUOTATIONS",
      "O_COMMERCIAL_TERMS_TEMPLATES", "P_VENDOR_QUOTATIONS", "S_ONLINE_PUBLIC_RATES", "Q_LOCAL_FOLDER", "R_EMAIL"] as const;
    for (const id of mustBeUnavailable) {
      const s = reg.getEstimationSource(id)!;
      assert.ok(s.availability === "NOT_AVAILABLE" || s.availability === "FUTURE_CONNECTOR_REQUIRED", id);
      assert.strictEqual(reg.isSourceUsable(id), false, id);
      assert.strictEqual(s.readCapability, false, id);
    }
    // Zoho was not live-verified in 4A: must not claim VERIFIED.
    assert.strictEqual(reg.getEstimationSource("ZOHO_BOOKS_READ_ONLY")!.availability, "AVAILABLE_UNVERIFIED");
    assert.strictEqual(reg.getEstimationSource("B_PDF_READING")!.availability, "AVAILABLE_PARTIAL");
    // Matrix A–T fully covered.
    const letters = reg.ESTIMATION_SOURCE_REGISTRY.map((s) => s.id).filter((id) => /^[A-T]_/.test(id)).map((id) => id[0]).sort();
    assert.deepStrictEqual(letters, "ABCDEFGHIJKLMNOPQRST".split(""));
  });

  test("05 source priority deterministic", () => {
    assert.strictEqual(reg.getTierRank("CURRENT_TENDER_DOCUMENT"), 1);
    assert.strictEqual(reg.getTierRank("AI_INFERENCE"), 9);
    assert.ok(reg.getTierRank("VERIFIED_CURRENT_VENDOR_QUOTE") < reg.getTierRank("VERIFIED_HISTORICAL_PURCHASE"));
    assert.ok(reg.getTierRank("VERIFIED_HISTORICAL_PURCHASE") < reg.getTierRank("VERIFIED_HISTORICAL_PO"));
    assert.ok(reg.getTierRank("APPROVED_ESTIMATOR_ASSUMPTION") < reg.getTierRank("AI_INFERENCE"));
    const ids = ["T_MANUAL_ESTIMATOR_ASSUMPTIONS", "H_PURCHASE_ORDER_HISTORY", "A_TENDER_RFQ_UPLOAD", "I_BILL_HISTORY"] as const;
    const a = reg.sortSourcesByPriority([...ids]);
    const b = reg.sortSourcesByPriority([...ids].reverse());
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(a, ["A_TENDER_RFQ_UPLOAD", "I_BILL_HISTORY", "H_PURCHASE_ORDER_HISTORY", "T_MANUAL_ESTIMATOR_ASSUMPTIONS"]);
    assert.strictEqual(reg.isFactualTier("AI_INFERENCE"), false);
  });

  // ==================== REVISIONS / FINGERPRINTS ====================
  test("06 tender revision fingerprint supported", () => {
    const h = ev.fingerprintContent(Buffer.from("tender rev 0"));
    assert.ok(ev.isValidSha256(h));
    assert.strictEqual(h, crypto.createHash("sha256").update("tender rev 0").digest("hex"));
    assert.notStrictEqual(h, ev.fingerprintContent("tender rev 1"));
    assert.strictEqual(ev.isValidSha256("abc"), false);
  });

  test("07 superseded revision rejected for current estimate", () => {
    const r0 = mkDoc({ documentId: "D0", revision: 0, status: "SUPERSEDED", supersededByDocumentId: "D2" });
    const r2 = mkDoc({ documentId: "D2", revision: 2, sha256: sha("boq-rev2") });
    const docs = [r0, r2];
    assert.strictEqual(ev.selectCurrentRevision(docs, "BOQ")!.documentId, "D2");
    const bad = ev.assertDocumentUsableForCurrentEstimate(r0, docs);
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.violations.includes("SUPERSEDED_REVISION_REJECTED"));
    assert.strictEqual(ev.assertDocumentUsableForCurrentEstimate(r2, docs).valid, true);
    // Mis-flagged older CURRENT doc still rejected because a newer revision exists.
    const stale = mkDoc({ documentId: "D1", revision: 1, sha256: sha("boq-rev1") });
    assert.ok(ev.assertDocumentUsableForCurrentEstimate(stale, [stale, r2]).violations.includes("NEWER_REVISION_EXISTS"));
    const sg = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: docs, usedDocumentIds: ["D0"], boqItems: [], rates: [], scope: [], clarifications: [], isFinalCosting: false,
    });
    assert.ok(sg.violations.some((x) => x.startsWith("SUPERSEDED_REVISION_REJECTED")));
  });

  // ==================== PROVENANCE ====================
  test("08 BOQ line requires qty/UOM provenance", () => {
    const tenderProv: Prov = { sourceId: "A_TENDER_RFQ_UPLOAD", tier: "CURRENT_TENDER_DOCUMENT", recordRef: "D2!BOQ!R2", recordDate: "2026-09-01" };
    assert.strictEqual(ev.validateBoqItem({ lineNumber: "1", description: "MCB", quantity: 12, uom: "Nos", quantityProvenance: tenderProv }).valid, true);
    const noProv = ev.validateBoqItem({ lineNumber: "2", description: "MCB", quantity: 12, uom: "Nos", quantityProvenance: null });
    assert.ok(noProv.violations.includes("BOQ_QTY_PROVENANCE_MISSING"));
    const noQty = ev.validateBoqItem({ lineNumber: "3", description: "MCB", quantity: null, uom: null, quantityProvenance: tenderProv });
    assert.ok(noQty.violations.includes("BOQ_QUANTITY_MISSING") && noQty.violations.includes("BOQ_UOM_MISSING"));
    const aiQty = ev.validateBoqItem({ lineNumber: "4", description: "MCB", quantity: 5, uom: "Nos", quantityProvenance: { ...tenderProv, tier: "AI_INFERENCE" } });
    assert.ok(aiQty.violations.includes("BOQ_QUANTITY_FROM_AI_INFERENCE"));
  });

  test("09 rate evidence requires source", () => {
    assert.strictEqual(ev.validateRateEvidence(mkRate()).valid, true);
    assert.ok(ev.validateRateEvidence(mkRate({ provenance: null })).violations.includes("RATE_SOURCE_MISSING"));
    assert.ok(ev.validateRateEvidence(mkRate({ provenance: { ...billProv, recordRef: "" } })).violations.includes("RATE_SOURCE_MISSING"));
  });

  test("10 rate evidence requires date", () => {
    assert.ok(ev.validateRateEvidence(mkRate({ rateDate: null })).violations.includes("RATE_DATE_MISSING"));
    assert.ok(ev.validateRateEvidence(mkRate({ rateDate: "not-a-date" })).violations.includes("RATE_DATE_MISSING"));
  });

  test("11 rate evidence carries tax basis", () => {
    assert.ok(ev.validateRateEvidence(mkRate({ taxBasis: undefined as never })).violations.includes("RATE_TAX_BASIS_MISSING"));
    assert.ok(ev.validateRateEvidence(mkRate({ taxBasis: "UNKNOWN" })).violations.includes("VERIFIED_RATE_REQUIRES_KNOWN_TAX_BASIS"));
  });

  test("12 rate evidence carries UOM", () => {
    assert.ok(ev.validateRateEvidence(mkRate({ uom: null })).violations.includes("RATE_UOM_MISSING"));
    assert.ok(ev.validateRateEvidence(mkRate({ uom: "  " })).violations.includes("RATE_UOM_MISSING"));
  });

  test("13 AI inference cannot become VERIFIED rate", () => {
    const aiRate = mkRate({ verificationStatus: "AI_INFERENCE", provenance: { ...billProv, tier: "AI_INFERENCE" } });
    assert.strictEqual(ev.canPromoteToVerified(aiRate).allowed, false);
    const disguised = mkRate({ verificationStatus: "VERIFIED", provenance: { ...billProv, tier: "AI_INFERENCE" } });
    const r = ev.validateRateEvidence(disguised);
    assert.ok(r.violations.includes("VERIFIED_RATE_REQUIRES_FACTUAL_SOURCE"));
    assert.ok(r.violations.includes("AI_INFERENCE_CANNOT_BE_A_COMMERCIAL_RATE"));
    assert.strictEqual(ev.canPromoteToVerified(mkRate({ verificationStatus: "ESTIMATE" })).allowed, true);
  });

  test("14 manual rate requires assumption/approval state", () => {
    const manual = mkRate({ rateClass: "MANUAL_APPROVED_RATE", verificationStatus: "ASSUMPTION", provenance: { ...billProv, tier: "APPROVED_ESTIMATOR_ASSUMPTION", sourceId: "T_MANUAL_ESTIMATOR_ASSUMPTIONS", recordRef: "assumption#AS1" } });
    assert.ok(ev.validateRateEvidence(manual).violations.includes("MANUAL_RATE_ASSUMPTION_MISSING"));
    const proposed = { ...manual, assumption: approvedAssumption({ approvalStatus: "PROPOSED", approval: undefined }) };
    assert.ok(ev.validateRateEvidence(proposed).violations.includes("MANUAL_RATE_REQUIRES_OWNER_APPROVAL"));
    const unstamped = { ...manual, assumption: approvedAssumption({ approval: undefined }) };
    assert.ok(ev.validateRateEvidence(unstamped).violations.includes("MANUAL_RATE_ASSUMPTION_APPROVAL_STAMP_MISSING"));
    // Owner-approved manual rate is valid ONLY as a labelled ASSUMPTION…
    assert.deepStrictEqual(ev.validateRateEvidence({ ...manual, assumption: approvedAssumption() }).violations, []);
    // …and can never be labelled or promoted to VERIFIED.
    const asVerified = ev.validateRateEvidence({ ...manual, verificationStatus: "VERIFIED", assumption: approvedAssumption() });
    assert.ok(asVerified.violations.includes("MANUAL_RATE_CANNOT_BE_VERIFIED"));
    assert.strictEqual(ev.canPromoteToVerified({ ...manual, assumption: approvedAssumption() }).allowed, false);
    const prov = mkRate({ rateClass: "PROVISIONAL_RATE", verificationStatus: "ASSUMPTION", assumption: approvedAssumption({ basis: "", approvalStatus: "PROPOSED", approval: undefined }) });
    assert.ok(ev.validateRateEvidence(prov).violations.includes("MANUAL_RATE_ASSUMPTION_BASIS_MISSING"));
  });

  test("15 stale rate can be flagged (policy-driven, no hard-coded default)", () => {
    const p = { currentMaxAgeDays: 30, agingMaxAgeDays: 90, policyRef: "test-policy" };
    assert.strictEqual(ev.classifyRateFreshness("2026-09-20", "2026-10-04", p).status, "CURRENT");
    assert.strictEqual(ev.classifyRateFreshness("2026-08-01", "2026-10-04", p).status, "AGING");
    assert.strictEqual(ev.classifyRateFreshness("2025-01-01", "2026-10-04", p).status, "STALE");
    assert.strictEqual(ev.classifyRateFreshness("2026-09-20", "2026-10-04", null).status, "UNKNOWN");
    assert.strictEqual(ev.classifyRateFreshness(null, "2026-10-04", p).status, "UNKNOWN");
    assert.strictEqual(ev.classifyRateFreshness("2026-09-30", "2026-10-04", p, "2026-10-01").status, "STALE");
    assert.strictEqual(ev.rateAgeDays("2026-09-04", "2026-10-04"), 30);
  });

  // ==================== TAX / LANDED ====================
  test("16 GST-exclusive basis supported", () => {
    assert.strictEqual(ev.toGstExclusiveRate(450, "GST_EXCLUSIVE"), 450);
    assert.strictEqual(ev.toGstExclusiveRate(531, "GST_INCLUSIVE", 18), 450);
    assert.strictEqual(ev.toGstExclusiveRate(531, "GST_INCLUSIVE"), null, "never assume a GST rate");
    assert.strictEqual(ev.toGstExclusiveRate(531, "UNKNOWN", 18), null);
    const t = cost.computeTaxComponents(1000, 18, 1);
    assert.deepStrictEqual(t, { taxableValue: 1000, gstAmount: 180, recoverableTax: 180, nonRecoverableTax: 0, grossValue: 1180 });
    assert.strictEqual(cost.costBearingTax(t), 0, "recoverable GST never enters cost");
    const partial = cost.computeTaxComponents(1000, 18, 0.5);
    assert.strictEqual(cost.costBearingTax(partial), 90);
    // Recoverable GST excluded from cost summary.
    const s = cost.computeCostSummary([mkLine("MATERIAL", 1000, { nonRecoverableTax: 0 })]);
    assert.strictEqual(s.totalEstimatedCost, 1000);
  });

  test("17 landed cost separate from basic rate", () => {
    const lines = [
      mkLine("MATERIAL", 10000),
      mkLine("FREIGHT_TRANSPORT", 600, { subCategory: "FREIGHT" }),
      mkLine("PACKING", 150, { subCategory: "PACKING" }),
    ];
    const lc = cost.computeLandedCost(lines);
    assert.strictEqual(lc.basicMaterial, 10000);
    assert.strictEqual(lc.landedComponents, 750);
    assert.strictEqual(lc.landedMaterial, 10750);
    assert.notStrictEqual(lc.basicMaterial, lc.landedMaterial);
    assert.ok(types.LANDED_COST_COMPONENTS.includes("LOADING_UNLOADING"));
    assert.ok(types.LANDED_COST_COMPONENTS.includes("TRANSIT_INSURANCE"));
  });

  // ==================== COST LAYERS ====================
  const layerCases: Array<[string, CostLine["layer"][]]> = [
    ["18 material cost structure supported", ["MATERIAL"]],
    ["19 labour structure supported", ["LABOUR"]],
    ["20 testing/commissioning structure supported", ["TESTING", "COMMISSIONING"]],
    ["21 site cost structure supported", ["SITE_EXECUTION", "TRAVEL_STAY", "TOOLS_TACKLES"]],
    ["22 warranty cost structure supported", ["WARRANTY_PROVISION"]],
    ["23 finance cost structure supported", ["FINANCE_CREDIT"]],
    ["24 overhead structure supported", ["OVERHEAD_ALLOCATION"]],
    ["25 contingency structure supported", ["CONTINGENCY"]],
  ];
  for (const [name, layers] of layerCases) {
    test(name, () => {
      for (const l of layers) assert.ok(types.COST_LAYERS.includes(l), l);
      const s = cost.computeCostSummary(layers.map((l, i) => mkLine(l, 100 * (i + 1))));
      layers.forEach((l, i) => assert.strictEqual(s.byLayer[l], 100 * (i + 1)));
      assert.strictEqual(s.totalEstimatedCost, layers.reduce((a, _l, i) => a + 100 * (i + 1), 0));
    });
  }

  test("19b labour/site sub-categories cover required structure", () => {
    for (const c of ["ENGINEERING", "SUPERVISION", "INSTALLATION", "SITE_LABOUR", "MOBILIZATION", "DEMOBILIZATION", "SAFETY", "SITE_OVERHEAD", "STAY", "TRAVEL", "TOOLS"]) {
      assert.ok((types.LABOUR_SITE_CATEGORIES as readonly string[]).includes(c), c);
    }
    assert.strictEqual(types.COST_LAYERS.length, 15);
  });

  test("25b full cost build-up sums all layers; invalid lines are not dropped", () => {
    const lines = types.COST_LAYERS.map((l) => mkLine(l, 100));
    const s = cost.computeCostSummary(lines);
    assert.strictEqual(s.totalEstimatedCost, 1500);
    assert.throws(() => cost.computeCostSummary([mkLine("MATERIAL", 100, { amount: 999 })]), /COST_AMOUNT_MISMATCH/);
    assert.throws(() => cost.computeCostSummary([mkLine("MATERIAL", 100, { verificationStatus: "AI_INFERENCE" })]), /COST_FROM_AI_INFERENCE/);
    const withGap = cost.computeCostSummary([mkLine("MATERIAL", 100), mkLine("LABOUR", 0, { verificationStatus: "MISSING_RATE", provenance: null })]);
    assert.strictEqual(withGap.missingRateLineCount, 1);
  });

  // ==================== MARGIN ====================
  test("26 margin kept separate from cost", () => {
    const s = cost.computeCostSummary([mkLine("MATERIAL", 1000)]);
    const m = cost.computeOfferValuation(s, { method: "MARKUP_ON_COST", percent: 10, assumption: approvedAssumption({ type: "MARGIN", value: 10 }) });
    assert.strictEqual(m.totalEstimatedCost, 1000);
    assert.strictEqual(s.totalEstimatedCost, 1000, "cost summary unchanged by margin");
    assert.strictEqual(m.marginAmount, 100);
    assert.strictEqual(m.proposedOfferValue, 1100);
    assert.strictEqual(m.status, "DRAFT_REQUIRES_REVIEW_AND_OWNER_APPROVAL");
    const gm = cost.computeOfferValuation(s, { method: "GROSS_MARGIN_ON_PRICE", percent: 20, riskLoadingPercent: 0, assumption: approvedAssumption() });
    assert.strictEqual(gm.proposedOfferValue, 1250);
    assert.strictEqual(gm.grossMarginPercent, 20);
  });

  test("27 no universal hard-coded margin", () => {
    const s = cost.computeCostSummary([mkLine("MATERIAL", 1000)]);
    assert.throws(() => cost.computeOfferValuation(s, null), /MARGIN_INPUT_REQUIRED/);
    assert.throws(() => cost.computeOfferValuation(s, undefined), /MARGIN_INPUT_REQUIRED/);
    assert.throws(() => cost.computeOfferValuation(s, { method: "MARKUP_ON_COST", percent: 10, assumption: approvedAssumption({ basis: "" }) }), /MARGIN_ASSUMPTION_INVALID/);
    const costingSrc = estimationSources.find((x) => x.f === "costing.ts")!.src;
    assert.ok(!/DEFAULT_MARGIN|defaultMargin|MARGIN_PERCENT\s*=/.test(costingSrc));
  });

  // ==================== CLARIFICATION ====================
  test("28 ambiguity creates clarification/deviation state", () => {
    const prov: Prov = { sourceId: "A_TENDER_RFQ_UPLOAD", tier: "CURRENT_TENDER_DOCUMENT", recordRef: "D2!p4", recordDate: "2026-09-01" };
    const amb = { scopeId: "S1", description: "Earthing scope unclear", category: "ELECTRICAL", inclusion: "AMBIGUOUS" as const, provenance: prov };
    const c = safety.openClarificationForAmbiguity(amb, "C1")!;
    assert.strictEqual(c.status, "OPEN");
    assert.strictEqual(safety.openClarificationForAmbiguity({ ...amb, inclusion: "INCLUDED" }, "C2"), null);
    assert.deepStrictEqual(safety.findUnresolvedAmbiguities([{ ...amb, clarificationId: "C1" }], [c]), ["S1"]);
    assert.throws(() => safety.transitionClarification(c, "ACCEPTED"), /INVALID_CLARIFICATION_TRANSITION/);
    const reviewed = safety.transitionClarification(c, "REVIEWED");
    const odr = safety.transitionClarification(reviewed, "OWNER_DECISION_REQUIRED");
    assert.throws(() => safety.transitionClarification(odr, "ACCEPTED"), /REQUIRES_DECIDER/);
    const acc = safety.transitionClarification(odr, "ACCEPTED", { decidedBy: "Owner", decidedAt: "2026-10-02", decision: "Include earthing", deciderRole: "OWNER" });
    const inc = safety.transitionClarification(acc, "INCORPORATED");
    assert.deepStrictEqual(safety.findUnresolvedAmbiguities([{ ...amb, clarificationId: "C1" }], [inc]), []);
    // Final costing blocked while ambiguity unresolved.
    const sg = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: [], usedDocumentIds: [], boqItems: [], rates: [], scope: [{ ...amb, clarificationId: "C1" }],
      clarifications: [c], isFinalCosting: true, checkerOutcome: "PASS",
    });
    assert.ok(sg.violations.includes("UNRESOLVED_AMBIGUITY:S1"));
  });

  // ==================== AUTHORITY ====================
  test("29 external RFQ send requires Owner approval", () => {
    const r = auth.checkEstimationAuthority("SEND_VENDOR_RFQ", "RFQ-7");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.requiresApproval, true);
    assert.strictEqual(r.governedActionType, "SEND_EXTERNAL_RFQ");
    const ok = auth.checkEstimationAuthority("SEND_VENDOR_RFQ", "RFQ-7", [grant(auth.estimationTarget("SEND_VENDOR_RFQ", "RFQ-7"), "SEND_EXTERNAL_RFQ")]);
    assert.strictEqual(ok.allowed, true);
    // Wildcard or other-target grants do NOT authorize estimation sends.
    assert.strictEqual(auth.checkEstimationAuthority("SEND_VENDOR_RFQ", "RFQ-7", [grant("*", "SEND_EXTERNAL_RFQ")]).allowed, false);
    assert.strictEqual(auth.checkEstimationAuthority("SEND_CLARIFICATION", "RFQ-7", [grant(auth.estimationTarget("SEND_VENDOR_RFQ", "RFQ-7"), "SEND_EXTERNAL_RFQ")]).allowed, false);
    assert.strictEqual(auth.checkEstimationAuthority("SEND_CLARIFICATION", "C1").requiresApproval, true);
  });

  test("30 quotation send requires Owner approval", () => {
    const r = auth.checkEstimationAuthority("SEND_QUOTATION", "Q-1");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.category, "OWNER_APPROVAL_REQUIRED");
    assert.strictEqual(r.governedActionType, "BINDING_QUOTATION");
  });

  test("31 tender submission requires Owner approval", () => {
    const r = auth.checkEstimationAuthority("SUBMIT_TENDER", "T-1");
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.riskLevel, "CRITICAL");
    assert.strictEqual(auth.checkEstimationAuthority("ACCEPT_COMMERCIAL_COMMITMENT", "T-1").allowed, false);
  });

  test("32 purchase/payment requires Owner approval; accounting change prohibited", () => {
    for (const a of ["ACCEPT_VENDOR_OFFER", "PLACE_PO", "MAKE_PAYMENT"] as const) {
      const r = auth.checkEstimationAuthority(a, "X");
      assert.strictEqual(r.allowed, false, a);
      assert.strictEqual(r.category, "OWNER_APPROVAL_REQUIRED", a);
    }
    assert.strictEqual(auth.checkEstimationAuthority("CHANGE_ACCOUNTING_BOOKS", "X").category, "PROHIBITED");
  });

  test("33 internal rate lookup auto-executes", () => {
    for (const a of ["READ_TENDER", "EXTRACT_FACTS", "STRUCTURE_BOQ", "SEARCH_HISTORICAL_RATE", "CALCULATE_COST", "COMPARE_VENDORS", "DRAFT_OFFER", "DRAFT_CLARIFICATION", "DRAFT_RFQ"] as const) {
      const r = auth.checkEstimationAuthority(a, "P1");
      assert.strictEqual(r.allowed, true, a);
      assert.strictEqual(r.requiresApproval, false, a);
      assert.strictEqual(r.category, "AUTO_EXECUTE", a);
    }
  });

  test("33b estimation reuses existing ESTIMATION department (no new agent/dept)", async () => {
    const dept = await import("../app/lib/ai/ceo/department-registry");
    const src = fs.readFileSync(path.join(ROOT, "app/lib/ai/ceo/department-registry.ts"), "utf8");
    assert.ok(src.includes('"ESTIMATION"'));
    assert.strictEqual(auth.ESTIMATION_DEPARTMENT, "ESTIMATION");
    assert.ok(dept);
    for (const { f, src: s } of estimationSources) assert.ok(!/createAgent|registerAgent|getOrCreateSuitableAgent/.test(s), f);
  });

  // ==================== DETERMINISTIC-FIRST ====================
  test("34 deterministic costing uses zero model calls", () => {
    for (const k of ["RATE_LOOKUP", "COST_CALCULATION", "UOM_NORMALIZATION", "TAX_SPLIT", "MARGIN_MATH", "VENDOR_RATE_COMPARISON", "REVISION_CHECK", "PROVENANCE_VALIDATION"] as const) {
      const r = auth.routeEstimationTask(k);
      assert.strictEqual(r.route, "DETERMINISTIC", k);
      assert.strictEqual(r.maxModelCalls, 0, k);
      assert.strictEqual(r.zeroAi, true, k);
    }
    const ai = auth.routeEstimationTask("SPECIFICATION_INTERPRETATION");
    assert.strictEqual(ai.route, "AI_ASSIST");
    assert.strictEqual(ai.aiOutputStatus, "AI_INFERENCE");
    // Static: estimation modules never import model providers/routers.
    for (const { f, src } of estimationSources) {
      assert.ok(!/providers\/|model-router|agent-router|callModel|generateContent/.test(src), `${f} must not call models`);
    }
  });

  test("35 AI cannot invent missing commercial fact", () => {
    for (const kind of ["RATE", "QUANTITY", "VENDOR_QUOTE", "COMMERCIAL_FACT", "CONTRACT_REQUIREMENT"] as const) {
      const r = safety.resolveCommercialFact<number>({ kind, sourced: null, aiSuggestion: "Typically ₹480" });
      assert.strictEqual(r.value, null, kind);
      assert.notStrictEqual(r.status, "VERIFIED", kind);
      assert.strictEqual(r.aiNote, "Typically ₹480");
    }
    assert.strictEqual(safety.resolveCommercialFact<number>({ kind: "RATE" }).status, "MISSING_RATE");
    const disguised = safety.resolveCommercialFact<number>({ kind: "RATE", sourced: { value: 480, provenance: { ...billProv, tier: "AI_INFERENCE" } } });
    assert.strictEqual(disguised.value, null);
    const real = safety.resolveCommercialFact<number>({ kind: "RATE", sourced: { value: 450, provenance: billProv } });
    assert.strictEqual(real.value, 450);
    assert.strictEqual(real.status, "VERIFIED");
    const asm = safety.resolveCommercialFact<number>({ kind: "RATE", sourced: { value: 500, provenance: { ...billProv, tier: "APPROVED_ESTIMATOR_ASSUMPTION" } } });
    assert.strictEqual(asm.status, "ASSUMPTION", "approved assumption is labelled, never VERIFIED");
    const undated = safety.resolveCommercialFact<number>({ kind: "QUANTITY", sourced: { value: 7, provenance: { ...billProv, recordDate: "" } } });
    assert.strictEqual(undated.value, null);
    assert.ok(ev.validateRateEvidence(mkRate({ verificationStatus: "MISSING_RATE", rate: 480, provenance: null })).violations.includes("MISSING_RATE_MUST_NOT_CARRY_VALUE"));
  });

  // ==================== CHECKER ====================
  test("36 high-risk costing requires review hook", () => {
    for (const k of ["FINAL_COMMERCIAL_COSTING", "MARGIN_RECOMMENDATION", "TENDER_RISK_SUMMARY"] as const) {
      const h = auth.getEstimationReviewHook(k);
      assert.strictEqual(h.riskLevel, "HIGH", k);
      assert.strictEqual(h.reviewRequired, true, k);
      assert.strictEqual(h.reviewType, "GENERAL", k);
    }
    const crit = auth.getEstimationReviewHook("BINDING_OFFER");
    assert.strictEqual(crit.riskLevel, "CRITICAL");
    assert.strictEqual(crit.reviewRequired, true);
    assert.strictEqual(crit.requiresOwnerApproval, true);
    const low = auth.getEstimationReviewHook("HISTORICAL_RATE_LOOKUP");
    assert.strictEqual(low.reviewRequired, false, "no checker for trivial deterministic lookup");
    assert.strictEqual(auth.getEstimationReviewHook("VENDOR_COMPARISON").riskLevel, "MEDIUM");
    const blocked = auth.canFinalizeEstimationOutput({ kind: "FINAL_COMMERCIAL_COSTING", ref: "P1" });
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.blockers[0].startsWith("INDEPENDENT_REVIEW_REQUIRED"));
    assert.strictEqual(auth.canFinalizeEstimationOutput({ kind: "FINAL_COMMERCIAL_COSTING", ref: "P1", checkerOutcome: "REJECT" }).allowed, false);
    assert.strictEqual(auth.canFinalizeEstimationOutput({ kind: "FINAL_COMMERCIAL_COSTING", ref: "P1", checkerOutcome: "PASS" }).allowed, true);
    const sg = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: [], usedDocumentIds: [], boqItems: [], rates: [], scope: [], clarifications: [], isFinalCosting: true,
    });
    assert.ok(sg.violations.some((x) => x.startsWith("INDEPENDENT_REVIEW_REQUIRED")));
  });

  test("37 checker cannot override Owner approval", () => {
    const passOnly = auth.canFinalizeEstimationOutput({ kind: "BINDING_OFFER", ref: "T-9", checkerOutcome: "PASS" });
    assert.strictEqual(passOnly.allowed, false);
    assert.ok(passOnly.blockers.some((b) => b.startsWith("OWNER_APPROVAL_REQUIRED")));
    const pres = checker.validateAuthorityPreservation(auth.toGovernedAction("SEND_QUOTATION", "Q-1"), "PASS");
    assert.strictEqual(pres.allowed, false);
    assert.strictEqual(pres.overrideAttemptBlocked, true);
    const withGrant = auth.canFinalizeEstimationOutput({
      kind: "BINDING_OFFER", ref: "T-9", checkerOutcome: "PASS",
      grants: [grant(auth.estimationTarget("SUBMIT_TENDER", "T-9"), "SIGN_CONTRACT")],
    });
    assert.strictEqual(withGrant.allowed, true);
    const grantNoChecker = auth.canFinalizeEstimationOutput({
      kind: "BINDING_OFFER", ref: "T-9", grants: [grant(auth.estimationTarget("SUBMIT_TENDER", "T-9"), "SIGN_CONTRACT")],
    });
    assert.strictEqual(grantNoChecker.allowed, false, "Owner grant does not skip independent review either");
  });

  // ==================== FRESHNESS / FINGERPRINT ====================
  test("38 source revision change invalidates derived freshness", () => {
    const r1 = mkDoc({ documentId: "D1", revision: 1, sha256: sha("boq-rev1") });
    const stamp = { outputId: "O1", outputType: "COST_BUILDUP" as const, producedAt: "2026-09-02", usedRevisions: [ev.toRevisionRef(r1)] };
    assert.strictEqual(ev.checkDerivedOutputFreshness(stamp, [r1]).fresh, true);
    const r1s = { ...r1, status: "SUPERSEDED" as const, supersededByDocumentId: "D2" };
    const r2 = mkDoc({ documentId: "D2", revision: 2, sha256: sha("boq-rev2") });
    const after = ev.checkDerivedOutputFreshness(stamp, [r1s, r2]);
    assert.strictEqual(after.fresh, false);
    assert.ok(after.staleReasons[0].startsWith("REVISION_CHANGED:BOQ:1->2"));
    // Same revision number but content changed ⇒ stale.
    const tampered = ev.checkDerivedOutputFreshness(stamp, [{ ...r1, sha256: sha("boq-rev1-edited") }]);
    assert.ok(tampered.staleReasons.includes("FINGERPRINT_CHANGED:BOQ"));
    assert.strictEqual(ev.checkDerivedOutputFreshness({ ...stamp, usedRevisions: [] }, [r1]).fresh, false);
  });

  test("39 evidence fingerprint supported", () => {
    const ref = ev.toRevisionRef(mkDoc({}));
    assert.ok(ev.isValidSha256(ref.sha256));
    assert.ok(ev.validateProvenance({ ...billProv, documentRevision: ref }).valid);
    assert.ok(ev.validateProvenance({ ...billProv, documentRevision: { ...ref, sha256: "bad" } }).violations.includes("PROVENANCE_REVISION_FINGERPRINT_INVALID"));
    assert.ok(ev.assertDocumentUsableForCurrentEstimate(mkDoc({ sha256: "" }), []).violations.includes("DOCUMENT_FINGERPRINT_MISSING_OR_INVALID"));
  });

  // ==================== NORMALIZATION / SAFETY ====================
  test("39b no silent UOM conversion; spelling-only canonicalization", () => {
    assert.strictEqual(ev.canonicalizeUom("Nos"), "NOS");
    assert.strictEqual(ev.canonicalizeUom("nos"), "NOS");
    assert.strictEqual(ev.canonicalizeUom(" Mtrs "), "M");
    assert.strictEqual(ev.canonicalizeUom(""), null);
    assert.deepStrictEqual(ev.convertQuantity(5, "nos", "NOS", []), { ok: true, qty: 5 });
    const bad = ev.convertQuantity(2, "ROLL", "M", []);
    assert.strictEqual(bad.ok, false);
    const rule = { fromUom: "ROLL", toUom: "M", factor: 90, itemRef: "CABLE-2.5", approvedBy: "Owner", approvedAt: "2026-10-01" };
    const good = ev.convertQuantity(2, "ROLL", "M", [rule], "CABLE-2.5");
    assert.ok(good.ok && good.qty === 180);
    assert.strictEqual(ev.convertQuantity(2, "ROLL", "M", [rule], "OTHER-ITEM").ok, false, "pack size is item-specific");
    assert.strictEqual(ev.convertQuantity(2, "ROLL", "M", [{ ...rule, approvedBy: "" }], "CABLE-2.5").ok, false);
    const sg = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: [], usedDocumentIds: [], boqItems: [], rates: [], scope: [], clarifications: [], isFinalCosting: false,
      uomPairs: [{ boqUom: "M", rateUom: "ROLL", validatedRuleApplied: false }, { boqUom: "Nos", rateUom: "NOS", validatedRuleApplied: false }],
    });
    assert.deepStrictEqual(sg.violations, ["SILENT_UOM_CONVERSION:ROLL->M"]);
    assert.strictEqual(ev.normalizeNameKey("  Havells-MCB 32A/ C "), "HAVELLS MCB 32A C");
    assert.ok(ev.assertSameCurrency("USD", "INR").violations[0].startsWith("CURRENCY_MISMATCH"));
  });

  test("39c self-correction: safe auto, escalation for commitments/financial/destructive", () => {
    for (const c of ["RECALCULATE", "REQUERY_RATE_HISTORY", "RENORMALIZE_UOM", "RERUN_VALIDATION", "REQUEST_ADDITIONAL_EVIDENCE"] as const) {
      const p = auth.planEstimationCorrection(c, 0);
      assert.strictEqual(p.autoExecute, true, c);
    }
    for (const c of ["CHANGE_COMMERCIAL_COMMITMENT", "SEND_EXTERNAL_DOCUMENT", "FINANCIAL_ACTION", "ACCOUNTING_WRITE", "DESTRUCTIVE_ACTION"] as const) {
      const p = auth.planEstimationCorrection(c, 0);
      assert.strictEqual(p.escalate, true, c);
      assert.strictEqual(p.autoExecute, false, c);
    }
    assert.strictEqual(auth.planEstimationCorrection("RECALCULATE", 3).escalate, true, "retry limit honoured");
  });

  test("39d commercial terms are never binding in 4A", () => {
    const term: import("../app/lib/ai/estimation/types").CommercialTerm = { termType: "PBG", tenderRequirement: "10% PBG", binding: false };
    assert.strictEqual(term.binding, false);
    assert.strictEqual(types.COMMERCIAL_TERM_TYPES.length, 15);
    for (const t of ["PAYMENT_TERMS", "LIQUIDATED_DAMAGES", "PBG", "ABG", "RETENTION", "SCOPE_EXCLUSIONS", "DEVIATIONS"]) {
      assert.ok((types.COMMERCIAL_TERM_TYPES as readonly string[]).includes(t), t);
    }
    assert.strictEqual(types.RISK_CATEGORIES.length, 8);
  });

  test("39e full safety gate passes for a clean, reviewed estimate", () => {
    const r2 = mkDoc({ documentId: "D2", revision: 2, sha256: sha("boq-rev2") });
    const tenderProv: Prov = { sourceId: "A_TENDER_RFQ_UPLOAD", tier: "CURRENT_TENDER_DOCUMENT", recordRef: "D2!BOQ!R2", recordDate: "2026-09-01", documentRevision: ev.toRevisionRef(r2) };
    const sg = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: [r2], usedDocumentIds: ["D2"],
      boqItems: [{ lineNumber: "1", description: "MCB", quantity: 12, uom: "Nos", quantityProvenance: tenderProv }],
      rates: [mkRate()], scope: [], clarifications: [],
      uomPairs: [{ boqUom: "Nos", rateUom: "NOS", validatedRuleApplied: false }],
      isFinalCosting: true, checkerOutcome: "PASS", requestedActions: ["CALCULATE_COST", "DRAFT_OFFER"],
    });
    assert.deepStrictEqual(sg.violations, []);
    assert.strictEqual(sg.pass, true);
    const send = safety.evaluateEstimationSafety({
      projectRef: "P1", documents: [], usedDocumentIds: [], boqItems: [], rates: [], scope: [], clarifications: [],
      isFinalCosting: false, requestedActions: ["SEND_QUOTATION", "SUBMIT_TENDER"],
    });
    assert.deepStrictEqual(send.violations, ["OWNER_APPROVAL_REQUIRED:SEND_QUOTATION", "OWNER_APPROVAL_REQUIRED:SUBMIT_TENDER"]);
  });

  test("40 ZOHO WRITE = 0", () => {
    assert.strictEqual(policy.isZohoWriteAllowed(), false);
    assert.strictEqual(policy.classifyAction("ZOHO_WRITE").category, "PROHIBITED");
    assert.strictEqual(auth.ESTIMATION_ACTION_MAP.ZOHO_WRITE, "ZOHO_WRITE");
    const zohoWritesInEstimation = estimationSources.filter(({ src }) => /zoho[^\n]*\b(post|put|patch|delete)\b\s*\(/i.test(src));
    assert.strictEqual(zohoWritesInEstimation.length, 0);
  });

  // ---------- run ----------
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ❌ ${t.name}\n     ${(e as Error).message}`);
    }
  }

  // Operational DB safety
  const opHashesAfter = OP_DBS.map(hashFile);
  const dbSafe = opHashesBefore.every((h, i) => h === opHashesAfter[i]);
  OP_DBS.forEach((p, i) => console.log(`  ${opHashesBefore[i] === opHashesAfter[i] ? "🔒" : "⚠️"} ${path.basename(p)} ${opHashesBefore[i]?.slice(0, 16) ?? "absent"} → ${opHashesAfter[i]?.slice(0, 16) ?? "absent"}`));
  if (!dbSafe) { failed++; console.log("  ❌ OPERATIONAL DB HASH CHANGED"); } else { passed++; console.log("  ✅ Operational DB hashes unchanged"); }

  try { fs.rmSync(process.env.AI_WORKSPACE_DB_PATH!, { force: true }); } catch { /* temp */ }

  console.log(`\nPhase 4A Estimation Foundation: ${passed} passed / ${failed} failed`);
  console.log("ZOHO WRITE = 0");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
