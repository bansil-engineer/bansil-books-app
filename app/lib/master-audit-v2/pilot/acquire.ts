/** Bounded raw-evidence pilot. No completeness seal or financial claims from partial references. */
import {validatePilotDocumentDate} from './validation.ts';
import { PILOT_NUMBERS } from './store.ts';
import type { createPilotClient } from './client.ts';
import type { createPilotMemoryStore } from './store.ts';
const modules={salesorders:'salesorder',purchaseorders:'purchaseorder',invoices:'invoice',bills:'bill'} as const;
type Module=keyof typeof modules;
const id=(value:unknown):value is string=>typeof value==='string'&&/^\d+$/.test(value);
export async function acquirePilot(client:ReturnType<typeof createPilotClient>,store:ReturnType<typeof createPilotMemoryStore>,organizationId:string){
 if(client.organizationId!==organizationId)throw Error('PILOT_ORGANIZATION_MISMATCH');
 const runId=store.start(organizationId);const fetched=new Set<string>();const outcomes:{number:string;status:string;reason:string}[]=[];
 async function get(endpoint:string){const response=await client.get(endpoint);store.capture(runId,endpoint,response.raw);return response.body;}
 async function detail(module:Module,remoteId:string,expectedNumber?:string):Promise<void>{
  const key=`${module}/${remoteId}`;if(fetched.has(key))return;
  const data=await get('/books/v3/'+key),doc=data[modules[module]];
  if(!doc||doc[modules[module]+'_id']!==remoteId||(expectedNumber&&doc.salesorder_number!==expectedNumber))throw Error('DOCUMENT_IDENTITY_MISMATCH');
  validatePilotDocumentDate(doc.date);
  if(expectedNumber&&(doc.date<'2026-04-01'||doc.date>'2027-03-31'))throw Error('PILOT_FY_MISMATCH');
  fetched.add(key);
  store.event(runId,'DOCUMENT_OBSERVED',{module,remoteId,date:doc.date,pilotFYMatch:doc.date>='2026-04-01'&&doc.date<='2027-03-31',lineItemsPresent:Array.isArray(doc.line_items),completeness:'UNPROVEN'});
  // Follow only explicit document IDs; no party, item, number or amount heuristics.
  const childModules:Module[]=module==='salesorders'?['purchaseorders','invoices']:module==='purchaseorders'?['bills']:[];
  for(const child of childModules){
   const singular=modules[child];
   if(Array.isArray(doc[child]))for(const linked of doc[child])if(id(linked?.[singular+'_id'])){
    store.event(runId,'EXPLICIT_DOCUMENT_REFERENCE',{from:key,to:child+'/'+linked[singular+'_id'],sourceField:child});
    await detail(child,linked[singular+'_id']);
   }
  }
 }
 for(const number of PILOT_NUMBERS){
  try{
   const list=await get('/books/v3/salesorders?salesorder_number='+encodeURIComponent(number)+'&page=1&per_page=200');
   if(!Array.isArray(list.salesorders)||list.page_context?.has_more_page!==false)throw Error('PILOT_LOOKUP_INCOMPLETE');
   const matches=list.salesorders.filter((row:{salesorder_number?:string})=>row.salesorder_number===number);
   if(matches.length!==1||!id(matches[0].salesorder_id))throw Error(matches.length===0?'PILOT_SO_NOT_FOUND':'PILOT_SO_AMBIGUOUS');
   await detail('salesorders',matches[0].salesorder_id,number);
   outcomes.push({number,status:'EVIDENCE_ACQUIRED',reason:'LINK_AND_ALLOCATION_COMPLETENESS_UNPROVEN'});
  }catch(error){const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PILOT_ACQUISITION_FAILED';outcomes.push({number,status:'INCOMPLETE',reason});}
 }
 store.event(runId,'PILOT_FINISHED',{outcomes,requests:client.requestCount(),commercialStatus:'INCOMPLETE',checkpointAdvanced:false});
 return {runId,outcomes,requests:client.requestCount(),commercialStatus:'INCOMPLETE' as const};
}
