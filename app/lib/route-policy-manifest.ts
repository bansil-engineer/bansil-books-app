// ============================================================
// Bansil Books — OA-RBAC-2a API Route Policy Manifest
//
// SINGLE SOURCE OF TRUTH for the authorization class of every API route
// file (app/api/**/route.ts) and every exported HTTP method.
//
// Enforced by scripts/oa-rbac-2a-tests.ts (route coverage gate):
//   - every route file and exported method must have an entry here;
//   - "route-guard" entries must call guardRoute(policyFor(<key>, <METHOD>))
//     at the top of the handler;
//   - other enforcement kinds must be visible in the route source;
//   - PUBLIC is only allowed for paths listed in middleware PUBLIC_PATHS;
//   - no new write method may be added as "middleware-only".
//
// classification: PUBLIC | AUTHENTICATED | OWNER_ONLY | MODULE_RESTRICTED | SPECIAL_GOVERNANCE
// enforcement:    route-guard | owner-session | owner-session+jwt-role | custom-owner-session
//                 | auth-service | jwt-super-admin | middleware-only | public
// rbac2a:         HARDENED (guard added in 2a) | PRE_EXISTING (already server-checked)
//                 | PENDING_2B (Edge JWT only — not yet hardened) | GOVERNANCE_HOLD
//
// Do NOT classify an unknown route as PUBLIC to make tests pass.
// ============================================================

import type { AlternativeGrant, GuardPolicy, RouteAction, RouteClassification } from "./route-guard.ts";

export type Enforcement =
  | "route-guard"
  | "owner-session"
  | "owner-session+jwt-role"
  | "custom-owner-session"
  | "auth-service"
  | "jwt-super-admin"
  | "middleware-only"
  | "public";

export type Rbac2aStatus = "HARDENED" | "PRE_EXISTING" | "PENDING_2B" | "GOVERNANCE_HOLD";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface MethodPolicy {
  classification: RouteClassification;
  enforcement: Enforcement;
  rbac2a: Rbac2aStatus;
  module?: string;
  action?: RouteAction;
  /** Additional grants that also satisfy this route (e.g. the Dashboard's data sources). */
  alsoAllow?: readonly AlternativeGrant[];
  note: string;
  /** Open business-permission question for the Owner (deny-by-default until answered). */
  ownerDecision?: string;
}

export const ROUTE_POLICIES: Readonly<Record<string, Partial<Record<HttpMethod, MethodPolicy>>>> = {
  "action-taken": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "customers", action: "view", note: "[P0] Action Taken view (Sidebar: Customers)" },
    POST: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "customers", action: "edit", note: "Saves purchase-line action status (customers module, feature module_customers)" },
  },
  "activity": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "transactions", action: "view", note: "[P0] Zoho Activity log view (Sidebar: Transactions) — local read" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual Zoho activity sync (sync action)" },
  },
  "activity/backfill": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Zoho backfill job status (sync control)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual Zoho activity backfill (sync action)" },
  },
  "ai/agents/[id]/capabilities": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/agents/[id]/capabilities/grant": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Grants AI agent capabilities (privileged configuration)" },
  },
  "ai/agents/[id]/capabilities/revoke": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Revokes AI agent capabilities (privileged configuration)" },
  },
  "ai/approvals/[id]/approve": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "AI governance approval; records approved_by=OWNER" },
  },
  "ai/approvals/[id]/reject": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "AI governance rejection; records Owner decision" },
  },
  "ai/budget": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/capabilities": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/chat": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "AI CEO chat can invoke tools; stores Owner conversation", ownerDecision: "Whether employees may use the AI assistant (ai-assistant module)" },
  },
  "ai/conversation-bulk": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Bulk/permanent deletion of AI conversations (operational DB mutation)" },
  },
  "ai/conversations": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Reads the Owner's private AI conversations / guidance", ownerDecision: "Whether employees may read AI assistant history" },
  },
  "ai/conversations/[id]": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Reads the Owner's private AI conversations / guidance", ownerDecision: "Whether employees may read AI assistant history" },
  },
  "ai/conversations/[id]/impact": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Reads the Owner's private AI conversations / guidance", ownerDecision: "Whether employees may read AI assistant history" },
  },
  "ai/conversations/[id]/messages": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Reads the Owner's private AI conversations / guidance", ownerDecision: "Whether employees may read AI assistant history" },
  },
  "ai/conversations/[id]/state": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Bins/permanently deletes AI conversations (operational DB mutation)" },
  },
  "ai/data-sources": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/data-sources/[id]/status": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/data-sources/status": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/estimation/technical-equivalence": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "estimation", action: "view", note: "[P0] Technical Equivalence review list (Sidebar: Estimation)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Technical Equivalence write/AI action", ownerDecision: "Grant estimation:add/edit for Technical Equivalence?" },
  },
  "ai/memory": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Reads the Owner's private AI conversations / guidance", ownerDecision: "Whether employees may read AI assistant history" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Stores Owner guidance into AI memory" },
  },
  "ai/memory/[id]": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Reads the Owner's private AI conversations / guidance", ownerDecision: "Whether employees may read AI assistant history" },
  },
  "ai/runs/[id]": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/runs/[id]/cancel": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Controls AI execution runs" },
  },
  "ai/runs/[id]/resume": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Controls AI execution runs" },
  },
  "ai/runs/[id]/tasks": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/runs/latest": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/tools": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "ai/workforce": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] AI governance / AI workforce data", ownerDecision: "Which AI governance reads may employees see?" },
  },
  "audit/accounts-details": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/accounts-status": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/actions": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/actions/[actionId]": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/actions/[actionId]/transition": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/approval-pending": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/auth/change-passphrase": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/auth/login": {
    POST: { classification: "SPECIAL_GOVERNANCE", enforcement: "route-guard", rbac2a: "HARDENED", note: "Owner passphrase login: now also requires the Owner's own signed-in identity (stops non-Owner passphrase guessing); passphrase check unchanged" },
  },
  "audit/auth/logout": {
    POST: { classification: "AUTHENTICATED", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Ends the caller's own Owner audit session; live session required" },
  },
  "audit/auth/setup": {
    GET: { classification: "AUTHENTICATED", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Owner-gate bootstrap status booleans only (no business data). Was mis-listed as jwt-super-admin: only POST checks the role — found by FE4" },
    POST: { classification: "OWNER_ONLY", enforcement: "jwt-super-admin", rbac2a: "PRE_EXISTING", note: "Route checks JWT role super_admin" },
  },
  "audit/auth/status": {
    GET: { classification: "AUTHENTICATED", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Owner audit-session status probe (no business data); live session required" },
  },
  "audit/bank-reconciliation": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/bindings": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/bom/boms": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/bom/boms/[id]": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/bom/boms/[id]/disable": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/bom/coverage": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/cash": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/commercial-trace": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/commercial-trace/customers": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/commercial-trace/sales-orders": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/domain-reviews": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/events": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/evidence/stage": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/evidence/zoho-sync": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Zoho READ sync into audit evidence (sync action; Zoho write blocked separately)" },
  },
  "audit/findings": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/findings/[findingId]": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/findings/[findingId]/confirmation": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/findings/[findingId]/status": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/gst/5g2b/start": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/gst/5g2b/status": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/gst/5g2b/stop": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/gst/reconciliation/drilldown": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/invoice-line-mapping": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/invoice-line-mapping/candidates": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/invoice-line-mapping/history": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/invoice-line-mapping/reconfirm": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/invoice-line-mapping/revoke": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/learning/conflicts": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/conflicts/[conflictId]/resolve": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/overrides": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/proposals": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/proposals/[proposalId]": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/proposals/[proposalId]/examples": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/proposals/[proposalId]/test": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/proposals/[proposalId]/transition": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/unsupported-cases": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/learning/unsupported-cases/[caseId]/resolve": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/manual-line-mapping": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/manual-line-mapping/candidates": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/manual-line-mapping/history": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/manual-line-mapping/reconfirm": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/manual-line-mapping/revoke": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/mismatch-resolution/bulk-scan": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/mismatch-resolution/decision": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/mismatch-resolution/suggest": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/mismatch-resolution/v2/bulk-scan": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/mismatch-resolution/v2/decision": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/order-comparison": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Calls Zoho live (API quota / token refresh) — external connection usage", ownerDecision: "Which roles may trigger live Zoho reads" },
  },
  "audit/order-quantities": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Calls Zoho live (API quota / token refresh) — external connection usage", ownerDecision: "Which roles may trigger live Zoho reads" },
  },
  "audit/p0/alerts": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/p0/alerts/[id]": {
    PATCH: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit alert review decision" },
  },
  "audit/p0/dashboard": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/p0/sync": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/p0/sync-all": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/pre-audit/checkpoint-review": {
    PATCH: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Human review decision on audit checkpoint" },
  },
  "audit/pre-audit/decision": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/pre-audit/findings": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    PATCH: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit finding decision" },
  },
  "audit/pre-audit/run": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit workspace mutation; records Owner as actor" },
  },
  "audit/pre-audit/sync": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/reports": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/reports/[reportId]": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    PATCH: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/reports/[reportId]/export": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/runs/[runId]/groups/[groupId]/decision": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/runs/[runId]/groups/[groupId]/evidence": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/runs/[runId]/summary": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/section-sync": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/skills": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Settings → Skills (governance)" },
  },
  "audit/skills/[versionId]": {
    DELETE: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/skills/[versionId]/transition": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/skills/upload": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/source-summary": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/source-versions/[versionId]/approve-mapping": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/source-versions/[versionId]/completeness": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/source-versions/[versionId]/freeze": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/source-versions/[versionId]/mapping-preview": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/source-versions/[versionId]/raw-rows-preview": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/source-versions/[versionId]/rows": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/traceability/alerts": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/traceability/alerts/[id]": {
    PATCH: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Audit alert review decision" },
  },
  "audit/traceability/dashboard": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit read (Sidebar: Pre-Audit Verification / Reconciliation & Audit → audit module)" },
  },
  "audit/traceability/sync-all": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Manual sync / scan of audit data (sync action has no approved grant)" },
  },
  "audit/workspaces": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "audit", action: "view", note: "[P0] Audit workspace list. Pre-existing gap found by FE4: GET had only a feature-flag check (POST is Owner-session)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/workspaces/[workspaceId]/pin-skill": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/workspaces/[workspaceId]/runs": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/workspaces/[workspaceId]/sources": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/workspaces/[workspaceId]/sources/[sourceId]/upload": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/workspaces/[workspaceId]/sources/[sourceId]/versions": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "audit/workspaces/[workspaceId]/sources/[sourceId]/zoho-acquire": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session", rbac2a: "PRE_EXISTING", note: "Owner passphrase session (requireOwnerSession)" },
  },
  "auth/audit-log": {
    GET: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
  },
  "auth/change-password": {
    POST: { classification: "AUTHENTICATED", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store" },
  },
  "auth/invitations": {
    POST: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
    DELETE: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
  },
  "auth/invitations/accept": {
    POST: { classification: "PUBLIC", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Listed in middleware PUBLIC_PATHS" },
  },
  "auth/login": {
    POST: { classification: "PUBLIC", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Listed in middleware PUBLIC_PATHS" },
  },
  "auth/logout": {
    POST: { classification: "AUTHENTICATED", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store" },
  },
  "auth/me": {
    GET: { classification: "AUTHENTICATED", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store" },
  },
  "auth/status": {
    GET: { classification: "PUBLIC", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Listed in middleware PUBLIC_PATHS" },
  },
  "auth/users": {
    GET: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
    POST: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
    PATCH: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
    DELETE: { classification: "OWNER_ONLY", enforcement: "auth-service", rbac2a: "PRE_EXISTING", note: "Auth service: live session check in DB store; Owner-only management" },
  },
  "composite-assembly": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "reconciliation", action: "view", note: "[P0] Composite Assembly (Sidebar: Reconciliation)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Creates assembly drafts; createdBy is client-supplied", ownerDecision: "Grant reconciliation:add to employees? (createdBy should come from the session)" },
  },
  "connections": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "connections", action: "view", note: "[P0] Connection policy view (Settings → Connections & Permissions)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "External connection policy change (also local-host + same-origin gated)" },
  },
  "customer-details": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "customers", action: "view", note: "[P0] Customer details (locked module: guard added with Owner approval 2026-10-10)" },
  },
  "exclusions": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "exclusions", action: "view", note: "[P0] Exclusion rules list" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Financial review decision; approvedBy is client-supplied", ownerDecision: "Grant exclusions:add/edit to employees? (would need approver identity taken from the session)" },
    PATCH: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Financial review decision; approvedBy is client-supplied", ownerDecision: "Grant exclusions:edit to employees?" },
  },
  "export/excel": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Sensitive multi-module data export (GET serves the same report types as POST)", ownerDecision: "Which module permissions should authorize each export report type?" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Sensitive multi-module data export", ownerDecision: "Which module permissions should authorize each export report type?" },
  },
  "export/pdf": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Sensitive multi-module data export (GET serves the same report types as POST)", ownerDecision: "Which module permissions should authorize each export report type?" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Sensitive multi-module data export", ownerDecision: "Which module permissions should authorize each export report type?" },
  },
  "inventory-mismatch": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "inventory", action: "view", alsoAllow: [{"module": "dashboard", "action": "view", "allowQueryKeys": ["financialYear"]}], note: "[P0] Inventory mismatch report; also the Dashboard's data source" },
  },
  "master-audit-v2/coverage-review": {
    POST: { classification: "OWNER_ONLY", enforcement: "custom-owner-session", rbac2a: "GOVERNANCE_HOLD", note: "Master Audit V2 own Owner-session check; not modified (session-3 rule: do not touch Master Audit V2)" },
  },
  "master-audit-v2/discovery": {
    POST: { classification: "OWNER_ONLY", enforcement: "custom-owner-session", rbac2a: "GOVERNANCE_HOLD", note: "Master Audit V2 own Owner-session check; not modified (session-3 rule: do not touch Master Audit V2)" },
  },
  "master-audit-v2/sync": {
    POST: { classification: "OWNER_ONLY", enforcement: "custom-owner-session", rbac2a: "GOVERNANCE_HOLD", note: "Master Audit V2 own Owner-session check; not modified (session-3 rule: do not touch Master Audit V2)" },
  },
  "master-audit-v2/unlinked-bills": {
    POST: { classification: "OWNER_ONLY", enforcement: "custom-owner-session", rbac2a: "GOVERNANCE_HOLD", note: "Master Audit V2 own Owner-session check; not modified (session-3 rule: do not touch Master Audit V2)" },
  },
  "master-audit-v2/verification": {
    POST: { classification: "OWNER_ONLY", enforcement: "custom-owner-session", rbac2a: "GOVERNANCE_HOLD", note: "Master Audit V2 own Owner-session check; not modified (session-3 rule: do not touch Master Audit V2)" },
  },
  "orchestrator/[[...segments]]": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Orchestrator exposes task data and AI provider configuration status" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Orchestrator stores AI provider API keys and runs tasks" },
  },
  "price-reference": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "reports", action: "view", note: "[P0] Price Reference (Sidebar: Reports)" },
  },
  "reconciliation": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "reconciliation", action: "view", alsoAllow: [{"module": "dashboard", "action": "view", "allowQueryKeys": ["financialYear"]}], note: "[P0] Reconciliation report; also the Dashboard's data source" },
  },
  "reports/customer-material-control": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "reports", action: "view", note: "[P0] Customer Material Control (Sidebar: Reports)" },
    POST: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "reports", action: "edit", note: "Saves site action for customer material control (reports module, feature module_reports)" },
  },
  "search": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Universal search spans every module's data", ownerDecision: "Should employees get a module-filtered search?" },
  },
  "settings": {
    GET: { classification: "AUTHENTICATED", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] UI feature-flag booleans the app shell needs for every user (no accounting data)" },
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Feature settings write. Pre-existing gap found by FE4: Owner session was only required when a REGISTERED key was touched, so any logged-in user could write other keys (with a client-supplied updatedBy)" },
  },
  "stock": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "inventory", action: "view", note: "[P0] Inventory stock (locked module: guard added with Owner approval 2026-10-10)" },
  },
  "sync": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Sync status, logs, coverage and settings. Pre-existing gap found by the per-method gate (Q9): only POST had the C-1 Owner guard" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session+jwt-role", rbac2a: "PRE_EXISTING", note: "C-1 three-layer guard: JWT + super_admin role + Owner passphrase session" },
  },
  "sync/backfill": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Sync/backfill coverage status (sync control). Pre-existing gap found by FE4: GET had no check" },
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session+jwt-role", rbac2a: "PRE_EXISTING", note: "C-1 three-layer guard: JWT + super_admin role + Owner passphrase session" },
  },
  "sync/disconnect": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session+jwt-role", rbac2a: "PRE_EXISTING", note: "C-1 three-layer guard: JWT + super_admin role + Owner passphrase session" },
  },
  "tender-hub/access": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "tender-hub", action: "view", note: "[P0] Tender Hub access state (Sidebar: Estimation → Tender Hub)" },
  },
  "transactions": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "transactions", action: "view", alsoAllow: [{"module": "dashboard", "action": "view", "allowQueryKeys": ["financialYear"], "requireQuery": {"type": "recent"}}], note: "[P0] Transactions; Dashboard may read ONLY type=recent (recent bills/invoices panel)" },
  },
  "zoho/api-usage": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Calls Zoho live (API quota / token refresh) — external connection usage", ownerDecision: "Which roles may trigger live Zoho reads" },
  },
  "zoho/callback": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Completing OAuth replaces the stored Zoho connection: live Owner JWT (SameSite=Lax, survives Zoho's redirect) + single-use state cookie issued only by the passphrase-gated /api/zoho/connect. P0-SECURITY-FINAL (was PUBLIC)" },
  },
  "zoho/connect": {
    GET: { classification: "OWNER_ONLY", enforcement: "owner-session+jwt-role", rbac2a: "PRE_EXISTING", note: "C-1 three-layer guard: JWT + super_admin role + Owner passphrase session" },
  },
  "zoho/data": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Calls Zoho live (API quota / token refresh) — external connection usage", ownerDecision: "Which roles may trigger live Zoho reads" },
  },
  "zoho/disconnect": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session+jwt-role", rbac2a: "PRE_EXISTING", note: "C-1 three-layer guard: JWT + super_admin role + Owner passphrase session" },
  },
  "zoho/organizations": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Calls Zoho live (API quota / token refresh) — external connection usage", ownerDecision: "Which roles may trigger live Zoho reads" },
  },
  "zoho/refresh": {
    POST: { classification: "OWNER_ONLY", enforcement: "owner-session+jwt-role", rbac2a: "PRE_EXISTING", note: "C-1 three-layer guard: JWT + super_admin role + Owner passphrase session" },
  },
  "zoho/security": {
    GET: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "[P0] Zoho connection security posture" },
  },
  "zoho/select-org": {
    POST: { classification: "OWNER_ONLY", enforcement: "route-guard", rbac2a: "HARDENED", note: "Changes the Zoho organization used by all syncs (external connection control)" },
  },
  "zoho/status": {
    GET: { classification: "MODULE_RESTRICTED", enforcement: "route-guard", rbac2a: "HARDENED", module: "connections", action: "view", note: "[P0] Zoho connection status (org id, token expiry) — connections module" },
  },
};

const DENY_ALL: GuardPolicy = { classification: "OWNER_ONLY" };

/**
 * Policy used by guardRoute() inside a route handler. A missing or
 * non-route-guard entry fails CLOSED (Owner-only) — never open.
 */
export function policyFor(routeKey: string, method: string): GuardPolicy {
  const p = ROUTE_POLICIES[routeKey]?.[method.toUpperCase() as HttpMethod];
  if (!p || p.enforcement !== "route-guard") return DENY_ALL;
  return { classification: p.classification, module: p.module, action: p.action, alsoAllow: p.alsoAllow };
}
