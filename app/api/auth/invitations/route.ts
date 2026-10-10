// OA-U2 — Owner-only invitation / password-reset management (DB store only).
//
// POST   { email, purpose: "invite" | "reset" } → issue (or resend) a
//        single-use, time-limited link. The raw token is returned ONCE in
//        the response for out-of-band delivery (no email provider is
//        configured); only its SHA-256 hash is stored. Never logged.
// DELETE { email } → cancel all outstanding links for that user.

import { NextRequest, NextResponse } from "next/server";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbInvitationsDelete, dbInvitationsPost } from "../../../lib/auth-service.ts";

const notEnabled = () =>
  NextResponse.json(
    { error: "Invitations require the database user store (AUTH_USER_STORE=db)." },
    { status: 409 }
  );

export async function POST(request: NextRequest) {
  if (!isDbStore()) return notEnabled();
  return runDbHandler(request, dbInvitationsPost);
}

export async function DELETE(request: NextRequest) {
  if (!isDbStore()) return notEnabled();
  return runDbHandler(request, dbInvitationsDelete);
}
