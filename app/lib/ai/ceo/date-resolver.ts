/**
 * Deterministic period resolver for AI CEO queries.
 */

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  description: string;
}

/**
 * True when the query names a period itself (so it must NOT inherit a period
 * from earlier in the conversation).
 */
export function hasExplicitPeriod(query: string): boolean {
  const lower = query.toLowerCase();
  return /\b(fy|ytd|year|month|monthly|week|weekly|today|yesterday|overall|all time)\b/.test(lower) ||
    lower.includes("fy2025") || lower.includes("2025-26");
}

export function resolvePeriod(query: string, injectedNow?: string): DateRange {
  const lower = query.toLowerCase().trim();

  // Baseline Date in Asia/Kolkata timezone
  let baseDate = new Date();
  if (injectedNow) {
    baseDate = new Date(injectedNow + "T12:00:00+05:30"); // Midday IST to avoid timezone shifts
  } else {
    // Current date in IST
    const nowStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [month, day, year] = nowStr.split('/');
    baseDate = new Date(`${year}-${month}-${day}T12:00:00+05:30`);
  }

  const y = baseDate.getFullYear();
  const m = baseDate.getMonth(); // 0-11
  const d = baseDate.getDate();
  const currentDayOfWeek = baseDate.getDay(); // 0 (Sun) to 6 (Sat)

  // Explicit FY 2025-26
  if (lower.includes("fy 2025-26") || lower.includes("fy2025-26") || lower.includes("fy 25-26") || lower.includes("2025-26")) {
    return { startDate: "2025-04-01", endDate: "2026-03-31", description: "01/04/2025–31/03/2026" };
  }

  if (lower.includes("last fy") || lower.includes("previous fy")) {
    const isPastMarch = m >= 3;
    const startYear = isPastMarch ? y - 1 : y - 2;
    return {
      startDate: `${startYear}-04-01`,
      endDate: `${startYear + 1}-03-31`,
      description: `01/04/${startYear}–31/03/${startYear + 1}`
    };
  }

  if (lower.includes("current fy") || lower.includes("this fy") || lower.includes("fy")) {
    const isPastMarch = m >= 3;
    const startYear = isPastMarch ? y : y - 1;
    return {
      startDate: `${startYear}-04-01`,
      endDate: formatDate(baseDate),
      description: `01/04/${startYear}–${formatAsDDMMYYYY(formatDate(baseDate))}`
    };
  }

  if (lower.includes("last month") || lower.includes("previous month")) {
    const startOfLastMonth = new Date(y, m - 1, 1, 12, 0, 0);
    const endOfLastMonth = new Date(y, m, 0, 12, 0, 0);
    return {
      startDate: formatDate(startOfLastMonth),
      endDate: formatDate(endOfLastMonth),
      description: `${formatAsDDMMYYYY(formatDate(startOfLastMonth))}–${formatAsDDMMYYYY(formatDate(endOfLastMonth))}`
    };
  }

  if (lower.includes("this month") || lower.includes("current month")) {
    const startOfThisMonth = new Date(y, m, 1, 12, 0, 0);
    return {
      startDate: formatDate(startOfThisMonth),
      endDate: formatDate(baseDate),
      description: `${formatAsDDMMYYYY(formatDate(startOfThisMonth))}–${formatAsDDMMYYYY(formatDate(baseDate))}`
    };
  }

  if (lower.includes("yesterday")) {
    const yesterday = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
    return {
      startDate: formatDate(yesterday),
      endDate: formatDate(yesterday),
      description: formatAsDDMMYYYY(formatDate(yesterday))
    };
  }

  if (lower.includes("today")) {
    return {
      startDate: formatDate(baseDate),
      endDate: formatDate(baseDate),
      description: formatAsDDMMYYYY(formatDate(baseDate))
    };
  }

  if (lower.includes("last week") || lower.includes("previous week")) {
    const startOfLastWeek = new Date(baseDate.getTime());
    // Assume week starts on Monday
    const diffToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    startOfLastWeek.setDate(d - diffToMonday - 7);
    const endOfLastWeek = new Date(startOfLastWeek.getTime());
    endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
    return {
      startDate: formatDate(startOfLastWeek),
      endDate: formatDate(endOfLastWeek),
      description: `${formatAsDDMMYYYY(formatDate(startOfLastWeek))}–${formatAsDDMMYYYY(formatDate(endOfLastWeek))}`
    };
  }

  if (lower.includes("this week") || lower.includes("current week")) {
    const startOfThisWeek = new Date(baseDate.getTime());
    const diffToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    startOfThisWeek.setDate(d - diffToMonday);
    return {
      startDate: formatDate(startOfThisWeek),
      endDate: formatDate(baseDate),
      description: `${formatAsDDMMYYYY(formatDate(startOfThisWeek))}–${formatAsDDMMYYYY(formatDate(baseDate))}`
    };
  }

  // Generic fallback: YTD
  const isPastMarch = m >= 3;
  const startYear = isPastMarch ? y : y - 1;
  return {
    startDate: `${startYear}-04-01`,
    endDate: formatDate(baseDate),
    description: `01/04/${startYear}–${formatAsDDMMYYYY(formatDate(baseDate))}`
  };
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatAsDDMMYYYY(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return isoDate;
}
