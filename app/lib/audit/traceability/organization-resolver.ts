// ============================================================
// Bansil Books Analytics — Item Traceability Organization ID Resolver
// The token store's own organization_id field is only populated by an
// explicit "select organization" step this app's OAuth flow doesn't
// always trigger (e.g. right after a fresh reconnect) — falls back to
// the locally-cached `organizations` table, the same pattern already
// used by app/lib/db/sync-engine.ts, rather than inventing a new path.
// ============================================================

import { readTokenStore } from "../../zoho-token-store.ts";
import { getDatabase } from "../../db/database.ts";

export function resolveOrganizationId(): string | null {
  const store = readTokenStore();
  if (store?.organization_id) return store.organization_id;
  const db = getDatabase();
  const row = db.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get() as { organization_id: string } | undefined;
  return row?.organization_id ?? null;
}
