import type {PilotDocument} from './view-model.ts';
export function directInvoice(r:PilotDocument,d:PilotDocument){return d.type==='INVOICE'&&(r.invoiceIds.includes(d.id)||d.salesOrderIds.includes(r.id));}
export function invoiceReferences(r:PilotDocument|undefined,documents:readonly PilotDocument[]){
 if(!r)return [];
 const roots=documents.filter(d=>d.type==='SO');
 return documents.filter(d=>d.type==='INVOICE'&&(directInvoice(r,d)||(!d.salesOrderIds.length&&!roots.some(other=>other.invoiceIds.includes(d.id))&&!!r.customerId&&r.customerId===d.customerId&&!!r.referenceNumber&&r.referenceNumber===d.referenceNumber)));
}
