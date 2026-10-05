import type { CandidateItem, MismatchItem, SuggestionGroup } from "./mismatch-types.ts";

export interface BomCandidateComponent extends CandidateItem {
  qtyPerCompositeUnit: number;
}

export interface SuggestionMatch {
  candidateItemId: string;
  candidateName: string;
  matchedQty: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

export interface SuggestionResult {
  expectedQty: number;
  matchedQty: number;
  matches: SuggestionMatch[];
  isExactMatch: boolean;
  message: string;
}

// ============================================================
// Suggestion Engine
// ============================================================

export function suggestResolution(
  mismatchItem: MismatchItem,
  candidates: CandidateItem[]
): SuggestionResult {
  const expectedQty = Math.abs(mismatchItem.mismatchQty);
  
  // 1. Try to find a single exact match first (Strongest signal)
  for (const c of candidates) {
    if (Math.abs(c.availableQty - expectedQty) < 0.001) {
      return {
        expectedQty,
        matchedQty: expectedQty,
        matches: [{
          candidateItemId: c.itemId,
          candidateName: c.itemName,
          matchedQty: expectedQty,
          confidence: c.matchMethod === "EXACT_ITEM_ID" ? "HIGH" : "MEDIUM",
          reason: `Exact 1:1 quantity match (${c.matchMethod})`
        }],
        isExactMatch: true,
        message: "Found an exact 1:1 quantity match."
      };
    }
  }

  // 2. We do NOT do greedy/arbitrary FIFO allocation. 
  // If there are multiple candidates and we need a subset sum, 
  // we would only do it if the entire pool of STRONG/MEDIUM candidates 
  // exactly equals the expectedQty.
  
  const strongMediumCandidates = candidates.filter(
    c => c.matchMethod !== "QUANTITY_RATIO_ONLY"
  );

  const totalAvailable = strongMediumCandidates.reduce((sum, c) => sum + c.availableQty, 0);
  
  if (strongMediumCandidates.length > 0 && Math.abs(totalAvailable - expectedQty) < 0.001) {
    return {
      expectedQty,
      matchedQty: expectedQty,
      matches: strongMediumCandidates.map(c => ({
        candidateItemId: c.itemId,
        candidateName: c.itemName,
        matchedQty: c.availableQty,
        confidence: "MEDIUM",
        reason: `Part of exact multi-item subset match (${c.matchMethod})`
      })),
      isExactMatch: true,
      message: "Found an exact multi-item subset match."
    };
  }

  // No exact deterministic match found. We do NOT force it.
  return {
    expectedQty,
    matchedQty: 0,
    matches: [],
    isExactMatch: false,
    message: "No deterministic exact match found. Manual review required."
  };
}

export function suggestBomResolution(
  mismatchItem: MismatchItem,
  bomComponents: BomCandidateComponent[]
): SuggestionResult {
  const expectedQty = Math.abs(mismatchItem.mismatchQty);
  let matchedQty = 0;
  const matches: SuggestionMatch[] = [];

  // For BOM, we can compute how many "units" of the composite we can fulfill.
  // Actually, we want to know if the BOM components precisely account for the mismatch.
  // The expected shortage is `expectedQty`.
  // Each unit of shortage expects `qtyPerCompositeUnit` of the component.
  
  let allComponentsMatch = true;
  for (const c of bomComponents) {
    const requiredForMismatch = expectedQty * c.qtyPerCompositeUnit;
    if (Math.abs(c.availableQty - requiredForMismatch) < 0.001) {
      matches.push({
        candidateItemId: c.itemId,
        candidateName: c.itemName,
        matchedQty: requiredForMismatch,
        confidence: "HIGH",
        reason: `Exact BOM component ratio match`
      });
      matchedQty = expectedQty; // We consider the composite quantity "matched" if components match
    } else {
      allComponentsMatch = false;
      break;
    }
  }

  if (allComponentsMatch && bomComponents.length > 0) {
    return {
      expectedQty,
      matchedQty: expectedQty,
      matches,
      isExactMatch: true,
      message: "Found exact active BOM composite match."
    };
  }

  return {
    expectedQty,
    matchedQty: 0,
    matches: [],
    isExactMatch: false,
    message: "BOM components do not perfectly align with the expected quantities."
  };
}

export function suggestBulkResolutionsWithConflictDetection(
  shortageItems: MismatchItem[],
  surplusCandidatesByMismatch: Map<string, CandidateItem[]>
): Array<{ mismatchItemId: string, sourceItem: { itemId: string, itemName: string, sku: string | null }, suggestion: SuggestionResult }> {
  // We simply iterate over the shortages and apply suggestResolution.
  // We can track consumed surplus quantities to prevent double-dipping.
  
  const consumedSurplus = new Map<string, number>();
  const results = [];

  for (const shortage of shortageItems) {
    const candidates = surplusCandidatesByMismatch.get(shortage.itemId) || [];
    
    // Adjust candidates by consumed surplus
    const availableCandidates = candidates.map(c => ({
      ...c,
      availableQty: c.availableQty - (consumedSurplus.get(c.itemId) || 0)
    })).filter(c => c.availableQty > 0.001);

    const suggestion = suggestResolution(shortage, availableCandidates);

    // If an exact match is made, consume the surplus
    if (suggestion.isExactMatch) {
      for (const match of suggestion.matches) {
        const prev = consumedSurplus.get(match.candidateItemId) || 0;
        consumedSurplus.set(match.candidateItemId, prev + match.matchedQty);
      }
    }

    results.push({
      mismatchItemId: shortage.itemId,
      sourceItem: {
        itemId: shortage.itemId,
        itemName: shortage.itemName,
        sku: shortage.sku
      },
      suggestion
    });
  }

  return results;
}

// ============================================================
// V2 Suggestion Engine (Reporting & Inspection Only)
// ============================================================

export interface V2SuggestionResult {
  sourceItem: MismatchItem;
  groups: SuggestionGroup[];
  unresolvedQty: number;
}

function calculateConfidence(
  source: MismatchItem,
  groupCandidates: CandidateItem[]
): { confidence: "HIGH" | "MEDIUM" | "LOW", reasons: string[], warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";

  // Customer Firewall (invariant check)
  for (const c of groupCandidates) {
    if (c.customerId !== source.customerId) {
      warnings.push("CROSS-CUSTOMER QUANTITIES NOT RECONCILED");
      return { confidence: "LOW", reasons: ["Cross-customer relationship rejected"], warnings };
    }
  }

  // BOM Contextual Evidence
  const hasBom = groupCandidates.some(c => c.matchMethod === "ACTIVE_BOM_COMPONENT");
  if (hasBom) {
    warnings.push("BOM_GOVERNANCE_NOT_VERIFIED");
    reasons.push("Contextual BOM evidence found");
  }

  // UOM Observation
  const allUomMatch = groupCandidates.every(c => c.uom === source.uom);
  if (source.uom && allUomMatch) {
    reasons.push("Transaction UOM matches");
  } else if (source.uom) {
    warnings.push("APPROVED_UOM_CONVERSION_NOT_AVAILABLE");
  }

  // Amount Evidence (±10%)
  // Summing base amounts from candidates if available
  const sourceValue = source.taxableValue;
  const groupValue = groupCandidates.reduce((acc, c) => acc + (c.taxableValue || 0), 0);
  let amountMatch = false;
  if (sourceValue && sourceValue > 0 && groupValue > 0) {
    const diffPercent = Math.abs(sourceValue - groupValue) / sourceValue * 100;
    if (diffPercent <= 10) {
      amountMatch = true;
      reasons.push(`Amount fits within ±10% tolerance (${diffPercent.toFixed(1)}%)`);
    }
  } else {
    warnings.push("Amount evidence not available for full comparison");
  }

  // Description / Match Method
  const allExact = groupCandidates.every(c => c.matchMethod === "EXACT_ITEM_ID");
  const anyDescMatch = groupCandidates.some(c => c.matchMethod === "DESCRIPTION_FAMILY_SIMILARITY");

  // Determine Confidence
  if (allExact) {
    confidence = "HIGH";
    reasons.push("Exact internal Item ID match");
  } else if (amountMatch && (hasBom || anyDescMatch)) {
    confidence = "HIGH";
  } else if (amountMatch) {
    confidence = "MEDIUM";
  } else if (hasBom) {
    confidence = "MEDIUM";
  } else if (anyDescMatch) {
    confidence = "MEDIUM";
  }

  // SKU Differences
  const skuMismatch = groupCandidates.some(c => c.sku !== source.sku);
  if (skuMismatch) {
    warnings.push("SKU DIFFERS");
  } else if (source.sku) {
    reasons.push("SKU MATCH");
  }

  return { confidence, reasons, warnings };
}

function getCombinations<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  function combine(start: number, combo: T[]) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return result;
}

export interface V2ScopeContext {
  period?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
}

function normalizeScopeKey(scope?: V2ScopeContext): string {
  if (!scope) return "SCOPE:UNKNOWN";
  if (scope.fromDate && scope.toDate) {
    return `SCOPE:CUSTOM:${scope.fromDate}:${scope.toDate}`;
  }
  if (scope.financialYear) {
    return `SCOPE:FY:${scope.financialYear}:${scope.period || "ALL"}`;
  }
  return `SCOPE:${scope.period || "UNKNOWN"}`;
}

export function suggestV2Resolutions(
  sourceItem: MismatchItem,
  candidates: CandidateItem[],
  scope?: V2ScopeContext
): V2SuggestionResult {
  const expectedQty = Math.abs(sourceItem.mismatchQty);
  const groups: SuggestionGroup[] = [];
  const scopeKey = normalizeScopeKey(scope);
  
  // Step A: Separate candidates based on QUALIFICATION RULE
  const technicalCandidates: CandidateItem[] = [];
  const supportingOnlyCandidates: CandidateItem[] = [];

  for (const c of candidates) {
    if (c.customerId !== sourceItem.customerId) continue;

    let hasStandaloneSignal = false;
    let hasSupportingSignal = false;

    // 1. Standalone qualifying signals
    if (c.matchMethod === "EXACT_ITEM_ID" || 
        c.matchMethod === "DESCRIPTION_FAMILY_SIMILARITY") {
      hasStandaloneSignal = true;
    } else if (c.sku && sourceItem.sku && c.sku === sourceItem.sku) {
      hasStandaloneSignal = true;
    }

    // 2. Supporting signals (contextual only)
    if (c.matchMethod === "ACTIVE_BOM_COMPONENT") {
      hasSupportingSignal = true;
    }
    if (Math.abs(c.availableQty - expectedQty) < 0.001) {
      hasSupportingSignal = true;
    }
    if (c.taxableValue && sourceItem.taxableValue && c.taxableValue > 0 && sourceItem.taxableValue > 0) {
      const diffPercent = Math.abs(sourceItem.taxableValue - c.taxableValue) / sourceItem.taxableValue * 100;
      if (diffPercent <= 10) {
        hasSupportingSignal = true;
      }
    }
    if (c.uom === sourceItem.uom && sourceItem.uom) {
      hasSupportingSignal = true;
    }

    if (hasStandaloneSignal) {
      technicalCandidates.push(c);
    } else if (hasSupportingSignal) {
      supportingOnlyCandidates.push(c);
    }
  }

  // Step C: Generate deterministic groups (sizes 1, 2, 3, 4) from TECHNICAL candidates ONLY
  const maxGroupSize = Math.min(4, technicalCandidates.length);
  const generatedGroups: CandidateItem[][] = [];
  
  for (let size = 1; size <= maxGroupSize; size++) {
    generatedGroups.push(...getCombinations(technicalCandidates, size));
  }

  // Step D & E: Calculate coverage and deduplicate (deduplication simplified by deterministic order)
  let groupIdCounter = 1;
  for (const combo of generatedGroups) {
    const coverageQty = combo.reduce((sum, c) => sum + c.availableQty, 0);
    const coveragePercent = Math.min(100, (coverageQty / expectedQty) * 100);
    const residualQty = Math.max(0, expectedQty - coverageQty);
    
    // Partial groups must improve evidence/coverage.
    // We only keep if coverage <= expectedQty * 1.05 (allowing slight over-coverage)
    if (coverageQty > expectedQty * 1.05 && combo.length > 1) {
      continue; // Skip noisy over-coverage combinations
    }

    const { confidence, reasons, warnings } = calculateConfidence(sourceItem, combo);

    const sortedIds = combo.map(c => c.itemId).sort();
    const sortedQtys = combo.map(c => c.availableQty).sort();
    const evidenceFingerprint = `TR:${scopeKey}:${sourceItem.customerId}:${sourceItem.itemId}:${sortedIds.join("|")}:${sortedQtys.join("|")}:${residualQty.toFixed(2)}`;

    // Filter meaningless partials: if size > 1 and it doesn't cover expectedQty well, it might be noise.
    // For V2, we preserve all qualifying.
    groups.push({
      groupId: `GRP-${groupIdCounter++}`,
      targetType: "TECHNICAL_RELATIONSHIP",
      candidates: combo,
      coverageQty,
      coveragePercent,
      residualQty,
      confidence,
      reasons,
      warnings,
      evidenceFingerprint
    });
  }

  // Add supporting-only candidates as standalone possibilities
  for (const c of supportingOnlyCandidates) {
    const coverageQty = c.availableQty;
    const coveragePercent = Math.min(100, (coverageQty / expectedQty) * 100);
    const residualQty = Math.max(0, expectedQty - coverageQty);
    
    const evidenceFingerprint = `QP:${scopeKey}:${sourceItem.customerId}:${sourceItem.itemId}:${c.itemId}:${c.availableQty.toFixed(2)}:${residualQty.toFixed(2)}`;

    groups.push({
      groupId: `GRP-${groupIdCounter++}`,
      targetType: "QUANTITY_ONLY_POSSIBILITY",
      candidates: [c],
      coverageQty,
      coveragePercent,
      residualQty,
      confidence: "LOW",
      reasons: ["QUANTITY_ONLY_POSSIBILITY"],
      warnings: ["Supporting evidence only. Does not qualify for technical groups."],
      evidenceFingerprint
    });
  }

  // Sort groups by coverage (closest to 100% first) then by confidence
  groups.sort((a, b) => {
    const diffA = Math.abs(100 - a.coveragePercent);
    const diffB = Math.abs(100 - b.coveragePercent);
    if (Math.abs(diffA - diffB) > 0.1) return diffA - diffB;
    const confWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return confWeight[b.confidence] - confWeight[a.confidence];
  });

  return {
    sourceItem,
    groups,
    unresolvedQty: expectedQty
  };
}

