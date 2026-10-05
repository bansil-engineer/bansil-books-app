// ============================================================
// Bansil Books Analytics — Digital PDF Text Extractor (Milestone B)
// Pure Node, no dependency, no external OCR/AI. Extracts text that a
// DIGITAL PDF already stores as PDF text-showing operators (Tj/TJ).
// Scanned/image-only pages are DETECTED and reported as
// OCR_REQUIRED — this module has no OCR engine and never fabricates
// text for them.
//
// Deliberately conservative: supports the common case (direct object
// table, FlateDecode content streams, no object streams, unencrypted).
// Anything outside that returns a clear status rather than silently
// producing wrong or partial text as if it were complete.
// ============================================================

import zlib from "node:zlib";

export type PdfPageStatus = "EXTRACTED" | "OCR_REQUIRED" | "EMPTY";

export interface PdfPageResult {
  pageNumber: number; // 1-indexed
  status: PdfPageStatus;
  text: string;
}

export interface PdfExtractionResult {
  status: "EXTRACTED" | "OCR_REQUIRED" | "UNSUPPORTED_STRUCTURE" | "ENCRYPTED_NOT_SUPPORTED";
  pages: PdfPageResult[];
  note?: string;
}

interface PdfObject {
  objNum: number;
  dictText: string;
  streamBytes: Buffer | null;
}

function findAllObjects(buf: Buffer): Map<number, PdfObject> {
  const latin1 = buf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const objRegex = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = objRegex.exec(latin1))) {
    const objNum = parseInt(match[1], 10);
    const bodyStart = match.index + match[0].length;
    const endIdx = latin1.indexOf("endobj", bodyStart);
    if (endIdx === -1) continue;
    const body = latin1.slice(bodyStart, endIdx);

    const streamKeywordIdx = body.indexOf("stream");
    let dictText = body;
    let streamBytes: Buffer | null = null;

    if (streamKeywordIdx !== -1) {
      dictText = body.slice(0, streamKeywordIdx);
      // stream data starts right after "stream" + EOL (\r\n or \n)
      let dataStart = bodyStart + streamKeywordIdx + "stream".length;
      if (latin1[dataStart] === "\r") dataStart++;
      if (latin1[dataStart] === "\n") dataStart++;
      const endstreamIdx = latin1.indexOf("endstream", dataStart);
      if (endstreamIdx !== -1) {
        streamBytes = buf.subarray(dataStart, endstreamIdx);
      }
    }

    objects.set(objNum, { objNum, dictText, streamBytes });
  }
  return objects;
}

function extractRefs(dictText: string, key: string): number[] {
  // Matches "/Key n g R" (single) or "/Key [n1 0 R n2 0 R ...]" (array)
  const arrayMatch = dictText.match(new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`));
  if (arrayMatch) {
    return [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => parseInt(m[1], 10));
  }
  const singleMatch = dictText.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`));
  return singleMatch ? [parseInt(singleMatch[1], 10)] : [];
}

function decodeStream(obj: PdfObject): Buffer | null {
  if (!obj.streamBytes) return null;
  if (/\/Filter\s*\/FlateDecode/.test(obj.dictText) || /\/Filter\s*\[[^\]]*FlateDecode/.test(obj.dictText)) {
    try {
      return zlib.inflateSync(obj.streamBytes);
    } catch {
      return null;
    }
  }
  if (/\/Filter/.test(obj.dictText)) {
    // A filter we don't decode (DCTDecode/CCITTFax/JBIG2 = image; ASCII85/LZW = uncommon here).
    return null;
  }
  return obj.streamBytes; // no filter — raw content stream
}

/** Decodes PDF literal-string escaping: \n \r \t \( \) \\ and \ddd octal. */
function decodePdfLiteralString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "n") { out += "\n"; i++; continue; }
      if (next === "r") { out += "\r"; i++; continue; }
      if (next === "t") { out += "\t"; i++; continue; }
      if (next === "(" || next === ")" || next === "\\") { out += next; i++; continue; }
      if (/[0-7]/.test(next)) {
        const octal = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
        out += String.fromCharCode(parseInt(octal, 8));
        i += octal.length;
        continue;
      }
      out += next;
      i++;
      continue;
    }
    out += s[i];
  }
  return out;
}

function extractTextFromContentStream(content: string): { text: string; hadTextOperators: boolean } {
  const btBlocks = content.match(/BT([\s\S]*?)ET/g) ?? [];
  const lines: string[] = [];
  let hadTextOperators = false;

  for (const block of btBlocks) {
    let currentLine: string[] = [];
    // Literal strings: (...) Tj / (...) ' / (...) " ; hex strings: <...> Tj
    const showRegex = /\(((?:[^()\\]|\\.)*)\)\s*Tj|\(((?:[^()\\]|\\.)*)\)\s*'|<([0-9A-Fa-f\s]*)>\s*Tj|\[((?:[^\]])*)\]\s*TJ|(T\*|Td|TD)\b/g;
    let m: RegExpExecArray | null;
    while ((m = showRegex.exec(block))) {
      if (m[1] !== undefined) {
        currentLine.push(decodePdfLiteralString(m[1]));
        hadTextOperators = true;
      } else if (m[2] !== undefined) {
        currentLine.push(decodePdfLiteralString(m[2]));
        hadTextOperators = true;
      } else if (m[3] !== undefined) {
        const hex = m[3].replace(/\s/g, "");
        let s = "";
        for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        currentLine.push(s);
        hadTextOperators = true;
      } else if (m[4] !== undefined) {
        const strings = [...m[4].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((mm) => decodePdfLiteralString(mm[1]));
        if (strings.length) hadTextOperators = true;
        currentLine.push(strings.join(""));
      } else if (m[5] !== undefined) {
        if (currentLine.length) {
          lines.push(currentLine.join(""));
          currentLine = [];
        }
      }
    }
    if (currentLine.length) lines.push(currentLine.join(""));
  }

  return { text: lines.join("\n"), hadTextOperators };
}

function pageHasImageXObject(dictText: string, objects: Map<number, PdfObject>): boolean {
  const resourcesRefs = extractRefs(dictText, "Resources");
  let resourcesDict = dictText;
  if (resourcesRefs.length) {
    const resObj = objects.get(resourcesRefs[0]);
    if (resObj) resourcesDict = resObj.dictText;
  } else if (!/\/Resources/.test(dictText)) {
    return false;
  }
  // Rough heuristic: any XObject reference on a page with (near-)no extractable
  // text is treated as an image-bearing (likely scanned) page.
  return /\/XObject/.test(resourcesDict);
}

/**
 * Extracts text from a DIGITAL PDF buffer. Never OCRs — a page with image
 * XObjects and no text-showing operators is reported OCR_REQUIRED rather
 * than silently skipped or fabricated.
 */
export function extractPdfText(buf: Buffer): PdfExtractionResult {
  if (buf.length < 5 || buf.toString("latin1", 0, 5) !== "%PDF-") {
    return { status: "UNSUPPORTED_STRUCTURE", pages: [], note: "Not a PDF file (missing %PDF- header)" };
  }

  const latin1 = buf.toString("latin1");
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(latin1)) {
    return { status: "ENCRYPTED_NOT_SUPPORTED", pages: [], note: "PDF declares /Encrypt — encrypted PDFs are not supported locally" };
  }

  const objects = findAllObjects(buf);
  if (objects.size === 0) {
    return { status: "UNSUPPORTED_STRUCTURE", pages: [], note: "No PDF objects found via direct object-table scan (likely uses compressed cross-reference/object streams, not supported)" };
  }

  // Find /Root -> /Pages, walk the page tree (last /Root wins — matches the
  // most recent incremental update, same convention real readers use).
  const rootMatches = [...latin1.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  const rootObjNum = rootMatches.length ? parseInt(rootMatches[rootMatches.length - 1][1], 10) : null;
  const rootObj = rootObjNum !== null ? objects.get(rootObjNum) : undefined;

  let pagesRootRefs: number[] = [];
  if (rootObj) {
    pagesRootRefs = extractRefs(rootObj.dictText, "Pages");
  }
  if (pagesRootRefs.length === 0) {
    // Fallback: any object literally declaring /Type /Pages with no /Parent (a root Pages node).
    for (const obj of objects.values()) {
      if (/\/Type\s*\/Pages\b/.test(obj.dictText) && !/\/Parent/.test(obj.dictText)) {
        pagesRootRefs = [obj.objNum];
        break;
      }
    }
  }
  if (pagesRootRefs.length === 0) {
    return { status: "UNSUPPORTED_STRUCTURE", pages: [], note: "Could not locate the page tree root (/Pages)" };
  }

  const pageObjNums: number[] = [];
  const visited = new Set<number>();
  function walk(objNum: number) {
    if (visited.has(objNum)) return;
    visited.add(objNum);
    const obj = objects.get(objNum);
    if (!obj) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(obj.dictText)) {
      pageObjNums.push(objNum);
      return;
    }
    const kids = extractRefs(obj.dictText, "Kids");
    for (const kid of kids) walk(kid);
  }
  for (const ref of pagesRootRefs) walk(ref);

  if (pageObjNums.length === 0) {
    return { status: "UNSUPPORTED_STRUCTURE", pages: [], note: "Page tree resolved but no /Type /Page leaves were found" };
  }

  const pages: PdfPageResult[] = [];
  let anyOcrRequired = false;

  pageObjNums.forEach((objNum, idx) => {
    const pageObj = objects.get(objNum)!;
    const contentRefs = extractRefs(pageObj.dictText, "Contents");
    let combinedText = "";
    let hadTextOperators = false;

    for (const cRef of contentRefs) {
      const contentObj = objects.get(cRef);
      if (!contentObj) continue;
      const decoded = decodeStream(contentObj);
      if (!decoded) continue;
      const { text, hadTextOperators: had } = extractTextFromContentStream(decoded.toString("latin1"));
      if (text) combinedText += (combinedText ? "\n" : "") + text;
      hadTextOperators = hadTextOperators || had;
    }

    if (hadTextOperators && combinedText.trim()) {
      pages.push({ pageNumber: idx + 1, status: "EXTRACTED", text: combinedText });
    } else if (pageHasImageXObject(pageObj.dictText, objects)) {
      anyOcrRequired = true;
      pages.push({ pageNumber: idx + 1, status: "OCR_REQUIRED", text: "" });
    } else {
      pages.push({ pageNumber: idx + 1, status: "EMPTY", text: "" });
    }
  });

  return { status: anyOcrRequired ? "OCR_REQUIRED" : "EXTRACTED", pages };
}
