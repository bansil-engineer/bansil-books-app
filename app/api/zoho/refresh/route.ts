// POST /api/zoho/refresh
// Manually triggers an access token refresh.

import { NextResponse } from "next/server";
import { readTokenStore } from "@/app/lib/zoho-token-store";
import { refreshAccessToken } from "@/app/lib/zoho-api";

export async function POST() {
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
