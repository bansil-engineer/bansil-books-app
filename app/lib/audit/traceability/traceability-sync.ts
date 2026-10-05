// ============================================================
// Bansil Books Analytics — Item Traceability: Sales Order / Purchase
// Order / Item Master sync (READ-only cache persistence). Every field
// read from a Zoho response is optional-chained and stored as-is or
// null — never defaulted/invented when Zoho's own field presence is
// NOT_VERIFIED (see ITEM_TRACEABILITY_DESIGN.md §D.3/§D.4). Zoho
// remains the master; these tables are a read-only cache, never edited
// by anything except this sync code.
// ============================================================

import type { DatabaseSync } from "node:sqlite";
import { fetchSalesOrders, fetchSalesOrderDetail, fetchPurchaseOrders, fetchPurchaseOrderDetail, fetchItemsMaster } from "./zoho-adapters.ts";
import { isBeforePhaseFBoundary } from "./phase-f-boundary.ts";

function str(v: unknown): string | null {
  return v === undefined || v === null ? null : String(v);
}

export interface SyncOutcome {
  apiCallCount: number;
  recordsFetched: number;
  recordsNew: number;
  recordsChanged: number;
}

/** Persists Sales Order headers + lines. Fetches full detail per order (list responses omit line_items) — same pattern as fetchInvoicesForDate's detail-resolution step. */
export async function syncSalesOrders(db: DatabaseSync, organizationId: string, sinceModifiedTime?: string): Promise<SyncOutcome> {
  let apiCallCount = 0;
  const listResult = await fetchSalesOrders(organizationId, sinceModifiedTime);
  apiCallCount += listResult.apiCallCount;

  let recordsNew = 0;
  let recordsChanged = 0;
  const now = new Date().toISOString();

  const upsertHeader = db.prepare(
    `INSERT INTO audit_sales_orders (salesorder_id, organization_id, salesorder_number, customer_id, customer_name, date, status, reference_number, total, last_modified_time, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(salesorder_id) DO UPDATE SET
       salesorder_number = excluded.salesorder_number, customer_id = excluded.customer_id, customer_name = excluded.customer_name,
       date = excluded.date, status = excluded.status, reference_number = excluded.reference_number, total = excluded.total,
       last_modified_time = excluded.last_modified_time, synced_at = excluded.synced_at`
  );
  const deleteLines = db.prepare(`DELETE FROM audit_sales_order_lines WHERE salesorder_id = ?`);
  const insertLine = db.prepare(
    `INSERT INTO audit_sales_order_lines (line_item_id, salesorder_id, item_id, sku, description, quantity, unit, rate, amount, item_order, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const header of listResult.records as Array<Record<string, unknown>>) {
    // Defensive Phase F boundary enforcement — never trust the remote date_start
    // filter alone (its behavior against this endpoint is NOT_VERIFIED). A
    // pre-boundary record is simply skipped here, never persisted, never deleted
    // if it happens to already exist locally from some other path.
    if (isBeforePhaseFBoundary(str(header.date))) continue;

    const salesorderId = String(header.salesorder_id);
    const existing = db.prepare(`SELECT last_modified_time FROM audit_sales_orders WHERE salesorder_id = ?`).get(salesorderId) as { last_modified_time: string | null } | undefined;
    const isNew = !existing;
    const changed = existing && existing.last_modified_time !== str(header.last_modified_time);
    if (!isNew && !changed) continue; // unchanged — skip the detail fetch entirely (incremental, no wasted API calls)

    const detail = await fetchSalesOrderDetail(organizationId, salesorderId);
    apiCallCount++;
    const src = detail ?? header;

    upsertHeader.run(
      salesorderId,
      organizationId,
      str(src.salesorder_number),
      str(src.customer_id),
      str(src.customer_name),
      str(src.date),
      str(src.status),
      str(src.reference_number),
      str(src.total),
      str(src.last_modified_time),
      now
    );

    deleteLines.run(salesorderId);
    const lineItems = (src.line_items as Array<Record<string, unknown>> | undefined) ?? [];
    for (const line of lineItems) {
      insertLine.run(
        String(line.line_item_id),
        salesorderId,
        str(line.item_id),
        str(line.sku), // presence NOT_VERIFIED against this org — stored as-is or null, never invented
        str(line.description ?? line.name),
        str(line.quantity),
        str(line.unit), // presence NOT_VERIFIED against this org
        str(line.rate),
        str(line.item_total ?? line.amount),
        line.item_order != null ? Number(line.item_order) : null,
        now
      );
    }

    if (isNew) recordsNew++;
    else recordsChanged++;
  }

  return { apiCallCount, recordsFetched: listResult.records.length, recordsNew, recordsChanged };
}

export async function syncPurchaseOrders(db: DatabaseSync, organizationId: string, sinceModifiedTime?: string): Promise<SyncOutcome> {
  let apiCallCount = 0;
  const listResult = await fetchPurchaseOrders(organizationId, sinceModifiedTime);
  apiCallCount += listResult.apiCallCount;

  let recordsNew = 0;
  let recordsChanged = 0;
  const now = new Date().toISOString();

  const upsertHeader = db.prepare(
    `INSERT INTO audit_purchase_orders (purchaseorder_id, organization_id, purchaseorder_number, vendor_id, vendor_name, date, status, reference_number, total, last_modified_time, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(purchaseorder_id) DO UPDATE SET
       purchaseorder_number = excluded.purchaseorder_number, vendor_id = excluded.vendor_id, vendor_name = excluded.vendor_name,
       date = excluded.date, status = excluded.status, reference_number = excluded.reference_number, total = excluded.total,
       last_modified_time = excluded.last_modified_time, synced_at = excluded.synced_at`
  );
  const deleteLines = db.prepare(`DELETE FROM audit_purchase_order_lines WHERE purchaseorder_id = ?`);
  const insertLine = db.prepare(
    `INSERT INTO audit_purchase_order_lines (line_item_id, purchaseorder_id, item_id, sku, description, quantity, unit, rate, amount, item_order, salesorder_item_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const header of listResult.records as Array<Record<string, unknown>>) {
    if (isBeforePhaseFBoundary(str(header.date))) continue;

    const purchaseorderId = String(header.purchaseorder_id);
    const existing = db.prepare(`SELECT last_modified_time FROM audit_purchase_orders WHERE purchaseorder_id = ?`).get(purchaseorderId) as { last_modified_time: string | null } | undefined;
    const isNew = !existing;
    const changed = existing && existing.last_modified_time !== str(header.last_modified_time);
    if (!isNew && !changed) continue;

    const detail = await fetchPurchaseOrderDetail(organizationId, purchaseorderId);
    apiCallCount++;
    const src = detail ?? header;

    upsertHeader.run(
      purchaseorderId,
      organizationId,
      str(src.purchaseorder_number),
      str(src.vendor_id),
      str(src.vendor_name),
      str(src.date),
      str(src.status),
      str(src.reference_number),
      str(src.total),
      str(src.last_modified_time),
      now
    );

    deleteLines.run(purchaseorderId);
    const lineItems = (src.line_items as Array<Record<string, unknown>> | undefined) ?? [];
    for (const line of lineItems) {
      insertLine.run(
        String(line.line_item_id),
        purchaseorderId,
        str(line.item_id),
        str(line.sku),
        str(line.description ?? line.name),
        str(line.quantity),
        str(line.unit),
        str(line.rate),
        str(line.item_total ?? line.amount),
        line.item_order != null ? Number(line.item_order) : null,
        str(line.salesorder_item_id), // native Zoho PO-line -> SO-line link, confirmed present live 2026-09-15
        now
      );
    }

    if (isNew) recordsNew++;
    else recordsChanged++;
  }

  return { apiCallCount, recordsFetched: listResult.records.length, recordsNew, recordsChanged };
}

/** Items master — no local create/edit path exists anywhere; this function only ever overwrites the local cache row from Zoho's own value. */
export async function syncItemMaster(db: DatabaseSync, organizationId: string, sinceModifiedTime?: string): Promise<SyncOutcome> {
  const result = await fetchItemsMaster(organizationId, sinceModifiedTime);
  let recordsNew = 0;
  let recordsChanged = 0;
  const now = new Date().toISOString();

  const upsert = db.prepare(
    `INSERT INTO audit_item_master (item_id, organization_id, name, sku, unit, status, rate, item_type, product_type, last_modified_time, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       name = excluded.name, sku = excluded.sku, unit = excluded.unit, status = excluded.status, rate = excluded.rate,
       item_type = excluded.item_type, product_type = excluded.product_type, last_modified_time = excluded.last_modified_time, synced_at = excluded.synced_at`
  );

  for (const item of result.records as Array<Record<string, unknown>>) {
    const itemId = String(item.item_id);
    const existing = db.prepare(`SELECT item_id FROM audit_item_master WHERE item_id = ?`).get(itemId);
    upsert.run(
      itemId,
      organizationId,
      str(item.name),
      str(item.sku),
      str(item.unit),
      str(item.status),
      str(item.rate),
      str(item.item_type),
      str(item.product_type),
      str(item.last_modified_time),
      now
    );
    if (existing) recordsChanged++;
    else recordsNew++;
  }

  return { apiCallCount: result.apiCallCount, recordsFetched: result.records.length, recordsNew, recordsChanged };
}
