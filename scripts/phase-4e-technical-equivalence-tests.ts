// ============================================================
// Phase 4E — Technical Equivalence Engine tests
// Isolation: uses test-db-isolation helper; no operational DB writes.
// Never touches data/bansil_books.db, data/audit_workspace.db,
// data/ai_workspace.db, Zoho, email, or any external service.
// ============================================================

import {
  isolateTestDatabases,
  snapshotOperationalHashes,
  assertOperationalDbsUnchanged,
} from "./test-db-isolation.ts";

// Isolation MUST happen before any app module import
const ISO = isolateTestDatabases("phase4e");
const OPERATIONAL_BEFORE = snapshotOperationalHashes();
process.on("exit", () => ISO.cleanup());

// --- Dynamic imports after isolation ---
import type {
  RateEvidenceRecord,
  BoqLineRateInput,
  UomAliasRule,
  UomNormalization,
  RateSourceType,
  RateEvidenceStatus,
  CommitmentStatus,
  EvidenceQuality,
  RateFreightBasis,
  RateProvenance,
  PackBasis,
  LandedChargeRef,
  ManualApproval,
  ItemMatchMethod,
} from "../app/lib/ai/estimation/rate-types.ts";
import type { TaxBasis, RateFreshness } from "../app/lib/ai/estimation/types.ts";
import type {
  TechnicalEquivalenceStatus,
  TechnicalEquivalenceResult,
  TechnicalDimensionResult,
  TechnicalDimensionName,
  DimensionStatus,
  BoqLineTechnicalEquivalenceResult,
  TechnicalEquivalenceRunSummary,
} from "../app/lib/ai/estimation/technical-equivalence-types.ts";
import { CONFLICT_STATUSES } from "../app/lib/ai/estimation/technical-equivalence-types.ts";
import {
  assessTechnicalEquivalence,
  assessBoqLineEquivalence,
  runTechnicalEquivalenceAssessment,
  parseSpecificationTokens,
  extractMakeBrand,
  extractRating,
  extractSize,
  extractStandard,
  extractGrade,
  normalizeDescription,
  TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
} from "../app/lib/ai/estimation/technical-equivalence-engine.ts";
import { isZohoWriteAllowed } from "../app/lib/ai/ceo/authority-policy.ts";

// ==================== TEST HARNESS ====================

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
const section = (t: string) => console.log(`\n=== ${t} ===`);

// ==================== FIXTURE HELPERS ====================

function makeEvidence(overrides: Partial<RateEvidenceRecord> & { rate_evidence_id: string }): RateEvidenceRecord {
  return {
    rate_evidence_id: overrides.rate_evidence_id,
    item_id: overrides.item_id ?? null,
    item_code: overrides.item_code ?? null,
    item_name: overrides.item_name ?? null,
    description: overrides.description ?? null,
    item_match_method: overrides.item_match_method ?? "EXACT_ITEM_ID",
    vendor_name: overrides.vendor_name ?? null,
    vendor_id: overrides.vendor_id ?? null,
    rate: overrides.rate ?? 100,
    currency: overrides.currency ?? "INR",
    source_type: overrides.source_type ?? "BILL_RATE",
    source_record_id: overrides.source_record_id ?? "SRC-1",
    source_document: overrides.source_document ?? null,
    source_document_id: overrides.source_document_id ?? null,
    source_date: overrides.source_date ?? "2026-09-01",
    age_days: overrides.age_days ?? 30,
    quantity: overrides.quantity ?? 100,
    uom: overrides.uom ?? "NOS",
    normalized_uom: overrides.normalized_uom ?? null,
    uom_normalization: overrides.uom_normalization ?? "IDENTICAL",
    tax_basis: overrides.tax_basis ?? "GST_EXCLUSIVE",
    gst_rate_percent: overrides.gst_rate_percent ?? null,
    tax_basis_source: overrides.tax_basis_source ?? "header_total_method",
    freight_basis: overrides.freight_basis ?? "UNKNOWN",
    freight_basis_source: overrides.freight_basis_source ?? "no_freight_field",
    landed_cost_basis: overrides.landed_cost_basis ?? "BASIC_RATE_ONLY",
    same_document_landed_charges: overrides.same_document_landed_charges ?? [],
    is_landed_charge_line: overrides.is_landed_charge_line ?? false,
    pack: overrides.pack ?? { rate_per: "UNIT", pack_quantity: null, pack_uom: null },
    validity_date: overrides.validity_date ?? null,
    commitment_status: overrides.commitment_status ?? "ACTUAL_PURCHASE",
    verification_status: overrides.verification_status ?? "VERIFIED",
    evidence_quality: overrides.evidence_quality ?? "HIGH",
    freshness: overrides.freshness ?? "UNKNOWN",
    freshness_reason: overrides.freshness_reason ?? "No Owner freshness policy configured.",
    provenance: overrides.provenance ?? null,
    linked_po_line_id: overrides.linked_po_line_id ?? null,
    linked_bill_line_ids: overrides.linked_bill_line_ids ?? [],
    approval: overrides.approval ?? null,
    warnings: overrides.warnings ?? [],
  };
}

function makeBoqLine(overrides: Partial<BoqLineRateInput> & { boq_line_id: string; description: string }): BoqLineRateInput {
  return {
    boq_line_id: overrides.boq_line_id,
    project_id: overrides.project_id ?? "P4E-TEST",
    description: overrides.description,
    uom: overrides.uom ?? null,
    item_code: overrides.item_code ?? null,
    item_id: overrides.item_id ?? null,
  };
}

const NO_ALIASES: readonly UomAliasRule[] = [];

// ==================== TESTS ====================

async function main(): Promise<void> {
  console.log("PHASE 4E — TECHNICAL EQUIVALENCE ENGINE TESTS");
  console.log(`Engine version: ${TECHNICAL_EQUIVALENCE_ENGINE_VERSION}`);

  // ======================================================
  section("1. Specification Parsing");

  const tokens1 = parseSpecificationTokens("Copper Cable 4 sq mm XLPE Havells");
  assert(tokens1.some((t) => t.category === "SIZE" && t.normalized_value.includes("4")), "1 size token extracted from '4 sq mm'", tokens1);
  assert(tokens1.some((t) => t.category === "MATERIAL" && t.normalized_value === "COPPER"), "2 material token 'COPPER' extracted", tokens1);
  assert(tokens1.some((t) => t.category === "MATERIAL" && t.normalized_value === "XLPE"), "3 material token 'XLPE' extracted", tokens1);
  assert(tokens1.some((t) => t.category === "BRAND" && t.normalized_value === "HAVELLS"), "4 brand token 'HAVELLS' extracted", tokens1);

  const tokens2 = parseSpecificationTokens("MCB 20A SP C-Curve IS60947");
  assert(tokens2.some((t) => t.category === "RATING" && t.normalized_value === "20A"), "5 rating token '20A' extracted", tokens2);
  assert(tokens2.some((t) => t.category === "TYPE" && t.normalized_value === "SP"), "6 type token 'SP' extracted", tokens2);

  const tokens3 = parseSpecificationTokens(null);
  assert(tokens3.length === 0, "7 null description → empty tokens");

  const tokens4 = parseSpecificationTokens("");
  assert(tokens4.length === 0, "8 empty description → empty tokens");

  // ======================================================
  section("2. Identical Spec → TECHNICALLY_EQUIVALENT");

  const ev1 = makeEvidence({
    rate_evidence_id: "EV-CABLE-1",
    item_name: "Copper Cable 4 sq mm",
    description: "Copper Cable 4 sq mm Havells",
    uom: "M",
  });
  const boq1 = makeBoqLine({
    boq_line_id: "BOQ-CABLE-1",
    description: "Copper Cable 4 sq mm Havells",
    uom: "M",
  });
  const r1 = assessTechnicalEquivalence(ev1, boq1, NO_ALIASES);
  assert(r1.status === "TECHNICALLY_EQUIVALENT", "9 identical spec + UOM + make → TECHNICALLY_EQUIVALENT", r1);
  assert(r1.deterministic === true, "10 result marked deterministic");
  assert(r1.model_calls === 0, "11 zero model calls");
  assert(r1.ownerOverride === null, "12 no owner override");

  // ======================================================
  section("3. Rating Mismatch → SPEC_CONFLICT");

  const ev2 = makeEvidence({
    rate_evidence_id: "EV-MCB-15A",
    item_name: "MCB 15A SP",
    description: "MCB 15A SP C-Curve",
    uom: "NOS",
  });
  const boq2 = makeBoqLine({
    boq_line_id: "BOQ-MCB-20A",
    description: "MCB 20A SP C-Curve",
    uom: "NOS",
  });
  const r2 = assessTechnicalEquivalence(ev2, boq2, NO_ALIASES);
  assert(r2.status === "SPEC_CONFLICT", "13 rating 15A vs 20A → SPEC_CONFLICT", r2);
  const specDim2 = r2.dimensions.find((d) => d.dimension === "SPEC");
  assert(specDim2?.status === "CONFLICT", "14 SPEC dimension shows CONFLICT", specDim2);
  assert(specDim2?.conflictNote?.includes("15A") && specDim2?.conflictNote?.includes("20A"),
    "15 conflict note mentions both ratings", specDim2?.conflictNote);

  // ======================================================
  section("4. Make Conflict → MAKE_CONFLICT");

  const ev3 = makeEvidence({
    rate_evidence_id: "EV-CABLE-ANCHOR",
    item_name: "Copper Cable 4 sq mm",
    description: "Copper Cable 4 sq mm Anchor",
    uom: "M",
  });
  const boq3 = makeBoqLine({
    boq_line_id: "BOQ-CABLE-HAVELLS",
    description: "Copper Cable 4 sq mm Havells",
    uom: "M",
  });
  const r3 = assessTechnicalEquivalence(ev3, boq3, NO_ALIASES);
  assert(r3.status === "MAKE_CONFLICT", "16 Havells vs Anchor → MAKE_CONFLICT", r3);
  const makeDim3 = r3.dimensions.find((d) => d.dimension === "MAKE");
  assert(makeDim3?.status === "CONFLICT", "17 MAKE dimension shows CONFLICT", makeDim3);

  // ======================================================
  section("5. Missing BOQ Spec → INSUFFICIENT_EVIDENCE");

  const ev4 = makeEvidence({
    rate_evidence_id: "EV-CABLE-SPEC",
    item_name: "Copper Cable 4 sq mm",
    description: "Copper Cable 4 sq mm",
    uom: "M",
  });
  const boq4 = makeBoqLine({
    boq_line_id: "BOQ-GENERIC",
    description: "Cable",  // no size, no rating
    uom: "M",
  });
  const r4 = assessTechnicalEquivalence(ev4, boq4, NO_ALIASES);
  assert(r4.status === "INSUFFICIENT_EVIDENCE", "18 BOQ missing spec, evidence has spec → INSUFFICIENT_EVIDENCE", r4);

  // ======================================================
  section("6. Missing Evidence Spec → INSUFFICIENT_EVIDENCE");

  const ev5 = makeEvidence({
    rate_evidence_id: "EV-GENERIC",
    item_name: "Cable",  // no spec
    description: null,
    uom: "M",
  });
  const boq5 = makeBoqLine({
    boq_line_id: "BOQ-CABLE-4SQ",
    description: "Copper Cable 4 sq mm",
    uom: "M",
  });
  const r5 = assessTechnicalEquivalence(ev5, boq5, NO_ALIASES);
  assert(r5.status === "INSUFFICIENT_EVIDENCE", "19 evidence missing spec, BOQ has spec → INSUFFICIENT_EVIDENCE", r5);

  // ======================================================
  section("7. UOM Approved Alias → TECHNICALLY_EQUIVALENT");

  const ev6 = makeEvidence({
    rate_evidence_id: "EV-CABLE-MTR",
    item_name: "Copper Cable 4 sq mm Havells",
    description: "Copper Cable 4 sq mm Havells",
    uom: "Mtr",
    uom_normalization: "SPELLING_ALIAS",
  });
  const boq6 = makeBoqLine({
    boq_line_id: "BOQ-CABLE-RM",
    description: "Copper Cable 4 sq mm Havells",
    uom: "RM",  // Running Metre — different canonical
  });
  const approvedAlias: UomAliasRule = {
    alias: "RM",
    canonical: "M",
    approvedBy: "Owner",
    approvedAt: "2026-09-30T10:00:00Z",
  };
  const r6 = assessTechnicalEquivalence(ev6, boq6, [approvedAlias]);
  assert(r6.status === "TECHNICALLY_EQUIVALENT", "20 RM→M approved alias → TECHNICALLY_EQUIVALENT", r6);

  // ======================================================
  section("8. UOM Spelling Alias Only → INSUFFICIENT_EVIDENCE");

  // M and Mtr are spelling aliases (both → M canonical) but if BOQ says "ROLL"
  // and evidence says "M", without an approved alias it should be CONFLICT
  const ev7 = makeEvidence({
    rate_evidence_id: "EV-CABLE-ROLL",
    item_name: "Copper Cable 4 sq mm",
    description: "Copper Cable 4 sq mm",
    uom: "Roll",
  });
  const boq7 = makeBoqLine({
    boq_line_id: "BOQ-CABLE-M",
    description: "Copper Cable 4 sq mm",
    uom: "M",
  });
  const r7 = assessTechnicalEquivalence(ev7, boq7, NO_ALIASES);
  // ROLL and M are different canonical UOMs with no approved alias
  assert(r7.status === "UOM_INCOMPATIBLE", "21 Roll vs M with no alias → UOM_INCOMPATIBLE", r7);

  // ======================================================
  section("9. UOM Incompatible Type → UOM_INCOMPATIBLE");

  const ev8 = makeEvidence({
    rate_evidence_id: "EV-KG",
    item_name: "Copper Cable 4 sq mm",
    description: "Copper Cable 4 sq mm",
    uom: "KG",
  });
  const boq8 = makeBoqLine({
    boq_line_id: "BOQ-M",
    description: "Copper Cable 4 sq mm",
    uom: "M",
  });
  const r8 = assessTechnicalEquivalence(ev8, boq8, NO_ALIASES);
  assert(r8.status === "UOM_INCOMPATIBLE", "22 KG vs M → UOM_INCOMPATIBLE", r8);

  // ======================================================
  section("10. Grade Mismatch → SPEC_CONFLICT");

  const ev9 = makeEvidence({
    rate_evidence_id: "EV-STEEL-E250",
    item_name: "MS Plate IS2062 E250",
    description: "MS Plate IS2062 E250 10mm",
    uom: "KG",
  });
  const boq9 = makeBoqLine({
    boq_line_id: "BOQ-STEEL-E350",
    description: "MS Plate IS2062 E350 10mm",
    uom: "KG",
  });
  const r9 = assessTechnicalEquivalence(ev9, boq9, NO_ALIASES);
  assert(r9.status === "SPEC_CONFLICT", "23 E250 vs E350 → SPEC_CONFLICT", r9);
  const gradeDim9 = r9.dimensions.find((d) => d.dimension === "GRADE");
  assert(gradeDim9?.status === "CONFLICT", "24 GRADE dimension shows CONFLICT", gradeDim9);

  // ======================================================
  section("11. Conflict Overrides Description Similarity (constraint 6)");

  // Two items with very similar descriptions but different ratings
  const ev10 = makeEvidence({
    rate_evidence_id: "EV-SIMILAR-WRONG",
    item_name: "MCB 32A TP C-Curve Havells IS60947",
    description: "MCB 32A TP C-Curve Havells IS60947 for panel board",
    uom: "NOS",
  });
  const boq10 = makeBoqLine({
    boq_line_id: "BOQ-SIMILAR-RIGHT",
    description: "MCB 16A TP C-Curve Havells IS60947 for panel board",
    uom: "NOS",
  });
  const r10 = assessTechnicalEquivalence(ev10, boq10, NO_ALIASES);
  assert(r10.status === "SPEC_CONFLICT", "25 conflict overrides description similarity (32A vs 16A)", r10);

  // ======================================================
  section("12. Conflict Overrides Cheapest Rate (constraint 7)");

  // Even if this evidence has the cheapest rate, conflict must win
  const evCheap = makeEvidence({
    rate_evidence_id: "EV-CHEAP",
    item_name: "MCB 10A SP",
    description: "MCB 10A SP",
    uom: "NOS",
    rate: 5,  // very cheap
  });
  const boqCheap = makeBoqLine({
    boq_line_id: "BOQ-CHEAP",
    description: "MCB 20A SP",
    uom: "NOS",
  });
  const rCheap = assessTechnicalEquivalence(evCheap, boqCheap, NO_ALIASES);
  assert(rCheap.status === "SPEC_CONFLICT", "26 conflict overrides cheapest rate (10A vs 20A)", rCheap);
  // Rate should NOT influence the result
  assert(CONFLICT_STATUSES.has(rCheap.status), "27 cheapest rate never changes conflict status");

  // ======================================================
  section("13. Conflict Overrides Most Recent Rate (constraint 7)");

  const evRecent = makeEvidence({
    rate_evidence_id: "EV-RECENT",
    item_name: "MCB 10A SP",
    description: "MCB 10A SP",
    uom: "NOS",
    source_date: "2026-10-01",  // very recent
    age_days: 0,
  });
  const boqRecent = makeBoqLine({
    boq_line_id: "BOQ-RECENT",
    description: "MCB 20A SP",
    uom: "NOS",
  });
  const rRecent = assessTechnicalEquivalence(evRecent, boqRecent, NO_ALIASES);
  assert(rRecent.status === "SPEC_CONFLICT", "28 conflict overrides most recent rate", rRecent);

  // ======================================================
  section("14. Conflict Overrides Most Frequent Rate (constraint 7)");

  // Frequency doesn't matter — assessed identically regardless
  const evFreq = makeEvidence({
    rate_evidence_id: "EV-FREQ",
    item_name: "MCB 10A SP",
    description: "MCB 10A SP",
    uom: "NOS",
    quantity: 10000,  // high quantity = frequently purchased
  });
  const boqFreq = makeBoqLine({
    boq_line_id: "BOQ-FREQ",
    description: "MCB 20A SP",
    uom: "NOS",
  });
  const rFreq = assessTechnicalEquivalence(evFreq, boqFreq, NO_ALIASES);
  assert(rFreq.status === "SPEC_CONFLICT", "29 conflict overrides most frequent rate", rFreq);

  // ======================================================
  section("15. Determinism — Same Inputs → Same Results (constraint 11)");

  const ev11a = makeEvidence({
    rate_evidence_id: "EV-DET-1",
    item_name: "MCB 16A SP Havells",
    description: "MCB 16A SP C-Curve Havells",
    uom: "NOS",
  });
  const boq11 = makeBoqLine({
    boq_line_id: "BOQ-DET-1",
    description: "MCB 16A SP C-Curve Havells",
    uom: "NOS",
  });
  const rDet1 = assessTechnicalEquivalence(ev11a, boq11, NO_ALIASES);
  const rDet2 = assessTechnicalEquivalence(ev11a, boq11, NO_ALIASES);
  assert(rDet1.status === rDet2.status, "30 same inputs → same status", { a: rDet1.status, b: rDet2.status });
  assert(rDet1.dimensions.length === rDet2.dimensions.length, "31 same inputs → same dimension count");
  for (let i = 0; i < rDet1.dimensions.length; i++) {
    assert(
      rDet1.dimensions[i].dimension === rDet2.dimensions[i].dimension &&
      rDet1.dimensions[i].status === rDet2.dimensions[i].status,
      `32.${i} same inputs → same dimension[${i}] result`,
    );
  }

  // ======================================================
  section("16. No AI/Model Calls");

  assert(rDet1.model_calls === 0, "33 model_calls === 0 on every result");
  assert(rDet1.deterministic === true, "34 deterministic === true on every result");

  // ======================================================
  section("17. ownerOverride Never Fabricated (constraint 9)");

  assert(r1.ownerOverride === null, "35 ownerOverride null on EQUIVALENT");
  assert(r2.ownerOverride === null, "36 ownerOverride null on SPEC_CONFLICT");
  assert(r3.ownerOverride === null, "37 ownerOverride null on MAKE_CONFLICT");
  assert(r4.ownerOverride === null, "38 ownerOverride null on INSUFFICIENT_EVIDENCE");
  assert(r8.ownerOverride === null, "39 ownerOverride null on UOM_INCOMPATIBLE");

  // ======================================================
  section("18. Phase 4D Rate/Provenance Unchanged (constraint 10)");

  // Verify the original evidence object is not mutated
  const evOrig = makeEvidence({
    rate_evidence_id: "EV-IMMUT",
    item_name: "Cable 4 sq mm",
    description: "Cable 4 sq mm",
    uom: "M",
    rate: 50,
    provenance: {
      sourceSystem: "BANSIL_BOOKS_DB",
      table: "purchase_bill_line_items",
      recordId: "L-ORIG",
      documentId: "B-ORIG",
      documentNumber: "BILL-ORIG",
      recordDate: "2026-09-01",
      tier: "VERIFIED_HISTORICAL_PURCHASE",
      sourceFingerprint: "abc123def456",
      basis: "GST-exclusive taxable line rate",
    },
  });
  const origRate = evOrig.rate;
  const origProvenance = JSON.stringify(evOrig.provenance);
  assessTechnicalEquivalence(evOrig, boq5, NO_ALIASES);
  assert(evOrig.rate === origRate, "40 evidence rate unchanged after assessment");
  assert(JSON.stringify(evOrig.provenance) === origProvenance, "41 evidence provenance unchanged after assessment");

  // ======================================================
  section("19. Batch Assessment — BOQ Line");

  const evidenceBatch: RateEvidenceRecord[] = [
    makeEvidence({
      rate_evidence_id: "EV-BATCH-EQ",
      item_name: "MCB 16A SP C-Curve",
      description: "MCB 16A SP C-Curve Havells",
      uom: "NOS",
    }),
    makeEvidence({
      rate_evidence_id: "EV-BATCH-CONFLICT",
      item_name: "MCB 32A TP C-Curve",
      description: "MCB 32A TP C-Curve Havells",
      uom: "NOS",
    }),
    makeEvidence({
      rate_evidence_id: "EV-BATCH-INSUF",
      item_name: "MCB",
      description: null,
      uom: "NOS",
    }),
  ];
  const boqBatch = makeBoqLine({
    boq_line_id: "BOQ-BATCH-1",
    description: "MCB 16A SP C-Curve Havells",
    uom: "NOS",
  });
  const batchResult = assessBoqLineEquivalence(boqBatch, evidenceBatch, NO_ALIASES);
  assert(batchResult.equivalent_evidence_ids.includes("EV-BATCH-EQ"), "42 batch: equivalent evidence identified");
  assert(batchResult.conflict_evidence.some((c) => c.rate_evidence_id === "EV-BATCH-CONFLICT"), "43 batch: conflict evidence identified");
  assert(batchResult.insufficient_evidence.some((i) => i.rate_evidence_id === "EV-BATCH-INSUF"), "44 batch: insufficient evidence identified");
  assert(batchResult.comparison_count === 3, "45 batch: comparison count correct", batchResult.comparison_count);
  assert(batchResult.model_calls === 0, "46 batch: model_calls === 0");

  // ======================================================
  section("20. Batch Run — Multiple BOQ Lines");

  const boqLines = [
    makeBoqLine({ boq_line_id: "BOQ-RUN-1", description: "MCB 16A SP C-Curve Havells", uom: "NOS" }),
    makeBoqLine({ boq_line_id: "BOQ-RUN-2", description: "Copper Cable 4 sq mm", uom: "M" }),
  ];
  const evidenceMap = new Map<string, readonly RateEvidenceRecord[]>();
  evidenceMap.set("BOQ-RUN-1", [
    makeEvidence({ rate_evidence_id: "EV-RUN-1A", item_name: "MCB 16A SP C-Curve Havells", description: "MCB 16A SP C-Curve Havells", uom: "NOS" }),
  ]);
  evidenceMap.set("BOQ-RUN-2", [
    makeEvidence({ rate_evidence_id: "EV-RUN-2A", item_name: "Copper Cable 4 sq mm", description: "Copper Cable 4 sq mm", uom: "M" }),
    makeEvidence({ rate_evidence_id: "EV-RUN-2B", item_name: "Copper Cable 6 sq mm", description: "Copper Cable 6 sq mm", uom: "M" }),
  ]);
  const runResult = runTechnicalEquivalenceAssessment({
    project_id: "P4E-TEST",
    as_of_date: "2026-10-01",
    boq_lines: boqLines,
    evidence_by_boq_line: evidenceMap,
    uom_aliases: NO_ALIASES,
  });
  assert(runResult.method === "DETERMINISTIC", "47 run method is DETERMINISTIC");
  assert(runResult.model_calls === 0, "48 run model_calls === 0");
  assert(runResult.boq_line_count === 2, "49 run BOQ line count correct");
  assert(runResult.total_comparisons === 3, "50 run total comparisons correct", runResult.total_comparisons);
  assert(runResult.engine_version === TECHNICAL_EQUIVALENCE_ENGINE_VERSION, "51 run engine version set");
  // BOQ-RUN-2 has 6 sq mm vs 4 sq mm → should be conflict for one evidence
  const run2Result = runResult.boq_results.find((r) => r.boq_line_id === "BOQ-RUN-2");
  assert(run2Result?.conflict_evidence.some((c) => c.rate_evidence_id === "EV-RUN-2B") === true,
    "52 run: 4 sq mm vs 6 sq mm is conflict", run2Result);

  // ======================================================
  section("21. Both UOMs Missing → UNKNOWN dimension, INSUFFICIENT_EVIDENCE overall");

  const evNoUom = makeEvidence({
    rate_evidence_id: "EV-NO-UOM",
    item_name: "Cable",
    description: null,
    uom: null,
  });
  const boqNoUom = makeBoqLine({
    boq_line_id: "BOQ-NO-UOM",
    description: "Cable",
    uom: null,
  });
  const rNoUom = assessTechnicalEquivalence(evNoUom, boqNoUom, NO_ALIASES);
  const uomDim = rNoUom.dimensions.find((d) => d.dimension === "UOM");
  assert(uomDim?.status === "UNKNOWN", "53 both UOMs null → UOM dimension UNKNOWN", uomDim);
  assert(rNoUom.status === "INSUFFICIENT_EVIDENCE", "54 both missing → INSUFFICIENT_EVIDENCE");

  // ======================================================
  section("22. Standard Reference Mismatch → SPEC_CONFLICT");

  const evStd1 = makeEvidence({
    rate_evidence_id: "EV-STD-IS2062",
    item_name: "MS Flat IS2062",
    description: "MS Flat IS2062",
    uom: "KG",
  });
  const boqStd1 = makeBoqLine({
    boq_line_id: "BOQ-STD-IS1239",
    description: "MS Flat IS1239",
    uom: "KG",
  });
  const rStd = assessTechnicalEquivalence(evStd1, boqStd1, NO_ALIASES);
  assert(rStd.status === "SPEC_CONFLICT", "55 IS2062 vs IS1239 → SPEC_CONFLICT", rStd);
  const stdDim = rStd.dimensions.find((d) => d.dimension === "STANDARD");
  assert(stdDim?.status === "CONFLICT", "56 STANDARD dimension shows CONFLICT", stdDim);

  // ======================================================
  section("23. UOM Spelling Alias (same canonical) → MATCH");

  // Nos and NOS both canonicalize to NOS
  const evNos = makeEvidence({
    rate_evidence_id: "EV-NOS",
    item_name: "MCB 16A SP Havells",
    description: "MCB 16A SP Havells",
    uom: "Nos",
  });
  const boqNos = makeBoqLine({
    boq_line_id: "BOQ-NOS",
    description: "MCB 16A SP Havells",
    uom: "NOS",
  });
  const rNos = assessTechnicalEquivalence(evNos, boqNos, NO_ALIASES);
  assert(rNos.status === "TECHNICALLY_EQUIVALENT", "57 Nos vs NOS (same canonical) → TECHNICALLY_EQUIVALENT", rNos);
  // Mtr vs M also both canonicalize to M
  const evMtr = makeEvidence({
    rate_evidence_id: "EV-MTR",
    item_name: "Copper Cable 4 sq mm Havells",
    description: "Copper Cable 4 sq mm Havells",
    uom: "Mtr",
  });
  const boqMtr = makeBoqLine({
    boq_line_id: "BOQ-MTR",
    description: "Copper Cable 4 sq mm Havells",
    uom: "M",
  });
  const rMtr = assessTechnicalEquivalence(evMtr, boqMtr, NO_ALIASES);
  assert(rMtr.status === "TECHNICALLY_EQUIVALENT", "58 Mtr vs M (same canonical) → TECHNICALLY_EQUIVALENT", rMtr);

  // ======================================================
  section("24. Multiple Conflicts — Most Specific Wins");

  // Both UOM and SPEC conflict: UOM_INCOMPATIBLE takes priority
  const evMulti = makeEvidence({
    rate_evidence_id: "EV-MULTI",
    item_name: "MCB 10A SP",
    description: "MCB 10A SP",
    uom: "KG",
  });
  const boqMulti = makeBoqLine({
    boq_line_id: "BOQ-MULTI",
    description: "MCB 20A SP",
    uom: "NOS",
  });
  const rMulti = assessTechnicalEquivalence(evMulti, boqMulti, NO_ALIASES);
  assert(CONFLICT_STATUSES.has(rMulti.status), "59 multiple conflicts → still a conflict status", rMulti.status);
  // Verify both dimensions show CONFLICT
  const multiSpec = rMulti.dimensions.find((d) => d.dimension === "SPEC");
  const multiUom = rMulti.dimensions.find((d) => d.dimension === "UOM");
  assert(multiSpec?.status === "CONFLICT", "60 SPEC dimension CONFLICT in multi-conflict");
  assert(multiUom?.status === "CONFLICT", "61 UOM dimension CONFLICT in multi-conflict");

  // ======================================================
  section("25. Zoho Write Guard");

  assert(!isZohoWriteAllowed(), "62 Zoho write is permanently prohibited");

  // ======================================================
  section("26. Engine Version & Structure");

  assert(typeof TECHNICAL_EQUIVALENCE_ENGINE_VERSION === "string" && TECHNICAL_EQUIVALENCE_ENGINE_VERSION.startsWith("4E"),
    "63 engine version starts with 4E");
  assert(typeof CONFLICT_STATUSES !== "undefined" && CONFLICT_STATUSES.size > 0, "64 CONFLICT_STATUSES defined and non-empty");
  assert(CONFLICT_STATUSES.has("TECHNICALLY_CONFLICT"), "65 CONFLICT_STATUSES includes TECHNICALLY_CONFLICT");
  assert(CONFLICT_STATUSES.has("UOM_INCOMPATIBLE"), "66 CONFLICT_STATUSES includes UOM_INCOMPATIBLE");
  assert(CONFLICT_STATUSES.has("MAKE_CONFLICT"), "67 CONFLICT_STATUSES includes MAKE_CONFLICT");
  assert(CONFLICT_STATUSES.has("SPEC_CONFLICT"), "68 CONFLICT_STATUSES includes SPEC_CONFLICT");
  assert(!CONFLICT_STATUSES.has("TECHNICALLY_EQUIVALENT" as any), "69 CONFLICT_STATUSES does NOT include TECHNICALLY_EQUIVALENT");
  assert(!CONFLICT_STATUSES.has("INSUFFICIENT_EVIDENCE" as any), "70 CONFLICT_STATUSES does NOT include INSUFFICIENT_EVIDENCE");

  // ======================================================
  section("27. Edge Cases — All Dimensions Match With Standards");

  const evFull = makeEvidence({
    rate_evidence_id: "EV-FULL",
    item_name: "MCB 16A SP C-Curve Havells IS60947",
    description: "MCB 16A SP C-Curve Havells IS60947",
    uom: "NOS",
  });
  const boqFull = makeBoqLine({
    boq_line_id: "BOQ-FULL",
    description: "MCB 16A SP C-Curve Havells IS60947",
    uom: "NOS",
  });
  const rFull = assessTechnicalEquivalence(evFull, boqFull, NO_ALIASES);
  assert(rFull.status === "TECHNICALLY_EQUIVALENT", "71 full match with standard → TECHNICALLY_EQUIVALENT", rFull);
  const allMatch = rFull.dimensions.filter((d) => d.status === "MATCH");
  assert(allMatch.length >= 3, "72 at least 3 dimensions show MATCH", allMatch.map((d) => d.dimension));

  // ======================================================
  section("28. Edge Cases — Null Descriptions Both Sides");

  const evNull = makeEvidence({
    rate_evidence_id: "EV-NULL",
    item_name: null,
    description: null,
    uom: "NOS",
  });
  const boqNull = makeBoqLine({
    boq_line_id: "BOQ-NULL",
    description: "",
    uom: "NOS",
  });
  const rNull = assessTechnicalEquivalence(evNull, boqNull, NO_ALIASES);
  assert(rNull.status === "INSUFFICIENT_EVIDENCE", "73 both descriptions null/empty → INSUFFICIENT_EVIDENCE");

  // ======================================================
  section("29. BOQ Line With No Evidence");

  const boqEmpty = makeBoqLine({
    boq_line_id: "BOQ-EMPTY",
    description: "MCB 16A SP",
    uom: "NOS",
  });
  const batchEmpty = assessBoqLineEquivalence(boqEmpty, [], NO_ALIASES);
  assert(batchEmpty.equivalent_evidence_ids.length === 0, "74 no evidence → no equivalents");
  assert(batchEmpty.comparison_count === 0, "75 no evidence → zero comparisons");

  // ======================================================
  section("30. Spec Extraction Edge Cases");

  assert(extractRating("Contactor 415V 20A") === "20A+415V", "76 multiple ratings extracted and sorted");
  assert(extractSize("Panel 600mm x 400mm") !== null, "77 size extracted from panel dimensions");
  assert(extractMakeBrand("ABB Contactor") === "ABB", "78 ABB brand extracted");
  assert(extractMakeBrand("no brand here") === null, "79 no brand → null");
  assert(extractStandard("Busbar IS8623") === "IS8623", "80 IS standard extracted");
  assert(extractGrade("Steel IS2062 E250") !== null, "81 grade E250 extracted");

  // ======================================================
  section("31. Normalize Description");

  assert(normalizeDescription(null) === "", "82 null → empty");
  assert(normalizeDescription("  copper Cable 4 SQ mm  ") === "COPPER CABLE 4 SQ MM", "83 normalization trims/uppercases");

  // ======================================================
  // ============ PHASE 4E.2 CORRECTION — HARDENING TESTS ============
  // ======================================================

  section("32. CRITICAL FIX 1 — Partial Required Specification");

  // BOQ requires BOTH 100A AND 4SQMM; candidate only has 100A.
  // Engine must NOT hide the missing 4SQMM behind the matching 100A.
  const evPartial1 = makeEvidence({
    rate_evidence_id: "EV-PARTIAL-1",
    item_name: "MCB 100A",
    description: "MCB 100A",
    uom: "NOS",
  });
  const boqPartial1 = makeBoqLine({
    boq_line_id: "BOQ-PARTIAL-1",
    description: "MCB 100A 4SQMM",
    uom: "NOS",
  });
  const rPartial1 = assessTechnicalEquivalence(evPartial1, boqPartial1, NO_ALIASES);
  assert(rPartial1.status === "INSUFFICIENT_EVIDENCE",
    "85 BOQ=100A+4SQMM vs Candidate=100A → INSUFFICIENT_EVIDENCE (missing 4SQMM)", rPartial1);
  const specPartial1 = rPartial1.dimensions.find((d) => d.dimension === "SPEC");
  assert(specPartial1?.status === "UNKNOWN",
    "86 SPEC dimension UNKNOWN when candidate lacks required size attribute", specPartial1);

  // Reverse: candidate has only size, missing rating
  const evPartial2 = makeEvidence({
    rate_evidence_id: "EV-PARTIAL-2",
    item_name: "Cable 4SQMM",
    description: "Cable 4SQMM",
    uom: "NOS",
  });
  const boqPartial2 = makeBoqLine({
    boq_line_id: "BOQ-PARTIAL-2",
    description: "Cable 100A 4SQMM",
    uom: "NOS",
  });
  const rPartial2 = assessTechnicalEquivalence(evPartial2, boqPartial2, NO_ALIASES);
  assert(rPartial2.status === "INSUFFICIENT_EVIDENCE",
    "87 BOQ=100A+4SQMM vs Candidate=4SQMM → INSUFFICIENT_EVIDENCE (missing 100A)", rPartial2);

  // ======================================================
  section("33. CRITICAL FIX 2 — Extra Candidate Metadata ≠ Conflict");

  // BOQ requires 100A only; candidate has 100A + 415V.
  // Extra 415V is informational, must NOT cause conflict.
  const evExtra1 = makeEvidence({
    rate_evidence_id: "EV-EXTRA-1",
    item_name: "MCB 100A 415V",
    description: "MCB 100A 415V",
    uom: "NOS",
  });
  const boqExtra1 = makeBoqLine({
    boq_line_id: "BOQ-EXTRA-1",
    description: "MCB 100A",
    uom: "NOS",
  });
  const rExtra1 = assessTechnicalEquivalence(evExtra1, boqExtra1, NO_ALIASES);
  const specExtra1 = rExtra1.dimensions.find((d) => d.dimension === "SPEC");
  assert(specExtra1?.status !== "CONFLICT",
    "88 BOQ=100A vs Candidate=100A+415V → SPEC NOT CONFLICT (extra 415V informational)", specExtra1);
  assert(specExtra1?.status === "MATCH",
    "89 BOQ=100A vs Candidate=100A+415V → SPEC MATCH (BOQ requirement satisfied)", specExtra1);

  // But extra 415V that conflicts with BOQ voltage MUST conflict
  const evExtraConflict = makeEvidence({
    rate_evidence_id: "EV-EXTRA-CONFLICT",
    item_name: "MCB 100A 230V",
    description: "MCB 100A 230V",
    uom: "NOS",
  });
  const boqExtraConflict = makeBoqLine({
    boq_line_id: "BOQ-EXTRA-CONFLICT",
    description: "MCB 100A 415V",
    uom: "NOS",
  });
  const rExtraConflict = assessTechnicalEquivalence(evExtraConflict, boqExtraConflict, NO_ALIASES);
  assert(rExtraConflict.status === "SPEC_CONFLICT",
    "90 BOQ=100A+415V vs Candidate=100A+230V → SPEC_CONFLICT (voltage conflict)", rExtraConflict);

  // ======================================================
  section("34. Missing Candidate Rating → INSUFFICIENT_EVIDENCE");

  const evMissRating = makeEvidence({
    rate_evidence_id: "EV-MISS-RATING",
    item_name: "MCB 100A",
    description: "MCB 100A",
    uom: "NOS",
  });
  const boqMissRating = makeBoqLine({
    boq_line_id: "BOQ-MISS-RATING",
    description: "MCB 100A 415V",
    uom: "NOS",
  });
  const rMissRating = assessTechnicalEquivalence(evMissRating, boqMissRating, NO_ALIASES);
  assert(rMissRating.status === "INSUFFICIENT_EVIDENCE",
    "91 BOQ=100A+415V vs Candidate=100A → INSUFFICIENT_EVIDENCE (missing voltage)", rMissRating);

  // ======================================================
  section("35. Explicit Conflicts with Multiple Ratings");

  // Rating conflict: 80A vs 100A, even when voltage matches
  const evConflictMulti = makeEvidence({
    rate_evidence_id: "EV-CONFLICT-MULTI",
    item_name: "MCB 80A 415V",
    description: "MCB 80A 415V",
    uom: "NOS",
  });
  const boqConflictMulti = makeBoqLine({
    boq_line_id: "BOQ-CONFLICT-MULTI",
    description: "MCB 100A 415V",
    uom: "NOS",
  });
  const rConflictMulti = assessTechnicalEquivalence(evConflictMulti, boqConflictMulti, NO_ALIASES);
  assert(rConflictMulti.status === "SPEC_CONFLICT",
    "92 BOQ=100A+415V vs Candidate=80A+415V → SPEC_CONFLICT (current mismatch)", rConflictMulti);

  // Voltage conflict: 230V vs 415V, even when current matches
  const evVoltConflict = makeEvidence({
    rate_evidence_id: "EV-VOLT-CONFLICT",
    item_name: "MCB 100A 230V",
    description: "MCB 100A 230V",
    uom: "NOS",
  });
  const boqVoltConflict = makeBoqLine({
    boq_line_id: "BOQ-VOLT-CONFLICT",
    description: "MCB 100A 415V",
    uom: "NOS",
  });
  const rVoltConflict = assessTechnicalEquivalence(evVoltConflict, boqVoltConflict, NO_ALIASES);
  assert(rVoltConflict.status === "SPEC_CONFLICT",
    "93 BOQ=100A+415V vs Candidate=100A+230V → SPEC_CONFLICT (voltage conflict)", rVoltConflict);

  // ======================================================
  section("36. Unit Semantic Separation");

  // 20A vs 20kA → different semantic types, must NOT match
  const evKA = makeEvidence({
    rate_evidence_id: "EV-20KA",
    item_name: "MCCB 20kA",
    description: "MCCB 20kA",
    uom: "NOS",
  });
  const boq20A = makeBoqLine({
    boq_line_id: "BOQ-20A",
    description: "MCCB 20A",
    uom: "NOS",
  });
  const rUnitSep1 = assessTechnicalEquivalence(evKA, boq20A, NO_ALIASES);
  assert(rUnitSep1.status !== "TECHNICALLY_EQUIVALENT",
    "94 20A vs 20kA → must NOT be TECHNICALLY_EQUIVALENT", rUnitSep1);
  assert(!CONFLICT_STATUSES.has(rUnitSep1.status) || rUnitSep1.status === "SPEC_CONFLICT" || rUnitSep1.status === "TECHNICALLY_CONFLICT",
    "95 20A vs 20kA → INSUFFICIENT_EVIDENCE or conflict (different unit types)", rUnitSep1.status);

  // 100A vs 100V → different semantic types, must NOT match
  const evVolt = makeEvidence({
    rate_evidence_id: "EV-100V",
    item_name: "Device 100V",
    description: "Device 100V",
    uom: "NOS",
  });
  const boq100A = makeBoqLine({
    boq_line_id: "BOQ-100A",
    description: "Device 100A",
    uom: "NOS",
  });
  const rUnitSep2 = assessTechnicalEquivalence(evVolt, boq100A, NO_ALIASES);
  assert(rUnitSep2.status !== "TECHNICALLY_EQUIVALENT",
    "96 100A vs 100V → must NOT be TECHNICALLY_EQUIVALENT", rUnitSep2);

  // ======================================================
  section("37. Substring Safety");

  // 16A vs 116A → must NOT match (different values, not substring)
  const ev116A = makeEvidence({
    rate_evidence_id: "EV-116A",
    item_name: "MCB 116A",
    description: "MCB 116A",
    uom: "NOS",
  });
  const boq16A = makeBoqLine({
    boq_line_id: "BOQ-16A",
    description: "MCB 16A",
    uom: "NOS",
  });
  const rSubstr = assessTechnicalEquivalence(ev116A, boq16A, NO_ALIASES);
  assert(rSubstr.status === "SPEC_CONFLICT",
    "97 16A vs 116A → SPEC_CONFLICT (different values)", rSubstr);

  // ======================================================
  section("38. kA Parsing");

  // 25kA must be parsed as a rating token
  const tokensKA1 = parseSpecificationTokens("MCCB 25kA 415V");
  assert(tokensKA1.some((t) => t.category === "RATING" && t.normalized_value === "25KA"),
    "98 '25kA' parsed as RATING token '25KA'", tokensKA1.filter((t) => t.category === "RATING"));
  assert(tokensKA1.some((t) => t.category === "RATING" && t.normalized_value === "415V"),
    "99 '415V' parsed alongside '25kA'", tokensKA1.filter((t) => t.category === "RATING"));

  // 25 kA (with space) must also parse
  const tokensKA2 = parseSpecificationTokens("MCCB 25 kA");
  assert(tokensKA2.some((t) => t.category === "RATING" && t.normalized_value === "25KA"),
    "100 '25 kA' (space) parsed as '25KA'", tokensKA2.filter((t) => t.category === "RATING"));

  // kA through assessTechnicalEquivalence — matching
  const evKA_match = makeEvidence({
    rate_evidence_id: "EV-KA-MATCH",
    item_name: "MCCB 100A 25kA 415V",
    description: "MCCB 100A 25kA 415V",
    uom: "NOS",
  });
  const boqKA_match = makeBoqLine({
    boq_line_id: "BOQ-KA-MATCH",
    description: "MCCB 100A 25kA 415V",
    uom: "NOS",
  });
  const rKAmatch = assessTechnicalEquivalence(evKA_match, boqKA_match, NO_ALIASES);
  assert(rKAmatch.status === "TECHNICALLY_EQUIVALENT",
    "101 matching kA + A + V → TECHNICALLY_EQUIVALENT", rKAmatch);

  // kA mismatch — no equal-or-better
  const evKA_mismatch = makeEvidence({
    rate_evidence_id: "EV-KA-MISMATCH",
    item_name: "MCCB 100A 36kA 415V",
    description: "MCCB 100A 36kA 415V",
    uom: "NOS",
  });
  const boqKA_mismatch = makeBoqLine({
    boq_line_id: "BOQ-KA-MISMATCH",
    description: "MCCB 100A 25kA 415V",
    uom: "NOS",
  });
  const rKAmismatch = assessTechnicalEquivalence(evKA_mismatch, boqKA_mismatch, NO_ALIASES);
  assert(rKAmismatch.status === "SPEC_CONFLICT",
    "102 25kA vs 36kA → SPEC_CONFLICT (no equal-or-better)", rKAmismatch);

  // ======================================================
  section("39. Multiple Rating Retention — Independent Evaluation");

  // 100A 415V 25kA fully matched
  const evTriple = makeEvidence({
    rate_evidence_id: "EV-TRIPLE",
    item_name: "ACB 630A 415V 50kA",
    description: "ACB 630A 415V 50kA",
    uom: "NOS",
  });
  const boqTriple = makeBoqLine({
    boq_line_id: "BOQ-TRIPLE",
    description: "ACB 630A 415V 50kA",
    uom: "NOS",
  });
  const rTriple = assessTechnicalEquivalence(evTriple, boqTriple, NO_ALIASES);
  assert(rTriple.status === "TECHNICALLY_EQUIVALENT",
    "103 630A+415V+50kA fully matched → TECHNICALLY_EQUIVALENT", rTriple);

  // 11kV 630A — HV switchgear, both matching
  const evHV = makeEvidence({
    rate_evidence_id: "EV-HV",
    item_name: "VCB 11KV 630A",
    description: "VCB 11KV 630A",
    uom: "NOS",
  });
  const boqHV = makeBoqLine({
    boq_line_id: "BOQ-HV",
    description: "VCB 11KV 630A",
    uom: "NOS",
  });
  const rHV = assessTechnicalEquivalence(evHV, boqHV, NO_ALIASES);
  assert(rHV.status === "TECHNICALLY_EQUIVALENT",
    "104 11KV+630A matched → TECHNICALLY_EQUIVALENT", rHV);

  // Partial: BOQ wants 11kV 630A, candidate only has 630A (missing voltage)
  const evHVpartial = makeEvidence({
    rate_evidence_id: "EV-HV-PARTIAL",
    item_name: "VCB 630A",
    description: "VCB 630A",
    uom: "NOS",
  });
  const rHVpartial = assessTechnicalEquivalence(evHVpartial, boqHV, NO_ALIASES);
  assert(rHVpartial.status === "INSUFFICIENT_EVIDENCE",
    "105 BOQ=11KV+630A vs Candidate=630A → INSUFFICIENT_EVIDENCE (missing voltage)", rHVpartial);

  // ======================================================
  section("40. Extra Candidate Metadata — Additional Tests");

  // Candidate richer than BOQ: BOQ=630A, Candidate=630A 415V 50kA
  const evRich = makeEvidence({
    rate_evidence_id: "EV-RICH",
    item_name: "ACB 630A 415V 50kA",
    description: "ACB 630A 415V 50kA",
    uom: "NOS",
  });
  const boqSimple = makeBoqLine({
    boq_line_id: "BOQ-SIMPLE",
    description: "ACB 630A",
    uom: "NOS",
  });
  const rRich = assessTechnicalEquivalence(evRich, boqSimple, NO_ALIASES);
  const specRich = rRich.dimensions.find((d) => d.dimension === "SPEC");
  assert(specRich?.status === "MATCH",
    "106 BOQ=630A vs Candidate=630A+415V+50kA → SPEC MATCH (extra data informational)", specRich);

  // ======================================================
  section("41. No Equal-or-Better Assumption");

  // Higher breaking capacity must NOT be silently equivalent
  const ev36kA = makeEvidence({
    rate_evidence_id: "EV-36KA",
    item_name: "MCCB 100A 36kA",
    description: "MCCB 100A 36kA",
    uom: "NOS",
  });
  const boq25kA = makeBoqLine({
    boq_line_id: "BOQ-25KA",
    description: "MCCB 100A 25kA",
    uom: "NOS",
  });
  const rNoBetter = assessTechnicalEquivalence(ev36kA, boq25kA, NO_ALIASES);
  assert(rNoBetter.status === "SPEC_CONFLICT",
    "107 25kA vs 36kA → SPEC_CONFLICT (no equal-or-better without approved rule)", rNoBetter);

  // Higher current must also NOT be silently equivalent
  const ev200A = makeEvidence({
    rate_evidence_id: "EV-200A",
    item_name: "MCB 200A",
    description: "MCB 200A",
    uom: "NOS",
  });
  const boq100A2 = makeBoqLine({
    boq_line_id: "BOQ-100A-2",
    description: "MCB 100A",
    uom: "NOS",
  });
  const rNoBetter2 = assessTechnicalEquivalence(ev200A, boq100A2, NO_ALIASES);
  assert(rNoBetter2.status === "SPEC_CONFLICT",
    "108 100A vs 200A → SPEC_CONFLICT (no equal-or-better)", rNoBetter2);

  // ======================================================
  section("42. 25kA vs 25A — Unit Type Safety");

  const ev25kA = makeEvidence({
    rate_evidence_id: "EV-25KA",
    item_name: "MCCB 25kA",
    description: "MCCB 25kA",
    uom: "NOS",
  });
  const boq25A = makeBoqLine({
    boq_line_id: "BOQ-25A",
    description: "MCCB 25A",
    uom: "NOS",
  });
  const r25kA_25A = assessTechnicalEquivalence(ev25kA, boq25A, NO_ALIASES);
  assert(r25kA_25A.status !== "TECHNICALLY_EQUIVALENT",
    "109 25kA ≠ 25A — different unit types → NOT equivalent", r25kA_25A);
  const spec25kA = r25kA_25A.dimensions.find((d) => d.dimension === "SPEC");
  assert(spec25kA?.status !== "MATCH",
    "110 SPEC dimension must NOT be MATCH for 25kA vs 25A", spec25kA);

  // ======================================================
  // ============= 4E.3 CORRECTION: SAME-UNIT MULTI-VALUE RETENTION =============
  // ======================================================

  section("44. Parser: Same-Unit Multi-Value Retention");

  // "100A 160A" must produce two distinct RATING attributes
  const tokensDualA = parseSpecificationTokens("MCCB 100A 160A");
  const ratingTokensDualA = tokensDualA.filter((t) => t.category === "RATING");
  assert(ratingTokensDualA.some((t) => t.normalized_value === "100A"),
    "112 parser retains 100A from '100A 160A'", ratingTokensDualA);
  assert(ratingTokensDualA.some((t) => t.normalized_value === "160A"),
    "113 parser retains 160A from '100A 160A'", ratingTokensDualA);
  assert(ratingTokensDualA.length >= 2,
    "114 parser produces ≥2 rating tokens for '100A 160A'", ratingTokensDualA.length);

  // Duplicate identical tokens: "100A 100A" must deduplicate to one
  const tokensDupA = parseSpecificationTokens("MCB 100A 100A");
  const ratingTokensDupA = tokensDupA.filter((t) => t.category === "RATING" && t.normalized_value === "100A");
  assert(ratingTokensDupA.length === 1,
    "115 duplicate identical '100A 100A' → single token", ratingTokensDupA.length);

  // "230V 415V" must retain both unique voltage tokens
  const tokensDualV = parseSpecificationTokens("Panel 230V 415V");
  const ratingTokensDualV = tokensDualV.filter((t) => t.category === "RATING");
  assert(ratingTokensDualV.some((t) => t.normalized_value === "230V"),
    "116 parser retains 230V from '230V 415V'", ratingTokensDualV);
  assert(ratingTokensDualV.some((t) => t.normalized_value === "415V"),
    "117 parser retains 415V from '230V 415V'", ratingTokensDualV);

  // "25kA 36kA" must retain both unique kA tokens
  const tokensDualKA = parseSpecificationTokens("ACB 25kA 36kA");
  const ratingTokensDualKA = tokensDualKA.filter((t) => t.category === "RATING");
  assert(ratingTokensDualKA.some((t) => t.normalized_value === "25KA"),
    "118 parser retains 25KA from '25kA 36kA'", ratingTokensDualKA);
  assert(ratingTokensDualKA.some((t) => t.normalized_value === "36KA"),
    "119 parser retains 36KA from '25kA 36kA'", ratingTokensDualKA);

  // ======================================================
  section("45. BOQ Multi-Requirement: Two Same-Unit Ratings, Candidate Has One");

  // BOQ: 100A 160A, Candidate: 100A → NOT TECHNICALLY_EQUIVALENT
  const evSingleA = makeEvidence({
    rate_evidence_id: "EV-SINGLE-100A",
    item_name: "MCCB 100A",
    description: "MCCB 100A",
    uom: "NOS",
  });
  const boqDualA = makeBoqLine({
    boq_line_id: "BOQ-DUAL-100A-160A",
    description: "MCCB 100A 160A",
    uom: "NOS",
  });
  const rDualA_Single = assessTechnicalEquivalence(evSingleA, boqDualA, NO_ALIASES);
  assert(rDualA_Single.status !== "TECHNICALLY_EQUIVALENT",
    "120 BOQ=100A+160A vs Candidate=100A → NOT equivalent", rDualA_Single);
  assert(rDualA_Single.status === "INSUFFICIENT_EVIDENCE",
    "121 BOQ=100A+160A vs Candidate=100A → INSUFFICIENT_EVIDENCE (preferred safe state)", rDualA_Single);

  // Also verify the SPEC dimension is not MATCH
  const specDualA_Single = rDualA_Single.dimensions.find((d) => d.dimension === "SPEC");
  assert(specDualA_Single?.status !== "MATCH",
    "122 SPEC dimension must NOT be MATCH when 160A is missing", specDualA_Single);

  // ======================================================
  section("46. BOQ Single Requirement, Candidate Has Multiple Same-Unit");

  // BOQ: 160A, Candidate: 100A 160A → required 160A must be detected
  const evDualA = makeEvidence({
    rate_evidence_id: "EV-DUAL-100A-160A",
    item_name: "MCCB 100A 160A",
    description: "MCCB 100A 160A",
    uom: "NOS",
  });
  const boqSingle160A = makeBoqLine({
    boq_line_id: "BOQ-SINGLE-160A",
    description: "MCCB 160A",
    uom: "NOS",
  });
  const rSingle_DualA = assessTechnicalEquivalence(evDualA, boqSingle160A, NO_ALIASES);
  const specSingle_DualA = rSingle_DualA.dimensions.find((d) => d.dimension === "SPEC");
  assert(specSingle_DualA?.status === "MATCH",
    "123 BOQ=160A vs Candidate=100A+160A → SPEC MATCH (160A found)", specSingle_DualA);

  // ======================================================
  section("47. Candidate Richer Same-Unit Values");

  // BOQ: 160A, Candidate: 100A 160A 250A → 160A must not be lost
  const evTripleA = makeEvidence({
    rate_evidence_id: "EV-TRIPLE-A",
    item_name: "MCCB 100A 160A 250A",
    description: "MCCB 100A 160A 250A",
    uom: "NOS",
  });
  const rTripleA = assessTechnicalEquivalence(evTripleA, boqSingle160A, NO_ALIASES);
  const specTripleA = rTripleA.dimensions.find((d) => d.dimension === "SPEC");
  assert(specTripleA?.status === "MATCH",
    "124 BOQ=160A vs Candidate=100A+160A+250A → SPEC MATCH (160A found)", specTripleA);

  // ======================================================
  section("48. BOQ Multi-Requirement: Candidate Missing One of Multiple");

  // BOQ: 100A 415V 25kA 36kA, Candidate: 100A 415V 25kA → NOT equivalent
  const evMissKA = makeEvidence({
    rate_evidence_id: "EV-MISS-KA",
    item_name: "ACB 100A 415V 25kA",
    description: "ACB 100A 415V 25kA",
    uom: "NOS",
  });
  const boqFourSpec = makeBoqLine({
    boq_line_id: "BOQ-FOUR-SPEC",
    description: "ACB 100A 415V 25kA 36kA",
    uom: "NOS",
  });
  const rMissKA = assessTechnicalEquivalence(evMissKA, boqFourSpec, NO_ALIASES);
  assert(rMissKA.status !== "TECHNICALLY_EQUIVALENT",
    "125 BOQ=100A+415V+25kA+36kA vs Candidate=100A+415V+25kA → NOT equivalent", rMissKA);

  // ======================================================
  section("49. BOQ Both Same-Unit Values Present → All Requirements Satisfied");

  // BOQ: 100A 160A, Candidate: 100A 160A → should match
  const evBothA = makeEvidence({
    rate_evidence_id: "EV-BOTH-100A-160A",
    item_name: "MCCB 100A 160A",
    description: "MCCB 100A 160A",
    uom: "NOS",
  });
  const rBothA = assessTechnicalEquivalence(evBothA, boqDualA, NO_ALIASES);
  const specBothA = rBothA.dimensions.find((d) => d.dimension === "SPEC");
  assert(specBothA?.status === "MATCH",
    "126 BOQ=100A+160A vs Candidate=100A+160A → SPEC MATCH", specBothA);

  // ======================================================
  section("50. No Range/Alternative Auto-Interpretation");

  // BOQ: 100A 160A must not be interpreted as "100A OR 160A"
  // If candidate only has 160A (missing 100A from BOQ), NOT equivalent
  const evOnly160A = makeEvidence({
    rate_evidence_id: "EV-ONLY-160A",
    item_name: "MCCB 160A",
    description: "MCCB 160A",
    uom: "NOS",
  });
  const rOnly160A = assessTechnicalEquivalence(evOnly160A, boqDualA, NO_ALIASES);
  assert(rOnly160A.status !== "TECHNICALLY_EQUIVALENT",
    "127 BOQ=100A+160A vs Candidate=160A → NOT equivalent (100A missing)", rOnly160A);

  // ======================================================
  section("51. Multiple Same-Unit Voltages Through assessTechnicalEquivalence");

  // BOQ: 230V 415V, Candidate: 230V → NOT equivalent
  const evSingleV = makeEvidence({
    rate_evidence_id: "EV-SINGLE-230V",
    item_name: "Panel 230V",
    description: "Panel 230V",
    uom: "NOS",
  });
  const boqDualV = makeBoqLine({
    boq_line_id: "BOQ-DUAL-230V-415V",
    description: "Panel 230V 415V",
    uom: "NOS",
  });
  const rDualV_Single = assessTechnicalEquivalence(evSingleV, boqDualV, NO_ALIASES);
  assert(rDualV_Single.status !== "TECHNICALLY_EQUIVALENT",
    "128 BOQ=230V+415V vs Candidate=230V → NOT equivalent (415V missing)", rDualV_Single);

  // BOQ: 230V 415V, Candidate: 230V 415V → MATCH
  const evBothV = makeEvidence({
    rate_evidence_id: "EV-BOTH-230V-415V",
    item_name: "Panel 230V 415V",
    description: "Panel 230V 415V",
    uom: "NOS",
  });
  const rBothV = assessTechnicalEquivalence(evBothV, boqDualV, NO_ALIASES);
  const specBothV = rBothV.dimensions.find((d) => d.dimension === "SPEC");
  assert(specBothV?.status === "MATCH",
    "129 BOQ=230V+415V vs Candidate=230V+415V → SPEC MATCH", specBothV);

  // ======================================================
  section("52. Previous Critical Fix 1 Preserved — Partial Spec");

  // Verify BOQ=100A+4SQMM vs Candidate=100A still → INSUFFICIENT_EVIDENCE
  const evPartialCheck = makeEvidence({
    rate_evidence_id: "EV-PARTIAL-CHECK",
    item_name: "Cable 100A",
    description: "Cable 100A",
    uom: "M",
  });
  const boqPartialCheck = makeBoqLine({
    boq_line_id: "BOQ-PARTIAL-CHECK",
    description: "Cable 100A 4SQMM",
    uom: "M",
  });
  const rPartialCheck = assessTechnicalEquivalence(evPartialCheck, boqPartialCheck, NO_ALIASES);
  assert(rPartialCheck.status === "INSUFFICIENT_EVIDENCE",
    "130 4E.2 Fix 1 preserved: BOQ=100A+4SQMM vs Candidate=100A → INSUFFICIENT_EVIDENCE", rPartialCheck);

  // ======================================================
  section("53. Previous Critical Fix 2 Preserved — Extra Metadata");

  // Verify BOQ=100A vs Candidate=100A+415V still → SPEC MATCH
  const evExtraCheck = makeEvidence({
    rate_evidence_id: "EV-EXTRA-CHECK",
    item_name: "MCB 100A 415V",
    description: "MCB 100A 415V",
    uom: "NOS",
  });
  const boqExtraCheck = makeBoqLine({
    boq_line_id: "BOQ-EXTRA-CHECK",
    description: "MCB 100A",
    uom: "NOS",
  });
  const rExtraCheck = assessTechnicalEquivalence(evExtraCheck, boqExtraCheck, NO_ALIASES);
  const specExtraCheck = rExtraCheck.dimensions.find((d) => d.dimension === "SPEC");
  assert(specExtraCheck?.status === "MATCH",
    "131 4E.2 Fix 2 preserved: BOQ=100A vs Candidate=100A+415V → SPEC MATCH", specExtraCheck);

  // ======================================================
  section("54. Operational DB Guard");

  assertOperationalDbsUnchanged(OPERATIONAL_BEFORE, "Phase 4E");
  pass++;
  console.log("  ✅ [PASS] 132 operational DB hashes unchanged after all tests");

  // ======================================================
  console.log(`\nTEST SUMMARY: ${pass} PASSED, ${fail} FAILED (of ${pass + fail})`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
