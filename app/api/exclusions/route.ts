import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/app/lib/db/database";
import { randomUUID } from "crypto";
import { requireFeaturesEnabled } from "@/app/lib/feature-guard";

// GET /api/exclusions?financialYear=2025-26&status=ACTIVE
export async function GET(req: NextRequest) {
  const disabled = requireFeaturesEnabled("module_exclusion_management");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const { searchParams } = new URL(req.url);
    const financialYear = searchParams.get("financialYear");
    const status = searchParams.get("status") ?? "ACTIVE";
    const customerId = searchParams.get("customerId");
    const itemId = searchParams.get("itemId");

    let query = `SELECT * FROM reconciliation_exclusions WHERE 1=1`;
    const params: (string | number)[] = [];

    if (status && status !== "ALL") {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (financialYear) {
      query += ` AND (financial_year = ? OR financial_year IS NULL)`;
      params.push(financialYear);
    }
    if (customerId) {
      query += ` AND customer_id = ?`;
      params.push(customerId);
    }
    if (itemId) {
      query += ` AND item_id = ?`;
      params.push(itemId);
    }
    query += ` ORDER BY created_at DESC`;

    const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
    return NextResponse.json({ exclusions: rows, count: rows.length });
  } catch (err: unknown) {
    console.error("GET /api/exclusions error:", err);
    return NextResponse.json({ error: "Failed to load exclusions" }, { status: 500 });
  }
}

// POST /api/exclusions — create a new exclusion rule
export async function POST(req: NextRequest) {
  const disabled = requireFeaturesEnabled("module_exclusion_management");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const body = await req.json();
    const {
      customerId,
      customerName,
      itemId,
      itemName,
      sku,
      financialYear,
      reason,
      notes,
      approvedBy,
      stockStatus,
      stockQty,
    } = body;

    if (
      (stockStatus === "ZERO_STOCK" || body.status === "ZERO_STOCK") &&
      (stockQty === 0 || stockQty === "0" || stockQty === undefined)
    ) {
      return NextResponse.json(
        { error: "Zero Stock items do not require exclusion" },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const exclusionId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO reconciliation_exclusions
      (exclusion_id, customer_id, customer_name, item_id, item_name, sku,
       financial_year, reason, notes, status, created_by, created_at, approved_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'user', ?, ?)
    `).run(
      exclusionId,
      customerId ?? null,
      customerName ?? null,
      itemId ?? null,
      itemName ?? null,
      sku ?? null,
      financialYear ?? null,
      reason,
      notes ?? null,
      now,
      approvedBy ?? null
    );

    return NextResponse.json({ success: true, exclusionId, createdAt: now });
  } catch (err: unknown) {
    console.error("POST /api/exclusions error:", err);
    return NextResponse.json({ error: "Failed to create exclusion" }, { status: 500 });
  }
}

// PATCH /api/exclusions — deactivate / reactivate a rule
export async function PATCH(req: NextRequest) {
  const disabled = requireFeaturesEnabled("module_exclusion_management");
  if (disabled) return disabled;
  try {
    const db = getDatabase();
    const body = await req.json();
    const { exclusionId, action } = body; // action: 'DEACTIVATE' | 'REACTIVATE'

    if (!exclusionId || !action) {
      return NextResponse.json({ error: "exclusionId and action are required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    if (action === "DEACTIVATE") {
      db.prepare(`
        UPDATE reconciliation_exclusions
        SET status = 'INACTIVE', deactivated_at = ?
        WHERE exclusion_id = ?
      `).run(now, exclusionId);
    } else if (action === "REACTIVATE") {
      db.prepare(`
        UPDATE reconciliation_exclusions
        SET status = 'ACTIVE', deactivated_at = NULL
        WHERE exclusion_id = ?
      `).run(exclusionId);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ success: true, exclusionId, action });
  } catch (err: unknown) {
    console.error("PATCH /api/exclusions error:", err);
    return NextResponse.json({ error: "Failed to update exclusion" }, { status: 500 });
  }
}
