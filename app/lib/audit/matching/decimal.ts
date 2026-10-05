// ============================================================
// Bansil Books Analytics — Decimal-safe arithmetic (Milestone C)
// Money and quantity comparisons must never use binary-float
// equality. Every value is parsed into a fixed-point BigInt
// (scaled by 10^SCALE_DIGITS) for exact add/subtract/compare,
// then formatted back to a decimal string for storage/display.
// ============================================================

export const SCALE_DIGITS = 5; // covers 2dp money + 3dp quantity in one representation
const SCALE = BigInt(10) ** BigInt(SCALE_DIGITS);

export class DecimalParseError extends Error {}

/** Parses a decimal string (optionally with thousands separators / leading +/-) into a scaled BigInt. Never guesses on garbage input — throws instead. */
export function parseScaled(raw: string): bigint {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) {
    throw new DecimalParseError(`Not a valid decimal number: "${raw}"`);
  }
  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[+-]/, "");
  const [intPart, fracPart = ""] = unsigned.split(".");
  const fracPadded = (fracPart + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  const combined = BigInt(intPart || "0") * SCALE + BigInt(fracPadded || "0");
  return negative ? -combined : combined;
}

/** Best-effort parse used only where the caller has already decided a missing/invalid value should be treated as absent — never silently coerced to zero. */
export function tryParseScaled(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  try {
    return parseScaled(raw);
  } catch {
    return null;
  }
}

export function absScaled(n: bigint): bigint {
  return n < BigInt(0) ? -n : n;
}

export function formatScaled(n: bigint, decimals: number = 2): string {
  const negative = n < BigInt(0);
  const unsigned = negative ? -n : n;
  const intPart = unsigned / SCALE;
  const fracPart = (unsigned % SCALE).toString().padStart(SCALE_DIGITS, "0").slice(0, decimals);
  const sign = negative ? "-" : "";
  return decimals > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

export function sumScaled(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, BigInt(0));
}
