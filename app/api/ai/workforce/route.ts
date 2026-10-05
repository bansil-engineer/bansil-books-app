import { NextResponse } from "next/server";
import { getWorkforceOverview } from "@/app/lib/ai/ceo/workforce-manager";

export async function GET() {
  try {
    const overview = getWorkforceOverview();
    return NextResponse.json(overview);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
