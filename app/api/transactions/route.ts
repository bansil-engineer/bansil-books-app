// ============================================================
// Bansil Books Analytics — Transactions API Route
// Serves synchronized Purchase Bills and Sales Invoices from Local SQLite
// STRICTLY READ-ONLY · ZERO ZOHO API CALLS
// Business Rule: All Amounts = Taxable Value (Before GST)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import { parseFyToDateRange } from "@/app/lib/date-period-utils";
import { getVendorDetail } from "@/app/lib/vendor-engine";
import { getDateTransactions } from "@/app/lib/date-transaction-engine";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

export const dynamic = "force-dynamic";

// This route is intentionally shared: several distinct enabled features
// (Transactions, Customer Details, Action Taken, Inventory Stock,
// Breakdown Report, Price Reference, plus vendor/date drilldown drawers)
// all legitimately fetch document-level evidence (bill-detail/invoice-
// detail/vendor-detail/date-detail) through this one endpoint, and the
// docId lookup carries no reliable signal of which feature is asking.
// Gating those branches by any single feature would either do nothing
// (another enabled feature already exposes the identical data) or break
// unrelated always-on functionality — see PROJECT_FEATURE_CONTROLS.md's
// shared-route consumer matrix. Only the four branches below are
// genuinely exclusive to one feature each (confirmed by code search: no
// other caller in this codebase ever requests them), so only those are
// gated, keyed off the `type` value the route already uses to decide
// what to return — not a new, spoofable client-supplied feature flag.
const EXCLUSIVE_TYPE_FEATURE: Record<string, string[]> = {
  recent: ["module_dashboard"],
  bills: ["module_transactions", "sub_trans_purchase_bills"],
  invoices: ["module_transactions", "sub_trans_sales_invoices"],
  detail: ["module_transactions", "sub_trans_transaction_detail"],
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "all"; // "bills" | "invoices" | "detail" | "recent" | "bill-detail" | "invoice-detail" | "all"

    const requiredKeys = EXCLUSIVE_TYPE_FEATURE[type];
    if (requiredKeys) {
      const disabled = requireFeaturesEnabled(...requiredKeys);
      if (disabled) return disabled;
    }
    const financialYear = searchParams.get("financialYear") || "2026-27";
    const customFrom = searchParams.get("fromDate");
    const customTo = searchParams.get("toDate");
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    const customerId = searchParams.get("customerId");
    const vendorId = searchParams.get("vendorId");
    const itemId = searchParams.get("itemId");
    const txType = (searchParams.get("txType") || "ALL").toUpperCase(); // "ALL" | "PURCHASE" | "SALES"
    const limit = parseInt(searchParams.get("limit") || "1000", 10);
    const docId = searchParams.get("docId") || searchParams.get("billId") || searchParams.get("invoiceId");

    const db = getDatabase();

    // 0. Single Document Line Details for Row-Click Drawer
    if (type === "bill-detail" && docId) {
      const bill = db.prepare(`
        SELECT bill_id, bill_number, date, due_date, vendor_id, vendor_name, total as grand_total, balance, status, bill_url
        FROM purchase_bills
        WHERE bill_id = ? OR bill_number = ?
      `).get(docId, docId) as Record<string, unknown> | undefined;

      if (!bill) {
        return NextResponse.json({ success: false, error: "Bill not found" }, { status: 404 });
      }

      const lines = db.prepare(`
        SELECT line_item_id, item_id, item_name, sku, quantity, rate, line_total,
               COALESCE(purchase_line_customer_name, bbt_customer_name) as customer_details,
               bbt_customer_id, bbt_customer_name, purchase_line_customer_name, customer_data_status, description,
               (SELECT COUNT(*) FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND (
                 (purchase_bill_line_items.item_id IS NOT NULL AND purchase_bill_line_items.item_id != '' AND reconciliation_exclusions.item_id = purchase_bill_line_items.item_id)
                 OR (reconciliation_exclusions.item_name = purchase_bill_line_items.item_name)
               )) > 0 as is_excluded
        FROM purchase_bill_line_items
        WHERE bill_id = ?
        ORDER BY rowid ASC
      `).all(bill.bill_id) as Record<string, unknown>[];

      const taxableTotal = lines.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
      const grandTotal = Number(bill.grand_total || 0);
      const taxAmount = Math.max(0, Math.round((grandTotal - taxableTotal) * 100) / 100);

      return NextResponse.json({
        success: true,
        document: {
          ...bill,
          taxableTotal,
          taxAmount,
          lines,
        },
      });
    }

    if (type === "invoice-detail" && docId) {
      const invoice = db.prepare(`
        SELECT invoice_id, invoice_number, date, due_date, customer_id, customer_name, total as grand_total, balance, status, invoice_url
        FROM sales_invoices
        WHERE invoice_id = ? OR invoice_number = ?
      `).get(docId, docId) as Record<string, unknown> | undefined;

      if (!invoice) {
        return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
      }

      const lines = db.prepare(`
        SELECT line_item_id, item_id, item_name, sku, quantity, rate, line_total, description
        FROM sales_invoice_line_items
        WHERE invoice_id = ?
          AND (item_id IS NULL OR item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
        ORDER BY rowid ASC
      `).all(invoice.invoice_id) as Record<string, unknown>[];

      const taxableTotal = lines.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
      const grandTotal = Number(invoice.grand_total || 0);
      const taxAmount = Math.max(0, Math.round((grandTotal - taxableTotal) * 100) / 100);

      return NextResponse.json({
        success: true,
        document: {
          ...invoice,
          taxableTotal,
          taxAmount,
          lines,
        },
      });
    }

    // Vendor Detail for Click-Through Navigation
    if (type === "vendor-detail") {
      const vendorName = searchParams.get("vendorName") || searchParams.get("vendor") || undefined;
      const vendorIdParam = searchParams.get("vendorId") || undefined;
      const vendorData = getVendorDetail(db, {
        vendorName,
        vendorId: vendorIdParam,
        financialYear,
        fromDate: customFrom || undefined,
        toDate: customTo || undefined,
      });
      if (!vendorData) {
        return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, vendor: vendorData });
    }

    // Date-Wise Transaction Details for Click-Through Navigation
    if (type === "date-detail") {
      const dateParam = searchParams.get("date");
      if (!dateParam) {
        return NextResponse.json({ success: false, error: "Date parameter is required" }, { status: 400 });
      }
      const ignoreItemFilter = searchParams.get("ignoreItemFilter") === "true";
      const itemName = searchParams.get("itemName") || undefined;
      const dateData = getDateTransactions(db, {
        date: dateParam,
        itemId: itemId || undefined,
        itemName,
        ignoreItemFilter,
      });
      return NextResponse.json({ success: true, dateData });
    }

    // Resolve date range
    let fromDate: string;
    let toDate: string;
    if (customFrom && customTo) {
      fromDate = customFrom;
      toDate = customTo;
    } else {
      const range = parseFyToDateRange(financialYear);
      fromDate = range.fromDate;
      toDate = range.toDate;
    }

    // 1. Fetch Recent Bills & Invoices for Dashboard
    if (type === "recent") {
      const recentBills = db.prepare(`
        SELECT b.bill_id, b.bill_number, b.date, b.vendor_name, b.total, b.status, b.bill_url
        FROM purchase_bills b
        WHERE EXISTS (
          SELECT 1 FROM purchase_bill_line_items bli
          WHERE bli.bill_id = b.bill_id
            AND (bli.item_id IS NULL OR bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
        )
        ORDER BY b.date DESC, b.created_time DESC
        LIMIT 10
      `).all() as Record<string, unknown>[];

      const recentInvoices = db.prepare(`
        SELECT inv.invoice_id, inv.invoice_number, inv.date, inv.customer_name, inv.total, inv.status, inv.invoice_url
        FROM sales_invoices inv
        WHERE EXISTS (
          SELECT 1 FROM sales_invoice_line_items sli
          WHERE sli.invoice_id = inv.invoice_id
            AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
        )
        ORDER BY inv.date DESC, inv.created_time DESC
        LIMIT 10
      `).all() as Record<string, unknown>[];

      return NextResponse.json({
        success: true,
        recentBills,
        recentInvoices,
      });
    }

    // 2. PURCHASE BILLS
    if (type === "bills") {
      const whereConditions: string[] = [
        "b.date >= ?",
        "b.date <= ?",
        "(bli.item_id IS NULL OR bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))",
      ];
      const params: (string | number)[] = [fromDate, toDate];

      if (vendorId) {
        whereConditions.push("b.vendor_id = ?");
        params.push(vendorId);
      }

      if (customerId) {
        whereConditions.push("(bli.bbt_customer_id = ? OR bli.purchase_line_customer_id = ?)");
        params.push(customerId, customerId);
      }

      if (itemId) {
        whereConditions.push("bli.item_id = ?");
        params.push(itemId);
      }

      if (search) {
        whereConditions.push(`(
          LOWER(b.bill_number) LIKE ? 
          OR LOWER(b.vendor_name) LIKE ? 
          OR LOWER(bli.item_name) LIKE ? 
          OR LOWER(COALESCE(bli.sku, '')) LIKE ? 
          OR LOWER(COALESCE(bli.bbt_customer_name, '')) LIKE ?
        )`);
        const s = `%${search}%`;
        params.push(s, s, s, s, s);
      }

      const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

      // 1. Exact KPI Totals (Taxable Value before GST, Qty, Distinct Bills with active included lines)
      const totalsQuery = `
        SELECT 
          COUNT(DISTINCT b.bill_id) as bill_count,
          COALESCE(SUM(bli.quantity), 0) as total_qty,
          COALESCE(SUM(bli.line_total), 0) as total_taxable_amount
        FROM purchase_bills b
        JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
        ${whereClause}
      `;
      const totalsRow = db.prepare(totalsQuery).get(...params) as {
        bill_count: number;
        total_qty: number;
        total_taxable_amount: number;
      };

      // 2. Filtered Table Rows (one row per distinct bill with line aggregates)
      const listQuery = `
        SELECT 
          b.bill_id,
          b.bill_number,
          b.date,
          b.due_date,
          b.vendor_id,
          b.vendor_name,
          b.total as grand_total,
          b.balance,
          b.status,
          b.bill_url,
          b.created_time,
          COALESCE(SUM(bli.quantity), 0) AS total_qty,
          COALESCE(SUM(bli.line_total), 0) AS taxable_amount,
          GROUP_CONCAT(DISTINCT NULLIF(TRIM(bli.bbt_customer_name), '')) AS customer_details
        FROM purchase_bills b
        JOIN purchase_bill_line_items bli ON b.bill_id = bli.bill_id
        ${whereClause}
        GROUP BY b.bill_id
        ORDER BY b.date DESC, b.bill_number DESC
        LIMIT ?
      `;
      const bills = db.prepare(listQuery).all(...params, limit) as Record<string, unknown>[];

      // 3. Dropdown Options for Filter Bar (excluding active excluded items)
      const vendors = db.prepare(`
        SELECT vendor_id as id, MAX(vendor_name) as name 
        FROM purchase_bills 
        WHERE date >= ? AND date <= ? AND vendor_name IS NOT NULL AND vendor_id IS NOT NULL AND TRIM(vendor_id) != ''
        GROUP BY vendor_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string }[];

      const customers = db.prepare(`
        SELECT bbt_customer_id as id, MAX(bbt_customer_name) as name 
        FROM purchase_bill_line_items bli
        JOIN purchase_bills b ON bli.bill_id = b.bill_id
        WHERE b.date >= ? AND b.date <= ? AND bbt_customer_name IS NOT NULL AND bbt_customer_id IS NOT NULL AND TRIM(bbt_customer_id) != ''
          AND (bli.item_id IS NULL OR bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
        GROUP BY bbt_customer_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string }[];

      const items = db.prepare(`
        SELECT bli.item_id as id, MAX(bli.item_name) as name, MAX(bli.sku) as sku 
        FROM purchase_bill_line_items bli
        JOIN purchase_bills b ON bli.bill_id = b.bill_id
        WHERE b.date >= ? AND b.date <= ? AND bli.item_name IS NOT NULL AND bli.item_id IS NOT NULL AND TRIM(bli.item_id) != ''
          AND (bli.item_id IS NULL OR bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
        GROUP BY bli.item_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string; sku?: string }[];

      return NextResponse.json({
        success: true,
        bills,
        totals: {
          billCount: totalsRow?.bill_count ?? bills.length,
          purchaseQty: Number(totalsRow?.total_qty ?? 0),
          purchaseTaxableAmount: Number(totalsRow?.total_taxable_amount ?? 0),
          purchaseAmount: Number(totalsRow?.total_taxable_amount ?? 0),
        },
        filterOptions: { vendors, customers, items },
        dateRange: { fromDate, toDate },
      });
    }

    // 3. SALES INVOICES
    if (type === "invoices") {
      const whereConditions: string[] = [
        "inv.date >= ?",
        "inv.date <= ?",
        "(sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))",
      ];
      const params: (string | number)[] = [fromDate, toDate];

      if (customerId) {
        whereConditions.push("inv.customer_id = ?");
        params.push(customerId);
      }

      if (itemId) {
        whereConditions.push("sli.item_id = ?");
        params.push(itemId);
      }

      if (search) {
        whereConditions.push(`(
          LOWER(inv.invoice_number) LIKE ? 
          OR LOWER(inv.customer_name) LIKE ? 
          OR LOWER(sli.item_name) LIKE ? 
          OR LOWER(COALESCE(sli.sku, '')) LIKE ?
        )`);
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

      // 1. Exact KPI Totals (Taxable Value before GST, Qty, Distinct Invoices with active included lines)
      const totalsQuery = `
        SELECT 
          COUNT(DISTINCT inv.invoice_id) as invoice_count,
          COALESCE(SUM(sli.quantity), 0) as total_qty,
          COALESCE(SUM(sli.line_total), 0) as total_taxable_amount
        FROM sales_invoices inv
        JOIN sales_invoice_line_items sli ON inv.invoice_id = sli.invoice_id
        ${whereClause}
      `;
      const totalsRow = db.prepare(totalsQuery).get(...params) as {
        invoice_count: number;
        total_qty: number;
        total_taxable_amount: number;
      };

      // 2. Filtered Table Rows (one row per distinct invoice with line aggregates)
      const listQuery = `
        SELECT 
          inv.invoice_id,
          inv.invoice_number,
          inv.date,
          inv.due_date,
          inv.customer_id,
          inv.customer_name,
          inv.total as grand_total,
          inv.balance,
          inv.status,
          inv.invoice_url,
          inv.created_time,
          COALESCE(SUM(sli.quantity), 0) AS total_qty,
          COALESCE(SUM(sli.line_total), 0) AS taxable_amount
        FROM sales_invoices inv
        JOIN sales_invoice_line_items sli ON inv.invoice_id = sli.invoice_id
        ${whereClause}
        GROUP BY inv.invoice_id
        ORDER BY inv.date DESC, inv.invoice_number DESC
        LIMIT ?
      `;
      const invoices = db.prepare(listQuery).all(...params, limit) as Record<string, unknown>[];

      // 3. Dropdown Options (excluding active excluded items)
      const customers = db.prepare(`
        SELECT customer_id as id, MAX(customer_name) as name 
        FROM sales_invoices 
        WHERE date >= ? AND date <= ? AND customer_name IS NOT NULL AND customer_id IS NOT NULL AND TRIM(customer_id) != ''
        GROUP BY customer_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string }[];

      const items = db.prepare(`
        SELECT sli.item_id as id, MAX(sli.item_name) as name, MAX(sli.sku) as sku 
        FROM sales_invoice_line_items sli
        JOIN sales_invoices inv ON sli.invoice_id = inv.invoice_id
        WHERE inv.date >= ? AND inv.date <= ? AND sli.item_name IS NOT NULL AND sli.item_id IS NOT NULL AND TRIM(sli.item_id) != ''
          AND (sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
        GROUP BY sli.item_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string; sku?: string }[];

      return NextResponse.json({
        success: true,
        invoices,
        totals: {
          invoiceCount: totalsRow?.invoice_count ?? invoices.length,
          salesQty: Number(totalsRow?.total_qty ?? 0),
          salesTaxableAmount: Number(totalsRow?.total_taxable_amount ?? 0),
          salesAmount: Number(totalsRow?.total_taxable_amount ?? 0),
        },
        filterOptions: { customers, items },
        dateRange: { fromDate, toDate },
      });
    }

    // 4. TRANSACTION DETAIL (Line-by-Line Unified Ledger)
    if (type === "detail") {
      let purchaseLines: Record<string, unknown>[] = [];
      if (txType === "ALL" || txType === "PURCHASE") {
        const pWhereConditions: string[] = [
          "b.date >= ?",
          "b.date <= ?",
          "(bli.item_id IS NULL OR bli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))",
        ];
        const pParams: (string | number)[] = [fromDate, toDate];

        if (vendorId) {
          pWhereConditions.push("b.vendor_id = ?");
          pParams.push(vendorId);
        }
        if (customerId) {
          pWhereConditions.push("(bli.bbt_customer_id = ? OR bli.purchase_line_customer_id = ?)");
          pParams.push(customerId, customerId);
        }
        if (itemId) {
          pWhereConditions.push("bli.item_id = ?");
          pParams.push(itemId);
        }
        if (search) {
          pWhereConditions.push(`(
            LOWER(b.bill_number) LIKE ? 
            OR LOWER(b.vendor_name) LIKE ? 
            OR LOWER(bli.item_name) LIKE ? 
            OR LOWER(COALESCE(bli.sku, '')) LIKE ? 
            OR LOWER(COALESCE(bli.bbt_customer_name, '')) LIKE ?
          )`);
          const s = `%${search}%`;
          pParams.push(s, s, s, s, s);
        }

        const pQuery = `
          SELECT 
            'PURCHASE' as transaction_type,
            b.date as transaction_date,
            b.bill_number as document_number,
            b.bill_url as document_url,
            bli.line_item_id as line_item_id,
            b.bill_id as document_id,
            bli.item_id as item_id,
            CASE 
              WHEN bli.bbt_customer_name IS NOT NULL AND TRIM(bli.bbt_customer_name) != '' 
              THEN bli.bbt_customer_name 
              ELSE 'CUSTOMER DETAILS MISSING' 
            END as customer_name,
            b.vendor_name as vendor_name,
            bli.item_name as item_name,
            COALESCE(bli.sku, '-') as sku,
            bli.quantity as purchase_qty,
            bli.line_total as purchase_amount,
            0 as sales_qty,
            0 as sales_amount,
            bli.customer_data_status as customer_data_status
          FROM purchase_bill_line_items bli
          JOIN purchase_bills b ON bli.bill_id = b.bill_id
          WHERE ${pWhereConditions.join(" AND ")}
          ORDER BY b.date DESC
          LIMIT ?
        `;
        purchaseLines = db.prepare(pQuery).all(...pParams, limit) as Record<string, unknown>[];
      }

      let salesLines: Record<string, unknown>[] = [];
      if (txType === "ALL" || txType === "SALES") {
        const sWhereConditions: string[] = [
          "inv.date >= ?",
          "inv.date <= ?",
          "(sli.item_id IS NULL OR sli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))",
        ];
        const sParams: (string | number)[] = [fromDate, toDate];

        if (customerId) {
          sWhereConditions.push("inv.customer_id = ?");
          sParams.push(customerId);
        }
        if (itemId) {
          sWhereConditions.push("sli.item_id = ?");
          sParams.push(itemId);
        }
        if (search) {
          sWhereConditions.push(`(
            LOWER(inv.invoice_number) LIKE ? 
            OR LOWER(inv.customer_name) LIKE ? 
            OR LOWER(sli.item_name) LIKE ? 
            OR LOWER(COALESCE(sli.sku, '')) LIKE ?
          )`);
          const s = `%${search}%`;
          sParams.push(s, s, s, s);
        }

        const sQuery = `
          SELECT 
            'SALES' as transaction_type,
            inv.date as transaction_date,
            inv.invoice_number as document_number,
            inv.invoice_url as document_url,
            sli.line_item_id as line_item_id,
            inv.invoice_id as document_id,
            sli.item_id as item_id,
            inv.customer_name as customer_name,
            '—' as vendor_name,
            sli.item_name as item_name,
            COALESCE(sli.sku, '-') as sku,
            0 as purchase_qty,
            0 as purchase_amount,
            sli.quantity as sales_qty,
            sli.line_total as sales_amount,
            'VERIFIED' as customer_data_status
          FROM sales_invoice_line_items sli
          JOIN sales_invoices inv ON sli.invoice_id = inv.invoice_id
          WHERE ${sWhereConditions.join(" AND ")}
          ORDER BY inv.date DESC
          LIMIT ?
        `;
        salesLines = db.prepare(sQuery).all(...sParams, limit) as Record<string, unknown>[];
      }

      const allDetails = [...purchaseLines, ...salesLines].sort((a, b) =>
        String(b.transaction_date).localeCompare(String(a.transaction_date))
      );

      const totalPurchQty = purchaseLines.reduce((acc, row) => acc + Number(row.purchase_qty || 0), 0);
      const totalPurchAmt = purchaseLines.reduce((acc, row) => acc + Number(row.purchase_amount || 0), 0);
      const totalSalesQty = salesLines.reduce((acc, row) => acc + Number(row.sales_qty || 0), 0);
      const totalSalesAmt = salesLines.reduce((acc, row) => acc + Number(row.sales_amount || 0), 0);

      const customers = db.prepare(`
        SELECT customer_id as id, MAX(customer_name) as name 
        FROM sales_invoices 
        WHERE date >= ? AND date <= ? AND customer_name IS NOT NULL AND customer_id IS NOT NULL AND TRIM(customer_id) != ''
        GROUP BY customer_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string }[];

      const vendors = db.prepare(`
        SELECT vendor_id as id, MAX(vendor_name) as name 
        FROM purchase_bills 
        WHERE date >= ? AND date <= ? AND vendor_name IS NOT NULL AND vendor_id IS NOT NULL AND TRIM(vendor_id) != ''
        GROUP BY vendor_id
        ORDER BY name ASC
      `).all(fromDate, toDate) as { id: string; name: string }[];

      const items = db.prepare(`
        SELECT item_id as id, MAX(item_name) as name, MAX(sku) as sku 
        FROM (
          SELECT sli.item_id, sli.item_name, sli.sku FROM sales_invoice_line_items sli JOIN sales_invoices inv ON sli.invoice_id = inv.invoice_id WHERE inv.date >= ? AND inv.date <= ?
          UNION ALL
          SELECT bli.item_id, bli.item_name, bli.sku FROM purchase_bill_line_items bli JOIN purchase_bills b ON bli.bill_id = b.bill_id WHERE b.date >= ? AND b.date <= ?
        )
        WHERE item_id IS NOT NULL AND TRIM(item_id) != '' AND item_name IS NOT NULL
          AND item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL)
        GROUP BY item_id
        ORDER BY name ASC
      `).all(fromDate, toDate, fromDate, toDate) as { id: string; name: string; sku?: string }[];

      return NextResponse.json({
        success: true,
        transactionDetails: allDetails,
        totals: {
          purchaseQty: totalPurchQty,
          purchaseTaxableAmount: totalPurchAmt,
          purchaseAmount: totalPurchAmt,
          salesQty: totalSalesQty,
          salesTaxableAmount: totalSalesAmt,
          salesAmount: totalSalesAmt,
        },
        filterOptions: { customers, vendors, items },
        dateRange: { fromDate, toDate },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
