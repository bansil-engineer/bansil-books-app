/** Local operator entry point only. Not imported by a page or route; no web-triggered writes.
 * Owner approved GET pilot, isolated DB and routine same-scope token refresh.
 */
import { DatabaseSync } from 'node:sqlite';
import { getAuditWorkspaceDbPath, getMasterAuditV2DbPath } from '../lib/db/db-resolver.ts';
import {readPilotView} from '../lib/master-audit-v2/pilot/view-model.ts';
import {reconcilePilotPurchaseIndex} from '../lib/master-audit-v2/pilot/discovery.ts';
import {discoverPilotInvoices} from '../lib/master-audit-v2/pilot/invoice-discovery.ts';
import { acquirePilotCandidates } from '../lib/master-audit-v2/pilot/candidates.ts';
import type {PilotCandidate} from '../lib/master-audit-v2/pilot/candidates.ts';
import nextEnv from '@next/env';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readTokenStore, isAccessTokenValid } from '../lib/zoho-token-store.ts';
import { getValidAccessToken } from '../lib/zoho-api.ts';
import { createPilotClient } from '../lib/master-audit-v2/pilot/client.ts';
import { openPilotStore } from '../lib/master-audit-v2/pilot/store.ts';
import { acquirePilot } from '../lib/master-audit-v2/pilot/acquire.ts';
const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url));
async function main(){
 if(resolve(process.cwd())!==resolve(repositoryRoot))throw Error('WRONG_EXECUTION_ENVIRONMENT');
 nextEnv.loadEnvConfig(repositoryRoot);
 const existing=readTokenStore();
 const organizationId=existing?.organization_id||process.env.ZOHO_DEFAULT_ORG_ID||'';
 if(process.argv.includes('--preflight')){
  console.log(JSON.stringify({connected:!!existing,accessTokenValid:!!existing&&isAccessTokenValid(existing),organizationConfigured:/^\d+$/.test(organizationId)}));return;
 }
 if(!process.argv.includes('--approved-pilot'))throw Error('EXPLICIT_PILOT_COMMAND_REQUIRED');
 if(!/^\d+$/.test(organizationId))throw Error('ORGANIZATION_REQUIRED');
 if(!existing)throw Error('ZOHO_CONNECTION_REQUIRED');
 if(!isAccessTokenValid(existing)&&!process.argv.includes('--approved-routine-refresh'))throw Error('TOKEN_REFRESH_APPROVAL_REQUIRED');
 const auth=await getValidAccessToken();const current=readTokenStore();if(!current)throw Error('ZOHO_CONNECTION_REQUIRED');
 const client=createPilotClient({accessToken:auth.token,expiresAt:current.expires_at,apiDomain:current.api_domain,organizationId});
 const store=openPilotStore(repositoryRoot);
 try{
 if(process.argv.includes('--reconcile-purchase-index')||process.argv.includes('--discover-purchase-references')){
  const view=readPilotView(repositoryRoot);
  const existing=new Map(view.documents.filter(d=>d.type==='PO').map(d=>[d.id,d.billIds] as const));
  const bills=new Set(view.documents.filter(d=>d.type==='BILL').map(d=>d.id));
  console.log(JSON.stringify(await reconcilePilotPurchaseIndex(client,store,organizationId,existing,bills)));
  console.log(JSON.stringify(store.publishCapturedDetails()));return;
 }
 if(process.argv.includes('--discover-invoice-references')){
  const references:string[]=[];
  if(process.argv.includes('--use-so-customer-po-references')){const db=new DatabaseSync(getMasterAuditV2DbPath(),{readOnly:true});try{for(const row of db.prepare("SELECT v.raw_payload FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) JOIN source_documents s USING(organization_id,document_id) WHERE s.organization_id=? AND s.document_type='SO'").all(organizationId)){const d=JSON.parse(String(row.raw_payload)).salesorder;if(['SO-2627024','SO-2627009','SO-2627065'].includes(d.salesorder_number)&&typeof d.reference_number==='string'&&d.reference_number.trim())references.push(d.reference_number.trim());}}finally{db.close();}}
  console.log(JSON.stringify(await discoverPilotInvoices(client,store,organizationId,references)));console.log(JSON.stringify(store.publishCapturedDetails()));return;}

 if(process.argv.includes('--captured-list-candidates')){
  const captureDB=new DatabaseSync(getMasterAuditV2DbPath(),{readOnly:true});
  const candidates:PilotCandidate[]=[];
  try{
   const existing=new Set(captureDB.prepare("SELECT remote_id FROM source_documents WHERE organization_id=? AND document_type='PO'").all(organizationId).map(r=>String(r.remote_id)));
   const seen=new Set<string>();
   for(const row of captureDB.prepare('SELECT r.payload FROM v2_pilot_responses r JOIN v2_pilot_runs p USING(run_id) WHERE p.organization_id=? ORDER BY r.rowid').all(organizationId)){
    const body=JSON.parse(String(row.payload));if(!Array.isArray(body.purchaseorders))continue;
    for(const po of body.purchaseorders){
     const refs=String(po.cf_sales_order_no??'').match(/SO-\d+/g)??[];
     if(!refs.some((v:string)=>['SO-2627024','SO-2627009','SO-2627065'].includes(v))||existing.has(po.purchaseorder_id)||seen.has(po.purchaseorder_id))continue;
     seen.add(po.purchaseorder_id);candidates.push({module:'purchaseorders',remoteId:po.purchaseorder_id});
    }
   }
  }finally{captureDB.close();}
  console.log(JSON.stringify({capturedListCandidates:candidates.length,coverage:'PARTIAL_LIST'}));
  for(let offset=0;offset<candidates.length;offset+=15){
   const batchClient=createPilotClient({accessToken:auth.token,expiresAt:current.expires_at,apiDomain:current.api_domain,organizationId});
   console.log(JSON.stringify(await acquirePilotCandidates(batchClient,store,organizationId,candidates.slice(offset,offset+15),'CAPTURED_ZOHO_LIST_CANDIDATE_LIVE_GET')));
  }return;
 }
 if(process.argv.includes('--historical-index-candidates')){
  const index=new DatabaseSync(getAuditWorkspaceDbPath(),{readOnly:true});
  const candidates:PilotCandidate[]=[];
  try{
   for(const [table,module,column] of [['audit_zoho_purchase_orders','purchaseorders','purchaseorder_id'],['audit_zoho_invoices','invoices','invoice_id']] as const){
    const rows=index.prepare(`SELECT DISTINCT ${column} AS remote_id FROM ${table} WHERE organization_id=? AND (custom_fields_json LIKE '%2627024%' OR custom_fields_json LIKE '%2627009%' OR custom_fields_json LIKE '%2627065%' ${module==='purchaseorders'?"OR reference_number LIKE '%2627024%' OR reference_number LIKE '%2627009%' OR reference_number LIKE '%2627065%'":"OR salesorder_id IN ('3166667000016441024','3166667000016123005','3166667000017926015')"})`).all(organizationId);
    for(const row of rows)candidates.push({module,remoteId:String(row.remote_id)});
   }
  }finally{index.close();}
  console.log(JSON.stringify({historicalCandidates:candidates.length,indexCompleteness:'UNPROVEN'}));
  for(let offset=0;offset<candidates.length;offset+=15){
   const batchClient=createPilotClient({accessToken:auth.token,expiresAt:current.expires_at,apiDomain:current.api_domain,organizationId});
   console.log(JSON.stringify(await acquirePilotCandidates(batchClient,store,organizationId,candidates.slice(offset,offset+15))));
  }return;
 }
 console.log(JSON.stringify(await acquirePilot(client,store,organizationId)));}finally{store.close();}
}
main().catch(error=>{console.error(JSON.stringify({status:'BLOCKED',reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PILOT_PREFLIGHT_OR_ACCESS_FAILED'}));process.exitCode=1;});
