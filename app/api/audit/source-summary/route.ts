import { NextResponse } from "next/server";
import { getBooksSourceSummary } from "@/app/lib/audit/books-source-adapter";
import { requireAuditFeaturesEnabled } from "@/app/lib/audit/feature-guard";

export const dynamic = "force-dynamic";

// Read-only summary of existing Books data for the workspace source picker.
// No Zoho API calls happen here — this only reads the local, already-synced
// SQLite cache, and only on an explicit request to this route (never on an
// unrelated page's render).
export async function GET() {
  const disabled = requireAuditFeaturesEnabled("module_audit_workspace", "sub_audit_workspaces");
  if (disabled) return disabled;
  try {
    const summary = getBooksSourceSummary();
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load Books source summary" },
      { status: 500 }
    );
  }
}
