// ============================================================
// Bansil Books — OA-U2 Password Hashing (versioned scrypt)
//
// Uses Node's built-in, OpenSSL-backed crypto.scrypt — a maintained
// memory-hard KDF. No third-party dependency.
//
// Stored format (self-describing, PHC-style):
//   scrypt$v=1$N=<N>,r=<r>,p=<p>$<salt>$<hash_hex>
//
// The salt is a 32-char hex string used as UTF-8 KDF input — exactly
// how the existing AUTH_USERS hashes were produced (app/lib/auth.ts
// hashPassword passes the hex string, not decoded bytes). This lets
// imported legacy hashes verify unchanged, so the Owner keeps the
// same password across migration.
//
// Parameters (CURRENT_PARAMS): N=2^16, r=8, p=2 — an OWASP-listed
// equivalent of the N=2^17,r=8,p=1 minimum, at 64 MiB per hash
// (suits a 512 MB Render Starter instance). Legacy hashes
// (N=16384,r=8,p=1 — Node defaults) are upgraded on next login.
//
// Never logs or returns passwords, salts, or hashes.
// ============================================================

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const KEY_LEN = 64;
export const CURRENT_PARAMS: ScryptParams = { N: 65536, r: 8, p: 2 };
/** Params implied by Node's scryptSync defaults — used by AUTH_USERS today. */
export const LEGACY_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const HASH_RE = /^scrypt\$v=1\$N=(\d+),r=(\d+),p=(\d+)\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

function maxmemFor(params: ScryptParams): number {
  // scrypt needs ~128 * N * r bytes; give headroom.
  return 128 * params.N * params.r * 2;
}

function derive(password: string, salt: string, params: ScryptParams): Buffer {
  return scryptSync(password, salt, KEY_LEN, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  });
}

function encode(params: ScryptParams, salt: string, hashHex: string): string {
  return `scrypt$v=1$N=${params.N},r=${params.r},p=${params.p}$${salt}$${hashHex}`;
}

interface Decoded {
  params: ScryptParams;
  salt: string;
  hash: Buffer;
}

function decode(stored: string): Decoded | null {
  const m = HASH_RE.exec(stored);
  if (!m) return null;
  const params = { N: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  // Reject absurd/unsafe parameters from a tampered row (DoS / weak params).
  if (
    params.N < 16384 || params.N > 1048576 || (params.N & (params.N - 1)) !== 0 ||
    params.r < 8 || params.r > 32 || params.p < 1 || params.p > 16
  ) {
    return null;
  }
  return { params, salt: m[4], hash: Buffer.from(m[5], "hex") };
}

/** Hash a new password with CURRENT_PARAMS and a fresh 16-byte random salt. */
export function hashPasswordV1(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return encode(CURRENT_PARAMS, salt, derive(password, salt, CURRENT_PARAMS).toString("hex"));
}

/**
 * Wrap a legacy AUTH_USERS {salt, hash} pair into the stored format
 * WITHOUT knowing the password. Returns null if the pair is malformed.
 */
export function wrapLegacyHash(salt: string, hashHex: string): string | null {
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hashHex)) return null;
  return encode(LEGACY_PARAMS, salt, hashHex);
}

/** Constant-time verification. Returns false for malformed stored values. */
export function verifyPasswordV1(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const d = decode(stored);
  if (!d) return false;
  const computed = derive(password, d.salt, d.params);
  if (computed.length !== d.hash.length) return false;
  return timingSafeEqual(computed, d.hash);
}

/** True when the stored hash uses weaker-than-current parameters. */
export function needsRehash(stored: string): boolean {
  const d = decode(stored);
  if (!d) return true;
  return (
    d.params.N < CURRENT_PARAMS.N ||
    d.params.r < CURRENT_PARAMS.r ||
    d.params.p < CURRENT_PARAMS.p
  );
}

/**
 * Burn comparable CPU when the user does not exist, so login timing
 * does not reveal which emails are registered.
 */
export function dummyVerify(password: string): void {
  derive(password, "00000000000000000000000000000000", CURRENT_PARAMS);
}

// ------------------------------------------------------------------
// ASYNC, BOUNDED KDF — used by every request path.
//
// scryptSync at these parameters blocks the event loop ~370 ms, so a
// handful of anonymous login requests per second would stall the whole
// app. The async variant runs on the libuv threadpool. A single-slot
// semaphore caps memory at ONE 64 MiB derivation at a time (512 MB
// instance), and a bounded queue turns floods into fast 429s instead of
// unbounded latency/memory.
// ------------------------------------------------------------------

export class KdfBusyError extends Error {
  constructor() {
    super("Password service busy");
    this.name = "KdfBusyError";
  }
}

export const KDF_MAX_CONCURRENT = 1;
export const KDF_MAX_QUEUE = 8;
let kdfActive = 0;
const kdfQueue: Array<() => void> = [];

async function withKdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (kdfActive >= KDF_MAX_CONCURRENT) {
    if (kdfQueue.length >= KDF_MAX_QUEUE) throw new KdfBusyError();
    await new Promise<void>((resolve) => kdfQueue.push(resolve));
  }
  kdfActive++;
  try {
    return await fn();
  } finally {
    kdfActive--;
    const next = kdfQueue.shift();
    if (next) next();
  }
}

function deriveAsync(password: string, salt: string, params: ScryptParams): Promise<Buffer> {
  return withKdfSlot(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scrypt(password, salt, KEY_LEN, { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) },
          (err, key) => (err ? reject(err) : resolve(key))),
      ),
  );
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveAsync(password, salt, CURRENT_PARAMS);
  return encode(CURRENT_PARAMS, salt, key.toString("hex"));
}

/**
 * Constant-cost verification: a failed check against a weaker (legacy)
 * hash is padded to the current cost, so response time does not reveal
 * which accounts were migrated from AUTH_USERS.
 */
export async function verifyPasswordAsync(password: string, stored: string | null | undefined): Promise<boolean> {
  const d = stored ? decode(stored) : null;
  if (!d) {
    await deriveAsync(password, "00000000000000000000000000000000", CURRENT_PARAMS);
    return false;
  }
  const computed = await deriveAsync(password, d.salt, d.params);
  const ok = computed.length === d.hash.length && timingSafeEqual(computed, d.hash);
  if (!ok && needsRehash(stored!)) {
    await deriveAsync(password, "00000000000000000000000000000000", CURRENT_PARAMS);
  }
  return ok;
}

export async function dummyVerifyAsync(password: string): Promise<void> {
  await deriveAsync(password, "00000000000000000000000000000000", CURRENT_PARAMS);
}

export type PasswordPolicyResult = { ok: true } | { ok: false; error: string };

/** Policy for passwords set in DB mode. No default passwords exist anywhere. */
export function checkPasswordPolicy(password: unknown, email?: string): PasswordPolicyResult {
  if (typeof password !== "string") return { ok: false, error: "Password is required" };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters` };
  }
  if (password.trim().length === 0) return { ok: false, error: "Password cannot be blank" };
  if (email && password.toLowerCase() === email.trim().toLowerCase()) {
    return { ok: false, error: "Password must not be the same as the email address" };
  }
  return { ok: true };
}
