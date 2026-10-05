// ============================================================
// Bansil Books Analytics — Immutable Evidence File Storage (Milestone B)
// Stores uploaded originals outside public/static, under an opaque
// filename. Never overwrites an existing file — a revised upload is
// always a NEW file_id / new source version, never a replacement of
// the bytes behind an existing one.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "data", "audit_uploads");

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_CSV_ROWS = 200_000;
export const MAX_XLSX_ROWS_PER_SHEET = 200_000;
export const MAX_PDF_PAGES = 500;

export type SupportedFileType = "PDF" | "XLSX" | "CSV";

export function detectFileType(originalFilename: string): SupportedFileType | null {
  const lower = originalFilename.toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".xlsx")) return "XLSX";
  if (lower.endsWith(".csv")) return "CSV";
  return null; // XLS/DOCX/images intentionally NOT advertised or accepted — unsupported.
}

export interface StoredFile {
  fileId: string;
  storagePath: string; // relative to data/audit_uploads/
  sha256: string;
  sizeBytes: number;
}

/** Persists an immutable original under an opaque id. Never overwrites. */
export function storeUploadedFile(buffer: Buffer): StoredFile {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const fileId = randomUUID();
  const storagePath = `${fileId}.bin`;
  const fullPath = path.join(UPLOAD_DIR, storagePath);
  fs.writeFileSync(fullPath, buffer, { flag: "wx" }); // fails loudly if it somehow already exists
  return {
    fileId,
    storagePath,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
  };
}

export function readStoredFile(storagePath: string): Buffer {
  const fullPath = path.join(UPLOAD_DIR, storagePath);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) {
    throw new Error("Refusing to read outside the evidence storage directory");
  }
  return fs.readFileSync(resolved);
}
