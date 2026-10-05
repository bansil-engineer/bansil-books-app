import { randomUUID } from "node:crypto";
import { storeUploadedFile, detectFileType } from "../../audit/intake/file-storage.ts";
import { getEstimationDatabase } from "../../db/estimation-database.ts";
import type { EstimationDocument, EstimationDocumentType } from "./types.ts";
import { fingerprintContent } from "./evidence.ts";

export interface IntakeResult {
  success: boolean;
  document?: EstimationDocument;
  error?: string;
  violations?: string[];
}

export function intakeEstimationDocument(
  projectId: string,
  familyKey: string,
  type: EstimationDocumentType,
  originalFilename: string,
  buffer: Buffer,
  revisionLabel?: string
): IntakeResult {
  const format = detectFileType(originalFilename);
  if (!format) {
    return {
      success: false,
      error: "UNSUPPORTED_FORMAT",
      violations: ["ONLY_PDF_XLSX_CSV_SUPPORTED"]
    };
  }

  // SHA-256 for evidence validation in estimation domain
  const sha256 = fingerprintContent(buffer);

  // Store the original bytes immutably
  const stored = storeUploadedFile(buffer);

  const db = getEstimationDatabase();

  // Find max revision for this project + family
  const maxRevRow = db.prepare(`
    SELECT MAX(revision) as maxRev FROM estimation_documents
    WHERE project_id = ? AND family_key = ?
  `).get(projectId, familyKey) as { maxRev: number | null };

  const newRevision = maxRevRow.maxRev !== null ? maxRevRow.maxRev + 1 : 0;

  const documentId = randomUUID();
  const receivedAt = new Date().toISOString();

  // Begin transaction to update old document status and insert new one
  db.exec("BEGIN TRANSACTION");
  try {
    if (newRevision > 0) {
      db.prepare(`
        UPDATE estimation_documents
        SET status = 'SUPERSEDED', superseded_by_document_id = ?
        WHERE project_id = ? AND family_key = ? AND status = 'CURRENT'
      `).run(documentId, projectId, familyKey);
    }

    db.prepare(`
      INSERT INTO estimation_documents (
        document_id, project_id, type, family_key, revision, revision_label,
        format, source_id, received_at, sha256, status, storage_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      documentId,
      projectId,
      type,
      familyKey,
      newRevision,
      revisionLabel || null,
      format,
      "A_TENDER_RFQ_UPLOAD",
      receivedAt,
      sha256,
      "CURRENT",
      stored.storagePath
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const doc: EstimationDocument = {
    documentId,
    projectId,
    type,
    familyKey,
    revision: newRevision,
    revisionLabel,
    format,
    sourceId: "A_TENDER_RFQ_UPLOAD",
    receivedAt,
    sha256,
    status: "CURRENT",
  };

  return { success: true, document: doc };
}

export function getEstimationDocumentsForProject(projectId: string): EstimationDocument[] {
  const db = getEstimationDatabase();
  const rows = db.prepare(`
    SELECT * FROM estimation_documents WHERE project_id = ? ORDER BY revision ASC
  `).all(projectId) as any[];

  return rows.map(row => ({
    documentId: row.document_id,
    projectId: row.project_id,
    type: row.type as EstimationDocumentType,
    familyKey: row.family_key,
    revision: row.revision,
    revisionLabel: row.revision_label,
    format: row.format,
    sourceId: row.source_id,
    receivedAt: row.received_at,
    sha256: row.sha256,
    status: row.status,
    supersededByDocumentId: row.superseded_by_document_id
  }));
}
