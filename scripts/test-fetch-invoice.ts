import { getZohoReader } from '../app/lib/zoho-api.ts';
import { getAuditDatabase } from '../app/lib/db/audit-database.ts';

async function main() {
  const db = getAuditDatabase();
  const org = db.prepare('SELECT organization_id FROM audit_zoho_invoices WHERE invoice_number = ? LIMIT 1').get('INV-2627221') as any;
  if (!org) throw new Error('Org not found');
  
  const reader = await getZohoReader();
  const res = await reader.listInvoices(org.organization_id);
  const invMatch = res.invoices.find((i: any) => i.invoice_number === 'INV-2627221');
  if (!invMatch) throw new Error('Invoice not found in list');
  
  const inv = await reader.getInvoice(org.organization_id, invMatch.invoice_id);
  console.log("native salesorder_id:", inv.invoice.salesorder_id);
  console.log("native reference_number:", inv.invoice.reference_number);
}

main().catch(console.error);
