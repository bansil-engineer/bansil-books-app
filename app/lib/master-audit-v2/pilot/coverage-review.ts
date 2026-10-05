import {addDecimal,parseDecimal,formatDecimal,subtractDecimal} from '../decimal.ts';
import {orderPOs} from './po-verification.ts';
import type {PilotView} from './view-model.ts';
export type CoverageReview={revision:number;snapshot:string;status:'INTERIM'|'FINAL'|'UNKNOWN'|'ALLOCATED';note:string;at:string;amounts:Record<string,string>};
export type CoverageReviews=Record<string,CoverageReview>;
export type CoverageCommand={soId:string;documentId:string;kind:'BILL'|'PO';snapshot:string;revision:number;status:CoverageReview['status'];note:string;amounts:Record<string,string>};
export function sharedCost(data:PilotView,soId:string,poId:string){
 const po=orderPOs(data,soId).find(p=>p.id===poId);if(!po)throw Error('Review: PO is not linked to this SO.');
 const owners=[...new Set(po.owners.flatMap(s=>s.match(/SO-\d+/g)??[]))].sort();
 if(owners.length<2)throw Error('Review: PO is not shared.');
 const ids=[...new Set(po.billIds)],bills=data.documents.filter(d=>d.type==='BILL'&&ids.includes(d.id));
 if(!ids.length||bills.length!==ids.length)throw Error('Review: All referenced Bills must be saved first.');
 let total=parseDecimal('0');
 for(const bill of bills){
  if(data.documents.some(d=>d.type==='PO'&&d.id!==poId&&d.billIds.includes(bill.id)))throw Error('Review: A Bill also belongs to another PO; line allocation is required.');
  if(!po.currency||bill.currency!==po.currency||bill.priceTaxBasis!=='EXCLUSIVE'||bill.purchaseSubtotal===null)throw Error('Review: GST-exclusive Bill subtotals in one currency are required.');
  const amount=parseDecimal(bill.purchaseSubtotal);if(amount.coefficient<BigInt(0))throw Error('Review: Negative Bills need separate reconciliation.');total=addDecimal(total,amount);
 }
 return {po,owners,bills,total:formatDecimal(total),currency:po.currency};
}
export function validateCoverageCommand(data:PilotView,input:CoverageCommand){
 if(data.snapshotId!==input.snapshot)throw Error('Review: Source changed. Reload and review again.');
 if(!input.note.trim()||input.note.length>1000)throw Error('Review: Add a short evidence or settlement note.');
 const so=data.documents.find(d=>d.type==='SO'&&d.id===input.soId);
 if(!so||!['SO-2627009','SO-2627024','SO-2627065'].includes(so.number)||so.fy!=='2026-27')throw Error('Review: Sales Order is outside the pilot.');
 if(input.kind==='BILL'){
  if(!['INTERIM','FINAL','UNKNOWN'].includes(input.status)||Object.keys(input.amounts).length)throw Error('Review: Invalid Bill status.');
  if(!data.documents.some(d=>d.type==='BILL'&&d.id===input.documentId)||!orderPOs(data,input.soId).some(p=>p.billIds.includes(input.documentId)))throw Error('Review: Bill is not linked to this SO.');
 }else{
  if(input.status!=='ALLOCATED')throw Error('Review: Invalid allocation status.');
  const cost=sharedCost(data,input.soId,input.documentId);
  if(JSON.stringify(Object.keys(input.amounts).sort())!==JSON.stringify(cost.owners))throw Error('Review: Enter an amount for every referenced SO.');
  let sum=parseDecimal('0');for(const amount of Object.values(input.amounts)){const n=parseDecimal(amount);if(n.coefficient<BigInt(0))throw Error('Review: Allocation cannot be negative.');sum=addDecimal(sum,n);}
  if(subtractDecimal(sum,parseDecimal(cost.total)).coefficient!==BigInt(0))throw Error('Review: Allocations must equal the captured Bill subtotal exactly.');
 }
}
