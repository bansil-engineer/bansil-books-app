/** Explicit single-document GET. No list traversal, related-document fetch or Zoho mutation. */
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {getMasterAuditV2DbPath} from '../../db/db-resolver';
import {readPilotView} from './view-model.ts';
import {readVerificationStates} from './verification-store.ts';
import {openPilotStore} from './store.ts';
import {normalizePilotDetail} from './normalize.ts';
export type SyncInput={type:'SO'|'PO'|'BILL'|'INVOICE';id:string;snapshot:string};
const modules={SO:'salesorders',PO:'purchaseorders',BILL:'bills',INVOICE:'invoices'} as const;
const active=new Set<string>();
// Sort keys but preserve every numeric lexeme and JSON type; no monetary Number rounding.
class SourceNumber {lexeme:string;constructor(lexeme:string){this.lexeme=lexeme;}}
export function canonicalSource(raw:string):string{
 const value=(JSON.parse as (s:string,r:(k:string,v:unknown,c?:{source?:string})=>unknown)=>unknown)(raw,(_k,v,c)=>{if(typeof v==='number'){if(!c?.source)throw Error('LOSSLESS_JSON_REQUIRED');return new SourceNumber(c.source);}return v;});
 const stable=(v:unknown):string=>v instanceof SourceNumber?'N'+v.lexeme:Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);
 return stable(value);
}
export async function syncDocument(root:string,input:SyncInput,get:(organizationId:string,endpoint:string)=>Promise<{raw:string}>){
 if(!Object.hasOwn(modules,input.type)||!/^\d{1,40}$/.test(input.id)||!/^[a-f0-9]{20}$/.test(input.snapshot))throw Error('INVALID_SYNC_REQUEST');
 const lock=root+':'+input.type+':'+input.id;if(active.has(lock))throw Error('SYNC_ALREADY_RUNNING');active.add(lock);
 try{
  const before=readPilotView(root);if(before.snapshotId!==input.snapshot)throw Error('SYNC_SOURCE_CHANGED');
  const doc=before.documents.find(d=>d.type===input.type&&d.id===input.id);if(!doc)throw Error('SYNC_DOCUMENT_NOT_SAVED');
  const db=new DatabaseSync(getMasterAuditV2DbPath(),{readOnly:true});
  let row;try{row=db.prepare('SELECT v.organization_id,v.raw_payload FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) JOIN source_documents s USING(organization_id,document_id) WHERE s.document_type=? AND s.remote_id=?').get(input.type,input.id);}finally{db.close();}
  if(!row)throw Error('SYNC_DOCUMENT_NOT_SAVED');
  const endpoint='/books/v3/'+modules[input.type]+'/'+input.id;
  const response=await get(String(row.organization_id),endpoint);
  normalizePilotDetail(endpoint,response.raw); // validate identity, date and complete structural detail before publication
  const latest=readPilotView(root);if(latest.documents.find(d=>d.key===doc.key)?.sha256!==doc.sha256)throw Error('SYNC_SOURCE_CHANGED');
  const unchanged=canonicalSource(String(row.raw_payload))===canonicalSource(response.raw);
  const store=openPilotStore(root);
  try{
   const run=store.start(String(row.organization_id)),capture=store.capture(run,endpoint,response.raw);
   if(!unchanged){const result=store.publishCapturedDetails(new Set([capture.responseId]),new Map([[capture.responseId,doc.sha256]]));if(result.failures.length||result.published!==1){store.markRejectedResponse(String(row.organization_id),capture.responseId);throw Error('SYNC_PUBLICATION_FAILED');}}
   // Mark unchanged responses as checked so later bulk publication cannot create duplicate versions.
   if(unchanged)store.markUnchangedResponse(String(row.organization_id),capture.responseId);
   store.event(run,'DOCUMENT_SMART_SYNC',{type:input.type,id:input.id,status:unchanged?'UNCHANGED':'CHANGED',detailGets:1,relatedGets:0});
  }finally{store.close();}
  const data=readPilotView(root);return {status:unchanged?'UNCHANGED':'CHANGED',detailGets:1,relatedGets:0,data,states:readVerificationStates(root,data)};
 }finally{active.delete(lock);}
}
