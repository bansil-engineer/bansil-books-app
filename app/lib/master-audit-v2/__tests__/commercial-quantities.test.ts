import test from 'node:test';import assert from 'node:assert/strict';
import {buildCommercialGraph} from '../commercial/linkage.ts';import type {TraceDocument,LinkEvidence,Endpoint} from '../commercial/linkage.ts';
import {evaluatePendingQuantity as evaluateLedger,purchaseOrderOwnership} from '../commercial/quantities.ts';import type {QuantityFact,Coverage} from '../commercial/quantities.ts';
const evaluatePendingQuantity=(g:Parameters<typeof evaluateLedger>[0],c:Coverage,f:readonly QuantityFact[],a:Parameters<typeof evaluateLedger>[3]['allocations'])=>evaluateLedger(g,c,f,{...g.scope,targetType:c.targetType,complete:true,evidenceReference:'fixture:whole-snapshot',allocations:a});
const scope={organizationId:'A',fyId:'2025-26',snapshotId:'s1'};
const so:TraceDocument={...scope,documentType:'SO',remoteId:'so1',versionId:'v1',documentDate:'2025-05-01',lineIds:['l']};
const p1:TraceDocument={...so,documentType:'PO',remoteId:'p1'},p2={...p1,remoteId:'p2'};
const endpoint=(d:TraceDocument):Endpoint=>({documentType:d.documentType,remoteId:d.remoteId,versionId:d.versionId,lineId:'l'});
const link=(id:string,to:TraceDocument,from=so):LinkEvidence=>({...scope,id,from:endpoint(from),to:endpoint(to),source:endpoint(to),sourceField:'so_line_id',evidenceReference:'fixture:'+id});
const graph=()=>buildCommercialGraph(scope,[so,p1,p2],[link('a',p1),link('b',p2)]);
const fact=(d:TraceDocument,quantity:string|null,unit='Nos'):QuantityFact=>({...scope,fyId:d.fyId,endpoint:endpoint(d),quantity,unit,evidenceReference:'fixture:quantity'});
const coverage:Coverage={...scope,parent:endpoint(so),targetType:'PO',complete:true,evidenceReference:'fixture:complete-list'};
const allocations=[{linkId:'a',quantity:'3.10',evidenceReference:'fixture:allocation-a'},{linkId:'b',quantity:'2.20',evidenceReference:'fixture:allocation-b'}];
const facts=()=>[fact(so,'10.00'),fact(p1,'3.10'),fact(p2,'2.20')];
test('multiple POs allocate to one SO with exact decimal pending',()=>{
 const result=evaluatePendingQuantity(graph(),coverage,facts(),allocations);
 assert.equal(result.status,'CALCULATED');assert.equal(result.allocated,'5.30');assert.equal(result.pending,'4.70');
 assert.equal(purchaseOrderOwnership(graph(),'p1').soId,'so1');
});
test('shared PO blocks automatic ownership and allocation',()=>{
 const so2={...so,remoteId:'so2'};const g=buildCommercialGraph(scope,[so,so2,p1,p2],[link('a',p1),link('b',p2),link('c',p1,so2)]);
 assert.equal(purchaseOrderOwnership(g,'p1').status,'REVIEW_REQUIRED');
 assert.equal(evaluatePendingQuantity(g,coverage,facts(),allocations).status,'INCOMPLETE');
});
test('missing quantities, allocation, UOM proof or coverage never become zero',()=>{
 for(const values of [[fact(so,null),fact(p1,'3.10'),fact(p2,'2.20')],[fact(so,'10'),fact(p1,'3.10','Box'),fact(p2,'2.20')]])
  assert.equal(evaluatePendingQuantity(graph(),coverage,values,allocations).pending,null);
 assert.equal(evaluatePendingQuantity(graph(),coverage,facts(),[]).reason,'EXPLICIT_ALLOCATION_MISSING');
 assert.equal(evaluatePendingQuantity(graph(),{...coverage,complete:false},facts(),allocations).pending,null);
});
test('explicitly complete empty relation means full pending, absent coverage does not',()=>{
 const g=buildCommercialGraph(scope,[so],[]);
 assert.equal(evaluatePendingQuantity(g,coverage,[fact(so,'10.00')],[]).pending,'10.00');
 assert.equal(evaluatePendingQuantity(g,{...coverage,evidenceReference:''},[fact(so,'10.00')],[]).pending,null);
});
test('overordered parent reports excess, child over-allocation rejected',()=>{
 const result=evaluatePendingQuantity(graph(),coverage,[fact(so,'4.00'),fact(p1,'3.10'),fact(p2,'2.20')],allocations);
 assert.equal(result.status,'REVIEW_REQUIRED');assert.equal(result.pending,'0.00');assert.equal(result.overAllocated,'1.30');
 assert.equal(evaluatePendingQuantity(graph(),coverage,[fact(so,'10'),fact(p1,'1'),fact(p2,'2.20')],allocations).reason,'CHILD_QUANTITY_OVERALLOCATED');
});
test('scope, duplicate allocations and negative quantities fail closed',()=>{
 assert.throws(()=>evaluatePendingQuantity(graph(),{...coverage,fyId:'2026-27'},facts(),allocations),/SCOPE/);
 assert.throws(()=>evaluatePendingQuantity(graph(),coverage,facts(),[...allocations,allocations[0]]),/DUPLICATE_ALLOCATION/);
 assert.throws(()=>evaluatePendingQuantity(graph(),coverage,[fact(so,'-1'),fact(p1,'3.10'),fact(p2,'2.20')],allocations),/NEGATIVE/);
});
test('document-only references cannot support line quantity allocation',()=>{
 const e=link('a',p1);e.from.lineId=null;e.to.lineId=null;
 const g=buildCommercialGraph(scope,[so,p1],[e]);
 assert.equal(evaluatePendingQuantity(g,coverage,[fact(so,'10'),fact(p1,'3.10')],[]).reason,'LINE_LINK_EVIDENCE_INCOMPLETE');
});

test('invoice pending and bill pending use their own parent quantities',()=>{
 const invoice:TraceDocument={...so,documentType:'INVOICE',remoteId:'i1'};
 const bill:TraceDocument={...so,documentType:'BILL',remoteId:'b1'};
 const g=buildCommercialGraph(scope,[so,p1,invoice,bill],[link('owner',p1),link('inv',invoice),link('bill',bill,p1)]);
 const inv=evaluatePendingQuantity(g,{...coverage,targetType:'INVOICE'},[fact(so,'10'),fact(invoice,'6')],[{linkId:'inv',quantity:'6',evidenceReference:'fixture:inv'}]);
 assert.equal(inv.pending,'4');
 const b=evaluatePendingQuantity(g,{...coverage,parent:endpoint(p1),targetType:'BILL'},[fact(p1,'8'),fact(bill,'3')],[{linkId:'bill',quantity:'3',evidenceReference:'fixture:bill'}]);
 assert.equal(b.pending,'5');
 const orphan=buildCommercialGraph(scope,[p1],[]);
 assert.equal(evaluatePendingQuantity(orphan,{...coverage,parent:endpoint(p1),targetType:'BILL'},[fact(p1,'8')],[]).reason,'PO_OWNERSHIP_UNPROVEN');
});

test('separate SO projections cannot hide competing allocations to the same invoice line',()=>{
 const so2={...so,remoteId:'so2'};
 const invoice:TraceDocument={...so,documentType:'INVOICE',remoteId:'shared'};
 const g=buildCommercialGraph(scope,[so,so2,invoice],[link('x',invoice),link('y',invoice,so2)]);
 const f=[fact(so,'10'),fact(so2,'10'),fact(invoice,'10')];
 const x={linkId:'x',quantity:'6',evidenceReference:'fixture:x'},y={...x,linkId:'y'};
 const c={...coverage,targetType:'INVOICE' as const};
 assert.equal(evaluatePendingQuantity(g,c,f,[x]).pending,null);
 assert.equal(evaluatePendingQuantity(g,{...c,parent:endpoint(so2)},f,[y]).pending,null);
 assert.equal(evaluatePendingQuantity(g,c,f,[x,y]).reason,'CHILD_QUANTITY_OVERALLOCATED');
 const valid=[x,{...y,quantity:'4'}];
 assert.equal(evaluatePendingQuantity(g,c,f,valid).pending,'4');
 assert.equal(evaluatePendingQuantity(g,{...c,parent:endpoint(so2)},f,valid).pending,'6');
 for(const patch of [{complete:false},{evidenceReference:''},{targetType:'PO' as const}])
  assert.equal(evaluateLedger(g,c,f,{...scope,targetType:'INVOICE',complete:true,evidenceReference:'fixture:all',allocations:valid,...patch}).reason,'SNAPSHOT_ALLOCATION_COVERAGE_UNPROVEN');
 assert.throws(()=>evaluateLedger(g,c,f,{...scope,snapshotId:'stale',targetType:'INVOICE',complete:true,evidenceReference:'fixture:all',allocations:valid}),/SCOPE/);
});
test('cross FY quantity facts follow their document FY, never the reporting FY',()=>{
 const historical={...p1,fyId:'2022-23',documentDate:'2023-03-31'};
 const g=buildCommercialGraph(scope,[so,historical],[link('a',historical)]);
 const f=[fact(so,'10'),fact(historical,'3.10')];
 assert.equal(evaluatePendingQuantity(g,coverage,f,[allocations[0]]).pending,'6.90');
 assert.throws(()=>evaluatePendingQuantity(g,coverage,[f[0],{...f[1],fyId:scope.fyId}],[allocations[0]]),/DOCUMENT_FY/);
});
