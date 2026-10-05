/** Offline explicit quantity allocation only. No UOM conversion, stock or money inference. */
import {parseDecimal,addDecimal,subtractDecimal,formatDecimal} from '../decimal.ts';
import type {Endpoint,TraceScope,buildCommercialGraph} from './linkage.ts';
type Graph=ReturnType<typeof buildCommercialGraph>;
export interface QuantityFact extends TraceScope {endpoint:Endpoint;unit:string;quantity:string|null;evidenceReference:string}
export interface QuantityAllocation {linkId:string;quantity:string;evidenceReference:string}
/** Complete immutable-input ledger for one target document type across the whole snapshot.
 * Offline evidence assertion only; production must build it from an authoritative snapshot.
 * Calculations are projections, never allocation reservations or incremental writes. */
export interface SnapshotAllocationLedger extends TraceScope {targetType:'PO'|'BILL'|'INVOICE';complete:boolean;evidenceReference:string;allocations:readonly QuantityAllocation[]}
export interface Coverage extends TraceScope {parent:Endpoint;targetType:'PO'|'BILL'|'INVOICE';complete:boolean;evidenceReference:string}
const key=(p:Endpoint)=>JSON.stringify([p.documentType,p.remoteId,p.versionId,p.lineId]);
const docKey=(p:Endpoint)=>JSON.stringify([p.documentType,p.remoteId]);
const nonempty=(v:string)=>typeof v==='string'&&v.trim().length>0;
/** Includes conflicting incomplete references: ambiguity must not authorize full PO allocation. */
export function purchaseOrderOwnership(graph:Graph,poId:string){
 const links=graph.links.filter(l=>l.evidence.from.documentType==='SO'&&l.evidence.to.documentType==='PO'&&l.evidence.to.remoteId===poId);
 const owners=[...new Set(links.map(l=>l.evidence.from.remoteId))];
 if(owners.length>1)return {status:'REVIEW_REQUIRED' as const,soId:null,reason:'PO_HAS_MULTIPLE_SO_REFERENCES'};
 if(owners.length!==1||links.some(l=>l.status!=='SUPPORTED_REFERENCE'))return {status:'INCOMPLETE' as const,soId:null,reason:'PO_OWNERSHIP_UNPROVEN'};
 return {status:'EXPLICIT_OWNER' as const,soId:owners[0],reason:'EXPLICIT_SO_PO_REFERENCE'};
}
export function evaluatePendingQuantity(graph:Graph,coverage:Coverage,facts:readonly QuantityFact[],ledger:SnapshotAllocationLedger){
 const fail=(reason:string)=>({status:'INCOMPLETE' as const,allocated:null,pending:null,overAllocated:null,reason});
 for(const value of [coverage,ledger])for(const field of ['organizationId','fyId','snapshotId'] as const)
  if(value[field]!==graph.scope[field])throw new Error('QUANTITY_SCOPE_MISMATCH');
 for(const fact of facts)if(fact.organizationId!==graph.scope.organizationId||fact.snapshotId!==graph.scope.snapshotId)throw new Error('QUANTITY_SCOPE_MISMATCH');
 if(!ledger.complete||!nonempty(ledger.evidenceReference)||ledger.targetType!==coverage.targetType)return fail('SNAPSHOT_ALLOCATION_COVERAGE_UNPROVEN');
 const allocations=ledger.allocations;
 if(!coverage.complete||!nonempty(coverage.evidenceReference))return fail('RELATION_COVERAGE_UNPROVEN');
 if(!['SO:PO','SO:INVOICE','PO:BILL'].includes(`${coverage.parent.documentType}:${coverage.targetType}`))throw new Error('UNSUPPORTED_QUANTITY_RELATION');
 const map=new Map<string,QuantityFact>();
 for(const fact of facts){
  const id=key(fact.endpoint);if(map.has(id))throw new Error('DUPLICATE_QUANTITY_FACT');
  const doc=graph.documents.find(d=>d.documentType===fact.endpoint.documentType&&d.remoteId===fact.endpoint.remoteId&&d.versionId===fact.endpoint.versionId);
  if(!doc||fact.endpoint.lineId===null||!doc.lineIds.includes(fact.endpoint.lineId))throw new Error('QUANTITY_ENDPOINT_NOT_IN_SNAPSHOT');
  if(fact.fyId!==doc.fyId)throw new Error('QUANTITY_DOCUMENT_FY_MISMATCH');
  map.set(id,fact);
 }
 const parent=map.get(key(coverage.parent));
 if(!parent||parent.quantity===null||!nonempty(parent.unit)||!nonempty(parent.evidenceReference))return fail('PARENT_QUANTITY_MISSING');
 const parsePositive=(v:string)=>{const n=parseDecimal(v);if(n.coefficient<BigInt(0))throw new Error('NEGATIVE_QUANTITY_UNSUPPORTED');return n;};
 const ordered=parsePositive(parent.quantity);
 if(coverage.parent.documentType==='PO'&&purchaseOrderOwnership(graph,coverage.parent.remoteId).status!=='EXPLICIT_OWNER')return fail('PO_OWNERSHIP_UNPROVEN');
 // A document-only edge cannot establish how much belongs to this parent line.
 const relevant=graph.links.filter(l=>docKey(l.evidence.from)===docKey(coverage.parent)&&l.evidence.to.documentType===coverage.targetType&&(l.evidence.from.lineId===coverage.parent.lineId||l.evidence.from.lineId===null));
 if(relevant.some(l=>l.status!=='SUPPORTED_REFERENCE'||l.level!=='LINE'))return fail('LINE_LINK_EVIDENCE_INCOMPLETE');
 const byLink=new Map<string,QuantityAllocation>();
 const targetTotals=new Map<string,ReturnType<typeof parseDecimal>>();
 for(const allocation of allocations){
  if(byLink.has(allocation.linkId))throw new Error('DUPLICATE_ALLOCATION');
  const link=graph.links.find(l=>l.evidence.id===allocation.linkId);
  if(!link||link.evidence.to.documentType!==ledger.targetType||link.status!=='SUPPORTED_REFERENCE'||link.level!=='LINE')return fail('ALLOCATION_LINK_UNPROVEN');
  const a=map.get(key(link.evidence.from)),b=map.get(key(link.evidence.to));
  if(!a||!b||a.quantity===null||b.quantity===null||!nonempty(a.evidenceReference)||!nonempty(b.evidenceReference)||!nonempty(allocation.evidenceReference))return fail('ALLOCATION_QUANTITY_MISSING');
  if(!nonempty(a.unit)||a.unit!==b.unit)return fail('UOM_MISMATCH');
  const quantity=parsePositive(allocation.quantity),capacity=parsePositive(b.quantity);parsePositive(a.quantity);
  const target=key(link.evidence.to),total=addDecimal(targetTotals.get(target)??parseDecimal('0'),quantity);targetTotals.set(target,total);
  if(subtractDecimal(total,capacity).coefficient>BigInt(0))return fail('CHILD_QUANTITY_OVERALLOCATED');
  byLink.set(allocation.linkId,allocation);
 }
 // Every competing parent in this target-type snapshot must be represented, even at zero.
 for(const link of graph.links.filter(l=>l.evidence.to.documentType===ledger.targetType)){
  if(link.status!=='SUPPORTED_REFERENCE'||link.level!=='LINE')return fail('SNAPSHOT_LINE_EVIDENCE_INCOMPLETE');
  if(!byLink.has(link.evidence.id))return fail('EXPLICIT_ALLOCATION_MISSING');
 }
 let total=parseDecimal('0');
 for(const link of relevant){
  const po=link.evidence.to.documentType==='PO'?link.evidence.to:link.evidence.from.documentType==='PO'?link.evidence.from:null;
  if(po&&purchaseOrderOwnership(graph,po.remoteId).status!=='EXPLICIT_OWNER')return fail('PO_OWNERSHIP_UNPROVEN');
  const allocation=byLink.get(link.evidence.id);if(!allocation)return fail('EXPLICIT_ALLOCATION_MISSING');
  total=addDecimal(total,parsePositive(allocation.quantity));
 }
 const remainder=subtractDecimal(ordered,total),over=remainder.coefficient<BigInt(0);
 return {status:over?'REVIEW_REQUIRED' as const:'CALCULATED' as const,allocated:formatDecimal(total),
  pending:formatDecimal(over?{coefficient:BigInt(0),scale:remainder.scale}:remainder),
  overAllocated:formatDecimal(over?{coefficient:-remainder.coefficient,scale:remainder.scale}:{coefficient:BigInt(0),scale:remainder.scale}),reason:over?'PARENT_QUANTITY_EXCEEDED':'EXPLICIT_QUANTITY_EVIDENCE'};
}
