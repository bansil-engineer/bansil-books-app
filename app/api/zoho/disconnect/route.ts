// POST /api/zoho/disconnect
// Clears the token store, disconnecting from Zoho Books.
//
// PRODUCTION vs LOCAL:
// On local dev, this deletes .tokens.json — a true permanent disconnect.
// On Vercel, env-var credentials are immutable deployment configuration:
// clearing the in-memory cache only lasts until the next cold start,
// when the env vars are re-read. The disconnect route is therefore
// disabled for env-managed production credentials — the admin must
// remove the ZOHO_REFRESH_TOKEN env var in the Vercel dashboard and
// redeploy to truly disconnect.

import { NextRequest, NextResponse } from "next/server";
import { clearTokenStore } from "@/app/lib/zoho-token-store";
import { requireOwnerSessionOrForbid } from "@/app/lib/audit/api-guard";

const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

export async function POST(request: NextRequest) {
  // C-1: Owner-only guard — disconnecting Zoho clears tokens.
  const denied = await requireOwnerSessionOrForbid(request);
  if (denied) return denied;
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
