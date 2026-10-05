// ============================================================
// Bansil Books Analytics — Controlled Learning: Shared Types (Milestone E)
// Default behavior is SUGGEST_ONLY. A user correction never automatically
// becomes a reusable rule — every status transition below is an explicit,
// recorded, OWNER-authorized action (see learning-service.ts / api-guard.ts).
// ============================================================

/** Explicitly governed learning categories only. Never a category that would
 * require inferring tax law, accounting treatment, GST classification,
 * statutory compliance, journal treatment, or financial-policy override
 * from a single correction — those are permanently out of scope. */
export const LEARNING_PROPOSAL_TYPES = [
  "STATEMENT_FORMAT_MAPPING",
  "PARTY_ALIAS",
  "DOCUMENT_REFERENCE_NORMALIZATION",
  "DATE_FORMAT_INTERPRETATION",
  "SIGN_PERSPECTIVE_RULE",
  "SOURCE_COLUMN_MAPPING",
  "TIMING_WINDOW_RULE",
  "DEDUCTION_EVIDENCE_PATTERN",
  "UNIT_NORMALIZATION",
  "REVIEW_CLASSIFICATION_RULE",
  "PARSING_CORRECTION",
  "IGNORE_HEADER_FOOTER_RULE",
] as const;
export type LearningProposalType = (typeof LEARNING_PROPOSAL_TYPES)[number];

/** GLOBAL is deliberately last / hardest to reach — see requireOwnerSession
 * + the extra confirmation gate enforced in learning-service.ts for it. */
export const SCOPE_TYPES = [
  "PARTY",
  "CUSTOMER",
  "VENDOR",
  "SOURCE_FORMAT",
  "SOURCE_TYPE",
  "WORKSPACE",
  "DATE_RANGE",
  "ENTITY",
  "MODULE",
  "GLOBAL",
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const PROPOSAL_STATUSES = [
  "DRAFT",
  "TESTING",
  "PENDING_APPROVAL",
  "ACTIVE",
  "DISABLED",
  "EXPIRED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const EXAMPLE_TYPES = ["POSITIVE", "NEGATIVE", "HARD_NEGATIVE"] as const;
export type ExampleType = (typeof EXAMPLE_TYPES)[number];

export const UNSUPPORTED_CASE_STATUSES = ["OPEN", "HOLD", "EVIDENCE_REQUESTED", "OVERRIDE_APPLIED", "RULE_PROPOSED", "RESOLVED"] as const;
export type UnsupportedCaseStatus = (typeof UNSUPPORTED_CASE_STATUSES)[number];

export const UNSUPPORTED_CASE_RESOLUTIONS = ["HOLD", "REQUEST_EVIDENCE", "ONE_TIME_OVERRIDE", "PROPOSE_RULE"] as const;
export type UnsupportedCaseResolution = (typeof UNSUPPORTED_CASE_RESOLUTIONS)[number];

export const CONFLICT_TYPES = [
  "SAME_SCOPE_SAME_RULE_KEY_DIFFERENT_CONFIG",
  "OVERLAPPING_SCOPE",
  "OVERLAPPING_DATE_RANGE",
  "GLOBAL_VS_SCOPED",
  "SIGN_PERSPECTIVE_DISAGREEMENT",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

/** A declarative match specification only — never executable code. The
 * evaluator (rule-evaluator.ts) interprets this data; nothing here is ever
 * eval()'d, spawned as a process, or sent to an external service. */
export interface RuleConfig {
  matchField: string;
  /** A plain equality string, or "regex:<pattern>" for a JS RegExp test — still pure data, never executed as code beyond RegExp matching. */
  matchPattern: string;
  caseSensitive?: boolean;
}

export interface RuleExampleInput {
  [field: string]: unknown;
}
