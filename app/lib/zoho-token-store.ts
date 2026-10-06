// ============================================================
// Zoho Token Store — server-side only
// Dual-mode: filesystem (.tokens.json) for local development,
// environment-variable bootstrap for Vercel production.
// NEVER import this in client components.
// ============================================================

import fs from "fs";
import path from "path";
import type { ZohoTokenStore } from "@/app/types/zoho";

// ---- Environment detection ----

const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

// ---- Filesystem provider (local development) ----

const OPERATIONAL_TOKEN_FILE = path.join(process.cwd(), ".tokens.json");

/**
 * Resolve the token file path — FAIL-CLOSED design.
 *
 * NORMAL (NODE_ENV !== "test"): returns the operational .tokens.json.
 *
 * TEST (NODE_ENV === "test"):
 *   - BANSIL_TEST_ZOHO_TOKEN_FILE MUST be set → THROWS if missing.
 *   - The test path must NOT resolve to the operational file → THROWS if equal.
 *   - There is NO fallback from test mode to the operational file.
 *
 * SAFETY: Evaluated at call time (not module load), using path.resolve()
 * and path.normalize() to prevent relative-path bypass.
 *
 * R4 FIX: Prior design (R3) fell through to the operational file when
 * BANSIL_TEST_ZOHO_TOKEN_FILE was absent in test mode. This caused
 * incident: test fixture data overwrote the operational .tokens.json
 * when tests ran under ts-node CommonJS mode.
 */
function resolveTokenFilePath(): string {
  if (process.env.NODE_ENV === "test") {
    // FAIL-CLOSED: test mode REQUIRES an explicit isolated token path.
    // If BANSIL_TEST_ZOHO_TOKEN_FILE is not set, refuse to operate
    // rather than falling through to the operational file.
    const testPath = process.env.BANSIL_TEST_ZOHO_TOKEN_FILE;
    if (!testPath) {
      throw new Error(
        "[TokenStore] SAFETY ABORT: NODE_ENV=test but BANSIL_TEST_ZOHO_TOKEN_FILE " +
        "is not set. Test mode REQUIRES an explicit isolated token file path. " +
        "Set BANSIL_TEST_ZOHO_TOKEN_FILE to an os.tmpdir()-based path before " +
        "importing or calling any token store functions."
      );
    }
    // Hard safety: never allow test path to resolve to the operational file
    const resolvedTest = path.resolve(testPath);
    const resolvedOps = path.resolve(OPERATIONAL_TOKEN_FILE);
    if (resolvedTest === resolvedOps || path.normalize(testPath) === path.normalize(OPERATIONAL_TOKEN_FILE)) {
      throw new Error(
        "[TokenStore] SAFETY ABORT: Test token path resolves to the operational .tokens.json. " +
        "Set BANSIL_TEST_ZOHO_TOKEN_FILE to an isolated temporary path."
      );
    }
    return testPath;
  }
  return OPERATIONAL_TOKEN_FILE;
}

/**
 * Second safety barrier: explicitly reject writes/deletes to the operational
 * token file when in test mode, regardless of what resolveTokenFilePath returns.
 * This is defense-in-depth against any path resolution bypass.
 */
function assertNotOperationalInTestMode(resolvedPath: string): void {
  if (process.env.NODE_ENV === "test") {
    const normalizedResolved = path.resolve(resolvedPath);
    const normalizedOps = path.resolve(OPERATIONAL_TOKEN_FILE);
    if (normalizedResolved === normalizedOps) {
      throw new Error(
        "[TokenStore] SAFETY ABORT: Attempted to write/delete the operational " +
        ".tokens.json while in test mode. This is a test isolation violation."
      );
    }
  }
}


function readFromFile(): ZohoTokenStore | null {
  // Safety check OUTSIDE try/catch — its error must propagate immediately
  const filePath = resolveTokenFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ZohoTokenStore;
    if (!parsed.access_token || !parsed.refresh_token) {
      return null;
    }
    return parsed;
  } catch {
    console.error("[TokenStore] Failed to read token file");
    return null;
  }
}

function writeToFile(data: Partial<ZohoTokenStore>): void {
  // Safety checks OUTSIDE try/catch — their errors must propagate immediately
  const filePath = resolveTokenFilePath();
  assertNotOperationalInTestMode(filePath);
  try {
    const existing = readFromFile() ?? ({} as ZohoTokenStore);
    const updated: ZohoTokenStore = { ...existing, ...data } as ZohoTokenStore;
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    console.error("[TokenStore] Failed to write token file");
    throw new Error("Failed to save authentication tokens");
  }
}

function clearFile(): void {
  // Safety checks OUTSIDE try/catch — their errors must propagate immediately
  const filePath = resolveTokenFilePath();
  assertNotOperationalInTestMode(filePath);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    console.error("[TokenStore] Failed to clear token file");
  }
}

// ---- Environment-variable provider (Vercel production) ----
//
// Required Vercel env vars for Zoho token bootstrap:
//   ZOHO_REFRESH_TOKEN   — long-lived refresh token from initial OAuth
//   ZOHO_CLIENT_ID       — already exists
//   ZOHO_CLIENT_SECRET   — already exists
//   ZOHO_ACCOUNTS_URL    — already exists (e.g. https://accounts.zoho.com)
//   ZOHO_API_DOMAIN      — e.g. https://www.zohoapis.in
//   ZOHO_DEFAULT_ORG_ID  — already exists
//
// Optional:
//   ZOHO_LOCATION        — datacenter location (e.g. "in", "com")
//   ZOHO_ORG_NAME        — display name for the organization
//   ZOHO_CURRENCY_CODE   — e.g. "INR"
//   ZOHO_CURRENCY_SYMBOL — e.g. "₹"
//
// The access token is obtained at runtime via refresh and cached
// in-memory for the lifetime of the serverless function instance.

// In-memory cache for the current serverless invocation.
// Survives across requests within the same warm instance (~5–15 min).
let envTokenCache: ZohoTokenStore | null = null;

function readFromEnv(): ZohoTokenStore | null {
  // Return in-memory cache if it exists (handles refreshed access tokens)
  if (envTokenCache) {
    return envTokenCache;
  }

  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL;
  const apiDomain = process.env.ZOHO_API_DOMAIN;

  if (!refreshToken || !clientId || !accountsUrl || !apiDomain) {
    // Not enough env vars to bootstrap — Zoho not configured for production
    return null;
  }

  const store: ZohoTokenStore = {
    access_token: "",          // Will be obtained via refresh
    refresh_token: refreshToken,
    expires_at: 0,             // Forces immediate refresh on first use
    api_domain: apiDomain,
    accounts_url: accountsUrl,
    location: process.env.ZOHO_LOCATION || "com",
    organization_id: process.env.ZOHO_DEFAULT_ORG_ID,
    organization_name: process.env.ZOHO_ORG_NAME,
    currency_code: process.env.ZOHO_CURRENCY_CODE,
    currency_symbol: process.env.ZOHO_CURRENCY_SYMBOL,
  };

  envTokenCache = store;
  return store;
}

function writeToEnv(data: Partial<ZohoTokenStore>): void {
  // On Vercel, we can only cache in memory — no persistent writes.
  // This is sufficient: the access token lives ~1 hour and the warm
  // instance typically recycles within ~15 minutes. On cold start,
  // getValidAccessToken() in zoho-api.ts sees expires_at=0 and
  // refreshes automatically.
  const existing = envTokenCache ?? readFromEnv() ?? ({} as ZohoTokenStore);
  envTokenCache = { ...existing, ...data } as ZohoTokenStore;
}

function clearEnv(): void {
  envTokenCache = null;
}

// ---- Public API (unchanged signatures) ----

/**
 * Read the token store.
 * On local: reads from .tokens.json
 * On Vercel: bootstraps from env vars + in-memory cache
 */
export function readTokenStore(): ZohoTokenStore | null {
  if (IS_VERCEL) {
    return readFromEnv();
  }
  return readFromFile();
}

/**
 * Write to the token store.
 * On local: merges into .tokens.json
 * On Vercel: updates in-memory cache only
 */
export function writeTokenStore(data: Partial<ZohoTokenStore>): void {
  if (IS_VERCEL) {
    writeToEnv(data);
    return;
  }
  writeToFile(data);
}

/**
 * Delete the token store (disconnect).
 * On local: removes .tokens.json
 * On Vercel: clears in-memory cache
 */
export function clearTokenStore(): void {
  if (IS_VERCEL) {
    clearEnv();
    return;
  }
  clearFile();
}

/**
 * Check if a valid (non-expired) access token exists.
 * Considers token expired if within 5 minutes of expiry.
 */
export function isAccessTokenValid(store: ZohoTokenStore): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() < store.expires_at - bufferMs;
}

/**
 * Update only the access token fields after a refresh.
 */
export function updateAccessToken(
  accessToken: string,
  expiresInSeconds: number
): void {
  writeTokenStore({
    access_token: accessToken,
    expires_at: Date.now() + expiresInSeconds * 1000,
  });
}

/**
 * Update the selected organization in the token store.
 */
export function updateOrganization(
  organizationId: string,
  organizationName: string,
  currencyCode: string,
  currencySymbol: string
): void {
  writeTokenStore({
    organization_id: organizationId,
    organization_name: organizationName,
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
  });
}
