import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import {
  computePlan,
  moveAllToBin,
  restoreAll,
  bulkDeleteBinnedPermanently,
} from "@/app/lib/ai/conversation-bulk";

// GET  ?scope=active|binned  -> read-only impact preview (counts + fingerprint). Mutates nothing.
// POST { action: "MOVE_ALL_TO_BIN" | "RESTORE_ALL" | "DELETE_ALL_PERMANENTLY", ... }
//   DELETE_ALL_PERMANENTLY needs { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint }.
// There is no HTTP DELETE handler.

export async function GET(req: Request) {
  try {
    const scope = new URL(req.url).searchParams.get("scope");
    if (scope !== "active" && scope !== "binned") {
      return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
    }
    const plan = computePlan(getAiDatabase(), scope === "binned" ? "BINNED" : "ACTIVE");
    return NextResponse.json({
      scope: plan.scope,
      counts: plan.counts,
      otherScopedRows: plan.otherScopedRows,
      fingerprint: plan.fingerprint,
    });
  } catch (err: any) {
    console.error("Bulk impact error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let body: any = null;
    try { body = await req.json(); } catch {}
    const db = getAiDatabase();

    if (body?.action === "MOVE_ALL_TO_BIN") {
      const r = moveAllToBin(db);
      return r.ok ? NextResponse.json({ changed: r.changed }) : NextResponse.json({ error: r.message, code: r.code }, { status: 500 });
    }
    if (body?.action === "RESTORE_ALL") {
      const r = restoreAll(db);
      return r.ok ? NextResponse.json({ changed: r.changed }) : NextResponse.json({ error: r.message, code: r.code }, { status: 500 });
    }
    if (body?.action === "DELETE_ALL_PERMANENTLY") {
      const r = bulkDeleteBinnedPermanently(db, body);
      if (r.ok) {
        return NextResponse.json({
          deleted: true,
          counts: r.deleted,
          backup: r.backup, // file names + hash only; no filesystem path
        });
      }
      const status =
        r.code === "CONFIRMATION_REQUIRED" || r.code === "WRONG_PHRASE" ? 400
        : r.code === "BACKUP_FAILED" || r.code === "FAILED" ? 500
        : 409;
      return NextResponse.json({ error: r.message, code: r.code }, { status });
    }
    return NextResponse.json({ error: "Unsupported action.", code: "INVALID_ACTION" }, { status: 400 });
  } catch (err: any) {
    console.error("Bulk action error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
