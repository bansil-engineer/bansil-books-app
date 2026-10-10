import { NextRequest, NextResponse } from "next/server";
import { destroyOwnerSession, OWNER_SESSION_COOKIE } from "@/app/lib/audit/owner-auth";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/auth/logout", "POST"), "audit/auth/logout POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  destroyOwnerSession(token);
  const res = NextResponse.json({ success: true });
  res.cookies.delete(OWNER_SESSION_COOKIE);
  return res;
}
