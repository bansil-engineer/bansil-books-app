import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      process.env[k] = v;
    }
  }
}

import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";

async function syncRealLiveDocuments() {
  const dbPath = path.resolve(process.cwd(), "data/bansil_books.db");
  const backupPath = path.resolve(process.cwd(), "data/bansil_books.db.bak");

  // 1. Ensure backup exists
  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[BACKUP] Verified SQLite backup at ${backupPath}`);
  }

  const db = new DatabaseSync(dbPath);

  // 2. Migration check: Add columns if they don't exist
  try {
    db.exec("ALTER TABLE sales_invoices ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
  } catch {}
  try {
    db.exec("ALTER TABLE sales_invoice_line_items ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
  } catch {}
  try {
    db.exec("ALTER TABLE sales_invoice_line_items ADD COLUMN description TEXT;");
  } catch {}
  try {
    db.exec("ALTER TABLE purchase_bills ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
  } catch {}
  try {
    db.exec("ALTER TABLE purchase_bill_line_items ADD COLUMN source TEXT DEFAULT 'ZOHO_BOOKS';");
  } catch {}

  // 3. Remove local demo / fixture data from production SQLite tables
  const deletedInvLines = db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id LIKE 'inv_lantec_%' OR invoice_id LIKE 'inv_jsw_%'").run();
  const deletedInvs = db.prepare("DELETE FROM sales_invoices WHERE invoice_id LIKE 'inv_lantec_%' OR invoice_id LIKE 'inv_jsw_%'").run();
  const deletedBillLines = db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id LIKE 'bill_%'").run();
  const deletedBills = db.prepare("DELETE FROM purchase_bills WHERE bill_id LIKE 'bill_%'").run();
  console.log(`[ISOLATION] Removed demo fixtures: ${deletedInvs.changes} invoices, ${deletedInvLines.changes} inv lines, ${deletedBills.changes} bills, ${deletedBillLines.changes} bill lines.`);

  // 4. Fetch real live Zoho Bill AA2450002266
  const orgId = "774390949";
  const { token, store } = await getValidAccessToken();
  const now = new Date().toISOString();

  console.log("\n[FETCH GET] Searching Bill AA2450002266 from Zoho Books...");
  const billListRes = await secureZohoFetch(`${store.api_domain}/books/v3/bills?bill_number=AA2450002266&organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const billListData = await billListRes.json();
  const liveBillHeader = billListData.bills?.[0];

  if (liveBillHeader) {
    const billDetailRes = await secureZohoFetch(`${store.api_domain}/books/v3/bills/${liveBillHeader.bill_id}?organization_id=${orgId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const billDetailData = await billDetailRes.json();
    const b = billDetailData.bill;

    console.log(`[INGEST] Ingesting real Bill ${b.bill_number} (ID: ${b.bill_id}), Vendor: ${b.vendor_name}`);

    // Insert bill
    db.prepare(`
      INSERT OR REPLACE INTO purchase_bills
      (bill_id, organization_id, bill_number, date, due_date, vendor_id, vendor_name, reference_number, status, total, balance, bill_url, is_verified_link, created_time, last_modified_time, source, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
    `).run(
      b.bill_id,
      orgId,
      b.bill_number,
      b.date,
      b.due_date || "",
      b.vendor_id,
      b.vendor_name,
      b.reference_number || "",
      b.status || "OPEN",
      b.total || 0,
      b.balance || 0,
      `https://books.bansilengineers.com/app/${orgId}#/bills/${b.bill_id}`,
      1,
      b.created_time || now,
      b.last_modified_time || now,
      now
    );

    // Delete existing lines for this bill if any
    db.prepare("DELETE FROM purchase_bill_line_items WHERE bill_id = ?").run(b.bill_id);

    // Insert bill line items
    for (const line of b.line_items || []) {
      const custId = line.customer_id || "";
      const custName = line.customer_name || line.bbt_customer_name || "";
      const status = custName ? "VERIFIED" : "CUSTOMER DETAILS MISSING";

      db.prepare(`
        INSERT INTO purchase_bill_line_items
        (line_item_id, bill_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, customer_data_status, source, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
      `).run(
        line.line_item_id,
        b.bill_id,
        line.item_id,
        line.name,
        line.sku || "",
        line.quantity,
        line.rate,
        line.item_total,
        custId,
        custName,
        line.description || "",
        status,
        now
      );
    }
    console.log(`[INGEST] Stored ${b.line_items?.length} lines for Bill ${b.bill_number}`);
  }

  // 5. Fetch real live Zoho Invoice INV-2526163
  console.log("\n[FETCH GET] Searching Invoice INV-2526163 from Zoho Books...");
  const invListRes = await secureZohoFetch(`${store.api_domain}/books/v3/invoices?invoice_number=INV-2526163&organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const invListData = await invListRes.json();
  const liveInvHeader = invListData.invoices?.[0];

  if (liveInvHeader) {
    const invDetailRes = await secureZohoFetch(`${store.api_domain}/books/v3/invoices/${liveInvHeader.invoice_id}?organization_id=${orgId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const invDetailData = await invDetailRes.json();
    const inv = invDetailData.invoice;

    console.log(`[INGEST] Ingesting real Invoice ${inv.invoice_number} (ID: ${inv.invoice_id}), Customer: ${inv.customer_name}`);

    // Insert invoice
    db.prepare(`
      INSERT OR REPLACE INTO sales_invoices
      (invoice_id, organization_id, invoice_number, date, due_date, customer_id, customer_name, reference_number, status, total, balance, invoice_url, is_verified_link, created_time, last_modified_time, source, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
    `).run(
      inv.invoice_id,
      orgId,
      inv.invoice_number,
      inv.date,
      inv.due_date || "",
      inv.customer_id,
      inv.customer_name,
      inv.reference_number || "",
      inv.status || "OPEN",
      inv.total || 0,
      inv.balance || 0,
      `https://books.bansilengineers.com/app/${orgId}#/invoices/${inv.invoice_id}`,
      1,
      inv.created_time || now,
      inv.last_modified_time || now,
      now
    );

    // Delete existing lines for this invoice if any
    db.prepare("DELETE FROM sales_invoice_line_items WHERE invoice_id = ?").run(inv.invoice_id);

    // Insert invoice line items
    for (const line of inv.line_items || []) {
      db.prepare(`
        INSERT INTO sales_invoice_line_items
        (line_item_id, invoice_id, item_id, item_name, sku, quantity, rate, line_total, bbt_customer_id, bbt_customer_name, description, source, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZOHO_BOOKS', ?)
      `).run(
        line.line_item_id,
        inv.invoice_id,
        line.item_id,
        line.name,
        line.sku || "",
        line.quantity,
        line.rate,
        line.item_total,
        inv.customer_id,
        inv.customer_name,
        line.description || "",
        now
      );
    }
    console.log(`[INGEST] Stored ${inv.line_items?.length} lines for Invoice ${inv.invoice_number}`);
  }

  // Update sync metadata
  db.prepare(`
    INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
    VALUES ('last_successful_sync_time', ?, ?)
  `).run(now, now);

  console.log("\n[VERIFICATION] Auditing SQLite rows in production tables:");
  const invRows = db.prepare("SELECT invoice_id, invoice_number, customer_name, source, synced_at FROM sales_invoices").all();
  console.log("Invoices:", invRows);

  const invLineRows = db.prepare("SELECT line_item_id, invoice_id, item_id, item_name, quantity, rate, line_total, source, synced_at FROM sales_invoice_line_items").all();
  console.log(`Invoice lines count: ${invLineRows.length}`);

  const billRows = db.prepare("SELECT bill_id, bill_number, vendor_name, source, synced_at FROM purchase_bills").all();
  console.log("Bills:", billRows);

  const billLineRows = db.prepare("SELECT line_item_id, bill_id, item_id, item_name, quantity, rate, line_total, bbt_customer_name, source, synced_at FROM purchase_bill_line_items").all();
  console.log(`Bill lines count: ${billLineRows.length}`);
}

syncRealLiveDocuments().catch(console.error);
