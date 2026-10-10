import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { getConversation } from "@/app/lib/ai/conversation-bin";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

// Read-only metadata for one conversation (lets the UI tell the truth about a binned URL).
// No DELETE handler exists: permanent deletion is intentionally not implemented.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(_req, policyFor("ai/conversations/[id]", "GET"), "ai/conversations/[id] GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const id = (await params).id;
    const conv = getConversation(getAiDatabase(), id);
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(conv);
  } catch (err: any) {
    console.error("Error fetching conversation:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
