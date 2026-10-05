// ============================================================
// Date utilities — IST (Asia/Kolkata) helpers
// ============================================================

/**
 * Returns today's date in Asia/Kolkata timezone as YYYY-MM-DD string.
 * NEVER uses UTC date directly, which could differ from Indian date.
 */
export function getTodayIST(): string {
  const now = new Date();
  // Use Intl.DateTimeFormat to get the date parts in IST
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA produces YYYY-MM-DD format
  return formatter.format(now);
}

/**
 * Returns today's date in DD/MM/YYYY format for display (IST).
 */
export function getTodayISTDisplay(): string {
  const iso = getTodayIST();
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Formats any ISO date string (YYYY-MM-DD or full timestamp) as DD/MM/YYYY.
 */
export function formatDisplayDate(isoStr?: string | null): string {
  if (!isoStr) return "—";
  const clean = isoStr.slice(0, 10);
  const parts = clean.split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoStr;
}

/**
 * Formats any ISO date/timestamp string as DD/MM/YYYY HH:mm (IST Asia/Kolkata).
 * Standardizes to DD/MM/YYYY HH:mm with slashes (e.g. 11/09/2026 21:52).
 */
export function formatDisplayDateTime(isoStr?: string | null): string {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) {
      // If already formatted like DD-MM-YYYY HH:mm, convert hyphens to slashes
      if (/^\d{2}-\d{2}-\d{4}/.test(isoStr)) {
        return isoStr.replace(/-/g, "/");
      }
      return isoStr;
    }
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    let day = "01", month = "01", year = "2026", hour = "00", minute = "00";
    for (const p of parts) {
      if (p.type === "day") day = p.value;
      if (p.type === "month") month = p.value;
      if (p.type === "year") year = p.value;
      if (p.type === "hour") hour = p.value;
      if (p.type === "minute") minute = p.value;
    }
    return `${day}/${month}/${year} ${hour}:${minute}`;
  } catch {
    return isoStr;
  }
}

/**
 * Returns current time in IST as a readable string.
 */
export function getNowISTString(): string {
  return formatDisplayDateTime(new Date().toISOString());
}

export function formatSyncDate(isoStr?: string): string {
  if (!isoStr) return "Never";
  return formatDisplayDateTime(isoStr);
}

/**
 * Decimal-safe addition for financial amounts represented as numbers.
 * Avoids floating point errors by working with integers (paise).
 * Returns a string with 2 decimal places.
 */
export function sumAmounts(amounts: number[]): string {
  const totalMillis = amounts.reduce((acc, amount) => {
    const millis = Math.round((Number(amount) || 0) * 100);
    return acc + millis;
  }, 0);
  return (totalMillis / 100).toFixed(2);
}

/**
 * Formats a decimal string or number as Indian currency with commas.
 * Max 2 decimals by default, Indian grouping (e.g. 50010609.98 -> 5,00,10,609.98, 5988.81061 -> 5,988.81).
 * Completely eliminates floating-point noise.
 */
export function formatINR(amount: string | number, minDecimals = 2, maxDecimals = 2): string {
  const num = typeof amount === "string" ? parseFloat(amount) : Number(amount);
  if (isNaN(num) || num === null || num === undefined) return "0.00";
  // Round to maxDecimals to eliminate float noise like .81061 or .9999999997
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(num * factor) / factor;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(rounded);
}

/**
 * Formats quantity with Indian grouping, up to 3 decimals, eliminating floating noise.
 * Examples:
 * 202455.287999999997 -> "2,02,455.288"
 * 142304.477999999997 -> "1,42,304.478"
 * 60090.809999999998 -> "60,090.81"
 */
export function formatQuantity(qty: string | number, maxDecimals = 3): string {
  const num = typeof qty === "string" ? parseFloat(qty) : Number(qty);
  if (isNaN(num) || num === null || num === undefined) return "0";
  // Round to max 3 decimal places to eliminate float noise
  const rounded = Math.round(num * 1000) / 1000;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(rounded);
}

/**
 * Formats rate with Indian grouping, up to 3 decimals.
 */
export function formatRate(rate: string | number, maxDecimals = 3): string {
  const num = typeof rate === "string" ? parseFloat(rate) : Number(rate);
  if (isNaN(num) || num === null || num === undefined) return "0.00";
  const rounded = Math.round(num * 1000) / 1000;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  }).format(rounded);
}

/**
 * Shifts a YYYY-MM-DD date by +/- days.
 */
export function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Construct date at UTC noon to avoid any DST / timezone shift issues
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Converts YYYY-MM-DD to DD/MM/YYYY display string.
 */
export function isoToDisplay(iso: string): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Checks if string is a valid YYYY-MM-DD date.
 */
export function isValidISODate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
