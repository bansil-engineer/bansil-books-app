import {tenderHubEnabled} from '../../../tender-hub/feature-access';
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";
export const dynamic='force-dynamic';
export async function GET(request: Request){
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("tender-hub/access", "GET"), "tender-hub/access GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const enabled=tenderHubEnabled();return Response.json({enabled},{status:enabled?200:403,headers:{'Cache-Control':'no-store'}});}
