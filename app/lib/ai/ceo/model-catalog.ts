import { getAiDatabase } from "@/app/lib/db/ai-database";
import { CostStatus, ModelCostEntry, ModelTier } from "./ceo-types";

export interface ModelSelectionResult {
  model: string;
  provider: string;
  tier: ModelTier;
  costStatus: CostStatus;
  estimatedCost: number;
  canExecute: boolean;
  gateStatus: "ALLOWED" | "COST_CONFIG_REQUIRED" | "BUDGET_EXCEEDED";
  routedToAlternative: boolean;
  reason?: string;
  reviewerNeeded: boolean;
}

export function getModelCostCatalog(): ModelCostEntry[] {
  const db = getAiDatabase();
  const rows = db.prepare(`SELECT * FROM model_cost_catalog WHERE enabled = 1`).all() as Record<string, any>[];
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    model: r.model,
    tier: r.tier as ModelTier,
    input_cost_basis: Number(r.input_cost_basis),
    output_cost_basis: Number(r.output_cost_basis),
    fixed_call_cost: Number(r.fixed_call_cost),
    status: r.status as CostStatus,
    enabled: Boolean(r.enabled),
    notes: r.notes || undefined,
    effective_from: r.effective_from,
  }));
}

export function getModelCostEntry(modelOrId: string): ModelCostEntry | null {
  const db = getAiDatabase();
  const row = db.prepare(`
    SELECT * FROM model_cost_catalog
    WHERE id = ? OR model = ?
    LIMIT 1
  `).get(modelOrId, modelOrId) as Record<string, any> | undefined;

  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    tier: row.tier as ModelTier,
    input_cost_basis: Number(row.input_cost_basis),
    output_cost_basis: Number(row.output_cost_basis),
    fixed_call_cost: Number(row.fixed_call_cost),
    status: row.status as CostStatus,
    enabled: Boolean(row.enabled),
    notes: row.notes || undefined,
    effective_from: row.effective_from,
  };
}

/**
 * Configure authoritative or estimated provider pricing for a model.
 * Transitions pricing from CONFIG_REQUIRED to ESTIMATED or FINAL.
 */
export function configureModelPricing(params: {
  id: string;
  input_cost_basis: number;
  output_cost_basis: number;
  fixed_call_cost: number;
  status: "ESTIMATED" | "FINAL";
  notes?: string;
}): boolean {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE model_cost_catalog
    SET input_cost_basis = ?,
        output_cost_basis = ?,
        fixed_call_cost = ?,
        status = ?,
        notes = ?,
        effective_from = ?
    WHERE id = ? OR model = ?
  `).run(
    params.input_cost_basis,
    params.output_cost_basis,
    params.fixed_call_cost,
    params.status,
    params.notes || `Pricing explicitly configured as ${params.status}`,
    now,
    params.id,
    params.id
  );
  return result.changes > 0;
}

/**
 * Explicitly configure a genuinely free / local / unmetered model.
 * Marked with status NO_METERED_COST.
 * Rule: CONFIG_REQUIRED != FREE; free status MUST be explicitly configured.
 */
export function configureFreeModel(params: {
  id: string;
  model: string;
  provider: string;
  tier: ModelTier;
  notes?: string;
}): boolean {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO model_cost_catalog (
      id, provider, model, tier, input_cost_basis, output_cost_basis, fixed_call_cost, status, enabled, notes, effective_from
    ) VALUES (?, ?, ?, ?, 0.0, 0.0, 0.0, 'NO_METERED_COST', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      tier = excluded.tier,
      input_cost_basis = 0.0,
      output_cost_basis = 0.0,
      fixed_call_cost = 0.0,
      status = 'NO_METERED_COST',
      notes = excluded.notes,
      effective_from = excluded.effective_from
  `);
  const res = stmt.run(
    params.id,
    params.provider,
    params.model,
    params.tier,
    params.notes || "Explicitly configured local/free model with NO_METERED_COST",
    now
  );
  return res.changes > 0;
}

/**
 * Reset model pricing to CONFIG_REQUIRED with zero monetary basis.
 * Ensures no invented/fabricated pricing is treated as real rates.
 */
export function resetModelPricingToConfigRequired(id: string): boolean {
  const db = getAiDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE model_cost_catalog
    SET input_cost_basis = 0.0,
        output_cost_basis = 0.0,
        fixed_call_cost = 0.0,
        status = 'CONFIG_REQUIRED',
        notes = 'Pricing unconfigured; CONFIG_REQUIRED',
        effective_from = ?
    WHERE id = ? OR model = ?
  `).run(now, id, id);
  return result.changes > 0;
}

/**
 * Select appropriate model and enforce Cost Execution Gate.
 *
 * Rules:
 * 1. Do NOT assume unknown cost = ₹0.
 * 2. Do NOT assume unknown cost = ₹1 (arbitrary nominal fallback is eliminated).
 * 3. If preferred model is CONFIG_REQUIRED:
 *    A. Route to another suitable model with configured/authoritative pricing if available, OR
 *    B. Block paid execution with gateStatus = "COST_CONFIG_REQUIRED".
 * 4. Only models explicitly configured as NO_METERED_COST may execute without monetary reservation.
 */
export function selectModelForTask(params: {
  complexity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  accuracyRequirement?: "NORMAL" | "HIGH" | "CRITICAL";
  availableBudget: number;
}): ModelSelectionResult {
  const catalog = getModelCostCatalog();

  // Determine ideal tier based on capability/accuracy requirements
  let preferredTier: ModelTier = "FAST";
  let reviewerNeeded = false;

  if (params.complexity === "CRITICAL" || params.accuracyRequirement === "CRITICAL") {
    preferredTier = "HIGH_REASONING";
    reviewerNeeded = true;
  } else if (params.complexity === "HIGH" || params.accuracyRequirement === "HIGH") {
    preferredTier = "REASONING";
    reviewerNeeded = true;
  } else if (params.complexity === "MEDIUM") {
    preferredTier = "STANDARD";
  } else {
    preferredTier = "FAST";
  }

  // 1. Try finding configured model in preferred tier
  let match = catalog.find(
    (m) => m.tier === preferredTier && m.status !== "CONFIG_REQUIRED"
  );
  let routedToAlternative = false;

  // 2. If preferred tier has no configured model, check other tiers for an alternative configured model
  if (!match) {
    // Try finding any configured model in descending tier preference
    const tierFallbackOrder: ModelTier[] = ["STANDARD", "FAST", "REASONING", "HIGH_REASONING", "REVIEWER"];
    for (const t of tierFallbackOrder) {
      const alt = catalog.find((m) => m.tier === t && m.status !== "CONFIG_REQUIRED");
      if (alt) {
        match = alt;
        routedToAlternative = true;
        break;
      }
    }
  }

  // 3. If STILL no configured model exists, find unconfigured model to report, but block execution
  if (!match) {
    const unconfiguredMatch = catalog.find((m) => m.tier === preferredTier) || catalog[0];
    return {
      model: unconfiguredMatch ? unconfiguredMatch.model : "unconfigured",
      provider: unconfiguredMatch ? unconfiguredMatch.provider : "unknown",
      tier: unconfiguredMatch ? unconfiguredMatch.tier : preferredTier,
      costStatus: "CONFIG_REQUIRED",
      estimatedCost: 0,
      canExecute: false,
      gateStatus: "COST_CONFIG_REQUIRED",
      routedToAlternative: false,
      reason: "COST_CONFIG_REQUIRED: Model pricing is unconfigured and no configured alternative model is available. Paid calls blocked.",
      reviewerNeeded,
    };
  }

  // 4. Model is configured (either NO_METERED_COST, ESTIMATED, or FINAL)
  if (match.status === "NO_METERED_COST") {
    return {
      model: match.model,
      provider: match.provider,
      tier: match.tier,
      costStatus: "NO_METERED_COST",
      estimatedCost: 0.0,
      canExecute: true,
      gateStatus: "ALLOWED",
      routedToAlternative,
      reviewerNeeded,
    };
  }

  // Paid model with configured rate (ESTIMATED or FINAL)
  let effectiveCost = match.fixed_call_cost;
  if (effectiveCost === 0.0 && match.input_cost_basis > 0) {
    // Heuristic: 2000 input tokens + 1000 output tokens
    effectiveCost = (2 * match.input_cost_basis) + (1 * match.output_cost_basis);
  }

  // Check if cost fits within available budget
  if (effectiveCost > params.availableBudget) {
    // Check if cheaper configured FAST model exists that fits
    const cheapMatch = catalog.find(
      (m) => m.tier === "FAST" && m.status !== "CONFIG_REQUIRED" && m.fixed_call_cost <= params.availableBudget
    );
    if (cheapMatch) {
      match = cheapMatch;
      effectiveCost = cheapMatch.fixed_call_cost;
      routedToAlternative = true;
    } else {
      // Budget exceeded
      return {
        model: match.model,
        provider: match.provider,
        tier: match.tier,
        costStatus: match.status,
        estimatedCost: effectiveCost,
        canExecute: false,
        gateStatus: "BUDGET_EXCEEDED",
        routedToAlternative,
        reason: `Budget Exceeded: Required ₹${effectiveCost.toFixed(2)} exceeds available budget ₹${params.availableBudget.toFixed(2)}.`,
        reviewerNeeded,
      };
    }
  }

  return {
    model: match.model,
    provider: match.provider,
    tier: match.tier,
    costStatus: match.status,
    estimatedCost: effectiveCost,
    canExecute: true,
    gateStatus: "ALLOWED",
    routedToAlternative,
    reviewerNeeded,
  };
}
