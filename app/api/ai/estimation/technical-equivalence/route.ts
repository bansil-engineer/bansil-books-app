// ============================================================
// Phase 4E-UI: Technical Equivalence Review — Read-Only API
//
// POST /api/ai/estimation/technical-equivalence
//
// Accepts BOQ line(s) and rate evidence, runs the deterministic
// Phase 4E engine, returns technical equivalence results.
//
// Safety:
//   - Read-only: NO DB mutation, NO external writes, NO external AI
//   - POST used because inputs are structured comparison payloads
//     (not safe to encode as URL query params)
//   - Pure local computation — no network dependency
//   - Returns Phase 4E results only; no costing-phase logic
//   - EXTERNAL WRITE = 0
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  assessTechnicalEquivalence,
  assessBoqLineEquivalence,
  TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
} from "@/app/lib/ai/estimation/technical-equivalence-engine";
import type { RateEvidenceRecord, BoqLineRateInput, UomAliasRule } from "@/app/lib/ai/estimation/rate-types";
import type {
  TechnicalEquivalenceResult,
  BoqLineTechnicalEquivalenceResult,
} from "@/app/lib/ai/estimation/technical-equivalence-types";

interface SingleComparisonRequest {
  mode: "single";
  boqLine: BoqLineRateInput;
  evidence: RateEvidenceRecord;
  uomAliases?: UomAliasRule[];
}

interface BatchComparisonRequest {
  mode: "batch";
  boqLine: BoqLineRateInput;
  evidenceRecords: RateEvidenceRecord[];
  uomAliases?: UomAliasRule[];
}

type ComparisonRequest = SingleComparisonRequest | BatchComparisonRequest;

interface SingleComparisonResponse {
  mode: "single";
  result: TechnicalEquivalenceResult;
  engineVersion: string;
}

interface BatchComparisonResponse {
  mode: "batch";
  result: BoqLineTechnicalEquivalenceResult;
  engineVersion: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: ComparisonRequest = await request.json();

    if (!body || !body.mode) {
      return NextResponse.json(
        { error: "Missing required field: mode (single | batch)" },
        { status: 400 },
      );
    }

    if (body.mode === "single") {
      if (!body.boqLine || !body.evidence) {
        return NextResponse.json(
          { error: "Single mode requires boqLine and evidence" },
          { status: 400 },
        );
      }

      const result = assessTechnicalEquivalence(
        body.evidence,
        body.boqLine,
        body.uomAliases ?? [],
      );

      const response: SingleComparisonResponse = {
        mode: "single",
        result,
        engineVersion: TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
      };

      return NextResponse.json(response);
    }

    if (body.mode === "batch") {
      if (!body.boqLine || !body.evidenceRecords) {
        return NextResponse.json(
          { error: "Batch mode requires boqLine and evidenceRecords" },
          { status: 400 },
        );
      }

      const result = assessBoqLineEquivalence(
        body.boqLine,
        body.evidenceRecords,
        body.uomAliases ?? [],
      );

      const response: BatchComparisonResponse = {
        mode: "batch",
        result,
        engineVersion: TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
      };

      return NextResponse.json(response);
    }

    return NextResponse.json(
      { error: `Unknown mode: ${(body as any).mode}. Use "single" or "batch".` },
      { status: 400 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: "/api/ai/estimation/technical-equivalence",
    engineVersion: TECHNICAL_EQUIVALENCE_ENGINE_VERSION,
    modes: ["single", "batch"],
    description: "Read-only technical equivalence assessment. No DB mutation. No Zoho write. No external AI.",
    externalWrite: 0,
  });
}
