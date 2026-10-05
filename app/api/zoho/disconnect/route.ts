// POST /api/zoho/disconnect
// Clears the token store, disconnecting from Zoho Books.

import { NextResponse } from "next/server";
import { clearTokenStore } from "@/app/lib/zoho-token-store";

export async function POST() {
  try {
    clearTokenStore();
    console.log("[API/disconnect] Token store cleared");
    return NextResponse.json({ success: true, message: "Disconnected from Zoho Books" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to disconnect";
    console.error("[API/disconnect]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
