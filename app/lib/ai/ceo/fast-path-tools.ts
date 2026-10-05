import { getDatabase } from "../../db/database";
import { resolvePeriod, DateRange } from "./date-resolver";

function formatCurrency(val: number): string {
  if (val === null || val === undefined) return "0.00";
  return val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLakh(val: number): string {
  if (val === null || val === undefined || val === 0) return "₹0.00";
  if (val >= 10000000) return "₹" + (val / 10000000).toFixed(2) + " Cr";
  if (val >= 100000) return "₹" + (val / 100000).toFixed(2) + " Lakh";
  return "₹" + formatCurrency(val);
}

function getLastSync(): string {
  const db = getDatabase();
  const row = db.prepare(`SELECT MAX(synced_at) as m FROM sales_invoices`).get() as any;
  return row?.m || "Not available";
}

function footer(periodStr: string): string {
  return `\n\nData Basis:\n- Source: data/bansil_books.db\n- Period: ${periodStr}\n- Last Sync: ${getLastSync()}\n- Live Zoho Used: No\n- Zoho Write: 0`;
}

export async function executeFastPathQuery(
  intent: string,
  query: string,
  periodOverride?: DateRange,
  injectedNow?: string
): Promise<string> {
  const period = periodOverride ?? resolvePeriod(query, injectedNow);
  const db = getDatabase();

  try {
    if (intent === "SALES_QUERY") {
      const row = db.prepare(`
        SELECT
          SUM(i.total) as gross_sales,
          SUM(COALESCE(l.taxable_amount, 0)) as taxable_sales,
          SUM(i.total) - SUM(COALESCE(l.taxable_amount, 0)) as gst,
          COUNT(DISTINCT i.invoice_id) as invoice_count,
          COUNT(DISTINCT i.customer_id) as customer_count
        FROM sales_invoices i
        LEFT JOIN (
          SELECT invoice_id, SUM(line_total) as taxable_amount
          FROM sales_invoice_line_items
          GROUP BY invoice_id
        ) l ON i.invoice_id = l.invoice_id
        WHERE i.status != 'void' AND i.status != 'draft'
          AND i.date >= ? AND i.date <= ?
      `).get(period.startDate, period.endDate) as any;

      const gross = row.gross_sales || 0;
      const tax = row.taxable_sales || 0;
      const gst = row.gst || 0;

      return `### Sales Summary\n\n**Executive Summary**\nSales for ${period.description} were ${formatLakh(gross)} gross from ${row.invoice_count} invoices.\nTaxable sales were ${formatLakh(tax)} with GST of ${formatLakh(gst)}.\n\n| Particular | Amount |\n|-------------|---------------:|\n| Gross Sales | ₹${formatCurrency(gross)} |\n| Taxable Sales | ₹${formatCurrency(tax)} |\n| GST | ₹${formatCurrency(gst)} |\n| Invoice Count | ${row.invoice_count} |\n| Customers | ${row.customer_count} |${footer(period.description)}`;
    }

    if (intent === "PURCHASE_QUERY") {
      const row = db.prepare(`
        SELECT
          SUM(i.total) as gross_purchase,
          SUM(COALESCE(l.taxable_amount, 0)) as taxable_purchase,
          SUM(i.total) - SUM(COALESCE(l.taxable_amount, 0)) as gst,
          COUNT(DISTINCT i.bill_id) as bill_count,
          COUNT(DISTINCT i.vendor_id) as vendor_count
        FROM purchase_bills i
        LEFT JOIN (
          SELECT bill_id, SUM(line_total) as taxable_amount
          FROM purchase_bill_line_items
          GROUP BY bill_id
        ) l ON i.bill_id = l.bill_id
        WHERE i.status != 'void' AND i.status != 'draft'
          AND i.date >= ? AND i.date <= ?
      `).get(period.startDate, period.endDate) as any;

      const gross = row.gross_purchase || 0;
      const tax = row.taxable_purchase || 0;
      const gst = row.gst || 0;

      return `### Purchase Summary\n\n**Executive Summary**\nPurchases for ${period.description} were ${formatLakh(gross)} gross from ${row.bill_count} bills.\nTaxable purchases were ${formatLakh(tax)} with GST of ${formatLakh(gst)}.\n\n| Particular | Amount |\n|-------------|---------------:|\n| Gross Purchase | ₹${formatCurrency(gross)} |\n| Taxable Purchase | ₹${formatCurrency(tax)} |\n| GST / Input Tax | ₹${formatCurrency(gst)} |\n| Bill Count | ${row.bill_count} |\n| Vendors | ${row.vendor_count} |${footer(period.description)}`;
    }

    if (intent === "RECEIVABLE_QUERY") {
      const row = db.prepare(`
        SELECT
          SUM(balance) as total_receivable,
          COUNT(invoice_id) as outstanding_count
        FROM sales_invoices
        WHERE status != 'void' AND status != 'draft' AND status != 'paid' AND balance > 0
      `).get() as any;

      const tot = row.total_receivable || 0;
      return `### Receivables Summary\n\n**Executive Summary**\nTotal outstanding receivables are ${formatLakh(tot)} across ${row.outstanding_count} unpaid invoices.\n\n| Metric | Amount |\n|--------|-------:|\n| Total Receivable | ₹${formatCurrency(tot)} |\n| Outstanding Invoices | ${row.outstanding_count} |${footer("Current")}`;
    }

    if (intent === "PAYABLE_QUERY") {
      const row = db.prepare(`
        SELECT
          SUM(balance) as total_payable,
          COUNT(bill_id) as outstanding_count
        FROM purchase_bills
        WHERE status != 'void' AND status != 'draft' AND status != 'paid' AND balance > 0
      `).get() as any;

      const tot = row.total_payable || 0;
      return `### Payables Summary\n\n**Executive Summary**\nTotal outstanding payables are ${formatLakh(tot)} across ${row.outstanding_count} unpaid bills.\n\n| Metric | Amount |\n|--------|-------:|\n| Total Payable | ₹${formatCurrency(tot)} |\n| Outstanding Bills | ${row.outstanding_count} |${footer("Current")}`;
    }

    if (intent === "CUSTOMER_QUERY") {
      const rows = db.prepare(`
        SELECT
          customer_name as name,
          SUM(total) as sales_value
        FROM sales_invoices
        WHERE status != 'void' AND status != 'draft'
          AND date >= ? AND date <= ?
        GROUP BY customer_name
        ORDER BY sales_value DESC
        LIMIT 5
      `).all(period.startDate, period.endDate) as any[];

      const totalRow = db.prepare(`
        SELECT SUM(total) as total FROM sales_invoices
        WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?
      `).get(period.startDate, period.endDate) as any;
      const total = totalRow.total || 0;

      let list = rows.map((r, i) => `| ${i+1} | ${r.name} | ₹${formatCurrency(r.sales_value)} | ${total > 0 ? ((r.sales_value/total)*100).toFixed(1) : 0}% |`).join("\n");
      if (rows.length === 0) list = "| - | No sales found | ₹0.00 | 0% |";

      const top5sum = rows.reduce((acc, curr) => acc + curr.sales_value, 0);
      const top5pct = total > 0 ? ((top5sum/total)*100).toFixed(1) : 0;

      return `### Top 5 Customers\n\n**Executive Summary**\nTop 5 customers contributed ${formatLakh(top5sum)} (${top5pct}%) of total sales for the period.\n\n| Rank | Customer | Sales | Share |\n|-----:|----------|------:|------:|\n${list}${footer(period.description)}`;
    }

    if (intent === "VENDOR_QUERY") {
      const rows = db.prepare(`
        SELECT
          vendor_name as name,
          SUM(total) as purchase_value
        FROM purchase_bills
        WHERE status != 'void' AND status != 'draft'
          AND date >= ? AND date <= ?
        GROUP BY vendor_name
        ORDER BY purchase_value DESC
        LIMIT 5
      `).all(period.startDate, period.endDate) as any[];

      const totalRow = db.prepare(`
        SELECT SUM(total) as total FROM purchase_bills
        WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?
      `).get(period.startDate, period.endDate) as any;
      const total = totalRow.total || 0;

      let list = rows.map((r, i) => `| ${i+1} | ${r.name} | ₹${formatCurrency(r.purchase_value)} | ${total > 0 ? ((r.purchase_value/total)*100).toFixed(1) : 0}% |`).join("\n");
      if (rows.length === 0) list = "| - | No purchases found | ₹0.00 | 0% |";

      const top5sum = rows.reduce((acc, curr) => acc + curr.purchase_value, 0);
      const top5pct = total > 0 ? ((top5sum/total)*100).toFixed(1) : 0;

      return `### Top 5 Vendors\n\n**Executive Summary**\nTop 5 vendors accounted for ${formatLakh(top5sum)} (${top5pct}%) of total purchases for the period.\n\n| Rank | Vendor | Purchases | Share |\n|-----:|----------|------:|------:|\n${list}${footer(period.description)}`;
    }

    return "UNKNOWN_FAST_PATH_INTENT";
  } catch (err: any) {
    console.error("Fast path execution error:", err);
    return `Analysis error: ${err.message}`;
  }
}
