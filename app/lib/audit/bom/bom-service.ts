import { DatabaseSync } from "node:sqlite";

export interface BomMaster {
  bom_id: string;
  item_id: string;
  version: string;
  status: string;
  created_at: string;
}

export interface BomComponent {
  component_id: string;
  bom_id: string;
  component_item_id: string;
  component_sku: string | null;
  component_description: string | null;
  uom: string | null;
  qty_per_composite_unit: string;
}

export function getActiveBom(auditDb: DatabaseSync, itemId: string): BomMaster | null {
  const row = auditDb.prepare(
    "SELECT * FROM audit_bom_master WHERE composite_item_id = ? AND status = 'ACTIVE' LIMIT 1"
  ).get(itemId) as unknown as BomMaster | undefined;
  return row ?? null;
}

export function listComponents(auditDb: DatabaseSync, bomId: string): BomComponent[] {
  return auditDb.prepare(
    "SELECT * FROM audit_bom_components WHERE bom_version_id = ?"
  ).all(bomId) as unknown as BomComponent[];
}
