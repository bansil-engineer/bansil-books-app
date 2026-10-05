import { getAllCommercialTraces } from "../app/lib/audit/commercial-trace-service.ts";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
const db = getAuditDatabase();
const customerName = "JSW MG MOTOR INDIA PRIVATE LIMITED";
const customerIdRow = db.prepare("SELECT customer_id FROM audit_zoho_sales_orders WHERE customer_name = ? LIMIT 1").get(customerName) as any;
const res = getAllCommercialTraces(customerIdRow.customer_id);
console.log(JSON.stringify(res?.summary, null, 2));
