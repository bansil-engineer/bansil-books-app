OWNER CLAUDE MANUAL SO-PO LINE MAPPING PHASE-3 R1 REPORT

BASELINE
========

HEAD:
c7de378eb45d54d164605886efda6da79de6dbeb (owner-stated; NOT independently verifiable — git root is outside the connected folder, git unavailable from this VM)

Branch:
feature/audit-workspace-milestone-a (owner-stated; not verifiable here)

Staged before:
0 by this session (no git command executed; index not readable from this VM)


SNAPSHOT SELECTION
==================

PO line lookup tied to newest coherent header snapshot:
PASS

SO line lookup tied to newest coherent header snapshot:
PASS

Older deleted PO line can be resurrected:
NO

Older deleted SO line can be resurrected:
NO

Notes: newest header per (organization_id, document id) by fetched_at DESC, rowid DESC;
line resolved ONLY within that header's source_run_id. Mutation check: disabling the
header branch makes tests 14/15 fail (2/45), confirming the guard is real.
Legacy compatibility: a document with NO header row at all in the org (line-only
fixture evidence) uses the Phase-1 line lookup; no newer coherent snapshot exists there.


VALIDATOR
=========

Function:
validateActiveMappingsForDocuments(db, { organizationId, purchaseorderIds?, salesorderIds? })
(app/lib/audit/manual-line-mapping-service.ts)

ACTIVE-only:
PASS

Organization scoped:
PASS

Document-ID scoped:
PASS

Full-table scan:
NO (empty ID sets → immediate no-op; two index-backed queries
org+purchaseorder_id IN / org+salesorder_id IN + status='ACTIVE', chunked 400; EXPLAIN shows USING INDEX)

Summary:
{ checked, stillValid, markedReviewRequired, missingLines, failed, error? }
markedReviewRequired includes missing-line transitions; missingLines is that subset.
Never throws; per-mapping transition is atomic (SAVEPOINT), status-preconditioned.


STALE TRANSITIONS
=================

PO item_id:
PASS

PO item_name:
PASS

PO description:
PASS

PO quantity:
PASS

PO rate:
PASS

PO unit:
PASS

SO item_id:
PASS

SO item_name:
PASS

SO description:
PASS

SO quantity:
PASS

SO rate:
PASS

SO unit:
PASS

PO line deletion:
PASS

SO line deletion:
PASS

fetched_at-only:
ACTIVE

source_run-only:
ACTIVE

(also: UOM NULL → Nos = REVIEW_REQUIRED; Nos → Job = REVIEW_REQUIRED; no conversion/alias)


HISTORY
=======

Event:
MAPPING_MARKED_REVIEW_REQUIRED (existing event; note "AUTO_STALE_VALIDATION: EVIDENCE_CHANGED|MISSING_LINE (SO|PO)")

First transition:
PASS (exactly one event, ACTIVE → REVIEW_REQUIRED, review_required_at + updated_at set)

Repeated validation duplicates history:
NO

REVIEW_REQUIRED auto-reconfirmed:
NO (evidence restored to original → remains REVIEW_REQUIRED; 0 RECONFIRMED events)

REVOKED evaluated:
NO


SYNC HOOKS
==========

Global Approval Pending:
PASS (scope = PO/SO docs in docsToWrite; identical re-run → checked 0)

Targeted PO:
PASS

Targeted PO referenced SO:
PASS

Targeted Invoice→SO:
PASS

Targeted Bill→PO:
PASS

Commercial Trace:
PASS

Validation occurs after source COMMIT:
YES (event-order instrumentation: COMMIT precedes first mapping query in all 6 hooks)

Network inside mapping-validation transaction:
NO

Additional Zoho GETs:
0 (exact call logs asserted; call log identical with vs. without mappings)


FAILURE CONTRACT
================

Source sync rolled back when validation fails:
NO

Source evidence preserved:
PASS (targeted PO, global AP, Commercial Trace — simulated failure via SQLite trigger)

Validation failed count:
PASS

Warning/error surfaced:
PASS (mappingValidation.failed / .error on result + console.warn)

False validation success prevented:
PASS (stillValid + markedReviewRequired < checked; mapping stays ACTIVE but isMappingUsable = false)

Known limitation (not changed — outside expected files): app/api/audit/section-sync/route.ts
forwards targetResult (incl. mappingValidation) for targeted sync, but for GLOBAL sync it
returns only syncState, so the global mappingValidation summary is not in the HTTP response
(service result + server warning only). Flagged for reviewer decision.


SEMANTICS
=========

Approval Pending matching precedence changed:
NO

Manual mapping became authoritative:
NO (getApprovalPendingDocuments output identical before/after a contradicting OWNER mapping)

Rate Guard changed:
NO

UI changed:
NO

Invoice manual mapping implemented:
NO


TESTS
=====

Phase-3:
45/45

Phase-1:
29/29

Phase-2:
20/20  (one fixture adjustment in T13 — see SCOPE)

Approval Pending:
12/12

Targeted Smart Sync:
test-targeted-smart-sync.ts FAIL — PRE-EXISTING (identical failure on pre-Phase-3 baseline file;
in-memory fixture schema lacks the `unit` column). Not repaired per §33.
Related maintained targeted suite targeted-invoice-so-sync-tests: 20/20.

Global Smart Sync:
test-smart-sync-approval-pending.ts 1/13 — PRE-EXISTING (baseline also 1/13; "no column named unit"
in hand-built schema). Not repaired. smart-sync-tests: 15/15.

Targeted Invoice→SO:
20/20

Invoice Reference:
19/19

UOM Consistency:
13/13

Commercial Trace UOM:
5/5

Commercial Trace Safety:
18/18

Rate Guard:
1/1

SO-PO Mapping:
43/43

Approval Snapshot:
6/6

Final:
32/32

Typecheck:
PASS (tsc --noEmit exit 0, 0 errors)

Build:
NOT RUN — ENVIRONMENT-BLOCKED (VM lacks linux/arm64 SWC binary; same as prior tasks). Needs owner Mac / Antigravity.

Task diff-check:
PASS (no trailing whitespace / conflict markers in added lines; files end with newline)


DB SAFETY
=========

Operational DB mutated by tests:
NO for Phase-3 (in-run dynamic sentinel — size+mtime+sha256 of audit_workspace.db/-wal/-shm — unchanged, checked twice).
Note: file hashes of data/audit_workspace.db and data/bansil_books.db changed during the broader mandated
regression run. Attributable to PRE-EXISTING suites that open operational DBs:
approval-snapshot-selection-tests (getAuditDatabase(), transaction + ROLLBACK),
smart-sync-tests and final-verification-gate (getDatabase() → bansil_books.db).

Temp DB only:
YES (Phase-3)

Logical sentinel unchanged:
PASS (Phase-3)


NETWORK / AI
============

Additional Zoho GETs:
0

Zoho writes:
0

AI calls:
0

ZOHO WRITE = 0:
YES


SCOPE
=====

Production files:
app/lib/audit/manual-line-mapping-service.ts  (sha256 c276d493…c3d)
app/lib/audit/approval-pending-sync.ts        (sha256 ad9ef10e…71ec)
app/lib/audit/commercial-trace-sync-service.ts (sha256 921df2ef…c3e4)

Test files:
scripts/manual-line-mapping-phase3-tests.ts (NEW, sha256 dad05099…f16f)
scripts/manual-line-mapping-phase2-tests.ts (MODIFIED fixture, +6/-1): T13 previously wrote an orphan
PO line into RUN_B with no RUN_B header — a state no real writer produces. Under the mandated coherent
snapshot rule (§6) that row belongs to no snapshot. Fixture now seeds the RUN_B header + full line set;
the assertion is unchanged.
(reuses existing scripts/ct-writer-safety-test-hooks.mjs unchanged)

Schema changed:
NO

UI changed:
NO

Invoice manual mapping touched:
NO

Unrelated production files:
0  (tsconfig.tsbuildinfo regenerated by typecheck — gitignored)


GIT
===

Staged after:
0 by this session (not independently readable from this VM)

Expected:
0

Commits:
0

Not Required accessed:
NO

Recovery preserved:
YES (pre-edit copies kept outside the repo in the VM scratch home)


TASK STATUS:
PASS — with two items deferred to Antigravity because this VM can't run them: build, and git HEAD/staged verification

NEXT ACTION:
RETURN TO CHATGPT FOR ANTIGRAVITY INDEPENDENT REVIEW

STOP.

DO NOT COMMIT.
DO NOT RUN LIVE SMART SYNC.
