import test from 'node:test';import assert from 'node:assert/strict';
import {buildCommercialGraph,traceSalesOrder} from '../commercial/linkage.ts';
import type {CommercialType,TraceDocument,LinkEvidence,Endpoint} from '../commercial/linkage.ts';
const scope={organizationId:'A',fyId:'2025-26',snapshotId:'s1'};
const doc=(documentType:CommercialType,remoteId:string):TraceDocument=>({...scope,documentType,remoteId,versionId:'v1',documentDate:'2025-05-01',lineIds:['l1']});
const so=doc('SO','so1'),po=doc('PO','po1'),bill=doc('BILL','b1'),invoice=doc('INVOICE','i1');
const end=(d:TraceDocument,lineId:string|null='l1'):Endpoint=>({documentType:d.documentType,remoteId:d.remoteId,versionId:d.versionId,lineId});
const link=(id:string,from:TraceDocument,to:TraceDocument):LinkEvidence=>({...scope,id,from:end(from),to:end(to),source:end(to),sourceField:'explicit_source_line_id',evidenceReference:'fixture://'+id});
test('explicit SO-PO-Bill and SO-Invoice references retain version evidence without financial claims',()=>{
 const graph=buildCommercialGraph(scope,[so,po,bill,invoice],[link('a',so,po),link('b',po,bill),link('c',so,invoice)]);
 const trace=traceSalesOrder(graph,'so1');assert.equal(trace.documents.length,4);assert.equal(trace.links.length,3);
 assert.equal(trace.evidenceStatus,'REFERENCES_AVAILABLE');assert.equal(trace.marginStatus,'NOT_EVALUATED');assert.equal(trace.allocationStatus,'NOT_EVALUATED');
 assert.equal(trace.links[0].evidence.source.versionId,'v1');
});
test('missing document, stale version or absent line stays incomplete',()=>{
 for(const patch of [{remoteId:'absent'},{versionId:'v2'},{lineId:'absent'}]){
  const e=link('a',so,po);e.to={...e.to,...patch};const graph=buildCommercialGraph(scope,[so,po],[e]);
  assert.equal(graph.links[0].status,'INCOMPLETE');assert.equal(traceSalesOrder(graph,'so1').documents.length,1);
 }
});
test('scope and ambiguous snapshot versions fail closed',()=>{
 for(const patch of [{organizationId:'B'},{snapshotId:'s2'}]){
  assert.throws(()=>buildCommercialGraph(scope,[so,{...po,...patch}],[]),/SCOPE/);
  assert.throws(()=>buildCommercialGraph(scope,[so,po],[{...link('a',so,po),...patch}]),/SCOPE/);
 }
 assert.throws(()=>buildCommercialGraph(scope,[so,{...so,versionId:'v2'}],[]),/AMBIGUOUS/);
});
test('duplicate relationships or unsupported direction cannot multiply graph edges',()=>{
 assert.throws(()=>buildCommercialGraph(scope,[so,po],[link('a',so,po),link('b',so,po)]),/DUPLICATE_RELATIONSHIP/);
 assert.throws(()=>buildCommercialGraph(scope,[so,po],[link('a',po,so)]),/UNSUPPORTED/);
});
test('document-only evidence is distinct from line evidence; partial lines are incomplete',()=>{
 const e=link('a',so,po);e.from.lineId=null;e.to.lineId=null;
 assert.equal(buildCommercialGraph(scope,[so,po],[e]).links[0].level,'DOCUMENT');
 e.to.lineId='l1';assert.ok(buildCommercialGraph(scope,[so,po],[e]).links[0].reasons.includes('PARTIAL_LINE_REFERENCE'));
});
test('unrelated evidence source or blank evidence cannot support linkage',()=>{
 for(const e of [{...link('a',so,po),source:end(invoice)},{...link('a',so,po),evidenceReference:''}])
  assert.equal(buildCommercialGraph(scope,[so,po,invoice],[e]).links[0].status,'INCOMPLETE');
});
test('shared PO never traverses backwards to another SO or allocates its invoice',()=>{
 const so2=doc('SO','so2');const graph=buildCommercialGraph(scope,[so,so2,po,bill,invoice],[link('a',so,po),link('b',so2,po),link('c',po,bill),link('d',so2,invoice)]);
 assert.deepEqual(traceSalesOrder(graph,'so1').documents.map(d=>d.remoteId),['so1','po1','b1']);
});
test('absent references stay incomplete, not zero pending or verified complete',()=>{
 const graph=buildCommercialGraph(scope,[so,po],[]);const trace=traceSalesOrder(graph,'so1');
 assert.equal(trace.evidenceStatus,'INCOMPLETE');assert.equal(trace.fulfilmentStatus,'NOT_EVALUATED');assert.equal(trace.documents.length,1);
});

test('historical and future linked FY evidence retains actual dates while root stays in pilot FY',()=>{
 const historical={...po,fyId:'2022-23',documentDate:'2023-03-31'};
 const future={...bill,fyId:'2026-27',documentDate:'2026-04-01'};
 const g=buildCommercialGraph(scope,[so,historical,future],[link('a',so,historical),link('b',historical,future)]);
 assert.deepEqual(traceSalesOrder(g,'so1').documents.map(d=>d.fyId),['2025-26','2022-23','2026-27']);
 assert.throws(()=>buildCommercialGraph(scope,[{...historical,documentDate:'2023-04-01'}],[]),/FY_DATE/);
 assert.throws(()=>buildCommercialGraph(scope,[{...historical,documentDate:'2023-02-29'}],[]),/FY_DATE/);
 assert.throws(()=>buildCommercialGraph(scope,[{...historical,fyId:'2022-24'}],[]),/FY_DATE/);
 const otherRoot={...so,fyId:'2022-23',documentDate:'2022-05-01'};
 assert.throws(()=>traceSalesOrder(buildCommercialGraph(scope,[otherRoot],[]),'so1'),/ROOT_FY/);
});
