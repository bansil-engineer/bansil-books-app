import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { extractCustomField } from "../app/lib/audit/so-po-mapping.ts";
const db = getAuditDatabase();
const customerName = "JSW MG MOTOR INDIA PRIVATE LIMITED";
const customerIdRow = db.prepare("SELECT customer_id FROM audit_zoho_sales_orders WHERE customer_name = ? LIMIT 1").get(customerName) as any;
const customerId = customerIdRow.customer_id;
const sos = db.prepare("SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders WHERE customer_id = ?").all(customerId) as any[];
const soNumbers = sos.map(so => so.salesorder_number);

let poTotal = 0;
let poCount = 0;
const allPOs = db.prepare("SELECT * FROM audit_zoho_purchase_orders").all() as any[];
allPOs.forEach(po => {
    if (po.custom_fields_json) {
        try {
            const customFields = JSON.parse(po.custom_fields_json);
            const ref = extractCustomField(customFields, /Sales Order No/i);
            if (ref && soNumbers.includes(ref)) {
                poTotal += (po.total || 0);
                poCount++;
            }
        } catch (e) {}
    }
});
console.log("PO matched by custom_fields total:", poTotal, "count:", poCount);

let invoiceTaxable = 0;
const invoices = db.prepare(`SELECT invoice_id FROM audit_zoho_invoices WHERE customer_id = ? AND status != 'void'`).all(customerId) as any[];
invoices.forEach(inv => {
    const lines = db.prepare(`SELECT rate, quantity FROM audit_zoho_invoice_lines WHERE invoice_id = ?`).all(inv.invoice_id) as any[];
    lines.forEach(l => { invoiceTaxable += (l.rate || 0) * (l.quantity || 0); });
});
console.log("Invoice Taxable:", invoiceTaxable);
