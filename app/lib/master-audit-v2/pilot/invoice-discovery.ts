/** Bounded invoice searches are candidate discovery, never proof of complete SO invoicing. */
import {PILOT_NUMBERS} from './store.ts';
import type {createPilotMemoryStore} from './store.ts';
import type {createPilotClient} from './client.ts';
import {validatePilotDocumentDate} from './validation.ts';
export async function discoverPilotInvoices(client:ReturnType<typeof createPilotClient>,store:ReturnType<typeof createPilotMemoryStore>,organizationId:string,referenceSearches:readonly string[]=[]){
 if(client.organizationId!==organizationId)throw Error('PILOT_ORGANIZATION_MISMATCH');
 if(referenceSearches.length>3||referenceSearches.some(v=>!v.trim()||v.length>100))throw Error('INVOICE_REFERENCE_SEARCH_INVALID');
 const run=store.start(organizationId),seen=new Set<string>();let acquired=0,failed=0;
 for(const number of (referenceSearches.length?referenceSearches:PILOT_NUMBERS)){try{
  const endpoint='/books/v3/invoices?search_text='+encodeURIComponent(number)+'&page=1&per_page=200';
  const list=await client.get(endpoint);store.capture(run,endpoint,list.raw);
  if(!Array.isArray(list.body.invoices)||list.body.page_context?.has_more_page!==false)throw Error('INVOICE_SEARCH_INCOMPLETE');
  store.event(run,'INVOICE_SEARCH_OBSERVED',{number,count:list.body.invoices.length,coverage:'UNPROVEN'});
  for(const row of list.body.invoices){const id=row.invoice_id;if(typeof id!=='string'||!/^\d+$/.test(id))throw Error('INVALID_INVOICE_ID');if(seen.has(id))continue;if(seen.size>=15)throw Error('INVOICE_CANDIDATE_LIMIT');seen.add(id);
   const path='/books/v3/invoices/'+id,r=await client.get(path);store.capture(run,path,r.raw);if(r.body.invoice?.invoice_id!==id)throw Error('DOCUMENT_IDENTITY_MISMATCH');validatePilotDocumentDate(r.body.invoice.date);acquired++;
  }
 }catch(e){failed++;store.event(run,'INVOICE_DISCOVERY_INCOMPLETE',{number,reason:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'INVOICE_DISCOVERY_FAILED'});}}
 const result={acquired,failed,requests:client.requestCount(),coverage:'INCOMPLETE'};store.event(run,'INVOICE_DISCOVERY_FINISHED',result);return result;
}
