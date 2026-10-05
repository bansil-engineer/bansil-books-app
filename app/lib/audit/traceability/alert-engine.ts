// ============================================================
// Bansil Books Analytics — Item Traceability Alert Engine (pure,
// deterministic). Every detector is a pure function over already-
// computed chain summaries / links / line records — no Zoho calls, no
// DB access, no external AI. Severity is always a function of BOTH
// quantity/amount materiality AND a governed threshold, never amount
// alone. Partial fulfilment/procurement/billing is explicitly NOT an
// error by itself — only the *_EXCEEDS_*, OVER_PROCURED, WRONG_ITEM,
// SKU_MISMATCH, UOM_MISMATCH, RATE_MISMATCH, DUPLICATE_CONSUMPTION,
// UNAPPROVED_SUBSTITUTION, and AMBIGUOUS_ITEM_MATCH rules are always
// alerts; the *_NOT_*/*_PARTIALLY_* rules are informational unless a
// configured grace period has elapsed.
// ============================================================

import type { TraceabilityAlertDraft, ChainSummary, TraceabilityLink } from "./traceability-types.ts";

export interface TraceabilityConfig {
  graceDays: number; // days after which SO_NOT_INVOICED / PO_NOT_BILLED escalate from informational to REVIEW_REQUIRED
  overTolerancePercent: number; // e.g. 2 = 2% tolerance before OVER_PROCURED / *_EXCEEDS_* fires
  rateTolerancePercent: number;
}

export interface SoLineInput {
  lineId: string;
  soId: string;
  soDate: string | null;
  itemId: string | null;
  sku: string | null;
  description: string | null;
  unit: string | null;
  rate: number | null;
  status: string | null; // void/cancelled excluded upstream, never here
}

export interface PoLineInput {
  lineId: string;
  poId: string;
  poDate: string | null;
  itemId: string | null;
  sku: string | null;
  description: string | null;
  unit: string | null;
  rate: number | null;
  qty: number;
  status: string | null;
}

export interface LinkedLinePair {
  link: TraceabilityLink;
  fromUnit: string | null;
  toUnit: string | null;
  fromRate: number | null;
  toRate: number | null;
  fromSku: string | null;
  toSku: string | null;
  fromItemId: string | null;
  toItemId: string | null;
  itemMappingApproved: boolean;
}

function daysSince(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export function detectSoNotInvoiced(soLines: SoLineInput[], summaries: Map<string, ChainSummary>, config: TraceabilityConfig, now: Date): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const so of soLines) {
    const s = summaries.get(so.lineId);
    if (!s || s.invoicedQty > 0) continue;
    const age = daysSince(so.soDate, now);
    const pastGrace = age !== null && age > config.graceDays;
    drafts.push({
      alertType: "SO_NOT_INVOICED",
      entityType: "SO_LINE",
      entityId: so.lineId,
      ruleId: "SO_NOT_INVOICED",
      severity: pastGrace ? "MEDIUM" : "LOW",
      detectionState: "REVIEW_REQUIRED",
      title: "Sales Order line not yet invoiced",
      description: `SO line ${so.lineId} has zero invoiced quantity${age !== null ? ` (${Math.round(age)} days since SO date)` : ""}.`,
      affectedQty: s.requiredQty,
      affectedAmount: so.rate != null ? so.rate * s.requiredQty : null,
      evidence: { soLineId: so.lineId, soId: so.soId, requiredQty: s.requiredQty, invoicedQty: s.invoicedQty, ageDays: age },
      recommendedAction: "Confirm whether this SO line is still expected to be invoiced, or close/cancel it.",
      zohoModifiedAt: null,
      dedupKey: `SO_NOT_INVOICED:${so.lineId}`,
    });
  }
  return drafts;
}

export function detectSoItemNotProcured(soLines: SoLineInput[], summaries: Map<string, ChainSummary>): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const so of soLines) {
    const s = summaries.get(so.lineId);
    if (!s || s.orderedQty > 0) continue;
    drafts.push({
      alertType: "SO_ITEM_NOT_PROCURED",
      entityType: "SO_LINE",
      entityId: so.lineId,
      ruleId: "SO_ITEM_NOT_PROCURED",
      severity: "MEDIUM",
      detectionState: "REVIEW_REQUIRED",
      title: "Sales Order item has no Purchase Order at all",
      description: `SO line ${so.lineId} has zero ordered quantity — no PO has been raised against it yet.`,
      affectedQty: s.requiredQty,
      affectedAmount: so.rate != null ? so.rate * s.requiredQty : null,
      evidence: { soLineId: so.lineId, requiredQty: s.requiredQty },
      recommendedAction: "Confirm whether procurement is expected for this SO line (vs. fulfilled from existing stock).",
      zohoModifiedAt: null,
      dedupKey: `SO_ITEM_NOT_PROCURED:${so.lineId}`,
    });
  }
  return drafts;
}

export function detectSoPartiallyProcured(soLines: SoLineInput[], summaries: Map<string, ChainSummary>): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const so of soLines) {
    const s = summaries.get(so.lineId);
    if (!s || !(s.purchasedQty > 0 && s.purchasedQty < s.requiredQty)) continue;
    drafts.push({
      alertType: "SO_PARTIALLY_PROCURED",
      entityType: "SO_LINE",
      entityId: so.lineId,
      ruleId: "SO_PARTIALLY_PROCURED",
      severity: "LOW",
      detectionState: "REVIEW_REQUIRED",
      title: "Sales Order line only partially procured",
      description: `SO line ${so.lineId}: required ${s.requiredQty}, procured ${s.purchasedQty}. Partial procurement is often legitimate — informational unless stale.`,
      affectedQty: s.requiredQty - s.purchasedQty,
      affectedAmount: so.rate != null ? so.rate * (s.requiredQty - s.purchasedQty) : null,
      evidence: { soLineId: so.lineId, requiredQty: s.requiredQty, purchasedQty: s.purchasedQty },
      recommendedAction: "No action required if procurement is staged; confirm if this line has been idle unusually long.",
      zohoModifiedAt: null,
      dedupKey: `SO_PARTIALLY_PROCURED:${so.lineId}`,
    });
  }
  return drafts;
}

export function detectOverProcured(soLines: SoLineInput[], summaries: Map<string, ChainSummary>, config: TraceabilityConfig): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const so of soLines) {
    const s = summaries.get(so.lineId);
    if (!s) continue;
    const toleranceQty = s.requiredQty * (config.overTolerancePercent / 100);
    if (!(s.purchasedQty > s.requiredQty + toleranceQty)) continue;
    const excess = s.purchasedQty - s.requiredQty;
    drafts.push({
      alertType: "OVER_PROCURED",
      entityType: "SO_LINE",
      entityId: so.lineId,
      ruleId: "OVER_PROCURED",
      severity: excess * (so.rate ?? 0) > 0 ? "MEDIUM" : "LOW",
      detectionState: "REVIEW_REQUIRED",
      title: "More procured than the Sales Order requires",
      description: `SO line ${so.lineId}: required ${s.requiredQty}, procured ${s.purchasedQty} — ${excess} over the ${config.overTolerancePercent}% tolerance band.`,
      affectedQty: excess,
      affectedAmount: so.rate != null ? so.rate * excess : null,
      evidence: { soLineId: so.lineId, requiredQty: s.requiredQty, purchasedQty: s.purchasedQty, toleranceQty },
      recommendedAction: "Confirm the excess is explained by a separate valid demand, or reverse the over-order.",
      zohoModifiedAt: null,
      dedupKey: `OVER_PROCURED:${so.lineId}`,
    });
  }
  return drafts;
}

export function detectPoNotBilled(poLines: PoLineInput[], billedByPoLine: Map<string, number>, config: TraceabilityConfig, now: Date): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const po of poLines) {
    const billed = billedByPoLine.get(po.lineId) ?? 0;
    if (billed > 0) continue;
    const age = daysSince(po.poDate, now);
    const pastGrace = age !== null && age > config.graceDays;
    drafts.push({
      alertType: "PO_NOT_BILLED",
      entityType: "PO_LINE",
      entityId: po.lineId,
      ruleId: "PO_NOT_BILLED",
      severity: pastGrace ? "MEDIUM" : "LOW",
      detectionState: "REVIEW_REQUIRED",
      title: "Purchase Order line has no Bill on file",
      description: `PO line ${po.lineId} has zero billed quantity${age !== null ? ` (${Math.round(age)} days since PO date)` : ""} — possible missing vendor liability.`,
      affectedQty: po.qty,
      affectedAmount: po.rate != null ? po.rate * po.qty : null,
      evidence: { poLineId: po.lineId, poId: po.poId, orderedQty: po.qty, ageDays: age },
      recommendedAction: "Confirm whether the vendor has shipped/billed this line yet.",
      zohoModifiedAt: null,
      dedupKey: `PO_NOT_BILLED:${po.lineId}`,
    });
  }
  return drafts;
}

export function detectPoPartiallyBilled(poLines: PoLineInput[], billedByPoLine: Map<string, number>): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const po of poLines) {
    const billed = billedByPoLine.get(po.lineId) ?? 0;
    if (!(billed > 0 && billed < po.qty)) continue;
    drafts.push({
      alertType: "PO_PARTIALLY_BILLED",
      entityType: "PO_LINE",
      entityId: po.lineId,
      ruleId: "PO_PARTIALLY_BILLED",
      severity: "LOW",
      detectionState: "REVIEW_REQUIRED",
      title: "Purchase Order line only partially billed",
      description: `PO line ${po.lineId}: ordered ${po.qty}, billed ${billed}. Often legitimate (staged delivery).`,
      affectedQty: po.qty - billed,
      affectedAmount: po.rate != null ? po.rate * (po.qty - billed) : null,
      evidence: { poLineId: po.lineId, orderedQty: po.qty, billedQty: billed },
      recommendedAction: "No action required if delivery is staged; confirm if this PO line has been idle unusually long.",
      zohoModifiedAt: null,
      dedupKey: `PO_PARTIALLY_BILLED:${po.lineId}`,
    });
  }
  return drafts;
}

export function detectBillExceedsPo(poLines: PoLineInput[], billedByPoLine: Map<string, number>, config: TraceabilityConfig): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const po of poLines) {
    const billed = billedByPoLine.get(po.lineId) ?? 0;
    const toleranceQty = po.qty * (config.overTolerancePercent / 100);
    if (!(billed > po.qty + toleranceQty)) continue;
    const excess = billed - po.qty;
    drafts.push({
      alertType: "BILL_EXCEEDS_PO",
      entityType: "PO_LINE",
      entityId: po.lineId,
      ruleId: "BILL_EXCEEDS_PO",
      severity: "HIGH",
      detectionState: "AUTO_DETECTED",
      title: "Vendor Bill quantity exceeds Purchase Order",
      description: `PO line ${po.lineId}: ordered ${po.qty}, billed ${billed} — ${excess} over tolerance. Direct cash-exposure risk.`,
      affectedQty: excess,
      affectedAmount: po.rate != null ? po.rate * excess : null,
      evidence: { poLineId: po.lineId, orderedQty: po.qty, billedQty: billed },
      recommendedAction: "Verify with the vendor; request a bill correction/credit or an approved PO amendment.",
      zohoModifiedAt: null,
      dedupKey: `BILL_EXCEEDS_PO:${po.lineId}`,
    });
  }
  return drafts;
}

export function detectInvoiceExceedsSo(soLines: SoLineInput[], summaries: Map<string, ChainSummary>, config: TraceabilityConfig): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const so of soLines) {
    const s = summaries.get(so.lineId);
    if (!s) continue;
    const toleranceQty = s.requiredQty * (config.overTolerancePercent / 100);
    if (!(s.invoicedQty > s.requiredQty + toleranceQty)) continue;
    const excess = s.invoicedQty - s.requiredQty;
    drafts.push({
      alertType: "INVOICE_EXCEEDS_SO",
      entityType: "SO_LINE",
      entityId: so.lineId,
      ruleId: "INVOICE_EXCEEDS_SO",
      severity: "HIGH",
      detectionState: "AUTO_DETECTED",
      title: "Sales Invoice quantity exceeds Sales Order",
      description: `SO line ${so.lineId}: required ${s.requiredQty}, invoiced ${s.invoicedQty} — ${excess} over tolerance. Possible customer over-billing.`,
      affectedQty: excess,
      affectedAmount: so.rate != null ? so.rate * excess : null,
      evidence: { soLineId: so.lineId, requiredQty: s.requiredQty, invoicedQty: s.invoicedQty },
      recommendedAction: "Verify with the customer; issue a credit or amend the SO with an approval trail.",
      zohoModifiedAt: null,
      dedupKey: `INVOICE_EXCEEDS_SO:${so.lineId}`,
    });
  }
  return drafts;
}

export function detectUnlinkedItems(
  entityType: "PO_LINE" | "BILL_LINE" | "INVOICE_LINE",
  alertType: "UNLINKED_PO_ITEM" | "UNLINKED_BILL_ITEM" | "UNLINKED_INVOICE_ITEM",
  unlinkedLines: Array<{ lineId: string; itemId: string | null; description: string | null; qty: number; rate: number | null }>
): TraceabilityAlertDraft[] {
  return unlinkedLines.map((l) => ({
    alertType,
    entityType,
    entityId: l.lineId,
    ruleId: alertType,
    severity: "MEDIUM" as const,
    detectionState: "REVIEW_REQUIRED" as const,
    title: `${entityType.replace("_", " ")} could not be traced to its upstream document`,
    description: `Line ${l.lineId} (item ${l.itemId ?? "unknown"}) has no explicit-linkage, item_id, SKU, mapping, or BOM match to any upstream line.`,
    affectedQty: l.qty,
    affectedAmount: l.rate != null ? l.rate * l.qty : null,
    evidence: { lineId: l.lineId, itemId: l.itemId, description: l.description },
    recommendedAction: "Manually review and, if a genuine match exists, add an owner-approved item mapping.",
    zohoModifiedAt: null,
    dedupKey: `${alertType}:${l.lineId}`,
  }));
}

export function detectAmbiguousItemMatch(candidates: Array<{ downstreamLineId: string; candidateUpstreamLineIds: string[] }>): TraceabilityAlertDraft[] {
  return candidates.map((c) => ({
    alertType: "AMBIGUOUS_ITEM_MATCH",
    entityType: "PO_LINE" as const, // generic — the specific document type is in evidence
    entityId: c.downstreamLineId,
    ruleId: "AMBIGUOUS_ITEM_MATCH",
    severity: "LOW" as const,
    detectionState: "REVIEW_REQUIRED" as const,
    title: "Description-only match candidate — not auto-confirmed",
    description: `Line ${c.downstreamLineId} matched ${c.candidateUpstreamLineIds.length} upstream line(s) by description text only. Description similarity never auto-confirms a link.`,
    affectedQty: null,
    affectedAmount: null,
    evidence: { downstreamLineId: c.downstreamLineId, candidateUpstreamLineIds: c.candidateUpstreamLineIds },
    recommendedAction: "Manually confirm the match and add an owner-approved item mapping if correct.",
    zohoModifiedAt: null,
    dedupKey: `AMBIGUOUS_ITEM_MATCH:${c.downstreamLineId}`,
  }));
}

export function detectLinePairIssues(pairs: LinkedLinePair[], config: TraceabilityConfig): TraceabilityAlertDraft[] {
  const drafts: TraceabilityAlertDraft[] = [];
  for (const p of pairs) {
    const linkKey = `${p.link.fromLineId}->${p.link.toLineId}`;

    if (p.link.matchMethod === "EXPLICIT_LINKAGE" && p.fromItemId && p.toItemId && p.fromItemId !== p.toItemId) {
      if (!p.itemMappingApproved) {
        drafts.push({
          alertType: "UNAPPROVED_SUBSTITUTION",
          entityType: "PO_LINE",
          entityId: p.link.toLineId,
          ruleId: "UNAPPROVED_SUBSTITUTION",
          severity: "HIGH",
          detectionState: "REVIEW_REQUIRED",
          title: "Item substituted without an approved mapping",
          description: `Linked via explicit document reference but item differs (${p.fromItemId} -> ${p.toItemId}) with no owner-approved mapping justifying it.`,
          affectedQty: p.link.allocatedQty,
          affectedAmount: null,
          evidence: { linkKey, fromItemId: p.fromItemId, toItemId: p.toItemId },
          recommendedAction: "Confirm the substitution is intentional and add an owner-approved item mapping, or correct the document.",
          zohoModifiedAt: null,
          dedupKey: `UNAPPROVED_SUBSTITUTION:${linkKey}`,
        });
      }
    } else if (p.link.matchMethod === "ITEM_ID" && p.fromSku && p.toSku && p.fromSku !== p.toSku) {
      drafts.push({
        alertType: "SKU_MISMATCH",
        entityType: "PO_LINE",
        entityId: p.link.toLineId,
        ruleId: "SKU_MISMATCH",
        severity: "LOW",
        detectionState: "REVIEW_REQUIRED",
        title: "Matched item_id but SKU differs",
        description: `Both lines resolved to item_id ${p.fromItemId}, but SKUs differ (${p.fromSku} vs ${p.toSku}).`,
        affectedQty: p.link.allocatedQty,
        affectedAmount: null,
        evidence: { linkKey, fromSku: p.fromSku, toSku: p.toSku },
        recommendedAction: "Confirm this is the same physical item in Zoho's own item master.",
        zohoModifiedAt: null,
        dedupKey: `SKU_MISMATCH:${linkKey}`,
      });
    }

    if (p.fromUnit && p.toUnit) {
      if (p.fromUnit !== p.toUnit) {
        drafts.push({
          alertType: "UOM_MISMATCH",
          entityType: "PO_LINE",
          entityId: p.link.toLineId,
          ruleId: "UOM_MISMATCH",
          severity: "MEDIUM",
          detectionState: "AUTO_DETECTED",
          title: "Unit of measure differs across linked lines",
          description: `${p.fromUnit} vs ${p.toUnit} on linked lines — quantities are not directly comparable as-is.`,
          affectedQty: p.link.allocatedQty,
          affectedAmount: null,
          evidence: { linkKey, fromUnit: p.fromUnit, toUnit: p.toUnit },
          recommendedAction: "Confirm the correct conversion, or correct the document's unit.",
          zohoModifiedAt: null,
          dedupKey: `UOM_MISMATCH:${linkKey}`,
        });
      }
    } else {
      drafts.push({
        alertType: "UOM_NOT_AVAILABLE",
        entityType: "PO_LINE",
        entityId: p.link.toLineId,
        ruleId: "UOM_NOT_AVAILABLE",
        severity: "LOW",
        detectionState: "REVIEW_REQUIRED",
        title: "Unit of measure could not be confirmed for this link",
        description: "At least one side of this link has no known UOM — never silently treated as compatible.",
        affectedQty: p.link.allocatedQty,
        affectedAmount: null,
        evidence: { linkKey, fromUnit: p.fromUnit, toUnit: p.toUnit },
        recommendedAction: "Capture the missing UOM at the source, or confirm manually.",
        zohoModifiedAt: null,
        dedupKey: `UOM_NOT_AVAILABLE:${linkKey}`,
      });
    }

    if (p.fromRate != null && p.toRate != null && p.fromRate > 0) {
      const diffPercent = (Math.abs(p.toRate - p.fromRate) / p.fromRate) * 100;
      if (diffPercent > config.rateTolerancePercent) {
        drafts.push({
          alertType: "RATE_MISMATCH",
          entityType: "PO_LINE",
          entityId: p.link.toLineId,
          ruleId: "RATE_MISMATCH",
          severity: diffPercent > config.rateTolerancePercent * 3 ? "HIGH" : "MEDIUM",
          detectionState: "AUTO_DETECTED",
          title: "Rate differs beyond tolerance across linked lines",
          description: `Rate ${p.fromRate} vs ${p.toRate} (${diffPercent.toFixed(1)}% difference, tolerance ${config.rateTolerancePercent}%).`,
          affectedQty: p.link.allocatedQty,
          affectedAmount: Math.abs(p.toRate - p.fromRate) * p.link.allocatedQty,
          evidence: { linkKey, fromRate: p.fromRate, toRate: p.toRate, diffPercent },
          recommendedAction: "Confirm the rate change is expected (price revision) rather than a data-entry error.",
          zohoModifiedAt: null,
          dedupKey: `RATE_MISMATCH:${linkKey}`,
        });
      }
    }
  }
  return drafts;
}

/** Structural sanity check: sum of allocatedQty out of any single upstream line must never exceed that line's own qty. Should never fire given matchLines()'s own ledger discipline — a genuine violation indicates stale/corrupted link data from an interrupted sync. */
export function detectDuplicateConsumption(links: TraceabilityLink[], upstreamQtyByLineId: Map<string, number>): TraceabilityAlertDraft[] {
  const consumedByUpstream = new Map<string, number>();
  for (const l of links) {
    consumedByUpstream.set(l.fromLineId, (consumedByUpstream.get(l.fromLineId) ?? 0) + l.allocatedQty);
  }
  const drafts: TraceabilityAlertDraft[] = [];
  for (const [lineId, consumed] of consumedByUpstream.entries()) {
    const qty = upstreamQtyByLineId.get(lineId);
    if (qty != null && consumed > qty) {
      drafts.push({
        alertType: "DUPLICATE_CONSUMPTION",
        entityType: "SO_LINE",
        entityId: lineId,
        ruleId: "DUPLICATE_CONSUMPTION",
        severity: "MEDIUM",
        detectionState: "AUTO_DETECTED",
        title: "Upstream line allocated beyond its own quantity",
        description: `Line ${lineId} has ${consumed} allocated downstream against its own quantity of ${qty} — an allocation-ledger violation.`,
        affectedQty: consumed - qty,
        affectedAmount: null,
        evidence: { lineId, consumed, qty },
        recommendedAction: "Investigate and correct the conflicting downstream allocation(s).",
        zohoModifiedAt: null,
        dedupKey: `DUPLICATE_CONSUMPTION:${lineId}`,
      });
    }
  }
  return drafts;
}
