// ============================================================
// Bansil Books Analytics — Phase F.0 P0: Customer/Vendor Outstanding
// Reads data/bansil_books.db strictly read-only (same pattern as
// books-source-adapter.ts) and snapshots ageing-bucketed outstanding
// balances into the audit workspace DB. Zero new Zoho scope needed —
// this is a recompute over already-synced Invoices/Bills data.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import * as path from "node:path";
import { parseScaled, sumScaled, formatScaled } from "../matching/decimal.ts";

const BOOKS_DB_FILE = path.join(process.cwd(), "data", "bansil_books.db");

export interface OutstandingBucketRow {
  entityId: string;
  entityName: string;
  outstandingBalance: string;
  bucket0to30: string;
  bucket31to60: string;
  bucket61to90: string;
  bucket90plus: string;
  openCount: number;
}

function bucketFor(dueDate: string | null, asOf: Date): "b0" | "b31" | "b61" | "b90" {
  if (!dueDate) return "b0";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "b0";
  const daysPastDue = Math.floor((asOf.getTime() - due.getTime()) / 86400000);
  if (daysPastDue <= 30) return "b0";
  if (daysPastDue <= 60) return "b31";
  if (daysPastDue <= 90) return "b61";
  return "b90";
}

function openBooksReadOnly(): DatabaseSync | null {
  if (!fs.existsSync(BOOKS_DB_FILE)) return null;
  try {
    return new DatabaseSync(BOOKS_DB_FILE, { readOnly: true });
  } catch {
    return null;
  }
}

/** Whether the Books DB file is present at all — used by the sync scheduler to distinguish "genuinely zero outstanding records" from "the source is unreadable" (never conflate the two). */
export function booksDbExists(): boolean {
  return fs.existsSync(BOOKS_DB_FILE);
}

export interface BooksCacheFreshness {
  lastSuccessfulSyncTime: string | null;
  lastSyncStatus: string | null;
  lastAttemptedSyncTime: string | null;
}

/**
 * Reads the REAL freshness of the underlying Invoice/Bill cache — the same
 * `sync_metadata` keys the existing "Smart Sync All Changed" button/
 * `performSync()` already maintain. This is how the P0 dashboard proves (or
 * disproves) that the upstream cache itself is fresh enough for a
 * near-real-time claim — never assumed, always read from the real state.
 */
export function getBooksCacheFreshness(): BooksCacheFreshness {
  const db = openBooksReadOnly();
  if (!db) return { lastSuccessfulSyncTime: null, lastSyncStatus: null, lastAttemptedSyncTime: null };
  try {
    const get = (key: string) => (db.prepare(`SELECT value FROM sync_metadata WHERE key = ?`).get(key) as { value: string } | undefined)?.value ?? null;
    return {
      lastSuccessfulSyncTime: get("last_successful_sync_time"),
      lastSyncStatus: get("last_sync_status"),
      lastAttemptedSyncTime: get("last_attempted_sync_time"),
    };
  } catch {
    return { lastSuccessfulSyncTime: null, lastSyncStatus: null, lastAttemptedSyncTime: null };
  } finally {
    db.close();
  }
}

/**
 * Known, disclosed coverage limitation: outstanding is computed from
 * Zoho's own authoritative `balance` field on each invoice/bill (already
 * net of payments and any credit notes/vendor credits Zoho itself has
 * applied to that invoice/bill) — this app does NOT independently sync
 * Credit Notes or Vendor Credits as their own source. If a credit is ever
 * recorded in Zoho in a way that does not flow through the invoice/bill's
 * own balance field, it would not be separately visible here.
 */
export const OUTSTANDING_COVERAGE_LIMITATION =
  "Outstanding uses Zoho's own authoritative invoice/bill balance field (already net of Zoho-applied payments and credits). Credit Notes and Vendor Credits are not independently synced as their own source in Phase F.0 — any credit not reflected in Zoho's own balance field would not be visible here.";

/** Computes ageing-bucketed customer outstanding from sales_invoices with balance > 0. Never mutates bansil_books.db. */
export function computeCustomerOutstanding(asOf: Date = new Date()): OutstandingBucketRow[] {
  const db = openBooksReadOnly();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT customer_id, customer_name, due_date, balance FROM sales_invoices
         WHERE customer_id IS NOT NULL AND balance IS NOT NULL AND CAST(balance AS REAL) > 0
           AND LOWER(COALESCE(status, '')) NOT IN ('void', 'cancelled', 'canceled', 'draft')`
      )
      .all() as Array<{ customer_id: string; customer_name: string; due_date: string | null; balance: string }>;

    const byCustomer = new Map<string, { name: string; buckets: Record<string, bigint[]>; count: number }>();
    for (const r of rows) {
      const key = r.customer_id;
      if (!byCustomer.has(key)) byCustomer.set(key, { name: r.customer_name, buckets: { b0: [], b31: [], b61: [], b90: [] }, count: 0 });
      const entry = byCustomer.get(key)!;
      const bucket = bucketFor(r.due_date, asOf);
      const amount = parseScaled(String(r.balance));
      entry.buckets[bucket].push(amount);
      entry.count += 1;
    }

    return Array.from(byCustomer.entries()).map(([customerId, v]) => {
      const all = [...v.buckets.b0, ...v.buckets.b31, ...v.buckets.b61, ...v.buckets.b90];
      return {
        entityId: customerId,
        entityName: v.name,
        outstandingBalance: formatScaled(sumScaled(all)),
        bucket0to30: formatScaled(sumScaled(v.buckets.b0)),
        bucket31to60: formatScaled(sumScaled(v.buckets.b31)),
        bucket61to90: formatScaled(sumScaled(v.buckets.b61)),
        bucket90plus: formatScaled(sumScaled(v.buckets.b90)),
        openCount: v.count,
      };
    });
  } finally {
    db.close();
  }
}

/** Computes ageing-bucketed vendor outstanding from purchase_bills with balance > 0. Never mutates bansil_books.db. */
export function computeVendorOutstanding(asOf: Date = new Date()): OutstandingBucketRow[] {
  const db = openBooksReadOnly();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT vendor_id, vendor_name, due_date, balance FROM purchase_bills
         WHERE vendor_id IS NOT NULL AND balance IS NOT NULL AND CAST(balance AS REAL) > 0
           AND LOWER(COALESCE(status, '')) NOT IN ('void', 'cancelled', 'canceled', 'draft')`
      )
      .all() as Array<{ vendor_id: string; vendor_name: string; due_date: string | null; balance: string }>;

    const byVendor = new Map<string, { name: string; buckets: Record<string, bigint[]>; count: number }>();
    for (const r of rows) {
      const key = r.vendor_id;
      if (!byVendor.has(key)) byVendor.set(key, { name: r.vendor_name, buckets: { b0: [], b31: [], b61: [], b90: [] }, count: 0 });
      const entry = byVendor.get(key)!;
      const bucket = bucketFor(r.due_date, asOf);
      const amount = parseScaled(String(r.balance));
      entry.buckets[bucket].push(amount);
      entry.count += 1;
    }

    return Array.from(byVendor.entries()).map(([vendorId, v]) => {
      const all = [...v.buckets.b0, ...v.buckets.b31, ...v.buckets.b61, ...v.buckets.b90];
      return {
        entityId: vendorId,
        entityName: v.name,
        outstandingBalance: formatScaled(sumScaled(all)),
        bucket0to30: formatScaled(sumScaled(v.buckets.b0)),
        bucket31to60: formatScaled(sumScaled(v.buckets.b31)),
        bucket61to90: formatScaled(sumScaled(v.buckets.b61)),
        bucket90plus: formatScaled(sumScaled(v.buckets.b90)),
        openCount: v.count,
      };
    });
  } finally {
    db.close();
  }
}

/** Persists an immutable snapshot of the given rows into the audit DB. Never deletes prior snapshots — history is preserved, same convention as every other Milestone A–E snapshot table. */
export function snapshotCustomerOutstanding(auditDb: DatabaseSync, rows: OutstandingBucketRow[], computedAt: string): void {
  const stmt = auditDb.prepare(
    `INSERT INTO audit_customer_outstanding
     (snapshot_id, customer_id, customer_name, outstanding_balance, bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_plus, open_invoice_count, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(randomUUID(), r.entityId, r.entityName, r.outstandingBalance, r.bucket0to30, r.bucket31to60, r.bucket61to90, r.bucket90plus, r.openCount, computedAt);
  }
}

export function snapshotVendorOutstanding(auditDb: DatabaseSync, rows: OutstandingBucketRow[], computedAt: string): void {
  const stmt = auditDb.prepare(
    `INSERT INTO audit_vendor_outstanding
     (snapshot_id, vendor_id, vendor_name, outstanding_balance, bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_plus, open_bill_count, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(randomUUID(), r.entityId, r.entityName, r.outstandingBalance, r.bucket0to30, r.bucket31to60, r.bucket61to90, r.bucket90plus, r.openCount, computedAt);
  }
}

/** Latest snapshot rows (most recent computed_at only) for the dashboard. */
export function getLatestCustomerOutstanding(auditDb: DatabaseSync): Array<Record<string, unknown>> {
  const latest = auditDb.prepare(`SELECT MAX(computed_at) as t FROM audit_customer_outstanding`).get() as { t: string | null };
  if (!latest.t) return [];
  return auditDb.prepare(`SELECT * FROM audit_customer_outstanding WHERE computed_at = ? ORDER BY outstanding_balance DESC`).all(latest.t) as Array<Record<string, unknown>>;
}

export function getLatestVendorOutstanding(auditDb: DatabaseSync): Array<Record<string, unknown>> {
  const latest = auditDb.prepare(`SELECT MAX(computed_at) as t FROM audit_vendor_outstanding`).get() as { t: string | null };
  if (!latest.t) return [];
  return auditDb.prepare(`SELECT * FROM audit_vendor_outstanding WHERE computed_at = ? ORDER BY outstanding_balance DESC`).all(latest.t) as Array<Record<string, unknown>>;
}
