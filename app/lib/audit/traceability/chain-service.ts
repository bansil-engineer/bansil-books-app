// ============================================================
// Bansil Books Analytics — Item Traceability Chain Service
// DB-aware orchestrator: reads already-synced SO/PO caches (audit DB)
// and already-synced Invoice/Bill line items (main app DB, read-only),
// runs the deterministic matching engine for each hop, persists the
// resulting links (idempotent upsert) and per-SO-line chain summaries,
// runs the alert engine, and persists alerts. Never writes to Zoho, the
// main app DB, or any production accounting record — only to the audit
// workspace DB's own traceability tables.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { matchLines, type UpstreamLine, type DownstreamLine, type ItemMappingLookup, type BomRelationshipLookup, type DescriptionCandidate } from "./matching-engine.ts";
import { computeChainSummary } from "./chain-summary.ts";
import { findActiveMapping } from "../bom/item-mapping-service.ts";
import { getTraceabilityConfig } from "./config-service.ts";
import {
  detectSoNotInvoiced,
  detectSoItemNotProcured,
  detectSoPartiallyProcured,
  detectOverProcured,
  detectPoNotBilled,
  detectPoPartiallyBilled,
  detectBillExceedsPo,
  detectInvoiceExceedsSo,
  detectUnlinkedItems,
  detectAmbiguousItemMatch,
  detectLinePairIssues,
  detectDuplicateConsumption,
  type SoLineInput,
  type PoLineInput,
  type LinkedLinePair,
} from "./alert-engine.ts";
import { upsertTraceabilityAlerts, resolveStaleTraceabilityAlerts } from "./alert-service.ts";
import type { TraceabilityLink, TraceabilityAlertDraft, ChainSummary } from "./traceability-types.ts";
import { isBeforePhaseFBoundary } from "./phase-f-boundary.ts";
import { ensureTraceabilitySourceStatusSeeded, getTraceabilitySourceStatus } from "./source-status-service.ts";

const VOID_STATUSES = ["void", "cancelled", "canceled", "draft"];

function excludeVoid<T extends { status: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !VOID_STATUSES.includes((r.status ?? "").toLowerCase()));
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bomRelationshipLookup(auditDb: DatabaseSync): BomRelationshipLookup {
  return (downstreamItemId: string) => {
    const row = auditDb
      .prepare(
        `SELECT m.composite_item_id AS upstreamItemId
         FROM audit_bom_components c
         INNER JOIN audit_bom_master m ON m.bom_id = c.bom_version_id
         WHERE c.component_item_id = ? AND m.status = 'ACTIVE'
         LIMIT 1`
      )
      .get(downstreamItemId) as { upstreamItemId: string } | undefined;
    return row ? { upstreamItemId: row.upstreamItemId } : null;
  };
}

function itemMappingLookup(auditDb: DatabaseSync): ItemMappingLookup {
  return (sourceItemIdentifier: string) => {
    const m = findActiveMapping(auditDb, sourceItemIdentifier);
    return m ? { canonicalItemId: m.canonical_component_item_id } : null;
  };
}

function persistLinks(auditDb: DatabaseSync, links: TraceabilityLink[]): void {
  const upsert = auditDb.prepare(
    `INSERT INTO audit_traceability_links (link_id, from_doc_type, from_doc_id, from_line_id, to_doc_type, to_doc_id, to_line_id, item_id, match_method, allocated_qty, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_line_id, to_line_id) DO UPDATE SET
       item_id = excluded.item_id, match_method = excluded.match_method, allocated_qty = excluded.allocated_qty, computed_at = excluded.computed_at`
  );
  const now = new Date().toISOString();
  for (const l of links) {
    upsert.run(randomUUID(), l.fromDocType, l.fromDocId, l.fromLineId, l.toDocType, l.toDocId, l.toLineId, l.itemId, l.matchMethod, String(l.allocatedQty), now);
  }
}

interface RawSoLine {
  line_item_id: string;
  salesorder_id: string;
  item_id: string | null;
  sku: string | null;
  description: string | null;
  quantity: string;
  unit: string | null;
  rate: string | null;
}
interface RawPoLine {
  line_item_id: string;
  purchaseorder_id: string;
  item_id: string | null;
  sku: string | null;
  description: string | null;
  quantity: string;
  unit: string | null;
  rate: string | null;
  salesorder_item_id: string | null;
}
interface RawInvoiceLine {
  line_item_id: string;
  invoice_id: string;
  item_id: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  rate: number;
  status: string | null;
  date: string | null;
  salesorder_item_id: string | null;
  unit: string | null;
}
interface RawBillLine {
  line_item_id: string;
  bill_id: string;
  item_id: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  rate: number;
  status: string | null;
  date: string | null;
  purchaseorder_item_id: string | null;
  unit: string | null;
}

export interface ChainComputationResult {
  soToPoLinks: number;
  poToBillLinks: number;
  soToInvoiceLinks: number;
  chainSummaries: number;
  alertsCreated: number;
  alertsUpdated: number;
  alertsResolved: number;
  skippedIncompleteUpstream?: boolean;
  skippedBaselineNotApproved?: boolean;
  skippedReason?: string;
}

export interface TraceabilityAggregateCounts {
  FULLY_TRACED: number;
  PARTIALLY_TRACED: number;
  MISSING: number;
  EXCESS: number;
  WRONG_ITEM: number;
  SKU_MISMATCH: number;
  UOM_MISMATCH: number;
  UOM_NOT_AVAILABLE: number;
  AMBIGUOUS: number;
  REVIEW_REQUIRED: number;
}

/**
 * Read-only variant of recomputeTraceabilityChain: computes the exact same
 * matching/ledger/detection logic but persists NOTHING — no links, no chain
 * summaries, no alerts. Used for a first live-data validation pass so the
 * owner sees only aggregate counts, never a flood of newly-created
 * owner-facing alerts before an alert-quality review has happened.
 */
export function computeTraceabilityAggregatesOnly(
  auditDb: DatabaseSync,
  booksAppDb: DatabaseSync
): { counts: TraceabilityAggregateCounts; soLineCount: number; poLineCount: number; invoiceLineCount: number; billLineCount: number; uomCoverage: UomCoverage; hopStats: ChainCoreResult["hopStats"] } {
  const { soLineInputs, summaryMap, drafts, descriptionCandidateCount, soCount, poCount, invoiceCount, billCount, uomCoverage, hopStats } = computeChainCore(auditDb, booksAppDb);

  const counts: TraceabilityAggregateCounts = {
    FULLY_TRACED: 0,
    PARTIALLY_TRACED: 0,
    MISSING: 0,
    EXCESS: 0,
    WRONG_ITEM: 0,
    SKU_MISMATCH: 0,
    UOM_MISMATCH: 0,
    UOM_NOT_AVAILABLE: 0,
    AMBIGUOUS: 0,
    REVIEW_REQUIRED: 0,
  };

  for (const so of soLineInputs) {
    const s = summaryMap.get(so.lineId);
    if (!s) continue;
    if (s.orderedQty === 0 && s.invoicedQty === 0) counts.MISSING++;
    else if (s.excessQty > 0) counts.EXCESS++;
    else if (s.remainingQty === 0 && s.invoicedQty >= s.requiredQty && s.requiredQty > 0) counts.FULLY_TRACED++;
    else if (s.allocatedQty > 0 || s.invoicedQty > 0) counts.PARTIALLY_TRACED++;
    else counts.REVIEW_REQUIRED++;
  }

  for (const d of drafts) {
    if (d.alertType === "SKU_MISMATCH") counts.SKU_MISMATCH++;
    else if (d.alertType === "UOM_MISMATCH") counts.UOM_MISMATCH++;
    else if (d.alertType === "UOM_NOT_AVAILABLE") counts.UOM_NOT_AVAILABLE++;
    else if (d.alertType === "UNAPPROVED_SUBSTITUTION" || d.alertType === "WRONG_ITEM") counts.WRONG_ITEM++;
  }
  counts.AMBIGUOUS += descriptionCandidateCount;

  return { counts, soLineCount: soCount, poLineCount: poCount, invoiceLineCount: invoiceCount, billLineCount: billCount, uomCoverage, hopStats };
}

interface ChainCoreResult {
  allLinks: TraceabilityLink[];
  summaries: ChainSummary[];
  summaryMap: Map<string, ChainSummary>;
  soLineInputs: SoLineInput[];
  poLineInputs: PoLineInput[];
  drafts: TraceabilityAlertDraft[];
  descriptionCandidateCount: number;
  soCount: number;
  poCount: number;
  invoiceCount: number;
  billCount: number;
  uomCoverage: UomCoverage;
  hopStats: { soToInvoice: HopMatchStats; soToPo: HopMatchStats; poToBill: HopMatchStats };
}

export interface UomCoverage {
  soLines: { usable: number; total: number };
  poLines: { usable: number; total: number };
  invoiceLines: { usable: number; total: number };
  billLines: { usable: number; total: number };
}

function hasUsableUnit(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export interface HopMatchStats {
  recordsEvaluated: number;
  nativeLinkMatches: number;
  itemIdMatches: number;
  skuMatches: number;
  mappingMatches: number;
  bomMatches: number;
  descriptionCandidates: number;
  unlinked: number;
}

function summarizeHop(result: { links: TraceabilityLink[]; unmatchedDownstream: DownstreamLine[]; descriptionCandidates: DescriptionCandidate[] }, downstreamCount: number): HopMatchStats {
  const byMethod = (m: string) => result.links.filter((l) => l.matchMethod === m).length;
  return {
    recordsEvaluated: downstreamCount,
    nativeLinkMatches: byMethod("NATIVE_LINE_LINKAGE") + byMethod("EXPLICIT_LINKAGE"),
    itemIdMatches: byMethod("ITEM_ID"),
    skuMatches: byMethod("SKU"),
    mappingMatches: byMethod("OWNER_APPROVED_MAPPING"),
    bomMatches: byMethod("BOM_RELATIONSHIP"),
    descriptionCandidates: result.descriptionCandidates.length,
    unlinked: result.unmatchedDownstream.length,
  };
}

/**
 * Shared, pure computation core used by both the persisting
 * (recomputeTraceabilityChain) and read-only (computeTraceabilityAggregatesOnly)
 * entry points — reads local caches, runs matching + ledger + detection,
 * and returns everything in memory. Persistence is entirely the caller's
 * responsibility, never done here.
 */
function computeChainCore(auditDb: DatabaseSync, booksAppDb: DatabaseSync): ChainCoreResult {
  const config = getTraceabilityConfig(auditDb);
  const now = new Date();

  const soLinesRaw = auditDb.prepare(`SELECT * FROM audit_sales_order_lines`).all() as unknown as RawSoLine[];
  const soHeaders = auditDb.prepare(`SELECT salesorder_id, salesorder_number, date, status FROM audit_sales_orders`).all() as Array<{ salesorder_id: string; salesorder_number: string | null; date: string | null; status: string | null }>;
  const soHeaderById = new Map(soHeaders.map((h) => [h.salesorder_id, h]));
  const activeSoLines = soLinesRaw.filter((l) => {
    const h = soHeaderById.get(l.salesorder_id);
    return h && !VOID_STATUSES.includes((h.status ?? "").toLowerCase());
  });

  const poLinesRaw = auditDb.prepare(`SELECT * FROM audit_purchase_order_lines`).all() as unknown as RawPoLine[];
  const poHeaders = auditDb.prepare(`SELECT purchaseorder_id, purchaseorder_number, date, status FROM audit_purchase_orders`).all() as Array<{ purchaseorder_id: string; purchaseorder_number: string | null; date: string | null; status: string | null }>;
  const poHeaderById = new Map(poHeaders.map((h) => [h.purchaseorder_id, h]));
  const activePoLines = poLinesRaw.filter((l) => {
    const h = poHeaderById.get(l.purchaseorder_id);
    return h && !VOID_STATUSES.includes((h.status ?? "").toLowerCase());
  });

  const invoiceLinesRaw = booksAppDb
    .prepare(
      `SELECT sili.line_item_id, sili.invoice_id, sili.item_id, sili.sku, sili.description, sili.quantity, sili.rate, si.status, si.date, sili.salesorder_item_id, sili.unit
       FROM sales_invoice_line_items sili INNER JOIN sales_invoices si ON si.invoice_id = sili.invoice_id`
    )
    .all() as unknown as RawInvoiceLine[];
  // OWNER DATA BOUNDARY: existing local Invoice/Bill data may predate 2025-04-01
  // (it belongs to the pre-existing, already-approved reconciliation module) —
  // that data is never deleted, but Phase F Item Traceability must not process
  // it. Filtered here, defensively, in addition to whatever the SO/PO sync
  // already excludes at the source.
  const activeInvoiceLines = excludeVoid(invoiceLinesRaw).filter((l) => !isBeforePhaseFBoundary(l.date));

  const billLinesRaw = booksAppDb
    .prepare(
      `SELECT pbli.line_item_id, pbli.bill_id, pbli.item_id, pbli.sku, pbli.description, pbli.quantity, pbli.rate, pb.status, pb.date, pbli.purchaseorder_item_id, pbli.unit
       FROM purchase_bill_line_items pbli INNER JOIN purchase_bills pb ON pb.bill_id = pbli.bill_id`
    )
    .all() as unknown as RawBillLine[];
  const activeBillLines = excludeVoid(billLinesRaw).filter((l) => !isBeforePhaseFBoundary(l.date));

  const mapping = itemMappingLookup(auditDb);
  const bomRel = bomRelationshipLookup(auditDb);

  // --- Hop A: SO -> Invoice ---
  const soUpstream: UpstreamLine[] = activeSoLines.map((l) => ({
    lineId: l.line_item_id,
    docId: l.salesorder_id,
    docNumber: soHeaderById.get(l.salesorder_id)?.salesorder_number ?? null,
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    qty: num(l.quantity),
  }));
  const invoiceDownstream: DownstreamLine[] = activeInvoiceLines.map((l) => ({
    lineId: l.line_item_id,
    docId: l.invoice_id,
    refNumber: null, // sales_invoices.reference_number is a free-text field, not reliably an SO number — EXPLICIT_LINKAGE not asserted for this hop without further verification
    nativeUpstreamLineId: l.salesorder_item_id, // real Zoho field (invoice line's own salesorder_item_id), confirmed VERIFIED_PRESENT live 2026-09-15, wired 2026-09-16 per owner approval — highest-priority match signal
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    qty: num(l.quantity),
  }));
  const soToInvoice = matchLines(soUpstream, invoiceDownstream, "SALES_ORDER", "SALES_INVOICE", { lookupMapping: mapping, lookupBomRelationship: bomRel });

  // --- Hop B: SO -> PO ---
  const poDownstreamForSo: DownstreamLine[] = activePoLines.map((l) => ({
    lineId: l.line_item_id,
    docId: l.purchaseorder_id,
    refNumber: poHeaderById.get(l.purchaseorder_id)?.purchaseorder_number ?? null, // fallback explicit-linkage proxy, used only when the native line link below is absent
    nativeUpstreamLineId: l.salesorder_item_id, // real Zoho field, confirmed present live 2026-09-15 — highest-priority match signal
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    qty: num(l.quantity),
  }));
  const soToPo = matchLines(soUpstream, poDownstreamForSo, "SALES_ORDER", "PURCHASE_ORDER", { lookupMapping: mapping, lookupBomRelationship: bomRel });

  // --- Hop C: PO -> Bill ---
  const poUpstream: UpstreamLine[] = activePoLines.map((l) => ({
    lineId: l.line_item_id,
    docId: l.purchaseorder_id,
    docNumber: poHeaderById.get(l.purchaseorder_id)?.purchaseorder_number ?? null,
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    qty: num(l.quantity),
  }));
  const billDownstream: DownstreamLine[] = activeBillLines.map((l) => ({
    lineId: l.line_item_id,
    docId: l.bill_id,
    refNumber: null, // purchase_bills.reference_number is free-text — not asserted as reliable PO linkage without further verification
    nativeUpstreamLineId: l.purchaseorder_item_id, // real Zoho field (bill line's own purchaseorder_item_id), confirmed VERIFIED_PRESENT live 2026-09-15, wired 2026-09-16 per owner approval — highest-priority match signal
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    qty: num(l.quantity),
  }));
  const poToBill = matchLines(poUpstream, billDownstream, "PURCHASE_ORDER", "PURCHASE_BILL", { lookupMapping: mapping, lookupBomRelationship: bomRel });

  const allLinks = [...soToInvoice.links, ...soToPo.links, ...poToBill.links];

  // --- Chain summaries (per SO line) ---
  const orderedBySo = new Map<string, number>();
  for (const l of soToPo.links) orderedBySo.set(l.fromLineId, (orderedBySo.get(l.fromLineId) ?? 0) + l.allocatedQty);
  const invoicedBySo = new Map<string, number>();
  for (const l of soToInvoice.links) invoicedBySo.set(l.fromLineId, (invoicedBySo.get(l.fromLineId) ?? 0) + l.allocatedQty);
  const billedByPo = new Map<string, number>();
  for (const l of poToBill.links) billedByPo.set(l.fromLineId, (billedByPo.get(l.fromLineId) ?? 0) + l.allocatedQty);
  // Roll billed-by-PO up to billed-by-SO via the SO->PO links.
  const billedBySo = new Map<string, number>();
  for (const l of soToPo.links) {
    const poBilled = billedByPo.get(l.toLineId) ?? 0;
    // Proportional share of this PO line's billed qty attributable to this SO's allocation of it.
    const poLine = poUpstream.find((p) => p.lineId === l.toLineId);
    const share = poLine && poLine.qty > 0 ? Math.min(poBilled, l.allocatedQty) : 0;
    billedBySo.set(l.fromLineId, (billedBySo.get(l.fromLineId) ?? 0) + share);
  }

  const summaries: ChainSummary[] = activeSoLines.map((l) =>
    computeChainSummary(l.line_item_id, l.item_id, num(l.quantity), orderedBySo.get(l.line_item_id) ?? 0, billedBySo.get(l.line_item_id) ?? 0, invoicedBySo.get(l.line_item_id) ?? 0)
  );
  const summaryMap = new Map(summaries.map((s) => [s.soLineId, s]));

  // --- Alerts ---
  const soLineInputs: SoLineInput[] = activeSoLines.map((l) => ({
    lineId: l.line_item_id,
    soId: l.salesorder_id,
    soDate: soHeaderById.get(l.salesorder_id)?.date ?? null,
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    unit: l.unit,
    rate: l.rate != null ? num(l.rate) : null,
    status: soHeaderById.get(l.salesorder_id)?.status ?? null,
  }));
  const poLineInputs: PoLineInput[] = activePoLines.map((l) => ({
    lineId: l.line_item_id,
    poId: l.purchaseorder_id,
    poDate: poHeaderById.get(l.purchaseorder_id)?.date ?? null,
    itemId: l.item_id,
    sku: l.sku,
    description: l.description,
    unit: l.unit,
    rate: l.rate != null ? num(l.rate) : null,
    qty: num(l.quantity),
    status: poHeaderById.get(l.purchaseorder_id)?.status ?? null,
  }));

  const drafts: TraceabilityAlertDraft[] = [
    ...detectSoNotInvoiced(soLineInputs, summaryMap, config, now),
    ...detectSoItemNotProcured(soLineInputs, summaryMap),
    ...detectSoPartiallyProcured(soLineInputs, summaryMap),
    ...detectOverProcured(soLineInputs, summaryMap, config),
    ...detectPoNotBilled(poLineInputs, billedByPo, config, now),
    ...detectPoPartiallyBilled(poLineInputs, billedByPo),
    ...detectBillExceedsPo(poLineInputs, billedByPo, config),
    ...detectInvoiceExceedsSo(soLineInputs, summaryMap, config),
    ...detectUnlinkedItems(
      "PO_LINE",
      "UNLINKED_PO_ITEM",
      soToPo.unmatchedDownstream.map((d) => ({ lineId: d.lineId, itemId: d.itemId, description: d.description, qty: d.qty, rate: poLineInputs.find((p) => p.lineId === d.lineId)?.rate ?? null }))
    ),
    ...detectUnlinkedItems(
      "BILL_LINE",
      "UNLINKED_BILL_ITEM",
      poToBill.unmatchedDownstream.map((d) => ({ lineId: d.lineId, itemId: d.itemId, description: d.description, qty: d.qty, rate: null }))
    ),
    ...detectUnlinkedItems(
      "INVOICE_LINE",
      "UNLINKED_INVOICE_ITEM",
      soToInvoice.unmatchedDownstream.map((d) => ({ lineId: d.lineId, itemId: d.itemId, description: d.description, qty: d.qty, rate: null }))
    ),
    ...detectAmbiguousItemMatch([...soToPo.descriptionCandidates, ...poToBill.descriptionCandidates, ...soToInvoice.descriptionCandidates]),
    ...detectDuplicateConsumption(soToPo.links, new Map(soUpstream.map((u) => [u.lineId, u.qty]))),
    ...detectDuplicateConsumption(poToBill.links, new Map(poUpstream.map((u) => [u.lineId, u.qty]))),
  ];

  const linePairs: LinkedLinePair[] = allLinks.map((link) => {
    const fromLine =
      soUpstream.find((u) => u.lineId === link.fromLineId) ?? poUpstream.find((u) => u.lineId === link.fromLineId);
    const toLine =
      poDownstreamForSo.find((d) => d.lineId === link.toLineId) ?? billDownstream.find((d) => d.lineId === link.toLineId) ?? invoiceDownstream.find((d) => d.lineId === link.toLineId);
    const fromRaw = soLinesRaw.find((l) => l.line_item_id === link.fromLineId) ?? poLinesRaw.find((l) => l.line_item_id === link.fromLineId);
    const toRaw =
      poLinesRaw.find((l) => l.line_item_id === link.toLineId) ??
      billLinesRaw.find((l) => l.line_item_id === link.toLineId) ??
      invoiceLinesRaw.find((l) => l.line_item_id === link.toLineId);
    return {
      link,
      // fromUnit is always SO/PO evidence (upstream is never Invoice/Bill); toUnit
      // may now genuinely be Invoice/Bill transaction evidence too (owner-approved
      // 2026-09-16) — both are the exact Zoho transaction-line value, never inferred.
      fromUnit: fromRaw?.unit ?? null,
      toUnit: toRaw?.unit ?? null,
      fromRate: fromLine ? null : null, // rate mismatch computed below from raw records for precision
      toRate: null,
      fromSku: fromLine?.sku ?? null,
      toSku: toLine?.sku ?? null,
      fromItemId: fromLine?.itemId ?? null,
      toItemId: toLine?.itemId ?? null,
      itemMappingApproved: Boolean(toLine?.itemId && mapping(toLine.itemId)),
    };
  });
  // Fill in rate comparison from raw records (kept separate above to avoid a second lookup pass mid-map).
  for (const p of linePairs) {
    const fromRaw = soLinesRaw.find((l) => l.line_item_id === p.link.fromLineId) ?? poLinesRaw.find((l) => l.line_item_id === p.link.fromLineId);
    const toRaw =
      poLinesRaw.find((l) => l.line_item_id === p.link.toLineId) ??
      billLinesRaw.find((l) => l.line_item_id === p.link.toLineId) ??
      invoiceLinesRaw.find((l) => l.line_item_id === p.link.toLineId);
    p.fromRate = fromRaw?.rate != null ? num(fromRaw.rate) : null;
    p.toRate = toRaw?.rate != null ? num(toRaw.rate) : null;
  }
  drafts.push(...detectLinePairIssues(linePairs, config));

  return {
    allLinks,
    summaries,
    summaryMap,
    soLineInputs,
    poLineInputs,
    drafts,
    descriptionCandidateCount: soToPo.descriptionCandidates.length + poToBill.descriptionCandidates.length + soToInvoice.descriptionCandidates.length,
    soCount: activeSoLines.length,
    poCount: activePoLines.length,
    invoiceCount: activeInvoiceLines.length,
    billCount: activeBillLines.length,
    uomCoverage: {
      // UOM coverage is a source-completeness/data-quality metric, NEVER an
      // error signal — a line with no usable UOM is UOM_NOT_AVAILABLE
      // (missing evidence), categorically distinct from UOM_MISMATCH (both
      // sides' UOM known and genuinely differ). sales_invoice_line_items.unit
      // / purchase_bill_line_items.unit (owner-approved 2026-09-16) hold the
      // exact Zoho transaction-line value, never normalized or inferred —
      // rows synced before this column existed will show unit=NULL until
      // their next natural or backfill re-sync, honestly reflected here.
      soLines: { usable: activeSoLines.filter((l) => hasUsableUnit(l.unit)).length, total: activeSoLines.length },
      poLines: { usable: activePoLines.filter((l) => hasUsableUnit(l.unit)).length, total: activePoLines.length },
      invoiceLines: { usable: activeInvoiceLines.filter((l) => hasUsableUnit(l.unit)).length, total: activeInvoiceLines.length },
      billLines: { usable: activeBillLines.filter((l) => hasUsableUnit(l.unit)).length, total: activeBillLines.length },
    },
    hopStats: {
      soToInvoice: summarizeHop(soToInvoice, invoiceDownstream.length),
      soToPo: summarizeHop(soToPo, poDownstreamForSo.length),
      poToBill: summarizeHop(poToBill, billDownstream.length),
    },
  };
}

/**
 * Persisting entry point: runs computeChainCore, then writes links, chain
 * summaries, and alerts (dedup upsert + stale-resolve), exactly as before.
 * This is what the scheduled/manual "Sync & Audit Now" pipeline calls.
 *
 * GUARD (added after the 2026-09-15 spurious-alert incident): a source
 * that has NEVER completed a successful sync (no last_synced_at) means its
 * cache is not merely stale but structurally EMPTY/incomplete — matching
 * real downstream data against an empty upstream cache makes every single
 * downstream line look "unlinked", which is not a genuine finding, just an
 * artifact of an incomplete source set. No partial source set may be
 * treated as complete: if SALES_ORDER or PURCHASE_ORDER has never
 * successfully synced, this function persists NOTHING (no links, no
 * summaries, no alerts) and returns skippedIncompleteUpstream: true.
 */
export function recomputeTraceabilityChain(auditDb: DatabaseSync, booksAppDb: DatabaseSync, actor: string): ChainComputationResult {
  ensureTraceabilitySourceStatusSeeded(auditDb);
  const soStatus = getTraceabilitySourceStatus(auditDb, "SALES_ORDER");
  const poStatus = getTraceabilitySourceStatus(auditDb, "PURCHASE_ORDER");
  const soNeverSynced = !soStatus?.last_synced_at;
  const poNeverSynced = !poStatus?.last_synced_at;
  if (soNeverSynced || poNeverSynced) {
    const missing = [soNeverSynced ? "SALES_ORDER" : null, poNeverSynced ? "PURCHASE_ORDER" : null].filter(Boolean).join(" and ");
    return {
      soToPoLinks: 0,
      poToBillLinks: 0,
      soToInvoiceLinks: 0,
      chainSummaries: 0,
      alertsCreated: 0,
      alertsUpdated: 0,
      alertsResolved: 0,
      skippedIncompleteUpstream: true,
      skippedReason: `${missing} has never completed a successful sync — upstream cache is incomplete, not merely stale. No links/summaries/alerts persisted this pass.`,
    };
  }

  // BASELINE SAFETY GATE (owner directive 2026-09-16, "BILL BACKFILL +
  // BASELINE SAFETY GATE" item 2): before this directive, links and chain
  // summaries persisted unconditionally (only alerts were gated), and a
  // pre-existing automatic cycle wrote 9,113 links / 1,791 chain summaries
  // to production while baseline approval was still absent. That is
  // broader persistence than desired during baseline review. Now: links,
  // chain summaries, AND alerts are ALL withheld until the owner approves
  // the baseline. Source sync/cache refresh (runTraceabilitySourceSync)
  // and non-persisting aggregate evaluation (computeTraceabilityAggregatesOnly)
  // are unaffected — they call computeChainCore directly and never reach
  // this function at all.
  const baselineApproved = Boolean(auditDb.prepare(`SELECT baseline_key FROM audit_traceability_baseline WHERE baseline_key = 'DEFAULT'`).get());
  if (!baselineApproved) {
    return {
      soToPoLinks: 0,
      poToBillLinks: 0,
      soToInvoiceLinks: 0,
      chainSummaries: 0,
      alertsCreated: 0,
      alertsUpdated: 0,
      alertsResolved: 0,
      skippedBaselineNotApproved: true,
      skippedReason: "Baseline not yet approved by owner — links, chain summaries, and alerts are all withheld. Use computeTraceabilityAggregatesOnly for non-persisting baseline-review evaluation.",
    };
  }

  const core = computeChainCore(auditDb, booksAppDb);
  const nowIso = new Date().toISOString();

  persistLinks(auditDb, core.allLinks);

  const upsertSummary = auditDb.prepare(
    `INSERT INTO audit_traceability_chain_summary (summary_id, so_line_id, item_id, required_qty, ordered_qty, purchased_qty, billed_qty, invoiced_qty, allocated_qty, remaining_qty, excess_qty, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(so_line_id) DO UPDATE SET
       item_id = excluded.item_id, required_qty = excluded.required_qty, ordered_qty = excluded.ordered_qty, purchased_qty = excluded.purchased_qty,
       billed_qty = excluded.billed_qty, invoiced_qty = excluded.invoiced_qty, allocated_qty = excluded.allocated_qty,
       remaining_qty = excluded.remaining_qty, excess_qty = excluded.excess_qty, computed_at = excluded.computed_at`
  );
  for (const s of core.summaries) {
    upsertSummary.run(
      randomUUID(),
      s.soLineId,
      s.itemId,
      String(s.requiredQty),
      String(s.orderedQty),
      String(s.purchasedQty),
      String(s.billedQty),
      String(s.invoicedQty),
      String(s.allocatedQty),
      String(s.remainingQty),
      String(s.excessQty),
      nowIso
    );
  }

  // Alert persistence: reachable only when baselineApproved is already true
  // (the gate above returns early otherwise), so this always runs now.
  const upsertResult = upsertTraceabilityAlerts(auditDb, core.drafts, nowIso, nowIso);
  let resolved = 0;

  // Resolve stale alerts per rule. Every rule below runs a FULL-POPULATION
  // detection pass every cycle (unlike a rule that only fires for specific
  // discovered pairs) — so its active-key set must be built from the fixed
  // rule id, not merely "whichever rules happened to produce a draft this
  // time". Using drafts-derived rule ids alone would mean a rule that finds
  // ZERO conditions this pass (e.g. the SO that just became fully invoiced)
  // never gets a resolve call at all, leaving its previous alert stuck OPEN.
  const RULE_IDS_RUN_EVERY_PASS = [
    "SO_NOT_INVOICED",
    "SO_ITEM_NOT_PROCURED",
    "SO_PARTIALLY_PROCURED",
    "OVER_PROCURED",
    "PO_NOT_BILLED",
    "PO_PARTIALLY_BILLED",
    "BILL_EXCEEDS_PO",
    "INVOICE_EXCEEDS_SO",
    "UNLINKED_PO_ITEM",
    "UNLINKED_BILL_ITEM",
    "UNLINKED_INVOICE_ITEM",
    "AMBIGUOUS_ITEM_MATCH",
    "DUPLICATE_CONSUMPTION",
    "UNAPPROVED_SUBSTITUTION",
    "SKU_MISMATCH",
    "UOM_MISMATCH",
    "UOM_NOT_AVAILABLE",
    "RATE_MISMATCH",
  ];
  for (const ruleId of RULE_IDS_RUN_EVERY_PASS) {
    const keys = new Set(core.drafts.filter((d) => d.ruleId === ruleId).map((d) => d.dedupKey));
    resolved += resolveStaleTraceabilityAlerts(auditDb, ruleId, keys);
  }

  void actor;
  return {
    soToPoLinks: core.allLinks.filter((l) => l.fromDocType === "SALES_ORDER" && l.toDocType === "PURCHASE_ORDER").length,
    poToBillLinks: core.allLinks.filter((l) => l.fromDocType === "PURCHASE_ORDER" && l.toDocType === "PURCHASE_BILL").length,
    soToInvoiceLinks: core.allLinks.filter((l) => l.fromDocType === "SALES_ORDER" && l.toDocType === "SALES_INVOICE").length,
    chainSummaries: core.summaries.length,
    alertsCreated: upsertResult.created,
    alertsUpdated: upsertResult.updated,
    alertsResolved: resolved,
  };
}

/**
 * The ONLY way audit_traceability_baseline ever gets a row — an explicit,
 * owner-directed action (never called from any sync/scheduler code path).
 * Until this has been called, recomputeTraceabilityChain never persists a
 * single alert, no matter how many times it runs or how complete the
 * upstream caches are.
 */
export function approveTraceabilityBaseline(auditDb: DatabaseSync, approvedBy: string, notes?: string): void {
  auditDb
    .prepare(`INSERT INTO audit_traceability_baseline (baseline_key, baseline_set_at, approved_by, notes) VALUES ('DEFAULT', ?, ?, ?) ON CONFLICT(baseline_key) DO NOTHING`)
    .run(new Date().toISOString(), approvedBy, notes ?? null);
}

export function isTraceabilityBaselineApproved(auditDb: DatabaseSync): boolean {
  return Boolean(auditDb.prepare(`SELECT baseline_key FROM audit_traceability_baseline WHERE baseline_key = 'DEFAULT'`).get());
}
