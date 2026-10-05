import { assertConnectionAllowed } from '@/app/lib/external-connections.cjs';
// GET /api/zoho/connect
// Builds the Zoho OAuth authorization URL and redirects the user to it.
// All credentials are server-side only.
//
// Multi-DC note: We initiate auth from ZOHO_ACCOUNTS_URL (the console where
// the client was registered). Zoho returns `location` and `accounts-server`
// in the callback, which we use for the token exchange and all future API calls.

import { NextResponse } from "next/server";
import {
  APPROVED_ZOHO_READ_SCOPES,
  assertApprovedScopes,
} from "@/app/lib/zoho-security-guard";

export async function GET() {
  try { assertConnectionAllowed("zoho"); } catch { return NextResponse.json({ error: "Zoho app access disconnected. Enable it in Connections first." }, { status: 403 }); }
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;

  // ZOHO_ACCOUNTS_URL must match the Zoho console where the client was created.
  // e.g. https://accounts.zoho.com  (global/.com console)
  //      https://accounts.zoho.in   (India console)
  // No default — the app should fail clearly if this is not configured.
  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL;

  if (!clientId || !redirectUri || !accountsUrl) {
    return NextResponse.json(
      {
        error:
          "Missing required environment variables: ZOHO_CLIENT_ID, ZOHO_REDIRECT_URI, or ZOHO_ACCOUNTS_URL. " +
          "Please configure .env.local.",
      },
      { status: 500 }
    );
  }

  // Enforce scope lock: only approved read scopes
  assertApprovedScopes(APPROVED_ZOHO_READ_SCOPES);
  const scopeString = APPROVED_ZOHO_READ_SCOPES.join(",");

  // Generate a random cryptographically secure state for CSRF protection
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: scopeString,
    redirect_uri: redirectUri,
    access_type: "offline", // Required for refresh token
    state,
    prompt: "consent",
  });

  const authUrl = `${accountsUrl}/oauth/v2/auth?${params.toString()}`;

  // Log only the accounts server domain (never the client_id or any secret)
  console.log(
    `[ZohoConnect] Redirecting to Zoho auth. Accounts server: ${accountsUrl}`
  );

  const response = NextResponse.redirect(authUrl);

  // Set a secure, HttpOnly, short-lived cookie to validate state in callback
  response.cookies.set("zoho_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 15, // 15 minutes
    path: "/",
  });

  return response;
}
