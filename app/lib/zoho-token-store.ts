// ============================================================
// Zoho Token Store — server-side only
// Stores tokens in .tokens.json in the project root.
// NEVER import this in client components.
// ============================================================

import fs from "fs";
import path from "path";
import type { ZohoTokenStore } from "@/app/types/zoho";

// Token file lives at project root, git-ignored
const TOKEN_FILE = path.join(process.cwd(), ".tokens.json");

/**
 * Read the token store from disk.
 * Returns null if file doesn't exist or is invalid.
 */
export function readTokenStore(): ZohoTokenStore | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ZohoTokenStore;
    // Basic validation
    if (!parsed.access_token || !parsed.refresh_token) {
      return null;
    }
    return parsed;
  } catch {
    // Don't log token content
    console.error("[TokenStore] Failed to read token file");
    return null;
  }
}

/**
 * Write the token store to disk.
 * Merges with existing data so partial updates are safe.
 */
export function writeTokenStore(data: Partial<ZohoTokenStore>): void {
  try {
    const existing = readTokenStore() ?? ({} as ZohoTokenStore);
    const updated: ZohoTokenStore = { ...existing, ...data } as ZohoTokenStore;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    console.error("[TokenStore] Failed to write token file");
    throw new Error("Failed to save authentication tokens");
  }
}

/**
 * Delete the token store (disconnect).
 */
export function clearTokenStore(): void {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch {
    console.error("[TokenStore] Failed to clear token file");
  }
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
