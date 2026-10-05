// ============================================================
// Bansil Books Analytics — API: Capabilities Registry
// ============================================================

import { NextResponse } from "next/server";
import { listCapabilities, getRoleCapabilityTemplates } from "@/app/lib/ai/ceo/capability-registry";

export async function GET() {
  try {
    const capabilities = listCapabilities();
    const templates = getRoleCapabilityTemplates();
    return NextResponse.json({
      success: true,
      count: capabilities.length,
      capabilities,
      roleTemplates: templates,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
