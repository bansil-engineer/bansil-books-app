/** Reverse PO discovery supplements empty SO arrays. Search results are candidates, never allocations. */
import {validatePilotDocumentDate} from './validation.ts';
import {PILOT_NUMBERS} from './store.ts';
import type {createPilotMemoryStore} from './store.ts';
import type {createPilotClient} from './client.ts';
export async function discoverPilotPurchaseOrders(client:ReturnType<typeof createPilotClient>,store:ReturnType<typeof createPilotMemoryStore>,organizationId:string){
 if(client.organizationId!==organizationId)throw Error('PILOT_ORGANIZATION_MISMATCH');
 const runId=store.start(organizationId);const seen=new Set<string>();let candidates=0;
 async function get(endpoint:string){const r=await client.get(endpoint);store.capture(runId,endpoint,r.raw);return r.body;}
 for(const number of PILOT_NUMBERS)for(const field of ['custom_field_contains','reference_number_contains']){
  try{
   const list=await get(`/books/v3/purchaseorders?${field}=${number.replace(/^SO-/, '')}&page=1&per_page=200`);
   if(!Array.isArray(list.purchaseorders)||list.page_context?.has_more_page!==false)throw Error('DISCOVERY_LIST_INCOMPLETE');
   for(const row of list.purchaseorders){
    const remoteId=row.purchaseorder_id;if(typeof remoteId!=='string'||!/^\d+$/.test(remoteId))throw Error('INVALID_REMOTE_ID');
    store.event(runId,'PO_SEARCH_CANDIDATE',{number,remoteId,searchField:field,allocationStatus:'UNPROVEN'});
    if(seen.has(remoteId))continue;seen.add(remoteId);candidates++;
    const body=await get('/books/v3/purchaseorders/'+remoteId);const po=body.purchaseorder;
    if(!po||po.purchaseorder_id!==remoteId)throw Error('DOCUMENT_IDENTITY_MISMATCH');
    validatePilotDocumentDate(po.date);
    store.event(runId,'PO_DETAIL_OBSERVED',{remoteId,date:po.date??null,lineCount:Array.isArray(po.line_items)?po.line_items.length:null,completeness:'UNPROVEN'});
    if(Array.isArray(po.bills))for(const bill of po.bills){
     if(typeof bill.bill_id!=='string'||!/^\d+$/.test(bill.bill_id))continue;
     const b=await get('/books/v3/bills/'+bill.bill_id);
     if(b.bill?.bill_id!==bill.bill_id)throw Error('DOCUMENT_IDENTITY_MISMATCH');
     validatePilotDocumentDate(b.bill.date);
     store.event(runId,'EXPLICIT_PO_BILL_REFERENCE',{purchaseorderId:remoteId,billId:bill.bill_id,sourceField:'bills',allocationStatus:'UNPROVEN'});
    }
   }
   store.event(runId,'SEARCH_COMPLETED',{number,field,count:list.purchaseorders.length,globalLinkCompleteness:'UNPROVEN'});
  }catch(error){store.event(runId,'DISCOVERY_INCOMPLETE',{number,field,reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'DISCOVERY_FAILED'});}
 }
 store.event(runId,'DISCOVERY_FINISHED',{candidates,requests:client.requestCount(),commercialStatus:'INCOMPLETE'});
 return {runId,candidates,requests:client.requestCount(),commercialStatus:'INCOMPLETE'};
}

/** Authoritative list traversal for missing-record recovery. Search endpoints are not coverage proof.
 * Existing captured detail is reused, not declared current/unchanged. All coverage stays INCOMPLETE.
 * Explicit operator invocation only; never run from a page render.
 */
export async function reconcilePilotPurchaseIndex(client:ReturnType<typeof createPilotClient>,store:ReturnType<typeof createPilotMemoryStore>,organizationId:string,existing:ReadonlyMap<string,readonly string[]>,capturedBills:ReadonlySet<string>,maxPages=30){
 if(client.organizationId!==organizationId)throw Error('PILOT_ORGANIZATION_MISMATCH');
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>30)throw Error('INVALID_PAGE_BUDGET');
 const runId=store.start(organizationId),seen=new Set<string>(),bills=new Set(capturedBills);
 let pages=0,acquired=0,reused=0,failed=0,listTraversalComplete=false;
 async function get(endpoint:string){const r=await client.get(endpoint);store.capture(runId,endpoint,r.raw);return r.body;}
 async function getBill(id:string){
  if(!/^\d+$/.test(id))throw Error('INVALID_BILL_REFERENCE');
  if(bills.has(id))return;
  const body=await get('/books/v3/bills/'+id);
  if(body.bill?.bill_id!==id)throw Error('DOCUMENT_IDENTITY_MISMATCH');
  validatePilotDocumentDate(body.bill.date);bills.add(id);acquired++;
 }
 try{for(let page=1;page<=maxPages;page++){
  const list=await get(`/books/v3/purchaseorders?page=${page}&per_page=200`);pages++;
  if(!Array.isArray(list.purchaseorders)||typeof list.page_context?.has_more_page!=='boolean'||Number(list.page_context.page)!==page)throw Error('DISCOVERY_LIST_INCOMPLETE');
  let newRows=0;
  for(const row of list.purchaseorders){
   const id=row.purchaseorder_id;if(typeof id!=='string'||!/^\d+$/.test(id))throw Error('INVALID_REMOTE_ID');
   if(seen.has(id))continue;seen.add(id);newRows++;
   const values=[row.cf_sales_order_no,...(Array.isArray(row.custom_fields)?row.custom_fields.filter((f:{api_name?:string;label?:string})=>f.api_name==='cf_sales_order_no'||/^Sales Order No$/i.test(f.label??'')).map((f:{value?:unknown})=>f.value):[])];
   const refs=values.flatMap(v=>typeof v==='string'?v.match(/SO-\d+/g)??[]:[]);
   if(!refs.some(n=>PILOT_NUMBERS.includes(n)))continue;
   store.event(runId,'PO_INDEX_CANDIDATE',{remoteId:id,page,references:refs,allocationStatus:'UNPROVEN'});
   try{
    let ids=existing.get(id);
    if(ids){reused++;}else{
     const body=await get('/books/v3/purchaseorders/'+id),po=body.purchaseorder;
     if(po?.purchaseorder_id!==id)throw Error('DOCUMENT_IDENTITY_MISMATCH');
     validatePilotDocumentDate(po.date);
     if(!Array.isArray(po.bills))throw Error('BILL_REFERENCES_INCOMPLETE');
     ids=po.bills.map((b:{bill_id:string})=>b.bill_id);acquired++;
    }
    for(const billId of ids!)await getBill(billId);
   }catch(error){failed++;store.event(runId,'CANDIDATE_ACQUISITION_INCOMPLETE',{remoteId:id,reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'CANDIDATE_GET_FAILED'});}
  }
  if(!list.page_context.has_more_page){listTraversalComplete=true;break;}
  if(!newRows)throw Error('DISCOVERY_PAGINATION_STALLED');
 }}catch(error){failed++;store.event(runId,'DISCOVERY_INCOMPLETE',{reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'DISCOVERY_FAILED'});}
 const result={runId,pages,acquired,reused,failed,listTraversalComplete,requests:client.requestCount(),commercialStatus:'INCOMPLETE',freshness:'CAPTURED_DETAILS_REUSED_NOT_REFRESHED'};
 store.event(runId,'PO_INDEX_RECONCILIATION_FINISHED',result);return result;
}
