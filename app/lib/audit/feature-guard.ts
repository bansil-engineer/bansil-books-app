// ============================================================
// Bansil Books Analytics — Reconciliation & Audit Feature Enforcement
// THIN RE-EXPORT of the project-wide guard (app/lib/feature-guard.ts).
// Kept so existing /api/audit/* route imports keep working unchanged.
// ============================================================

export {
  requireFeaturesEnabled as requireAuditFeaturesEnabled,
  requireFeatureEnabled as requireAuditFeatureEnabled,
  featureEnabled as auditFeatureEnabled,
  allFeatureSettings as allAuditSettings,
} from "../feature-guard.ts";
