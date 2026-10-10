// OA-U2 — PUBLIC endpoint: accept an invitation / reset link and set a
// password. Authenticated solely by the single-use token in the body
// (never in the URL — the /invite page reads it from the #fragment, which
// browsers do not send to the server, so it cannot appear in access logs).

import { NextRequest, NextResponse } from "next/server";
import { isDbStore, runDbHandler } from "../../../../lib/auth-guard.ts";
import { dbInvitationAccept } from "../../../../lib/auth-service.ts";

export async function POST(request: NextRequest) {
  if (!isDbStore()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return runDbHandler(request, dbInvitationAccept);
}
