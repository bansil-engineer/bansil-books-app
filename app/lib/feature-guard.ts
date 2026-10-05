// ============================================================
// Bansil Books Analytics — PROJECT-WIDE Server-side Feature Enforcement
//
// CRITICAL: this is the only place any route may declare itself
// "feature disabled". UI-only hiding is never sufficient — every route
// that has server_guard_required:true on its feature_key (see
// app/lib/feature-registry.ts) must call requireFeaturesEnabled() and
// return early on a non-null result, IN ADDITION TO (never instead of)
// any owner-session/auth check that route already has.
// ============================================================

import { NextResponse } from "next/server";
import { getFeatureSettings } from "./db/database.ts";
import { isFeatureEffectivelyEnabled, getFeatureDefinition } from "./feature-registry.ts";

function currentSettings(): Record<string, boolean> {
  return getFeatureSettings();
}

/**
 * Checks every key in `keys` (each independently walked up its own
 * registry parent chain). Returns a 403 NextResponse naming the first
 * disabled key, or null if all pass.
 */
export function requireFeaturesEnabled(...keys: string[]): NextResponse | null {
  const settings = currentSettings();
  for (const key of keys) {
    if (!isFeatureEffectivelyEnabled(key, settings)) {
      const def = getFeatureDefinition(key);
      return NextResponse.json(
        {
          success: false,
          error: `This action is disabled: "${def?.label ?? key}" (or a parent feature) is turned OFF in Settings > Modules & Features.`,
          featureKey: key,
        },
        { status: 403 }
      );
    }
  }
  return null;
}

/** Single-key convenience wrapper. */
export function requireFeatureEnabled(key: string): NextResponse | null {
  return requireFeaturesEnabled(key);
}

/** For non-route callers that need a plain boolean, not a NextResponse. */
export function featureEnabled(key: string): boolean {
  return isFeatureEffectivelyEnabled(key, currentSettings());
}

export function allFeatureSettings(): Record<string, boolean> {
  return currentSettings();
}
