import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { listConversations, countConversations } from "@/app/lib/ai/conversation-bin";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

// GET /api/ai/conversations            -> ACTIVE only (default)
// GET /api/ai/conversations?state=binned -> BINNED only
// Filtering is done in SQL, never on the client.
export async function GET(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/conversations", "GET"), "ai/conversations GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const state = new URL(req.url).searchParams.get("state") || "active";
    if (state !== "active" && state !== "binned") {
      return NextResponse.json({ error: "Invalid state." }, { status: 400 });
    }
    const db = getAiDatabase();
    const rows = listConversations(db, state === "binned" ? "BINNED" : "ACTIVE");
    const counts = countConversations(db);
    const res = NextResponse.json(rows);
    res.headers.set("X-Conversation-Count-Active", String(counts.active));
    res.headers.set("X-Conversation-Count-Binned", String(counts.binned));
    return res;
  } catch (err: any) {
    console.error("Error fetching conversations:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
