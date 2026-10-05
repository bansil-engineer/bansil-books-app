import { syncApprovalPendingDocument } from './app/lib/audit/approval-pending-sync.ts';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE audit_zoho_source_runs (source_run_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, source_type TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL DEFAULT 'RUNNING', api_domain TEXT, records_seen INTEGER DEFAULT 0, records_written INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0, error_message TEXT);
  CREATE TABLE audit_section_syncs (section_key TEXT PRIMARY KEY, period_from TEXT, period_to TEXT, all_periods INTEGER DEFAULT 0, started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, records_checked INTEGER DEFAULT 0, records_created INTEGER DEFAULT 0, records_updated INTEGER DEFAULT 0, records_unchanged INTEGER DEFAULT 0, records_failed INTEGER DEFAULT 0, last_error TEXT);
  CREATE TABLE audit_zoho_invoices (organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, source_run_id TEXT NOT NULL, invoice_number TEXT, customer_id TEXT, delivery_customer_name TEXT, salesorder_id TEXT, date TEXT, due_date TEXT, status TEXT, total REAL, balance REAL, currency_code TEXT, custom_fields_json TEXT, source_endpoint TEXT, fetched_at TEXT NOT NULL, submitter_id TEXT, submitted_by_name TEXT, PRIMARY KEY(organization_id, invoice_id, source_run_id));
  CREATE TABLE audit_zoho_invoice_lines (organization_id TEXT NOT NULL, line_item_id TEXT NOT NULL, invoice_id TEXT NOT NULL, source_run_id TEXT NOT NULL, item_id TEXT, item_name TEXT, description TEXT, quantity REAL, rate REAL, amount REAL, PRIMARY KEY(organization_id, line_item_id, source_run_id));
  CREATE TABLE audit_zoho_sales_orders (organization_id TEXT NOT NULL, salesorder_id TEXT NOT NULL, source_run_id TEXT NOT NULL, salesorder_number TEXT, customer_id TEXT, customer_name TEXT, delivery_customer_name TEXT, date TEXT, shipment_date TEXT, status TEXT, currency TEXT, total REAL, custom_fields_json TEXT, source_endpoint TEXT, fetched_at TEXT NOT NULL, submitter_id TEXT, submitted_by_name TEXT, PRIMARY KEY(organization_id, salesorder_id, source_run_id));
  CREATE TABLE audit_zoho_sales_order_lines (organization_id TEXT NOT NULL, line_item_id TEXT NOT NULL, salesorder_id TEXT NOT NULL, source_run_id TEXT NOT NULL, item_id TEXT, item_name TEXT, description TEXT, sku TEXT, quantity REAL, rate REAL, amount REAL, unit TEXT, PRIMARY KEY(organization_id, line_item_id, source_run_id));
  CREATE TABLE audit_zoho_purchase_orders (organization_id TEXT NOT NULL, purchaseorder_id TEXT NOT NULL, source_run_id TEXT NOT NULL, purchaseorder_number TEXT, vendor_id TEXT, vendor_name TEXT, delivery_customer_name TEXT, date TEXT, delivery_date TEXT, status TEXT, currency TEXT, total REAL, custom_fields_json TEXT, source_endpoint TEXT, fetched_at TEXT NOT NULL, submitter_id TEXT, submitted_by_name TEXT, reference_number TEXT, PRIMARY KEY(organization_id, purchaseorder_id, source_run_id));
  CREATE TABLE audit_zoho_purchase_order_lines (organization_id TEXT NOT NULL, line_item_id TEXT NOT NULL, purchaseorder_id TEXT NOT NULL, source_run_id TEXT NOT NULL, item_id TEXT, item_name TEXT, description TEXT, sku TEXT, quantity REAL, rate REAL, amount REAL, unit TEXT, PRIMARY KEY(organization_id, line_item_id, source_run_id));
  CREATE TABLE audit_zoho_bills (organization_id TEXT NOT NULL, bill_id TEXT NOT NULL, source_run_id TEXT NOT NULL, bill_number TEXT, vendor_id TEXT, vendor_name TEXT, purchaseorder_id TEXT, date TEXT, due_date TEXT, status TEXT, currency TEXT, currency_code TEXT, total REAL, balance REAL, custom_fields_json TEXT, source_endpoint TEXT, fetched_at TEXT NOT NULL, submitted_by_name TEXT, submitter_id TEXT, PRIMARY KEY(organization_id, bill_id, source_run_id));
  CREATE TABLE audit_zoho_bill_lines (organization_id TEXT NOT NULL, line_item_id TEXT NOT NULL, bill_id TEXT NOT NULL, source_run_id TEXT NOT NULL, item_id TEXT, item_name TEXT, description TEXT, quantity REAL, rate REAL, amount REAL, PRIMARY KEY(organization_id, line_item_id, source_run_id));
`);

const ORG = 'org_inv_sync_test';
const badCases: any[] = [null, 'not-an-array', [{ api_name: 'unrelated', value: 'foo' }], [{ api_name: 'cf_sales_order_no', value: null }], [{ api_name: 'cf_sales_order_no', value: '' }]];

for (const badCf of badCases) {
  const id = 'inv_t10_' + crypto.randomUUID().slice(0, 8);
  const invData = {
    invoice_id: id,
    invoice_number: 'INV-T10',
    customer_id: 'cust_1',
    salesorder_id: null,
    date: '2026-09-20',
    due_date: '2026-10-20',
    status: 'pending_approval',
    total: 10000,
    balance: 10000,
    currency_code: 'INR',
    custom_fields: badCf,
    line_items: [{ line_item_id: 'il_1', item_id: 'itm_1', name: 'Steel Plate', quantity: 100, rate: 100, item_total: 10000, description: 'Standard plate' }],
  };

  const reader: any = {
    getInvoice: async () => ({ invoice: invData }),
    listPurchaseOrders: async () => { throw new Error('no'); },
    listBills: async () => { throw new Error('no'); },
    listInvoices: async () => { throw new Error('no'); },
    getPurchaseOrder: async () => { throw new Error('no'); },
    getBill: async () => { throw new Error('no'); },
    getSalesOrder: async () => { throw new Error('no'); },
  };

  try {
    const res = await syncApprovalPendingDocument(
      { type: 'INVOICE', id: id, number: 'INV-T10' },
      { db, orgId: ORG, reader }
    );
    console.log(`cf=${JSON.stringify(badCf)} → ${res.status} ${res.result} err=${res.error || 'none'}`);
  } catch (e: any) {
    console.log(`cf=${JSON.stringify(badCf)} → EXCEPTION: ${e.message}`);
  }
}
