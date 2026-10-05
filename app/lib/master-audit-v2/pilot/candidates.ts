/** Historical indexes locate candidates only. Current GET evidence determines current references. */
import type {createPilotClient} from './client.ts';
import type {createPilotMemoryStore} from './store.ts';
import {validatePilotDocumentDate} from './validation.ts';
export interface PilotCandidate {module:'purchaseorders'|'invoices';remoteId:string}
export async function acquirePilotCandidates(client:ReturnType<typeof createPilotClient>,store:ReturnType<typeof createPilotMemoryStore>,organizationId:string,candidates:readonly PilotCandidate[],source:'HISTORICAL_INDEX_CANDIDATE_LIVE_GET'|'CAPTURED_ZOHO_LIST_CANDIDATE_LIVE_GET'='HISTORICAL_INDEX_CANDIDATE_LIVE_GET'){
 if(client.organizationId!==organizationId)throw Error('PILOT_ORGANIZATION_MISMATCH');
 if(candidates.length>15||candidates.some(c=>!['purchaseorders','invoices'].includes(c.module)||!/^\d+$/.test(c.remoteId)))throw Error('CANDIDATE_BATCH_INVALID');
 const runId=store.start(organizationId);const seen=new Set<string>();let acquired=0,failed=0;
 async function get(module:string,remoteId:string){
  const endpoint=`/books/v3/${module}/${remoteId}`;
  if(seen.has(endpoint))return;
  const r=await client.get(endpoint);store.capture(runId,endpoint,r.raw);
  const singular=module==='purchaseorders'?'purchaseorder':module==='invoices'?'invoice':'bill',doc=r.body[singular];
  if(!doc||doc[singular+'_id']!==remoteId)throw Error('DOCUMENT_IDENTITY_MISMATCH');
  validatePilotDocumentDate(doc.date);seen.add(endpoint);
  const fields=Array.isArray(doc.custom_fields)?doc.custom_fields.filter((f:{label?:string})=>/^Sales Order No$/i.test(f.label??'')):[];
  store.event(runId,'CANDIDATE_DETAIL_OBSERVED',{module,remoteId,date:doc.date,number:doc[singular+'_number']??null,source,salesOrderReferences:fields.map((f:{value?:unknown})=>f.value),allocationStatus:'UNPROVEN'});
  acquired++;
  if(module==='purchaseorders'&&Array.isArray(doc.bills))for(const bill of doc.bills){
   if(typeof bill.bill_id!=='string'||!/^\d+$/.test(bill.bill_id))throw Error('INVALID_BILL_REFERENCE');
   await get('bills',bill.bill_id);store.event(runId,'EXPLICIT_PO_BILL_REFERENCE',{purchaseorderId:remoteId,billId:bill.bill_id,allocationStatus:'UNPROVEN'});
  }
 }
 for(const candidate of candidates){try{await get(candidate.module,candidate.remoteId);}catch(error){failed++;store.event(runId,'CANDIDATE_ACQUISITION_INCOMPLETE',{...candidate,reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'CANDIDATE_GET_FAILED'});}}
 store.event(runId,'CANDIDATE_BATCH_FINISHED',{acquired,failed,requests:client.requestCount(),commercialStatus:'INCOMPLETE',indexCompleteness:'UNPROVEN'});
 return {runId,acquired,failed,requests:client.requestCount(),commercialStatus:'INCOMPLETE'};
}
