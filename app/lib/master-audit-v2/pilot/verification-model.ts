/** Owner-approved whole-document invoice minus Bill comparison, not an automatic COGS audit. */
import type {PilotView,PilotDocument} from './view-model.ts';
import type {CoverageReviews} from './coverage-review.ts';
import {invoiceReferences} from './invoice-links.ts';
import {parseDecimal,formatDecimal,addDecimal,subtractDecimal,multiplyDecimal,divideDecimal} from '../decimal.ts';
export type VerificationSelection={poIds:string[];invoiceIds:string[];billIds:string[]};
export function validSelection(value:unknown):value is VerificationSelection{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).length===3&&Object.keys(v).every(k=>['poIds','invoiceIds','billIds'].includes(k))&&['poIds','invoiceIds','billIds'].every(k=>Array.isArray(v[k])&&v[k].length<=200&&v[k].every(id=>typeof id==='string'&&/^\d{1,40}$/.test(id))&&new Set(v[k]).size===v[k].length);
}
export function defaultSelection(data:PilotView,soId:string):VerificationSelection{
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId);
 const pos=data.documents.filter(d=>d.type==='PO'&&d.owners.length===1&&d.owners[0]===so?.number);
 return {poIds:pos.map(d=>d.id),invoiceIds:invoiceReferences(so,data.documents).map(d=>d.id),billIds:[...new Set(pos.flatMap(d=>d.billIds))]};
}
export function verificationPreview(data:PilotView,soId:string,chosen?:VerificationSelection,reviews?:CoverageReviews){
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId);
 if(!so)throw Error('Sales Order not found');
 const selection=chosen??defaultSelection(data,soId);
 if(!validSelection(selection))throw Error('Invalid document selection');
 const pick=(type:string,ids:string[])=>data.documents.filter(d=>d.type===type&&ids.includes(d.id));
 const pos=pick('PO',selection.poIds),invoices=pick('INVOICE',selection.invoiceIds),bills=pick('BILL',selection.billIds);
 let reason:string|null=null;
 if(pos.length!==selection.poIds.length||invoices.length!==selection.invoiceIds.length||bills.length!==selection.billIds.length)reason='Selected document is missing from this snapshot';
 else if(!invoices.length)reason='No linked Invoice selected';
 else if(!bills.length&&!pos.length)reason='No Purchase Bill or PO selected';
 else if(pos.some(p=>{
  const isExclusive=p.owners.length===1&&p.owners[0]===so.number;
  if(isExclusive)return false;
  const isLinked=p.owners.some(o=>o===so.number||(o.match(/SO-\d+/g)??[]).some(n=>n===so.number));
  if(!isLinked)return true;
  const rev=reviews?.['PO:'+p.id];
  return !rev||rev.status!=='ALLOCATED'||rev.snapshot!==data.snapshotId||!rev.amounts?.[so.number];
 }))reason='Shared PO or another SO ownership needs allocation';
 // Whole Bills cannot be allocated across omitted or conflicting parent POs.
 else if(bills.some(b=>data.documents.some(p=>p.type==='PO'&&p.billIds.includes(b.id)&&!pos.includes(p))||b.lines.some(l=>l.parentDocumentId&&!pos.some(p=>p.id===l.parentDocumentId))))reason='A Bill requires its parent PO selection or has another SO allocation';
 else if(invoices.some(i=>(!!so.customerId&&i.customerId!==so.customerId)||i.salesOrderIds.some(id=>id!==so.id)||data.documents.some(other=>other.type==='SO'&&other.id!==so.id&&invoiceReferences(other,data.documents).some(d=>d.id===i.id))))reason='An Invoice has another customer, SO allocation or ambiguous reference';
 // The legacy all-linked mode remains conservative about missing/shared source evidence.
 if(!chosen&&!reason&&(so.invoiceIds.some(id=>!invoices.some(d=>d.id===id))||data.documents.some(d=>d.type==='PO'&&d.owners.some(o=>(o.match(/SO-\d+/g)??[]).some(n=>n===so.number))&&!pos.includes(d))))reason='Shared PO or missing Invoice needs review';
 const docs=[...invoices,...bills];
 if(!reason&&(!so.currency||docs.some(d=>d.currency!==so.currency)))reason='Currency is missing or differs';
 if(!reason&&docs.some(d=>d.priceTaxBasis!=='EXCLUSIVE'))reason='GST-exclusive source basis is not confirmed';
 let sales:string|null=null,cost:string|null=null,profit:string|null=null,percent:string|null=null,isProvisional=false;
 if(!reason)try{
  const sum=(rows:PilotDocument[],field:'salesSubtotal'|'purchaseSubtotal')=>rows.reduce((total,d)=>{const value=d[field];if(value===null)throw Error('Source subtotal is missing');const n=parseDecimal(value);if(n.coefficient<BigInt(0))throw Error('Negative source subtotal needs review');return addDecimal(total,n);},parseDecimal('0'));
  const s=sum(invoices,'salesSubtotal');
  if(s.coefficient<=BigInt(0))throw Error('Invoice sales must be positive');
  const exclusivePOs=pos.filter(p=>p.owners.length===1&&p.owners[0]===so.number);
  const sharedPOs=pos.filter(p=>!(p.owners.length===1&&p.owners[0]===so.number));
  const sharedPOBillIds=new Set(sharedPOs.flatMap(p=>p.billIds));
  const exclusiveBills=bills.filter(b=>!sharedPOBillIds.has(b.id));
  let c=sum(exclusiveBills,'purchaseSubtotal');
  for(const ep of exclusivePOs){
   const hasSelectedBill = ep.billIds.some(id=>bills.some(b=>b.id===id));
   if(!hasSelectedBill){
    if(ep.billIds.length>0)throw Error('A referenced Bill is missing or was omitted');
    if(ep.priceTaxBasis!=='EXCLUSIVE')throw Error('GST-exclusive source basis is not confirmed for provisional PO');
    if(!so.currency||ep.currency!==so.currency)throw Error('Currency is missing or differs for provisional PO');
    if(ep.purchaseSubtotal===null)throw Error('PO subtotal is missing for provisional calculation');
    const an=parseDecimal(ep.purchaseSubtotal);
    if(an.coefficient<BigInt(0))throw Error('Negative PO subtotal needs review');
    c=addDecimal(c,an);
    isProvisional=true;
   }
  }
  for(const sp of sharedPOs){
   const alloc=reviews?.['PO:'+sp.id]?.amounts?.[so.number];
   if(!alloc)throw Error('Shared PO ownership needs allocation');
   const an=parseDecimal(alloc);
   if(an.coefficient<BigInt(0))throw Error('Negative allocation needs review');
   c=addDecimal(c,an);
  }
  const p=subtractDecimal(s,c);sales=formatDecimal(s);cost=formatDecimal(c);profit=formatDecimal(p);percent=formatDecimal(divideDecimal(multiplyDecimal(p,parseDecimal('100')),s,2,'HALF_AWAY_FROM_ZERO'));
 }catch(e){reason=e instanceof Error?e.message:'Invalid amount';}
 return {soId,fy:so.fy,pos,selection,invoices,bills,reason,sales,cost,profit,percent,currency:so.currency,isProvisional};
}
export type VerificationState={revision:number;status:'INCOMPLETE'|'VERIFIED'|'STALE';percent:string|null;at:string|null;selection?:VerificationSelection;mode?:'PO';gpReason?:string|null;sales?:string|null;cost?:string|null;profit?:string|null;isProvisional?:boolean};
export const emptyVerification:VerificationState={revision:0,status:'INCOMPLETE',percent:null,at:null};
