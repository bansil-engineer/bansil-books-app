// ============================================================
// Bansil Books Analytics — Local Manual Composite Assembly Engine
// Customer-wise Component Purchase -> BUN Conversion
// Pure Local SQLite Implementation · Zero Zoho API Calls · Read-Only Zoho Guard
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./db/database.ts";
import { parseFyToDateRange, getCurrentFinancialYear } from "./date-period-utils.ts";

export type AssemblyStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export interface EligiblePurchaseLine {
  bill_id: string;
  bill_number: string;
  bill_date: string;
  line_item_id: string;
  item_id: string;
  item_name: string;
  sku: string;
  vendor_id: string;
  vendor_name: string;
  raw_purchase_qty: number;
  already_consumed_qty: number;
  available_qty: number;
  purchase_rate: number;
  taxable_amount: number;
  bbt_customer_name: string;
}

export interface AssemblyComponentInput {
  source_bill_id: string;
  source_bill_number?: string;
  source_bill_date?: string;
  source_bill_line_item_id: string;
  component_item_id: string;
  component_item_name: string;
  component_sku?: string;
  vendor_name?: string;
  raw_purchase_qty: number;
  consumed_qty: number;
  purchase_rate: number;
  purchase_amount?: number;
}

export interface AssemblyComponentRecord extends AssemblyComponentInput {
  assembly_component_id: string;
  assembly_id: string;
  customer_id: string;
  created_at: string;
}

export interface CompositeAssemblyRecord {
  assembly_id: string;
  assembly_number: string;
  customer_id: string;
  customer_name: string;
  composite_item_id: string;
  composite_item_name: string;
  composite_sku?: string;
  generated_qty: number;
  unit: string;
  total_material_cost: number;
  cost_per_unit: number;
  assembly_date: string;
  reference_no?: string;
  remarks?: string;
  status: AssemblyStatus;
  created_at: string;
  updated_at: string;
  created_by: string;
  components?: AssemblyComponentRecord[];
}

export interface AssemblyAuditRecord {
  audit_id: string;
  assembly_id: string;
  action: string;
  actor: string;
  details?: string;
  created_at: string;
}

export interface CustomerAssemblyImpact {
  customerId: string;
  consumedComponentMap: Record<
    string,
    {
      total_consumed_qty: number;
      lines: Array<{
        assembly_id: string;
        assembly_number: string;
        consumed_qty: number;
        purchase_rate: number;
        purchase_amount: number;
        bill_number?: string;
        bill_date?: string;
      }>;
    }
  >;
  generatedCompositeMap: Record<
    string,
    {
      total_generated_qty: number;
      total_material_cost: number;
      assemblies: Array<{
        assembly_id: string;
        assembly_number: string;
        generated_qty: number;
        material_cost: number;
        cost_per_unit: number;
        assembly_date: string;
        status: string;
      }>;
    }
  >;
}

/**
 * Generate sequential assembly number e.g. ASM-2627-0001
 */
function generateAssemblyNumber(db: DatabaseSync): string {
  const currentYear = new Date().getFullYear();
  const nextYearShort = String((currentYear + 1) % 100).padStart(2, "0");
  const prefix = `ASM-${String(currentYear).slice(2)}${nextYearShort}-`;

  const row = db
    .prepare("SELECT assembly_number FROM composite_assemblies WHERE assembly_number LIKE ? ORDER BY assembly_number DESC LIMIT 1")
    .get(`${prefix}%`) as { assembly_number?: string } | undefined;

  if (!row || !row.assembly_number) {
    return `${prefix}0001`;
  }

  const lastSeqStr = row.assembly_number.replace(prefix, "");
  const lastSeq = parseInt(lastSeqStr, 10) || 0;
  const nextSeq = String(lastSeq + 1).padStart(4, "0");
  return `${prefix}${nextSeq}`;
}

/**
 * Fetch available/eligible Purchase Bill lines for a specific Customer.
 * Excludes globally excluded items and accounts for already consumed quantities in CONFIRMED assemblies.
 */
export function getEligibleComponentPurchaseLines(
  db: DatabaseSync,
  customerId: string,
  options?: { financialYear?: string; fromDate?: string; toDate?: string; excludeAssemblyId?: string }
): EligiblePurchaseLine[] {
  if (!customerId) return [];

  // 1. Resolve Customer Names for lookup
  const custRow = db
    .prepare("SELECT DISTINCT customer_name FROM sales_invoices WHERE customer_id = ? UNION SELECT DISTINCT bbt_customer_name AS customer_name FROM sales_invoice_line_items WHERE bbt_customer_id = ?")
    .get(customerId, customerId) as { customer_name?: string } | undefined;

  const targetId = customerId;
  const targetName = custRow?.customer_name || customerId;

  // 2. Global Exclusions
  const exclusions = db
    .prepare("SELECT item_id, item_name, customer_id, customer_name FROM reconciliation_exclusions WHERE status = 'ACTIVE'")
    .all() as Array<{ item_id?: string; item_name?: string; customer_id?: string; customer_name?: string }>;

  const excludedItemIds = new Set<string>();
  const excludedItemNames = new Set<string>();
  for (const ex of exclusions) {
    if (ex.item_id) excludedItemIds.add(ex.item_id);
    if (ex.item_name) excludedItemNames.add(ex.item_name.toLowerCase());
  }

  // 3. Date filtering
  let dateClause = "";
  const params: any[] = [];
  if (options?.fromDate && options?.toDate) {
    dateClause = "AND pb.date >= ? AND pb.date <= ?";
    params.push(options.fromDate, options.toDate);
  } else if (options?.financialYear) {
    const range = parseFyToDateRange(options.financialYear);
    if (range.fromDate && range.toDate) {
      dateClause = "AND pb.date >= ? AND pb.date <= ?";
      params.push(range.fromDate, range.toDate);
    }
  }

  // 4. Query all purchase lines for this customer
  const sql = `
    SELECT 
      pb.bill_id,
      pb.bill_number,
      pb.date AS bill_date,
      pb.vendor_id,
      pb.vendor_name,
      pb.status AS bill_status,
      li.line_item_id,
      li.item_id,
      li.item_name,
      li.sku,
      li.quantity AS raw_purchase_qty,
      li.rate AS purchase_rate,
      li.line_total AS taxable_amount,
      li.purchase_line_customer_id,
      li.purchase_line_customer_name,
      li.bbt_customer_name
    FROM purchase_bill_line_items li
    JOIN purchase_bills pb ON li.bill_id = pb.bill_id
    WHERE (
      li.purchase_line_customer_id = ?
      OR li.bbt_customer_id = ?
      OR li.purchase_line_customer_name = ?
      OR li.bbt_customer_name = ?
      OR LOWER(COALESCE(pb.vendor_name, '')) = ?
    )
    ${dateClause}
    ORDER BY pb.date DESC, pb.bill_number DESC
  `;

  const rows = db.prepare(sql).all(targetId, targetId, targetName, targetName, targetName.toLowerCase(), ...params) as any[];

  // 5. Query already consumed quantities from CONFIRMED assemblies
  let consumedQuery = `
    SELECT 
      cac.source_bill_line_item_id,
      SUM(cac.consumed_qty) AS total_consumed
    FROM composite_assembly_components cac
    JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
    WHERE ca.status = 'CONFIRMED'
  `;
  const consumedParams: any[] = [];
  if (options?.excludeAssemblyId) {
    consumedQuery += " AND ca.assembly_id != ?";
    consumedParams.push(options.excludeAssemblyId);
  }
  consumedQuery += " GROUP BY cac.source_bill_line_item_id";

  const consumedRows = db.prepare(consumedQuery).all(...consumedParams) as Array<{ source_bill_line_item_id: string; total_consumed: number }>;
  const consumedMap = new Map<string, number>();
  for (const c of consumedRows) {
    consumedMap.set(c.source_bill_line_item_id, Number(c.total_consumed || 0));
  }

  // 6. Build eligible items
  const eligible: EligiblePurchaseLine[] = [];
  for (const r of rows) {
    // Check exclusion
    if (r.item_id && excludedItemIds.has(r.item_id)) continue;
    if (r.item_name && excludedItemNames.has(r.item_name.toLowerCase())) continue;

    const rawQty = Number(r.raw_purchase_qty || 0);
    const consumed = consumedMap.get(r.line_item_id) || 0;
    const available = Math.max(0, rawQty - consumed);

    eligible.push({
      bill_id: r.bill_id,
      bill_number: r.bill_number || "—",
      bill_date: r.bill_date || "—",
      line_item_id: r.line_item_id,
      item_id: r.item_id || r.line_item_id,
      item_name: r.item_name || "—",
      sku: r.sku || "—",
      vendor_id: r.vendor_id || "—",
      vendor_name: r.vendor_name || "—",
      raw_purchase_qty: rawQty,
      already_consumed_qty: consumed,
      available_qty: available,
      purchase_rate: Number(r.purchase_rate || 0),
      taxable_amount: Number(r.taxable_amount || 0),
      bbt_customer_name: r.purchase_line_customer_name || r.bbt_customer_name || r.purchase_line_customer_id || "—",
    });
  }

  return eligible;
}

/**
 * Creates a new Composite Assembly Draft.
 */
export function createAssemblyDraft(
  db: DatabaseSync,
  payload: {
    customerId: string;
    customerName: string;
    compositeItemId: string;
    compositeItemName: string;
    compositeSku?: string;
    generatedQty: number;
    unit?: string;
    assemblyDate: string;
    referenceNo?: string;
    remarks?: string;
    components: AssemblyComponentInput[];
    createdBy?: string;
  }
): CompositeAssemblyRecord {
  if (!payload.customerId || !payload.customerName) {
    throw new Error("Customer is mandatory for composite assembly.");
  }
  if (!payload.compositeItemId || !payload.compositeItemName) {
    throw new Error("Composite / Finished Item is mandatory.");
  }
  if (!payload.generatedQty || payload.generatedQty <= 0) {
    throw new Error("Generated Composite Quantity must be greater than 0.");
  }
  if (!payload.components || payload.components.length === 0) {
    throw new Error("At least one component purchase allocation is required.");
  }

  const assemblyId = `ASM_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const assemblyNumber = generateAssemblyNumber(db);
  const now = new Date().toISOString();

  // Calculate material cost
  let totalMaterialCost = 0;
  for (const comp of payload.components) {
    if (!comp.consumed_qty || comp.consumed_qty <= 0) {
      throw new Error(`Component ${comp.component_item_name} has invalid consumed quantity.`);
    }
    const amount = comp.consumed_qty * comp.purchase_rate;
    totalMaterialCost += amount;
  }
  const costPerUnit = payload.generatedQty > 0 ? totalMaterialCost / payload.generatedQty : 0;

  // Insert Header
  db.prepare(`
    INSERT INTO composite_assemblies (
      assembly_id,
      assembly_number,
      customer_id,
      customer_name,
      composite_item_id,
      composite_item_name,
      composite_sku,
      generated_qty,
      unit,
      total_material_cost,
      cost_per_unit,
      assembly_date,
      reference_no,
      remarks,
      status,
      created_at,
      updated_at,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
  `).run(
    assemblyId,
    assemblyNumber,
    payload.customerId,
    payload.customerName,
    payload.compositeItemId,
    payload.compositeItemName,
    payload.compositeSku || "",
    payload.generatedQty,
    payload.unit || "BUN",
    totalMaterialCost,
    costPerUnit,
    payload.assemblyDate || now.slice(0, 10),
    payload.referenceNo || "",
    payload.remarks || "",
    now,
    now,
    payload.createdBy || "Local User"
  );

  // Insert Components
  const compStmt = db.prepare(`
    INSERT INTO composite_assembly_components (
      assembly_component_id,
      assembly_id,
      source_bill_id,
      source_bill_number,
      source_bill_date,
      source_bill_line_item_id,
      component_item_id,
      component_item_name,
      component_sku,
      vendor_name,
      raw_purchase_qty,
      consumed_qty,
      purchase_rate,
      purchase_amount,
      customer_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const comp of payload.components) {
    const compId = `AC_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const compAmount = comp.consumed_qty * comp.purchase_rate;
    compStmt.run(
      compId,
      assemblyId,
      comp.source_bill_id,
      comp.source_bill_number || "",
      comp.source_bill_date || "",
      comp.source_bill_line_item_id,
      comp.component_item_id,
      comp.component_item_name,
      comp.component_sku || "",
      comp.vendor_name || "",
      comp.raw_purchase_qty,
      comp.consumed_qty,
      comp.purchase_rate,
      compAmount,
      payload.customerId,
      now
    );
  }

  // Insert Audit Log
  db.prepare(`
    INSERT INTO composite_assembly_audit (audit_id, assembly_id, action, actor, details, created_at)
    VALUES (?, ?, 'CREATE_DRAFT', ?, ?, ?)
  `).run(
    `AUD_${Date.now()}`,
    assemblyId,
    payload.createdBy || "Local User",
    `Created draft assembly for ${payload.generatedQty} ${payload.unit || "BUN"} of ${payload.compositeItemName}`,
    now
  );

  return getAssemblyDetail(db, assemblyId)!;
}

/**
 * Updates an existing Assembly Draft.
 */
export function updateAssemblyDraft(
  db: DatabaseSync,
  assemblyId: string,
  payload: {
    compositeItemId?: string;
    compositeItemName?: string;
    compositeSku?: string;
    generatedQty?: number;
    unit?: string;
    assemblyDate?: string;
    referenceNo?: string;
    remarks?: string;
    components?: AssemblyComponentInput[];
    updatedBy?: string;
  }
): CompositeAssemblyRecord {
  const current = db
    .prepare("SELECT * FROM composite_assemblies WHERE assembly_id = ?")
    .get(assemblyId) as CompositeAssemblyRecord | undefined;

  if (!current) {
    throw new Error(`Assembly ${assemblyId} not found.`);
  }
  if (current.status !== "DRAFT") {
    throw new Error(`Cannot edit an assembly in '${current.status}' status. Only DRAFT assemblies can be modified.`);
  }

  const now = new Date().toISOString();
  const compositeItemId = payload.compositeItemId || current.composite_item_id;
  const compositeItemName = payload.compositeItemName || current.composite_item_name;
  const compositeSku = payload.compositeSku !== undefined ? payload.compositeSku : current.composite_sku;
  const generatedQty = payload.generatedQty !== undefined ? payload.generatedQty : current.generated_qty;
  const unit = payload.unit || current.unit || "BUN";
  const assemblyDate = payload.assemblyDate || current.assembly_date;
  const referenceNo = payload.referenceNo !== undefined ? payload.referenceNo : current.reference_no;
  const remarks = payload.remarks !== undefined ? payload.remarks : current.remarks;

  let totalMaterialCost = current.total_material_cost;
  let costPerUnit = current.cost_per_unit;

  // If components were passed, re-calculate and re-insert
  if (payload.components && payload.components.length > 0) {
    totalMaterialCost = 0;
    for (const comp of payload.components) {
      if (!comp.consumed_qty || comp.consumed_qty <= 0) {
        throw new Error(`Component ${comp.component_item_name} has invalid consumed quantity.`);
      }
      totalMaterialCost += comp.consumed_qty * comp.purchase_rate;
    }
    costPerUnit = generatedQty > 0 ? totalMaterialCost / generatedQty : 0;

    // Delete old components
    db.prepare("DELETE FROM composite_assembly_components WHERE assembly_id = ?").run(assemblyId);

    // Insert new components
    const compStmt = db.prepare(`
      INSERT INTO composite_assembly_components (
        assembly_component_id,
        assembly_id,
        source_bill_id,
        source_bill_number,
        source_bill_date,
        source_bill_line_item_id,
        component_item_id,
        component_item_name,
        component_sku,
        vendor_name,
        raw_purchase_qty,
        consumed_qty,
        purchase_rate,
        purchase_amount,
        customer_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const comp of payload.components) {
      const compId = `AC_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const compAmount = comp.consumed_qty * comp.purchase_rate;
      compStmt.run(
        compId,
        assemblyId,
        comp.source_bill_id,
        comp.source_bill_number || "",
        comp.source_bill_date || "",
        comp.source_bill_line_item_id,
        comp.component_item_id,
        comp.component_item_name,
        comp.component_sku || "",
        comp.vendor_name || "",
        comp.raw_purchase_qty,
        comp.consumed_qty,
        comp.purchase_rate,
        compAmount,
        current.customer_id,
        now
      );
    }
  }

  // Update header
  db.prepare(`
    UPDATE composite_assemblies
    SET
      composite_item_id = ?,
      composite_item_name = ?,
      composite_sku = ?,
      generated_qty = ?,
      unit = ?,
      total_material_cost = ?,
      cost_per_unit = ?,
      assembly_date = ?,
      reference_no = ?,
      remarks = ?,
      updated_at = ?
    WHERE assembly_id = ?
  `).run(
    compositeItemId,
    compositeItemName,
    compositeSku || "",
    generatedQty,
    unit,
    totalMaterialCost,
    costPerUnit,
    assemblyDate,
    referenceNo || "",
    remarks || "",
    now,
    assemblyId
  );

  // Audit
  db.prepare(`
    INSERT INTO composite_assembly_audit (audit_id, assembly_id, action, actor, details, created_at)
    VALUES (?, ?, 'EDIT_DRAFT', ?, ?, ?)
  `).run(
    `AUD_${Date.now()}`,
    assemblyId,
    payload.updatedBy || "Local User",
    `Updated draft assembly ${current.assembly_number}`,
    now
  );

  return getAssemblyDetail(db, assemblyId)!;
}

/**
 * Confirms an Assembly.
 * CRITICAL VALIDATION (Section 9): Checks that consumed quantity does not exceed available purchase quantity.
 */
export function confirmAssembly(
  db: DatabaseSync,
  assemblyId: string,
  confirmedBy?: string
): CompositeAssemblyRecord {
  const current = getAssemblyDetail(db, assemblyId);
  if (!current) {
    throw new Error(`Assembly ${assemblyId} not found.`);
  }
  if (current.status === "CONFIRMED") {
    return current; // Already confirmed
  }
  if (current.status === "CANCELLED") {
    throw new Error("Cannot confirm a cancelled assembly. Please create a new assembly.");
  }

  const components = current.components || [];
  if (components.length === 0) {
    throw new Error("Cannot confirm assembly without components.");
  }

  // Check available quantities for each component line
  for (const comp of components) {
    // Query raw quantity from source bill line item
    const lineRow = db
      .prepare("SELECT quantity FROM purchase_bill_line_items WHERE line_item_id = ?")
      .get(comp.source_bill_line_item_id) as { quantity?: number } | undefined;

    const rawQty = lineRow?.quantity !== undefined ? Number(lineRow.quantity) : comp.raw_purchase_qty;

    // Query other confirmed consumptions on this line
    const otherConsumedRow = db
      .prepare(`
        SELECT SUM(cac.consumed_qty) AS other_consumed
        FROM composite_assembly_components cac
        JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
        WHERE cac.source_bill_line_item_id = ?
          AND ca.status = 'CONFIRMED'
          AND ca.assembly_id != ?
      `)
      .get(comp.source_bill_line_item_id, assemblyId) as { other_consumed?: number } | undefined;

    const otherConsumed = Number(otherConsumedRow?.other_consumed || 0);
    const availableQty = Math.max(0, rawQty - otherConsumed);

    if (comp.consumed_qty > availableQty + 0.0001) {
      throw new Error(
        `Over-consumption rejected for ${comp.component_item_name} on Bill line ${comp.source_bill_number || comp.source_bill_line_item_id}. Available: ${availableQty}, Requested: ${comp.consumed_qty}`
      );
    }
  }

  const now = new Date().toISOString();

  // Set status to CONFIRMED
  db.prepare("UPDATE composite_assemblies SET status = 'CONFIRMED', updated_at = ? WHERE assembly_id = ?").run(
    now,
    assemblyId
  );

  // Audit
  db.prepare(`
    INSERT INTO composite_assembly_audit (audit_id, assembly_id, action, actor, details, created_at)
    VALUES (?, ?, 'CONFIRM', ?, ?, ?)
  `).run(
    `AUD_${Date.now()}`,
    assemblyId,
    confirmedBy || "Local User",
    `Confirmed assembly ${current.assembly_number} (${current.generated_qty} ${current.unit} of ${current.composite_item_name})`,
    now
  );

  return getAssemblyDetail(db, assemblyId)!;
}

/**
 * Cancels / Reverses an Assembly.
 * Restores component available quantities and removes generated composite quantity from active reconciliation.
 */
export function cancelOrReverseAssembly(
  db: DatabaseSync,
  assemblyId: string,
  reason?: string,
  cancelledBy?: string
): CompositeAssemblyRecord {
  const current = getAssemblyDetail(db, assemblyId);
  if (!current) {
    throw new Error(`Assembly ${assemblyId} not found.`);
  }

  const now = new Date().toISOString();

  db.prepare("UPDATE composite_assemblies SET status = 'CANCELLED', updated_at = ? WHERE assembly_id = ?").run(
    now,
    assemblyId
  );

  // Audit
  db.prepare(`
    INSERT INTO composite_assembly_audit (audit_id, assembly_id, action, actor, details, created_at)
    VALUES (?, ?, 'REVERSE', ?, ?, ?)
  `).run(
    `AUD_${Date.now()}`,
    assemblyId,
    cancelledBy || "Local User",
    `Reversed/Cancelled assembly ${current.assembly_number}. Reason: ${reason || "User initiated reversal"}`,
    now
  );

  return getAssemblyDetail(db, assemblyId)!;
}

/**
 * Fetch full assembly detail with component lines and audit history.
 */
export function getAssemblyDetail(db: DatabaseSync, assemblyId: string): CompositeAssemblyRecord | null {
  const row = db
    .prepare("SELECT * FROM composite_assemblies WHERE assembly_id = ?")
    .get(assemblyId) as CompositeAssemblyRecord | undefined;

  if (!row) return null;

  const components = (db
    .prepare("SELECT * FROM composite_assembly_components WHERE assembly_id = ? ORDER BY component_item_name ASC")
    .all(assemblyId) as unknown) as AssemblyComponentRecord[];

  return {
    ...row,
    components,
  };
}

/**
 * Fetch assembly audit trail.
 */
export function getAssemblyAuditLogs(db: DatabaseSync, assemblyId: string): AssemblyAuditRecord[] {
  return (db
    .prepare("SELECT * FROM composite_assembly_audit WHERE assembly_id = ? ORDER BY created_at DESC")
    .all(assemblyId) as unknown) as AssemblyAuditRecord[];
}

/**
 * Fetch assembly list with filters.
 */
export function getAssemblyList(
  db: DatabaseSync,
  filter?: {
    customerId?: string;
    compositeItemId?: string;
    status?: string;
    search?: string;
    financialYear?: string;
    fromDate?: string;
    toDate?: string;
  }
): {
  assemblies: CompositeAssemblyRecord[];
  summary: {
    totalAssemblies: number;
    confirmedAssemblies: number;
    draftAssemblies: number;
    cancelledAssemblies: number;
    totalGeneratedUnits: number;
    totalMaterialCost: number;
  };
} {
  let whereClauses = "WHERE 1=1";
  const params: any[] = [];

  if (filter?.customerId) {
    whereClauses += " AND (LOWER(customer_id) = ? OR LOWER(customer_name) = ?)";
    params.push(filter.customerId.toLowerCase(), filter.customerId.toLowerCase());
  }

  if (filter?.compositeItemId) {
    whereClauses += " AND (LOWER(composite_item_id) = ? OR LOWER(composite_item_name) = ?)";
    params.push(filter.compositeItemId.toLowerCase(), filter.compositeItemId.toLowerCase());
  }

  if (filter?.status && filter.status !== "ALL") {
    whereClauses += " AND status = ?";
    params.push(filter.status);
  }

  if (filter?.search) {
    const term = `%${filter.search.toLowerCase()}%`;
    whereClauses += " AND (LOWER(assembly_number) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(composite_item_name) LIKE ? OR LOWER(reference_no) LIKE ?)";
    params.push(term, term, term, term);
  }

  if (filter?.fromDate && filter?.toDate) {
    whereClauses += " AND assembly_date >= ? AND assembly_date <= ?";
    params.push(filter.fromDate, filter.toDate);
  } else if (filter?.financialYear) {
    const range = parseFyToDateRange(filter.financialYear);
    if (range.fromDate && range.toDate) {
      whereClauses += " AND assembly_date >= ? AND assembly_date <= ?";
      params.push(range.fromDate, range.toDate);
    }
  }

  const sql = `SELECT * FROM composite_assemblies ${whereClauses} ORDER BY assembly_date DESC, created_at DESC`;
  const rows = (db.prepare(sql).all(...params) as unknown) as CompositeAssemblyRecord[];

  // Also query components for each assembly
  const assemblies: CompositeAssemblyRecord[] = [];
  let confirmedCount = 0;
  let draftCount = 0;
  let cancelledCount = 0;
  let totalGeneratedUnits = 0;
  let totalMaterialCost = 0;

  for (const r of rows) {
    const components = (db
      .prepare("SELECT * FROM composite_assembly_components WHERE assembly_id = ? ORDER BY component_item_name ASC")
      .all(r.assembly_id) as unknown) as AssemblyComponentRecord[];

    assemblies.push({
      ...r,
      components,
    });

    if (r.status === "CONFIRMED") {
      confirmedCount++;
      totalGeneratedUnits += Number(r.generated_qty || 0);
      totalMaterialCost += Number(r.total_material_cost || 0);
    } else if (r.status === "DRAFT") {
      draftCount++;
    } else if (r.status === "CANCELLED") {
      cancelledCount++;
    }
  }

  return {
    assemblies,
    summary: {
      totalAssemblies: assemblies.length,
      confirmedAssemblies: confirmedCount,
      draftAssemblies: draftCount,
      cancelledAssemblies: cancelledCount,
      totalGeneratedUnits,
      totalMaterialCost,
    },
  };
}

/**
 * Returns the active confirmed assembly impact for a customer or all customers.
 * Used by reconciliation engines to adjust:
 * - Component purchases: raw_qty - consumed_qty
 * - Composite purchases: raw_qty + generated_qty
 */
export function getConfirmedAssemblyImpact(
  db: DatabaseSync,
  options?: { customerId?: string; financialYear?: string; fromDate?: string; toDate?: string }
): Map<string, CustomerAssemblyImpact> {
  const impactMap = new Map<string, CustomerAssemblyImpact>();

  // Filter confirmed assemblies by date if specified
  let dateClause = "";
  const params: any[] = [];
  if (options?.fromDate && options?.toDate) {
    dateClause = "AND ca.assembly_date >= ? AND ca.assembly_date <= ?";
    params.push(options.fromDate, options.toDate);
  } else if (options?.financialYear) {
    const range = parseFyToDateRange(options.financialYear);
    if (range.fromDate && range.toDate) {
      dateClause = "AND ca.assembly_date >= ? AND ca.assembly_date <= ?";
      params.push(range.fromDate, range.toDate);
    }
  }

  let custClause = "";
  if (options?.customerId) {
    custClause = "AND (LOWER(ca.customer_id) = ? OR LOWER(ca.customer_name) = ?)";
    params.push(options.customerId.toLowerCase(), options.customerId.toLowerCase());
  }

  // 1. Fetch all confirmed assembly headers
  const headerSql = `
    SELECT 
      ca.assembly_id,
      ca.assembly_number,
      ca.customer_id,
      ca.customer_name,
      ca.composite_item_id,
      ca.composite_item_name,
      ca.generated_qty,
      ca.total_material_cost,
      ca.cost_per_unit,
      ca.assembly_date,
      ca.status
    FROM composite_assemblies ca
    WHERE ca.status = 'CONFIRMED'
    ${dateClause}
    ${custClause}
  `;

  const headers = db.prepare(headerSql).all(...params) as any[];

  for (const h of headers) {
    const custKey = (h.customer_id || h.customer_name || "").toLowerCase().trim();
    if (!custKey) continue;

    if (!impactMap.has(custKey)) {
      impactMap.set(custKey, {
        customerId: h.customer_id,
        consumedComponentMap: {},
        generatedCompositeMap: {},
      });
    }

    const impact = impactMap.get(custKey)!;

    // Register composite item generation
    const compItemKey = (h.composite_item_id || h.composite_item_name || "").toLowerCase().trim();
    if (!impact.generatedCompositeMap[compItemKey]) {
      impact.generatedCompositeMap[compItemKey] = {
        total_generated_qty: 0,
        total_material_cost: 0,
        assemblies: [],
      };
    }

    impact.generatedCompositeMap[compItemKey].total_generated_qty += Number(h.generated_qty || 0);
    impact.generatedCompositeMap[compItemKey].total_material_cost += Number(h.total_material_cost || 0);
    impact.generatedCompositeMap[compItemKey].assemblies.push({
      assembly_id: h.assembly_id,
      assembly_number: h.assembly_number,
      generated_qty: Number(h.generated_qty || 0),
      material_cost: Number(h.total_material_cost || 0),
      cost_per_unit: Number(h.cost_per_unit || 0),
      assembly_date: h.assembly_date,
      status: h.status,
    });

    // Also register under item name if different
    if (h.composite_item_name && h.composite_item_name.toLowerCase().trim() !== compItemKey) {
      const nameKey = h.composite_item_name.toLowerCase().trim();
      impact.generatedCompositeMap[nameKey] = impact.generatedCompositeMap[compItemKey];
    }
  }

  // 2. Fetch all confirmed components
  const compSql = `
    SELECT 
      cac.assembly_id,
      cac.component_item_id,
      cac.component_item_name,
      cac.consumed_qty,
      cac.purchase_rate,
      cac.purchase_amount,
      cac.source_bill_number,
      cac.source_bill_date,
      ca.customer_id,
      ca.customer_name,
      ca.assembly_number
    FROM composite_assembly_components cac
    JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
    WHERE ca.status = 'CONFIRMED'
    ${dateClause}
    ${custClause}
  `;

  const components = db.prepare(compSql).all(...params) as any[];

  for (const c of components) {
    const custKey = (c.customer_id || c.customer_name || "").toLowerCase().trim();
    if (!custKey) continue;

    if (!impactMap.has(custKey)) {
      impactMap.set(custKey, {
        customerId: c.customer_id,
        consumedComponentMap: {},
        generatedCompositeMap: {},
      });
    }

    const impact = impactMap.get(custKey)!;
    const compItemKey = (c.component_item_id || c.component_item_name || "").toLowerCase().trim();

    if (!impact.consumedComponentMap[compItemKey]) {
      impact.consumedComponentMap[compItemKey] = {
        total_consumed_qty: 0,
        lines: [],
      };
    }

    impact.consumedComponentMap[compItemKey].total_consumed_qty += Number(c.consumed_qty || 0);
    impact.consumedComponentMap[compItemKey].lines.push({
      assembly_id: c.assembly_id,
      assembly_number: c.assembly_number,
      consumed_qty: Number(c.consumed_qty || 0),
      purchase_rate: Number(c.purchase_rate || 0),
      purchase_amount: Number(c.purchase_amount || 0),
      bill_number: c.source_bill_number,
      bill_date: c.source_bill_date,
    });

    // Also register under item name if different
    if (c.component_item_name && c.component_item_name.toLowerCase().trim() !== compItemKey) {
      const nameKey = c.component_item_name.toLowerCase().trim();
      impact.consumedComponentMap[nameKey] = impact.consumedComponentMap[compItemKey];
    }
  }

  return impactMap;
}

/**
 * Validates local composite assemblies against current purchase bills.
 * If a purchase bill line is deleted or modified in Zoho (and thus removed locally during sync),
 * this function cancels the affected local assembly and logs the audit trail.
 */
export function validateCompositeAssemblies(db: DatabaseSync): number {
  let cancelledCount = 0;
  
  // Find components whose source_bill_line_item_id no longer exists
  const orphanedComponents = db.prepare(`
    SELECT DISTINCT cac.assembly_id, cac.source_bill_number
    FROM composite_assembly_components cac
    JOIN composite_assemblies ca ON cac.assembly_id = ca.assembly_id
    LEFT JOIN purchase_bill_line_items pli ON cac.source_bill_line_item_id = pli.line_item_id
    WHERE ca.status != 'CANCELLED' AND pli.line_item_id IS NULL
  `).all() as { assembly_id: string; source_bill_number: string }[];

  if (orphanedComponents.length === 0) {
    return 0;
  }

  const updateStmt = db.prepare(`
    UPDATE composite_assemblies 
    SET status = 'CANCELLED', 
        remarks = COALESCE(remarks, '') || ' [CANCELLED: Source Bill ' || ? || ' was deleted/modified by sync]',
        updated_at = ?
    WHERE assembly_id = ?
  `);
  
  const auditStmt = db.prepare(`
    INSERT INTO composite_assembly_audit (audit_id, assembly_id, action, actor, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  // Run updates in transaction
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const orphan of orphanedComponents) {
      updateStmt.run(orphan.source_bill_number || 'UNKNOWN', now, orphan.assembly_id);
      
      const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      auditStmt.run(
        auditId, 
        orphan.assembly_id, 
        'CANCEL', 
        'System Sync Validator', 
        `Assembly cancelled due to missing source purchase bill line (Bill ${orphan.source_bill_number}) during sync.`,
        now
      );
      cancelledCount++;
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
  
  return cancelledCount;
}

