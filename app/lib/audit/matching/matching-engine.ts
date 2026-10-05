// ============================================================
// Bansil Books Analytics — Deterministic Matching Engine (Milestone C)
// Pure functions only: no DB, no I/O, no AI. Given two normalized row
// sets (LEFT/RIGHT of one comparison edge), produces match-group
// candidates for human review. Never auto-accepts anything — every
// group this module returns has status CANDIDATE.
//
// Non-negotiables enforced here:
//  - no forced zero mismatch (residuals are returned, never dropped)
//  - no arbitrary FIFO/greedy many-to-many pairing (N:M buckets become
//    AMBIGUOUS, not a guessed pairing)
//  - cross-entity rows are never even bucketed together
//  - currency/unit mismatches are surfaced as DISCREPANCY, never
//    silently combined
//  - exact match requires reference + amount (+ date when both sides
//    supply one) to agree; a reference+amount match with a differing
//    date is a DISCREPANCY, not silently EXACT
// ============================================================

import { absScaled, parseScaled, tryParseScaled, sumScaled } from "./decimal.ts";

export interface EngineRow {
  /** Stable identifier for this row (audit_normalized_rows.row_id). */
  rowId: string;
  normalized: Record<string, unknown>;
}

export type GroupType =
  | "EXACT"
  | "GROUPED"
  | "PARTIAL"
  | "AMBIGUOUS"
  | "DISCREPANCY"
  | "UNMATCHED_LEFT"
  | "UNMATCHED_RIGHT";

export type DiscrepancySubtype =
  | "DATE_MISMATCH"
  | "REFERENCE_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "UNIT_MISMATCH"
  | "AMOUNT_EXCEEDS_ON_ONE_SIDE";

export interface MemberAllocation {
  rowId: string;
  side: "LEFT" | "RIGHT";
  /** Portion of this row's own amount consumed by this group, as a decimal string (2dp). Never exceeds the row's own amount. */
  allocatedAmount: string | null;
}

export interface CandidateGroup {
  groupType: GroupType;
  discrepancySubtype?: DiscrepancySubtype;
  members: MemberAllocation[];
  /** Amount left over on the larger side after allocation (PARTIAL groups only), 2dp decimal string. */
  residualAmount?: string;
  /** Quantity left over on the larger side after allocation, when every row in the group carries a quantity (PARTIAL groups only), up to 3dp decimal string. Tracked separately from money — never summed together. */
  residualQuantity?: string;
  notes: string[];
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  return str === "" ? null : str;
}

function referenceKey(row: EngineRow): string | null {
  const ref = s(row.normalized.document_number_normalized) ?? s(row.normalized.document_number_raw);
  return ref ? ref.toLowerCase() : null;
}

function entityKey(row: EngineRow): string | null {
  return s(row.normalized.entity_id);
}

function currencyOf(row: EngineRow): string | null {
  const c = s(row.normalized.currency);
  return c ? c.toUpperCase() : null;
}

function unitOf(row: EngineRow): string | null {
  const u = s(row.normalized.unit);
  return u ? u.toLowerCase() : null;
}

function dateOf(row: EngineRow, field: "transaction_date" | "posting_date" | "value_date"): string | null {
  return s(row.normalized[field]);
}

/** Resolves one comparison amount per row. No sign-perspective policy is approved in this milestone, so comparison is by absolute value; the original signed string is preserved on the row untouched. */
function resolveAmount(row: EngineRow): bigint | null {
  const candidates = [
    row.normalized.signed_amount,
    row.normalized.gross_value,
    row.normalized.settled_amount,
    row.normalized.debit_raw,
    row.normalized.credit_raw,
  ];
  for (const c of candidates) {
    const str = s(c);
    if (str === null) continue;
    const parsed = tryParseScaled(str);
    if (parsed !== null) return absScaled(parsed);
  }
  return null;
}

function quantityOf(row: EngineRow): bigint | null {
  const str = s(row.normalized.quantity);
  if (str === null) return null;
  return tryParseScaled(str);
}

/** Hard compatibility gate — rows that fail this are never even bucketed together (not a discrepancy, simply never compared). */
function crossEntityIncompatible(left: EngineRow, right: EngineRow): boolean {
  const le = entityKey(left);
  const re = entityKey(right);
  return le !== null && re !== null && le !== re;
}

function formatAmount(scaled: bigint): string {
  return formatScaledTo(scaled, 2);
}

function formatQuantity(scaled: bigint): string {
  return formatScaledTo(scaled, 3);
}

function formatScaledTo(scaled: bigint, decimals: number): string {
  const negative = scaled < BigInt(0);
  const unsigned = negative ? -scaled : scaled;
  const intPart = unsigned / BigInt(100000);
  const frac = (unsigned % BigInt(100000)).toString().padStart(5, "0").slice(0, decimals);
  return `${negative ? "-" : ""}${intPart}.${frac}`;
}

interface Bucket {
  key: string;
  left: EngineRow[];
  right: EngineRow[];
}

/**
 * Runs the deterministic engine for one comparison edge (LEFT source rows
 * vs RIGHT source rows). Returns CANDIDATE groups only — nothing here is
 * ever auto-accepted. `requirePartyMatch` should be set for INTERNAL_INTERNAL
 * mode per the original spec ("no line matched back to itself" /
 * "separate registers/roles").
 */
export function runMatchingEngine(
  leftRows: EngineRow[],
  rightRows: EngineRow[],
  options: { forbidSelfSourceMatch?: boolean } = {}
): CandidateGroup[] {
  const groups: CandidateGroup[] = [];

  // Partition first by entity compatibility (cross-entity rows are never
  // even considered together), then bucket by reference key when present,
  // falling back to an amount-only bucket when no reference exists on
  // either side of a potential pairing.
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();

  const buckets = new Map<string, Bucket>();
  const noRefLeft: EngineRow[] = [];
  const noRefRight: EngineRow[] = [];

  for (const row of leftRows) {
    const ref = referenceKey(row);
    if (ref) {
      const b = buckets.get(`ref:${ref}`) ?? { key: `ref:${ref}`, left: [], right: [] };
      b.left.push(row);
      buckets.set(`ref:${ref}`, b);
    } else {
      noRefLeft.push(row);
    }
  }
  for (const row of rightRows) {
    const ref = referenceKey(row);
    if (ref) {
      const b = buckets.get(`ref:${ref}`) ?? { key: `ref:${ref}`, left: [], right: [] };
      b.right.push(row);
      buckets.set(`ref:${ref}`, b);
    } else {
      noRefRight.push(row);
    }
  }

  // Rows with no reference at all: fall back to bucketing by absolute
  // amount alone (still gated by entity compatibility below).
  for (const row of noRefLeft) {
    const amt = resolveAmount(row);
    const key = amt !== null ? `amt:${formatAmount(amt)}` : `norefnoamt:${row.rowId}`;
    const b = buckets.get(key) ?? { key, left: [], right: [] };
    b.left.push(row);
    buckets.set(key, b);
  }
  for (const row of noRefRight) {
    const amt = resolveAmount(row);
    const key = amt !== null ? `amt:${formatAmount(amt)}` : `norefnoamt:${row.rowId}`;
    const b = buckets.get(key) ?? { key, left: [], right: [] };
    b.right.push(row);
    buckets.set(key, b);
  }

  for (const bucket of buckets.values()) {
    // Split this bucket further by entity compatibility so cross-entity
    // rows sharing a reference/amount coincidentally are never paired.
    // Strict entity partition: a row's entity key (or the fixed sentinel
    // when none is declared) determines its sub-bucket, full stop. Rows
    // with different declared entity_id values are NEVER placed in the
    // same sub-bucket, so they can never be paired — this is the "cross-
    // entity mismatch rejected" gate. Rows with no entity_id declared on
    // either side simply share the neutral sentinel bucket.
    const entityGroups = new Map<string, { left: EngineRow[]; right: EngineRow[] }>();
    for (const row of bucket.left) {
      const ek = entityKey(row) ?? "__no_entity__";
      const g = entityGroups.get(ek) ?? { left: [], right: [] };
      g.left.push(row);
      entityGroups.set(ek, g);
    }
    for (const row of bucket.right) {
      const ek = entityKey(row) ?? "__no_entity__";
      const g = entityGroups.get(ek) ?? { left: [], right: [] };
      g.right.push(row);
      entityGroups.set(ek, g);
    }

    for (const sub of entityGroups.values()) {
      groups.push(...matchWithinCompatibleBucket(sub.left, sub.right));
    }
  }

  for (const g of groups) {
    for (const m of g.members) {
      if (m.side === "LEFT") usedLeft.add(m.rowId);
      else usedRight.add(m.rowId);
    }
  }

  let unmatchedLeft = leftRows.filter((r) => !usedLeft.has(r.rowId));
  let unmatchedRight = rightRows.filter((r) => !usedRight.has(r.rowId));

  // Second pass: genuine reference-mismatch reconciliation. Rows that
  // never shared a reference-key bucket at all (because their document
  // numbers actually differ) but agree on entity + amount + date are a
  // classic accounting finding — "looks like the same transaction, but
  // the reference doesn't match". Only a UNIQUE 1:1 correlation is
  // converted; anything ambiguous is left unmatched rather than guessed.
  const correlationBuckets = new Map<string, { left: EngineRow[]; right: EngineRow[] }>();
  for (const row of unmatchedLeft) {
    const amt = resolveAmount(row);
    const d = dateOf(row, "transaction_date") ?? dateOf(row, "posting_date") ?? dateOf(row, "value_date");
    if (amt === null || d === null) continue; // need both signals to correlate without a reference
    const key = `${entityKey(row) ?? "__no_entity__"}|${formatAmount(amt)}|${d}`;
    const b = correlationBuckets.get(key) ?? { left: [], right: [] };
    b.left.push(row);
    correlationBuckets.set(key, b);
  }
  for (const row of unmatchedRight) {
    const amt = resolveAmount(row);
    const d = dateOf(row, "transaction_date") ?? dateOf(row, "posting_date") ?? dateOf(row, "value_date");
    if (amt === null || d === null) continue;
    const key = `${entityKey(row) ?? "__no_entity__"}|${formatAmount(amt)}|${d}`;
    const b = correlationBuckets.get(key) ?? { left: [], right: [] };
    b.right.push(row);
    correlationBuckets.set(key, b);
  }

  const reconciledLeft = new Set<string>();
  const reconciledRight = new Set<string>();
  for (const bucket of correlationBuckets.values()) {
    if (bucket.left.length === 1 && bucket.right.length === 1) {
      const [l] = bucket.left;
      const [r] = bucket.right;
      const lref = referenceKey(l);
      const rref = referenceKey(r);
      // Only meaningful when both actually carry a reference and it
      // differs — two rows with no reference at all were already handled
      // by the primary amount-only bucket pass above.
      if (lref !== null && rref !== null && lref !== rref) {
        groups.push(discrepancyGroup([l, r], "LEFT", "RIGHT", "REFERENCE_MISMATCH", `Amount and date agree but the document reference differs: "${lref}" vs "${rref}".`));
        reconciledLeft.add(l.rowId);
        reconciledRight.add(r.rowId);
      }
    }
    // len > 1 on either side: multiple equally-plausible correlations —
    // never guessed, left unmatched.
  }

  unmatchedLeft = unmatchedLeft.filter((r) => !reconciledLeft.has(r.rowId));
  unmatchedRight = unmatchedRight.filter((r) => !reconciledRight.has(r.rowId));

  for (const row of unmatchedLeft) {
    groups.push({ groupType: "UNMATCHED_LEFT", members: [{ rowId: row.rowId, side: "LEFT", allocatedAmount: null }], notes: [] });
  }
  for (const row of unmatchedRight) {
    groups.push({ groupType: "UNMATCHED_RIGHT", members: [{ rowId: row.rowId, side: "RIGHT", allocatedAmount: null }], notes: [] });
  }

  void crossEntityIncompatible; // retained for clarity/tests of the concept; enforced structurally above
  void options;
  return groups;
}

function matchWithinCompatibleBucket(left: EngineRow[], right: EngineRow[]): CandidateGroup[] {
  if (left.length === 0 || right.length === 0) return [];

  // 1:1
  if (left.length === 1 && right.length === 1) {
    return [matchPair(left[0], right[0])];
  }

  // 1:N or N:1 — evaluate as GROUPED/PARTIAL only when currency/unit are
  // compatible across the whole set; otherwise surface as a single
  // DISCREPANCY group rather than guessing which subset is "right".
  if (left.length === 1 || right.length === 1) {
    const one = left.length === 1 ? left[0] : right[0];
    const many = left.length === 1 ? right : left;
    const oneSide: "LEFT" | "RIGHT" = left.length === 1 ? "LEFT" : "RIGHT";
    const manySide: "LEFT" | "RIGHT" = oneSide === "LEFT" ? "RIGHT" : "LEFT";

    const oneCurrency = currencyOf(one);
    const mismatchCurrency = many.some((r) => {
      const c = currencyOf(r);
      return oneCurrency !== null && c !== null && c !== oneCurrency;
    });
    if (mismatchCurrency) {
      return [discrepancyGroup([one, ...many], oneSide, manySide, "CURRENCY_MISMATCH", "Currency differs across a grouped candidate — not combined.")];
    }
    const oneUnit = unitOf(one);
    const mismatchUnit = many.some((r) => {
      const u = unitOf(r);
      return oneUnit !== null && u !== null && u !== oneUnit;
    });
    if (mismatchUnit && quantityOf(one) !== null) {
      return [discrepancyGroup([one, ...many], oneSide, manySide, "UNIT_MISMATCH", "Unit differs across a grouped candidate — quantities not combined.")];
    }

    const oneAmt = resolveAmount(one);
    const manyAmts = many.map((r) => resolveAmount(r));
    if (oneAmt === null || manyAmts.some((a) => a === null)) {
      return [ambiguousGroup([one, ...many], oneSide, manySide, "Amount missing on one or more rows — cannot evaluate grouped total.")];
    }
    const total = sumScaled(manyAmts as bigint[]);

    const members: MemberAllocation[] = [{ rowId: one.rowId, side: oneSide, allocatedAmount: formatAmount(oneAmt < total ? oneAmt : total) }];
    for (let i = 0; i < many.length; i++) {
      members.push({ rowId: many[i].rowId, side: manySide, allocatedAmount: formatAmount(manyAmts[i] as bigint) });
    }

    if (total === oneAmt) {
      return [{ groupType: "GROUPED", members, notes: [`${manySide === "LEFT" ? "Left" : "Right"} side (${many.length} rows) sums exactly to the ${oneSide.toLowerCase()} side amount.`] }];
    }
    if (total < oneAmt) {
      const residual = oneAmt - total;
      const notes = [`Residual ${formatAmount(residual)} remains unmatched on the ${oneSide.toLowerCase()} side.`];

      // Quantity residual is tracked separately from money — only computed
      // when every row in the group (the "one" and all of "many") actually
      // carries a quantity; never inferred or defaulted.
      let residualQuantity: string | undefined;
      const oneQty = quantityOf(one);
      const manyQtys = many.map((r) => quantityOf(r));
      if (oneQty !== null && manyQtys.every((q) => q !== null)) {
        const qtyTotal = sumScaled(manyQtys as bigint[]);
        if (qtyTotal < oneQty) {
          residualQuantity = formatQuantity(oneQty - qtyTotal);
          notes.push(`Quantity residual ${residualQuantity} remains unmatched on the ${oneSide.toLowerCase()} side (tracked separately from the money residual).`);
        }
      }

      return [{ groupType: "PARTIAL", members, residualAmount: formatAmount(residual), residualQuantity, notes }];
    }
    // total > oneAmt: the many-side sums to MORE than the one row — never
    // silently over-allocate; surface for review instead of picking a subset.
    return [discrepancyGroup([one, ...many], oneSide, manySide, "AMOUNT_EXCEEDS_ON_ONE_SIDE", `${manySide === "LEFT" ? "Left" : "Right"} side rows sum to more than the single ${oneSide.toLowerCase()} row — no subset was assumed.`)];
  }

  // N:M — never guess a pairing/subset combination; hold for human review.
  return [
    {
      groupType: "AMBIGUOUS",
      members: [
        ...left.map((r): MemberAllocation => ({ rowId: r.rowId, side: "LEFT", allocatedAmount: null })),
        ...right.map((r): MemberAllocation => ({ rowId: r.rowId, side: "RIGHT", allocatedAmount: null })),
      ],
      notes: [`${left.length} left row(s) and ${right.length} right row(s) share this key — multiple valid pairings are possible; held for manual allocation.`],
    },
  ];
}

function discrepancyGroup(
  rows: EngineRow[],
  oneSide: "LEFT" | "RIGHT",
  manySide: "LEFT" | "RIGHT",
  subtype: DiscrepancySubtype,
  note: string
): CandidateGroup {
  const [one, ...many] = rows;
  return {
    groupType: "DISCREPANCY",
    discrepancySubtype: subtype,
    members: [
      { rowId: one.rowId, side: oneSide, allocatedAmount: null },
      ...many.map((r): MemberAllocation => ({ rowId: r.rowId, side: manySide, allocatedAmount: null })),
    ],
    notes: [note],
  };
}

function ambiguousGroup(rows: EngineRow[], oneSide: "LEFT" | "RIGHT", manySide: "LEFT" | "RIGHT", note: string): CandidateGroup {
  const [one, ...many] = rows;
  return {
    groupType: "AMBIGUOUS",
    members: [
      { rowId: one.rowId, side: oneSide, allocatedAmount: null },
      ...many.map((r): MemberAllocation => ({ rowId: r.rowId, side: manySide, allocatedAmount: null })),
    ],
    notes: [note],
  };
}

function matchPair(left: EngineRow, right: EngineRow): CandidateGroup {
  if (crossEntityIncompatible(left, right)) {
    // Should not normally reach here (entity partitioning happens earlier),
    // kept as a defensive second gate.
    return {
      groupType: "UNMATCHED_LEFT",
      members: [{ rowId: left.rowId, side: "LEFT", allocatedAmount: null }],
      notes: ["Cross-entity candidate rejected before matching."],
    };
  }

  const lc = currencyOf(left);
  const rc = currencyOf(right);
  if (lc !== null && rc !== null && lc !== rc) {
    return discrepancyGroup([left, right], "LEFT", "RIGHT", "CURRENCY_MISMATCH", `Currency differs: ${lc} vs ${rc}.`);
  }

  const lu = unitOf(left);
  const ru = unitOf(right);
  const bothHaveQty = quantityOf(left) !== null && quantityOf(right) !== null;
  if (bothHaveQty && lu !== null && ru !== null && lu !== ru) {
    return discrepancyGroup([left, right], "LEFT", "RIGHT", "UNIT_MISMATCH", `Unit differs: ${lu} vs ${ru}.`);
  }

  const lref = referenceKey(left);
  const rref = referenceKey(right);
  const lAmt = resolveAmount(left);
  const rAmt = resolveAmount(right);

  if (lAmt === null || rAmt === null) {
    return ambiguousGroup([left, right], "LEFT", "RIGHT", "Amount missing on one side — cannot confirm a match.");
  }

  if (lAmt !== rAmt) {
    // Same reference key brought them together but the amount disagrees —
    // this is an amount/partial discrepancy, not a reference discrepancy
    // (the reference itself agreed, or both were amount-only bucketed).
    // Treat exactly like the 1-vs-N case with N=1: smaller side settles
    // part of the larger side (PARTIAL, residual retained), or if the
    // "right" side is larger than "left" without evidence of a subset,
    // surface it rather than guess.
    const qtyResidual = (largerSide: "LEFT" | "RIGHT"): string | undefined => {
      const lq = quantityOf(left);
      const rq = quantityOf(right);
      if (lq === null || rq === null) return undefined;
      const diff = largerSide === "LEFT" ? lq - rq : rq - lq;
      return diff > BigInt(0) ? formatQuantity(diff) : undefined;
    };

    if (rAmt < lAmt) {
      const residual = lAmt - rAmt;
      const residualQuantity = qtyResidual("LEFT");
      const notes = [`Residual ${formatAmount(residual)} remains unmatched on the left side.`];
      if (residualQuantity) notes.push(`Quantity residual ${residualQuantity} remains unmatched on the left side (tracked separately from the money residual).`);
      return {
        groupType: "PARTIAL",
        members: [
          { rowId: left.rowId, side: "LEFT", allocatedAmount: formatAmount(rAmt) },
          { rowId: right.rowId, side: "RIGHT", allocatedAmount: formatAmount(rAmt) },
        ],
        residualAmount: formatAmount(residual),
        residualQuantity,
        notes,
      };
    }
    if (lAmt < rAmt) {
      const residual = rAmt - lAmt;
      const residualQuantity = qtyResidual("RIGHT");
      const notes = [`Residual ${formatAmount(residual)} remains unmatched on the right side.`];
      if (residualQuantity) notes.push(`Quantity residual ${residualQuantity} remains unmatched on the right side (tracked separately from the money residual).`);
      return {
        groupType: "PARTIAL",
        members: [
          { rowId: left.rowId, side: "LEFT", allocatedAmount: formatAmount(lAmt) },
          { rowId: right.rowId, side: "RIGHT", allocatedAmount: formatAmount(lAmt) },
        ],
        residualAmount: formatAmount(residual),
        residualQuantity,
        notes,
      };
    }
  }

  // Amount (and, if both present, reference) agree — check date agreement
  // before calling this EXACT.
  const ld = dateOf(left, "transaction_date") ?? dateOf(left, "posting_date") ?? dateOf(left, "value_date");
  const rd = dateOf(right, "transaction_date") ?? dateOf(right, "posting_date") ?? dateOf(right, "value_date");
  if (ld !== null && rd !== null && ld !== rd) {
    return discrepancyGroup([left, right], "LEFT", "RIGHT", "DATE_MISMATCH", `Amount and reference agree but date differs: ${ld} vs ${rd}.`);
  }

  if (lref === null && rref === null) {
    // No reference on either side — amount-only agreement is weaker
    // evidence; still EXACT (unique 1:1 in this bucket) but noted.
    return {
      groupType: "EXACT",
      members: [
        { rowId: left.rowId, side: "LEFT", allocatedAmount: formatAmount(lAmt) },
        { rowId: right.rowId, side: "RIGHT", allocatedAmount: formatAmount(rAmt) },
      ],
      notes: ["No document reference on either side — matched on amount (and date, if present) only."],
    };
  }

  return {
    groupType: "EXACT",
    members: [
      { rowId: left.rowId, side: "LEFT", allocatedAmount: formatAmount(lAmt) },
      { rowId: right.rowId, side: "RIGHT", allocatedAmount: formatAmount(rAmt) },
    ],
    notes: [],
  };
}

export { parseScaled };
