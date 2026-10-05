import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {openPilotStore} from '../pilot/store.ts';import {readPilotView} from '../pilot/view-model.ts';import {syncDocument,canonicalSource} from '../pilot/document-sync.ts';import {handleDocumentSync} from '../pilot/document-sync-http.ts';
const raw=(quantity=1,id='1')=>JSON.stringify({code:0,salesorder:{salesorder_id:id,salesorder_number:'SO-2627009',date:'2026-04-30',line_items:[{line_item_id:'l',quantity}]}});
function fixture(){const root=mkdtempSync(join(tmpdir(),'v2-single-sync-'));const s=openPilotStore(root),run=s.start('123');s.capture(run,'/books/v3/salesorders/1',raw());s.publishCapturedDetails();s.close();return root;}
const input=(root:string)=>({type:'SO' as const,id:'1',snapshot:readPilotView(root).snapshotId});
test('single GET unchanged keeps version and snapshot, including later bulk publication',async()=>{
 const root=fixture();try{let calls=0;const before=input(root);const result=await syncDocument(root,before,async(org,path)=>{calls++;assert.equal(org,'123');assert.equal(path,'/books/v3/salesorders/1');return {raw:raw()};});assert.equal(calls,1);assert.equal(result.status,'UNCHANGED');assert.equal(result.data.snapshotId,before.snapshot);assert.equal(result.data.documents[0].version,'v1');const s=openPilotStore(root);assert.equal(s.publishCapturedDetails().published,0);s.close();}finally{rmSync(root,{recursive:true});}
});
test('changed GET publishes only selected document, preserves history, does not fetch linked docs',async()=>{
 const root=fixture();try{const s=openPilotStore(root),r=s.start('123');s.capture(r,'/books/v3/salesorders/2',raw(8,'2'));s.close();let calls=0;const result=await syncDocument(root,input(root),async()=>{calls++;return {raw:raw(2)};});assert.equal(calls,1);assert.equal(result.status,'CHANGED');assert.equal(result.data.documents.length,1);assert.equal(result.data.documents[0].version,'v2');assert.equal(result.data.documents[0].lines[0].quantity,'2');const db=new DatabaseSync(join(root,'data/master-audit-v2/db/master-audit-v2.sqlite'),{readOnly:true});assert.equal(db.prepare('select count(*) as n from document_versions').get()?.n,2);db.close();}finally{rmSync(root,{recursive:true});}
});
test('unknown, stale, malformed and failed GETs cannot change saved source',async()=>{
 const root=fixture();try{let calls=0;const get=async()=>{calls++;return {raw:raw()};};await assert.rejects(syncDocument(root,{...input(root),id:'999'},get),/NOT_SAVED/);await assert.rejects(syncDocument(root,{...input(root),snapshot:'0'.repeat(20)},get),/SOURCE_CHANGED/);assert.equal(calls,0);await assert.rejects(syncDocument(root,input(root),async()=>({raw:raw(1,'9')})),/IDENTITY/);await assert.rejects(syncDocument(root,input(root),async()=>{throw Error('network');}));assert.equal(readPilotView(root).documents[0].version,'v1');}finally{rmSync(root,{recursive:true});}
});
test('duplicate concurrent sync and changed in-flight source fail closed',async()=>{
 const root=fixture();try{let release!:(v:{raw:string})=>void;const pending=syncDocument(root,input(root),()=>new Promise(r=>{release=r;}));await assert.rejects(syncDocument(root,input(root),async()=>({raw:raw()})),/ALREADY_RUNNING/);const s=openPilotStore(root),r=s.start('123');s.capture(r,'/books/v3/salesorders/1',raw(3));s.publishCapturedDetails();s.close();release({raw:raw(2)});await assert.rejects(pending,/SOURCE_CHANGED/);assert.equal(readPilotView(root).documents[0].lines[0].quantity,'3');}finally{rmSync(root,{recursive:true});}
});
test('canonical comparison ignores key order, preserves decimal precision and JSON types',()=>{
 assert.equal(canonicalSource('{"a":1,"b":2}'),canonicalSource('{"b":2,"a":1}'));assert.notEqual(canonicalSource('{"a":9007199254740993}'),canonicalSource('{"a":9007199254740992}'));assert.notEqual(canonicalSource('{"a":1}'),canonicalSource('{"a":"1"}'));assert.notEqual(canonicalSource('{"a":1}'),canonicalSource('{"a":{"__numberLexeme":"1"}}'));
});
test('HTTP gate rejects production, foreign origin, missing owner and forged arbitrary targets before GET',async()=>{
 let calls=0;const body={type:'SO',id:'1',snapshot:'a'.repeat(20)},deps={environment:'development',owner:async()=>true,sync:async()=>{calls++;return {status:'UNCHANGED'};}};
 const req=(value:unknown=body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/master-audit-v2/sync',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await handleDocumentSync(req(),{...deps,environment:'production'})).status,403);assert.equal((await handleDocumentSync(req(body,'https://evil.test'),deps)).status,403);assert.equal((await handleDocumentSync(req(),{...deps,owner:async()=>false})).status,401);for(const invalid of [{...body,type:'ITEM'},{...body,id:'1/void'},{...body,endpoint:'/anything'}])assert.equal((await handleDocumentSync(req(invalid),deps)).status,400);assert.equal(calls,0);assert.equal((await handleDocumentSync(req(),deps)).status,200);assert.equal(calls,1);
});

test('unchanged preserves manual verification; changed evidence invalidates result without deleting history',async()=>{
 const {initializeVerification}=await import('../pilot/verification-store.ts');const root=fixture();
 try{const path=join(root,'data/master-audit-v2/db/master-audit-v2.sqlite'),db=new DatabaseSync(path);initializeVerification(db);db.prepare('INSERT INTO v2_owner_verifications(so_id,snapshot,action,at,actor_hash,evidence) VALUES(?,?,?,?,?,?)').run('1',input(root).snapshot,'VERIFY','2026-01-01','test',JSON.stringify({mode:'PO',allPOsVerified:true,percent:'10',selection:{poIds:[],invoiceIds:[],billIds:[]}}));db.close();
 const same=await syncDocument(root,input(root),async()=>({raw:raw()}));assert.equal(same.states['1'].status,'VERIFIED');assert.equal(same.states['1'].percent,'10');
 const changed=await syncDocument(root,input(root),async()=>({raw:raw(2)}));assert.equal(changed.states['1'].status,'STALE');assert.equal(changed.states['1'].percent,null);assert.equal(changed.states['1'].revision,same.states['1'].revision);
 }finally{rmSync(root,{recursive:true});}
});
