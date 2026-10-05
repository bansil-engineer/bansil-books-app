// ============================================================
// Bansil Books Analytics — CSV Intake Parser (Milestone B)
// Pure Node, no dependency. Preserves physical row numbers, raw
// values, and reports parse exceptions instead of silently
// repairing malformed rows.
// ============================================================

export interface CsvParseResult {
  encoding: "utf-8" | "utf-8-bom";
  delimiter: string;
  headers: string[];
  /** 1-indexed physical row number (including the header row as row 1). */
  rows: Array<{ physicalRow: number; values: string[] }>;
  exceptions: Array<{ physicalRow: number; message: string }>;
}

export interface CsvRawLines {
  encoding: "utf-8" | "utf-8-bom";
  delimiter: string;
  /** Every physical line in the file, 1-indexed, with NO header assumption at all. */
  lines: Array<{ physicalRow: number; values: string[] }>;
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

function detectDelimiter(sampleLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = sampleLine.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Splits one CSV line into fields, honoring double-quoted fields with escaped `""`. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Splits every physical line into fields with NO assumption about which row
 * is the header — the caller (intake-service, after the owner picks a
 * header/data-start row) decides that. Delimiter is detected from the first
 * non-empty line, since a report may have title rows before the real header.
 */
export function parseCsvRawLines(buffer: Buffer): CsvRawLines {
  let encoding: CsvRawLines["encoding"] = "utf-8";
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    encoding = "utf-8-bom";
    start = 3;
  }

  const text = buffer.subarray(start).toString("utf8");
  const rawLines = text.split(/\r\n|\r|\n/);
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();

  const firstNonEmpty = rawLines.find((l) => l.trim() !== "") ?? "";
  const delimiter = detectDelimiter(firstNonEmpty);

  const lines = rawLines.map((line, i) => ({ physicalRow: i + 1, values: splitCsvLine(line, delimiter) }));
  return { encoding, delimiter, lines };
}

/**
 * Convenience wrapper that assumes row 1 is the header (the pre-Milestone-B
 * behavior, kept for callers/tests that don't need header/data-start
 * selection). New code should use parseCsvRawLines + the intake-service
 * header-selection path instead.
 */
export function parseCsvBuffer(buffer: Buffer): CsvParseResult {
  const { encoding, delimiter, lines } = parseCsvRawLines(buffer);

  if (lines.length === 0) {
    return { encoding, delimiter: ",", headers: [], rows: [], exceptions: [{ physicalRow: 1, message: "File is empty" }] };
  }

  const headers = lines[0].values;
  const rows: CsvParseResult["rows"] = [];
  const exceptions: CsvParseResult["exceptions"] = [];

  for (let i = 1; i < lines.length; i++) {
    const { physicalRow, values } = lines[i];
    if (values.length !== headers.length) {
      exceptions.push({
        physicalRow,
        message: `Expected ${headers.length} column(s), found ${values.length} — row not auto-repaired`,
      });
      continue;
    }
    rows.push({ physicalRow, values });
  }

  return { encoding, delimiter, headers, rows, exceptions };
}
