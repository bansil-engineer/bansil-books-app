// ============================================================
// Bansil Books Analytics — Audit Adapter over Books Source Data
// Read-only by construction: opens data/bansil_books.db with
// { readOnly: true } and exposes summary queries only. No write
// method exists anywhere in this module — do not add one without
// separate owner approval (see MODULE_LOCK.md / BANSIL_AUDIT_IMPLEMENTATION.md §9).
// ============================================================

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BOOKS_DB_FILE = path.join(process.cwd(), "data", "bansil_books.db");

export interface BooksSourceSummary {
  organizationId: string | null;
  organizationName: string | null;
  salesInvoiceCount: number;
  purchaseBillCount: number;
  distinctVendorCount: number;
  distinctCustomerCount: number;
}

/**
 * Opens the Books database strictly read-only for the duration of one
 * summary query. Returns nulls/zeros (never throws to the caller) if the
 * Books database is missing — the audit workspace shell must still render.
 */
export function getBooksSourceSummary(): BooksSourceSummary {
  const empty: BooksSourceSummary = {
    organizationId: null,
    organizationName: null,
    salesInvoiceCount: 0,
    purchaseBillCount: 0,
    distinctVendorCount: 0,
    distinctCustomerCount: 0,
  };

  if (!fs.existsSync(BOOKS_DB_FILE)) return empty;

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(BOOKS_DB_FILE, { readOnly: true });

    const org = db.prepare("SELECT organization_id, name FROM organizations LIMIT 1").get() as
      | { organization_id: string; name: string }
      | undefined;

    const invoiceRow = db.prepare("SELECT COUNT(*) as c FROM sales_invoices").get() as { c: number };
    const billRow = db.prepare("SELECT COUNT(*) as c FROM purchase_bills").get() as { c: number };
    const vendorRow = db
      .prepare("SELECT COUNT(DISTINCT vendor_id) as c FROM purchase_bills WHERE vendor_id IS NOT NULL")
      .get() as { c: number };
    const customerRow = db
      .prepare("SELECT COUNT(DISTINCT customer_id) as c FROM sales_invoices WHERE customer_id IS NOT NULL")
      .get() as { c: number };

    return {
      organizationId: org?.organization_id ?? null,
      organizationName: org?.name ?? null,
      salesInvoiceCount: invoiceRow.c,
      purchaseBillCount: billRow.c,
      distinctVendorCount: vendorRow.c,
      distinctCustomerCount: customerRow.c,
    };
  } catch {
    return empty;
  } finally {
    db?.close();
  }
}
