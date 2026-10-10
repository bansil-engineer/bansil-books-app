// OA-U2 — Owner-only read of the user-management audit history (DB store only).
// Entries never contain credentials, hashes or raw tokens.

import { NextRequest, NextResponse } from "next/server";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbAuditGet } from "../../../lib/auth-service.ts";

export async function GET(request: NextRequest) {
  if (!isDbStore()) {
    return NextResponse.json(
      { error: "Audit history requires the database user store (AUTH_USER_STORE=db)." },
      { status: 409 }
    );
  }
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "200") || 200;
  return runDbHandler(request, (repo, ctx) => dbAuditGet(repo, ctx, limit), false);
}
