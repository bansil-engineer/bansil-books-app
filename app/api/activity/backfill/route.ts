import { NextRequest, NextResponse } from "next/server";
import { runActivityBackfill, getActivityBackfillStatus } from "@/app/lib/zoho-activity-backfill-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/activity/backfill
 * LOCAL-ONLY status check for the durable month-wise Activity backfill job.
 * ZOHO API CALLS: 0.
 */
export async function GET() {
  try {
    const status = getActivityBackfillStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to read backfill status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/activity/backfill
 * Starts or resumes the durable month-wise historical Activity backfill.
 * Bounded to at most `maxRequests` external Zoho calls this invocation (default 50).
 * Strictly GET-only against Zoho. Zero writes.
 */
export async function POST(req: NextRequest) {
  const disabled = requireFeaturesEnabled("action_zoho_activity_backfill");
  if (disabled) return disabled;
  try {
    let body: { maxRequests?: number } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body acceptable — use defaults.
    }

    const result = await runActivityBackfill({
      maxRequests: typeof body.maxRequests === "number" ? body.maxRequests : undefined,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Activity backfill trigger failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
