# RELEASE TEST MATRIX — Bansil Books Analytics, Reconciliation & Audit Workspace (Milestones A–E)

All tests below run against isolated temp SQLite files with synthetic fixtures only — never the production `data/bansil_books.db` or the live `data/audit_workspace.db` (except the final browser walkthrough, which is backed up and cleaned up afterward per the established protocol).

## Test Suites

| Suite | File | Covers |
|---|---|---|
| Milestone A | `scripts/audit-workspace-tests.ts` | Workspace shell, Skills registry, owner auth |
| Milestone B | `scripts/audit-intake-parser-tests.ts`, `audit-intake-service-tests.ts` | Evidence intake, mapping, completeness, frozen snapshots |
| Milestone C | `scripts/audit-match-engine-tests.ts`, `audit-match-service-tests.ts` | Deterministic matching engine, allocation ledger, reviewer decisions |
| Milestone D | `scripts/audit-milestone-d-tests.ts` | Domain review, findings, action taken, reports, source register, field/section selectors, Excel/PDF |
| Milestone E | `scripts/audit-learning-tests.ts` | Learning proposal lifecycle, versioning, rollback, conflicts, expiry, overrides, unsupported cases |
| Security | `scripts/audit-red-team-tests.ts` | Injection resistance, self-approval resistance, forced-zero resistance, cross-tenant boundary, Zoho-write-surface absence, authorization surface |
| End-to-end | `scripts/audit-e2e-integration-test.ts` | Full synthetic Milestone A→E workflow in one continuous scenario |
| Migration | `scripts/audit-migration-tests.ts` | Fresh DB, v6→v7 upgrade, repeat-migration idempotency, backup/restore, immutability across reopen |
| Performance | `scripts/audit-performance-check.ts` | Measured timings (matching, report gen, Excel/PDF gen) on a synthetic 2000-row dataset |
| Project-wide feature controls | `scripts/project-feature-controls-tests.ts` | Central Feature Registry completeness, parent/child enforcement, shared-route gating |
| Audit feature controls | `scripts/audit-feature-controls-tests.ts` | Audit-module-specific feature-control logic |

## Results

Final retest run, executed sequentially after the live browser walkthrough and synthetic-residue cleanup (see `MILESTONE_E_HANDOFF.md` §14–16):

| Suite | Result |
|---|---|
| Milestone A (`audit-workspace-tests`) | PASS — 55/55 |
| Milestone B (`audit-intake-parser-tests`) | PASS — 15/15 |
| Milestone B (`audit-intake-service-tests`) | PASS — 27/27 |
| Milestone C (`audit-match-engine-tests`) | PASS — 16/16 |
| Milestone C (`audit-match-service-tests`) | PASS — 12/12 |
| Milestone D (`audit-milestone-d-tests`) | PASS — 59/59 |
| Milestone E (`audit-learning-tests`) | PASS — 43/43 |
| Security (`audit-red-team-tests`) | PASS — 15/15 |
| End-to-end (`audit-e2e-integration-test`) | PASS — 13/13 |
| Migration (`audit-migration-tests`) | PASS — 12/12 |
| Performance (`audit-performance-check`) | Measured (see MILESTONE_E_HANDOFF.md §8) |
| Project-wide feature controls | PASS — 16/16 |
| Audit feature controls | PASS — 12/12 |
| **Total (excl. performance measurement)** | **PASS — 295/295** |
| `npx tsc --noEmit` | PASS — clean, 0 errors |
| `npx eslint .` | PASS — 0 errors, 467 pre-existing-pattern warnings |
| `npm run build` | PASS — compiled successfully |

`audit-zoho-completeness-tests.ts` is known to fail under `tsx` due to a pre-existing, unrelated top-level-await/CJS transform incompatibility (confirmed present before any Milestone D or E change, via `git stash` comparison in the Milestone D pass) — excluded from this run, not masked.

This table reflects the final counts also delivered in the chat Final Report.
