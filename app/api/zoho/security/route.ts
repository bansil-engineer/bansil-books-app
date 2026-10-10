// GET /api/zoho/security
// Returns the active Zoho Read-Only Security Policy status and audit metrics.
// Informational only — strictly NO write controls.

import { NextResponse } from "next/server";
import { ZOHO_SECURITY_POLICY, getSecurityLogEntries } from "@/app/lib/zoho-security-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("zoho/security", "GET"), "zoho/security GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const recentBlockedAttempts = getSecurityLogEntries().slice(-10);

  return NextResponse.json({
    policy: ZOHO_SECURITY_POLICY,
    scopes: {
      requested: [
        "ZohoBooks.settings.READ",
        "ZohoBooks.invoices.READ",
        "ZohoBooks.bills.READ",
        "ZohoBooks.reports.READ",
      ],
      writeScopesPresent: false,
    },
    httpGuards: {
      booksApiAllowedMethods: ["GET"],
      booksApiBlockedMethods: ["POST", "PUT", "PATCH", "DELETE"],
      oauthTokenAllowedMethods: ["POST (OAuth exchange/refresh only)"],
    },
    syncDirection: "ZOHO_TO_LOCAL_ONLY",
    reverseSync: "PROHIBITED",
    recentBlockedAttempts,
  });
}
