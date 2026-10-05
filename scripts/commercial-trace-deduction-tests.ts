import { getCommercialTrace } from "../app/lib/audit/commercial-trace-service.ts";

function assertEqual(actual: any, expected: any, msg: string) {
   if (actual !== expected) {
      console.error(`❌ FAIL: ${msg}. Expected ${expected}, got ${actual}`);
      process.exit(1);
   }
}

console.log("Running commercial-trace-deduction-tests...");

const trace = getCommercialTrace("SO-2627230");
if (trace) {
   // Test Phase 1 constraints on taxable and deduction fields
   trace.salesOrders.forEach(so => {
      assertEqual(so.taxableAmountStatus, "INCOMPLETE", "SO Taxable Status is INCOMPLETE");
      assertEqual(so.deductionStatus, "NOT_SYNCED", "SO Deduction Status is NOT_SYNCED");
   });

   trace.invoices.forEach(inv => {
      if (inv.totalTaxableAmount != null) {
         assertEqual(inv.taxableAmountStatus, "VERIFIED", "Invoice Taxable Status is VERIFIED");
      }
      assertEqual(inv.deductionStatus, "VERIFIED", "Invoice Deduction Status is VERIFIED");
   });

   trace.purchaseOrders.forEach(po => {
      assertEqual(po.taxableAmountStatus, "INCOMPLETE", "PO Taxable Status is INCOMPLETE");
      assertEqual(po.deductionStatus, "NOT_SYNCED", "PO Deduction Status is NOT_SYNCED");
   });

   trace.bills.forEach(bill => {
      if (bill.totalTaxableAmount != null) {
         assertEqual(bill.taxableAmountStatus, "VERIFIED", "Bill Taxable Status is VERIFIED");
      }
      assertEqual(bill.deductionStatus, "VERIFIED", "Bill Deduction Status is VERIFIED");
   });
}

console.log("✅ commercial-trace-deduction-tests PASSED\n");
