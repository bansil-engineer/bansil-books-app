import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {verificationPreview} from '../pilot/verification-model.ts';
import {appendVerification,verificationStates} from '../pilot/verification-store.ts';
import type {PilotDocument,PilotView} from '../pilot/view-model.ts';
const doc=(type:string,id:string,extra:Partial<PilotDocument>={})=>({type,id,key:type+':'+id,number:type+'-'+id,date:'2026-05-01',fy:'2026-27',version:'v1',sha256:'a',observedAt:'2026-05-01',customerId:'c',referenceNumber:'r',currency:'INR',priceTaxBasis:'EXCLUSIVE',invoiceIds:[],salesOrderIds:[],owners:[],billIds:[],lines:[],salesSubtotal:null,purchaseSubtotal:null,...extra} as PilotDocument);
function fixture():PilotView{return {snapshotId:'a'.repeat(20),responseCount:4,coverage:'INCOMPLETE',documents:[doc('SO','1'),doc('PO','2',{owners:['SO-1'],billIds:['3','3']}),doc('BILL','3',{purchaseSubtotal:'60.10'}),doc('INVOICE','4',{salesSubtotal:'100.20'})]};}
const command={soId:'1',snapshot:'a'.repeat(20),revision:0,action:'VERIFY' as const,confirmed:true};
test('exact GST-exclusive Invoice minus Bills; duplicate Bill IDs counted once; PO amounts ignored',()=>{const data=fixture();data.documents[1].purchaseSubtotal='99999';const p=verificationPreview(data,'1');assert.equal(p.reason,null);assert.equal(p.cost,'60.10');assert.equal(p.profit,'40.10');assert.equal(p.percent,'40.02');data.documents[2].purchaseSubtotal='150.20';assert.equal(verificationPreview(data,'1').percent,'-49.90');});
test('missing, zero revenue, currency, tax, shared and missing referenced documents block verification',()=>{
 const changes=[(d:PilotView)=>{d.documents.pop();},(d:PilotView)=>{d.documents[3].salesSubtotal='0';},(d:PilotView)=>{d.documents[2].purchaseSubtotal=null;},(d:PilotView)=>{d.documents[2].currency='USD';},(d:PilotView)=>{d.documents[3].priceTaxBasis='INCLUSIVE';},(d:PilotView)=>{d.documents.push(doc('PO','5',{owners:['SO-1 & SO-9']}));},(d:PilotView)=>{d.documents[1].billIds.push('99');},(d:PilotView)=>{d.documents[3].salesOrderIds=['1','9'];},(d:PilotView)=>{d.documents.push(doc('PO','5',{owners:['SO-9'],billIds:['3']}));}];
 for(const change of changes){const d=fixture();change(d);assert.ok(verificationPreview(d,'1').reason);}
});
test('verify persists evidence; unverify de-links all manual links without deleting history; replay and stale revisions blocked',()=>{
 const db=new DatabaseSync(':memory:'),data=fixture();try{
 let states=appendVerification(db,data,command,'owner-session');assert.equal(states['1'].status,'VERIFIED');assert.equal(states['1'].percent,'40.02');
 assert.throws(()=>appendVerification(db,data,command,'owner-session'),/Verification changed/);
 const row=db.prepare('SELECT * FROM v2_owner_verifications').get()!;assert.notEqual(row.actor_hash,'owner-session');assert.deepEqual(JSON.parse(String(row.evidence)).billIds,['3']);
 assert.equal(verificationStates(db,{...data,snapshotId:'b'.repeat(20)})['1'].status,'STALE');assert.equal(verificationStates(db,{...data,snapshotId:'b'.repeat(20)})['1'].percent,null);
 states=appendVerification(db,data,{...command,revision:states['1'].revision,action:'UNVERIFY'},'owner-session');assert.equal(states['1'].status,'INCOMPLETE');assert.equal(states['1'].percent,null);
 assert.equal(db.prepare('SELECT count(*) AS n FROM v2_owner_verifications').get()?.n,2);
 assert.deepEqual(JSON.parse(String(db.prepare('SELECT evidence FROM v2_owner_verifications ORDER BY seq DESC LIMIT 1').get()?.evidence)).billIds,[]);
 for(const sql of ['DELETE FROM v2_owner_verifications',"UPDATE v2_owner_verifications SET action='UNVERIFY'",'INSERT OR REPLACE INTO v2_owner_verifications SELECT * FROM v2_owner_verifications WHERE seq=1'])assert.throws(()=>db.exec(sql),/APPEND_ONLY/);
 states=appendVerification(db,data,{...command,revision:states['1'].revision},'owner-session');assert.equal(states['1'].status,'VERIFIED');
 }finally{db.close();}
});
test('confirmation, source snapshot and conflicting allocation are server enforced',()=>{
 const db=new DatabaseSync(':memory:'),data=fixture();try{
 assert.throws(()=>appendVerification(db,data,{...command,confirmed:false},'owner'),/confirmation/);
 assert.throws(()=>appendVerification(db,data,{...command,snapshot:'changed'},'owner'),/Source data changed/);
 appendVerification(db,data,command,'owner');
 // A changed graph proposes the same documents for another SO. Existing approval still reserves them.
 const changed=fixture();changed.documents[0]=doc('SO','9');changed.documents[1].owners=['SO-9'];changed.snapshotId='b'.repeat(20);
 assert.throws(()=>appendVerification(db,changed,{...command,soId:'9',snapshot:changed.snapshotId},'owner'),/already approved/);
 }finally{db.close();}
});

import {handleVerification} from '../pilot/verification-http.ts';
test('HTTP gate blocks production, unauthenticated, cross-origin and malformed bypass requests before writes',async()=>{
 let writes=0;const deps={environment:'development',ownerToken:async()=> 'owner',save:()=>{writes++;return {};}};
 const request=(origin='http://localhost:3000',body=JSON.stringify({...command,action:'VERIFY_PO',poId:'2'}))=>new Request('http://localhost:3000/api/master-audit-v2/verification',{method:'POST',headers:{origin,'Content-Type':'application/json'},body});
 assert.equal((await handleVerification(request(),{...deps,environment:'production'})).status,403);
 assert.equal((await handleVerification(request(),{...deps,ownerToken:async()=>null})).status,401);
 assert.equal((await handleVerification(request('http://evil.example'),deps)).status,403);
 assert.equal((await handleVerification(request('',JSON.stringify(command)),deps)).status,403);
 assert.equal((await handleVerification(request(undefined,JSON.stringify({...command,action:'DELETE'})),deps)).status,400);
 assert.equal(writes,0);
 assert.equal((await handleVerification(request(),deps)).status,200);assert.equal(writes,1);
});

import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPilotStore} from '../pilot/store.ts';import {readPilotView} from '../pilot/view-model.ts';import {saveVerification,readVerificationStates} from '../pilot/verification-store.ts';
test('disk transaction persists and reopens approval, rollback preserves it, source journal untouched; missing DB never created',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-verification-fixture-'));try{
 assert.throws(()=>saveVerification(root,command,'fixture-owner'),/Existing isolated/);assert.equal(existsSync(join(root,'data')),false);
 const store=openPilotStore(root),run=store.start('123');
 for(const [module,singular,fields] of [
 ['salesorders','salesorder',{salesorder_id:'1',salesorder_number:'SO-1',invoices:[{invoice_id:'4'}]}],
 ['purchaseorders','purchaseorder',{purchaseorder_id:'2',purchaseorder_number:'PO-2',custom_fields:[{label:'Sales Order No',value:'SO-1'}],bills:[{bill_id:'3'}]}],
 ['bills','bill',{bill_id:'3',bill_number:'B-3',sub_total:60.1}],
 ['invoices','invoice',{invoice_id:'4',invoice_number:'I-4',sub_total:100.2,salesorder_id:'1'}],
 ] as const){const d={date:'2026-05-01',currency_code:'INR',is_inclusive_tax:false,line_items:[{line_item_id:singular,quantity:1}],...fields};store.capture(run,'/books/v3/'+module+'/'+(fields as Record<string,unknown>)[singular+'_id'],JSON.stringify({code:0,[singular]:d}));}
 assert.equal(store.publishCapturedDetails().published,4);store.close();
 const view=readPilotView(root);const input={...command,snapshot:view.snapshotId};
 let states=saveVerification(root,input,'fixture-owner');assert.equal(readVerificationStates(root,view)['1'].percent,'40.02');
 assert.throws(()=>saveVerification(root,input,'fixture-owner'),/Verification changed/);assert.equal(readVerificationStates(root,view)['1'].status,'VERIFIED');
 states=saveVerification(root,{...input,revision:states['1'].revision,action:'UNVERIFY'},'fixture-owner');assert.equal(states['1'].status,'INCOMPLETE');assert.equal(readPilotView(root).responseCount,4);assert.equal(readPilotView(root).snapshotId,view.snapshotId);
 const poStates=saveVerification(root,{...input,revision:states['1'].revision,action:'VERIFY_PO',poId:'2'},'fixture-owner');assert.equal(poStates['1'].mode,'PO');assert.equal(readVerificationStates(root,view)['1'].percent,'40.02');assert.deepEqual(readVerificationStates(root,view)['1'].selection?.billIds,['3']);
 }finally{rmSync(root,{recursive:true});}
});

import {defaultSelection,validSelection} from '../pilot/verification-model.ts';
test('selected rows alone contribute to GP; exclusions and manual saved additions survive approval',()=>{
 const data=fixture();data.documents.push(doc('BILL','5',{purchaseSubtotal:'10.10'}),doc('INVOICE','6',{salesSubtotal:'20.00'}));data.documents[1].billIds.push('5');
 const selection={poIds:['2'],invoiceIds:['4','6'],billIds:['5']};const p=verificationPreview(data,'1',selection);
 assert.equal(p.reason,null);assert.equal(p.sales,'120.20');assert.equal(p.cost,'10.10');assert.equal(p.percent,'91.60');
 const db=new DatabaseSync(':memory:');try{const states=appendVerification(db,data,{...command,selection},'owner');assert.deepEqual(states['1'].selection,selection);assert.equal(states['1'].percent,'91.60');const saved=JSON.parse(String(db.prepare('SELECT evidence FROM v2_owner_verifications').get()?.evidence));assert.deepEqual(saved.billIds,['5']);assert.equal(saved.documents.some((d:{key:string})=>d.key==='BILL:3'),false);}finally{db.close();}
});
test('selection rejects duplicate, wrong-type, unknown IDs; unselected invalid amounts do not poison a valid partial selection',()=>{
 const data=fixture();data.documents.push(doc('BILL','5',{purchaseSubtotal:null}));const selection=defaultSelection(data,'1');
 assert.equal(validSelection({...selection,billIds:['3','3']}),false);assert.equal(validSelection({...selection,poIds:'2'}),false);
 assert.throws(()=>verificationPreview(data,'1',{...selection,billIds:['3','3']}),/Invalid document selection/);
 assert.ok(verificationPreview(data,'1',{...selection,billIds:['4']}).reason);assert.ok(verificationPreview(data,'1',{...selection,billIds:['99']}).reason);
 assert.equal(verificationPreview(data,'1',selection).percent,'40.02');assert.ok(verificationPreview(data,'1',{...selection,billIds:[]}).reason);
 assert.ok(verificationPreview(data,'1',{...selection,poIds:[]}).reason);
});
test('manual additions cannot bypass customer, parent PO or existing manual PO ownership',()=>{
 const data=fixture(),selection=defaultSelection(data,'1');data.documents.push(doc('INVOICE','8',{customerId:'other',salesSubtotal:'100'}));assert.ok(verificationPreview(data,'1',{...selection,invoiceIds:['8']}).reason);
 data.documents.push(doc('PO','7',{owners:['SO-9']}));assert.ok(verificationPreview(data,'1',{...selection,poIds:['2','7']}).reason);
 const db=new DatabaseSync(':memory:');try{appendVerification(db,data,{...command,selection},'owner');const other=fixture();other.documents[0]=doc('SO','9');other.documents[1].owners=['SO-9'];other.documents[1].billIds=['10'];other.documents[2]=doc('BILL','10',{purchaseSubtotal:'5'});other.documents[3]=doc('INVOICE','11',{salesSubtotal:'100'});other.snapshotId='b'.repeat(20);assert.throws(()=>appendVerification(db,other,{...command,soId:'9',snapshot:other.snapshotId,selection:{poIds:['2'],invoiceIds:['11'],billIds:['10']}},'owner'),/already approved/);}finally{db.close();}
});

import {poReview} from '../pilot/po-verification.ts';
test('PO workflow verifies linked Bills automatically; only all POs expose GP; unverify removes GP and affected Bill links',()=>{
 const data=fixture();data.documents.push(doc('PO','7',{owners:['SO-1'],billIds:['8']}),doc('BILL','8',{purchaseSubtotal:'10.00'}));
 const db=new DatabaseSync(':memory:');try{
 let states=appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'2'},'owner');let state=states['1'];
 assert.equal(state.mode,'PO');assert.equal(state.status,'INCOMPLETE');assert.equal(state.percent,null);assert.deepEqual(state.selection?.billIds,['3']);
 assert.equal(poReview(data,'1',state.selection!.poIds).all,false);
 states=appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'7',revision:state.revision},'owner');state=states['1'];
 assert.equal(state.status,'VERIFIED');assert.equal(state.percent,'30.04');assert.deepEqual(state.selection?.billIds,['3','8']);
 states=appendVerification(db,data,{...command,action:'UNVERIFY_PO',poId:'2',revision:state.revision},'owner');state=states['1'];
 assert.equal(state.status,'INCOMPLETE');assert.equal(state.percent,null);assert.deepEqual(state.selection?.poIds,['7']);assert.deepEqual(state.selection?.billIds,['8']);
 states=appendVerification(db,data,{...command,action:'UNVERIFY',revision:state.revision},'owner');assert.equal(states['1'].selection,undefined);
 assert.equal(db.prepare('SELECT count(*) AS n FROM v2_owner_verifications').get()?.n,4);
 }finally{db.close();}
});
test('PO approvals may finish without invoices but GP stays unavailable, and forged selections cannot inject Bills',()=>{
 const data=fixture();data.documents.pop();const db=new DatabaseSync(':memory:');try{
 const states=appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'2',selection:{poIds:['99'],invoiceIds:['99'],billIds:['99']}},'owner');
 assert.equal(states['1'].status,'VERIFIED');assert.equal(states['1'].percent,null);assert.match(states['1'].gpReason!,/Invoice/);assert.deepEqual(states['1'].selection?.billIds,['3']);
 }finally{db.close();}
});
test('PO shared ownership and missing Bill details block approval; stale snapshot resets old PO approvals',()=>{
 const data=fixture();data.documents.push(doc('PO','7',{owners:['SO-1 & SO-9'],billIds:[]}));const db=new DatabaseSync(':memory:');try{
 assert.throws(()=>appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'7'},'owner'),/Shared PO/);
 data.documents[1].billIds.push('99');assert.throws(()=>appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'2'},'owner'),/Bill detail/);data.documents[1].billIds=['3'];
 const first=appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'2'},'owner')['1'];
 data.snapshotId='b'.repeat(20);data.documents[4].owners=['SO-1'];
 const second=appendVerification(db,data,{...command,snapshot:data.snapshotId,revision:first.revision,action:'VERIFY_PO',poId:'7'},'owner')['1'];assert.deepEqual(second.selection?.poIds,['7']);assert.equal(second.status,'INCOMPLETE');
 }finally{db.close();}
});
test('legacy bulk Verify HTTP endpoint cannot bypass the PO workflow',async()=>{
 let writes=0;const request=new Request('http://localhost:3000/api/master-audit-v2/verification',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(command)});
 const response=await handleVerification(request,{environment:'development',ownerToken:async()=> 'owner',save:()=>{writes++;return {};}});assert.equal(response.status,400);assert.equal(writes,0);
});

test('PO automatic Bill verification rejects invalid money, currency and tax basis',()=>{
 for(const patch of [{purchaseSubtotal:null},{purchaseSubtotal:'bad'},{purchaseSubtotal:'-1'},{currency:'USD'},{priceTaxBasis:'INCLUSIVE'}]){
 const data=fixture();Object.assign(data.documents[2],patch);const db=new DatabaseSync(':memory:');try{assert.throws(()=>appendVerification(db,data,{...command,action:'VERIFY_PO',poId:'2'},'owner'));assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='v2_owner_verifications'").get()?.n,0);}finally{db.close();}
 }
});

import {appendCoverageReview,coverageReviews} from '../pilot/coverage-review-store.ts';
import {poProblem} from '../pilot/po-verification.ts';
test('shared PO with valid allocation enables GP calculation without double-counting, blocks when unallocated or stale',()=>{
 const data:PilotView={
  snapshotId:'a'.repeat(20),responseCount:6,coverage:'INCOMPLETE',
  documents:[
   doc('SO','10',{number:'SO-2627065'}),
   doc('PO','20',{number:'PO-20',owners:['SO-2627065'],billIds:['30']}),
   doc('BILL','30',{number:'B-30',purchaseSubtotal:'50.00'}),
   doc('PO','50',{number:'PO-50',owners:['SO-2627065','SO-2627071'],billIds:['60']}),
   doc('BILL','60',{number:'B-60',purchaseSubtotal:'100.00'}),
   doc('INVOICE','40',{number:'I-40',salesSubtotal:'200.00',salesOrderIds:['10']}),
  ]
 };
 // Unallocated shared PO blocks GP and poProblem
 assert.equal(poProblem(data,'10',data.documents[3]),'Shared PO ownership needs allocation');
 assert.equal(poReview(data,'10',['20','50']).all,false);
 assert.equal(verificationPreview(data,'10',{poIds:['20','50'],invoiceIds:['40'],billIds:['30','60']}).reason,'Shared PO or another SO ownership needs allocation');

 const db=new DatabaseSync(':memory:');
 try{
  // Allocate PO-50: 40.00 to SO-2627065, 60.00 to SO-2627071 (total 100.00)
  appendCoverageReview(db,data,{soId:'10',documentId:'50',kind:'PO',snapshot:data.snapshotId,revision:0,status:'ALLOCATED',note:'Split with SO-2627071',amounts:{'SO-2627065':'40.00','SO-2627071':'60.00'}},'owner');
  const reviews=coverageReviews(db);

  // poProblem now allows PO-50
  assert.equal(poProblem(data,'10',data.documents[3],reviews),null);

  // poReview preview computes GP: exclusive bill (50.00) + allocated share (40.00) = 90.00
  // NOT the whole bill 100.00! Double-counting strictly prevented.
  const rev=poReview(data,'10',['20','50'],reviews);
  assert.equal(rev.all,true);
  assert.equal(rev.reason,null);
  assert.equal(rev.gp.sales,'200.00');
  assert.equal(rev.gp.cost,'90.00');
  assert.equal(rev.gp.profit,'110.00');
  assert.equal(rev.gp.percent,'55.00');

  // Verify in DB step-by-step
  let states=appendVerification(db,data,{soId:'10',snapshot:data.snapshotId,revision:0,action:'VERIFY_PO',poId:'20'},'owner');
  assert.equal(states['10'].status,'INCOMPLETE');
  states=appendVerification(db,data,{soId:'10',snapshot:data.snapshotId,revision:states['10'].revision,action:'VERIFY_PO',poId:'50'},'owner');
  assert.equal(states['10'].status,'VERIFIED');
  assert.equal(states['10'].cost,'90.00');
  assert.equal(states['10'].percent,'55.00');

  // Snapshot change invalidates allocation and verification fails closed
  const staleData={...data,snapshotId:'b'.repeat(20)};
  assert.equal(poProblem(staleData,'10',data.documents[3],reviews),'Shared PO ownership needs allocation');
  assert.equal(verificationPreview(staleData,'10',{poIds:['20','50'],invoiceIds:['40'],billIds:['30','60']},reviews).reason,'Shared PO or another SO ownership needs allocation');
  assert.equal(verificationStates(db,staleData)['10'].status,'STALE');
 }finally{db.close();}
});

test('provisional PO fallback validates tax basis, currency, and fails if referenced Bills are omitted', () => {
 const data = fixture();
 // PO has no bills
 data.documents[1] = doc('PO','2',{owners:['SO-1'], billIds:[], purchaseSubtotal:'50.00'});
 // Normal preview using PO subtotal (provisional)
 let p = verificationPreview(data, '1');
 assert.equal(p.reason, null);
 assert.equal(p.cost, '50.00');
 assert.equal(p.isProvisional, true);

 // Missing or incorrect currency
 data.documents[1].currency = 'USD';
 p = verificationPreview(data, '1');
 assert.match(p.reason!, /Currency is missing or differs/);
 data.documents[1].currency = 'INR';

 // Incorrect tax basis
 data.documents[1].priceTaxBasis = 'INCLUSIVE';
 p = verificationPreview(data, '1');
 assert.match(p.reason!, /GST-exclusive source basis is not confirmed/);
 data.documents[1].priceTaxBasis = 'EXCLUSIVE';

 // Negative PO subtotal
 data.documents[1].purchaseSubtotal = '-10.00';
 p = verificationPreview(data, '1');
 assert.match(p.reason!, /Negative PO subtotal/);

 // PO has bills, but they are omitted in selection
 data.documents[1].purchaseSubtotal = '50.00';
 data.documents[1].billIds = ['99'];
 p = verificationPreview(data, '1', {poIds:['2'], invoiceIds:['4'], billIds:[]});
 assert.match(p.reason!, /A referenced Bill is missing or was omitted/);
});

test('allocation dependency binding invalidates verification if shared allocation changes', () => {
 const data:PilotView={
  snapshotId:'a'.repeat(20),responseCount:4,coverage:'INCOMPLETE',
  documents:[
   doc('SO','10',{number:'SO-2627065'}),
   doc('PO','20',{number:'PO-20',owners:['SO-2627065', 'SO-2627071'],billIds:['30']}),
   doc('BILL','30',{number:'B-30',purchaseSubtotal:'90.00'}),
   doc('INVOICE','40',{number:'I-40',salesSubtotal:'100.00',salesOrderIds:['10']}),
  ]
 };
 const db=new DatabaseSync(':memory:');
 try{
  appendCoverageReview(db,data,{soId:'10',documentId:'20',kind:'PO',snapshot:data.snapshotId,revision:0,status:'ALLOCATED',note:'Split',amounts:{'SO-2627065':'40.00', 'SO-2627071':'50.00'}},'owner');
  const states = appendVerification(db,data,{soId:'10',snapshot:data.snapshotId,revision:0,action:'VERIFY_PO',poId:'20'},'owner');
  assert.equal(states['10'].status,'VERIFIED');
  assert.equal(states['10'].cost,'40.00');

  // Change allocation!
  appendCoverageReview(db,data,{soId:'10',documentId:'20',kind:'PO',snapshot:data.snapshotId,revision:1,status:'ALLOCATED',note:'Split',amounts:{'SO-2627065':'50.00', 'SO-2627071':'40.00'}},'owner');

  // Next time we read verification states, it should be STALE because the allocation changed
  const newStates = verificationStates(db, data);
  assert.equal(newStates['10'].status, 'STALE');
 }finally{db.close();}
});
