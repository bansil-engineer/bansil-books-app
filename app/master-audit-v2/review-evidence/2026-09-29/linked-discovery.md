# In-app linked-document discovery — 29 September 2026

Owner approved moving remaining linked-document discovery into the web app. SO Summary → Purchase coverage → Find linked documents now runs deterministic logic without an AI runtime or external script.

Behavior:
- Refresh selected saved pilot SO (FY2026–27 whitelist).
- Traverse the PO index, up to30 pages/200 rows; filter exact SO tokens in returned reference fields. Validate candidate PO detail ownership or explicit SO purchaseorder ID before publication.
- Refresh accepted saved/new PO details and acquire missing Bills only from their explicit Bill IDs.
- Search Invoice candidates by SO number and its current reference. New Invoice detail must match the same customer and either native SO linkage or exact customer reference without conflicting native SO linkage. Candidate relationships remain unverified.
- Reuse saved Bills/Invoices; use Refresh saved documents to refresh their amounts. No automatic approval or allocation.
- Bound each action to55 source GET requests and no new request starting after60 seconds; browser request timeout100 seconds. Request/validation failure or source race retains previous completed captures and reports PARTIAL. Never infer complete cost coverage.
- Central feature flag, Owner session, development-only, loopback/same-origin and strict body gates. No arbitrary remote IDs/endpoints accepted from the browser. Per-run lock; publication checks expected existing hash or expected absence for new documents. Rejected detail cannot be accidentally published later.

Live correction:
The first UI run (15 GETs, no new versions) showed Zoho ignored custom_field_contains and returned200 unfiltered POs with more pages. The app correctly reported PARTIAL. Replaced this unreliable search with paginated PO index traversal and added exact-token/pagination/budget tests.

Final Chrome verification:
| SO | PO index pages | GETs | Unchanged source documents | New/updated | Result |
|---|---:|---:|---:|---:|---|
| SO-2627009 | 5 | 18 | 11 | 0 / 0 | SEARCH_FINISHED |
| SO-2627065 | 5 | 17 | 10 | 0 / 0 | SEARCH_FINISHED |
| SO-2627024 | 5 | 31 | 24 | 0 / 0 | SEARCH_FINISHED |

All three bounded index traversals reached the final page; invoice searches finished within their limits. This is not proof of final commercial cost coverage or all unlinked vendor Bills. SO-2627065 Invoice evidence and shared PO allocation remain unresolved. No new documents were found in these runs.

Validation: 122/122 V2 tests,9/9 focused discovery tests and TypeScript typecheck pass. Tests include new-record acquisition, exact matching exclusions, duplicate suppression, partial results, stale/concurrent operations, time/request limits, HTTP guards, pagination and new-document publication races. Synthetic fixtures verify saving newly discovered documents; live records needed no new additions.

Live DB after verification:102 current documents,111 historical document versions,8 approval rows (unchanged). Discovery wrote source captures/run events only. Zoho accounting writes0; legacy database writes0; owner approvals0. No commit/push/deployment.

Independent review: Antigravity IDE, Independent Phase 0 Audit Review, returned ACCEPT for the final authoritative PO index correction (20:30, reaffirmed20:31). The review explicitly checked exact SO token filtering, pagination/stall protection, 55-request/60-second start limits, 122 passing tests, clean typecheck, and unchanged access/accounting boundaries. This is the technical review verdict; phase acceptance remains with the Owner.
