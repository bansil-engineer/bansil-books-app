import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { evaluateSalesSettlement } from "../app/lib/audit/reconciliation/sales-engine.ts";
import type { SalesReconciliationResult } from "../app/lib/audit/reconciliation/sales-engine.ts";

const BOUNDED_INVOICE_IDS = [
  "3166667000018330415",
  "3166667000015978355",
  "3166667000018330339",
  "3166667000018330370",
  "3166667000018330379",
  "3166667000018330451",
  "3166667000018330459",
];

async function runSalesEngineFoundation() {
  console.log("=== PHASE 2E.3B: SALES ENGINE FOUNDATION ===");
  const db = getAuditDatabase();

  const results: SalesReconciliationResult[] = [];
  
  for (const invoiceId of BOUNDED_INVOICE_IDS) {
    console.log(`\n--- EVALUATING INVOICE ${invoiceId} ---`);
    
    // Get latest snapshot of the invoice
    const invoice = db.prepare(`
      SELECT * FROM audit_zoho_invoices 
      WHERE invoice_id = ? 
      ORDER BY fetched_at DESC LIMIT 1
    `).get(invoiceId) as any;

    if (!invoice) {
      console.log(`Invoice ${invoiceId} not found in DB!`);
      continue;
    }

    // Get allocations for this invoice
    const allocations = db.prepare(`
      SELECT * FROM audit_zoho_customer_payment_allocations 
      WHERE invoice_id = ?
    `).all(invoiceId) as any[];

    console.log(`Found ${allocations.length} allocations for invoice.`);

    const input = {
      invoice,
      paymentAllocations: allocations,
      payments: [],
      paymentAccounts: [],
      bankTransactions: [], // Not populated yet
      creditAdjustments: [],
      futureTdsAdjustments: []
    };

    const result = evaluateSalesSettlement(input);
    results.push(result);

    console.log(`Status: ${result.status}`);
    console.log(`Invoice Total: ${result.amounts.invoiceTotal}`);
    console.log(`Allocated Total: ${result.amounts.allocatedTotal}`);
    console.log(`Unallocated Balance: ${result.amounts.unallocatedBalance}`);
    
    if (result.alerts.length > 0) {
      console.log(`Alerts:`);
      for (const alert of result.alerts) {
        console.log(`  - [${alert.severity}] ${alert.type}: ${alert.message}`);
      }
    }
  }
}

runSalesEngineFoundation().catch(console.error);
