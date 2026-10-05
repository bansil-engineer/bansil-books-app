import {DatabaseSync} from 'node:sqlite';
import {existingPath} from './verification-store.ts';
import {readPilotView} from './view-model.ts';
import {orderPOs} from './po-verification.ts';
import {openPilotStore,PILOT_NUMBERS} from './store.ts';
export type UnlinkedInput={soId:string;poId:string;snapshot:string};
export type BillCandidate={id:string;number:string;date:string;vendor:string;reference:string;status:string;linkedElsewhere:boolean};
const active=new Set<string>();
export async function findUnlinkedBills(root:string,input:UnlinkedInput,get:(org:string,endpoint:string)=>Promise<{raw:string}>,now=Date.now){
 if(active.has(root))throw Error('Search is already running');active.add(root);
 try{
 const data=readPilotView(root),so=data.documents.find(d=>d.type==='SO'&&d.id===input.soId),po=orderPOs(data,input.soId).find(p=>p.id===input.poId);
 if(data.snapshotId!==input.snapshot||!so||!PILOT_NUMBERS.includes(so.number)||so.fy!=='2026-27'||!po)throw Error('Reload selected pilot SO');
 const db=new DatabaseSync(existingPath(root),{readOnly:true});let row:any;
 try{row=db.prepare("SELECT v.organization_id,v.raw_payload FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) JOIN source_documents s USING(organization_id,document_id) WHERE s.document_type='PO' AND s.remote_id=?").get(po.id);}finally{db.close();}
 const vendor=JSON.parse(String(row.raw_payload)).purchaseorder.vendor_id;if(typeof vendor!=='string'||!/^\d{1,40}$/.test(vendor))throw Error('PO vendor unavailable');
 const store=openPilotStore(root),run=store.start(String(row.organization_id)),started=now(),candidates:BillCandidate[]=[],seen=new Set<string>(),linked=new Set(orderPOs(data,so.id).flatMap(p=>p.billIds));let pages=0,complete=false,issue='';
 try{
  try{for(let page=1;page<=5;page++){
   if(now()-started>=60000)throw Error('Time limit reached');
   const endpoint=`/books/v3/bills?vendor_id=${vendor}&page=${page}&per_page=200`,response=await get(String(row.organization_id),endpoint);pages++;
   if(readPilotView(root).snapshotId!==input.snapshot)throw Error('Source changed; reload before reviewing results');
   store.capture(run,endpoint,response.raw);const body=JSON.parse(response.raw);
   if(body.code!==0||!Array.isArray(body.bills)||Number(body.page_context?.page)!==page||typeof body.page_context?.has_more_page!=='boolean')throw Error('Incomplete vendor list');
   if(body.bills.some((b:any)=>b.vendor_id!==vendor||typeof b.bill_id!=='string'||!/^\d{1,40}$/.test(b.bill_id)))throw Error('Vendor filter could not be verified');
   let fresh=0;
   for(const b of body.bills){if(seen.has(b.bill_id))continue;seen.add(b.bill_id);fresh++;
    if(typeof b.date!=='string'||b.date<'2026-04-01'||b.date>'2027-03-31'||linked.has(b.bill_id))continue;
    candidates.push({id:b.bill_id,number:String(b.bill_number??b.bill_id),date:b.date,vendor:String(b.vendor_name??vendor),reference:String(b.reference_number??''),status:String(b.status??'Unknown'),linkedElsewhere:data.documents.some(d=>d.type==='PO'&&d.billIds.includes(b.bill_id))});
   }
   if(!body.page_context.has_more_page){complete=true;break;}if(!fresh)throw Error('Vendor list stopped advancing');
  }}catch(e){issue=e instanceof Error?e.message:'Search stopped';}
  if(!complete&&!issue)issue='Page limit reached; more vendor Bills may exist';
  store.event(run,'WEB_UNLINKED_BILL_SEARCH',{soId:so.id,poId:po.id,pages,complete,candidates:candidates.length,issue});
  return {soId:so.id,poId:po.id,snapshot:input.snapshot,candidates,pages,complete,issue,coverage:'INCOMPLETE',at:new Date().toISOString()};
 }finally{store.close();}
 }finally{active.delete(root);}
}
