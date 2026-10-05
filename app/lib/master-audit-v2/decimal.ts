/** Exact decimal values cross storage/JSON boundaries as canonical strings.
 * Scale preserves source precision; rounding is explicit, never inferred from UOM.
 */
export interface Decimal { readonly coefficient: bigint; readonly scale: number }
export type Rounding = "HALF_EVEN" | "HALF_AWAY_FROM_ZERO" | "TRUNCATE";
const ZERO = BigInt(0), ONE = BigInt(1), TEN = BigInt(10);
const MAX_SCALE = 30;
function checkScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) throw new RangeError("INVALID_SCALE");
}
function power(scale: number): bigint { checkScale(scale); return TEN ** BigInt(scale); }
function valid(value: Decimal): void {
  checkScale(value.scale);
  if (typeof value.coefficient !== "bigint") throw new TypeError("INVALID_COEFFICIENT");
}
export function parseDecimal(text: string): Decimal {
  if (typeof text !== "string" || text.length > 256 || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new TypeError("INVALID_DECIMAL");
  const scale = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
  checkScale(scale);
  const coefficient = BigInt(text.replace(".", ""));
  if (text.startsWith("-") && coefficient === ZERO) throw new TypeError("NEGATIVE_ZERO");
  return { coefficient, scale };
}
export function formatDecimal(value: Decimal): string {
  valid(value);
  const negative = value.coefficient < ZERO;
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0");
  return (negative ? "-" : "") + (value.scale ? digits.slice(0, -value.scale) + "." + digits.slice(-value.scale) : digits);
}
export function addDecimal(a: Decimal, b: Decimal): Decimal {
  valid(a); valid(b);
  const scale = Math.max(a.scale, b.scale);
  return { coefficient: a.coefficient * power(scale - a.scale) + b.coefficient * power(scale - b.scale), scale };
}
export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  valid(b); return addDecimal(a, { coefficient: -b.coefficient, scale: b.scale });
}
export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  valid(a); valid(b); checkScale(a.scale + b.scale);
  return { coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale };
}
function rounded(n: bigint, d: bigint, mode: Rounding): bigint {
  if (!["HALF_EVEN", "HALF_AWAY_FROM_ZERO", "TRUNCATE"].includes(mode)) throw new TypeError("ROUNDING_REQUIRED");
  if (d === ZERO) throw new RangeError("DIVISION_BY_ZERO");
  if (d < ZERO) { n = -n; d = -d; }
  const q = n / d, r = n % d, magnitude = r < ZERO ? -r : r;
  const twice = magnitude * BigInt(2);
  const odd = (q < ZERO ? -q : q) % BigInt(2) !== ZERO;
  return mode !== "TRUNCATE" && (twice > d || (twice === d && (mode === "HALF_AWAY_FROM_ZERO" || odd)))
    ? q + (n < ZERO ? -ONE : ONE) : q;
}
export function quantizeDecimal(value: Decimal, scale: number, mode: Rounding): Decimal {
  valid(value); checkScale(scale);
  // Validate the mode even when no rounding is necessary.
  if (!["HALF_EVEN", "HALF_AWAY_FROM_ZERO", "TRUNCATE"].includes(mode)) throw new TypeError("ROUNDING_REQUIRED");
  return { coefficient: scale >= value.scale ? value.coefficient * power(scale - value.scale)
    : rounded(value.coefficient, power(value.scale - scale), mode), scale };
}
export function divideDecimal(a: Decimal, b: Decimal, scale: number, mode: Rounding): Decimal {
  valid(a); valid(b); checkScale(scale);
  // Exponents can reach 60 here, but both input and output scales remain bounded.
  const exponent = scale + b.scale - a.scale;
  const n = a.coefficient * TEN ** BigInt(Math.max(0, exponent));
  const d = b.coefficient * TEN ** BigInt(Math.max(0, -exponent));
  return { coefficient: rounded(n, d, mode), scale };
}
export function isCanonicalDecimal(text: unknown, scale: unknown): boolean {
  try { return typeof text === "string" && typeof scale === "number" && parseDecimal(text).scale === scale && formatDecimal(parseDecimal(text)) === text; }
  catch { return false; }
}
