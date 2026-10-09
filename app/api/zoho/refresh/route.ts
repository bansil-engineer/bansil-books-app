// POST /api/zoho/refresh
// Manually triggers an access token refresh.

import { NextRequest, NextResponse } from "next/server";
import { readTokenStore } from "@/app/lib/zoho-token-store";
import { refreshAccessToken } from "@/app/lib/zoho-api";
import { requireOwnerSessionOrForbid } from "@/app/lib/audit/api-guard";

export async function POST(request: NextRequest) {
  // C-1: Owner-only guard — manual token refresh is a privileged operation.
  const denied = await requireOwnerSessionOrForbid(request);
  if (denied) return denied;
  try {
    const store = readTokenStore();

    if (!store) {
      return NextResponse.json(
        { error: "Not connected. Please connect Zoho Books first." },
        { status: 401 }
      );
    }

    await refreshAccessToken(store);

    return NextResponse.json({ success: true, message: "Token refreshed successfully" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token refresh failed";
    console.error("[API/refresh]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
