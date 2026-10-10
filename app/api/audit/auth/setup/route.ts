import { NextRequest, NextResponse } from "next/server";
import {
  bootstrapOwnerPassphrase,
  isOwnerBootstrapped,
  isVercelSetupRequired,
  generateOwnerCredentialForEnv,
  OwnerAuthError,
} from "@/app/lib/audit/owner-auth";
import { verifyToken, AUTH_COOKIE_NAME } from "@/app/lib/auth";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

/**
 * Enforce super_admin role for the bootstrap/setup POST endpoint.
 * The middleware already checks JWT presence, but only super_admin
 * should be able to bootstrap the owner passphrase.
 */
function requireSuperAdmin(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }
  const payload = verifyToken(token);
  if (!payload || payload.role !== "super_admin") {
    return NextResponse.json(
      { success: false, error: "Only super_admin can configure the owner passphrase." },
      { status: 403 }
    );
  }
  return null;
}

// One-time bootstrap only. Refuses once a credential exists — see
// bootstrapOwnerPassphrase(); this route can never be used to silently
// take over an already-configured owner identity.
export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/auth/setup", "GET"), "audit/auth/setup GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  return NextResponse.json({
    success: true,
    bootstrapped: isOwnerBootstrapped(),
    // On Vercel: tells the client whether env vars need to be configured
    vercelSetupRequired: isVercelSetupRequired(),
  });
}

export async function POST(req: NextRequest) {
  // Only super_admin can bootstrap/generate owner credentials
  const denied = requireSuperAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    if (typeof body.passphrase !== "string") {
      return NextResponse.json({ success: false, error: "passphrase is required" }, { status: 400 });
    }

    // On Vercel with no env-var credentials: offer to generate the hash
    // so the super_admin can copy it to the Vercel dashboard. This never
    // stores the passphrase or hash — it only computes and returns them.
    if (IS_VERCEL && isVercelSetupRequired() && body.generateForEnv === true) {
      const cred = generateOwnerCredentialForEnv(body.passphrase);
      return NextResponse.json({
        success: true,
        envSetup: true,
        OWNER_PASSPHRASE_HASH: cred.hash,
        OWNER_PASSPHRASE_SALT: cred.salt,
      });
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
