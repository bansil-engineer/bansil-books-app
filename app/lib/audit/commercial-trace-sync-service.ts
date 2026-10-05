import { getAuditDatabase } from "../db/audit-database";
import { readTokenStore } from "../zoho-token-store";
import {
  listSalesOrders, getSalesOrder,
  listPurchaseOrders, getPurchaseOrder,
  listInvoices, getInvoice,
  listBills, getBill,
  listExpenses, getExpense
} from "./accounts/zoho-read-transactions";
import crypto from "crypto";
import {
  validateActiveMappingsForDocuments,
  type MappingValidationSummary,
} from "./manual-line-mapping-service.ts";
import {
  validateActiveInvoiceMappingsForDocuments,
  type InvoiceMappingValidationSummary,
} from "./invoice-line-mapping-service.ts";

export async function syncCommercialTrace(period: any) {
  const tokens = readTokenStore();
  if (!tokens || !tokens.access_token) {
    throw new Error("Zoho not connected");
  }
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "";

  const db = getAuditDatabase();
  const source_run_id = "COMMERCIAL_TRACE_ACTIVE";
  const fetchedAt = new Date().toISOString();

  // UPSERT the source run (outside transaction — metadata only)
  db.prepare(`
    INSERT INTO audit_zoho_source_runs (source_run_id, organization_id, source_type, started_at, completed_at, status, api_domain, records_seen, records_written)
    VALUES (?, ?, 'commercial_trace_sync', ?, ?, 'SUCCESS', ?, 0, 0)
    ON CONFLICT(source_run_id) DO UPDATE SET completed_at=excluded.completed_at
  `).run(source_run_id, orgId, fetchedAt, fetchedAt, tokens.api_domain);

  // ============================================================
  // PHASE A — NETWORK READ (no write transaction open)
  // ============================================================

  // 1. Sales Orders — fetch all list + detail
  const soRes = await listSalesOrders(orgId, 200);
  const soDetails: Array<{ row: any; so: any; customFieldsJson: string | null; deliveryCustomerName: string | null }> = [];
  for (const row of soRes.salesorders || []) {
    const detail = await getSalesOrder(orgId, row.salesorder_id);
    const so = detail.salesorder;
    if (!so) continue;
    const customFieldsJson = so.custom_fields ? JSON.stringify(so.custom_fields) : null;
    const deliveryCustomerName = so.shipping_address?.customer_name || so.customer_name || null;
    soDetails.push({ row, so, customFieldsJson, deliveryCustomerName });
  }

  // 2. Purchase Orders — fetch all list + detail
  const poRes = await listPurchaseOrders(orgId, 200);
  const poDetails: Array<{ row: any; po: any; customFieldsJson: string | null; deliveryCustomerName: string | null }> = [];
  for (const row of poRes.purchaseorders || []) {
    const detail = await getPurchaseOrder(orgId, row.purchaseorder_id);
    const po = detail.purchaseorder;
    if (!po) continue;
    const customFieldsJson = po.custom_fields ? JSON.stringify(po.custom_fields) : null;
    const deliveryCustomerName = po.delivery_customer_name || null;
    poDetails.push({ row, po, customFieldsJson, deliveryCustomerName });
  }

  // 3. Invoices — fetch all list + detail
  const invRes = await listInvoices(orgId, 200);
  const invDetails: Array<{ row: any; inv: any; customFieldsJson: string | null; deliveryCustomerName: string | null }> = [];
  for (const row of invRes.invoices || []) {
    const detail = await getInvoice(orgId, row.invoice_id);
    const inv = detail.invoice;
    if (!inv) continue;
    const customFieldsJson = inv.custom_fields ? JSON.stringify(inv.custom_fields) : null;
    const deliveryCustomerName = inv.shipping_address?.customer_name || inv.customer_name || null;
    invDetails.push({ row, inv, customFieldsJson, deliveryCustomerName });
  }

  // 4. Bills — fetch all list + detail
  const billRes = await listBills(orgId, 200);
  const billDetails: Array<{ row: any; bill: any; customFieldsJson: string | null }> = [];
  for (const row of billRes.bills || []) {
    const detail = await getBill(orgId, row.bill_id);
    const bill = detail.bill;
    if (!bill) continue;
    const customFieldsJson = bill.custom_fields ? JSON.stringify(bill.custom_fields) : null;
    billDetails.push({ row, bill, customFieldsJson });
  }

  // 5. Expenses — list only (no detail fetch)
  const eRes = await listExpenses(orgId, 200);

  // ============================================================
  // PHASE B — NORMALIZE (counters prepared in memory)
  // ============================================================
  let created = 0;
  let updated = 0;

  // ============================================================
  // PHASE C–E — SHORT WRITE TRANSACTION (no network calls)
  // ============================================================
  db.exec('BEGIN TRANSACTION');

  try {
    // 1. Persist Sales Orders
    for (const { row, so, customFieldsJson, deliveryCustomerName } of soDetails) {
      db.prepare(`
        INSERT INTO audit_zoho_sales_orders (
          organization_id, salesorder_id, source_run_id, salesorder_number,
          customer_id, customer_name, delivery_customer_name, date, shipment_date,
          status, currency, total, sub_total, tax_total, adjustment, is_inclusive_tax, discount_total, discount_type, is_discount_before_tax, custom_fields_json, source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, salesorder_id, source_run_id) DO UPDATE SET
          salesorder_number=excluded.salesorder_number,
          customer_id=excluded.customer_id,
          customer_name=excluded.customer_name,
          delivery_customer_name=excluded.delivery_customer_name,
          date=excluded.date,
          shipment_date=excluded.shipment_date,
          status=excluded.status,
          currency=excluded.currency,
          total=excluded.total,
          sub_total=excluded.sub_total,
          tax_total=excluded.tax_total,
          adjustment=excluded.adjustment,
          is_inclusive_tax=excluded.is_inclusive_tax,
          discount_total=excluded.discount_total,
          discount_type=excluded.discount_type,
          is_discount_before_tax=excluded.is_discount_before_tax,
          custom_fields_json=excluded.custom_fields_json,
          fetched_at=excluded.fetched_at
      `).run(
        orgId, row.salesorder_id, source_run_id, row.salesorder_number ?? null,
        row.customer_id ?? null, row.customer_name ?? null, deliveryCustomerName,
        row.date ?? null, so.shipment_date ?? null, row.status ?? null,
        row.currency ?? null, row.total ?? null,
        so.sub_total ?? null, so.tax_total ?? null, so.adjustment ?? null, so.is_inclusive_tax ? 1 : 0, so.discount_total ?? null, so.discount_type ?? null, so.is_discount_before_tax ? 1 : 0,
        customFieldsJson, '/books/v3/salesorders', fetchedAt
      );

      const lines = so.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_sales_order_lines (
            organization_id, line_item_id, salesorder_id, source_run_id,
            item_id, item_name, description, sku, quantity, rate, amount, unit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, line_item_id, source_run_id) DO UPDATE SET
            item_name=excluded.item_name,
            quantity=excluded.quantity,
            rate=excluded.rate,
            amount=excluded.amount,
            description=excluded.description,
            unit=excluded.unit
        `).run(
          orgId, line.line_item_id || ("so_line_" + crypto.randomUUID()),
          row.salesorder_id, source_run_id, line.item_id ?? null,
          line.name ?? null, line.description ?? null, line.sku ?? null, line.quantity ?? null,
          line.rate ?? null, line.item_total ?? null, line.unit ?? null
        );
      }
      created++;
    }

    // 2. Persist Purchase Orders
    for (const { row, po, customFieldsJson, deliveryCustomerName } of poDetails) {
      db.prepare(`
        INSERT INTO audit_zoho_purchase_orders (
          organization_id, purchaseorder_id, source_run_id, purchaseorder_number,
          vendor_id, vendor_name, delivery_customer_name, date, delivery_date,
          status, currency, total, sub_total, tax_total, adjustment, is_inclusive_tax, discount_total, discount_type, is_discount_before_tax, custom_fields_json, source_endpoint, fetched_at,
          submitter_id, submitted_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, purchaseorder_id, source_run_id) DO UPDATE SET
          purchaseorder_number=excluded.purchaseorder_number,
          vendor_id=excluded.vendor_id,
          vendor_name=excluded.vendor_name,
          delivery_customer_name=excluded.delivery_customer_name,
          date=excluded.date,
          delivery_date=excluded.delivery_date,
          status=excluded.status,
          currency=excluded.currency,
          total=excluded.total,
          sub_total=excluded.sub_total,
          tax_total=excluded.tax_total,
          adjustment=excluded.adjustment,
          is_inclusive_tax=excluded.is_inclusive_tax,
          discount_total=excluded.discount_total,
          discount_type=excluded.discount_type,
          is_discount_before_tax=excluded.is_discount_before_tax,
          custom_fields_json=excluded.custom_fields_json,
          fetched_at=excluded.fetched_at,
          submitter_id=excluded.submitter_id,
          submitted_by_name=excluded.submitted_by_name
      `).run(
        orgId, row.purchaseorder_id, source_run_id, row.purchaseorder_number ?? null,
        row.vendor_id ?? null, row.vendor_name ?? null, deliveryCustomerName,
        row.date ?? null, po.delivery_date ?? null, row.status ?? null,
        row.currency ?? null, row.total ?? null,
        po.sub_total ?? null, po.tax_total ?? null, po.adjustment ?? null, po.is_inclusive_tax ? 1 : 0, po.discount_total ?? null, po.discount_type ?? null, po.is_discount_before_tax ? 1 : 0,
        customFieldsJson, '/books/v3/purchaseorders', fetchedAt,
        po.submitter_id ?? null, po.submitted_by_name ?? null
      );

      const lines = po.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_purchase_order_lines (
            organization_id, line_item_id, purchaseorder_id, source_run_id,
            item_id, item_name, description, sku, quantity, rate, amount, unit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, line_item_id, source_run_id) DO UPDATE SET
            item_name=excluded.item_name,
            quantity=excluded.quantity,
            rate=excluded.rate,
            amount=excluded.amount,
            description=excluded.description,
            unit=excluded.unit
        `).run(
          orgId, line.line_item_id || ("po_line_" + crypto.randomUUID()),
          row.purchaseorder_id, source_run_id, line.item_id ?? null,
          line.name ?? null, line.description ?? null, line.sku ?? null, line.quantity ?? null,
          line.rate ?? null, line.item_total ?? null, line.unit ?? null
        );
      }
      created++;
    }

    // 3. Persist Invoices
    for (const { row, inv, customFieldsJson, deliveryCustomerName } of invDetails) {
      db.prepare(`
        INSERT INTO audit_zoho_invoices (
          organization_id, invoice_id, source_run_id, invoice_number,
          customer_id, delivery_customer_name, salesorder_id, date, due_date,
          status, total, balance, currency_code, sub_total, tax_total, total_taxable_amount, adjustment, is_inclusive_tax, discount_total, discount_type, is_discount_before_tax, tds_amount, retention_amount, custom_fields_json,
          source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, invoice_id, source_run_id) DO UPDATE SET
          invoice_number=excluded.invoice_number,
          salesorder_id=excluded.salesorder_id,
          date=excluded.date,
          status=excluded.status,
          total=excluded.total,
          balance=excluded.balance,
          sub_total=excluded.sub_total,
          tax_total=excluded.tax_total,
          total_taxable_amount=excluded.total_taxable_amount,
          adjustment=excluded.adjustment,
          is_inclusive_tax=excluded.is_inclusive_tax,
          discount_total=excluded.discount_total,
          discount_type=excluded.discount_type,
          is_discount_before_tax=excluded.is_discount_before_tax,
          tds_amount=excluded.tds_amount,
          retention_amount=excluded.retention_amount,
          custom_fields_json=excluded.custom_fields_json,
          fetched_at=excluded.fetched_at
      `).run(
        orgId, row.invoice_id, source_run_id, row.invoice_number ?? null,
        row.customer_id ?? null, deliveryCustomerName, inv.salesorder_id ?? null,
        row.date ?? null, inv.due_date ?? null, row.status ?? null,
        row.total ?? null, row.balance ?? null, row.currency_code ?? null,
        inv.sub_total ?? null, inv.tax_total ?? null, inv.total_taxable_amount ?? null, inv.adjustment ?? null, inv.is_inclusive_tax ? 1 : 0, inv.discount_total ?? null, inv.discount_type ?? null, inv.is_discount_before_tax ? 1 : 0, inv.tds_amount ?? null, inv.total_retention_amount ?? null,
        customFieldsJson, '/books/v3/invoices', fetchedAt
      );

      const lines = inv.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_invoice_lines (
            organization_id, line_item_id, invoice_id, source_run_id,
            item_id, item_name, description, sku, quantity, rate, amount, unit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, line_item_id, source_run_id) DO UPDATE SET
            quantity=excluded.quantity,
            rate=excluded.rate,
            amount=excluded.amount,
            description=excluded.description,
            unit=excluded.unit
        `).run(
          orgId, line.line_item_id || ("inv_line_" + crypto.randomUUID()),
          row.invoice_id, source_run_id, line.item_id ?? null,
          line.name ?? null, line.description ?? null, line.sku ?? null, line.quantity ?? null,
          line.rate ?? null, line.item_total ?? null, line.unit ?? null
        );
      }
      created++;
    }

    // 4. Persist Bills
    for (const { row, bill, customFieldsJson } of billDetails) {
      db.prepare(`
        INSERT INTO audit_zoho_bills (
          organization_id, bill_id, source_run_id, bill_number,
          vendor_id, vendor_name, purchaseorder_id, date, due_date,
          status, currency, total, balance, sub_total, tax_total, total_taxable_amount, adjustment, is_inclusive_tax, discount_total, discount_type, is_discount_before_tax, tds_amount, retention_amount, custom_fields_json,
          source_endpoint, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, bill_id, source_run_id) DO UPDATE SET
          bill_number=excluded.bill_number,
          purchaseorder_id=excluded.purchaseorder_id,
          date=excluded.date,
          status=excluded.status,
          total=excluded.total,
          balance=excluded.balance,
          sub_total=excluded.sub_total,
          tax_total=excluded.tax_total,
          total_taxable_amount=excluded.total_taxable_amount,
          adjustment=excluded.adjustment,
          is_inclusive_tax=excluded.is_inclusive_tax,
          discount_total=excluded.discount_total,
          discount_type=excluded.discount_type,
          is_discount_before_tax=excluded.is_discount_before_tax,
          tds_amount=excluded.tds_amount,
          retention_amount=excluded.retention_amount,
          custom_fields_json=excluded.custom_fields_json,
          fetched_at=excluded.fetched_at
      `).run(
        orgId, row.bill_id, source_run_id, row.bill_number ?? null,
        row.vendor_id ?? null, row.vendor_name ?? null, bill.purchaseorder_id ?? null,
        row.date ?? null, bill.due_date ?? null, row.status ?? null,
        row.currency_code ?? null, row.total ?? null, row.balance ?? null,
        bill.sub_total ?? null, bill.tax_total ?? null, bill.total_taxable_amount ?? null, bill.adjustment ?? null, bill.is_inclusive_tax ? 1 : 0, bill.discount_total ?? null, bill.discount_type ?? null, bill.is_discount_before_tax ? 1 : 0, bill.tds_amount ?? null, bill.total_retention_amount ?? null,
        customFieldsJson, '/books/v3/bills', fetchedAt
      );

      const lines = bill.line_items || [];
      for (const line of lines) {
        db.prepare(`
          INSERT INTO audit_zoho_bill_lines (
            organization_id, line_item_id, bill_id, source_run_id,
            item_id, item_name, sku, quantity, rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id, line_item_id, source_run_id) DO UPDATE SET
            quantity=excluded.quantity,
            rate=excluded.rate,
            amount=excluded.amount
        `).run(
          orgId, line.line_item_id || ("bill_line_" + crypto.randomUUID()),
          row.bill_id, source_run_id, line.item_id ?? null,
          line.name ?? null, line.sku ?? null, line.quantity ?? null,
          line.rate ?? null, line.item_total ?? null
        );
      }
      created++;
    }

    // 5. Persist Expenses
    for (const row of eRes.expenses || []) {
      db.prepare(`
        INSERT INTO audit_zoho_expenses (organization_id, expense_id, source_run_id, date, account_id, account_name, paid_through_account_id, vendor_id, amount, currency, reference_number, status, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, expense_id, source_run_id) DO UPDATE SET
          date=excluded.date,
          amount=excluded.amount,
          status=excluded.status,
          fetched_at=excluded.fetched_at
      `).run(orgId, row.expense_id, source_run_id, row.date ?? null, row.account_id ?? null, row.account_name ?? null, row.paid_through_account_id ?? null, row.vendor_id ?? null, row.amount ?? null, row.currency_code ?? null, row.reference_number ?? null, row.status ?? null, fetchedAt);
      created++;
    }

    db.exec('COMMIT');

  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // ============================================================
  // PHASE F — POST-COMMIT MANUAL SO↔PO MAPPING STALE VALIDATION
  // Local committed evidence only (no network, no AI). Bounded to the exact
  // SO/PO documents written above. A validation failure never rolls back the
  // committed source evidence; it is surfaced via mappingValidation.
  // ============================================================
  const writtenSalesOrderIds = soDetails.filter(({ row }) => row?.salesorder_id).map(({ row }) => String(row.salesorder_id));
  const writtenPurchaseOrderIds = poDetails.filter(({ row }) => row?.purchaseorder_id).map(({ row }) => String(row.purchaseorder_id));
  let mappingValidation: MappingValidationSummary;
  try {
    mappingValidation = validateActiveMappingsForDocuments(db, {
      organizationId: orgId,
      purchaseorderIds: writtenPurchaseOrderIds,
      salesorderIds: writtenSalesOrderIds,
    });
  } catch (e: any) {
    mappingValidation = {
      checked: 0, stillValid: 0, markedReviewRequired: 0, missingLines: 0,
      failed: 1, error: e?.message || String(e),
    };
  }
  if (mappingValidation.failed > 0) {
    console.warn(`[commercial-trace-sync] Manual mapping stale validation incomplete: ${mappingValidation.failed} failed — ${mappingValidation.error ?? "unknown error"}`);
  }

  // R1C: Invoice→SO mapping stale validation (same phase, same pattern)
  const writtenInvoiceIds = invDetails.filter(({ row }) => row?.invoice_id).map(({ row }) => String(row.invoice_id));
  let invoiceMappingValidation: InvoiceMappingValidationSummary;
  try {
    invoiceMappingValidation = validateActiveInvoiceMappingsForDocuments(db, {
      organizationId: orgId,
      invoiceIds: writtenInvoiceIds,
      salesorderIds: writtenSalesOrderIds,
    });
  } catch (e: any) {
    invoiceMappingValidation = {
      checked: 0, stillValid: 0, markedReviewRequired: 0, missingLines: 0,
      failed: 1, error: e?.message || String(e),
    };
  }
  if (invoiceMappingValidation.failed > 0) {
    console.warn(`[commercial-trace-sync] Invoice mapping stale validation incomplete: ${invoiceMappingValidation.failed} failed — ${invoiceMappingValidation.error ?? "unknown error"}`);
  }

  return { created, updated, unchanged: 0, failed: 0, checked: created, mappingValidation, invoiceMappingValidation };
}
