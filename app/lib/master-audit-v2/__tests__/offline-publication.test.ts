import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOfflinePublicationStore } from '../sync/offline-publication.ts';
import type { Observation, Scope } from '../sync/planner.ts';
const scope:Scope={organizationId:'A',fyId:'2025-26',documentType:'SO'};
const observation:Observation={...scope,remoteId:'r1',revision:'rev1'};
const observedAt='2026-09-29T00:00:00.000Z';
function payload(patch:Record<string,unknown>={}) {return JSON.stringify({...observation,documentDate:'2026-03-31',expectedLines:1,lines:[{id:'line1',itemId:'item1',unit:'Nos',quantity:{value:'0.0000',scale:4,missingReason:null},amount:{value:null,scale:null,missingReason:'NOT_PROVIDED'}}],...patch});}
function run(fn:(store:ReturnType<typeof createOfflinePublicationStore>)=>void){const store=createOfflinePublicationStore(scope,'2025-04-01','2026-03-31');try{fn(store);}finally{store.close();}}
test('publication atomically records exact payload/hash, lines, seal, pointer and event',()=>run(store=>{
 const raw=payload(), result=store.publish(observation,raw,observedAt,null), state=store.inspect('r1');
 assert.equal(result.payloadSha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal(state.current,'v1');assert.equal(state.versions[0].raw_payload,raw);
 assert.equal(state.lines[0].quantity,'0.0000');assert.equal(state.lines[0].amount,null);
 assert.equal(state.lines[0].amount_missing_reason,'NOT_PROVIDED');assert.equal(state.seals.length,1);assert.equal(state.events.length,1);
}));
test('changed detail appends history while old evidence remains byte-for-byte intact',()=>run(store=>{
 store.publish(observation,payload(),observedAt,null); const before=store.inspect('r1');
 store.publish({...observation,revision:'rev2'},payload({revision:'rev2'}),observedAt,'v1');
 const after=store.inspect('r1');assert.equal(after.current,'v2');assert.equal(after.versions.length,2);
 assert.deepEqual(after.versions[0],before.versions[0]);assert.deepEqual(after.lines[0],before.lines[0]);assert.equal(after.events.length,2);
}));
test('incomplete, malformed and duplicate-line details cannot publish',()=>run(store=>{
 const line=JSON.parse(payload()).lines[0];
 for(const raw of ['null','{}',payload({expectedLines:2}),payload({lines:[line,line],expectedLines:2}),payload({lines:[{...line,amount:{value:'01.0',scale:1,missingReason:null}}]})])
  assert.throws(()=>store.publish(observation,raw,observedAt,null));
 assert.equal(store.inspect('r1').versions.length,0);assert.equal(store.inspect('r1').identityCount,0);
}));
test('transaction rollback removes newly inserted identity on invalid date/FY',()=>run(store=>{
 for(const documentDate of ['2026-04-01','2026-02-30']) assert.throws(()=>store.publish(observation,payload({documentDate}),observedAt,null));
 assert.deepEqual(store.inspect('r1'),{current:null,versions:[],lines:[],seals:[],events:[],identityCount:0});
}));
test('failed replacement preserves complete prior snapshot and events',()=>run(store=>{
 store.publish(observation,payload(),observedAt,null);const before=store.inspect('r1');
 assert.throws(()=>store.publish(observation,payload({documentDate:'2026-04-01'}),observedAt,'v1'));
 assert.deepEqual(store.inspect('r1'),before);
}));
test('stale work or replay cannot overwrite a newer current version',()=>run(store=>{
 store.publish(observation,payload(),observedAt,null);const before=store.inspect('r1');
 assert.throws(()=>store.publish(observation,payload(),observedAt,null),/STALE_PLAN/);
 assert.deepEqual(store.inspect('r1'),before);
}));
test('scope, identity and list/detail revision races are rejected',()=>run(store=>{
 for(const patch of [{organizationId:'B'},{fyId:'2026-27'},{documentType:'PO'},{remoteId:'r2'},{revision:'rev2'}])
  assert.throws(()=>store.publish(observation,payload(patch),observedAt,null));
 assert.equal(store.inspect('r1').versions.length,0);
}));
test('zero-line fixture explicit count accepted; invalid timestamps rejected',()=>run(store=>{
 assert.throws(()=>store.publish(observation,payload(), '2026-02-30T00:00:00.000Z',null),/INVALID_OBSERVED_AT/);
 store.publish(observation,payload({expectedLines:0,lines:[]}),observedAt,null);
 assert.equal(store.inspect('r1').lines.length,0);assert.equal(store.inspect('r1').current,'v1');
}));
