import { NextResponse } from "next/server";
import { getAiDatabase } from "@/app/lib/db/ai-database";
import { getDeleteImpact } from "@/app/lib/ai/conversation-bin";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

// Read-only impact preview shown BEFORE any permanent deletion. Mutates nothing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(_req, policyFor("ai/conversations/[id]/impact", "GET"), "ai/conversations/[id]/impact GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const id = (await params).id;
    const impact = getDeleteImpact(getAiDatabase(), id);
    if (!impact) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(impact);
  } catch (err: any) {
    console.error("Error computing delete impact:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
