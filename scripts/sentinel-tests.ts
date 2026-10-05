import { DatabaseSync } from 'node:sqlite';
import { getBansilBooksDbPath } from '../app/lib/db/db-resolver';
process.loadEnvFile('.env.local');

const db = new DatabaseSync(getBansilBooksDbPath());

const sales = db.prepare("SELECT sum(total) as gross, sum(sub_total) as taxable, sum(tax_total) as gst, count(invoice_id) as inv_count, count(DISTINCT customer_id) as cust_count FROM sales_invoices WHERE date >= '2024-09-01' AND date <= '2024-09-30' AND status NOT IN ('void', 'draft')").get();
console.log('September Sales:', sales);

const purchase = db.prepare("SELECT sum(total) as gross, sum(sub_total) as taxable, sum(tax_total) as gst, count(bill_id) as bill_count, count(DISTINCT vendor_id) as vend_count FROM purchase_bills WHERE date >= '2024-09-01' AND date <= '2024-09-30' AND status NOT IN ('void', 'draft')").get();
console.log('September Purchase:', purchase);

const receivable = db.prepare("SELECT sum(balance) as rec FROM sales_invoices WHERE status NOT IN ('void', 'draft')").get();
console.log('Receivable:', receivable);

const payable = db.prepare("SELECT sum(balance) as pay FROM purchase_bills WHERE status NOT IN ('void', 'draft')").get();
console.log('Payable:', payable);
