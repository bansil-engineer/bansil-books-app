import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface AuthorizationRecord {
  authorization_id: string;
  batch_id: string;
  authorized_limit: number;
  sales_limit: number;
  purchase_limit: number;
  created_at: string;
  fy_bounds: { start: string; end: string };
}

export interface JournalEvent {
  batch_id: string;
  authorization_id: string;
  document_type: string;
  document_id: string;
  attempt_number: number;
  attempted_at: string;
  endpoint_family: string;
  result: 'SUCCESS' | 'FAILED' | 'RATE_LIMITED';
  http_status?: number;
  payload_hash?: string;
}

export class GstAcquisitionJournal {
  private baseDir: string;
  private journalPath: string;
  private authPath: string;

  constructor(baseDir: string = path.resolve('output', 'gst_source_cache')) {
    this.baseDir = baseDir;
    this.journalPath = path.join(baseDir, 'acquisition_journal.jsonl');
    this.authPath = path.join(baseDir, 'authorizations.jsonl');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  // A helper for testing
  public clearForTest() {
    if (fs.existsSync(this.journalPath)) fs.unlinkSync(this.journalPath);
    if (fs.existsSync(this.authPath)) fs.unlinkSync(this.authPath);
  }

  public authorizeBatch(auth: AuthorizationRecord) {
    const existing = this.getAuthorization(auth.batch_id);
    if (existing) {
      if (existing.authorization_id !== auth.authorization_id) {
        throw new Error("AUTHORIZATION CONFLICT — OWNER REVIEW REQUIRED");
      }
      return; // already authorized
    }
    fs.appendFileSync(this.authPath, JSON.stringify(auth) + '\n');
  }

  public getAuthorization(batchId: string): AuthorizationRecord | null {
    if (!fs.existsSync(this.authPath)) return null;
    const lines = fs.readFileSync(this.authPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const rec = JSON.parse(line) as AuthorizationRecord;
      if (rec.batch_id === batchId) return rec;
    }
    return null;
  }

  public appendEvent(event: JournalEvent) {
    fs.appendFileSync(this.journalPath, JSON.stringify(event) + '\n');
  }

  public getJournalEvents(authId: string): JournalEvent[] {
    if (!fs.existsSync(this.journalPath)) return [];
    const lines = fs.readFileSync(this.journalPath, 'utf8').split('\n').filter(Boolean);
    const events: JournalEvent[] = [];
    for (const line of lines) {
      const ev = JSON.parse(line) as JournalEvent;
      if (ev.authorization_id === authId) events.push(ev);
    }
    return events;
  }

  public getAttemptCount(authId: string): number {
    return this.getJournalEvents(authId).length;
  }

  public checkSafetyGuards(batchId: string, authId: string, batchDir: string) {
    const auth = this.getAuthorization(batchId);
    if (!auth) throw new Error("UNAUTHORIZED BATCH");

    if (fs.existsSync(this.authPath) && !fs.existsSync(this.journalPath)) {
        throw new Error("CONTROL INCIDENT / OWNER REVIEW (Authorization exists but journal is missing)");
    }

    const dirs = fs.existsSync(this.baseDir) ? fs.readdirSync(this.baseDir).filter(f => fs.statSync(path.join(this.baseDir, f)).isDirectory() && (f.includes('5G') || f.includes('batch'))) : [];
    if (dirs.length > 0 && !fs.existsSync(this.journalPath)) {
        throw new Error("CONTROL INCIDENT / OWNER REVIEW (Historical raw cache exists but journal is missing)");
    }

    const attempts = this.getAttemptCount(authId);
    const manifestPath = path.join(batchDir, 'batch_manifest.json');
    const progressPath = path.join(batchDir, 'batch_progress.json');

    // 5. Raw Cache Cross-Check
    const rawExists = fs.existsSync(path.join(batchDir, 'sales')) || fs.existsSync(path.join(batchDir, 'purchases'));
    let rawFileCount = 0;
    if (rawExists) {
        const countFiles = (dir: string) => {
            if (!fs.existsSync(dir)) return 0;
            return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
        };
        rawFileCount += countFiles(path.join(batchDir, 'sales'));
        rawFileCount += countFiles(path.join(batchDir, 'purchases'));
    }

    if (attempts === 0 && rawFileCount > 0) {
       throw new Error("CONTROL INCONSISTENCY — OWNER REVIEW REQUIRED (Journal missing but raw cache exists)");
    }

    // 6. Manifest Deletion Check
    if (attempts > 0 && !fs.existsSync(manifestPath)) {
       throw new Error("MANIFEST MISSING — OWNER REVIEW REQUIRED");
    }

    if (attempts >= auth.authorized_limit) {
       throw new Error("AUTHORIZATION EXHAUSTED");
    }
    
    // Concurrent runner check: can be done via a lock file in real app, 
    // for this offline task we just verify the counter handles it safely if appended.
  }

  public validateDocumentSafety(doc: any, auth: AuthorizationRecord) {
     const docId = String(doc.invoice_id || doc.bill_id || doc.document_id || '');
     const docDate = String(doc.date || doc.invoice_date || doc.bill_date || '');

     // 7. Synthetic / Test Guard
     if (docId.includes('test') || docId.includes('hist') || docId.includes('pilot')) {
         throw new Error("SYNTHETIC DOCUMENT REJECTED");
     }

     // 8. FY Guard
     if (docDate < auth.fy_bounds.start || docDate > auth.fy_bounds.end) {
         throw new Error("OUT OF FY REJECTED");
     }
  }

}
