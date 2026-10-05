import { getDatabase } from '../db/database.ts';
import { getAuditDatabase } from '../db/audit-database.ts';

export interface UniversalSearchResult {
  id: string;
  sourceType: 'INVOICE' | 'BILL' | 'ITEM' | 'ACTIVITY' | 'COMPOSITE' | 'ORDER';
  title: string;
  subtitle: string;
  snippet: string;
  amount?: number;
  qty?: number;
  rate?: number;
  date?: string;
  deeplink?: string;
  matchScore: number;
}

export class UniversalSearchService {
  /**
   * Search across all local indexed data without making Zoho API calls.
   *
   * ROOT CAUSE FIX (2026-09-16): Multi-word queries like "Philips 250 Watt" were returning
   * zero results because the SQL WHERE clause used a single concatenated LIKE '%philips 250 watt%'.
   * Real descriptions contain newlines and punctuation between tokens (e.g. "Make - Philips,\n250 Watt"),
   * so a phrase match never fires. Fix: build per-token OR conditions in SQL so each token is
   * independently matched. JS scoring (computeScore) then filters by how many tokens overlap,
   * ensuring exact doc/SKU matches still rank above description matches.
   *
   * LIMIT FIX (2026-09-16): The JOIN-level LIMIT was consuming all result slots with repeated
   * rows from multi-line bills/invoices, preventing lower-matched bills from appearing.
   * Fix: use DISTINCT header-level subquery for matching, then fetch best matching line separately.
   */
  public searchUniversal(query: string): UniversalSearchResult[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const db = getDatabase();
    const auditDb = getAuditDatabase();
    const results: UniversalSearchResult[] = [];

    let qLower = trimmedQuery.toLowerCase();
    
    // Normalize '250w' to '250 watt' for owner regression
    qLower = qLower.replace(/(\d+)w\b/g, '$1 watt');
    
    const qLike = `%${qLower}%`;

    // Split on whitespace AND punctuation separators (comma, dash, dot) for token matching.
    // Filter tokens < 2 chars (too broad) but keep the full qLike for exact phrase matching.
    const tokens = qLower
      .split(/[\s,\-\.\/\\]+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2);

    // Build per-token OR LIKE condition for a column expression (already lower()-wrapped by caller)
    // Returns: { sql: "(col LIKE ? OR col LIKE ?...)", params: ["%tok1%", "%tok2%"...] }
    function tokenOrLike(colExpr: string): { sql: string; params: string[] } {
      if (tokens.length === 0) return { sql: `${colExpr} LIKE ?`, params: [qLike] };
      const parts = tokens.map(() => `${colExpr} LIKE ?`);
      return { sql: `(${parts.join(' OR ')})`, params: tokens.map(t => `%${t}%`) };
    }

    // Score: how well a text field matches the query
    function computeScore(text: string | null | undefined, isExactField: boolean = false): number {
      if (!text) return 0;
      const lowerText = text.toLowerCase();
      if (lowerText === qLower) return 100;
      if (isExactField && lowerText.includes(qLower)) return 80;
      if (lowerText.includes(qLower)) return 60;

      if (tokens.length === 0) return 0;
      let tokenMatches = 0;
      for (const t of tokens) {
        if (lowerText.includes(t)) tokenMatches++;
      }
      if (tokenMatches === 0) return 0;
      const ratio = tokenMatches / tokens.length;
      // For multi-token queries, require at least 50% token match on description fields
      // to avoid noise (e.g. '250' alone matching everything with a number).
      // Exact fields (doc#, SKU, party) always pass through.
      if (!isExactField && tokens.length > 1 && ratio < 0.5) return 0;
      return isExactField ? ratio * 70 : ratio * 40;
    }

    // Extract a readable snippet around the first matched token
    function descSnippet(text: string | null | undefined, maxLen: number = 140): string {
      if (!text) return '';
      const normalized = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
      const lower = normalized.toLowerCase();
      let bestIdx = -1;
      for (const t of tokens) {
        const idx = lower.indexOf(t);
        if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
      }
      if (bestIdx === -1) return normalized.substring(0, maxLen);
      const start = Math.max(0, bestIdx - 25);
      const raw = normalized.slice(start, start + maxLen);
      return (start > 0 ? '…' : '') + raw + (start + maxLen < normalized.length ? '…' : '');
    }

    // --- 1. INVOICES ---
    // Strategy: find matching INVOICE HEADERS first (by doc#/customer/ref), then find any
    // matching LINE ITEM per invoice. This avoids consuming all LIMIT slots on JOIN rows.
    try {
      const descLikes = tokenOrLike('lower(description)');
      const itemNameLikes = tokenOrLike('lower(item_name)');

      // Step A: Match on header fields → get distinct invoice IDs
      const headerMatches = db.prepare(`
        SELECT DISTINCT invoice_id FROM sales_invoices
        WHERE lower(invoice_number) LIKE ?
           OR lower(customer_name) LIKE ?
           OR lower(reference_number) LIKE ?
        LIMIT 30
      `).all(qLike, qLike, qLike) as { invoice_id: string }[];

      // Step B: Match on line item fields → get distinct invoice IDs
      // Priority 1: ALL tokens match in description (e.g., 'Philips' AND '250' AND 'Watt')
      const descAndSql = tokens.length > 1
        ? tokens.map(() => 'lower(description) LIKE ?').join(' AND ')
        : 'lower(description) LIKE ?';
      const descAndParams = tokens.length > 1 ? tokens.map(t => `%${t}%`) : [qLike];
      const lineMatchesDescAnd = db.prepare(`
        SELECT DISTINCT invoice_id FROM sales_invoice_line_items
        WHERE ${descAndSql}
        LIMIT 50
      `).all(...descAndParams) as { invoice_id: string }[];

      // Priority 2: Any single token OR match in item_name, sku, description
      const lineMatches = db.prepare(`
        SELECT DISTINCT invoice_id FROM sales_invoice_line_items
        WHERE lower(item_name) LIKE ?
           OR lower(sku) LIKE ?
           OR ${descLikes.sql}
        LIMIT 50
      `).all(qLike, qLike, ...descLikes.params) as { invoice_id: string }[];

      // Priority 3: token OR on item_name
      const lineMatchesToken = db.prepare(`
        SELECT DISTINCT invoice_id FROM sales_invoice_line_items
        WHERE ${itemNameLikes.sql}
        LIMIT 50
      `).all(...itemNameLikes.params) as { invoice_id: string }[];

      const allInvoiceIds = [
        ...new Set([
          ...headerMatches.map(r => r.invoice_id),
          ...lineMatchesDescAnd.map(r => r.invoice_id),
          ...lineMatches.map(r => r.invoice_id),
          ...lineMatchesToken.map(r => r.invoice_id),
        ])
      ].slice(0, 60);

      for (const invoiceId of allInvoiceIds) {
        // Fetch header
        const inv = db.prepare(`
          SELECT invoice_id, invoice_number, date, customer_name, reference_number, total, invoice_url
          FROM sales_invoices WHERE invoice_id = ?
        `).get(invoiceId) as Record<string, unknown> | undefined;
        if (!inv) continue;

        // Find best matching line
        // Find best matching line: prefer lines whose description or item_name matches
        const descLikesNoAlias = tokenOrLike('lower(description)');
        const line = db.prepare(`
          SELECT item_name, sku, description, quantity, rate
          FROM sales_invoice_line_items
          WHERE invoice_id = ?
          ORDER BY (
            CASE WHEN ${descLikesNoAlias.sql} THEN 1 ELSE 0 END +
            CASE WHEN lower(item_name) LIKE ? THEN 1 ELSE 0 END
          ) DESC
          LIMIT 1
        `).get(invoiceId, ...descLikesNoAlias.params, qLike) as Record<string, unknown> | undefined;

        const score = Math.max(
          computeScore(inv.invoice_number as string, true),
          computeScore(inv.reference_number as string, true),
          computeScore(inv.customer_name as string),
          computeScore(line?.item_name as string),
          computeScore(line?.sku as string, true),
          computeScore(line?.description as string)
        );

        if (score > 0) {
          results.push({
            id: invoiceId,
            sourceType: 'INVOICE',
            title: `Invoice ${(inv.invoice_number as string) || 'N/A'}`,
            subtitle: (inv.customer_name as string) || 'Unknown Customer',
            snippet: descSnippet(
              [line?.item_name, line?.sku, line?.description].filter(Boolean).join(' | ')
            ),
            amount: inv.total as number,
            qty: line?.quantity as number | undefined,
            rate: line?.rate as number | undefined,
            date: inv.date as string,
            deeplink: inv.invoice_url ? `invoice:${invoiceId}` : undefined,
            matchScore: score
          });
        }
      }
    } catch (e) {
      console.warn('Search Error in Invoices:', e);
    }

    // --- 2. BILLS ---
    try {
      const descLikes = tokenOrLike('lower(description)');
      const itemNameLikes = tokenOrLike('lower(item_name)');

      const headerMatches = db.prepare(`
        SELECT DISTINCT bill_id FROM purchase_bills
        WHERE lower(bill_number) LIKE ?
           OR lower(vendor_name) LIKE ?
           OR lower(reference_number) LIKE ?
        LIMIT 30
      `).all(qLike, qLike, qLike) as { bill_id: string }[];

      // Priority 1: ALL tokens match in description
      const descAndSql = tokens.length > 1
        ? tokens.map(() => 'lower(description) LIKE ?').join(' AND ')
        : 'lower(description) LIKE ?';
      const descAndParams = tokens.length > 1 ? tokens.map(t => `%${t}%`) : [qLike];
      const lineMatchesDescAnd = db.prepare(`
        SELECT DISTINCT bill_id FROM purchase_bill_line_items
        WHERE ${descAndSql}
        LIMIT 50
      `).all(...descAndParams) as { bill_id: string }[];

      // Priority 2: Any single token OR match
      const lineMatches = db.prepare(`
        SELECT DISTINCT bill_id FROM purchase_bill_line_items
        WHERE lower(item_name) LIKE ?
           OR lower(sku) LIKE ?
           OR ${descLikes.sql}
        LIMIT 50
      `).all(qLike, qLike, ...descLikes.params) as { bill_id: string }[];

      const lineMatchesToken = db.prepare(`
        SELECT DISTINCT bill_id FROM purchase_bill_line_items
        WHERE ${itemNameLikes.sql}
        LIMIT 50
      `).all(...itemNameLikes.params) as { bill_id: string }[];

      const allBillIds = [
        ...new Set([
          ...headerMatches.map(r => r.bill_id),
          ...lineMatchesDescAnd.map(r => r.bill_id),
          ...lineMatches.map(r => r.bill_id),
          ...lineMatchesToken.map(r => r.bill_id),
        ])
      ].slice(0, 60);

      for (const billId of allBillIds) {
        const bill = db.prepare(`
          SELECT bill_id, bill_number, date, vendor_name, reference_number, total, bill_url
          FROM purchase_bills WHERE bill_id = ?
        `).get(billId) as Record<string, unknown> | undefined;
        if (!bill) continue;

        // Find best matching line: prefer lines whose description or item_name matches
        const descLikesNoAlias = tokenOrLike('lower(description)');
        const line = db.prepare(`
          SELECT item_name, sku, description, quantity, rate
          FROM purchase_bill_line_items
          WHERE bill_id = ?
          ORDER BY (
            CASE WHEN ${descLikesNoAlias.sql} THEN 1 ELSE 0 END +
            CASE WHEN lower(item_name) LIKE ? THEN 1 ELSE 0 END
          ) DESC
          LIMIT 1
        `).get(billId, ...descLikesNoAlias.params, qLike) as Record<string, unknown> | undefined;

        const score = Math.max(
          computeScore(bill.bill_number as string, true),
          computeScore(bill.reference_number as string, true),
          computeScore(bill.vendor_name as string),
          computeScore(line?.item_name as string),
          computeScore(line?.sku as string, true),
          computeScore(line?.description as string)
        );

        if (score > 0) {
          results.push({
            id: billId,
            sourceType: 'BILL',
            title: `Bill ${(bill.bill_number as string) || 'N/A'}`,
            subtitle: (bill.vendor_name as string) || 'Unknown Vendor',
            snippet: descSnippet(
              [line?.item_name, line?.sku, line?.description].filter(Boolean).join(' | ')
            ),
            amount: bill.total as number,
            qty: line?.quantity as number | undefined,
            rate: line?.rate as number | undefined,
            date: bill.date as string,
            deeplink: bill.bill_url ? `bill:${billId}` : undefined,
            matchScore: score
          });
        }
      }
    } catch (e) {
      console.warn('Search Error in Bills:', e);
    }

    // --- 3. ITEMS (Audit DB) ---
    try {
      const nameLikes = tokenOrLike('lower(name)');
      const items = auditDb.prepare(`
        SELECT item_id, name, sku, item_type, product_type, rate, last_modified_time
        FROM audit_item_master
        WHERE ${nameLikes.sql}
           OR lower(sku) LIKE ?
        LIMIT 30
      `).all(...nameLikes.params, qLike) as Record<string, unknown>[];

      for (const i of items) {
        const score = Math.max(
          computeScore(i.name as string),
          computeScore(i.sku as string, true)
        );
        if (score > 0) {
          results.push({
            id: i.item_id as string,
            sourceType: 'ITEM',
            title: (i.name as string) || 'Unnamed Item',
            subtitle: `SKU: ${(i.sku as string) || 'N/A'} | Type: ${(i.item_type as string) || 'N/A'}`,
            snippet: `Product Type: ${i.product_type as string}`,
            amount: i.rate as number,
            date: i.last_modified_time as string,
            matchScore: score
          });
        }
      }
    } catch (e) {
      console.warn('Search Error in Items:', e);
    }

    // --- 4. ZOHO ACTIVITIES ---
    try {
      const actDescLikes = tokenOrLike('lower(description)');
      // Priority 1: exact phrase or AND match on key fields
      const exactActivities = db.prepare(`
        SELECT DISTINCT activity_id FROM zoho_activity_logs
        WHERE lower(entity_number) LIKE ?
           OR lower(reference_number) LIKE ?
        LIMIT 20
      `).all(qLike, qLike) as { activity_id: string }[];

      // Priority 2: token-OR broader match
      const broadActivities = db.prepare(`
        SELECT DISTINCT activity_id FROM zoho_activity_logs
        WHERE lower(detail_party_name) LIKE ?
           OR ${actDescLikes.sql}
           OR lower(raw_payload_json) LIKE ?
        LIMIT 30
      `).all(qLike, ...actDescLikes.params, qLike) as { activity_id: string }[];

      const allActivityIds = [
        ...new Set([
          ...exactActivities.map(r => r.activity_id),
          ...broadActivities.map(r => r.activity_id),
        ])
      ].slice(0, 40);

      // Fetch full rows for matched IDs
      const activities: Record<string, unknown>[] = [];
      for (const id of allActivityIds) {
        const row = db.prepare(`
          SELECT activity_id, date, module, action, description, entity_number, reference_number, detail_party_name, raw_payload_json
          FROM zoho_activity_logs WHERE activity_id = ?
        `).get(id) as Record<string, unknown> | undefined;
        if (row) activities.push(row);
      }

      for (const a of activities) {
        let score = Math.max(
          computeScore(a.entity_number as string, true),
          computeScore(a.reference_number as string, true),
          computeScore(a.detail_party_name as string),
          computeScore(a.description as string)
        );
        if (score === 0 && a.raw_payload_json && (a.raw_payload_json as string).toLowerCase().includes(qLower)) {
          score = 25;
        }
        if (score > 0) {
          results.push({
            id: a.activity_id as string,
            sourceType: 'ACTIVITY',
            title: `${a.module as string} - ${a.action as string}`,
            subtitle: (a.detail_party_name as string) || (a.entity_number as string) || (a.reference_number as string) || 'Activity Log',
            snippet: descSnippet((a.description as string) || ''),
            date: a.date as string,
            matchScore: score
          });
        }
      }
    } catch (e) {
      console.warn('Search Error in Activities:', e);
    }

    // --- 5. COMPOSITE ASSEMBLIES ---
    try {
      const remarksLikes = tokenOrLike('lower(remarks)');
      const itemNameLikes = tokenOrLike('lower(composite_item_name)');
      const assemblies = db.prepare(`
        SELECT assembly_id, assembly_number, assembly_date, customer_name, composite_item_name, remarks
        FROM composite_assemblies
        WHERE lower(assembly_number) LIKE ?
           OR lower(customer_name) LIKE ?
           OR ${itemNameLikes.sql}
           OR ${remarksLikes.sql}
        LIMIT 20
      `).all(qLike, qLike, ...itemNameLikes.params, ...remarksLikes.params) as Record<string, unknown>[];

      for (const a of assemblies) {
        const score = Math.max(
          computeScore(a.assembly_number as string, true),
          computeScore(a.customer_name as string),
          computeScore(a.composite_item_name as string),
          computeScore(a.remarks as string)
        );
        if (score > 0) {
          results.push({
            id: a.assembly_id as string,
            sourceType: 'COMPOSITE',
            title: `Assembly ${a.assembly_number as string}`,
            subtitle: a.customer_name as string,
            snippet: (a.composite_item_name as string) || '',
            date: a.assembly_date as string,
            matchScore: score
          });
        }
      }
    } catch (e) {
      console.warn('Search Error in Assemblies:', e);
    }

    // --- 6. AUDIT SALES ORDERS ---
    try {
      const orders = auditDb.prepare(`
        SELECT salesorder_id, salesorder_number, date, customer_name, reference_number, total
        FROM audit_sales_orders
        WHERE lower(salesorder_number) LIKE ?
           OR lower(customer_name) LIKE ?
           OR lower(reference_number) LIKE ?
        LIMIT 20
      `).all(qLike, qLike, qLike) as Record<string, unknown>[];

      for (const o of orders) {
        const score = Math.max(
          computeScore(o.salesorder_number as string, true),
          computeScore(o.customer_name as string),
          computeScore(o.reference_number as string, true)
        );
        if (score > 0) {
          results.push({
            id: o.salesorder_id as string,
            sourceType: 'ORDER',
            title: `SO ${o.salesorder_number as string}`,
            subtitle: o.customer_name as string,
            snippet: `Ref: ${(o.reference_number as string) || 'N/A'}`,
            date: o.date as string,
            amount: o.total as number,
            matchScore: score
          });
        }
      }
    } catch (e) {
      console.warn('Search Error in Sales Orders:', e);
    }

    // Sort by score descending; cap at 60 results to keep UI responsive
    results.sort((a, b) => b.matchScore - a.matchScore);
    return results.slice(0, 60);
  }
}
