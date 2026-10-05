# V2 in-app coverage and refresh — 29 September 2026

Owner request: routine operation must work as a web app without repeated AI intervention.

Implemented deterministic Purchase / Bill coverage on SO Summary. Each SO shows saved POs, unique referenced saved Bills, POs with no Bill references, missing Bill details, shared ownership and exact linked-item rate differences. Comparisons require unambiguous native line references, equal currencies/units and GST-exclusive tax basis. Uncomparable lines remain explicit. No report JSON, hardcoded SO findings, AI call or shell script is used by the feature.

Refresh saved documents builds a deduplicated queue for the selected saved SO, POs, Bills and Invoice candidates. Existing authenticated single-document sync endpoints run sequentially with updated snapshots. Each completed result immediately recalculates coverage/GP. Timeout/error stops the queue without retry; completed captures remain saved. Stop is honored after the current request. New PO/invoice discovery and fetching missing Bill IDs are NOT part of this bounded action, as explained on screen.

Central registry entry `sub_audit_v2_pilot` (parent `module_audit_workspace`, enabled by default for existing local pilot) gates page, sync and verification. The settings reader opens existing central settings read-only, with no legacy migrations or writes. Production still fails closed irrespective of the flag. OFF does not remove saved data. One narrow static-import exception allows the declarative central registry; no legacy DB service imports were added.

Validation:
- 113/113 V2 tests pass; typecheck passes.
- Local HTTP 200.
- Chrome: SO-2627009 refresh completed 31/31; GP remains 82.21%; rates drilldown works.
- Chrome: SO-2627024 displays 23 POs,26 saved referenced Bills,8 POs without references.
- Chrome: SO-2627065 displays 9 POs,8 saved referenced Bills,3 POs without references and explicit shared PO-2627230 allocation warning.
- Existing project feature-control suite: 12 pass,4 fail. Reproduced the same four failures against HEAD registry (missing accounts_audit/sidebar keys and existing missing audit parents); unrelated to this new entry. No changes made to those unrelated features.
- Browser refresh writes only V2 source captures/versions. Source documents remain102; versions103→111; approval history stays8. No Zoho accounting writes or owner approvals.

Not a final project margin or complete cost-coverage certification. Owner interim/final decisions are not inferred from rate differences. Production rollout and comprehensive discovery remain outside this change.

Independent Antigravity IDE review: ACCEPT — V2 Purchase Coverage & Central Feature Gates Verified. Reviewer independently inspected implementation and ran V2 tests/typecheck; no blocking findings. Owner phase acceptance remains separate.
