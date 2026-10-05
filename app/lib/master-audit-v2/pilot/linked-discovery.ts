/** Bounded operator-triggered GET discovery. Associations remain evidence, never approvals. */
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {PILOT_NUMBERS,openPilotStore} from './store.ts';
import {readPilotView} from './view-model.ts';
import {readVerificationStates} from './verification-store.ts';
import {normalizePilotDetail} from './normalize.ts';
import {canonicalSource} from './document-sync.ts';
import {orderPOs} from './po-verification.ts';
export type DiscoveryInput={soId:string;snapshot:string};
const active=new Set<string>();
const id=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,40}$/.test(v);
function references(value:unknown,key:string):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('REFERENCE_LIST_INVALID');
 return [...new Set(value.map(row=>{if(!id(row?.[key]))throw Error('REFERENCE_ID_INVALID');return row[key] as string;}))];
}
function ownerNumbers(po:any){return (po.custom_fields??[]).filter((f:any)=>/^Sales Order No$/i.test(f.label??'')).flatMap((f:any)=>typeof f.value==='string'?f.value.match(/SO-\d+/g)??[]:[]);}
function invoiceSOIds(inv:any){return [...(id(inv.salesorder_id)?[inv.salesorder_id]:[]),...references(Array.isArray(inv.salesorders)?inv.salesorders:inv.salesorders?[inv.salesorders]:undefined,'salesorder_id')];}
const messages:Record<string,string>={DISCOVERY_BUDGET:'Search limit reached. Saved progress is retained; coverage is still incomplete.',DISCOVERY_LIST_INCOMPLETE:'A search returned more pages or incomplete results. Complete coverage is not established.',DISCOVERY_SOURCE_CHANGED:'Saved data changed during discovery. Reload before searching again.',DISCOVERY_CANDIDATE_LIMIT:'Too many candidates for this bounded search. Complete coverage is not established.',REFERENCE_LIST_INVALID:'Source references are incomplete.',REFERENCE_ID_INVALID:'A source reference is invalid.'};
export async function discoverLinkedDocuments(root:string,input:DiscoveryInput,get:(organizationId:string,endpoint:string)=>Promise<{raw:string}>,now=Date.now){
 if(!id(input.soId)||!/^[a-f0-9]{20}$/.test(input.snapshot))throw Error('INVALID_DISCOVERY_REQUEST');
 if(active.has(root))throw Error('DISCOVERY_ALREADY_RUNNING');active.add(root);
 let store:ReturnType<typeof openPilotStore>|undefined;
 try{
  let data=readPilotView(root);
  const initialSO=data.documents.find(d=>d.type==='SO'&&d.id===input.soId);
  if(data.snapshotId!==input.snapshot)throw Error('DISCOVERY_SOURCE_CHANGED');
  if(!initialSO||!PILOT_NUMBERS.includes(initialSO.number)||initialSO.fy!=='2026-27')throw Error('DISCOVERY_SO_NOT_ALLOWED');
  const path=join(root,'data/master-audit-v2/db/master-audit-v2.sqlite');
  const readCurrent=(type:string,remoteId:string)=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare('SELECT v.organization_id,v.raw_payload,v.payload_sha256 FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) JOIN source_documents s USING(organization_id,document_id) WHERE s.document_type=? AND s.remote_id=?').get(type,remoteId);}finally{db.close();}};
  const org=String(readCurrent('SO',input.soId)!.organization_id);
  store=openPilotStore(root);const run=store.start(org),started=now();
  let requests=0,added=0,updated=0,unchanged=0,rejected=0,poPages=0,poIndexComplete=false;const issues:string[]=[];
  async function acquire(endpoint:string){
   if(requests>=55||now()-started>=60000)throw Error('DISCOVERY_BUDGET');
   requests++;const result=await get(org,endpoint);
   if(readPilotView(root).snapshotId!==data.snapshotId)throw Error('DISCOVERY_SOURCE_CHANGED');
   const capture=store!.capture(run,endpoint,result.raw);return {...result,...capture,body:JSON.parse(result.raw)};
  }
  async function detail(module:string,remoteId:string,accept:(doc:any)=>boolean){
   const endpoint='/books/v3/'+module+'/'+remoteId;
   const result=await acquire(endpoint);let accepted=false;
   try{
    const normal=normalizePilotDetail(endpoint,result.raw);if(!normal)throw Error('DOCUMENT_IDENTITY_MISMATCH');
    const singular={salesorders:'salesorder',purchaseorders:'purchaseorder',bills:'bill',invoices:'invoice'}[module]!;
    const doc=result.body[singular];
    if(doc.custom_fields!==undefined&&!Array.isArray(doc.custom_fields))throw Error('REFERENCE_LIST_INVALID');
    references(doc.bills,'bill_id');references(doc.invoices,'invoice_id');
    if(module==='salesorders')references(doc.purchaseorders,'purchaseorder_id');
    if(module==='invoices')invoiceSOIds(doc);
    if(!accept(doc)){rejected++;return null;}
    const before=readCurrent(normal.documentType,remoteId);
    if(before&&canonicalSource(String(before.raw_payload))===canonicalSource(result.raw)){store!.markUnchangedResponse(org,result.responseId);unchanged++;accepted=true;return doc;}
    const publication=store!.publishCapturedDetails(new Set([result.responseId]),new Map([[result.responseId,before?String(before.payload_sha256):null]]));
    if(publication.published!==1)throw Error('DISCOVERY_SOURCE_CHANGED');
    accepted=true;if(before)updated++;else added++;
    data=readPilotView(root);return doc;
   }finally{if(!accepted)store!.markRejectedResponse(org,result.responseId);}
  }
  async function search(endpoint:string,field:string,idKey:string){
   const r=await acquire(endpoint),body=r.body;
   if(body.code!==0||!Array.isArray(body[field])||body.page_context?.has_more_page!==false||Number(body.page_context?.page)!==1)throw Error('DISCOVERY_LIST_INCOMPLETE');
   return references(body[field],idKey);
  }
  try{
   const so=await detail('salesorders',input.soId,d=>d.salesorder_number===initialSO.number&&d.date>='2026-04-01'&&d.date<='2027-03-31');
   if(!so)throw Error('DISCOVERY_SO_NOT_ALLOWED');
   const directPOs=references(so.purchaseorders,'purchaseorder_id');
   const poIds=new Set([...orderPOs(data,input.soId).map(d=>d.id),...directPOs]);
   // Zoho may ignore custom_field_contains. Traverse the index, then inspect exact SO tokens.
   const indexSeen=new Set<string>();
   for(let page=1;page<=30;page++){
    const r=await acquire(`/books/v3/purchaseorders?page=${page}&per_page=200`);poPages++;
    const body=r.body;
    if(body.code!==0||!Array.isArray(body.purchaseorders)||typeof body.page_context?.has_more_page!=='boolean'||Number(body.page_context?.page)!==page)throw Error('DISCOVERY_LIST_INCOMPLETE');
    let newRows=0;
    for(const row of body.purchaseorders){
     if(!id(row.purchaseorder_id))throw Error('REFERENCE_ID_INVALID');
     if(indexSeen.has(row.purchaseorder_id))continue;indexSeen.add(row.purchaseorder_id);newRows++;
     const values=[row.cf_sales_order_no,row.reference_number,...(Array.isArray(row.custom_fields)?row.custom_fields.filter((f:any)=>/^Sales Order No$/i.test(f.label??'')||f.api_name==='cf_sales_order_no').map((f:any)=>f.value):[])];
     if(values.some(value=>typeof value==='string'&&(value.match(/SO-\d+/g)??[]).some((number:string)=>number===initialSO.number)))poIds.add(row.purchaseorder_id);
    }
    if(!body.page_context.has_more_page){poIndexComplete=true;break;}
    if(!newRows)throw Error('DISCOVERY_LIST_INCOMPLETE');
   }
   if(!poIndexComplete)issues.push('PO index page limit reached. More Purchase Orders may exist.');
   if(poIds.size>40)throw Error('DISCOVERY_CANDIDATE_LIMIT');
   const billIds=new Set<string>();
   for(const poId of poIds){
    const po=await detail('purchaseorders',poId,d=>directPOs.includes(poId)||ownerNumbers(d).includes(initialSO.number));
    if(po)for(const billId of references(po.bills,'bill_id'))billIds.add(billId);
   }
   for(const billId of billIds){
    if(data.documents.some(d=>d.type==='BILL'&&d.id===billId))continue;
    await detail('bills',billId,()=>true); // Authority: explicit accepted PO.bills ID above; allocation remains unverified.
   }
   const directInvoices=references(so.invoices,'invoice_id'),invoiceIds=new Set(directInvoices);
   const reference=typeof so.reference_number==='string'?so.reference_number.trim():'';
   const searchValues=[...new Set([initialSO.number,...(reference?[reference]:[])])];
   for(const value of searchValues){
    if(value.length>100){issues.push('Invoice reference is too long for bounded discovery.');continue;}
    try{for(const candidate of await search('/books/v3/invoices?search_text='+encodeURIComponent(value)+'&page=1&per_page=200','invoices','invoice_id'))invoiceIds.add(candidate);}catch(e){if(e instanceof Error&&e.message==='DISCOVERY_LIST_INCOMPLETE')issues.push(messages[e.message]);else throw e;}
   }
   if(invoiceIds.size>20)throw Error('DISCOVERY_CANDIDATE_LIMIT');
   for(const invoiceId of invoiceIds){
    if(data.documents.some(d=>d.type==='INVOICE'&&d.id===invoiceId))continue;
    await detail('invoices',invoiceId,inv=>{
     if(!so.customer_id||inv.customer_id!==so.customer_id)return false;
     const links=invoiceSOIds(inv);
     if(directInvoices.includes(invoiceId)||links.includes(input.soId))return true;
     return !links.length&&!data.documents.some(d=>d.type==='SO'&&d.id!==input.soId&&d.invoiceIds.includes(invoiceId))&&!!reference&&typeof inv.reference_number==='string'&&inv.reference_number.trim()===reference;
    });
   }
  }catch(e){const code=e instanceof Error?e.message:'';issues.push(messages[code]??'Discovery stopped because a source request or validation failed. Saved progress is retained. Reload saved data before retrying.');}
  const summary={requests,poPages,poIndexComplete,added,updated,unchanged,rejected,issues:[...new Set(issues)],status:issues.length?'PARTIAL':'SEARCH_FINISHED',coverage:'INCOMPLETE'};
  store.event(run,'WEB_LINKED_DISCOVERY_FINISHED',{soId:input.soId,...summary});
  data=readPilotView(root);return {summary,data,states:readVerificationStates(root,data)};
 }finally{store?.close();active.delete(root);}
}
