# Master Audit V2 — Phase 1 Evidence & Phase 2 GP Integration Report

**Date**: 2026-09-29  
**Status**: APPROVED & IMPLEMENTED  
**Scope**: In-app GP Engine Integration for Shared POs (`PO-2627230`) across `SO-2627065` and `SO-2627071`, Phase 1 Evidence Summary.

---

## 1. Phase 1 Evidence Summary

### 1.1 11 Unbilled Purchase Orders (8 on SO-2627024, 3 on SO-2627065)
- **SO-2627024 (8 POs)**:
  - `PO-2627126` (Entraco Power Systems Pvt Ltd, ₹7,00,380.00, open)
  - `PO-2627143` (West-Coast Enterprises, ₹40,500.00, open)
  - `PO-2627188` (Tulatrans Transmission, ₹2,18,000.00, open)
  - `PO-2627191` (Meet Power Technologies, ₹1,59,665.00, open)
  - `PO-2627196` (Ambica Engineering & Fabricators, ₹5,38,000.00, open)
  - `PO-2627247` (Source 360, ₹4,320.00, open)
  - `PO-2627249` (Meet Power Technologies, ₹9,63,029.56, open)
  - `PO-2627296` (Patco Transformers Pvt Ltd, ₹9,000.00, approved)
- **SO-2627065 (3 POs)**:
  - `PO-2627227` (Santok Enterprises, ₹2,21,415.00, open)
  - `PO-2627248` (Fairtronics Enterprise, ₹6,30,000.00, open)
  - `PO-2627288` (Smit Enterprise, ₹84,220.70, pending_approval)
- **Classification**: All 11 are open/approved commitments; none are marked `billed` in Zoho. Recorded cost is unknown, not zero.

### 1.2 30 KRISHNA ELECTRICAL Candidates Classification
- Analyzed from captured Zoho API response `9a90ee48-feae-4a64-8b50-9eed37bd1a03`:
  - 1 bill for `SO-2627009`: `020/26-27` (₹1,67,372.74, Interim).
  - 1 bill for `SO-2627024`: `026/26-27` (₹1,43,759.96, Interim).
  - 27 bills explicitly referencing other projects/POs (Rubamin, Torrecid, Styrenix, Radici, Nirchem, Kepler).
  - 1 bill referencing Rubamin site without explicit PO (`034/26-27`, unresolved, but unrelated to Siddhichem).
- **Proof**: The 30 candidate bills are verified not to contain missing bills for `SO-2627009`.

### 1.3 SO-2627065 Invoice Evidence
- Customer: Torrecid India Pvt Ltd (`3166667000014284766`), Ref `TCID8540`.
- SO payload has `invoices: []`. 0 Torrecid invoices exist in DB or returned from search.
- In-app GP remains blocked as designed until customer invoices are raised/captured.

### 1.4 Interim Bills Settlement (Bills 020/26-27 and 026/26-27)
- Both bills billed 1.00 of 1.00 ordered qty. No subsequent bills exist in Zoho Books.
- Commercial settlement remains unresolved; PO difference cannot be added as cost/liability without Owner confirmation.

---

## 2. Phase 2 Shared PO GP Implementation

### 2.1 Engine & UI Architecture
1. **Verification Model (`verification-model.ts`)**:
   - Accepts `reviews?: CoverageReviews`.
   - Filters `exclusiveBills` (bills that do NOT belong to any shared PO) and sums them at whole document subtotal.
   - For shared POs, verifies an active `ALLOCATED` review matching the current `data.snapshotId` exists.
   - Adds ONLY the allocated share (`parseDecimal(reviews['PO:' + sp.id].amounts[so.number])`) to total cost `c`.
   - Strictly prevents double-counting.
2. **PO Verification Rules (`po-verification.ts`)**:
   - `poProblem` accepts `reviews?: CoverageReviews`. Allows shared POs when an approved allocation matching the current snapshot exists.
   - `poReview` accepts `reviews?: CoverageReviews` and passes them to `verificationPreview`.
3. **Verification Store (`verification-store.ts`)**:
   - Reads `coverageReviews(db)` in `appendVerification`.
   - Validates allocated shared POs during `VERIFY_PO` and `VERIFY`.
   - Shared POs and their bills with active allocations are permitted across multiple SOs without triggering foreign SO collision checks.
4. **UI Panels (`verification-panel.tsx`, `pilot-view.tsx`)**:
   - `VerificationPanel` receives `coverageReviews` and displays allocated share for shared POs.
   - Enables `Verify PO` for shared POs once allocated.
   - `pilot-view.tsx` passes `coverageStates` to summary table for preview GP computation.

### 2.2 Test Results
- **TypeScript**: 0 errors (`tsc --noEmit` clean).
- **Unit Tests**: 133 tests passed across 19 suites (`duration_ms ~1139ms`).
- **New Unit Test**:
  - `shared PO with valid allocation enables GP calculation without double-counting, blocks when unallocated or stale` verifies:
    - Unallocated shared PO blocks GP and returns `'Shared PO ownership needs allocation'`.
    - Valid allocation calculates exact combined cost (exclusive bills + allocated share) without double-counting.
    - Snapshot change invalidates allocation and resets verification to `STALE`.
