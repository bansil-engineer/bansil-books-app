import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
const db = getAuditDatabase();
const soHeader = db.prepare("SELECT salesorder_id, salesorder_number, fetched_at, source_run_id, source_endpoint FROM audit_zoho_sales_orders WHERE salesorder_number LIKE '%2627024%'").all();
console.log("SO HEADERS:", soHeader);
const soLines = db.prepare("SELECT item_name, description, rate, amount, quantity FROM audit_zoho_sales_order_lines WHERE salesorder_id = '3166667000016441024' AND item_name = 'Cable Gland with Hood' LIMIT 10").all();
console.log("SO LINES:", soLines);
