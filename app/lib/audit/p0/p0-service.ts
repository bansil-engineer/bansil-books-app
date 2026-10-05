import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface P0Alert {
  alert_id: string;
  alert_type: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  source_key: string;
  detection_state: string;
  affected_amount: number | null;
  requires_professional_review: number;
  evidence_json: string;
  recommended_action: string | null;
  created_at: string;
  updated_at: string;
}

export function listP0Alerts(auditDb: DatabaseSync): P0Alert[] {
  return auditDb.prepare("SELECT * FROM audit_p0_alerts ORDER BY created_at DESC").all() as unknown as P0Alert[];
}

export function getP0Alert(auditDb: DatabaseSync, id: string): P0Alert | null {
  const row = auditDb.prepare("SELECT * FROM audit_p0_alerts WHERE alert_id = ?").get(id) as P0Alert | undefined;
  return row ?? null;
}

export function updateP0AlertStatus(auditDb: DatabaseSync, id: string, status: string): boolean {
  const result = auditDb.prepare("UPDATE audit_p0_alerts SET status = ?, updated_at = ? WHERE alert_id = ?").run(
    status,
    new Date().toISOString(),
    id
  );
  return result.changes > 0;
}

export function syncP0Alerts(mainDb: DatabaseSync, auditDb: DatabaseSync): { added: number } {
  let added = 0;
  
  // Example P0 check: Negative Inventory Balance in items table (if we had stock on hand)
  // For safety, we will just do a placeholder scan of purchase_bill_line_items vs sales_invoice_line_items
  // to find negative quantities or sales below cost.
  
  // Here we'll do a simple mock detection to demonstrate the schema works,
  // since real P0 rules depend on exact business requirements.
  
  // 1. Check for negative quantities on sales invoices
  const negativeSales = mainDb.prepare(`
    SELECT invoice_id, item_id, item_name, quantity, rate 
    FROM sales_invoice_line_items 
    WHERE quantity < 0
  `).all() as any[];

  for (const sale of negativeSales) {
    const existing = auditDb.prepare("SELECT alert_id FROM audit_p0_alerts WHERE source_key = ? AND alert_type = 'NEGATIVE_SALES_QUANTITY'").get(`sales_invoice_line_item:${sale.invoice_id}:${sale.item_id}`);
    if (!existing) {
      auditDb.prepare(`
        INSERT INTO audit_p0_alerts (
          alert_id, alert_type, title, description, severity, status, source_key, detection_state, affected_amount, requires_professional_review, evidence_json, recommended_action, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        'NEGATIVE_SALES_QUANTITY',
        'Negative Sales Quantity Detected',
        `Invoice ${sale.invoice_id} has a negative quantity (${sale.quantity}) for item ${sale.item_name}.`,
        'CRITICAL',
        'OPEN',
        `sales_invoice_line_item:${sale.invoice_id}:${sale.item_id}`,
        'NEW',
        null,
        1,
        JSON.stringify({ invoice_id: sale.invoice_id, item_id: sale.item_id, quantity: sale.quantity }),
        'Review invoice line item to ensure it is not a data entry error.',
        new Date().toISOString(),
        new Date().toISOString()
      );
      added++;
    }
  }

  return { added };
}
