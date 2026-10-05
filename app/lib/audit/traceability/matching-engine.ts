// ============================================================
// Bansil Books Analytics — Item Traceability Matching Engine (pure,
// deterministic). Matches downstream document lines (PO/Bill/Invoice)
// back to their upstream source line (SO/PO), allocating quantity from
// the upstream line's remaining capacity — supporting one-to-many
// (one SO line -> many PO lines, one PO line -> many Bill lines, one SO
// line -> many Invoice lines) with NO double consumption: the same unit
// of upstream quantity is never claimed by two downstream lines.
//
// Priority (per owner instruction, never re-ordered):
//   1. Explicit document/line linkage from Zoho
//   2. Exact item_id
//   3. Exact SKU
//   4. Owner-approved item mapping
//   5. Verified composite/BOM relationship when available
//   6. Normalized description candidate — NEVER auto-confirms a link;
//      surfaces only as an AMBIGUOUS_ITEM_MATCH candidate for review.
//   7. Manual review (nothing matched)
// ============================================================

import type { TraceabilityLink, TraceabilityMatchMethod } from "./traceability-types.ts";

export interface UpstreamLine {
  lineId: string;
  docId: string;
  docNumber: string | null; // e.g. salesorder_number / purchaseorder_number
  itemId: string | null;
  sku: string | null;
  description: string | null;
  qty: number;
}

export interface DownstreamLine {
  lineId: string;
  docId: string;
  refNumber: string | null; // e.g. the invoice/bill/PO's own reference_number field, compared against an upstream docNumber for explicit-linkage
  nativeUpstreamLineId: string | null; // a real Zoho-provided line-level link (e.g. PO line's salesorder_item_id) pointing directly at the upstream line's own lineId — the highest-priority match signal when populated
  itemId: string | null;
  sku: string | null;
  description: string | null;
  qty: number;
}

export interface ItemMappingLookup {
  (sourceItemIdentifier: string): { canonicalItemId: string } | null;
}

export interface BomRelationshipLookup {
  (downstreamItemId: string): { upstreamItemId: string } | null;
}

export interface MatchOptions {
  lookupMapping?: ItemMappingLookup;
  lookupBomRelationship?: BomRelationshipLookup;
}

export interface DescriptionCandidate {
  downstreamLineId: string;
  candidateUpstreamLineIds: string[];
}

export interface MatchResult {
  links: TraceabilityLink[];
  unmatchedDownstream: DownstreamLine[]; // priority 7 — nothing matched, not even a description candidate
  descriptionCandidates: DescriptionCandidate[]; // priority 6 — surfaced for review, never auto-linked
}

function normalizeDescription(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Allocates downstream lines against upstream lines' remaining capacity.
 * fromDocType/toDocType/matchType are labels only (used to tag the
 * resulting TraceabilityLink rows) — the allocation algorithm itself is
 * generic across SO->PO, PO->Bill, and SO->Invoice.
 */
export function matchLines(
  upstream: UpstreamLine[],
  downstream: DownstreamLine[],
  fromDocType: TraceabilityLink["fromDocType"],
  toDocType: TraceabilityLink["toDocType"],
  opts: MatchOptions = {}
): MatchResult {
  const remaining = new Map<string, number>(upstream.map((u) => [u.lineId, u.qty]));
  const links: TraceabilityLink[] = [];
  const unmatchedDownstream: DownstreamLine[] = [];
  const descriptionCandidates: DescriptionCandidate[] = [];

  for (const d of downstream) {
    let remainingToAllocate = d.qty;

    // Ordered candidate pools, one per priority tier. Each tier only
    // considers upstream lines that still have remaining capacity.
    const withCapacity = () => upstream.filter((u) => (remaining.get(u.lineId) ?? 0) > 0);

    // Priority 1a: a real Zoho-provided line-level field pointing directly at
    // the upstream line (e.g. a PO line's own salesorder_item_id). Checked
    // BEFORE every heuristic, including the document-number proxy below —
    // a valid native linkage must never be overridden by a coincidental
    // item_id/SKU/description match elsewhere.
    const tierNative = d.nativeUpstreamLineId ? withCapacity().filter((u) => u.lineId === d.nativeUpstreamLineId) : [];
    // Priority 1b: document-number-level proxy, used only when no native
    // line-level field is populated for this downstream line.
    const tier1 = d.refNumber ? withCapacity().filter((u) => u.docNumber && u.docNumber === d.refNumber) : [];
    const tier2 = withCapacity().filter((u) => d.itemId && u.itemId === d.itemId);
    const tier3 = d.sku ? withCapacity().filter((u) => u.sku && u.sku === d.sku) : [];
    const mapped = d.itemId && opts.lookupMapping ? opts.lookupMapping(d.itemId) : null;
    const tier4 = mapped ? withCapacity().filter((u) => u.itemId === mapped.canonicalItemId) : [];
    const bomRel = d.itemId && opts.lookupBomRelationship ? opts.lookupBomRelationship(d.itemId) : null;
    const tier5 = bomRel ? withCapacity().filter((u) => u.itemId === bomRel.upstreamItemId) : [];

    const tiers: Array<{ candidates: UpstreamLine[]; method: TraceabilityMatchMethod }> = [
      { candidates: tierNative, method: "NATIVE_LINE_LINKAGE" },
      { candidates: tier1, method: "EXPLICIT_LINKAGE" },
      { candidates: tier2, method: "ITEM_ID" },
      { candidates: tier3, method: "SKU" },
      { candidates: tier4, method: "OWNER_APPROVED_MAPPING" },
      { candidates: tier5, method: "BOM_RELATIONSHIP" },
    ];

    let anyLinkForThisLine = false;
    let lastLinkIndex = -1;
    for (const tier of tiers) {
      if (remainingToAllocate <= 0) break;
      for (const u of tier.candidates) {
        if (remainingToAllocate <= 0) break;
        const cap = remaining.get(u.lineId) ?? 0;
        if (cap <= 0) continue;
        const allocate = Math.min(cap, remainingToAllocate);
        if (allocate <= 0) continue;
        links.push({
          fromDocType,
          fromDocId: u.docId,
          fromLineId: u.lineId,
          toDocType,
          toDocId: d.docId,
          toLineId: d.lineId,
          itemId: d.itemId ?? u.itemId,
          matchMethod: tier.method,
          allocatedQty: allocate,
        });
        lastLinkIndex = links.length - 1;
        remaining.set(u.lineId, cap - allocate);
        remainingToAllocate -= allocate;
        anyLinkForThisLine = true;
      }
    }

    if (!anyLinkForThisLine) {
      // Priority 6: normalized description candidate — surfaced only, never auto-confirmed.
      const dDesc = normalizeDescription(d.description);
      const candidates = dDesc ? withCapacity().filter((u) => normalizeDescription(u.description) === dDesc) : [];
      if (candidates.length > 0) {
        descriptionCandidates.push({ downstreamLineId: d.lineId, candidateUpstreamLineIds: candidates.map((c) => c.lineId) });
      } else {
        // Priority 7: manual review — nothing matched at all.
        unmatchedDownstream.push(d);
      }
    } else if (remainingToAllocate > 0) {
      // This downstream line's own quantity exceeds the remaining capacity of every upstream
      // candidate it matched (e.g. a Bill billed more than its PO ordered, or an extra PO placed
      // after an SO's own demand was already fully covered by earlier POs). This is a genuine
      // EXCESS condition (BILL_EXCEEDS_PO / OVER_PROCURED / INVOICE_EXCEEDS_SO), not a shortfall —
      // it must never be silently dropped. The leftover is attributed to the last matched upstream
      // link, whose allocatedQty may now exceed that upstream line's own remaining capacity at the
      // time of allocation (recorded as a negative "remaining" internally) — this is the intended
      // signal, not a bug: it is exactly what the *_EXCEEDS_*/OVER_PROCURED detectors compare
      // against required/ordered qty to fire on.
      const last = links[lastLinkIndex];
      last.allocatedQty += remainingToAllocate;
      remaining.set(last.fromLineId, (remaining.get(last.fromLineId) ?? 0) - remainingToAllocate);
      remainingToAllocate = 0;
    }
  }

  return { links, unmatchedDownstream, descriptionCandidates };
}
