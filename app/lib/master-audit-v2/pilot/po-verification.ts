import {parseDecimal} from '../decimal.ts';
import type {PilotView,PilotDocument} from './view-model.ts';
import type {CoverageReviews} from './coverage-review.ts';
import {defaultSelection,verificationPreview} from './verification-model.ts';
export function orderPOs(data:PilotView,soId:string){
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId);if(!so)throw Error('Sales Order not found');
 return data.documents.filter(d=>d.type==='PO'&&d.owners.some(owner=>owner===so.number||(owner.match(/SO-\d+/g)??[]).some(number=>number===so.number)));
}
export function poProblem(data:PilotView,soId:string,po:PilotDocument,reviews?:CoverageReviews){
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId)!;
 const isExclusive=po.owners.length===1&&po.owners[0]===so.number;
 if(!isExclusive){
  const isLinked=po.owners.some(owner=>owner===so.number||(owner.match(/SO-\d+/g)??[]).some(number=>number===so.number));
  if(!isLinked)return 'PO does not belong to this SO';
  const rev=reviews?.['PO:'+po.id];
  if(!rev||rev.status!=='ALLOCATED'||rev.snapshot!==data.snapshotId||!rev.amounts?.[so.number])return 'Shared PO ownership needs allocation';
 }
 const ids=[...new Set(po.billIds)],bills=data.documents.filter(d=>d.type==='BILL'&&ids.includes(d.id));
 if(bills.length!==ids.length)return 'Linked Bill detail is missing';
 if(!so.currency||po.currency!==so.currency||bills.some(b=>b.currency!==so.currency))return 'Currency is missing or differs';
 if(bills.some(b=>b.priceTaxBasis!=='EXCLUSIVE'))return 'GST-exclusive Bill basis is not confirmed';
 try{for(const bill of bills){if(bill.purchaseSubtotal===null)return 'Source subtotal is missing';if(parseDecimal(bill.purchaseSubtotal).coefficient<BigInt(0))return 'Negative source subtotal needs review';}}catch{return 'Source subtotal is invalid';}
 const allowed=orderPOs(data,soId).filter(p=>{
  if(p.owners.length===1&&p.owners[0]===so.number)return true;
  const rev=reviews?.['PO:'+p.id];
  return rev?.status==='ALLOCATED'&&rev.snapshot===data.snapshotId&&!!rev.amounts?.[so.number];
 });
 if(bills.some(b=>data.documents.some(p=>p.type==='PO'&&p.billIds.includes(b.id)&&!allowed.includes(p))||b.lines.some(l=>l.parentDocumentId&&!allowed.some(p=>p.id===l.parentDocumentId))))return 'A Bill has another or unresolved PO allocation';
 return null;
}
export function poReview(data:PilotView,soId:string,approvedIds:readonly string[],reviews?:CoverageReviews){
 const pos=orderPOs(data,soId),approved=pos.filter(p=>approvedIds.includes(p.id)),all=pos.length>0&&approved.length===pos.length&&pos.every(p=>!poProblem(data,soId,p,reviews));
 const billIds=[...new Set(approved.flatMap(p=>p.billIds))];
 const defaults=defaultSelection(data,soId);
 const selection={poIds:approved.map(p=>p.id),invoiceIds:defaults.invoiceIds,billIds};
 const gp=verificationPreview(data,soId,selection,reviews);
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId)!;
 const reason=!all?'Verify all POs to calculate GP':so.invoiceIds.some(id=>!gp.invoices.some(d=>d.id===id))?'Linked Invoice detail is missing':gp.reason;
 return {pos,approved,all,billIds,selection,gp,reason};
}
