import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

const db = getAuditDatabase();
const customerName = "JSW MG MOTOR INDIA PRIVATE LIMITED";
const customerRow = db.prepare("SELECT customer_id FROM audit_zoho_sales_orders WHERE customer_name = ? LIMIT 1").get(customerName) as any;
const customerId = customerRow?.customer_id;

if (!customerId) {
    console.log("Customer not found.");
    process.exit(1);
}

const sos = db.prepare("SELECT salesorder_id, salesorder_number FROM audit_zoho_sales_orders WHERE customer_id = ?").all(customerId) as any[];
const soIds = sos.map(so => so.salesorder_id);

console.log(`SO count: ${sos.length}`);

if (soIds.length === 0) process.exit(0);

const soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id IN (${soIds.map(() => '?').join(',')})`).all(...soIds) as any[];
console.log(`SO line count: ${soLines.length}`);

// Related Invoices (linked to SO)
const invoices = db.prepare(`SELECT * FROM audit_zoho_invoices WHERE customer_id = ? AND status != 'void'`).all(customerId) as any[];
console.log(`Invoice count: ${invoices.length}`);

// We need to check exact links
const invoiceLines = db.prepare(`SELECT * FROM audit_zoho_invoice_lines WHERE invoice_id IN (SELECT invoice_id FROM audit_zoho_invoices WHERE customer_id = ?)`).all(customerId) as any[];
console.log(`Invoice line count: ${invoiceLines.length}`);

// Find POs related to these SOs. 
const pos = db.prepare(`SELECT purchaseorder_id, purchaseorder_number, total FROM audit_zoho_purchase_orders WHERE delivery_customer_name = ?`).all(customerName) as any[];
const poIds = pos.map(po => po.purchaseorder_id);
console.log(`PO count: ${pos.length}`);

let poLines: any[] = [];
if (poIds.length > 0) {
    poLines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id IN (${poIds.map(() => '?').join(',')})`).all(...poIds) as any[];
}
console.log(`PO line count: ${poLines.length}`);

// Bills (linked to POs)
const bills = db.prepare(`SELECT * FROM audit_zoho_bills WHERE status != 'void' AND purchaseorder_id IN (${poIds.length ? poIds.map(() => '?').join(',') : '""'})`).all(...poIds) as any[];
const billIds = bills.map(b => b.bill_id);
console.log(`Bill count: ${bills.length}`);

let billLines: any[] = [];
if (billIds.length > 0) {
    billLines = db.prepare(`SELECT * FROM audit_zoho_bill_lines WHERE bill_id IN (${billIds.map(() => '?').join(',')})`).all(...billIds) as any[];
}
console.log(`Bill line count: ${billLines.length}`);

console.log("Invoice sum sub_total:", invoices.reduce((sum, inv) => sum + (inv.sub_total || 0), 0));
console.log("Bill sum sub_total:", bills.reduce((sum, bill) => sum + (bill.sub_total || 0), 0));

// Also check expenses? The prompt asks for "SUM attributable landed expenses" and "related Expense count"
const expenses = db.prepare(`SELECT * FROM audit_zoho_expenses WHERE customer_id = ?`).all(customerId) as any[];
console.log(`Expense count: ${expenses.length}`);
console.log("Expense sum total:", expenses.reduce((sum, exp) => sum + (exp.total || 0), 0));

// Also we need to trace exact document links 
// SO -> Invoices
let soWithInvoices = 0;
let soWithoutInvoices = 0;

for (const soId of soIds) {
    const invCount = db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_invoices WHERE salesorder_id = ?`).get(soId) as any;
    if (invCount.c > 0) soWithInvoices++;
    else soWithoutInvoices++;
}
console.log(`SO count with Invoice links: ${soWithInvoices}`);
console.log(`SO count without Invoice links: ${soWithoutInvoices}`);

// SO -> PO links
let soWithPO = 0;
let soWithoutPO = 0;
for (const so of sos) {
    // Check if any PO has this SO number in custom fields
    // Wait, the existing code uses delivery_customer_name instead of SO number, but it also extracts SO number from custom_fields_json
    const linkedPoCount = db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_purchase_orders WHERE custom_fields_json LIKE ?`).get('%' + so.salesorder_number + '%') as any;
    if (linkedPoCount.c > 0) soWithPO++;
    else soWithoutPO++;
}
console.log(`SO count with PO links: ${soWithPO}`);
console.log(`SO count without PO links: ${soWithoutPO}`);

// PO -> Bill links
let poWithBill = 0;
let poWithoutBill = 0;
for (const poId of poIds) {
    const linkedBillCount = db.prepare(`SELECT COUNT(*) as c FROM audit_zoho_bills WHERE purchaseorder_id = ?`).get(poId) as any;
    if (linkedBillCount.c > 0) poWithBill++;
    else poWithoutBill++;
}
console.log(`PO count with Bill links: ${poWithBill}`);
console.log(`PO count without Bill links: ${poWithoutBill}`);
