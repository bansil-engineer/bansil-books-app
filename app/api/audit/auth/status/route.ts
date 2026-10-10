import { NextRequest, NextResponse } from "next/server";
import { isOwnerBootstrapped, isValidOwnerSession, isVercelSetupRequired, OWNER_SESSION_COOKIE } from "@/app/lib/audit/owner-auth";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/auth/status", "GET"), "audit/auth/status GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  return NextResponse.json({
    success: true,
    bootstrapped: isOwnerBootstrapped(),
    authenticated: isValidOwnerSession(token),
    // On Vercel without env-var credentials: tells the client to show
    // a setup-required message instead of the broken "set one-time" form.
    vercelSetupRequired: isVercelSetupRequired(),
  });
}
