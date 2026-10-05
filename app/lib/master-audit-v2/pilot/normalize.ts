/** Structural detail validation only: not a financial or relationship-completeness seal. */
import {parseDecimal,formatDecimal} from '../decimal.ts';
import {validatePilotDocumentDate} from './validation.ts';
export const LIVE_DETAIL_RULE='zoho-pilot-detail-structure-v1';
const types={salesorders:['salesorder','SO'],purchaseorders:['purchaseorder','PO'],invoices:['invoice','INVOICE'],bills:['bill','BILL']} as const;
export function normalizePilotDetail(endpoint:string,raw:string){
 const match=/^\/books\/v3\/(salesorders|purchaseorders|invoices|bills)\/(\d+)$/.exec(endpoint);if(!match)return null;
 // Preserve original numeric lexemes, including quantities larger than Number.MAX_SAFE_INTEGER.
 const parse=JSON.parse as (text:string,reviver:(key:string,value:unknown,context?:{source?:string})=>unknown)=>Record<string,unknown>;
 const body=parse(raw,(_key,value,context)=>{if(typeof value==='number'){if(!context?.source)throw Error('LOSSLESS_JSON_REQUIRED');return context.source;}return value;});
 const [singular,documentType]=types[match[1] as keyof typeof types];
 const doc=body[singular] as Record<string,unknown>;
 if(body.code!=='0'||!doc||doc[singular+'_id']!==match[2])throw Error('DOCUMENT_IDENTITY_MISMATCH');
 validatePilotDocumentDate(doc.date);const year=Number(doc.date.slice(0,4))-(doc.date.slice(5,7)<'04'?1:0);
 if(!Array.isArray(doc.line_items)||doc.line_items.length===0)throw Error('DETAIL_LINES_MISSING');
 const ids=new Set<string>();
 const lines=doc.line_items.map((input:Record<string,unknown>)=>{
  const id=input.line_item_id;if(typeof id!=='string'||!id.trim()||ids.has(id))throw Error('DETAIL_LINE_ID_INVALID');ids.add(id);
  const q=input.quantity;let quantity:string|null=null,scale:number|null=null;
  if(q!==undefined&&q!==null){if(typeof q!=='string')throw Error('QUANTITY_INVALID');const n=parseDecimal(q);if(n.coefficient<BigInt(0))throw Error('NEGATIVE_QUANTITY_UNSUPPORTED');quantity=formatDecimal(n);scale=n.scale;}
  return {id,itemId:typeof input.item_id==='string'?input.item_id:null,unit:typeof input.unit==='string'?input.unit:null,quantity,scale};
 });
 return {documentType,remoteId:match[2],documentDate:doc.date,fyId:`${year}-${String((year+1)%100).padStart(2,'0')}`,dateFrom:`${year}-04-01`,dateTo:`${year+1}-03-31`,revision:typeof doc.last_modified_time==='string'?doc.last_modified_time:null,lines};
}
