import { NextResponse, NextRequest } from "next/server";
import {
  getDecisionOverview,
  saveRunDecision,
  getLastAcceptedDecision,
} from "../../../../lib/audit/pre-audit-decision-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit/pre-audit/decision?runId=...
 *
 * Returns:
 * - currentDecision: the OWNER decision for the specified run (null if none)
 * - lastAcceptedDecision: the most recent accepted baseline across all runs
 * - limitations: server-derived checkpoint limitations for this run
 * - summary: checkpoint counts (passed/failed/blocked/partial/etc.)
 * - hasLimitations: boolean
 * - isCurrentRunSuperseded: boolean (newer run exists after an accepted one)
 */
export async function GET(request: NextRequest) {
  try {
    const urlObj = new URL(request.url);
    const runId = urlObj.searchParams.get("runId");

    if (!runId) {
      return NextResponse.json(
        { error: "runId query parameter is required" },
        { status: 400 }
      );
    }

    const overview = getDecisionOverview(runId);

    // Organization isolation: return 403 when run ownership check fails
    if (overview.error) {
      return NextResponse.json(
        { error: overview.error },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      ...overview,
    });
  } catch (error: any) {
    console.error("GET Pre-Audit decision error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/audit/pre-audit/decision
 *
 * Body: { runId, decision, note? }
 *
 * Server independently derives:
 * - organization_id (from local DB)
 * - checkpoint summary
 * - limitations (from checkpoint results)
 *
 * Does NOT trust client-supplied limitations.
 *
 * Validation:
 * - run_id must exist
 * - decision must be valid enum
 * - plain ACCEPTED blocked when unresolved limitations exist
 * - ACCEPTED_WITH_LIMITATIONS requires limitations to exist
 *
 * Zoho writes: 0.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { runId, decision, note } = body;

    if (!runId) {
      return NextResponse.json(
        { error: "runId is required" },
        { status: 400 }
      );
    }

    if (!decision) {
      return NextResponse.json(
        { error: "decision is required" },
        { status: 400 }
      );
    }

    const result = saveRunDecision(runId, decision, note || null);

    if (!result.success) {
      // Organization isolation errors → 403; validation errors → 400
      const isOrgError =
        result.error?.includes("does not belong to the current organization") ||
        result.error?.includes("Run organization is unresolved") ||
        result.error?.includes("Data integrity issue");
      return NextResponse.json(
        { error: result.error },
        { status: isOrgError ? 403 : 400 }
      );
    }

    return NextResponse.json({
      success: true,
      decision: result.decision,
    });
  } catch (error: any) {
    console.error("POST Pre-Audit decision error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
