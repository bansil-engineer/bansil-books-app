/** Owner-approved Phase 4C evidence journal. Never opens a legacy database. */
import {normalizePilotDetail,LIVE_DETAIL_RULE} from './normalize.ts';
import { DatabaseSync } from 'node:sqlite';
import { getMasterAuditV2DbPath } from '../../db/db-resolver';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { isCanonicalDecimal } from '../decimal.ts';
export const PILOT_NUMBERS=Object.freeze(['SO-2627024','SO-2627009','SO-2627065']);
const journal=`
CREATE TABLE IF NOT EXISTS v2_pilot_runs(run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, organization_id TEXT NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json))) STRICT;
CREATE TABLE IF NOT EXISTS v2_pilot_responses(response_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES v2_pilot_runs(run_id),endpoint TEXT NOT NULL,observed_at TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),sha256 TEXT NOT NULL CHECK(length(sha256)=64)) STRICT;
CREATE TABLE IF NOT EXISTS v2_pilot_events(event_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES v2_pilot_runs(run_id),observed_at TEXT NOT NULL,code TEXT NOT NULL,details_json TEXT NOT NULL CHECK(json_valid(details_json))) STRICT;
`;
function configure(db:DatabaseSync){
 db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=3000;');
 db.function('v2_decimal_valid',{deterministic:true},(text,scale)=>isCanonicalDecimal(text,scale)?1:0);
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_schema_meta'").get())db.exec(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
  if(db.prepare('SELECT version FROM v2_schema_meta WHERE singleton=1').get()?.version!==1)throw Error('SCHEMA_VERSION_MISMATCH');
  db.exec(journal);
  for(const table of ['v2_pilot_runs','v2_pilot_responses','v2_pilot_events']){
   for(const operation of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END`);
   const id=table==='v2_pilot_runs'?'run_id':table==='v2_pilot_responses'?'response_id':'event_id';
   db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${id}=NEW.${id}) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END`);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
/** Fixed relative target; rejects symlink escapes including SQLite sidecar files. */
export function pilotDatabasePath(repositoryRoot:string){
  const target = getMasterAuditV2DbPath();
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return target;
}
export function openPilotStore(repositoryRoot:string){return makeStore(new DatabaseSync(pilotDatabasePath(repositoryRoot)));}
export function createPilotMemoryStore(){return makeStore(new DatabaseSync(':memory:'));}
function makeStore(db:DatabaseSync){
 try{configure(db);}catch(error){db.close();throw error;}
 return {
  start(organizationId:string){
   if(!/^\d+$/.test(organizationId))throw Error('ORGANIZATION_REQUIRED');
   const runId=randomUUID();db.prepare('INSERT INTO v2_pilot_runs VALUES(?,?,?,?)').run(runId,new Date().toISOString(),organizationId,JSON.stringify({pilotFY:'2026-27',historyFrom:'2022-04-01',salesOrders:PILOT_NUMBERS}));return runId;
  },
  capture(runId:string,endpoint:string,payload:string){
   if(!/^\/books\/v3\/(salesorders|purchaseorders|invoices|bills)(\/\d+)?(\?[^\s]*)?$/.test(endpoint))throw Error('ENDPOINT_NOT_ALLOWED');
   JSON.parse(payload);const hash=createHash('sha256').update(payload).digest('hex'),id=randomUUID();
   db.prepare('INSERT INTO v2_pilot_responses VALUES(?,?,?,?,?,?)').run(id,runId,endpoint,new Date().toISOString(),payload,hash);return {responseId:id,sha256:hash};
  },
  event(runId:string,code:string,details:unknown){db.prepare('INSERT INTO v2_pilot_events VALUES(?,?,?,?,?)').run(randomUUID(),runId,new Date().toISOString(),code,JSON.stringify(details));},
  publishCapturedDetails(onlyResponseIds?:ReadonlySet<string>,expectedCurrent:ReadonlyMap<string,string|null>=new Map()){
   let published=0,skipped=0;const failures:{responseId:string;reason:string}[]=[];
   const rows=db.prepare('SELECT r.*,p.organization_id FROM v2_pilot_responses r JOIN v2_pilot_runs p ON p.run_id=r.run_id ORDER BY r.rowid').all();
   for(const row of rows){
    const org=String(row.organization_id),responseId=String(row.response_id),eventId='publish:'+responseId;
    if(onlyResponseIds&&!onlyResponseIds.has(responseId))continue;
    if(db.prepare('SELECT event_id FROM audit_events WHERE organization_id=? AND event_id=?').get(org,eventId)){skipped++;continue;}
    try{
     const detail=normalizePilotDetail(String(row.endpoint),String(row.payload));if(!detail){skipped++;continue;}
     if(createHash('sha256').update(String(row.payload)).digest('hex')!==row.sha256)throw Error('PAYLOAD_HASH_MISMATCH');
     db.exec('BEGIN IMMEDIATE');
     try{
      if(!db.prepare('SELECT organization_id FROM organizations WHERE organization_id=?').get(org))db.prepare('INSERT INTO organizations VALUES(?)').run(org);
      if(!db.prepare('SELECT fy_id FROM financial_years WHERE organization_id=? AND fy_id=?').get(org,detail.fyId))db.prepare('INSERT INTO financial_years VALUES(?,?,?,?)').run(org,detail.fyId,detail.dateFrom,detail.dateTo);
      const documentId=JSON.stringify([detail.documentType,detail.remoteId]);
      if(expectedCurrent.has(responseId)){const before=db.prepare('SELECT v.payload_sha256 FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) WHERE c.organization_id=? AND c.document_id=?').get(org,documentId);if((before?.payload_sha256??null)!==expectedCurrent.get(responseId))throw Error('SYNC_SOURCE_CHANGED');}
      if(!db.prepare('SELECT document_id FROM source_documents WHERE organization_id=? AND document_id=?').get(org,documentId))db.prepare('INSERT INTO source_documents VALUES(?,?,?,?)').run(org,documentId,detail.documentType,detail.remoteId);
      const n=Number(db.prepare('SELECT max(version_number) AS n FROM document_versions WHERE organization_id=? AND document_id=?').get(org,documentId)?.n??0)+1,version='v'+n;
      db.prepare('INSERT INTO document_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(org,documentId,version,n,detail.fyId,detail.documentDate,detail.revision,String(row.observed_at),String(row.payload),String(row.sha256),detail.lines.length);
      const insert=db.prepare('INSERT INTO document_version_lines VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const line of detail.lines)insert.run(org,documentId,version,line.id,line.itemId,line.unit,line.quantity,line.scale,line.quantity===null?'SOURCE_QUANTITY_MISSING':null,null,null,'AMOUNT_SEMANTICS_NOT_VALIDATED');
      db.prepare('INSERT INTO version_seals VALUES(?,?,?,?,?,?)').run(org,documentId,version,LIVE_DETAIL_RULE,'response:'+responseId,String(row.observed_at));
      const current=db.prepare('SELECT version_id FROM document_current WHERE organization_id=? AND document_id=?').get(org,documentId);
      if(current)db.prepare('UPDATE document_current SET version_id=? WHERE organization_id=? AND document_id=?').run(version,org,documentId);else db.prepare('INSERT INTO document_current VALUES(?,?,?)').run(org,documentId,version);
      db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(org,eventId,'PILOT_STRUCTURAL_DETAIL_PUBLISHED',new Date().toISOString(),JSON.stringify({responseId,documentId,version,rule:LIVE_DETAIL_RULE,financialCompleteness:'UNPROVEN',linkCompleteness:'UNPROVEN'}));
      db.exec('COMMIT');published++;
     }catch(error){db.exec('ROLLBACK');throw error;}
    }catch(error){failures.push({responseId,reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PUBLICATION_FAILED'});}
   }
   return {published,skipped,failures};
  },
  markRejectedResponse(organizationId:string,responseId:string){db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(organizationId,'publish:'+responseId,'PILOT_DETAIL_REJECTED',new Date().toISOString(),JSON.stringify({responseId,versionCreated:false}));},
  markUnchangedResponse(organizationId:string,responseId:string){db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(organizationId,'publish:'+responseId,'PILOT_DETAIL_UNCHANGED',new Date().toISOString(),JSON.stringify({responseId,versionCreated:false}));},
  inspect(runId:string){return {run:db.prepare('SELECT * FROM v2_pilot_runs WHERE run_id=?').get(runId),responses:db.prepare('SELECT * FROM v2_pilot_responses WHERE run_id=? ORDER BY rowid').all(runId),events:db.prepare('SELECT * FROM v2_pilot_events WHERE run_id=? ORDER BY rowid').all(runId)};},
  close(){db.close();}
 };
}
