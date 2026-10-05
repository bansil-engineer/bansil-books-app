// ============================================================
// Bansil Books Analytics — Phase 4D: READ-ONLY rate source reader
//
// Opens bansil_books.db and audit_workspace.db strictly read-only
// (SQLite URI mode=ro + readOnly connection + PRAGMA query_only).
// `immutable: true` additionally guarantees no -wal/-shm side files
// are created (used for snapshots). There is no INSERT / UPDATE /
// DELETE / REINDEX / VACUUM / DDL anywhere in this module.
//
// Does NOT call price-reference-engine.getPriceReferenceData():
// that path opens the business DB through getDatabase(), which is a
// writable connection that runs initDatabase(). Its documented
// semantics (taxable pre-GST line values, per-line evidence) are
// reproduced here over a read-only connection instead.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAuditWorkspaceDbPath, getBansilBooksDbPath } from "../../db/db-resolver";
import type { ItemMasterRow } from "./rate-types";

export interface RateSourceReaderOptions {
  bansilBooksDbPath?: string;
  auditWorkspaceDbPath?: string;
  /** Snapshot mode: SQLite immutable=1 (no side files, no locking). */
  immutable?: boolean;
}

export interface BillLineRow {
  line_item_id: string;
  bill_id: string;
  bill_number: string;
  date: string;
  vendor_id: string;
  vendor_name: string;
  bill_status: string;
  bill_total: number;
  bill_line_sum: number;
  bill_last_modified: string | null;
  bill_content_fingerprint: string | null;
  item_id: string;
  item_name: string;
  sku: string | null;
  quantity: number;
  rate: number;
  line_total: number;
  description: string | null;
  unit: string | null;
  purchaseorder_item_id: string | null;
}

export interface PoLineRow {
  line_item_id: string;
  purchaseorder_id: string;
  purchaseorder_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  date: string | null;
  po_status: string | null;
  po_total: number;
  po_line_sum: number;
  po_last_modified: string | null;
  item_id: string | null;
  sku: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  rate: number;
  amount: number;
}

/** sha256 over a canonical JSON of the exact row values. */
export function fingerprintRow(row: object): string {
  const entries = Object.entries(row as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function openReadOnly(p: string, immutable: boolean): DatabaseSync | null {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return null;
  const url = pathToFileURL(abs);
  url.searchParams.set("mode", "ro");
  if (immutable) url.searchParams.set("immutable", "1");
  const db = new DatabaseSync(url, { readOnly: true });
  // Connection-level guard (not a database write).
  db.exec("PRAGMA query_only = ON");
  return db;
}

function hasTable(db: DatabaseSync | null, name: string): boolean {
  if (!db) return false;
  const r = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return !!r;
}

const num = (v: unknown): number => (v === null || v === undefined || v === "" ? Number.NaN : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const BILL_LINE_SELECT = `
  SELECT l.line_item_id, l.bill_id, b.bill_number, b.date, b.vendor_id, b.vendor_name,
         b.status AS bill_status, b.total AS bill_total,
         (SELECT SUM(x.line_total) FROM purchase_bill_line_items x WHERE x.bill_id = b.bill_id) AS bill_line_sum,
         b.last_modified_time AS bill_last_modified, b.content_fingerprint AS bill_content_fingerprint,
         l.item_id, l.item_name, l.sku, l.quantity, l.rate, l.line_total, l.description, l.unit,
         l.purchaseorder_item_id
  FROM purchase_bill_line_items l
  JOIN purchase_bills b ON b.bill_id = l.bill_id`;

const PO_LINE_SELECT = `
  SELECT l.line_item_id, l.purchaseorder_id, p.purchaseorder_number, p.vendor_id, p.vendor_name,
         p.date, p.status AS po_status, p.total AS po_total,
         (SELECT SUM(CAST(x.amount AS REAL)) FROM audit_purchase_order_lines x WHERE x.purchaseorder_id = p.purchaseorder_id) AS po_line_sum,
         p.last_modified_time AS po_last_modified,
         l.item_id, l.sku, l.description, l.quantity, l.unit, l.rate, l.amount
  FROM audit_purchase_order_lines l
  JOIN audit_purchase_orders p ON p.purchaseorder_id = l.purchaseorder_id`;

function toBillRow(r: Record<string, unknown>): BillLineRow {
  return {
    line_item_id: String(r.line_item_id),
    bill_id: String(r.bill_id),
    bill_number: String(r.bill_number),
    date: String(r.date),
    vendor_id: String(r.vendor_id),
    vendor_name: String(r.vendor_name),
    bill_status: String(r.bill_status),
    bill_total: num(r.bill_total),
    bill_line_sum: num(r.bill_line_sum),
    bill_last_modified: str(r.bill_last_modified),
    bill_content_fingerprint: str(r.bill_content_fingerprint),
    item_id: String(r.item_id ?? ""),
    item_name: String(r.item_name ?? ""),
    sku: str(r.sku),
    quantity: num(r.quantity),
    rate: num(r.rate),
    line_total: num(r.line_total),
    description: str(r.description),
    unit: str(r.unit),
    purchaseorder_item_id: str(r.purchaseorder_item_id),
  };
}

function toPoRow(r: Record<string, unknown>): PoLineRow {
  return {
    line_item_id: String(r.line_item_id),
    purchaseorder_id: String(r.purchaseorder_id),
    purchaseorder_number: str(r.purchaseorder_number),
    vendor_id: str(r.vendor_id),
    vendor_name: str(r.vendor_name),
    date: str(r.date),
    po_status: str(r.po_status),
    po_total: num(r.po_total),
    po_line_sum: num(r.po_line_sum),
    po_last_modified: str(r.po_last_modified),
    item_id: str(r.item_id),
    sku: str(r.sku),
    description: str(r.description),
    quantity: num(r.quantity),
    unit: str(r.unit),
    rate: num(r.rate),
    amount: num(r.amount),
  };
}

export class RateSourceReader {
  readonly booksPath: string;
  readonly auditPath: string;
  private books: DatabaseSync | null;
  private audit: DatabaseSync | null;
  private itemCache: ItemMasterRow[] | null = null;

  constructor(opts: RateSourceReaderOptions = {}) {
    this.booksPath = path.resolve(opts.bansilBooksDbPath ?? getBansilBooksDbPath());
    this.auditPath = path.resolve(opts.auditWorkspaceDbPath ?? getAuditWorkspaceDbPath());
    const immutable = opts.immutable === true;
    this.books = openReadOnly(this.booksPath, immutable);
    this.audit = openReadOnly(this.auditPath, immutable);
  }

  get billsAvailable(): boolean {
    return hasTable(this.books, "purchase_bills") && hasTable(this.books, "purchase_bill_line_items");
  }
  get posAvailable(): boolean {
    return hasTable(this.audit, "audit_purchase_orders") && hasTable(this.audit, "audit_purchase_order_lines");
  }
  get itemMasterAvailable(): boolean {
    return hasTable(this.audit, "audit_item_master");
  }

  // ---------- item master ----------

  listItems(): ItemMasterRow[] {
    if (this.itemCache) return this.itemCache;
    if (!this.itemMasterAvailable) return (this.itemCache = []);
    const rows = this.audit!.prepare(
      "SELECT item_id, name, sku, unit, status FROM audit_item_master ORDER BY item_id",
    ).all() as Record<string, unknown>[];
    this.itemCache = rows.map((r) => ({
      item_id: String(r.item_id), name: str(r.name), sku: str(r.sku), unit: str(r.unit), status: str(r.status),
    }));
    return this.itemCache;
  }

  getItemById(itemId: string): ItemMasterRow | null {
    const fromMaster = this.listItems().find((i) => i.item_id === itemId);
    if (fromMaster) return fromMaster;
    if (!this.billsAvailable) return null;
    // Item id present on bill lines but not in the item master snapshot.
    const r = this.books!.prepare(
      `SELECT l.item_id, l.item_name, l.sku FROM purchase_bill_line_items l JOIN purchase_bills b ON b.bill_id = l.bill_id
       WHERE l.item_id = ? ORDER BY b.date DESC, l.line_item_id DESC LIMIT 1`,
    ).get(itemId) as Record<string, unknown> | undefined;
    return r ? { item_id: String(r.item_id), name: str(r.item_name), sku: str(r.sku), unit: null, status: "NOT_IN_ITEM_MASTER" } : null;
  }

  // ---------- bills (actual purchase) ----------

  getBillLinesByItemId(itemId: string): BillLineRow[] {
    if (!this.billsAvailable || !itemId) return [];
    const rows = this.books!.prepare(`${BILL_LINE_SELECT} WHERE l.item_id = ? ORDER BY b.date, l.line_item_id`).all(itemId);
    return (rows as Record<string, unknown>[]).map(toBillRow);
  }

  /** Bill lines with no item_id (matched later only by exact normalized name). */
  getBillLinesWithoutItemId(): BillLineRow[] {
    if (!this.billsAvailable) return [];
    const rows = this.books!.prepare(
      `${BILL_LINE_SELECT} WHERE l.item_id IS NULL OR TRIM(l.item_id) = '' ORDER BY b.date, l.line_item_id`,
    ).all();
    return (rows as Record<string, unknown>[]).map(toBillRow);
  }

  getBillLinesForBills(billIds: string[]): BillLineRow[] {
    if (!this.billsAvailable || billIds.length === 0) return [];
    const ph = billIds.map(() => "?").join(",");
    const rows = this.books!.prepare(`${BILL_LINE_SELECT} WHERE l.bill_id IN (${ph}) ORDER BY b.date, l.line_item_id`).all(...billIds);
    return (rows as Record<string, unknown>[]).map(toBillRow);
  }

  getBillLineIdsLinkedToPoLines(poLineIds: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (!this.billsAvailable || poLineIds.length === 0) return out;
    const ph = poLineIds.map(() => "?").join(",");
    const rows = this.books!.prepare(
      `SELECT purchaseorder_item_id, line_item_id FROM purchase_bill_line_items
       WHERE purchaseorder_item_id IN (${ph}) ORDER BY line_item_id`,
    ).all(...poLineIds) as Record<string, unknown>[];
    for (const r of rows) {
      const k = String(r.purchaseorder_item_id);
      out.set(k, [...(out.get(k) ?? []), String(r.line_item_id)]);
    }
    return out;
  }

  // ---------- purchase orders (committed / provisional) ----------

  getPoLinesByItemId(itemId: string): PoLineRow[] {
    if (!this.posAvailable || !itemId) return [];
    const rows = this.audit!.prepare(`${PO_LINE_SELECT} WHERE l.item_id = ? ORDER BY p.date, l.line_item_id`).all(itemId);
    return (rows as Record<string, unknown>[]).map(toPoRow);
  }

  // ---------- fingerprints ----------

  /** Source-level fingerprint (row counts, latest sync / modification markers, value checksums). */
  getSourceFingerprints(): { books: string | null; audit: string | null } {
    const books = this.billsAvailable
      ? fingerprintRow(this.books!.prepare(
          `SELECT (SELECT COUNT(*) FROM purchase_bills) AS bills, (SELECT COUNT(*) FROM purchase_bill_line_items) AS lines,
                  (SELECT MAX(synced_at) FROM purchase_bills) AS bsync, (SELECT MAX(last_modified_time) FROM purchase_bills) AS bmod,
                  (SELECT MAX(synced_at) FROM purchase_bill_line_items) AS lsync,
                  (SELECT TOTAL(total) FROM purchase_bills) AS btotal,
                  (SELECT TOTAL(rate) FROM purchase_bill_line_items) AS lrate, (SELECT TOTAL(quantity) FROM purchase_bill_line_items) AS lqty,
                  (SELECT TOTAL(line_total) FROM purchase_bill_line_items) AS lamount`,
        ).get() as object)
      : null;
    const audit = this.posAvailable
      ? fingerprintRow(this.audit!.prepare(
          `SELECT (SELECT COUNT(*) FROM audit_purchase_orders) AS pos, (SELECT COUNT(*) FROM audit_purchase_order_lines) AS lines,
                  (SELECT MAX(synced_at) FROM audit_purchase_orders) AS psync, (SELECT MAX(last_modified_time) FROM audit_purchase_orders) AS pmod,
                  (SELECT MAX(synced_at) FROM audit_purchase_order_lines) AS lsync,
                  (SELECT TOTAL(CAST(total AS REAL)) FROM audit_purchase_orders) AS ptotal,
                  (SELECT TOTAL(CAST(rate AS REAL)) FROM audit_purchase_order_lines) AS lrate,
                  (SELECT TOTAL(CAST(quantity AS REAL)) FROM audit_purchase_order_lines) AS lqty,
                  (SELECT TOTAL(CAST(amount AS REAL)) FROM audit_purchase_order_lines) AS lamount`,
        ).get() as object)
      : null;
    return { books, audit };
  }

  close(): void {
    this.books?.close();
    this.audit?.close();
    this.books = null;
    this.audit = null;
    this.itemCache = null;
  }
}
