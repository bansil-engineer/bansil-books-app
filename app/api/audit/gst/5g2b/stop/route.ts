import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export async function POST(request: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/gst/5g2b/stop", "POST"), "audit/gst/5g2b/stop POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  const cacheDir = path.resolve('output', 'gst_source_cache', '5G2B');
  const progressPath = path.join(cacheDir, 'batch_progress.json');

  if (!fs.existsSync(progressPath)) {
    return NextResponse.json({ error: 'Batch not initialized' }, { status: 404 });
  }

  const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
  
  if (progress.status === 'RUNNING') {
    progress.status = 'STOPPED';
    progress.last_updated_at = new Date().toISOString();
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  }

  return NextResponse.json({ status: progress.status });
}
