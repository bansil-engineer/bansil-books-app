import { connectionFetch } from './external-connections.cjs';
// ============================================================
// Zoho Read-Only Security Guard — Hardened Security Layer
// Enforces ABSOLUTE READ-ONLY access to Zoho Books.
// Zero authorization for write, mutation, or scope expansion.
// ============================================================

import fs from "fs";
import path from "path";

// ============================================================
// 1. Immutable Approved Scopes
// ============================================================
export const APPROVED_ZOHO_READ_SCOPES = Object.freeze([
  "ZohoBooks.settings.READ",
  "ZohoBooks.invoices.READ",
  "ZohoBooks.bills.READ",
  "ZohoBooks.reports.READ",
  "ZohoBooks.accountants.READ",
  "ZohoBooks.banking.READ",
  "ZohoBooks.customerpayments.READ",
  "ZohoBooks.vendorpayments.READ",
  "ZohoBooks.creditnotes.READ",
  "ZohoBooks.debitnotes.READ",
  "ZohoBooks.salesorders.READ",
  "ZohoBooks.purchaseorders.READ",
  "ZohoBooks.expenses.READ",
] as const);

export function assertApprovedScopes(scopes: readonly string[]): void {
  for (const s of scopes) {
    const upper = s.toUpperCase().trim();
    if (
      upper.includes(".ALL") ||
      upper.includes(".CREATE") ||
      upper.includes(".UPDATE") ||
      upper.includes(".DELETE") ||
      !upper.endsWith(".READ")
    ) {
      const msg = `SECURITY POLICY VIOLATION: Scope '${s}' contains write or unapproved permissions.`;
      logBlockedSecurityAttempt("OAUTH_SCOPE_CHECK", "SCOPE_VIOLATION", msg);
      throw new Error(msg);
    }
  }
}

// ============================================================
// Security Policy Status
// ============================================================
export const ZOHO_SECURITY_POLICY = {
  ACCESS_MODE: "READ ONLY",
  WRITE_ACCESS: "DISABLED",
  CREATE: "BLOCKED",
  UPDATE: "BLOCKED",
  DELETE: "BLOCKED",
  VOID: "BLOCKED",
  PAYMENT_WRITE: "BLOCKED",
  SOURCE_DATA_MODIFICATION: "BLOCKED",
  AI_DATA_SHARING: "DISABLED",
  LOCAL_DATABASE_WRITES: "ENABLED",
} as const;

export interface BlockedSecurityLogEntry {
  timestamp: string;
  method: string;
  sanitizedCategory: string;
  reason: string;
}

const SECURITY_LOG_FILE = path.join(process.cwd(), ".security-audit.log");

/**
 * Appends a blocked mutation attempt to the local runtime audit log.
 * Strictly avoids logging secrets, tokens, auth headers, or payloads.
 */
export function logBlockedSecurityAttempt(
  method: string,
  sanitizedCategory: string,
  reason: string
): void {
  try {
    const entry: BlockedSecurityLogEntry = {
      timestamp: new Date().toISOString(),
      method: (method || "UNKNOWN").toUpperCase(),
      sanitizedCategory,
      reason,
    };
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(SECURITY_LOG_FILE, line, "utf-8");
  } catch (err) {
    console.error("[SecurityGuard] Failed to write security log:", err);
  }
}

/**
 * Returns recent security audit log entries.
 */
export function getSecurityLogEntries(): BlockedSecurityLogEntry[] {
  try {
    if (!fs.existsSync(SECURITY_LOG_FILE)) return [];
    const content = fs.readFileSync(SECURITY_LOG_FILE, "utf-8");
    return content
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as BlockedSecurityLogEntry);
  } catch {
    return [];
  }
}

// Strict domain regex patterns preventing malicious subdomains/suffixes
const ZOHO_DOMAIN_REGEX =
  /^(?:[a-zA-Z0-9-]+\.)*(?:zoho|zohoapis)\.(com|in|eu|com\.au|jp|ca|uk)$/i;

const ZOHO_ACCOUNTS_REGEX =
  /^accounts\.zoho\.(com|in|eu|com\.au|jp|ca|uk)$/i;

/**
 * Strict parsed hostname validation.
 * Rejects suffix tricks like zoho.com.evil.example or evilzoho.com.
 */
export function isZohoHost(hostname: string): boolean {
  if (!hostname || typeof hostname !== "string") return false;
  const clean = hostname.trim().toLowerCase();
  return ZOHO_DOMAIN_REGEX.test(clean);
}

/**
 * Validates whether the host is an official Zoho Accounts host.
 */
export function isZohoAccountsHost(hostname: string): boolean {
  if (!hostname || typeof hostname !== "string") return false;
  const clean = hostname.trim().toLowerCase();
  return ZOHO_ACCOUNTS_REGEX.test(clean);
}

/**
 * Extracts and inspects headers for method override attempts.
 */
function hasMethodOverrideHeaders(headers?: HeadersInit | Headers): boolean {
  if (!headers) return false;
  const forbiddenHeaders = [
    "x-http-method-override",
    "x-method-override",
    "x-http-method",
    "_method",
  ];

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    for (const h of forbiddenHeaders) {
      if (headers.has(h)) return true;
    }
    return false;
  }

  if (Array.isArray(headers)) {
    for (const [key] of headers) {
      if (forbiddenHeaders.includes(key.toLowerCase())) return true;
    }
    return false;
  }

  if (typeof headers === "object") {
    for (const key of Object.keys(headers)) {
      if (forbiddenHeaders.includes(key.toLowerCase())) return true;
    }
  }

  return false;
}

/**
 * Centralized security guard:
 * Inspects target URL, Request objects, hostname, and HTTP method.
 *
 * ALLOWED:
 * - GET requests to Zoho Books API (/books/v3/*, /books/v4/*)
 * - POST requests ONLY to official Zoho Accounts OAuth token endpoint (/oauth/v2/token)
 *
 * BLOCKED:
 * - ANY POST, PUT, PATCH, DELETE, or other mutation to Zoho Books API.
 * - Method override headers (X-HTTP-Method-Override).
 * - Non-token POST endpoints on accounts.zoho.*.
 * - Malformed, un-normalized, or untrusted hostnames.
 */
export function assertZohoReadOnlyRequest(
  target: string | URL | Request,
  initOrMethod?: string | RequestInit,
  headers?: HeadersInit
): void {
  let rawUrl: string;
  let method = "GET";
  let checkHeaders: HeadersInit | Headers | undefined = headers;

  // Extract from Request object if provided
  if (typeof Request !== "undefined" && target instanceof Request) {
    rawUrl = target.url;
    method = target.method;
    checkHeaders = target.headers;
  } else if (typeof target === "string") {
    rawUrl = target;
  } else if (target instanceof URL) {
    rawUrl = target.href;
  } else if (typeof target === "object" && target !== null && "url" in target) {
    const reqObj = target as { url: string; method?: string; headers?: HeadersInit };
    rawUrl = reqObj.url;
    if (reqObj.method) method = reqObj.method;
    if (reqObj.headers) checkHeaders = reqObj.headers;
  } else {
    rawUrl = String(target);
  }

  // Check initOrMethod overrides
  if (typeof initOrMethod === "string") {
    method = initOrMethod;
  } else if (initOrMethod && typeof initOrMethod === "object") {
    if (initOrMethod.method) {
      method = initOrMethod.method;
    }
    if (initOrMethod.headers) {
      checkHeaders = initOrMethod.headers;
    }
  }

  const upperMethod = (method || "GET").toUpperCase().trim();

  // 1. Check for Method Override headers
  if (hasMethodOverrideHeaders(checkHeaders)) {
    const errorMsg =
      "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Method override headers (e.g. X-HTTP-Method-Override) are strictly prohibited";
    logBlockedSecurityAttempt(upperMethod, "METHOD_OVERRIDE_HEADER", errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Parse URL safely
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    const errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Invalid URL format";
    logBlockedSecurityAttempt(upperMethod, "INVALID_URL", errorMsg);
    throw new Error(errorMsg);
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 3. Inspect hostname with strict regex
  if (!isZohoHost(hostname)) {
    const errorMsg = `BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Untrusted non-Zoho host ${hostname}`;
    logBlockedSecurityAttempt(upperMethod, "UNTRUSTED_HOST", errorMsg);
    throw new Error(errorMsg);
  }

  // 4. Path normalization & decode protection
  let normalizedPath: string;
  try {
    const decoded = decodeURIComponent(parsedUrl.pathname);
    normalizedPath = path.posix.normalize(decoded).toLowerCase();
  } catch {
    const errorMsg = "BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Malformed or unparseable URL path";
    logBlockedSecurityAttempt(upperMethod, "MALFORMED_PATH", errorMsg);
    throw new Error(errorMsg);
  }

  // 5. Narrow OAuth POST Exception:
  // POST is permitted ONLY to legitimate /oauth/v2/token on accounts.zoho.*
  const isAccountsHost = isZohoAccountsHost(hostname);
  const isTokenEndpoint = normalizedPath === "/oauth/v2/token";

  if (isAccountsHost) {
    if (isTokenEndpoint) {
      if (upperMethod === "POST") {
        return; // Permitted ONLY for token exchange and refresh
      }
      const errorMsg = `BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: Method ${upperMethod} not allowed on OAuth token endpoint (POST only)`;
      logBlockedSecurityAttempt(upperMethod, "OAUTH_TOKEN_ENDPOINT", errorMsg);
      throw new Error(errorMsg);
    }

    // Any other accounts endpoint with mutation is blocked
    if (upperMethod !== "GET") {
      const errorMsg = `BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: ${upperMethod} is prohibited on Accounts endpoint ${normalizedPath}`;
      logBlockedSecurityAttempt(upperMethod, "ACCOUNTS_ENDPOINT", errorMsg);
      throw new Error(errorMsg);
    }
  }

  // 6. Zoho Books Service API Endpoints (/books/v3/*, /books/v4/*, etc.)
  const isBooksEndpoint =
    normalizedPath.includes("/books/") ||
    normalizedPath.startsWith("/books/v3") ||
    normalizedPath.startsWith("/books/v4");

  if (isBooksEndpoint) {
    if (upperMethod !== "GET") {
      const sanitizedCat = normalizedPath.includes("/invoices")
        ? "BOOKS_INVOICES"
        : normalizedPath.includes("/bills")
        ? "BOOKS_BILLS"
        : normalizedPath.includes("/payments")
        ? "BOOKS_PAYMENTS"
        : normalizedPath.includes("/contacts")
        ? "BOOKS_CONTACTS"
        : "BOOKS_API_MUTATION";

      const errorMsg = `BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: ${upperMethod} is strictly prohibited on Zoho Books API. Zoho Books access is READ-ONLY.`;
      logBlockedSecurityAttempt(upperMethod, sanitizedCat, errorMsg);
      throw new Error(errorMsg);
    }
    return; // GET on Books API is permitted
  }

  // 7. Any other Zoho endpoint: Allow only GET
  if (upperMethod !== "GET") {
    const errorMsg = `BLOCKED BY ZOHO READ-ONLY SECURITY POLICY: ${upperMethod} is prohibited on endpoint ${normalizedPath}`;
    logBlockedSecurityAttempt(upperMethod, "UNKNOWN_ZOHO_ENDPOINT", errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Secure wrapper around fetch for all Zoho requests.
 * - Passes request through assertZohoReadOnlyRequest before sending.
 * - Uses redirect: "manual" and validates redirect destinations to prevent redirect/SSRF bypass.
 */
export async function secureZohoFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  // 1. Validate initial request
  assertZohoReadOnlyRequest(input, init);

  // 2. Execute with redirect: "manual" to inspect any redirects
  const options: RequestInit = {
    ...init,
    redirect: "manual",
  };

  const response = await connectionFetch("zoho", input as RequestInfo, options);

  // 3. Validate redirects (301, 302, 303, 307, 308)
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has("location")
  ) {
    const location = response.headers.get("location")!;
    let currentUrl: string;
    if (typeof input === "string") currentUrl = input;
    else if (input instanceof URL) currentUrl = input.href;
    else currentUrl = input.url;

    const nextUrl = new URL(location, currentUrl);

    // Validate that the redirect destination is trusted and read-only
    assertZohoReadOnlyRequest(nextUrl, "GET");

    // Re-fetch next location safely
    return connectionFetch("zoho", nextUrl.href, {
      ...init,
      method: "GET",
      redirect: "manual",
    });
  }

  return response;
}
