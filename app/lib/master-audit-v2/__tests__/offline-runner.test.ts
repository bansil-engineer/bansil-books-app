import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineRunner } from '../sync/offline-runner.ts';
import type { Observation,Scope } from '../sync/planner.ts';
const scope:Scope={organizationId:'A',fyId:'2025-26',documentType:'SO'};
const time='2026-09-29T00:00:00.000Z';
const row=(remoteId='r1',revision='rev1'):Observation=>({...scope,remoteId,revision});
const raw=(observation:Observation,extra={})=>JSON.stringify({...observation,documentDate:'2026-03-31',expectedLines:0,lines:[],...extra});
function setup(fn:(runner:ReturnType<typeof createOfflineRunner>)=>void){const runner=createOfflineRunner(scope,'2025-04-01','2026-03-31');try{fn(runner);}finally{runner.close();}}
const input=(observations:Observation[],details:Map<string,string>,simulateCompleteRevisionCoverage=false)=>({observations,details,observedAt:time,listingComplete:true,simulateCompleteRevisionCoverage});
test('NEW publishes, synthetic UNCHANGED does not read details or append versions',()=>setup(r=>{
 const observation=row();assert.equal(r.run(input([observation],new Map([['r1',raw(observation)]]))).outcomes[0].classification,'NEW');
 const before=r.inspect('r1');
 const result=r.run(input([observation],new Map(),true));
 assert.equal(result.detailReads,0);assert.equal(result.outcomes[0].status,'SKIPPED');assert.equal(result.status,'COMPLETE');
 assert.deepEqual(r.inspect('r1'),before);assert.equal(result.checkpointAdvanceAllowed,false);
}));
test('without synthetic coverage equal revision requires details and fails safely when absent',()=>setup(r=>{
 r.run(input([row()],new Map([['r1',raw(row())]])));const before=r.inspect('r1');
 const result=r.run(input([row()],new Map()));
 assert.equal(result.outcomes[0].classification,'INCOMPLETE');assert.equal(result.detailReads,1);assert.equal(result.status,'INCOMPLETE');
 assert.equal(result.outcomes[0].reason,'FIXTURE_DETAIL_MISSING');assert.deepEqual(r.inspect('r1'),before);
}));
test('changed fixture creates v2 and keeps v1 immutable',()=>setup(r=>{
 r.run(input([row()],new Map([['r1',raw(row())]])));const before=r.inspect('r1');const changed=row('r1','rev2');
 const result=r.run(input([changed],new Map([['r1',raw(changed)]]),true));
 assert.equal(result.outcomes[0].classification,'CHANGED');assert.equal(result.outcomes[0].versionId,'v2');
 assert.deepEqual(r.inspect('r1').versions[0],before.versions[0]);
}));
test('failure is per document, subsequent valid document publishes, retry uses current evidence',()=>setup(r=>{
 const a=row('a'),b=row('b');const result=r.run(input([a,b],new Map([['a',raw(a,{expectedLines:1})],['b',raw(b)]]),true));
 assert.deepEqual(result.outcomes.map(o=>o.status),['FAILED','PUBLISHED']);assert.equal(result.status,'INCOMPLETE');
 const retry=r.run(input([a,b],new Map([['a',raw(a)]]),true));
 assert.deepEqual(retry.outcomes.map(o=>o.status),['PUBLISHED','SKIPPED']);assert.equal(retry.detailReads,1);
 assert.equal(r.inspect('b').versions.length,1);
}));
test('whole-list duplicate or cross-FY preflight fails before writing any document',()=>setup(r=>{
 for(const observations of [[row(),row()],[row(),{...row('b'),fyId:'2026-27'}]]){
  assert.throws(()=>r.run(input(observations,new Map([['r1',raw(row())]]))));assert.equal(r.inspect('r1').identityCount,0);
 }
}));
test('partial/empty listing never claims complete or deletes prior evidence',()=>setup(r=>{
 r.run(input([row()],new Map([['r1',raw(row())]])));const before=r.inspect('r1');
 const result=r.run({...input([],new Map()),listingComplete:false});
 assert.equal(result.status,'INCOMPLETE');assert.equal(result.detailReads,0);assert.equal(result.checkpointAdvanceAllowed,false);
 assert.deepEqual(r.inspect('r1'),before);
}));
