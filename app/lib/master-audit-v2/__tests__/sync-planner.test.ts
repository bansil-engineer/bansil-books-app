import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, planSync } from '../sync/planner.ts';
import type { Observation, SavedEvidence, RevisionProof, Scope } from '../sync/planner.ts';
const scope:Scope={organizationId:'A',fyId:'2025-26',documentType:'SO'};
const row:Observation={...scope,remoteId:'r1',revision:'rev1'};
const proof:RevisionProof={contractId:'fixture-contract',evidenceReference:'fixture-only',coversDetailChanges:true};
const saved:SavedEvidence={...row,versionId:'v1',sealed:true,validationRule:'rule1',revisionContract:'fixture-contract',expectedLines:2,storedLines:2};
test('new identity requires detail; proven unchanged has zero detail queue',()=>{
 assert.equal(classify(row,undefined,proof,'rule1').state,'NEW');
 const plan=planSync(scope,[row],[saved],proof,'rule1',true);
 assert.equal(plan.entries[0].classification.state,'UNCHANGED'); assert.equal(plan.detailQueue.length,0);
 assert.equal(plan.checkpointAdvanceAllowed,false);
});
test('changed revision queues detail and preserves previous version reference',()=>{
 const plan=planSync(scope,[{...row,revision:'rev2'}],[saved],proof,'rule1',true);
 assert.equal(plan.detailQueue[0].classification.state,'CHANGED'); assert.equal(plan.entries[0].previousVersionId,'v1');
 assert.equal(saved.revision,'rev1');
});
test('equal list revision never skips incomplete or outdated detail',()=>{
 for(const patch of [{sealed:false},{storedLines:1},{expectedLines:-1},{expectedLines:1.5},{versionId:''},{validationRule:'old'}])
  assert.deepEqual(classify(row,{...saved,...patch},proof,'rule1'),{state:'INCOMPLETE',reason:'SAVED_DETAIL_NOT_COMPLETE',detailRequired:true});
});
test('detail-only change coverage must be proven; no default Zoho assumption',()=>{
 for(const p of [null,{...proof,coversDetailChanges:false},{...proof,evidenceReference:''},{...proof,contractId:'new'}]) {
  assert.equal(classify(row,saved,p,'rule1').state,'INCOMPLETE');
  assert.equal(planSync(scope,[row],[saved],p,'rule1',true).detailQueue.length,1);
 }
});
test('missing revision stays incomplete, including both missing',()=>{
 for(const rev of [null,'',' ']) assert.equal(classify({...row,revision:rev},{...saved,revision:rev},proof,'rule1').state,'INCOMPLETE');
});
test('org, FY and document-type isolation fail closed',()=>{
 for(const patch of [{organizationId:'B'},{fyId:'2026-27'},{documentType:'PO' as const}]){
  assert.throws(()=>planSync(scope,[{...row,...patch}],[saved],proof,'rule1',true),/SCOPE_MISMATCH/);
  assert.throws(()=>planSync(scope,[row],[{...saved,...patch}],proof,'rule1',true),/SCOPE_MISMATCH/);
  assert.throws(()=>classify(row,{...saved,...patch},proof,'rule1'),/SCOPE_MISMATCH/);
 }
});
test('duplicate list or saved identities cannot produce ambiguous work',()=>{
 assert.throws(()=>planSync(scope,[row,row],[saved],proof,'rule1',true),/DUPLICATE_LIST/);
 assert.throws(()=>planSync(scope,[row],[saved,saved],proof,'rule1',true),/DUPLICATE_SAVED/);
});
test('partial and empty listings cannot advance checkpoints or infer deletion',()=>{
 const plan=planSync(scope,[],[saved],proof,'rule1',false);
 assert.equal(plan.listingStatus,'INCOMPLETE'); assert.equal(plan.checkpointAdvanceAllowed,false);
 assert.deepEqual(plan.entries,[]); assert.equal(saved.versionId,'v1');
});
test('invalid identity or missing validation rule rejected',()=>{
 assert.throws(()=>planSync(scope,[{...row,remoteId:' '}],[],proof,'rule1',true),/INVALID_IDENTITY/);
 assert.throws(()=>planSync(scope,[],[],proof,'',true),/VALIDATION_RULE/);
});
