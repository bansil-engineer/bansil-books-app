"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeName = normalizeName;
exports.extractCustomField = extractCustomField;
exports.classifyMapping = classifyMapping;
exports.normalizeSoReference = normalizeSoReference;
exports.buildGlobalSoLookup = buildGlobalSoLookup;
exports.resolveUniqueSalesOrder = resolveUniqueSalesOrder;
/**
 * Normalize a name for deterministic comparison.
 * Trim, collapse repeated whitespace to single space, lowercase.
 * NO fuzzy matching — exact normalized comparison only.
 */
function normalizeName(value) {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
/** Extract a single PO custom field value by label regex. Returns raw original value or null. */
function extractCustomField(customFields, pattern) {
    var _a;
    var match = customFields.find(function (field) { return pattern.test(field.label.trim()); });
    return ((_a = match === null || match === void 0 ? void 0 : match.value) === null || _a === void 0 ? void 0 : _a.trim()) || null;
}
/**
 * Build deterministic link evidence for a PO → SO mapping.
 * This is the core classification logic — pure function, no side effects.
 */
function classifyMapping(args) {
    var _a;
    var soReferenceValues = args.soReferenceValues, customerFieldRaw = args.customerFieldRaw, checkAndVerifyRaw = args.checkAndVerifyRaw, deliveryCustomerRaw = args.deliveryCustomerRaw, linkedSalesOrder = args.linkedSalesOrder, soLookupError = args.soLookupError;
    // Base evidence structure
    var evidence = {
        mappingSource: "Not available",
        soReference: null,
        soLookupResult: "NOT_ATTEMPTED",
        customerFieldRaw: customerFieldRaw,
        soCustomerRaw: (_a = linkedSalesOrder === null || linkedSalesOrder === void 0 ? void 0 : linkedSalesOrder.party) !== null && _a !== void 0 ? _a : null,
        customerVerification: "NOT_AVAILABLE",
        deliveryCustomerRaw: deliveryCustomerRaw,
        deliveryVerification: "NOT_AVAILABLE",
        checkAndVerifyRaw: checkAndVerifyRaw,
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
        var customerNorm = normalizeName(customerFieldRaw);
        var soCustomerNorm = normalizeName(linkedSalesOrder.party);
        evidence.customerVerification = customerNorm === soCustomerNorm ? "EXACT_MATCH" : "MISMATCH";
    }
    // Delivery customer verification (separate evidence)
    if (deliveryCustomerRaw) {
        var deliveryNorm = normalizeName(deliveryCustomerRaw);
        var soCustomerNorm = normalizeName(linkedSalesOrder.party);
        evidence.deliveryVerification = deliveryNorm === soCustomerNorm ? "EXACT_MATCH" : "MISMATCH";
    }
    // Final classification
    if (evidence.customerVerification === "EXACT_MATCH") {
        evidence.mappingStatus = "EXACT_CUSTOMER_VERIFIED";
    }
    else if (evidence.customerVerification === "MISMATCH") {
        evidence.mappingStatus = "CUSTOMER_NAME_MISMATCH";
    }
    else {
        // Customer field not available but SO link is valid
        evidence.mappingStatus = "EXACT_CUSTOM_FIELD_LINK";
    }
    return evidence;
}
/**
 * Extract deterministic last 7 digits from SO reference.
 */
function normalizeSoReference(value) {
    if (!value)
        return null;
    var digits = value.replace(/\D/g, ""); // Extract only numeric characters
    if (digits.length === 0)
        return null;
    return digits.slice(-7);
}
/**
 * Builds a deterministic O(1) lookup map of the latest SO snapshots,
 * grouped by the normalized last-7-digit key.
 */
function buildGlobalSoLookup(db) {
    var map = new Map();
    var sos = db.prepare("\n    SELECT * FROM (\n      SELECT *, ROW_NUMBER() OVER(PARTITION BY salesorder_id ORDER BY fetched_at DESC) as rn \n      FROM audit_zoho_sales_orders\n    ) WHERE rn = 1\n  ").all();
    for (var _i = 0, sos_1 = sos; _i < sos_1.length; _i++) {
        var so = sos_1[_i];
        var key = normalizeSoReference(so.salesorder_number);
        if (key) {
            if (!map.has(key))
                map.set(key, []);
            map.get(key).push(so);
        }
    }
    return map;
}
/**
 * Validates a reference against the global SO lookup map.
 * Enforces ambiguity protection: if > 1 candidate, returns AMBIGUOUS_SO_REFERENCE.
 */
function resolveUniqueSalesOrder(lookupMap, ref) {
    var normalized = normalizeSoReference(ref);
    if (!normalized)
        return { status: "UNRESOLVED" };
    var candidates = lookupMap.get(normalized) || [];
    if (candidates.length === 0)
        return { status: "SO_REFERENCE_NOT_FOUND" };
    if (candidates.length > 1)
        return { status: "AMBIGUOUS_SO_REFERENCE" };
    return { status: "MATCH", so: candidates[0] };
}
