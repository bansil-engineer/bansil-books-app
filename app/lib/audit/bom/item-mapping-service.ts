// ============================================================
// Bansil Books Analytics — Owner-Approved Item Mapping (Match Priority #3)
// Maps a supplied component line's own item identifier to the canonical
// BOM component_item_id it should match. Never auto-created — every row
// is an explicit OWNER approval. Description-only similarity may surface
// a candidate elsewhere but must never write a row here automatically.
// ============================================================

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export class ItemMappingError extends Error {}

export interface ItemMappingRecord {
  mapping_id: string;
  source_item_identifier: string;
  canonical_component_item_id: string;
  canonical_component_sku: string | null;
  status: "ACTIVE" | "DISABLED";
  approved_by: string;
  approved_at: string;
  notes: string | null;
  created_at: string;
}

export function listItemMappings(db: DatabaseSync): ItemMappingRecord[] {
  return db.prepare(`SELECT * FROM audit_item_mappings ORDER BY created_at DESC`).all() as unknown as ItemMappingRecord[];
}

export function findActiveMapping(db: DatabaseSync, sourceItemIdentifier: string): ItemMappingRecord | null {
  const row = db
    .prepare(`SELECT * FROM audit_item_mappings WHERE source_item_identifier = ? AND status = 'ACTIVE'`)
    .get(sourceItemIdentifier) as ItemMappingRecord | undefined;
  return row ?? null;
}

/** OWNER-only. Explicit approval required for every mapping — never invented from description similarity. */
export function createItemMapping(
  db: DatabaseSync,
  input: { sourceItemIdentifier: string; canonicalComponentItemId: string; canonicalComponentSku?: string; notes?: string },
  actor: string
): ItemMappingRecord {
  const existing = db.prepare(`SELECT mapping_id FROM audit_item_mappings WHERE source_item_identifier = ?`).get(input.sourceItemIdentifier);
  if (existing) throw new ItemMappingError("A mapping for this source item identifier already exists — disable it first, or edit via update.");
  const mappingId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_item_mappings (mapping_id, source_item_identifier, canonical_component_item_id, canonical_component_sku, status, approved_by, approved_at, notes, created_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`
  ).run(mappingId, input.sourceItemIdentifier, input.canonicalComponentItemId, input.canonicalComponentSku ?? null, actor, now, input.notes ?? null, now);
  return db.prepare(`SELECT * FROM audit_item_mappings WHERE mapping_id = ?`).get(mappingId) as unknown as ItemMappingRecord;
}

export function setItemMappingStatus(db: DatabaseSync, mappingId: string, status: "ACTIVE" | "DISABLED"): ItemMappingRecord {
  const existing = db.prepare(`SELECT * FROM audit_item_mappings WHERE mapping_id = ?`).get(mappingId);
  if (!existing) throw new ItemMappingError("Item mapping not found.");
  db.prepare(`UPDATE audit_item_mappings SET status = ? WHERE mapping_id = ?`).run(status, mappingId);
  return db.prepare(`SELECT * FROM audit_item_mappings WHERE mapping_id = ?`).get(mappingId) as unknown as ItemMappingRecord;
}
