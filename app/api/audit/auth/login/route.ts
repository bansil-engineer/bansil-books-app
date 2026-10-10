import { NextRequest, NextResponse } from "next/server";
import { attemptOwnerLogin, OWNER_SESSION_COOKIE } from "@/app/lib/audit/owner-auth";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/auth/login", "POST"), "audit/auth/login POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const body = await req.json();
    if (typeof body.passphrase !== "string") {
      return NextResponse.json({ success: false, error: "passphrase is required" }, { status: 400 });
    }

    const session = attemptOwnerLogin(body.passphrase);
    if (!session) {
      // Deliberately identical response whether the owner isn't bootstrapped
      // yet or the passphrase is simply wrong — never reveal which.
      return NextResponse.json({ success: false, error: "Invalid passphrase" }, { status: 401 });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set(OWNER_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return res;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Login failed" },
      { status: 500 }
    );
  }
}
