/** Deterministic saved-evidence checks. This never asserts final project coverage. */
import {parseDecimal,subtractDecimal} from '../decimal.ts';
import {orderPOs} from './po-verification.ts';
import {invoiceReferences} from './invoice-links.ts';
import type {PilotDocument,PilotView} from './view-model.ts';
export interface RateDifference {po:PilotDocument;bill:PilotDocument;poLineId:string;billLineId:string;item:string;poRate:string;billRate:string}
function valid(value:string|null){try{return value!==null&&parseDecimal(value).coefficient>=BigInt(0);}catch{return false;}}
export function purchaseCoverage(data:PilotView,soId:string){
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId);
 if(!so)throw Error('Sales Order not found');
 const pos=orderPOs(data,soId),billIds=[...new Set(pos.flatMap(p=>p.billIds))];
 const bills=data.documents.filter(d=>d.type==='BILL'&&billIds.includes(d.id));
 const missingBillIds=billIds.filter(id=>!bills.some(b=>b.id===id));
 const shared=pos.filter(p=>p.owners.length!==1||p.owners[0]!==so.number);
 const withoutBills=pos.filter(p=>!p.billIds.length);
 const rateDifferences:RateDifference[]=[];
 let uncheckedLines=0;
 for(const bill of bills)for(const line of bill.lines){
  // Only compare an unambiguous native PO line in the same currency, unit and tax basis.
  const candidates=pos.filter(p=>p.billIds.includes(bill.id)&&(!line.parentDocumentId||p.id===line.parentDocumentId))
   .flatMap(po=>po.lines.filter(l=>line.parentLineId&&l.id===line.parentLineId).map(poLine=>({po,poLine})));
  if(candidates.length!==1){uncheckedLines++;continue;}
  const {po,poLine}=candidates[0];
  if(shared.includes(po)||!po.currency||po.currency!==bill.currency||po.priceTaxBasis!=='EXCLUSIVE'||bill.priceTaxBasis!=='EXCLUSIVE'||!poLine.unit||poLine.unit!==line.unit||!valid(poLine.purchaseRate)||!valid(line.purchaseRate)){
   uncheckedLines++;continue;
  }
  if(subtractDecimal(parseDecimal(poLine.purchaseRate!),parseDecimal(line.purchaseRate!)).coefficient!==BigInt(0))rateDifferences.push({po,bill,poLineId:poLine.id,billLineId:line.id,item:line.name,poRate:poLine.purchaseRate!,billRate:line.purchaseRate!});
 }
 return {pos,bills,missingBillIds,withoutBills,shared,rateDifferences,uncheckedLines,complete:false as const};
}
/** Fixed, de-duplicated saved-document queue; never guesses IDs or searches Zoho lists. */
export function coverageRefreshDocuments(data:PilotView,soId:string){
 const so=data.documents.find(d=>d.type==='SO'&&d.id===soId);if(!so)throw Error('Sales Order not found');
 const coverage=purchaseCoverage(data,soId);
 return [...new Map([so,...coverage.pos,...coverage.bills,...invoiceReferences(so,data.documents)].map(d=>[d.key,d])).values()];
}
