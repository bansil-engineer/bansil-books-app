// ============================================================
// Bansil Books Analytics — Item Traceability Chain Summary (pure)
// Aggregates required/ordered/purchased/billed/invoiced/allocated/
// remaining/excess for one SO line, per ITEM_TRACEABILITY_DESIGN.md
// §12.3's quantity model. purchased_qty is documented as equal to
// ordered_qty in this pass — no independent goods-receipt signal exists
// anywhere in this app (no GRN endpoint approved/implemented), so
// "purchased" cannot be distinguished from "ordered" without inventing
// a field Zoho does not currently give us. allocated_qty at the
// chain-summary level is the SO line's procurement coverage (= ordered
// qty) — the top-level "how much of this demand has the chain covered"
// figure; remaining/excess are relative to that.
// ============================================================

import type { ChainSummary } from "./traceability-types.ts";

export function computeChainSummary(soLineId: string, itemId: string | null, requiredQty: number, orderedQty: number, billedQty: number, invoicedQty: number): ChainSummary {
  const purchasedQty = orderedQty; // documented equivalence — see file header
  const allocatedQty = orderedQty; // procurement coverage of the SO's own demand
  const remainingQty = Math.max(requiredQty - allocatedQty, 0);
  const excessQty = Math.max(allocatedQty - requiredQty, 0);
  return {
    soLineId,
    itemId,
    requiredQty,
    orderedQty,
    purchasedQty,
    billedQty,
    invoicedQty,
    allocatedQty,
    remainingQty,
    excessQty,
  };
}
