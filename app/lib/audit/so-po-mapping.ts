/**
 * SO ↔ PO Custom-Field Deterministic Mapping — Pure Classification Logic
 *
 * Exported for use by:
 * - app/api/audit/order-comparison/route.ts (the API handler)
 * - scripts/so-po-mapping-tests.ts (the test suite)
 *
 * This module is a pure function library — no Zoho calls, no fetch, no database.
 * ZOHO WRITE: 0
 */

/**
 * Normalize a name for deterministic comparison.
 * Trim, collapse repeated whitespace to single space, lowercase.
 * NO fuzzy matching — exact normalized comparison only.
 */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Extract a single PO custom field value by label regex. Returns raw original value or null. */
export function extractCustomField(
  customFields: { label: string; value: string }[],
  pattern: RegExp
): string | null {
  const match = customFields.find(field => pattern.test(field.label.trim()));
  return match?.value?.trim() || null;
}

/** Deterministic SO–PO mapping status. Never inferred from amounts, quantities, or similarity. */
export type SoPoMappingStatus =
  | "EXACT_CUSTOM_FIELD_LINK"
  | "EXACT_CUSTOMER_VERIFIED"
  | "CUSTOMER_NAME_MISMATCH"
  | "SO_REFERENCE_NOT_FOUND"
  | "SO_REFERENCE_MISSING"
  | "MULTIPLE_SO_REFERENCE"
  | "READ_ERROR";

export interface LinkEvidence {
  mappingSource: string;
  soReference: string | null;
  soLookupResult: "FOUND" | "NOT_FOUND" | "NOT_ATTEMPTED";
  customerFieldRaw: string | null;
  soCustomerRaw: string | null;
  customerVerification: "EXACT_MATCH" | "MISMATCH" | "NOT_AVAILABLE";
  deliveryCustomerRaw: string | null;
  deliveryVerification: "EXACT_MATCH" | "MISMATCH" | "NOT_AVAILABLE";
  checkAndVerifyRaw: string | null;
  mappingStatus: SoPoMappingStatus;
}

/**
 * Build deterministic link evidence for a PO → SO mapping.
 * This is the core classification logic — pure function, no side effects.
 */
export function classifyMapping(args: {
  soReferenceValues: string[];
  customerFieldRaw: string | null;
  checkAndVerifyRaw: string | null;
  deliveryCustomerRaw: string | null;
  linkedSalesOrder: { party: string } | null;
  soLookupError: boolean;
}): LinkEvidence {
  const { soReferenceValues, customerFieldRaw, checkAndVerifyRaw, deliveryCustomerRaw, linkedSalesOrder, soLookupError } = args;

  // Base evidence structure
  const evidence: LinkEvidence = {
    mappingSource: "Not available",
    soReference: null,
    soLookupResult: "NOT_ATTEMPTED",
    customerFieldRaw,
    soCustomerRaw: linkedSalesOrder?.party ?? null,
    customerVerification: "NOT_AVAILABLE",
    deliveryCustomerRaw,
    deliveryVerification: "NOT_AVAILABLE",
    checkAndVerifyRaw,
    mappingStatus: "SO_REFERENCE_MISSING",
  };

  // Step 1: No Sales Order No custom field
  if (soReferenceValues.length === 0) {
    return evidence;
  }

  evidence.mappingSource = "PO Custom Field — Sales Order No";

  // Step 2: Multiple distinct SO references — ambiguous
  if (soReferenceValues.length > 1) {
    evidence.soReference = soReferenceValues.join(", ");
    evidence.mappingStatus = "MULTIPLE_SO_REFERENCE";
    return evidence;
  }

  // Step 3: Exactly one SO reference
  evidence.soReference = soReferenceValues[0];

  // Step 4: SO lookup failed with error
  if (soLookupError) {
    evidence.soLookupResult = "NOT_FOUND";
    evidence.mappingStatus = linkedSalesOrder ? "READ_ERROR" : "SO_REFERENCE_NOT_FOUND";
    return evidence;
  }

  // Step 5: SO not found (lookup succeeded but no match)
  if (!linkedSalesOrder) {
    evidence.soLookupResult = "NOT_FOUND";
    evidence.mappingStatus = "SO_REFERENCE_NOT_FOUND";
    return evidence;
  }

  // Step 6: SO found — verify customer name
  evidence.soLookupResult = "FOUND";
  evidence.soCustomerRaw = linkedSalesOrder.party;

  // Customer Name custom field verification
  if (customerFieldRaw) {
    const customerNorm = normalizeName(customerFieldRaw);
    const soCustomerNorm = normalizeName(linkedSalesOrder.party);
    evidence.customerVerification = customerNorm === soCustomerNorm ? "EXACT_MATCH" : "MISMATCH";
  }

  // Delivery customer verification (separate evidence)
  if (deliveryCustomerRaw) {
    const deliveryNorm = normalizeName(deliveryCustomerRaw);
    const soCustomerNorm = normalizeName(linkedSalesOrder.party);
    evidence.deliveryVerification = deliveryNorm === soCustomerNorm ? "EXACT_MATCH" : "MISMATCH";
  }

  // Final classification
  if (evidence.customerVerification === "EXACT_MATCH") {
    evidence.mappingStatus = "EXACT_CUSTOMER_VERIFIED";
  } else if (evidence.customerVerification === "MISMATCH") {
    evidence.mappingStatus = "CUSTOMER_NAME_MISMATCH";
  } else {
    // Customer field not available but SO link is valid
    evidence.mappingStatus = "EXACT_CUSTOM_FIELD_LINK";
  }

  return evidence;
}

/** 
 * Extract deterministic last 7 digits from SO reference.
 */
export function normalizeSoReference(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, ""); // Extract only numeric characters
  if (digits.length === 0) return null;
  return digits.slice(-7);
}

/**
 * Builds a deterministic O(1) lookup map of the latest SO snapshots,
 * grouped by the normalized last-7-digit key.
 */
export function buildGlobalSoLookup(db: any): Map<string, any[]> {
  const map = new Map<string, any[]>();
  const sos = db.prepare(`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER(PARTITION BY salesorder_id ORDER BY fetched_at DESC) as rn 
      FROM audit_zoho_sales_orders
    ) WHERE rn = 1
  `).all() as any[];

  for (const so of sos) {
    const key = normalizeSoReference(so.salesorder_number);
    if (key) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(so);
    }
  }
  return map;
}

export type SoResolutionResult = 
  | { status: "MATCH", so: any }
  | { status: "SO_REFERENCE_NOT_FOUND" }
  | { status: "AMBIGUOUS_SO_REFERENCE" }
  | { status: "UNRESOLVED" };

/**
 * Validates a reference against the global SO lookup map.
 * Enforces ambiguity protection: if > 1 candidate, returns AMBIGUOUS_SO_REFERENCE.
 */
export function resolveUniqueSalesOrder(lookupMap: Map<string, any[]>, ref: string | null | undefined): SoResolutionResult {
  const normalized = normalizeSoReference(ref);
  if (!normalized) return { status: "UNRESOLVED" };

  const candidates = lookupMap.get(normalized) || [];
  if (candidates.length === 0) return { status: "SO_REFERENCE_NOT_FOUND" };
  if (candidates.length > 1) return { status: "AMBIGUOUS_SO_REFERENCE" };
  
  return { status: "MATCH", so: candidates[0] };
}
