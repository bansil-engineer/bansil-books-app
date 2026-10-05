import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export async function POST() {
  const cacheDir = path.resolve('output', 'gst_source_cache', '5G2B');
  const progressPath = path.join(cacheDir, 'batch_progress.json');

  if (!fs.existsSync(progressPath)) {
    return NextResponse.json({ error: 'Batch not initialized' }, { status: 404 });
  }

  const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));

  if (progress.status === 'RUNNING') {
    return NextResponse.json({ error: 'BATCH ALREADY RUNNING' }, { status: 400 });
  }

  if (progress.attempted_gets >= progress.owner_authorized_get_limit) {
    return NextResponse.json({ error: 'Hard limit reached' }, { status: 400 });
  }

  // Update status to RUNNING
  progress.status = 'RUNNING';
  progress.last_updated_at = new Date().toISOString();
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));

  // Spawn the background fetch process
  // We use tsx to run the script
  const scriptPath = path.resolve('scratch', '5g2b_fetch.ts');
  const outLog = path.resolve('scratch', '5g2b_fetch.log');
  
  const out = fs.openSync(outLog, 'a');
  const err = fs.openSync(outLog, 'a');

  const child = spawn('npx', ['tsx', '--env-file=.env.local', scriptPath], {
    detached: true,
    stdio: ['ignore', out, err]
  });

  child.unref(); // Allow the API to return immediately

  return NextResponse.json({ status: 'STARTED' });
}
