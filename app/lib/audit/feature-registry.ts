// ============================================================
// Bansil Books Analytics — Reconciliation & Audit Feature Registry
// THIN RE-EXPORT of the project-wide central registry
// (app/lib/feature-registry.ts). Do not add audit-specific entries or
// logic here — the central registry is the single source of truth for
// every module, including "audit". This file exists only so existing
// imports (match-service.ts, SettingsModulesView.tsx, this milestone's
// test suites) keep working under their established path/names.
// ============================================================

import {
  FEATURE_REGISTRY,
  isFeatureEffectivelyEnabled,
  getFeatureDefinition,
  type FeatureDefinition,
  type ImplementationStatus,
} from "../feature-registry.ts";

export type { ImplementationStatus };
export type AuditFeatureDefinition = FeatureDefinition;

export const AUDIT_FEATURE_REGISTRY: FeatureDefinition[] = FEATURE_REGISTRY.filter((f) => f.module_key === "audit");

export const isAuditFeatureEffectivelyEnabled = isFeatureEffectivelyEnabled;
export const getAuditFeatureDefinition = getFeatureDefinition;
