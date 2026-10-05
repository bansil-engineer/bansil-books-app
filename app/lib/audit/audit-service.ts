// ============================================================
// Bansil Books Analytics — Audit Workspace & Skills Service
// (Milestone A: shell + registry only — no matching/OCR/AI here.)
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuditDatabase } from "../db/audit-database.ts";
import { guardSkillPackage, type SkillGuardResult } from "./skill-guard.ts";

export type ComparisonMode = "INTERNAL_EXTERNAL" | "EXTERNAL_EXTERNAL" | "INTERNAL_INTERNAL";
export type SkillVersionStatus =
  | "DRAFT"
  | "VALIDATING"
  | "TESTED"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "DISABLED"
  | "ARCHIVED";

export interface AuditWorkspaceRecord {
  workspace_id: string;
  name: string;
  comparison_mode: ComparisonMode;
  purpose: string | null;
  entity_id: string | null;
  entity_name: string | null;
  period_from: string | null;
  period_to: string | null;
  amount_basis: string | null;
  status: string;
  pinned_skill_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuditWorkspaceSourceRecord {
  source_id: string;
  workspace_id: string;
  role_label: string;
  source_origin: "INTERNAL" | "EXTERNAL";
  origin_description: string | null;
  provenance: string | null;
  source_version_ref: string | null;
  basis_note: string | null;
  notes: string | null;
  created_at: string;
}

export interface AuditSkillRecord {
  skill_id: string;
  name: string;
  module_scope: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface AuditSkillVersionRecord {
  version_id: string;
  skill_id: string;
  version: string;
  status: SkillVersionStatus;
  package_filename: string;
  package_sha256: string;
  package_size_bytes: number;
  manifest_json: string;
  guard_verdict: "PASS" | "BLOCKED";
  guard_reasons_json: string;
  validation_report_json: string | null;
  replaces_version_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function resolveDb(conn?: DatabaseSync): DatabaseSync {
  return conn ?? getAuditDatabase();
}

export function recordAuditEvent(
  conn: DatabaseSync,
  eventType: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
  actor: string = "OWNER"
): void {
  conn
    .prepare(
      `INSERT INTO audit_events (event_id, event_type, entity_type, entity_id, details_json, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), eventType, entityType, entityId, JSON.stringify(details), actor, new Date().toISOString());
}

export function listAuditEvents(limit: number = 200, conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as Record<string, unknown>[];
}

// ---------------- Workspaces ----------------

export interface CreateWorkspaceInput {
  name: string;
  comparisonMode: ComparisonMode;
  purpose?: string;
  entityId?: string;
  entityName?: string;
  periodFrom?: string;
  periodTo?: string;
  amountBasis?: string;
  createdBy?: string;
  sources: Array<{
    roleLabel: string;
    sourceOrigin: "INTERNAL" | "EXTERNAL";
    originDescription?: string;
    provenance?: string;
    sourceVersionRef?: string;
    basisNote?: string;
    notes?: string;
  }>;
}

export function createWorkspace(input: CreateWorkspaceInput, dbConn?: DatabaseSync): AuditWorkspaceRecord {
  const conn = resolveDb(dbConn);
  const now = new Date().toISOString();
  const workspaceId = randomUUID();

  conn
    .prepare(
      `INSERT INTO audit_workspaces
        (workspace_id, name, comparison_mode, purpose, entity_id, entity_name, period_from, period_to, amount_basis, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`
    )
    .run(
      workspaceId,
      input.name,
      input.comparisonMode,
      input.purpose ?? null,
      input.entityId ?? null,
      input.entityName ?? null,
      input.periodFrom ?? null,
      input.periodTo ?? null,
      input.amountBasis ?? null,
      input.createdBy ?? "OWNER",
      now,
      now
    );

  for (const source of input.sources) {
    conn
      .prepare(
        `INSERT INTO audit_workspace_sources
          (source_id, workspace_id, role_label, source_origin, origin_description, provenance, source_version_ref, basis_note, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        workspaceId,
        source.roleLabel,
        source.sourceOrigin,
        source.originDescription ?? null,
        source.provenance ?? null,
        source.sourceVersionRef ?? null,
        source.basisNote ?? null,
        source.notes ?? null,
        now
      );
  }

  recordAuditEvent(conn, "WORKSPACE_CREATED", "workspace", workspaceId, {
    name: input.name,
    comparisonMode: input.comparisonMode,
    sourceCount: input.sources.length,
  });

  return getWorkspace(workspaceId, conn)!;
}

export function listWorkspaces(conn?: DatabaseSync): AuditWorkspaceRecord[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_workspaces ORDER BY created_at DESC`)
    .all() as unknown as AuditWorkspaceRecord[];
}

export function getWorkspace(workspaceId: string, conn?: DatabaseSync): AuditWorkspaceRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM audit_workspaces WHERE workspace_id = ?`).get(workspaceId);
  return (row as unknown as AuditWorkspaceRecord) ?? null;
}

export function getWorkspaceSources(workspaceId: string, conn?: DatabaseSync): AuditWorkspaceSourceRecord[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_workspace_sources WHERE workspace_id = ? ORDER BY created_at ASC`)
    .all(workspaceId) as unknown as AuditWorkspaceSourceRecord[];
}

export interface AddWorkspaceSourceInput {
  roleLabel: string;
  sourceOrigin: "INTERNAL" | "EXTERNAL";
  originDescription?: string;
  provenance?: string;
  sourceVersionRef?: string;
  basisNote?: string;
  notes?: string;
}

/** Adds one more source slot to an existing workspace (Milestone B: uploads happen after workspace creation, not only at creation time). */
export function addWorkspaceSource(workspaceId: string, input: AddWorkspaceSourceInput, actor: string, conn?: DatabaseSync): AuditWorkspaceSourceRecord {
  const db = resolveDb(conn);
  const workspace = getWorkspace(workspaceId, db);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  const sourceId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_workspace_sources
      (source_id, workspace_id, role_label, source_origin, origin_description, provenance, source_version_ref, basis_note, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceId,
    workspaceId,
    input.roleLabel,
    input.sourceOrigin,
    input.originDescription ?? null,
    input.provenance ?? null,
    input.sourceVersionRef ?? null,
    input.basisNote ?? null,
    input.notes ?? null,
    now
  );

  recordAuditEvent(db, "WORKSPACE_SOURCE_ADDED", "workspace_source", sourceId, { workspaceId, roleLabel: input.roleLabel, sourceOrigin: input.sourceOrigin }, actor);

  return db.prepare(`SELECT * FROM audit_workspace_sources WHERE source_id = ?`).get(sourceId) as unknown as AuditWorkspaceSourceRecord;
}

export class WorkspacePinError extends Error {}

/**
 * Pins a workspace to one immutable skill VERSION row (not the mutable
 * skill/module-scope binding). Because audit_skill_versions rows are never
 * rewritten or deleted — only their lifecycle columns change — this pin
 * keeps resolving to the exact same package_sha256/manifest_json forever,
 * even after that skill is later replaced or rolled back for new runs.
 * There is no "unpin"; a workspace may only be re-pointed to a different
 * explicit version by calling this again, which is itself an auditable event.
 */
export function pinWorkspaceSkillVersion(
  workspaceId: string,
  versionId: string,
  actor: string = "OWNER",
  conn?: DatabaseSync
): AuditWorkspaceRecord {
  const db = resolveDb(conn);

  const workspace = getWorkspace(workspaceId, db);
  if (!workspace) throw new WorkspacePinError(`Workspace ${workspaceId} not found`);

  const version = getSkillVersion(versionId, db);
  if (!version) throw new WorkspacePinError(`Skill version ${versionId} not found`);

  const previousPin = workspace.pinned_skill_version_id;
  const now = new Date().toISOString();

  db.prepare(`UPDATE audit_workspaces SET pinned_skill_version_id = ?, updated_at = ? WHERE workspace_id = ?`).run(
    versionId,
    now,
    workspaceId
  );

  recordAuditEvent(
    db,
    "WORKSPACE_SKILL_PINNED",
    "workspace",
    workspaceId,
    { previousPin, newPin: versionId, pinnedPackageSha256: version.package_sha256 },
    actor
  );

  return getWorkspace(workspaceId, db)!;
}

// ---------------- Skills registry ----------------

export interface UploadSkillDraftInput {
  skillName: string;
  moduleScope: string;
  description?: string;
  version: string;
  packageFilename: string;
  packageBuffer: Buffer;
  createdBy?: string;
  replacesVersionId?: string;
}

export interface UploadSkillDraftResult {
  skill: AuditSkillRecord;
  version: AuditSkillVersionRecord;
  guard: SkillGuardResult;
}

/**
 * Imports a skill package as an immutable DRAFT version. Never activates it.
 * The guard result is stored permanently alongside the version — a BLOCKED
 * verdict still creates the row (so a reviewer can see why) but the API
 * layer must refuse to move a BLOCKED version's status forward.
 */
export function uploadSkillDraft(input: UploadSkillDraftInput, dbConn?: DatabaseSync): UploadSkillDraftResult {
  const conn = resolveDb(dbConn);
  const now = new Date().toISOString();

  const guard = guardSkillPackage(input.packageBuffer);

  let skill = conn.prepare(`SELECT * FROM audit_skills WHERE name = ?`).get(input.skillName) as
    | AuditSkillRecord
    | undefined;

  if (!skill) {
    const skillId = randomUUID();
    conn
      .prepare(
        `INSERT INTO audit_skills (skill_id, name, module_scope, description, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(skillId, input.skillName, input.moduleScope, input.description ?? null, input.createdBy ?? "OWNER", now);
    skill = conn.prepare(`SELECT * FROM audit_skills WHERE skill_id = ?`).get(skillId) as unknown as AuditSkillRecord;
  }

  const versionId = randomUUID();
  const manifest = {
    entries: guard.entries,
    manifestPreview: guard.manifestText?.slice(0, 20000) ?? null,
  };

  conn
    .prepare(
      `INSERT INTO audit_skill_versions
        (version_id, skill_id, version, status, package_filename, package_sha256, package_size_bytes,
         manifest_json, guard_verdict, guard_reasons_json, replaces_version_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      versionId,
      skill.skill_id,
      input.version,
      input.packageFilename,
      guard.packageSha256,
      guard.packageSizeBytes,
      JSON.stringify(manifest),
      guard.verdict,
      JSON.stringify(guard.reasons),
      input.replacesVersionId ?? null,
      input.createdBy ?? "OWNER",
      now,
      now
    );

  recordAuditEvent(conn, "SKILL_UPLOADED", "skill_version", versionId, {
    skillName: input.skillName,
    version: input.version,
    guardVerdict: guard.verdict,
    guardReasons: guard.reasons,
    sha256: guard.packageSha256,
  });

  const versionRow = conn.prepare(`SELECT * FROM audit_skill_versions WHERE version_id = ?`).get(versionId) as unknown as AuditSkillVersionRecord;

  return { skill, version: versionRow, guard };
}

export function listSkills(conn?: DatabaseSync): AuditSkillRecord[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_skills ORDER BY created_at DESC`)
    .all() as unknown as AuditSkillRecord[];
}

export function listSkillVersions(skillId: string, conn?: DatabaseSync): AuditSkillVersionRecord[] {
  return resolveDb(conn)
    .prepare(`SELECT * FROM audit_skill_versions WHERE skill_id = ? ORDER BY created_at DESC`)
    .all(skillId) as unknown as AuditSkillVersionRecord[];
}

export function getSkillVersion(versionId: string, conn?: DatabaseSync): AuditSkillVersionRecord | null {
  const row = resolveDb(conn).prepare(`SELECT * FROM audit_skill_versions WHERE version_id = ?`).get(versionId);
  return (row as unknown as AuditSkillVersionRecord) ?? null;
}

type LifecycleAction = "VALIDATE" | "MARK_TESTED" | "SUBMIT_FOR_APPROVAL" | "APPROVE_AND_ACTIVATE" | "DEACTIVATE" | "ARCHIVE";

const ALLOWED_TRANSITIONS: Record<LifecycleAction, { from: SkillVersionStatus[]; to: SkillVersionStatus }> = {
  VALIDATE: { from: ["DRAFT"], to: "VALIDATING" },
  MARK_TESTED: { from: ["VALIDATING"], to: "TESTED" },
  SUBMIT_FOR_APPROVAL: { from: ["TESTED"], to: "PENDING_APPROVAL" },
  APPROVE_AND_ACTIVATE: { from: ["PENDING_APPROVAL"], to: "ACTIVE" },
  DEACTIVATE: { from: ["ACTIVE"], to: "DISABLED" },
  ARCHIVE: { from: ["DISABLED"], to: "ARCHIVED" },
};

export class SkillLifecycleError extends Error {}

/**
 * The only function permitted to change a skill version's lifecycle fields.
 * It NEVER touches package_filename / package_sha256 / manifest_json /
 * guard_verdict / guard_reasons_json — those are immutable from insert.
 * APPROVE_AND_ACTIVATE requires an explicit approvedBy identity (never
 * auto-activation) and a PASS guard verdict; it also disables any other
 * ACTIVE version currently bound to the same module scope, recording the
 * prior active version id in the audit event as rollback metadata.
 */
export function transitionSkillVersion(
  versionId: string,
  action: LifecycleAction,
  actor: string,
  moduleScope?: string,
  dbConn?: DatabaseSync
): AuditSkillVersionRecord {
  const conn = resolveDb(dbConn);
  const version = getSkillVersion(versionId, conn);
  if (!version) throw new SkillLifecycleError(`Skill version ${versionId} not found`);

  const rule = ALLOWED_TRANSITIONS[action];
  if (!rule.from.includes(version.status)) {
    throw new SkillLifecycleError(
      `Cannot ${action} a version in status ${version.status}. Allowed from: ${rule.from.join(", ")}`
    );
  }

  if (action === "APPROVE_AND_ACTIVATE") {
    if (version.guard_verdict !== "PASS") {
      throw new SkillLifecycleError(
        "This version's content guard verdict is BLOCKED. It cannot be approved or activated until a new version resolves the flagged content."
      );
    }
    if (!actor || actor === "SYSTEM") {
      throw new SkillLifecycleError("Activation requires an explicit named reviewer identity — auto-activation is disabled.");
    }
  }

  const now = new Date().toISOString();
  const skill = conn.prepare(`SELECT * FROM audit_skills WHERE skill_id = ?`).get(version.skill_id) as unknown as AuditSkillRecord;
  const scope = moduleScope ?? skill.module_scope;

  let previousActiveVersionId: string | null = null;

  if (action === "APPROVE_AND_ACTIVATE") {
    const existingBinding = conn
      .prepare(`SELECT * FROM audit_module_skill_bindings WHERE module_scope = ?`)
      .get(scope) as { binding_id: string; active_version_id: string | null } | undefined;

    if (existingBinding?.active_version_id && existingBinding.active_version_id !== versionId) {
      previousActiveVersionId = existingBinding.active_version_id;
      conn
        .prepare(`UPDATE audit_skill_versions SET status = 'DISABLED', deactivated_at = ?, updated_at = ? WHERE version_id = ? AND status = 'ACTIVE'`)
        .run(now, now, existingBinding.active_version_id);
    }

    conn
      .prepare(
        `UPDATE audit_skill_versions
         SET status = 'ACTIVE', approved_by = ?, approved_at = ?, activated_at = ?, updated_at = ?
         WHERE version_id = ?`
      )
      .run(actor, now, now, now, versionId);

    if (existingBinding) {
      conn
        .prepare(`UPDATE audit_module_skill_bindings SET skill_id = ?, active_version_id = ?, updated_at = ? WHERE module_scope = ?`)
        .run(version.skill_id, versionId, now, scope);
    } else {
      conn
        .prepare(
          `INSERT INTO audit_module_skill_bindings (binding_id, module_scope, skill_id, active_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), scope, version.skill_id, versionId, now, now);
    }
  } else {
    const setClauses: string[] = ["status = ?", "updated_at = ?"];
    const params: unknown[] = [rule.to, now];
    if (action === "DEACTIVATE") {
      setClauses.push("deactivated_at = ?");
      params.push(now);
    }
    if (action === "ARCHIVE") {
      setClauses.push("archived_at = ?");
      params.push(now);
    }
    params.push(versionId);
    conn.prepare(`UPDATE audit_skill_versions SET ${setClauses.join(", ")} WHERE version_id = ?`).run(...params);
  }

  recordAuditEvent(
    conn,
    `SKILL_VERSION_${action}`,
    "skill_version",
    versionId,
    { previousStatus: version.status, newStatus: rule.to, moduleScope: scope, previousActiveVersionId },
    actor
  );

  return getSkillVersion(versionId, conn)!;
}

/**
 * Deletes an unused DRAFT skill version — the one lifecycle action that
 * removes a row rather than transitioning it, matching
 * "delete unused draft/archive used version" from the original spec.
 * Only ever allowed while status is exactly DRAFT: nothing that has ever
 * been validated, tested, approved, activated or bound to a module may be
 * deleted — ARCHIVE is the only path once a version has left DRAFT, so
 * used-version history can never be erased this way.
 */
export function deleteDraftSkillVersion(versionId: string, actor: string = "OWNER", conn?: DatabaseSync): void {
  const db = resolveDb(conn);
  const version = getSkillVersion(versionId, db);
  if (!version) throw new SkillLifecycleError(`Skill version ${versionId} not found`);
  if (version.status !== "DRAFT") {
    throw new SkillLifecycleError(
      `Only a DRAFT version may be deleted (current status: ${version.status}). Use ARCHIVE to retire a used version instead.`
    );
  }

  recordAuditEvent(
    db,
    "SKILL_VERSION_DELETED_DRAFT",
    "skill_version",
    versionId,
    {
      version: version.version,
      packageFilename: version.package_filename,
      packageSha256: version.package_sha256,
      guardVerdictAtDeletion: version.guard_verdict,
    },
    actor
  );

  db.prepare(`DELETE FROM audit_skill_versions WHERE version_id = ? AND status = 'DRAFT'`).run(versionId);
}

export function listModuleSkillBindings(conn?: DatabaseSync): Record<string, unknown>[] {
  return resolveDb(conn)
    .prepare(
      `SELECT b.*, s.name as skill_name, v.version as active_version_label, v.status as active_version_status
       FROM audit_module_skill_bindings b
       JOIN audit_skills s ON s.skill_id = b.skill_id
       LEFT JOIN audit_skill_versions v ON v.version_id = b.active_version_id
       ORDER BY b.module_scope ASC`
    )
    .all() as unknown as Record<string, unknown>[];
}
