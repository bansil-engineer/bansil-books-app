import { NextRequest, NextResponse } from "next/server";
import { getMemory } from "@/app/lib/ai/ceo/memory-store";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("ai/memory/[id]", "GET"), "ai/memory/[id] GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const { id } = await params;
    const memory = getMemory(id);
    if (!memory) {
      return NextResponse.json({ error: "Memory entry not found." }, { status: 404 });
    }
    return NextResponse.json(memory);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
