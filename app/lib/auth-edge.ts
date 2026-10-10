// ============================================================
// Bansil Books — Edge-Compatible JWT Verification (Web Crypto)
//
// P0 SECURITY FIX: Provides HMAC-SHA256 signature verification
// for Next.js middleware running in Edge Runtime, where node:crypto
// is unavailable.
//
// Uses the Web Crypto API (crypto.subtle) which IS available in
// Edge Runtime. Produces identical verification results to the
// Node.js verifyToken() in auth.ts — same algorithm, same secret
// encoding, same JWT format, same expiration semantics.
//
// This file MUST NOT import from node:crypto or any Node-only module.
// ============================================================

/**
 * JWT payload shape — mirrors the interface in auth.ts.
 * Kept as a local copy to avoid importing from auth.ts which
 * pulls in node:crypto and would break Edge Runtime.
 */
export interface JWTPayload {
  sub: string;   // email
  name: string;
  role: string;
  modules: string[];
  iat: number;
  exp: number;
  sv?: number;   // OA-U2 DB store: session version (checked server-side in Node, not here)
  jti?: string;  // OA-U2 DB store: token id for revocation (checked server-side in Node)
}

// ---- CryptoKey cache ----
// Avoids re-importing the HMAC key on every request within
// the same Edge Runtime instance.
let _cachedKey: CryptoKey | null = null;
let _cachedSecretHash: string | null = null;

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET env var missing or too short (need >= 32 chars)"
    );
  }
  return s;
}

/**
 * Import AUTH_SECRET as an HMAC-SHA256 CryptoKey.
 * Cached per Edge Runtime instance; invalidated if the
 * secret value changes (supports env var rotation).
 */
async function getHmacKey(): Promise<CryptoKey> {
  const secret = getSecret();
  // Simple identity check — if secret string changed, re-import
  if (_cachedKey && _cachedSecretHash === secret) return _cachedKey;

  const keyData = new TextEncoder().encode(secret);
  _cachedKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,       // not extractable
    ["verify"],  // only need verify in middleware
  );
  _cachedSecretHash = secret;
  return _cachedKey;
}

/**
 * Decode a base64url string to Uint8Array.
 * Uses atob (available in Edge Runtime) with base64url → base64 conversion.
 */
function base64urlToBytes(s: string): Uint8Array {
  // Replace URL-safe characters with standard base64
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  const pad = b64.length % 4;
  if (pad === 2) b64 += "==";
  else if (pad === 3) b64 += "=";
  else if (pad === 1) throw new Error("Invalid base64url");

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify a JWT token using Web Crypto HMAC-SHA256.
 *
 * Returns the decoded payload on success, or null on ANY failure
 * (malformed, expired, bad signature, missing fields, etc.).
 *
 * FAIL CLOSED: every code path either returns a valid payload
 * or null. Exceptions are caught and return null.
 *
 * Compatible with tokens produced by createToken() in auth.ts:
 * - Same HMAC-SHA256 algorithm
 * - Same AUTH_SECRET (UTF-8 encoded as key material)
 * - Same base64url encoding
 * - Same header.payload signing input
 */
export async function verifyTokenEdge(
  token: string,
): Promise<JWTPayload | null> {
  try {
    // ---- Structure check ----
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [hdr, bdy, sig] = parts;
    if (!hdr || !bdy || !sig) return null;

    // ---- Header validation ----
    const hdrBytes = base64urlToBytes(hdr);
    const hdrStr = new TextDecoder().decode(hdrBytes);
    const hdrObj = JSON.parse(hdrStr);
    // Reject alg:none and any non-HS256 algorithm
    if (!hdrObj || hdrObj.alg !== "HS256") return null;

    // ---- Cryptographic signature verification ----
    const key = await getHmacKey();
    const signatureBytes = base64urlToBytes(sig);
    // The signed input is the ASCII/UTF-8 bytes of "header.payload"
    const dataBytes = new TextEncoder().encode(hdr + "." + bdy);

    // crypto.subtle.verify performs constant-time comparison internally
    const signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.buffer as ArrayBuffer,
      dataBytes.buffer as ArrayBuffer,
    );
    if (!signatureValid) return null;

    // ---- Payload decode (only after signature verified) ----
    const payloadBytes = base64urlToBytes(bdy);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as JWTPayload;

    // ---- Mandatory expiration check ----
    // Require exp to be present AND in the future.
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return null;

    // ---- Mandatory sub check ----
    if (typeof payload.sub !== "string") return null;

    return payload;
  } catch {
    // FAIL CLOSED: any exception → reject
    return null;
  }
}
