import { NextRequest, NextResponse } from "next/server";
import { getCommercialTrace, getAllCommercialTraces } from "../../../lib/audit/commercial-trace-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const soNumber = searchParams.get("so_number");
    const customerId = searchParams.get("customer_id");
    const runId = searchParams.get("run_id") || undefined;

    if (!soNumber) {
      return NextResponse.json(
        { error: "so_number is required" },
        { status: 400 }
      );
    }

    let trace;
    if (soNumber === "ALL") {
      if (!customerId) {
        return NextResponse.json(
          { error: "customer_id is required when so_number is ALL" },
          { status: 400 }
        );
      }
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      const period = searchParams.get("period");
      trace = getAllCommercialTraces(customerId, runId, from, to, period);
    } else {
      trace = getCommercialTrace(soNumber, runId);
    }
    
    if (!trace) {
      return NextResponse.json(
        { error: `Data not found in local audit database.` },
        { status: 404 }
      );
    }

    return NextResponse.json(trace);
  } catch (error: any) {
    console.error("Commercial trace error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
