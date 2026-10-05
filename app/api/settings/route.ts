import { NextRequest, NextResponse } from "next/server";
import { getDatabase, getFeatureSettings, updateFeatureSettings, updateFeatureSetting } from "@/app/lib/db/database";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";
import { getFeatureDefinition } from "@/app/lib/feature-registry";

export const dynamic = "force-dynamic";

// PROJECT-WIDE authorization rule: changing ANY feature_key that is
// registered in the central registry (app/lib/feature-registry.ts —
// every module, not only Reconciliation & Audit) requires the same
// OWNER session already mandatory for every privileged audit mutation.
// getFeatureDefinition() looks up the ONE central registry shared by
// every module, so this check is automatically project-wide with no
// per-module allowlist to maintain. A key that is NOT in the registry
// (e.g. the legacy numeric `sync_stale_warning_hours` config value,
// which nothing in this codebase actually reads) is deliberately left
// unauthenticated, exactly as it always was — this rule only ever adds
// a requirement, never removes the pre-existing open behavior for
// settings that were never part of a governed feature toggle.
function touchesRegisteredFeatureKey(body: { settings?: unknown; key?: unknown }): boolean {
  if (body.key && typeof body.key === "string") return getFeatureDefinition(body.key) !== undefined;
  if (body.settings && typeof body.settings === "object") {
    return Object.keys(body.settings as object).some((k) => getFeatureDefinition(k) !== undefined);
  }
  return false;
}

export async function GET() {
  try {
    const db = getDatabase();
    const settings = getFeatureSettings(db);
    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch feature settings",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (touchesRegisteredFeatureKey(body)) {
      const denied = await requireOwnerSession(req);
      if (denied) {
        return denied;
      }
    }

    const db = getDatabase();

    if (body.settings && typeof body.settings === "object") {
      const settingsObj = body.settings as Record<string, boolean>;
      for (const k of Object.keys(settingsObj)) {
        const def = getFeatureDefinition(k);
        if (def && def.server_guard_required) {
          return NextResponse.json(
            { success: false, error: `Feature '${def.label}' is a required/locked system feature and cannot be modified.` },
            { status: 403 }
          );
        }
      }
      updateFeatureSettings(db, settingsObj, body.updatedBy || "OWNER");
    } else if (body.key && typeof body.enabled === "boolean") {
      const def = getFeatureDefinition(body.key as string);
      if (def && def.server_guard_required) {
        return NextResponse.json(
          { success: false, error: `Feature '${def.label}' is a required/locked system feature and cannot be modified.` },
          { status: 403 }
        );
      }
      updateFeatureSetting(db, body.key, body.enabled, body.updatedBy || "OWNER");
    } else {
      return NextResponse.json(
        { success: false, error: "Invalid payload format. Expected { settings: Record<string, boolean> } or { key: string, enabled: boolean }" },
        { status: 400 }
      );
    }

    const updated = getFeatureSettings(db);
    return NextResponse.json({
      success: true,
      settings: updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update feature settings",
      },
      { status: 500 }
    );
  }
}
