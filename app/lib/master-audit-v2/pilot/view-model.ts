/** Read-only local projection; importing this module does not open any database. */
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {getAuditWorkspaceDbPath, getMasterAuditV2DbPath} from '../../db/db-resolver';
import {createHash} from 'node:crypto';
import {parseDecimal,formatDecimal} from '../decimal.ts';
function sourceMoney(value:unknown):string|null{try{return typeof value==='string'?formatDecimal(parseDecimal(value)):null;}catch{return null;}}
function parseSource(text:string){return (JSON.parse as (s:string,r:(k:string,v:unknown,c?:{source?:string})=>unknown)=>any)(text,(_k,v,c)=>typeof v==='number'?(c?.source??null):v);}
export interface PilotLine {salesRate:string|null;salesAmount:string|null;purchaseRate:string|null;purchaseAmount:string|null;id:string;name:string;unit:string|null;quantity:string|null;parentLineId:string|null;parentDocumentId:string|null;referenceStatus:'MATCHED'|'UNRESOLVED'|'ABSENT'}
export interface PilotDocument {customerId:string|null;referenceNumber:string|null;invoiceIds:string[];salesOrderIds:string[];salesSubtotal:string|null;salesTax:string|null;salesTotal:string|null;currency:string|null;purchaseSubtotal:string|null;purchaseTax:string|null;purchaseTotal:string|null;priceTaxBasis:'EXCLUSIVE'|'INCLUSIVE'|'UNKNOWN';key:string;type:string;id:string;number:string;date:string;fy:string;version:string;observedAt:string;sha256:string;owners:string[];billIds:string[];lines:PilotLine[]}
export interface PilotView {snapshotId:string;documents:PilotDocument[];responseCount:number;coverage:'INCOMPLETE'}
/** Reuses existing owner sessions without cleanup, last_seen updates, migrations or token writes. */
export function hasReadOnlyOwnerSession(root:string,token:string|undefined,now=new Date().toISOString()){
 if(!token||token.length>256)return false;
 let db:DatabaseSync|undefined;
 try{db=new DatabaseSync(getAuditWorkspaceDbPath(),{readOnly:true});return !!db.prepare('SELECT 1 FROM audit_sessions WHERE session_token=? AND expires_at>=?').get(token,now);}catch{return false;}finally{db?.close();}
}
export function readPilotView(root:string):PilotView{
 const db=new DatabaseSync(getMasterAuditV2DbPath(),{readOnly:true});
 try{
  db.exec('BEGIN');
  const rows=db.prepare('SELECT s.document_type,s.remote_id,v.* FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) JOIN source_documents s USING(organization_id,document_id) ORDER BY s.document_type,s.remote_id').all();
  if(new Set(rows.map(r=>r.organization_id)).size!==1)throw Error('PILOT_ORGANIZATION_AMBIGUOUS');
  const documents:PilotDocument[]=[];
  const names:Record<string,string>={SO:'salesorder',PO:'purchaseorder',BILL:'bill',INVOICE:'invoice'};
  for(const row of rows){
   const type=String(row.document_type),singular=names[type];if(!singular)continue;
   const raw=parseSource(String(row.raw_payload))[singular];
   const facts=db.prepare('SELECT line_id,quantity,unit FROM document_version_lines WHERE organization_id=? AND document_id=? AND version_id=?').all(row.organization_id,row.document_id,row.version_id);
   const lines:PilotLine[]=facts.map(f=>{const l=raw.line_items.find((v:{line_item_id:string})=>v.line_item_id===f.line_id);return {salesRate:type==='INVOICE'?sourceMoney(l?.rate):null,salesAmount:type==='INVOICE'?sourceMoney(l?.item_total):null,purchaseRate:type==='PO'||type==='BILL'?sourceMoney(l?.rate):null,purchaseAmount:type==='PO'||type==='BILL'?sourceMoney(l?.item_total):null,id:String(f.line_id),name:typeof l?.name==='string'?l.name:'Unnamed line',unit:typeof f.unit==='string'?f.unit:null,quantity:typeof f.quantity==='string'?f.quantity:null,parentLineId:type==='BILL'?(l?.purchaseorder_item_id||null):type==='PO'?(l?.salesorder_item_id||null):null,parentDocumentId:type==='BILL'?(l?.purchaseorder_id||null):null,referenceStatus:'ABSENT'};});
   const values=(raw.custom_fields??[]).filter((f:{label?:string})=>/^Sales Order No$/i.test(f.label??'')).map((f:{value?:unknown})=>typeof f.value==='string'?f.value.trim():'');
   const purchase=type==='PO'||type==='BILL';
   documents.push({customerId:typeof raw.customer_id==='string'?raw.customer_id:null,referenceNumber:typeof raw.reference_number==='string'?raw.reference_number.trim():null,invoiceIds:Array.isArray(raw.invoices)?[...new Set<string>(raw.invoices.map((v:{invoice_id?:unknown})=>v.invoice_id).filter((v:unknown):v is string=>typeof v==='string'&&/^\d+$/.test(v)))]:[],salesOrderIds:type==='INVOICE'?[...new Set<string>([raw.salesorder_id,...(Array.isArray(raw.salesorders)?raw.salesorders:raw.salesorders?[raw.salesorders]:[]).map((v:{salesorder_id?:unknown})=>v.salesorder_id)].filter((v:unknown):v is string=>typeof v==='string'&&/^\d+$/.test(v)))]:[],salesSubtotal:type==='INVOICE'||type==='SO'?sourceMoney(raw.sub_total):null,salesTax:type==='INVOICE'?sourceMoney(raw.tax_total):null,salesTotal:type==='INVOICE'?sourceMoney(raw.total):null,currency:typeof raw.currency_code==='string'?raw.currency_code:null,purchaseSubtotal:purchase?sourceMoney(raw.sub_total):null,purchaseTax:purchase?sourceMoney(raw.tax_total):null,purchaseTotal:purchase?sourceMoney(raw.total):null,priceTaxBasis:raw.is_inclusive_tax===false?'EXCLUSIVE':raw.is_inclusive_tax===true?'INCLUSIVE':'UNKNOWN',key:type+':'+row.remote_id,type,id:String(row.remote_id),number:String(raw[singular+'_number']??row.remote_id),date:String(row.document_date),fy:String(row.fy_id),version:String(row.version_id),observedAt:String(row.observed_at),sha256:String(row.payload_sha256),owners:[...new Set<string>(values)],billIds:(raw.bills??[]).map((b:{bill_id:string})=>b.bill_id),lines});
  }
  for(const doc of documents)for(const line of doc.lines){
   if(!line.parentLineId)continue;
   const parentType=doc.type==='BILL'?'PO':'SO';
   const parents=documents.filter(p=>p.type===parentType&&(line.parentDocumentId?p.id===line.parentDocumentId:doc.type==='PO'?doc.owners.length===1&&doc.owners[0]===p.number:p.billIds.includes(doc.id)));
   const matches=parents.filter(p=>p.lines.some(l=>l.id===line.parentLineId));line.referenceStatus=matches.length===1?'MATCHED':'UNRESOLVED';
  }
  const responseCount=Number(db.prepare('SELECT count(*) AS n FROM v2_pilot_responses').get()?.n??0);
  const snapshotId=createHash('sha256').update(JSON.stringify([String(rows[0].organization_id),documents.map(d=>[d.key,d.version,d.sha256])])).digest('hex').slice(0,20);
  db.exec('COMMIT');return {snapshotId,documents,responseCount,coverage:'INCOMPLETE'};
 }finally{db.close();}
}
