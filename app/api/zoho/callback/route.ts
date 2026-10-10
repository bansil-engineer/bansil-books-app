// GET /api/zoho/callback
// Receives the OAuth callback from Zoho, exchanges code for tokens,
// stores them server-side, then redirects back to the home page.
//
// Multi-DC implementation:
//   1. Zoho returns `accounts-server` and `location` as query params in the callback.
//   2. We MUST use the `accounts-server` value to exchange the authorization code —
//      never the client's configured ZOHO_ACCOUNTS_URL. This is Zoho's authoritative
//      instruction for where this user's data center is.
//   3. The token response contains `api_domain` — this is the ONLY source of truth
//      for all subsequent Zoho Books API calls. We NEVER hardcode any api domain.
//   4. If `api_domain` is absent from the token response, we abort with a clear error.

import * as fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { writeTokenStore } from "@/app/lib/zoho-token-store";
import { isZohoAccountsHost, secureZohoFetch } from "@/app/lib/zoho-security-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

/** P0-SECURITY-FINAL: Zoho's accounts-server must be an official Zoho accounts origin. */
function isValidAccountsServer(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && isZohoAccountsHost(u.hostname) && !u.port && !u.username &&
      !u.password && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash;
  } catch {
    return false;
  }
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("zoho/callback", "GET"), "zoho/callback GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  // P0-SECURITY-FINAL: completing OAuth REPLACES the stored Zoho connection, so
  // only the live Owner may do it. The Owner passphrase cookie is SameSite=Strict
  // and is NOT sent on Zoho's cross-site redirect; the passphrase requirement is
  // inherited instead through the single-use, HttpOnly state cookie that only the
  // passphrase-gated /api/zoho/connect issues (checked below). Refusals never
  // touch the existing tokens.

  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  // These are returned by Zoho in the callback for multi-DC routing.
  // `accounts-server` is the authoritative token exchange endpoint for this user.
  // `location` is a short region code e.g. "com", "in", "eu", "au"
  const accountsServerParam = searchParams.get("accounts-server");
  const locationParam = searchParams.get("location");

  // Handle authorization denial
  if (errorParam) {
    const msg = encodeURIComponent(`Zoho authorization failed: ${errorParam}`);
    return NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
  }

  if (!code) {
    const msg = encodeURIComponent(
      "No authorization code received from Zoho."
    );
    return NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
  }

  // 1. State Validation for CSRF Protection
  const stateParam = searchParams.get("state");
  const expectedState = request.cookies.get("zoho_oauth_state")?.value;

  if (!stateParam || !expectedState || !sameState(stateParam, expectedState)) {
    const msg = encodeURIComponent("OAuth state validation failed. CSRF protection blocked the request.");
    const response = NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
    // Clear the stale cookie
    response.cookies.delete("zoho_oauth_state");
    return response;
  }

  // P0-SECURITY-FINAL: reject any accounts-server that is not an official Zoho accounts origin.
  if (accountsServerParam !== null && !isValidAccountsServer(accountsServerParam)) {
    const msg = encodeURIComponent("Zoho callback rejected: unexpected accounts-server.");
    const response = NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
    response.cookies.delete("zoho_oauth_state");
    return response;
  }

  // Determine the accounts server for token exchange:
  //   Priority 1 (always preferred): accounts-server returned by Zoho in this callback.
  //   Priority 2 (fallback only if Zoho did not return one): ZOHO_ACCOUNTS_URL env var.
  //   We do NOT hardcode any domain.
  const accountsUrl =
    accountsServerParam ||
    process.env.ZOHO_ACCOUNTS_URL;

  if (!accountsUrl) {
    const msg = encodeURIComponent(
      "Cannot determine Zoho accounts server. " +
      "Zoho did not return an accounts-server in the callback, " +
      "and ZOHO_ACCOUNTS_URL is not set in .env.local."
    );
    return NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
  }

  const clientId = process.env.ZOHO_CLIENT_ID!;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET!;
  const redirectUri = process.env.ZOHO_REDIRECT_URI!;

  if (!clientId || !clientSecret || !redirectUri) {
    const msg = encodeURIComponent(
      "Server configuration error: missing Zoho credentials in .env.local."
    );
    return NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
  }

  // Log only safe, non-secret values for debugging
  console.log(
    `[ZohoCallback] Received callback. ` +
    `accounts-server=${accountsServerParam ?? "(not returned)"}, ` +
    `location=${locationParam ?? "(not returned)"}`
  );

  try {
    // Exchange authorization code for tokens using the authoritative accounts server
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    console.log(`[ZohoCallback] Exchanging code at: ${accountsUrl}/oauth/v2/token`);

    const tokenRes = await secureZohoFetch(`${accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      throw new Error(
        `Token exchange failed: HTTP ${tokenRes.status} from ${accountsUrl}. ` +
        `Ensure your Client ID and Client Secret are correct, and that ` +
        `the Redirect URI in the Zoho API Console exactly matches your ZOHO_REDIRECT_URI.`
      );
    }

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      // Map Zoho error codes to human-readable messages
      const zohoErrorMessages: Record<string, string> = {
        invalid_client: "Invalid Client ID or Client Secret.",
        invalid_code: "Authorization code is invalid or already used.",
        invalid_redirect_uri: "Redirect URI does not match what is registered in Zoho API Console.",
        access_denied: "Authorization was denied by the user.",
      };
      const friendly = zohoErrorMessages[tokenData.error] ?? tokenData.error;
      throw new Error(`Zoho token error: ${friendly}`);
    }

    if (!tokenData.access_token || !tokenData.refresh_token) {
      throw new Error(
        "Zoho did not return both access_token and refresh_token. " +
        "Ensure 'offline' access_type was requested and Multi-DC support " +
        "is enabled in the Zoho API Console for your client. " +
        "A fresh long-lived authorization was not established."
      );
    }

    // api_domain is Zoho's authoritative instruction for which domain to use
    // for all Zoho Books API calls for this user's data center.
    // We REQUIRE it — never fall back to a hardcoded domain.
    const apiDomain = tokenData.api_domain as string | undefined;

    if (!apiDomain) {
      throw new Error(
        "Zoho did not return api_domain in the token response. " +
        "Ensure Multi-DC support is enabled for your OAuth client in the Zoho API Console " +
        "(API Console → your client → Settings → Multi-DC → Enable)."
      );
    }

    // Determine location: prefer the one from the callback param (most reliable),
    // then from the token response, then derive it from api_domain.
    const location =
      locationParam ||
      (tokenData.location as string | undefined) ||
      derivedLocationFromDomain(apiDomain);

    const expiresIn = tokenData.expires_in ?? 3600;

    // Store tokens server-side — NEVER expose any of these values to the browser
    writeTokenStore({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + expiresIn * 1000,
      api_domain: apiDomain,
      accounts_url: accountsUrl,
      location,
    });

    // Log safe info only
    const logLine = `[${new Date().toISOString()}] SUCCESS. code_present=${!!code}, state_present=${!!searchParams.get("state")}, location=${locationParam}, accounts_server=${accountsUrl}, access_token_present=${!!tokenData.access_token}, refresh_token_present=${!!tokenData.refresh_token}, api_domain=${apiDomain}\n`;
    fs.appendFileSync(path.join(process.cwd(), ".security-audit.log"), logLine);
    console.log(
      `[ZohoCallback] Tokens stored successfully. ` +
      `api_domain=${apiDomain}, location=${location}, ` +
      `token_expires_in=${expiresIn}s`
    );

    // Redirect back to main page — code, tokens, and secrets are NEVER in the URL
    const response = NextResponse.redirect(new URL("/?connected=true", request.url));
    response.cookies.delete("zoho_oauth_state");
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error during token exchange";
    const logLine = `[${new Date().toISOString()}] ERROR: ${message}. code_present=${!!code}, state_present=${!!searchParams.get("state")}\n`;
    fs.appendFileSync(path.join(process.cwd(), ".security-audit.log"), logLine);
    // Log full error server-side for debugging, but never log tokens or secrets
    console.error("[ZohoCallback] Token exchange error:", message);
    const msg = encodeURIComponent(message);
    const response = NextResponse.redirect(new URL(`/?error=${msg}`, request.url));
    response.cookies.delete("zoho_oauth_state"); // state is single-use
    return response;
  }
}

/**
 * Derives a short location code from the api_domain URL.
 * e.g. "https://www.zohoapis.in"  → "in"
 *      "https://www.zohoapis.com" → "com"
 *      "https://www.zohoapis.eu"  → "eu"
 * Falls back to "unknown" if the pattern doesn't match.
 */
function derivedLocationFromDomain(apiDomain: string): string {
  try {
    const host = new URL(apiDomain).hostname; // e.g. "www.zohoapis.in"
    const tld = host.split(".").pop(); // e.g. "in", "com", "eu"
    return tld ?? "unknown";
  } catch {
    return "unknown";
  }
}
