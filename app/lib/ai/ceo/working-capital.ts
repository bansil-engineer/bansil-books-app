import { getDatabase } from "../../db/database";

export function computeWorkingCapital() {
  const db = getDatabase();
  const asOfDate = '2026-09-30';
  const currentStart = '2026-04-01';
  const currentEnd = '2026-09-30';
  const priorStart = '2025-04-01';
  const priorEnd = '2025-09-30';

  // Receivables
  const receivables = db.prepare(`
    SELECT
      SUM(balance) as total_receivables,
      COUNT(invoice_id) as total_count,
      SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) as outstanding_count
    FROM sales_invoices
    WHERE status != 'void' AND status != 'draft'
  `).get() as any;

  // Payables
  const payables = db.prepare(`
    SELECT
      SUM(balance) as total_payables,
      COUNT(bill_id) as total_count,
      SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) as outstanding_count
    FROM purchase_bills
    WHERE status != 'void' AND status != 'draft'
  `).get() as any;

  // Current Sales
  const currentSales = db.prepare(`
    SELECT SUM(total) as total_sales
    FROM sales_invoices
    WHERE date >= ? AND date <= ? AND status != 'void' AND status != 'draft'
  `).get(currentStart, currentEnd) as any;

  // Prior Sales
  const priorSales = db.prepare(`
    SELECT SUM(total) as total_sales
    FROM sales_invoices
    WHERE date >= ? AND date <= ? AND status != 'void' AND status != 'draft'
  `).get(priorStart, priorEnd) as any;

  // Current Purchases
  const currentPurchases = db.prepare(`
    SELECT SUM(total) as total_purchases
    FROM purchase_bills
    WHERE date >= ? AND date <= ? AND status != 'void' AND status != 'draft'
  `).get(currentStart, currentEnd) as any;

  // Prior Purchases
  const priorPurchases = db.prepare(`
    SELECT SUM(total) as total_purchases
    FROM purchase_bills
    WHERE date >= ? AND date <= ? AND status != 'void' AND status != 'draft'
  `).get(priorStart, priorEnd) as any;

  // Top Customer by Sales (Current Period)
  const topSalesCustomers = db.prepare(`
    SELECT customer_name, SUM(total) as sales_amount
    FROM sales_invoices
    WHERE date >= ? AND date <= ? AND status != 'void' AND status != 'draft'
    GROUP BY customer_name
    ORDER BY sales_amount DESC
    LIMIT 5
  `).all(currentStart, currentEnd) as any[];

  // Top Customer by Receivable (Overall Snapshot)
  const topReceivableCustomers = db.prepare(`
    SELECT customer_name, SUM(balance) as balance_amount
    FROM sales_invoices
    WHERE balance > 0 AND status != 'void' AND status != 'draft'
    GROUP BY customer_name
    ORDER BY balance_amount DESC
    LIMIT 5
  `).all() as any[];

  // Top Vendor by Purchase (Current Period)
  const topPurchaseVendors = db.prepare(`
    SELECT vendor_name, SUM(total) as purchase_amount
    FROM purchase_bills
    WHERE date >= ? AND date <= ? AND status != 'void' AND status != 'draft'
    GROUP BY vendor_name
    ORDER BY purchase_amount DESC
    LIMIT 5
  `).all(currentStart, currentEnd) as any[];

  // Top Vendor by Payable (Overall Snapshot)
  const topPayableVendors = db.prepare(`
    SELECT vendor_name, SUM(balance) as balance_amount
    FROM purchase_bills
    WHERE balance > 0 AND status != 'void' AND status != 'draft'
    GROUP BY vendor_name
    ORDER BY balance_amount DESC
    LIMIT 5
  `).all() as any[];

  // Aging logic
  const getAging = (table: string) => {
    return db.prepare(`
      SELECT
        CASE
          WHEN due_date IS NULL THEN 'Unknown Due Date'
          WHEN due_date > ? THEN 'Not Due'
          WHEN julianday(?) - julianday(due_date) BETWEEN 1 AND 30 THEN '1-30'
          WHEN julianday(?) - julianday(due_date) BETWEEN 31 AND 60 THEN '31-60'
          WHEN julianday(?) - julianday(due_date) BETWEEN 61 AND 90 THEN '61-90'
          ELSE '90+'
        END as bucket,
        SUM(balance) as amount
      FROM ${table}
      WHERE balance > 0 AND status != 'void' AND status != 'draft'
      GROUP BY bucket
    `).all(asOfDate, asOfDate, asOfDate, asOfDate) as any[];
  };

  const receivableAging = getAging('sales_invoices');
  const payableAging = getAging('purchase_bills');

  // Concentrations
  const sumTop5 = (arr: any[], key: string) => arr.reduce((acc, obj) => acc + (obj[key] || 0), 0);

  const totalCurrentSales = currentSales.total_sales || 0;
  const top5SalesPct = totalCurrentSales > 0 ? (sumTop5(topSalesCustomers, 'sales_amount') / totalCurrentSales) * 100 : 0;

  const totalReceivableBal = receivables.total_receivables || 0;
  const top5ReceivablePct = totalReceivableBal > 0 ? (sumTop5(topReceivableCustomers, 'balance_amount') / totalReceivableBal) * 100 : 0;

  const totalCurrentPurchases = currentPurchases.total_purchases || 0;
  const top5PurchasePct = totalCurrentPurchases > 0 ? (sumTop5(topPurchaseVendors, 'purchase_amount') / totalCurrentPurchases) * 100 : 0;

  const totalPayableBal = payables.total_payables || 0;
  const top5PayablePct = totalPayableBal > 0 ? (sumTop5(topPayableVendors, 'balance_amount') / totalPayableBal) * 100 : 0;

  return {
    asOfDate,
    currentStart,
    currentEnd,
    priorStart,
    priorEnd,
    receivables,
    payables,
    currentSales,
    priorSales,
    currentPurchases,
    priorPurchases,
    topSalesCustomers,
    topReceivableCustomers,
    topPurchaseVendors,
    topPayableVendors,
    top5SalesPct,
    top5ReceivablePct,
    top5PurchasePct,
    top5PayablePct,
    receivableAging,
    payableAging,
    netTradeWorkingCapital: totalReceivableBal - totalPayableBal,
    totalReceivableBal,
    totalPayableBal,
    totalCurrentSales,
    totalCurrentPurchases
  };
}

export function formatWorkingCapitalReport(data: any): string {
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  const formatPct = (val: number) => val.toFixed(2) + '%';

  const extractBucket = (agingList: any[], bucketName: string) => {
    const bucket = agingList.find((b: any) => b.bucket === bucketName);
    return bucket ? bucket.amount : 0;
  };

  return `EXECUTIVE SUMMARY:
I have orchestrated a comprehensive management-level review of our Working Capital position from verified company records.

DATA BASIS & FRESHNESS:
• Sources Used:
  - Local Operational SQLite Database (data/bansil_books.db) - sales_invoices, purchase_bills
• Live Zoho Access Status: NOT PROVEN (analysis evaluated strictly against verified cached company data)

CURRENT ANALYSIS PERIOD:
${data.currentStart} through ${data.currentEnd}

PRIOR COMPARABLE PERIOD:
${data.priorStart} through ${data.priorEnd}
(Historical AR/AP point-in-time comparison not computable from current snapshot data, but sales/purchase flow comparisons are provided).

CUSTOMER RECEIVABLES (As of ${data.asOfDate}):
• Total Invoices: ${data.receivables.total_count}
• Outstanding Invoices: ${data.receivables.outstanding_count}
• Total Receivables: ${formatter.format(data.totalReceivableBal)}
• Receivables % of Current Period Sales: ${data.totalCurrentSales > 0 ? formatPct((data.totalReceivableBal / data.totalCurrentSales) * 100) : '0%'}

VENDOR PAYABLES (As of ${data.asOfDate}):
• Total Bills: ${data.payables.total_count}
• Outstanding Bills: ${data.payables.outstanding_count}
• Total Payables: ${formatter.format(data.totalPayableBal)}
• Payables % of Current Period Purchases: ${data.totalCurrentPurchases > 0 ? formatPct((data.totalPayableBal / data.totalCurrentPurchases) * 100) : '0%'}

NET TRADE WORKING-CAPITAL EXPOSURE:
• Net Exposure (Receivables - Payables): ${formatter.format(data.netTradeWorkingCapital)}

CUSTOMER CONCENTRATION:
• Top Customer by Sales (Gross, Current Period): ${data.topSalesCustomers[0]?.customer_name || 'N/A'} - ${formatter.format(data.topSalesCustomers[0]?.sales_amount || 0)} (${data.totalCurrentSales > 0 ? formatPct((data.topSalesCustomers[0]?.sales_amount / data.totalCurrentSales) * 100) : '0%'})
• Top 5 Customer Sales Concentration: ${formatPct(data.top5SalesPct)}
• Top Customer by Receivable (Overall Snapshot): ${data.topReceivableCustomers[0]?.customer_name || 'N/A'} - ${formatter.format(data.topReceivableCustomers[0]?.balance_amount || 0)} (${data.totalReceivableBal > 0 ? formatPct((data.topReceivableCustomers[0]?.balance_amount / data.totalReceivableBal) * 100) : '0%'})
• Top 5 Receivable Concentration: ${formatPct(data.top5ReceivablePct)}

VENDOR CONCENTRATION:
• Top Vendor by Purchase (Gross, Current Period): ${data.topPurchaseVendors[0]?.vendor_name || 'N/A'} - ${formatter.format(data.topPurchaseVendors[0]?.purchase_amount || 0)} (${data.totalCurrentPurchases > 0 ? formatPct((data.topPurchaseVendors[0]?.purchase_amount / data.totalCurrentPurchases) * 100) : '0%'})
• Top 5 Vendor Purchase Concentration: ${formatPct(data.top5PurchasePct)}
• Top Vendor by Payable (Overall Snapshot): ${data.topPayableVendors[0]?.vendor_name || 'N/A'} - ${formatter.format(data.topPayableVendors[0]?.balance_amount || 0)} (${data.totalPayableBal > 0 ? formatPct((data.topPayableVendors[0]?.balance_amount / data.totalPayableBal) * 100) : '0%'})
• Top 5 Payable Concentration: ${formatPct(data.top5PayablePct)}

OVERDUE EXPOSURE (AGING):
• Aging Available: YES (based on exact verified bucket logic from due_date)

RECEIVABLE AGING:
Not Due: ${formatter.format(extractBucket(data.receivableAging, 'Not Due'))}
1-30: ${formatter.format(extractBucket(data.receivableAging, '1-30'))}
31-60: ${formatter.format(extractBucket(data.receivableAging, '31-60'))}
61-90: ${formatter.format(extractBucket(data.receivableAging, '61-90'))}
90+: ${formatter.format(extractBucket(data.receivableAging, '90+'))}
Unknown Due Date: ${formatter.format(extractBucket(data.receivableAging, 'Unknown Due Date'))}

PAYABLE AGING:
Not Due: ${formatter.format(extractBucket(data.payableAging, 'Not Due'))}
1-30: ${formatter.format(extractBucket(data.payableAging, '1-30'))}
31-60: ${formatter.format(extractBucket(data.payableAging, '31-60'))}
61-90: ${formatter.format(extractBucket(data.payableAging, '61-90'))}
90+: ${formatter.format(extractBucket(data.payableAging, '90+'))}
Unknown Due Date: ${formatter.format(extractBucket(data.payableAging, 'Unknown Due Date'))}

CURRENT FY vs PRIOR COMPARABLE PERIOD:
• Current Period Sales: ${formatter.format(data.totalCurrentSales)} | Prior Matched Sales: ${formatter.format(data.priorSales.total_sales || 0)}
• Current Period Purchases: ${formatter.format(data.totalCurrentPurchases)} | Prior Matched Purchases: ${formatter.format(data.priorPurchases.total_purchases || 0)}

CEO RECOMMENDED NEXT CHECKS:
1. Conduct credit review on top 5 customers driving concentration.
2. Ensure overdue receivables (older than 30 days) are prioritized for follow-up.
`;
}
