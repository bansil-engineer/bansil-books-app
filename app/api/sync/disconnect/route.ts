import { NextResponse } from "next/server";
import { clearTokenStore } from "@/app/lib/zoho-token-store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Clear local token store file safely without deleting SQLite cache or calling remote Zoho endpoints
    clearTokenStore();
    return NextResponse.json({
      success: true,
      connected: false,
      message: "Offline — viewing last synchronized local data.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to disconnect local session",
      },
      { status: 500 }
    );
  }
}
