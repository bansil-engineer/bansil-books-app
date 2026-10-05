// ============================================================
// Bansil Books Analytics — Date & Period Utilities
// Indian Financial Year: 01 April to 31 March
// ============================================================

export type MasterPeriodOption =
  | "TODAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "THIS_QUARTER"
  | "CURRENT_FY"
  | "PREVIOUS_FY"
  | "ALL_FY"
  | "CUSTOM";

export interface DateRange {
  fromDate: string; // YYYY-MM-DD
  toDate: string;   // YYYY-MM-DD
  label: string;
}

/**
 * Returns YYYY-MM-DD string formatted in local/IST date.
 */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculates start and end dates for Indian Financial Year (Apr 1 - Mar 31)
 * based on reference date.
 */
export function getIndianFinancialYearRange(refDate: Date = new Date(), offsetYears: number = 0): DateRange {
  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth(); // 0 = Jan, 3 = Apr

  // If month is Jan, Feb, Mar (0, 1, 2), FY started in currentYear - 1
  const fyStartYear = (currentMonth < 3 ? currentYear - 1 : currentYear) + offsetYears;
  const fyEndYear = fyStartYear + 1;

  const start = `${fyStartYear}-04-01`;
  const end = `${fyEndYear}-03-31`;
  const fyShort = `${fyStartYear}-${String(fyEndYear).slice(-2)}`;

  return {
    fromDate: start,
    toDate: end,
    label: `FY ${fyShort}`,
  };
}

/**
 * Calculates current Indian Financial Year Start Date (YYYY-MM-DD):
 * If date >= 1 April: FY start = 1 April current calendar year
 * If date < 1 April: FY start = 1 April previous calendar year
 *
 * Example:
 * 13/09/2026 -> 2026-04-01
 * 15/02/2027 -> 2026-04-01
 * 01/04/2027 -> 2027-04-01
 */
export function getCurrentFyStart(refDate: Date = new Date()): string {
  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth(); // 0 = Jan, 3 = Apr

  // If before 1 April (Jan, Feb, Mar), FY started on 1 April of previous calendar year
  const fyStartYear = currentMonth < 3 ? currentYear - 1 : currentYear;
  return `${fyStartYear}-04-01`;
}

/**
 * Calculates current FY date range for Activity Sync:
 * FROM: Current FY Start (e.g. 2026-04-01)
 * TO: Current Date (e.g. 2026-09-13)
 */
export function getCurrentFyActivityRange(refDate: Date = new Date()): { fromDate: string; toDate: string } {
  return {
    fromDate: getCurrentFyStart(refDate),
    toDate: formatDate(refDate),
  };
}

export type ActivityDatePreset =
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "THIS_QUARTER"
  | "CURRENT_FY"
  | "CUSTOM";

export function getActivityDateRange(
  preset: ActivityDatePreset | string,
  customFrom?: string,
  customTo?: string,
  refDate: Date = new Date()
): { fromDate: string; toDate: string; label: string } {
  const todayStr = formatDate(refDate);

  switch (preset) {
    case "TODAY":
      return { fromDate: todayStr, toDate: todayStr, label: "Today" };

    case "YESTERDAY": {
      const y = new Date(refDate);
      y.setDate(y.getDate() - 1);
      const yStr = formatDate(y);
      return { fromDate: yStr, toDate: yStr, label: "Yesterday" };
    }

    case "THIS_WEEK": {
      const d = new Date(refDate);
      const day = d.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diffToMonday);
      return { fromDate: formatDate(monday), toDate: todayStr, label: "This Week" };
    }

    case "THIS_MONTH": {
      const year = refDate.getFullYear();
      const month = refDate.getMonth();
      const firstDay = new Date(year, month, 1);
      return { fromDate: formatDate(firstDay), toDate: todayStr, label: "This Month" };
    }

    case "THIS_QUARTER": {
      const q = getIndianQuarterRange(refDate);
      return { fromDate: q.fromDate, toDate: todayStr, label: "This Quarter" };
    }

    case "CUSTOM":
      return {
        fromDate: customFrom || getCurrentFyStart(refDate),
        toDate: customTo || todayStr,
        label: "Custom",
      };

    case "CURRENT_FY":
    default:
      return {
        fromDate: getCurrentFyStart(refDate),
        toDate: todayStr,
        label: "Current FY",
      };
  }
}

/**
 * Calculates Indian FY Quarter based on reference date:
 * Q1: Apr 1 - Jun 30
 * Q2: Jul 1 - Sep 30
 * Q3: Oct 1 - Dec 31
 * Q4: Jan 1 - Mar 31
 */
export function getIndianQuarterRange(refDate: Date = new Date()): DateRange {
  const year = refDate.getFullYear();
  const month = refDate.getMonth(); // 0-indexed

  if (month >= 3 && month <= 5) {
    // Q1: Apr 1 - Jun 30
    return { fromDate: `${year}-04-01`, toDate: `${year}-06-30`, label: `Q1 FY ${year}-${String(year + 1).slice(-2)}` };
  } else if (month >= 6 && month <= 8) {
    // Q2: Jul 1 - Sep 30
    return { fromDate: `${year}-07-01`, toDate: `${year}-09-30`, label: `Q2 FY ${year}-${String(year + 1).slice(-2)}` };
  } else if (month >= 9 && month <= 11) {
    // Q3: Oct 1 - Dec 31
    return { fromDate: `${year}-10-01`, toDate: `${year}-12-31`, label: `Q3 FY ${year}-${String(year + 1).slice(-2)}` };
  } else {
    // Q4: Jan 1 - Mar 31
    return { fromDate: `${year}-01-01`, toDate: `${year}-03-31`, label: `Q4 FY ${year - 1}-${String(year).slice(-2)}` };
  }
}

/**
 * Computes DateRange for a given master period option.
 */
export function getDateRangeForPeriod(
  period: MasterPeriodOption,
  customFrom?: string,
  customTo?: string,
  refDate: Date = new Date()
): DateRange {
  const todayStr = formatDate(refDate);

  switch (period) {
    case "TODAY":
      return {
        fromDate: todayStr,
        toDate: todayStr,
        label: "Today",
      };

    case "THIS_WEEK": {
      // Monday as first day of week
      const d = new Date(refDate);
      const day = d.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        fromDate: formatDate(monday),
        toDate: formatDate(sunday),
        label: "This Week",
      };
    }

    case "THIS_MONTH": {
      const year = refDate.getFullYear();
      const month = refDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      return {
        fromDate: formatDate(firstDay),
        toDate: formatDate(lastDay),
        label: "This Month",
      };
    }

    case "THIS_QUARTER":
      return getIndianQuarterRange(refDate);

    case "CURRENT_FY":
      return getIndianFinancialYearRange(refDate, 0);

    case "PREVIOUS_FY":
      return getIndianFinancialYearRange(refDate, -1);

    case "ALL_FY":
      return {
        fromDate: "2020-04-01",
        toDate: "2030-03-31",
        label: "All Synced FY",
      };

    case "CUSTOM":
      return {
        fromDate: customFrom || getIndianFinancialYearRange(refDate, 0).fromDate,
        toDate: customTo || todayStr,
        label: "Custom Range",
      };

    default:
      return getIndianFinancialYearRange(refDate, 0);
  }
}

/**
 * Returns the current Indian Financial Year string (e.g. "2026-27") based on reference date.
 */
export function getCurrentFinancialYear(refDate: Date = new Date()): string {
  const range = getIndianFinancialYearRange(refDate, 0);
  return range.label.replace("FY ", "");
}

/**
 * Returns the immediately preceding Indian Financial Year string (e.g. "2025-26") based on reference date.
 */
export function getPreviousFinancialYear(refDate: Date = new Date()): string {
  const range = getIndianFinancialYearRange(refDate, -1);
  return range.label.replace("FY ", "");
}

/**
 * Helper to parse FY string (e.g. "2026-27" or "2025-26") into DateRange.
 */
export function parseFyToDateRange(fy: string): DateRange {
  const match = fy.match(/(\d{4})[^\d](\d{2,4})/);
  if (match) {
    const startYear = parseInt(match[1], 10);
    const endYear = startYear + 1;
    return {
      fromDate: `${startYear}-04-01`,
      toDate: `${endYear}-03-31`,
      label: `FY ${startYear}-${String(endYear).slice(-2)}`,
    };
  }
  return getIndianFinancialYearRange(new Date(), 0);
}

/**
 * Returns dynamic list of financial years for the unified Period selector.
 */
export function getAvailableFinancialYears(refDate: Date = new Date()): { value: string; label: string }[] {
  const currentStartYear = (refDate.getMonth() < 3 ? refDate.getFullYear() - 1 : refDate.getFullYear());
  const years: { value: string; label: string }[] = [];
  for (let y = 2024; y <= Math.max(currentStartYear + 1, 2027); y++) {
    const endY = String(y + 1).slice(-2);
    years.push({
      value: `${y}-${endY}`,
      label: `FY ${y}-${endY}`,
    });
  }
  return years;
}

/**
 * Resolves effective fromDate and toDate from filter options.
 */
export function resolveDateRange(filter: {
  period?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
}): { fromDate: string; toDate: string } {
  if (filter.fromDate && filter.toDate) {
    return { fromDate: filter.fromDate, toDate: filter.toDate };
  }
  if (filter.financialYear) {
    if (filter.financialYear === "ALL" || filter.financialYear === "ALL_FY") {
      return { fromDate: "2020-04-01", toDate: "2030-03-31" };
    }
    const range = parseFyToDateRange(filter.financialYear);
    return { fromDate: range.fromDate, toDate: range.toDate };
  }
  if (filter.period) {
    if (filter.period === "ALL" || filter.period === "ALL_FY") {
      return { fromDate: "2020-04-01", toDate: "2030-03-31" };
    }
    if (filter.period.includes("-") && !["TODAY", "THIS_WEEK", "THIS_MONTH", "THIS_QUARTER", "CURRENT_FY", "PREVIOUS_FY", "ALL_FY", "CUSTOM"].includes(filter.period)) {
      const range = parseFyToDateRange(filter.period);
      return { fromDate: range.fromDate, toDate: range.toDate };
    }
    const range = getDateRangeForPeriod(
      filter.period as MasterPeriodOption,
      filter.fromDate,
      filter.toDate
    );
    return { fromDate: range.fromDate, toDate: range.toDate };
  }
  const currentFyRange = getDateRangeForPeriod("CURRENT_FY");
  return { fromDate: currentFyRange.fromDate, toDate: currentFyRange.toDate };
}

