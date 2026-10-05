// ============================================================
// Bansil Books Analytics — Intelligent Inventory Mismatch Resolution
// Assistant: Real Candidate Query Layer (Phase 2, canonical CMC source).
//
// PERMANENT RULE (owner-approved 2026-09-15):
//   Customer Material Control UI, Mismatch Resolution, PDF export, and
//   Excel export MUST all derive from the SAME canonical Customer Material
//   Control dataset (getCustomerMaterialControlReport). There is NO
//   second inventory calculation path.
//
// This file:
//   (a) calls getCustomerMaterialControlReport() for the selected
//       customer+period — the EXACT same function the CMC UI uses;
//   (b) selects the target mismatch row from that report;
//   (c) builds a bounded, same-customer/same-period candidate pool
//       from OTHER items in the SAME report whose opposite-direction
//       leftover > 0;
//   (d) attaches a weak identity/UOM signal per candidate;
//   (e) looks up an ACTIVE BOM (read-only) when one exists.
//
// The pure suggestion engine (mismatch-suggestion-engine.ts) does the
// actual reasoning.
//
// No Zoho calls. No DB writes. No AI calls.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import {
  getCustomerMaterialControlReport,
  type CustomerMaterialControlItem,
  type CustomerMaterialControlReport,
} from "../../customer-material-control-engine.ts";
import { getActiveBom, listComponents } from "../bom/bom-service.ts";
import type { CandidateItem, CandidateMatchMethod, MismatchItem } from "./mismatch-types.ts";
import type { BomCandidateComponent } from "./mismatch-suggestion-engine.ts";

// -----------------------------------------------------------------
// Candidate pool limits (owner-approved 2026-09-15)
// -----------------------------------------------------------------
/** Default candidate pool size — only expanded toward MAX when additional
 *  candidates carry a STRONG or MEDIUM signal. */
const DEFAULT_CANDIDATE_POOL = 8;
/** Absolute hard cap — never exceeded regardless of signal quality. */
const ABSOLUTE_MAX_CANDIDATE_POOL = 12;

/** Common tokens that carry no item-family signal on their own (unit/size
 *  words, connectors). Deliberately small and conservative — under-
 *  inclusion (missing a real family match) is safe here; over-inclusion
 *  is not. */
const STOPWORDS = new Set(["FOR", "AND", "THE", "OF", "WITH", "SET", "TYPE", "NO", "PCS", "PC", "UNIT"]);

// -----------------------------------------------------------------
// Request / response types
// -----------------------------------------------------------------
export interface MismatchResolutionRequest {
  customerId: string;
  /** The exact item_id used in the CMC report item list. */
  itemId: string;
  /** Period selector — passed through to getCustomerMaterialControlReport(). */
  period?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ResolvedMismatchContext {
  mismatchItem: MismatchItem;
  candidates: CandidateItem[];
  /** Non-null only when an ACTIVE BOM already exists for this exact item
   *  as a composite — never fabricated. */
  bomComponents: BomCandidateComponent[] | null;
  /** The canonical CMC report used — for parity verification. */
  reportSummary: {
    customer_id: string;
    customer_name: string;
    period_label: string;
    from_date: string;
    to_date: string;
    total_items: number;
  };
}

export type CandidateQueryResult =
  | { ok: true; context: ResolvedMismatchContext }
  | { ok: false; error: string };

// -----------------------------------------------------------------
// Text similarity helpers
// -----------------------------------------------------------------
function tokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

function hasFamilyOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = tokens(a);
  if (ta.size === 0) return false;
  const tb = tokens(b);
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

// -----------------------------------------------------------------
// UOM lookup — exact transaction evidence only, never inferred
// -----------------------------------------------------------------
/** Most recent explicit transaction-line UOM for this item identity,
 *  across both purchase and sales lines. Never inferred/normalized/
 *  defaulted from Item Master — exact evidence only, per the existing
 *  UOM provenance rule (see database.ts unit column comment). Returns
 *  null (not a guess) when no line ever recorded one. */
export function lookupItemUom(mainDb: DatabaseSync, itemId: string): string | null {
  const row = mainDb
    .prepare(
      `SELECT unit, date FROM (
         SELECT pli.unit as unit, pb.date as date
         FROM purchase_bill_line_items pli
         JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
         WHERE COALESCE(pli.item_id, pli.item_name) = ? AND pli.unit IS NOT NULL AND TRIM(pli.unit) != ''
         UNION ALL
         SELECT sli.unit as unit, si.date as date
         FROM sales_invoice_line_items sli
         JOIN sales_invoices si ON sli.invoice_id = si.invoice_id
         WHERE COALESCE(sli.item_id, sli.item_name) = ? AND sli.unit IS NOT NULL AND TRIM(sli.unit) != ''
       )
       ORDER BY date DESC LIMIT 1`
    )
    .get(itemId, itemId) as { unit: string; date: string } | undefined;
  return row?.unit ?? null;
}

// -----------------------------------------------------------------
// Candidate match-method classification
// -----------------------------------------------------------------
type TargetSignals = { sku: string | null; itemName: string; description: string | null };

function candidateMatchMethod(target: TargetSignals, candidate: CustomerMaterialControlItem): CandidateMatchMethod {
  if (target.sku && candidate.sku && target.sku.trim().toUpperCase() === candidate.sku.trim().toUpperCase()) {
    return "EXACT_ITEM_ID"; // same catalog SKU across two different item rows — a genuine identity signal
  }
  if (hasFamilyOverlap(target.itemName, candidate.item_name) || hasFamilyOverlap(target.description, candidate.description)) {
    return "DESCRIPTION_FAMILY_SIMILARITY";
  }
  return "QUANTITY_RATIO_ONLY"; // no real signal — excluded from the combination search by the suggestion engine
}

/** Signal strength classification for pool expansion logic. */
function signalStrength(method: CandidateMatchMethod): "STRONG" | "MEDIUM" | "WEAK" {
  switch (method) {
    case "EXACT_ITEM_ID":
    case "APPROVED_ALIAS":
    case "OWNER_APPROVED_MAPPING":
    case "ACTIVE_BOM_COMPONENT":
      return "STRONG";
    case "DESCRIPTION_FAMILY_SIMILARITY":
      return "MEDIUM";
    case "QUANTITY_RATIO_ONLY":
      return "WEAK";
  }
}

// -----------------------------------------------------------------
// Main context builder
// -----------------------------------------------------------------

/**
 * Resolves everything the pure suggestion engine needs for ONE mismatch
 * item, using the CANONICAL Customer Material Control report for the
 * given customer+period — the EXACT SAME dataset shown in the CMC UI.
 *
 * Zero Zoho calls. Zero DB writes. Zero AI calls.
 */
export function buildMismatchResolutionContext(
  mainDb: DatabaseSync,
  auditDb: DatabaseSync,
  req: MismatchResolutionRequest
): CandidateQueryResult {
  // 1. Load the CANONICAL CMC report — same function used by the CMC UI,
  //    PDF export, and Excel export.
  const report: CustomerMaterialControlReport | null = getCustomerMaterialControlReport(mainDb, {
    customerId: req.customerId,
    financialYear: req.financialYear,
    period: req.period,
    fromDate: req.fromDate,
    toDate: req.toDate,
    statusFilter: "ALL",       // include reconciled items too — we need the full item list
    showReconciled: true,      // same
  });

  if (!report) {
    return { ok: false, error: "Customer not found in the current report scope (customer/period mismatch)." };
  }

  // 2. Find the target mismatch item from the SAME report items array.
  const allItems = report.items;
  const targetItem = allItems.find((it) => it.item_id === req.itemId);
  if (!targetItem) {
    return { ok: false, error: "Item not found in the current report scope for this customer/period." };
  }

  // 3. Determine mismatch direction from the CMC report's own KPIs.
  const isShortage = targetItem.shortfall_material_to_purchase > 0.001;
  const isSurplus = !isShortage && targetItem.balance_material_to_invoice > 0.001;

  if (!isShortage && !isSurplus) {
    return { ok: false, error: "This item has no shortage/surplus for the resolved period — nothing to resolve." };
  }

  // Mismatch qty: negative for shortage (sold-not-purchased), positive
  // for surplus (purchased-not-sold). These are the EXACT SAME KPIs
  // shown in the CMC UI's Item Breakdown table.
  const mismatchQty = isShortage
    ? -Math.abs(targetItem.shortfall_material_to_purchase)
    : Math.abs(targetItem.balance_material_to_invoice);

  const mismatchItem: MismatchItem = {
    itemId: req.itemId,
    itemName: targetItem.item_name,
    sku: targetItem.sku || null,
    description: targetItem.description || null,
    uom: lookupItemUom(mainDb, req.itemId),
    mismatchQty,
    customerId: report.customer.id,
    customerName: report.customer.name,
    taxableValue: isShortage ? targetItem.approx_shortfall_value : targetItem.reference_sales_value,
    gstInclusiveAmount: null,
    rate: isShortage ? targetItem.latest_purchase_rate : targetItem.latest_sales_rate,
  };

  // 4. Build candidate pool from OTHER items in the SAME report.
  //    Candidate direction is the OPPOSITE leftover: a shortage (sold-not-
  //    purchased) can only be explained by items with surplus (balance_
  //    material_to_invoice > 0); a surplus can only be explained by items
  //    with shortage (shortfall_material_to_purchase > 0).
  const targetSignals: TargetSignals = {
    sku: mismatchItem.sku,
    itemName: mismatchItem.itemName,
    description: mismatchItem.description,
  };

  const rawPool = allItems
    .filter((it) => it.item_id !== req.itemId)
    .map((it) => ({
      it,
      available: isShortage ? it.balance_material_to_invoice : it.shortfall_material_to_purchase,
      method: candidateMatchMethod(targetSignals, it),
    }))
    .filter((x) => x.available > 0.001);

  // Deterministic ordering: strongest signal first, then largest available
  // qty, then item name — never arbitrary/insertion order.
  rawPool.sort((a, b) => {
    const rankOrder = { STRONG: 0, MEDIUM: 1, WEAK: 2 };
    const ra = rankOrder[signalStrength(a.method)];
    const rb = rankOrder[signalStrength(b.method)];
    if (ra !== rb) return ra - rb;
    if (b.available !== a.available) return b.available - a.available;
    return a.it.item_name.localeCompare(b.it.item_name);
  });

  // Tiered pool: take up to DEFAULT (8), then expand toward MAX (12)
  // only for STRONG/MEDIUM signal candidates.
  const poolItems: typeof rawPool = [];
  for (const entry of rawPool) {
    if (poolItems.length >= ABSOLUTE_MAX_CANDIDATE_POOL) break;
    if (poolItems.length >= DEFAULT_CANDIDATE_POOL) {
      // Beyond the default cap: only expand for strong/medium signal
      const strength = signalStrength(entry.method);
      if (strength === "WEAK") continue;
    }
    poolItems.push(entry);
  }

  const candidates: CandidateItem[] = poolItems.map(({ it, available, method }) => ({
    itemId: it.item_id,
    itemName: it.item_name,
    sku: it.sku || null,
    description: it.description || null,
    uom: lookupItemUom(mainDb, it.item_id),
    availableQty: available,
    matchMethod: method,
    taxableValue: isShortage ? it.reference_sales_value : it.approx_shortfall_value,
    gstInclusiveAmount: null,
    rate: isShortage ? it.latest_sales_rate : it.latest_purchase_rate,
    customerId: report.customer.id,
  }));

  // 5. ACTIVE BOM lookup — read-only, never created/inferred here. Local
  //    BOM authoring is DISABLED_FROM_PRODUCTION_UI (owner architecture
  //    decision); this only reads whatever ACTIVE BOM already exists.
  let bomComponents: BomCandidateComponent[] | null = null;
  try {
    const activeBom = getActiveBom(auditDb, req.itemId);
    if (activeBom) {
      const components = listComponents(auditDb, activeBom.bom_id);
      // Component availability comes from the SAME CMC report item list
      // (that component item's own leftover-in-the-opposite-direction
      // for this customer/period) — never a separate stock figure.
      bomComponents = components.map((c) => {
        const match = allItems.find((it) => it.item_id === c.component_item_id);
        const available = match
          ? (isShortage ? match.balance_material_to_invoice : match.shortfall_material_to_purchase)
          : 0;
        return {
          itemId: c.component_item_id,
          itemName: match?.item_name ?? c.component_description ?? c.component_item_id,
          sku: c.component_sku,
          description: c.component_description,
          uom: c.uom || null,
          availableQty: Math.max(0, available),
          matchMethod: "ACTIVE_BOM_COMPONENT" as const,
          qtyPerCompositeUnit: parseFloat(c.qty_per_composite_unit) || 0,
          taxableValue: match ? (isShortage ? match.reference_sales_value : match.approx_shortfall_value) : null,
          gstInclusiveAmount: null,
          rate: match ? (isShortage ? match.latest_sales_rate : match.latest_purchase_rate) : null,
          customerId: report.customer.id,
        };
      });
    }
  } catch {
    // BOM lookup is best-effort read-only evidence — a lookup failure
    // never blocks the grouped/alias suggestion path.
    bomComponents = null;
  }

  return {
    ok: true,
    context: {
      mismatchItem,
      candidates,
      bomComponents,
      reportSummary: {
        customer_id: report.customer.id,
        customer_name: report.customer.name,
        period_label: report.summary.period_label,
        from_date: report.summary.from_date,
        to_date: report.summary.to_date,
        total_items: allItems.length,
      },
    },
  };
}

export function buildBulkMismatchResolutionContext(
  mainDb: DatabaseSync,
  auditDb: DatabaseSync,
  req: Omit<MismatchResolutionRequest, "itemId">
): { ok: true; contexts: ResolvedMismatchContext[] } | { ok: false; error: string } {
  const report = getCustomerMaterialControlReport(mainDb, {
    customerId: req.customerId,
    financialYear: req.financialYear,
    period: req.period,
    fromDate: req.fromDate,
    toDate: req.toDate,
    statusFilter: "ALL",
    showReconciled: true,
  });

  if (!report) {
    return { ok: false, error: "Customer not found in the current report scope." };
  }

  const allItems = report.items;
  // Focus on shortages for bulk scan (owner spec: compare shortage (-) vs surplus (+))
  const shortageItems = allItems.filter(it => it.shortfall_material_to_purchase > 0.001);

  if (shortageItems.length === 0) {
    return { ok: true, contexts: [] };
  }

  const contexts: ResolvedMismatchContext[] = [];

  for (const targetItem of shortageItems) {
    const mismatchQty = -Math.abs(targetItem.shortfall_material_to_purchase);

    const mismatchItem: MismatchItem = {
      itemId: targetItem.item_id,
      itemName: targetItem.item_name,
      sku: targetItem.sku || null,
      description: targetItem.description || null,
      uom: lookupItemUom(mainDb, targetItem.item_id),
      mismatchQty,
      customerId: report.customer.id,
      customerName: report.customer.name,
      taxableValue: targetItem.approx_shortfall_value,
      gstInclusiveAmount: null,
      rate: targetItem.latest_purchase_rate,
    };

    const targetSignals: TargetSignals = {
      sku: mismatchItem.sku,
      itemName: mismatchItem.itemName,
      description: mismatchItem.description,
    };

    const rawPool = allItems
      .filter((it) => it.item_id !== targetItem.item_id)
      .map((it) => ({
        it,
        // Shortages can only be matched with surpluses
        available: it.balance_material_to_invoice,
        method: candidateMatchMethod(targetSignals, it),
      }))
      .filter((x) => x.available > 0.001);

    rawPool.sort((a, b) => {
      const rankOrder = { STRONG: 0, MEDIUM: 1, WEAK: 2 };
      const ra = rankOrder[signalStrength(a.method)];
      const rb = rankOrder[signalStrength(b.method)];
      if (ra !== rb) return ra - rb;
      if (b.available !== a.available) return b.available - a.available;
      return a.it.item_name.localeCompare(b.it.item_name);
    });

    const poolItems = rawPool;

    const candidates: CandidateItem[] = poolItems.map(({ it, available, method }) => ({
      itemId: it.item_id,
      itemName: it.item_name,
      sku: it.sku || null,
      description: it.description || null,
      uom: lookupItemUom(mainDb, it.item_id),
      availableQty: available,
      matchMethod: method,
      taxableValue: it.reference_sales_value,
      gstInclusiveAmount: null,
      rate: it.latest_sales_rate,
      customerId: report.customer.id,
    }));

    let bomComponents: BomCandidateComponent[] | null = null;
    try {
      const activeBom = getActiveBom(auditDb, targetItem.item_id);
      if (activeBom) {
        const components = listComponents(auditDb, activeBom.bom_id);
        bomComponents = components.map((c) => {
          const match = allItems.find((it) => it.item_id === c.component_item_id);
          const available = match ? match.balance_material_to_invoice : 0;
          return {
            itemId: c.component_item_id,
            itemName: match?.item_name ?? c.component_description ?? c.component_item_id,
            sku: c.component_sku,
            description: c.component_description,
            uom: c.uom || null,
            availableQty: Math.max(0, available),
            matchMethod: "ACTIVE_BOM_COMPONENT" as const,
            qtyPerCompositeUnit: parseFloat(c.qty_per_composite_unit) || 0,
            taxableValue: match ? match.reference_sales_value : null,
            gstInclusiveAmount: null,
            rate: match ? match.latest_sales_rate : null,
            customerId: report.customer.id,
          };
        });
      }
    } catch {
      bomComponents = null;
    }

    contexts.push({
      mismatchItem,
      candidates,
      bomComponents,
      reportSummary: {
        customer_id: report.customer.id,
        customer_name: report.customer.name,
        period_label: report.summary.period_label,
        from_date: report.summary.from_date,
        to_date: report.summary.to_date,
        total_items: allItems.length,
      },
    });
  }

  return { ok: true, contexts };
}
