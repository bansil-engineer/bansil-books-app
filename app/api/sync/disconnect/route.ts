import { NextResponse } from "next/server";
import { clearTokenStore } from "@/app/lib/zoho-token-store";

export const dynamic = "force-dynamic";

const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

export async function POST() {
  try {
    // On Vercel with env-managed credentials: refuse to fake a disconnect
    if (IS_VERCEL && process.env.ZOHO_REFRESH_TOKEN) {
      return NextResponse.json(
        {
          success: false,
          error: "Production Zoho credentials are managed through Vercel environment variables. " +
                 "To disconnect, remove the ZOHO_REFRESH_TOKEN variable in the Vercel dashboard and redeploy.",
          envManaged: true,
        },
        { status: 409 }
      );
    }

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
