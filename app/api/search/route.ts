import { NextRequest, NextResponse } from 'next/server';
import { UniversalSearchService } from '../../lib/search/universal-search-service.ts';
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function GET(req: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("search", "GET"), "search GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q || q.trim() === '') {
    return NextResponse.json({ results: [] });
  }

  const service = new UniversalSearchService();
  const results = service.searchUniversal(q);

  return NextResponse.json({ results });
}
