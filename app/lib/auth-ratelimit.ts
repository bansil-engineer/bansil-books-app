// ============================================================
// Bansil Books — OA-U2-F Login Rate Limiting (DB store only)
//
// Fixes QC F3: one anonymous client could keep the shared KDF queue full
// and lock EVERY user (including the Owner) out of sign-in.
//
// Layers, all checked BEFORE any password hashing:
//   1. Per-source attempts  — anonymous attempts per client address.
//   2. Per-account+source failures — guessing one account from one source.
//   3. Per-account failures (untrusted lane only) — distributed guessing of
//      one account. Keyed by the normalised email whether or not the account
//      exists, and every limit returns the SAME generic 429 → no enumeration.
//   4. Trusted lane via a signed "known device" cookie (OWASP device-cookie
//      pattern): a browser that previously signed in successfully to an
//      account is exempt from layers 1 and 3 for that account, is limited per
//      (account, device) instead, and is served first by the KDF scheduler.
//      An attacker flooding the account or the source cannot lock out the
//      Owner's usual browser. The cookie is NOT a credential: the password is
//      still required, and it grants no access to anything.
//
// Client address: X-Forwarded-For is attacker-controllable except for the
// entries appended by trusted proxies. We take the entry AUTH_TRUSTED_PROXY_HOPS
// positions from the RIGHT (default 1 = the address the nearest proxy saw).
// Leftmost entries — which a client can forge — are never used. If the hop
// count is wrong for the deployment, per-source buckets may be shared by
// many users; layers 2–4 still prevent a global lockout of known devices.
// Render's real proxy-hop count is NOT VERIFIED (see OA-U2-F report).
//
// State is in-process memory (single Render instance, numInstances: 1),
// bounded in size, and resets on restart. No credentials are stored or logged.
// ============================================================

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export interface LimitRule {
  limit: number;
  windowMs: number;
}

export const LOGIN_LIMITS = {
  /** Anonymous login attempts per client address. */
  perSource: { limit: 30, windowMs: 10 * 60_000 } as LimitRule,
  /** Unsuccessful logins for one account from one source (successes refund). */
  perAccountSource: { limit: 5, windowMs: 15 * 60_000 } as LimitRule,
  /** Unsuccessful untrusted logins for one account from all sources. */
  perAccount: { limit: 20, windowMs: 60 * 60_000 } as LimitRule,
  /** Unsuccessful logins for one account from one known device. */
  perAccountDevice: { limit: 10, windowMs: 15 * 60_000 } as LimitRule,
  /** Invitation-accept attempts per client address. */
  acceptPerSource: { limit: 30, windowMs: 10 * 60_000 } as LimitRule,
};

export const DEVICE_COOKIE = "bansil_ld";
export const DEVICE_COOKIE_PATH = "/api/auth/login";
export const DEVICE_COOKIE_MAX_AGE_S = 30 * 24 * 3600;
const MAX_KEYS = 10_000;

// ------------------------------------------------------------------ counters

class FixedWindowCounter {
  private readonly map = new Map<string, { count: number; resetAt: number }>();
  private readonly rule: LimitRule;
  private readonly now: () => number;

  constructor(rule: LimitRule, now: () => number) {
    this.rule = rule;
    this.now = now;
  }

  private entry(key: string) {
    const t = this.now();
    const e = this.map.get(key);
    if (!e || e.resetAt <= t) return null;
    return e;
  }

  /** Seconds until the key is allowed again, or 0 if currently allowed. */
  blockedFor(key: string): number {
    const e = this.entry(key);
    return e && e.count >= this.rule.limit ? Math.max(1, Math.ceil((e.resetAt - this.now()) / 1000)) : 0;
  }

  hit(key: string): void {
    const t = this.now();
    const e = this.entry(key);
    if (e) {
      e.count++;
      return;
    }
    this.map.delete(key);
    this.map.set(key, { count: 1, resetAt: t + this.rule.windowMs });
    if (this.map.size > MAX_KEYS) {
      // Bounded memory: drop the oldest 10% (Map preserves insertion order).
      let drop = Math.ceil(MAX_KEYS / 10);
      for (const k of this.map.keys()) {
        this.map.delete(k);
        if (--drop <= 0) break;
      }
    }
  }

  reset(key: string): void {
    this.map.delete(key);
  }

  /** Remove one previously recorded hit (never below zero). */
  undo(key: string): void {
    const e = this.entry(key);
    if (e && e.count > 0) e.count--;
  }

  size(): number {
    return this.map.size;
  }
}

export class LoginRateLimiter {
  readonly perSource: FixedWindowCounter;
  readonly perAccountSource: FixedWindowCounter;
  readonly perAccount: FixedWindowCounter;
  readonly perAccountDevice: FixedWindowCounter;
  readonly acceptPerSource: FixedWindowCounter;

  constructor(now: () => number = Date.now, limits = LOGIN_LIMITS) {
    this.perSource = new FixedWindowCounter(limits.perSource, now);
    this.perAccountSource = new FixedWindowCounter(limits.perAccountSource, now);
    this.perAccount = new FixedWindowCounter(limits.perAccount, now);
    this.perAccountDevice = new FixedWindowCounter(limits.perAccountDevice, now);
    this.acceptPerSource = new FixedWindowCounter(limits.acceptPerSource, now);
  }

  /** Check before hashing. Returns Retry-After seconds, or 0 if allowed. */
  checkLogin(k: LoginKeys): number {
    if (k.deviceId) return this.perAccountDevice.blockedFor(`${k.account}|${k.deviceId}`);
    return Math.max(
      this.perSource.blockedFor(k.source),
      this.perAccountSource.blockedFor(`${k.account}|${k.source}`),
      this.perAccount.blockedFor(k.account),
    );
  }

  /**
   * Record an admitted attempt BEFORE hashing (pessimistic counting). Counting
   * only after a failure would let a concurrent burst of guesses all pass the
   * check before the first failure is recorded.
   */
  recordAttempt(k: LoginKeys): void {
    if (k.deviceId) {
      this.perAccountDevice.hit(`${k.account}|${k.deviceId}`);
    } else {
      this.perSource.hit(k.source);
      this.perAccountSource.hit(`${k.account}|${k.source}`);
      this.perAccount.hit(k.account);
    }
  }

  /**
   * The password was never checked (KDF saturated): give back exactly this
   * attempt's account counters. Per-source volume is NOT refunded.
   */
  refundAttempt(k: LoginKeys): void {
    if (k.deviceId) {
      this.perAccountDevice.undo(`${k.account}|${k.deviceId}`);
    } else {
      this.perAccountSource.undo(`${k.account}|${k.source}`);
      this.perAccount.undo(k.account);
    }
  }

  /** A successful login refunds its own attempt and clears its pair counter. */
  recordSuccess(k: LoginKeys): void {
    if (k.deviceId) {
      this.perAccountDevice.reset(`${k.account}|${k.deviceId}`);
    } else {
      this.perAccountSource.reset(`${k.account}|${k.source}`);
      this.perAccount.undo(k.account);
      // perAccount is otherwise NOT reset: it is attacker-driven and only
      // affects untrusted (no device cookie) sources.
    }
  }
}

export interface LoginKeys {
  /** sha256 of the normalised email — limits never store raw emails. */
  account: string;
  /** Derived client address, or "unknown". */
  source: string;
  /** Verified known-device id for THIS account, or null. */
  deviceId: string | null;
}

export function accountKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex").slice(0, 32);
}

// ------------------------------------------------------------------ client address

export function trustedProxyHops(): number {
  const n = Number.parseInt(process.env.AUTH_TRUSTED_PROXY_HOPS ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
}

/**
 * Client address from X-Forwarded-For, counting `hops` trusted proxies from
 * the right. Never uses forgeable left-hand entries. Invalid → "unknown".
 */
export function clientSource(xff: string | null, hops = trustedProxyHops()): string {
  if (!xff) return "unknown";
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < hops) return "unknown";
  const candidate = parts[parts.length - hops];
  const bare = candidate.replace(/^\[|\]$/g, "").replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
  if (!isIP(bare)) return "unknown";
  // Group IPv6 by /64 so one host cannot rotate through its own prefix.
  if (isIP(bare) === 6) return `v6:${expandV6(bare).slice(0, 4).join(":")}`;
  return `v4:${bare}`;
}

function expandV6(addr: string): string[] {
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = tail !== undefined ? Array(Math.max(0, 8 - h.length - t.length)).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => x.toLowerCase().padStart(4, "0"));
}

// ------------------------------------------------------------------ known-device cookie

function deviceKey(): Buffer | null {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) return null;
  // Domain-separated sub-key: a device cookie can never be confused with a JWT.
  return createHmac("sha256", s).update("bansil-login-device-cookie-v1").digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** New device cookie value bound to one account. Null if no AUTH_SECRET. */
export function issueDeviceCookie(email: string, nowMs = Date.now()): string | null {
  const key = deviceKey();
  if (!key) return null;
  const payload = `v1.${randomBytes(12).toString("base64url")}.${accountKey(email)}.${Math.floor(nowMs / 1000) + DEVICE_COOKIE_MAX_AGE_S}`;
  return `${payload}.${sign(key, payload)}`;
}

/** Device id if the cookie is authentic, unexpired and bound to `email`. */
export function verifyDeviceCookie(value: string | undefined, email: string, nowMs = Date.now()): string | null {
  if (!value || value.length > 300) return null;
  const key = deviceKey();
  if (!key) return null;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  const payload = parts.slice(0, 4).join(".");
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(parts[4]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (parts[2] !== accountKey(email)) return null;
  if (!(Number(parts[3]) > Math.floor(nowMs / 1000))) return null;
  return parts[1];
}

// ------------------------------------------------------------------ singleton

let _limiter = new LoginRateLimiter();

export function loginLimiter(): LoginRateLimiter {
  return _limiter;
}

/** Test hook: fresh limiter (optionally with an injected clock / limits). */
export function __resetLoginRateLimiterForTests(now?: () => number, limits?: typeof LOGIN_LIMITS): void {
  _limiter = new LoginRateLimiter(now, limits);
}
