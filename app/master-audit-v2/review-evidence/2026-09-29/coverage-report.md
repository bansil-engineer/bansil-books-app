# Purchase/Bill Coverage — 29 September 2026

Checked at 2026-09-29T14:32:45.185Z. Bounded live review: 42 saved pilot PO detail GETs and 2 targeted Bill detail GETs. Zoho accounting writes: 0. V2 database writes: 0. Approval rows retained: 8.

## Result
All 42 live PO Bill-ID lists match the saved lists exactly. All referenced Bills are already saved. This proves parity for these saved POs only; it does not prove every PO or unlinked Bill for the SO exists in the pilot. Other 44 saved Bill payloads were not refreshed in this review.

| SO | POs | Live Bill references (unique) | POs without Bill references | Status |
|---|---:|---:|---:|---|
| SO-2627009 | 10 | 12 | 0 | 9 billed, 1 partially_billed |
| SO-2627024 | 23 | 26 | 8 | 12 billed, 3 partially_billed, 7 open, 1 approved |
| SO-2627065 | 9 | 8 | 3 | 5 billed, 1 partially_billed, 2 open, 1 pending_approval |

SO-2627065 includes the shared PO-2627230 and its Bill in the eight references above. Its exclusive-PO UI count is seven Bills; neither count authorizes assigning the shared Bill to this SO.

## Confirmed source rate differences (GST excluded)
| PO → Bill | PO subtotal | Bill subtotal | Difference |
|---|---:|---:|---:|
| PO-2627051 → 020/26-27 | 2,724,897.92 | 143,054.02 | 2,581,843.90 |
| PO-2627149 → 026/26-27 | 2,559,957.69 | 122,872.00 | 2,437,085.69 |

Both PO and Bill lines use the same item and direct PO-line ID. Ordered and billed quantity are both 1.00. The Bill rate differs from the PO rate. Both live POs say billed and both Bills say paid. Status does not establish rate agreement or final project-cost completeness. Do not add the PO difference to Bill cost or change accounting entries. Owner confirmed on 29 September 2026 that both Bills are interim Bills. Their amounts do not establish final cost coverage. Remaining billable amounts and final settlement still require supporting documents; the PO-minus-Bill difference is not automatically an expense or liability.

## POs with no live Bill reference
| SO | PO | Live status | PO subtotal, INR (commitment only) |
|---|---|---|---:|
| SO-2627024 | PO-2627126 | open | 700,380.00 |
| SO-2627024 | PO-2627143 | open | 40,500.00 |
| SO-2627024 | PO-2627188 | open | 218,000.00 |
| SO-2627024 | PO-2627191 | open | 159,665.00 |
| SO-2627024 | PO-2627196 | open | 538,000.00 |
| SO-2627065 | PO-2627227 | open | 221,415.00 |
| SO-2627024 | PO-2627247 | open | 4,320.00 |
| SO-2627065 | PO-2627248 | open | 630,000.00 |
| SO-2627024 | PO-2627249 | open | 963,029.56 |
| SO-2627065 | PO-2627288 | pending_approval | 84,220.70 |
| SO-2627024 | PO-2627296 | approved | 9,000.00 |

No Bill reference means recorded cost is unknown, not zero. These PO commitments are not added to the GP calculation.

## Remaining gates
- Invoice-minus-saved-Bills GP previews remain 82.21% (SO-2627009) and 12.39% (SO-2627024); these are not proof of final project margin.
- Complete PO universe and unlinked/vendor Bills remain unproven; no broad list traversal was performed.
- Owner confirmed both service Bills are interim. Final Bills/settlement evidence remain pending; do not infer the remaining expense or liability from PO value alone.
- Shared PO-2627230 allocation remains blocked; SO-2627065 invoice evidence also remains unresolved.
- No Owner verification was performed by the agent.
