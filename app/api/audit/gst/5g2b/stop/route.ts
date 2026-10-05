import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST() {
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
