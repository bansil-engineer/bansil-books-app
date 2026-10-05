/** Owner-approved observed-PO estimate. Never represents actual invoiced gross margin. */
import {parseDecimal,formatDecimal,addDecimal,subtractDecimal,multiplyDecimal,divideDecimal} from '../decimal.ts';
import type {PilotDocument} from './view-model.ts';
export function estimatedSOMargin(so:PilotDocument,documents:readonly PilotDocument[]){
 const fail=(reason:string)=>({status:'UNAVAILABLE' as const,reason,sales:null,cost:null,profit:null,percent:null,currency:so.currency});
 const pos=documents.filter(d=>d.type==='PO'&&d.owners.length===1&&d.owners[0]===so.number);
 const ambiguous=documents.some(d=>d.type==='PO'&&!(d.owners.length===1&&d.owners[0]===so.number)&&d.owners.some(v=>(v.match(/SO-\d+/g)??[]).some(ref=>ref===so.number)));
 if(ambiguous)return fail('Shared or ambiguous PO ownership needs allocation');
 if(!pos.length)return fail('No linked PO captured');
 if(!so.currency||pos.some(p=>p.currency!==so.currency))return fail('Currency is missing or differs');
 if(so.priceTaxBasis!=='EXCLUSIVE'||pos.some(p=>p.priceTaxBasis!=='EXCLUSIVE'))return fail('Tax-exclusive basis is not confirmed');
 if(so.salesSubtotal===null||pos.some(p=>p.purchaseSubtotal===null))return fail('Source subtotal is missing');
 try{const sales=parseDecimal(so.salesSubtotal);if(sales.coefficient<=BigInt(0))return fail('SO source subtotal must be positive');let cost=parseDecimal('0');for(const p of pos){const n=parseDecimal(p.purchaseSubtotal!);if(n.coefficient<BigInt(0))return fail('Negative purchase subtotal needs review');cost=addDecimal(cost,n);}const profit=subtractDecimal(sales,cost),percent=divideDecimal(multiplyDecimal(profit,parseDecimal('100')),sales,2,'HALF_AWAY_FROM_ZERO');return {status:'ESTIMATED' as const,reason:'Observed PO subtotals only; purchase coverage is incomplete',sales:formatDecimal(sales),cost:formatDecimal(cost),profit:formatDecimal(profit),percent:formatDecimal(percent),currency:so.currency};}catch{return fail('Source subtotal is invalid');}
}
