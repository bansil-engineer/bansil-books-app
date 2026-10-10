import path from "node:path";

export function getRuntimeDbDir(): string {
  if (process.env.BANSIL_RUNTIME_DB_DIR) {
    return path.resolve(process.env.BANSIL_RUNTIME_DB_DIR);
  }
  return path.join(process.cwd(), "data");
}

export function getBansilBooksDbPath(): string {
  if (process.env.BANSIL_BOOKS_DB_PATH) {
    return path.resolve(process.env.BANSIL_BOOKS_DB_PATH);
  }
  return path.join(getRuntimeDbDir(), "bansil_books.db");
}

export function getAuditWorkspaceDbPath(): string {
  if (process.env.AUDIT_WORKSPACE_DB_PATH) {
    return path.resolve(process.env.AUDIT_WORKSPACE_DB_PATH);
  }
  return path.join(getRuntimeDbDir(), "audit_workspace.db");
}

/**
 * OA-U2: dedicated authentication store (users, permissions, invitations,
 * token revocations, auth audit log). Deliberately a SEPARATE file from
 * bansil_books.db / audit_workspace.db so that the paired data-DB swap in
 * docker-entrypoint.sh can never replace or roll back user accounts.
 * Only opened when AUTH_USER_STORE=db (see app/lib/auth-store.ts).
 */
export function getAuthDbPath(): string {
  if (process.env.AUTH_DB_PATH) {
    return path.resolve(process.env.AUTH_DB_PATH);
  }
  return path.join(getRuntimeDbDir(), "auth.db");
}

export function getAiWorkspaceDbPath(): string {
  if (process.env.AI_WORKSPACE_DB_PATH) {
    return path.resolve(process.env.AI_WORKSPACE_DB_PATH);
  }
  return path.join(getRuntimeDbDir(), "ai_workspace.db");
}

export function getEstimationDbPath(): string {
  if (process.env.ESTIMATION_DB_PATH) {
    return path.resolve(process.env.ESTIMATION_DB_PATH);
  }
  return path.join(getRuntimeDbDir(), "estimation", "estimation.sqlite");
}

export function getMasterAuditV2DbPath(): string {
  return path.join(getRuntimeDbDir(), "master-audit-v2", "db", "master-audit-v2.sqlite");
}
