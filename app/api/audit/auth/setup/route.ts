import { NextRequest, NextResponse } from "next/server";
import { bootstrapOwnerPassphrase, isOwnerBootstrapped, OwnerAuthError } from "@/app/lib/audit/owner-auth";

export const dynamic = "force-dynamic";

// One-time bootstrap only. Refuses once a credential exists — see
// bootstrapOwnerPassphrase(); this route can never be used to silently
// take over an already-configured owner identity.
export async function GET() {
  return NextResponse.json({ success: true, bootstrapped: isOwnerBootstrapped() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body.passphrase !== "string") {
      return NextResponse.json({ success: false, error: "passphrase is required" }, { status: 400 });
    }
    bootstrapOwnerPassphrase(body.passphrase);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof OwnerAuthError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to set owner passphrase" },
      { status: 500 }
    );
  }
}
