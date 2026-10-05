import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

const BOUNDED_INVOICE_IDS = [
  "3166667000018330415",
  "3166667000015978355",
  "3166667000018330339",
  "3166667000018330370",
  "3166667000018330379",
  "3166667000018330451",
  "3166667000018330459",
];

async function syncBoundedSalesInvoices() {
  console.log("STARTING SYNC...");
  const db = getAuditDatabase();
  
  const { token, store: tokens } = await getValidAccessToken();
  const orgId = tokens.organization_id || process.env.ZOHO_DEFAULT_ORG_ID;
  if (!orgId) throw new Error("No organization_id found in token store");
  if (!token) throw new Error("No access_token found in token store");

  const runId = `RUN-3B-SALES-${Date.now()}`;
  db.prepare(`
    INSERT INTO audit_zoho_source_runs (
      source_run_id, organization_id, source_type, started_at, completed_at, status, records_seen, records_written
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, orgId, "INVOICES", new Date().toISOString(), new Date().toISOString(), "COMPLETED", BOUNDED_INVOICE_IDS.length, BOUNDED_INVOICE_IDS.length
  );

  let successCount = 0;

  for (const invoiceId of BOUNDED_INVOICE_IDS) {
    const url = `${tokens.api_domain}/books/v3/invoices/${invoiceId}?organization_id=${orgId}`;
    const res = await secureZohoFetch(url, { headers: { "Authorization": `Zoho-oauthtoken ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to fetch Invoice ${invoiceId}: ${res.status} ${res.statusText}`);
      console.error(text);
      continue;
    }

    const data = await res.json();
    const inv = data.invoice;
    if (!inv) {
      console.error(`No invoice object for ${invoiceId}`);
      continue;
    }

    // Inspect for adjustments (TDS, discounts, etc)
    console.log(`\n--- INSPECTING INVOICE ${invoiceId} ---`);
    console.log(`Total: ${inv.total}, Balance: ${inv.balance}`);
    console.log("Keys containing 'tds' or 'withhold' or 'tax' or 'discount' or 'adjustment':");
    const checkKeys = Object.keys(inv).filter(k => 
      k.toLowerCase().includes('tds') || 
      k.toLowerCase().includes('withhold') || 
      k.toLowerCase().includes('discount') || 
      k.toLowerCase().includes('tax') || 
      k.toLowerCase().includes('adjust') ||
      k.toLowerCase().includes('advance') ||
      k.toLowerCase().includes('write_off')
    );
    for (const key of checkKeys) {
      if (inv[key] !== 0 && inv[key] !== null && inv[key] !== undefined && inv[key] !== "") {
        console.log(`  ${key}: ${inv[key]}`);
      }
    }
    
    // Also check taxes
    if (inv.taxes && inv.taxes.length > 0) {
      console.log(`  Taxes array:`, JSON.stringify(inv.taxes));
    }

    db.prepare(`
      INSERT INTO audit_zoho_invoices (
        organization_id, invoice_id, source_run_id, invoice_number,
        customer_id, salesorder_id, date, due_date, status, total,
        balance, currency_code, source_endpoint, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orgId, inv.invoice_id, runId, inv.invoice_number,
      inv.customer_id, inv.salesorder_id || null, inv.date, inv.due_date, inv.status, inv.total,
      inv.balance, inv.currency_code, "/invoices/{id}", new Date().toISOString()
    );

    if (inv.line_items) {
      for (const line of inv.line_items) {
        db.prepare(`
          INSERT INTO audit_zoho_invoice_lines (
            organization_id, line_item_id, invoice_id, source_run_id,
            item_id, item_name, sku, quantity, rate, amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId, line.line_item_id, inv.invoice_id, runId,
          line.item_id, line.name, line.sku, line.quantity, line.rate, line.item_total
        );
      }
    }
    
    // Discover non-zero explicit adjustments and persist them
    if (inv.discount && inv.discount > 0) {
      db.prepare(`
        INSERT INTO audit_zoho_sales_adjustments (
          organization_id, invoice_id, source_run_id, adjustment_type, source_field_name, amount, currency, reference_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, inv.invoice_id, runId, 'DISCOUNT', 'discount', inv.discount, inv.currency_code, inv.date);
    }

    if (inv.adjustment && inv.adjustment !== 0) {
       db.prepare(`
        INSERT INTO audit_zoho_sales_adjustments (
          organization_id, invoice_id, source_run_id, adjustment_type, source_field_name, amount, currency, reference_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, inv.invoice_id, runId, 'ADJUSTMENT', 'adjustment', inv.adjustment, inv.currency_code, inv.date);
    }
    
    if (inv.credits && Array.isArray(inv.credits) && inv.credits.length > 0) {
      console.log(`  Credits array:`, JSON.stringify(inv.credits));
    }

    successCount++;
  }

  console.log(`\nSuccessfully persisted ${successCount} bounded invoices under run ${runId}`);
  
  // Verify 7-Invoice Payment Allocation Math
  const cpId = "3166667000019016185";
  const allocs = db.prepare(`SELECT * FROM audit_zoho_customer_payment_allocations WHERE payment_id = ?`).all(cpId) as any[];
  console.log(`\n=== 15. VERIFY THE PROVEN 7-INVOICE PAYMENT ===`);
  console.log(`CP ID: ${cpId}`);
  console.log(`Allocations Count: ${allocs.length}`);
  const sumAllocs = allocs.reduce((a, b) => a + b.amount_applied, 0);
  console.log(`Sum of Allocations: ${sumAllocs}`);
}

syncBoundedSalesInvoices().catch(console.error);
