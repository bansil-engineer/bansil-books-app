# OWNER MANUAL MAPPING PHASE-3 DISCOVERY R1
## SMART SYNC STALE-MAPPING VALIDATION ARCHITECTURE

Discovery Date: 2026-10-03
Status: COMPLETE — DISCOVERY / ARCHITECTURE ONLY (DO NOT IMPLEMENT)

---

### 1. BASELINE STATUS

- **Git HEAD**: `c7de378eb45d54d164605886efda6da79de6dbeb`
- **Branch**: `feature/audit-workspace-milestone-a`
- **Staged**: 0
- **Phase-1 Service (`app/lib/audit/manual-line-mapping-service.ts`)**: Production baseline complete and verified (29/29 tests pass).
- **Phase-2 UI & API (`app/components/LineMappingPanel.tsx`, `app/api/audit/manual-line-mapping/*`)**: Complete and verified (20/20 tests pass).

---

### 2. CURRENT STALE ENGINE IN PHASE-1

In `app/lib/audit/manual-line-mapping-service.ts`:

1. **Fingerprint Generator**:
   `computeLineFingerprint(line: LineEvidence): string`
   - Canonical SHA-256 over 7 business fields: `line_item_id`, `item_id`, `item_name`, `description`, `quantity`, `rate`, `unit`.
   - Excludes non-business metadata: `rowid`, `source_run_id`, `fetched_at`, human Sr.No.
2. **Pure Stale Evaluator**:
   `evaluateMappingStaleness(db: DatabaseSync, mapping: LineMappingRecord): StaleResult`
   - Pure function (zero DB side-effects).
   - Re-fetches current local evidence via `getLocalSoLine` and `getLocalPoLine`.
   - Returns `"VALID"` | `"REVIEW_REQUIRED"` | `"MISSING_LINE"`.
3. **Usability Guard**:
   `isMappingUsable(db: DatabaseSync, mapping: LineMappingRecord): boolean`
   - Returns `true` only if `mapping.status === "ACTIVE"` AND `evaluateMappingStaleness(...) === "VALID"`.
4. **Transition to REVIEW_REQUIRED**:
   `markMappingReviewRequired(db: DatabaseSync, mappingId: string, note?: string): LineMappingRecord | null`
   - Checks `existing.status === "ACTIVE"` (skips if already `REVIEW_REQUIRED` or `REVOKED`).
   - Updates `status = 'REVIEW_REQUIRED'`, `review_required_at = now`, `updated_at = now`.
   - Records append-only history event: `"MAPPING_MARKED_REVIEW_REQUIRED"`.
   - Purely idempotent.

---

### 3. SMART SYNC WRITERS (SO / PO LINE EVIDENCE)

The only active writers to `audit_zoho_sales_order_lines` and `audit_zoho_purchase_order_lines` are:

1. **Approval Pending Global Smart Sync**:
   - File: `app/lib/audit/approval-pending-sync.ts`
   - Function: `syncApprovalPending()`
   - Writes: PO lines (lines 785-796) and SO lines (lines 943-956).
   - Source Run ID: `"APPROVAL_PENDING_ACTIVE"`.
2. **SMART SYNC THIS PO (Targeted PO Sync)**:
   - File: `app/lib/audit/approval-pending-sync.ts`
   - Function: `syncApprovalPendingDocument({ type: "PO", ... })`
   - Writes: PO lines (lines 1515-1528).
   - Source Run ID: `"APPROVAL_PENDING_ACTIVE"`.
3. **Targeted Invoice→SO Dependency Sync**:
   - File: `app/lib/audit/approval-pending-sync.ts`
   - Function: `syncApprovalPendingDocument({ type: "INVOICE", ... })`
   - Writes: Referenced SO lines (lines 1690-1703).
   - Source Run ID: `"APPROVAL_PENDING_ACTIVE"`.
4. **Targeted Bill→PO Dependency Sync**:
   - File: `app/lib/audit/approval-pending-sync.ts`
   - Function: `syncApprovalPendingDocument({ type: "BILL", ... })`
   - Writes: Referenced PO lines (lines 1748-1761).
   - Source Run ID: `"APPROVAL_PENDING_ACTIVE"`.
5. **Commercial Trace Sync**:
   - File: `app/lib/audit/commercial-trace-sync-service.ts`
   - Function: `syncCommercialTrace()`
   - Writes: SO lines (lines 135-151) and PO lines (lines 199-215).
   - Source Run ID: `"COMMERCIAL_TRACE_ACTIVE"`.

---

### 4. HOOK ARCHITECTURE & EXECUTION POINT

**Recommended Validation Point: AFTER COMMIT (Model B)**

**Reasoning**:
1. **Source Evidence Invariant**: Network fetch and normalization must be committed to SQLite before evaluating derivative mappings.
2. **Zero Blast-Radius on Failure**: If mapping validation encounters a transient SQLite issue or error, valid source sync data is NOT rolled back.
3. **Minimal Write-Lock Time**: Source transaction is kept short; validation runs in its own fast, dedicated local step.
4. **On-the-Fly Safety Net**: In Phase-1, `isMappingUsable()` dynamically checks `evaluateMappingStaleness() === "VALID"`. Even if validation fails or is delayed, stale mappings can never be authoritatively consumed.

**Central Function Specification**:
In `app/lib/audit/manual-line-mapping-service.ts`:
```typescript
export interface MappingValidationSummary {
  checked: number;
  stillValid: number;
  markedReviewRequired: number;
  missingLines: number;
  failed: number;
}

export function validateActiveMappingsForDocuments(
  db: DatabaseSync,
  scope: {
    organizationId: string;
    purchaseorderIds?: string[];
    salesorderIds?: string[];
  }
): MappingValidationSummary
```

---

### 5. VALIDATION SCOPE & PERFORMANCE

- **Targeted PO Sync**: Validates ACTIVE mappings where `organization_id = ? AND purchaseorder_id = ?`.
- **Targeted SO Sync (Invoice Dependency)**: Validates ACTIVE mappings where `organization_id = ? AND salesorder_id = ?`.
- **Targeted Bill Sync (PO Dependency)**: Validates ACTIVE mappings where `organization_id = ? AND purchaseorder_id = ?`.
- **Global Sync**: Collects changed `poIds` and `soIds` from `docsToWrite`; queries ACTIVE mappings where `organization_id = ? AND (purchaseorder_id IN (...) OR salesorder_id IN (...))`.
- **Commercial Trace Sync**: Validates ACTIVE mappings for changed `poIds` and `soIds` from `poDetails` / `soDetails`.
- **Full-table scan required**: NO. Always scoped to changed document IDs.

---

### 6. STATE TRANSITION & IDEMPOTENCY

- **ACTIVE + Valid Fingerprints** → Remains `ACTIVE`.
- **ACTIVE + Changed Evidence / Fingerprint Mismatch** → Transitions to `REVIEW_REQUIRED`. Sets `review_required_at = now`, `updated_at = now`. Records history event `"MAPPING_MARKED_REVIEW_REQUIRED"`.
- **ACTIVE + Deleted Line (`MISSING_LINE`)** → Transitions to `REVIEW_REQUIRED`. Sets `review_required_at = now`, `updated_at = now`. Records history event `"MAPPING_MARKED_REVIEW_REQUIRED"`.
- **Already `REVIEW_REQUIRED`** → Skipped. Filter `WHERE status = 'ACTIVE'` ignores it. Zero duplicate history entries.
- **`REVOKED`** → Permanently ignored.
- **Idempotency**: Enforced by `status = 'ACTIVE'` precondition in query and in `markMappingReviewRequired()`.

---

### 7. STALE SIGNALS (FINGERPRINT FIELDS)

- `item_id`: Triggers `REVIEW_REQUIRED`
- `item_name`: Triggers `REVIEW_REQUIRED`
- `description`: Triggers `REVIEW_REQUIRED`
- `quantity`: Triggers `REVIEW_REQUIRED`
- `rate`: Triggers `REVIEW_REQUIRED`
- `unit`: Triggers `REVIEW_REQUIRED`
- PO line deleted: Triggers `REVIEW_REQUIRED` (`MISSING_LINE`)
- SO line deleted: Triggers `REVIEW_REQUIRED` (`MISSING_LINE`)
- `fetched_at` only: Stays `ACTIVE` (excluded from fingerprint)
- `source_run_id` only: Stays `ACTIVE` (excluded from fingerprint)

---

### 8. SNAPSHOT SELECTION & SHARED-TABLE SAFETY

- `audit_zoho_sales_order_lines` and `audit_zoho_purchase_order_lines` have primary key `(organization_id, line_item_id, source_run_id)`.
- Approval Pending uses `source_run_id = "APPROVAL_PENDING_ACTIVE"`.
- Commercial Trace uses `source_run_id = "COMMERCIAL_TRACE_ACTIVE"`.
- In `manual-line-mapping-service.ts`, `getLocalSoLine` and `getLocalPoLine` query `WHERE organization_id = ? AND line_item_id = ? ORDER BY rowid DESC LIMIT 1`.
- **Recommendation for Claude**: In `getLocalSoLine` / `getLocalPoLine`, ensure the line query belongs to the newest coherent header snapshot (`ORDER BY fetched_at DESC LIMIT 1` on header table), matching `getLatestLines()` in `approval-pending-service.ts`. This guarantees that if a line was deleted in the newest snapshot, older snapshots from other runs do not mask the deletion.

---

### 9. VERIFICATION SEMANTICS & BOUNDARIES

- **Approval Pending verification results**: UNCHANGED. Manual mappings do NOT yet alter matching status in Phase-3.
- **Rate Guard**: UNCHANGED. Operates independently.
- **Zoho Write**: 0 (STRICT).
- **Zoho GET**: 0 additional (uses locally committed data).
- **AI Calls**: 0.
- **UI Modification**: None required. Phase-2 UI already reads and renders `REVIEW_REQUIRED` with Reconfirm/Revoke actions.

---

### 10. RECOMMENDED CLAUDE IMPLEMENTATION PLAN

**Target Files**:
1. `app/lib/audit/manual-line-mapping-service.ts`:
   - Add `validateActiveMappingsForDocuments(...)`.
   - Ensure `getLocalSoLine` and `getLocalPoLine` snapshot resolution aligns with latest document header.
2. `app/lib/audit/approval-pending-sync.ts`:
   - Call `validateActiveMappingsForDocuments` after commit in `syncApprovalPending()` and `syncApprovalPendingDocument()`.
3. `app/lib/audit/commercial-trace-sync-service.ts`:
   - Call `validateActiveMappingsForDocuments` after commit in `syncCommercialTrace()`.
4. `scripts/manual-line-mapping-phase3-tests.ts`:
   - Add dedicated 25-case acceptance test suite.
