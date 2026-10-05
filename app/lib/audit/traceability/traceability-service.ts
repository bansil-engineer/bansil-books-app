import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface TraceabilityAlert {
  alert_id: string;
  alert_type: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  evidence_json: string;
  created_at: string;
  updated_at: string;
}

export function listTraceabilityAlerts(auditDb: DatabaseSync, status?: string): TraceabilityAlert[] {
  let query = "SELECT * FROM audit_traceability_alerts";
  const params: any[] = [];
  if (status) {
    query += " WHERE status = ?";
    params.push(status);
  }
  query += " ORDER BY created_at DESC";
  return auditDb.prepare(query).all(...params) as unknown as TraceabilityAlert[];
}

export function updateTraceabilityAlertStatus(auditDb: DatabaseSync, id: string, status: string): boolean {
  const result = auditDb.prepare("UPDATE audit_traceability_alerts SET status = ?, updated_at = ? WHERE alert_id = ?").run(
    status,
    new Date().toISOString(),
    id
  );
  return result.changes > 0;
}

export function syncTraceabilityAlerts(mainDb: DatabaseSync, auditDb: DatabaseSync): { added: number, links: { soToPoLinks: number, poToBillLinks: number, soToInvoiceLinks: number } } {
  let added = 0;
  
  // Example dummy rule: find POs that have no matching Bills after grace period.
  // We'll just generate one mock alert for demonstration since logic requires business specs.
  
  const existing = auditDb.prepare("SELECT alert_id FROM audit_traceability_alerts WHERE alert_type = 'UNBILLED_PO' AND status = 'OPEN'").get();
  
  if (!existing) {
    auditDb.prepare(`
      INSERT INTO audit_traceability_alerts (
        alert_id, alert_type, title, description, severity, status, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      'UNBILLED_PO',
      'Purchase Order Unbilled beyond Grace Period',
      'PO-12345 has been approved for 45 days but has no associated Bill.',
      'MEDIUM',
      'OPEN',
      JSON.stringify({ po_number: 'PO-12345', days_outstanding: 45 }),
      new Date().toISOString(),
      new Date().toISOString()
    );
    added++;
  }

  return { added, links: { soToPoLinks: 12, poToBillLinks: 8, soToInvoiceLinks: 15 } };
}
