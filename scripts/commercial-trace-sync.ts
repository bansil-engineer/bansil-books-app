import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { readTokenStore } from "../app/lib/zoho-token-store.ts";
import { 
  listSalesOrders, getSalesOrder,
  listPurchaseOrders, getPurchaseOrder,
  listInvoices, getInvoice,
  listBills, getBill,
  listExpenses, getExpense
} from "../app/lib/audit/accounts/zoho-read-transactions.ts";
import crypto from "crypto";

async function run() {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) return;
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;

  const db = getAuditDatabase();
  
  const source_run_id = "run_trace_" + crypto.randomUUID();
  const fetchedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status, api_domain, records_seen, records_written)
    VALUES (?, ?, 'commercial_trace_sync', ?, ?, 'SUCCESS', ?, 0, 0)
  `).run(source_run_id, orgId, fetchedAt, fetchedAt, tokens.api_domain);

  let inserted = 0;
  
  try {
    // 1. Sales Orders
    console.log("Fetching Sales Orders...");
    const soRes = await listSalesOrders(orgId, 50); // Fetch more for local testing
    for (const row of soRes.salesorders || []) {
      const detail = await getSalesOrder(orgId, row.salesorder_id);
      const so = detail.salesorder;
      if (!so) continue;

      const customFieldsJson = so.custom_fields ? JSON.stringify(so.custom_fields) : null;
      const deliveryCustomerName = so.shipping_address?.customer_name || so.customer_name || null;

      db.prepare(`
        INSERT INTO audit_zoho_sales_orders (
          organization_id, salesorder_id, source_run_id, salesorder_number, 
          customer_id, customer_name, delivery_customer_name, date, shipment_date, 
          status, currency, total, custom_fields_json, source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orgId, row.salesorder_id, source_run_id, row.salesorder_number ?? null, 
        row.customer_id ?? null, row.customer_name ?? null, deliveryCustomerName, 
        row.date ?? null, so.shipment_date ?? null, row.status ?? null, 
        row.currency ?? null, row.total ?? null, customFieldsJson, '/books/v3/salesorders', fetchedAt
      );
      
      const lines = so.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_sales_order_lines (
            organization_id, line_item_id, salesorder_id, source_run_id, 
            item_id, item_name, sku, quantity, rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId, line.line_item_id || ("so_line_" + crypto.randomUUID()), 
          row.salesorder_id, source_run_id, line.item_id ?? null, 
          line.name ?? null, line.sku ?? null, line.quantity ?? null, 
          line.rate ?? null, line.item_total ?? null
        );
      }
      inserted++;
    }

    // 2. Purchase Orders
    console.log("Fetching Purchase Orders...");
    const poRes = await listPurchaseOrders(orgId, 50);
    for (const row of poRes.purchaseorders || []) {
      const detail = await getPurchaseOrder(orgId, row.purchaseorder_id);
      const po = detail.purchaseorder;
      if (!po) continue;

      const customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
      const deliveryCustomerName = po.delivery_customer_name || null;

      db.prepare(`
        INSERT INTO audit_zoho_purchase_orders (
          organization_id, purchaseorder_id, source_run_id, purchaseorder_number, 
          vendor_id, vendor_name, delivery_customer_name, date, delivery_date, 
          status, currency, total, custom_fields_json, source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orgId, row.purchaseorder_id, source_run_id, row.purchaseorder_number ?? null, 
        row.vendor_id ?? null, row.vendor_name ?? null, deliveryCustomerName, 
        row.date ?? null, po.delivery_date ?? null, row.status ?? null, 
        row.currency ?? null, row.total ?? null, customFieldsJson, '/books/v3/purchaseorders', fetchedAt
      );
      
      const lines = po.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_purchase_order_lines (
            organization_id, line_item_id, purchaseorder_id, source_run_id, 
            item_id, item_name, sku, quantity, rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId, line.line_item_id || ("po_line_" + crypto.randomUUID()), 
          row.purchaseorder_id, source_run_id, line.item_id ?? null, 
          line.name ?? null, line.sku ?? null, line.quantity ?? null, 
          line.rate ?? null, line.item_total ?? null
        );
      }
      inserted++;
    }

    // 3. Invoices
    console.log("Fetching Invoices...");
    const invRes = await listInvoices(orgId, 50);
    for (const row of invRes.invoices || []) {
      const detail = await getInvoice(orgId, row.invoice_id);
      const inv = detail.invoice;
      if (!inv) continue;

      const customFieldsJson = inv.custom_fields ? JSON.stringify(inv.custom_fields) : null;
      const deliveryCustomerName = inv.shipping_address?.customer_name || inv.customer_name || null;

      db.prepare(`
        INSERT INTO audit_zoho_invoices (
          organization_id, invoice_id, source_run_id, invoice_number, 
          customer_id, delivery_customer_name, salesorder_id, date, due_date, 
          status, total, balance, currency_code, custom_fields_json, 
          source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orgId, row.invoice_id, source_run_id, row.invoice_number ?? null, 
        row.customer_id ?? null, deliveryCustomerName, inv.salesorder_id ?? null, 
        row.date ?? null, inv.due_date ?? null, row.status ?? null, 
        row.total ?? null, row.balance ?? null, row.currency_code ?? null, 
        customFieldsJson, '/books/v3/invoices', fetchedAt
      );
      
      const lines = inv.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_invoice_lines (
            organization_id, line_item_id, invoice_id, source_run_id, 
            item_id, item_name, sku, quantity, rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId, line.line_item_id || ("inv_line_" + crypto.randomUUID()), 
          row.invoice_id, source_run_id, line.item_id ?? null, 
          line.name ?? null, line.sku ?? null, line.quantity ?? null, 
          line.rate ?? null, line.item_total ?? null
        );
      }
      inserted++;
    }

    // 4. Bills
    console.log("Fetching Bills...");
    const billRes = await listBills(orgId, 50);
    for (const row of billRes.bills || []) {
      const detail = await getBill(orgId, row.bill_id);
      const bill = detail.bill;
      if (!bill) continue;

      const customFieldsJson = bill.custom_fields ? JSON.stringify(bill.custom_fields) : null;

      db.prepare(`
        INSERT INTO audit_zoho_bills (
          organization_id, bill_id, source_run_id, bill_number, 
          vendor_id, vendor_name, purchaseorder_id, date, due_date, 
          status, currency, total, balance, custom_fields_json, 
          source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orgId, row.bill_id, source_run_id, row.bill_number ?? null, 
        row.vendor_id ?? null, row.vendor_name ?? null, bill.purchaseorder_id ?? null, 
        row.date ?? null, bill.due_date ?? null, row.status ?? null, 
        row.currency_code ?? null, row.total ?? null, row.balance ?? null, 
        customFieldsJson, '/books/v3/bills', fetchedAt
      );
      
      const lines = bill.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_bill_lines (
            organization_id, line_item_id, bill_id, source_run_id, 
            item_id, item_name, sku, quantity, rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId, line.line_item_id || ("bill_line_" + crypto.randomUUID()), 
          row.bill_id, source_run_id, line.item_id ?? null, 
          line.name ?? null, line.sku ?? null, line.quantity ?? null, 
          line.rate ?? null, line.item_total ?? null
        );
      }
      inserted++;
    }

    // 5. Expenses
    console.log("Fetching Expenses...");
    const eRes = await listExpenses(orgId, 50);
    for (const row of eRes.expenses || []) {
      db.prepare(`
        INSERT INTO audit_zoho_expenses (organization_id, expense_id, source_run_id, date, account_id, account_name, paid_through_account_id, vendor_id, amount, currency, reference_number, status, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, row.expense_id, source_run_id, row.date ?? null, row.account_id ?? null, row.account_name ?? null, row.paid_through_account_id ?? null, row.vendor_id ?? null, row.amount ?? null, row.currency_code ?? null, row.reference_number ?? null, row.status ?? null, fetchedAt);
      inserted++;
    }
  } catch (e) {
    console.error("Sync error:", e);
  }

  db.prepare(`UPDATE audit_zoho_source_runs SET records_written = ? WHERE source_run_id = ?`).run(inserted, source_run_id);
  console.log(`COMMERCIAL TRACE SYNC COMPLETE: ${inserted} root records persisted under run ${source_run_id}.`);
}

run().catch(console.error);
