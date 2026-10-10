import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

const SCRYPT_KEY_LEN = 64;

// ---- Password Hashing (scrypt — same algo as existing owner-auth) ----

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEY_LEN).toString("hex");
}

export function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): boolean {
  const computed = scryptSync(password, salt, SCRYPT_KEY_LEN);
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

// ---- Minimal JWT (HMAC-SHA256 — no npm dependency) ----

function b64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}

export interface JWTPayload {
  sub: string; // email
  name: string;
  role: string;
  modules: string[];
  iat: number;
  exp: number;
  /** OA-U2 (DB store only): session version — must equal auth_users.session_version. */
  sv?: number;
  /** OA-U2 (DB store only): unique token id for per-token revocation (logout). */
  jti?: string;
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32)
    throw new Error("AUTH_SECRET env var missing or too short (need >= 32 chars)");
  return s;
}

export function createToken(
  user: { email: string; name: string; role: string; modules: string[] },
  ttlHours = 24,
  extraClaims?: { sv: number; jti: string }
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: user.email,
    name: user.name,
    role: user.role,
    modules: user.modules,
    iat: now,
    exp: now + ttlHours * 3600,
    // Only DB-store tokens carry sv/jti; env-store tokens are unchanged.
    ...(extraClaims ? { sv: extraClaims.sv, jti: extraClaims.jti } : {}),
  };
  const hdr = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const bdy = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", getSecret())
    .update(hdr + "." + bdy)
    .digest("base64url");
  return hdr + "." + bdy + "." + sig;
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [hdr, bdy, sig] = parts;
    const expected = createHmac("sha256", getSecret())
      .update(hdr + "." + bdy)
      .digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf))
      return null;
    const payload = JSON.parse(b64urlDecode(bdy)) as JWTPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- User Store (JSON in AUTH_USERS env var) ----

export interface AuthUser {
  email: string;
  name: string;
  role: "super_admin" | "admin" | "viewer";
  salt: string;
  hash: string;
  modules: string[];
}

export function getAllUsers(): AuthUser[] {
  const raw = process.env.AUTH_USERS;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function findUser(email: string): AuthUser | undefined {
  return getAllUsers().find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
}

export function authenticate(
  email: string,
  password: string
): AuthUser | null {
  const user = findUser(email);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  return user;
}

// ---- Constants ----

export const AUTH_COOKIE_NAME = "bansil_auth";

export const ALL_MODULES = [
  "dashboard",
  "reconciliation",
  "exclusions",
  "inventory",
  "transactions",
  "services",
  "customers",
  "reports",
  "estimation",
  "ai-assistant",
  "settings",
  "audit",
  "tender-hub",
  "connections",
] as const;

export type ModuleId = (typeof ALL_MODULES)[number];



// ---- Function-level Access Control ----

export const MODULE_FUNCTIONS = ["view", "add", "edit", "delete", "export"] as const;
export type FunctionId = (typeof MODULE_FUNCTIONS)[number];

/**
 * Module access format supports:
 *   "*"                     → all modules, all functions
 *   "dashboard"             → dashboard module, all functions
 *   "dashboard:view"        → dashboard module, view only
 *   "dashboard:view,export" → dashboard module, view + export
 */
export function hasFunctionAccess(
  payload: JWTPayload,
  mod: string,
  fn: string
): boolean {
  if (payload.role === "super_admin") return true;
  if (payload.modules.includes("*")) return true;

  for (const entry of payload.modules) {
    const [m, fns] = entry.split(":");
    if (m !== mod) continue;
    // "dashboard" (no colon) = all functions
    if (!fns) return true;
    // "dashboard:view,export" = specific functions
    return fns.split(",").includes(fn);
  }
  return false;
}

export function hasModuleAccess(payload: JWTPayload, mod: string): boolean {
  if (payload.role === "super_admin") return true;
  if (payload.modules.includes("*")) return true;
  return payload.modules.includes(mod);
}
