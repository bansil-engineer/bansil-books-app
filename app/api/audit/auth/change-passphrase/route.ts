import { NextRequest, NextResponse } from "next/server";
import { changeOwnerPassphrase, OwnerAuthError, OWNER_SESSION_COOKIE } from "@/app/lib/audit/owner-auth";
import { requireOwnerSession } from "@/app/lib/audit/api-guard";

export const dynamic = "force-dynamic";

// Requires an existing valid session AND the current passphrase (defense
// in depth). Invalidates every session on success, including this
// request's own cookie — the client must sign in again with the new
// passphrase.
export async function POST(req: NextRequest) {
  const denied = requireOwnerSession(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    if (typeof body.currentPassphrase !== "string" || typeof body.newPassphrase !== "string") {
      return NextResponse.json(
        { success: false, error: "currentPassphrase and newPassphrase are required" },
        { status: 400 }
      );
    }

    changeOwnerPassphrase(body.currentPassphrase, body.newPassphrase);

    const res = NextResponse.json({ success: true });
    res.cookies.delete(OWNER_SESSION_COOKIE);
    return res;
  } catch (error) {
    if (error instanceof OwnerAuthError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to change passphrase" },
      { status: 500 }
    );
  }
}
