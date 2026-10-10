// OA-U2-F — client-safe helpers for the /invite page (no Node imports).

/** Parse the invitation token from a location hash ("#token=..."). "" if absent/invalid. */
export function tokenFromHash(hash: string): string {
  const m = /(?:^|&)token=([A-Za-z0-9_-]{20,200})/.exec(hash.replace(/^#/, ""));
  return m ? m[1] : "";
}

/**
 * QC F4: the read-once effect body. React Strict Mode (next dev) runs effects
 * twice while preserving refs; guarding on the ref makes the second run a
 * no-op so it cannot replace the token with "" after the hash was stripped.
 */
export function readTokenOnce(
  ref: { current: boolean },
  getHash: () => string,
  setToken: (t: string) => void,
  stripHash: () => void,
): void {
  if (ref.current) return;
  ref.current = true;
  setToken(tokenFromHash(getHash()));
  stripHash();
}
