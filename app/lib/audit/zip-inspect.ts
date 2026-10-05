// ============================================================
// Bansil Books Analytics — Minimal ZIP Inspector (read-only)
// Parses the ZIP central directory and decompresses individual
// entries for PREVIEW ONLY. This module never executes, requires,
// imports, or shells out to any entry it reads — it only returns
// filenames + decoded text for human review in Settings > Skills.
// No third-party zip dependency: uses node:zlib inflateRawSync,
// which the Node runtime already ships.
// ============================================================

import zlib from "node:zlib";

export interface ZipEntryInfo {
  path: string;
  sizeBytes: number;
  method: number; // 0 = stored, 8 = deflate
  isDirectory: boolean;
  /** Internal — local file header offset, used by readZipEntryBytes(). */
  localHeaderOffset: number;
  /** Internal — on-disk (compressed) size, used by readZipEntryBytes(). */
  compressedSize: number;
}

export interface ZipInspection {
  entries: ZipEntryInfo[];
  /** Decoded UTF-8 text content, keyed by entry path, for small text-like files only. */
  textByPath: Record<string, string>;
}

const TEXT_EXTENSIONS = [".md", ".txt", ".json", ".yaml", ".yml", ".cfg", ".ini"];
const MAX_TEXT_ENTRY_BYTES = 512 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buf: Buffer): number {
  const maxScan = Math.min(buf.length, 65557); // max comment length + EOCD size
  const start = buf.length - maxScan;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("Not a valid ZIP archive (End Of Central Directory not found)");
}

/**
 * Reads the full central directory + inflates text-like entries.
 * Throws on structurally invalid archives — callers must treat that
 * as a BLOCKED / rejected upload, never as an empty-but-valid package.
 */
export function inspectZipBuffer(buf: Buffer): ZipInspection {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntryInfo[] = [];
  const textByPath: Record<string, string> = {};

  let ptr = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(ptr);
    if (sig !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Corrupt ZIP central directory at entry ${i}`);
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    const isDirectory = name.endsWith("/");

    entries.push({ path: name, sizeBytes: uncompressedSize, method, isDirectory, localHeaderOffset, compressedSize });

    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    const isSkillManifest = /(^|\/)SKILL\.md$/i.test(name);
    if (!isDirectory && (TEXT_EXTENSIONS.includes(ext) || isSkillManifest) && uncompressedSize <= MAX_TEXT_ENTRY_BYTES) {
      try {
        textByPath[name] = readLocalFileEntryText(buf, localHeaderOffset, method, compressedSize);
      } catch {
        // Unreadable/unsupported compression for this single entry — skip its text,
        // the entry itself still appears in `entries` for hash/manifest review.
      }
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return { entries, textByPath };
}

function readLocalFileEntryText(buf: Buffer, localOffset: number, method: number, compressedSize: number): string {
  return readLocalFileEntryBytes(buf, localOffset, method, compressedSize).toString("utf8");
}

function readLocalFileEntryBytes(buf: Buffer, localOffset: number, method: number, compressedSize: number): Buffer {
  const sig = buf.readUInt32LE(localOffset);
  if (sig !== LOCAL_FILE_SIGNATURE) throw new Error("Corrupt ZIP local file header");
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return Buffer.from(raw);
  if (method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported compression method ${method}`);
}

/**
 * Reads any single entry's decompressed bytes by its ZipEntryInfo (from
 * inspectZipBuffer's `entries` list) — for archive formats that are
 * themselves ZIPs (e.g. XLSX/OOXML), where the entries of interest
 * (worksheet XML, sharedStrings.xml) are not in the text-preview allowlist.
 */
export function readZipEntryBytes(buf: Buffer, entry: ZipEntryInfo): Buffer {
  return readLocalFileEntryBytes(buf, entry.localHeaderOffset, entry.method, entry.compressedSize);
}
