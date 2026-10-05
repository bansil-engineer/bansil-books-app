import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPilotClient} from '../pilot/client.ts';import {createPilotMemoryStore,openPilotStore,pilotDatabasePath,PILOT_NUMBERS} from '../pilot/store.ts';import {acquirePilot} from '../pilot/acquire.ts';
const credentials={accessToken:'test-only',expiresAt:Date.now()+3600000,apiDomain:'https://www.zohoapis.in',organizationId:'123'};
test('GET client confines host path queries redirects and credentials; expired token makes zero calls',async()=>{
 let calls=0;const transport:typeof fetch=async(_url,options)=>{calls++;assert.equal(options?.method,'GET');assert.equal(options?.redirect,'error');assert.equal(options?.body,undefined);return new Response('{"code":0}');};
 assert.throws(()=>createPilotClient({...credentials,apiDomain:'https://www.zohoapis.in.evil.test'},transport),/DOMAIN/);
 const c=createPilotClient(credentials,transport);
 for(const url of ['https://evil.test/books/v3/bills','/books/v3/bills/1/void','/books/v3/bills?_method=DELETE','/books/v3/bills?organization_id=456'])await assert.rejects(()=>c.get(url));
 await assert.rejects(()=>createPilotClient({...credentials,expiresAt:0},transport).get('/books/v3/bills'),/REFRESH/);
 assert.equal(calls,0);await c.get('/books/v3/salesorders?salesorder_number=SO-2627024');assert.equal(calls,1);
});
test('disk store reopens only isolated target, retains append-only response evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-pilot-test-'));
 try{let s=openPilotStore(root);const run=s.start('123');const capture=s.capture(run,'/books/v3/salesorders/1','{"code":0}');s.close();s=openPilotStore(root);assert.equal(s.inspect(run).responses[0].sha256,capture.sha256);s.close();
 const db=new DatabaseSync(pilotDatabasePath(root));try{for(const sql of ['DELETE FROM v2_pilot_responses','UPDATE v2_pilot_responses SET payload=\'{}\'','INSERT OR REPLACE INTO v2_pilot_responses SELECT * FROM v2_pilot_responses'])assert.throws(()=>db.exec(sql),/APPEND_ONLY/);}finally{db.close();}
 }finally{rmSync(root,{recursive:true});}
});
test('symlink target directories cannot redirect V2 writes into legacy storage',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-pilot-test-'));try{mkdirSync(join(root,'legacy'));symlinkSync(join(root,'legacy'),join(root,'data'));assert.throws(()=>openPilotStore(root),/UNSAFE/);}finally{rmSync(root,{recursive:true});}
});
test('bounded pilot finds exact SO only, keeps raw evidence and never claims allocation completeness',async()=>{
 const store=createPilotMemoryStore();
 const transport:typeof fetch=async(input)=>{const u=new URL(String(input));const number=u.searchParams.get('salesorder_number');return new Response(JSON.stringify(number?{code:0,salesorders:[{salesorder_id:String(PILOT_NUMBERS.indexOf(number)+1),salesorder_number:number}],page_context:{has_more_page:false}}:{code:0,salesorder:{salesorder_id:u.pathname.split('/').at(-1),salesorder_number:PILOT_NUMBERS[Number(u.pathname.split('/').at(-1))-1],date:'2026-05-01',line_items:[]}}));};
 try{const result=await acquirePilot(createPilotClient(credentials,transport),store,'123');assert.equal(result.requests,6);assert.ok(result.outcomes.every(x=>x.status==='EVIDENCE_ACQUIRED'));assert.equal(result.commercialStatus,'INCOMPLETE');assert.equal(store.inspect(result.runId).responses.length,6);assert.ok(store.inspect(result.runId).events.some(e=>String(e.details_json).includes('"pilotFYMatch":true')));}finally{store.close();}
});
test('lookup truncation, identity mismatch and remote failures never produce successful pilot',async()=>{
 for(const body of [{code:0,salesorders:[],page_context:{has_more_page:true}},{code:0,salesorders:[],page_context:{has_more_page:false}},{code:99}]){
 const store=createPilotMemoryStore();try{const result=await acquirePilot(createPilotClient(credentials,async()=>new Response(JSON.stringify(body))),store,'123');assert.ok(result.outcomes.every(x=>x.status==='INCOMPLETE'));}finally{store.close();}}
});
test('organization mismatch fails before any run or network request',async()=>{
 const store=createPilotMemoryStore();let calls=0;
 try{await assert.rejects(()=>acquirePilot(createPilotClient(credentials,async()=>{calls++;return new Response('{}');}),store,'456'),/ORGANIZATION_MISMATCH/);assert.equal(calls,0);}finally{store.close();}
});
test('detail identity mismatch remains incomplete and preserves response for review',async()=>{
 const store=createPilotMemoryStore();const client=createPilotClient(credentials,async(input)=>{const u=new URL(String(input));return new Response(JSON.stringify(u.searchParams.has('salesorder_number')?{code:0,salesorders:[{salesorder_id:'1',salesorder_number:u.searchParams.get('salesorder_number')}],page_context:{has_more_page:false}}:{code:0,salesorder:{salesorder_id:'2'}}));});
 try{const result=await acquirePilot(client,store,'123');assert.ok(result.outcomes.every(x=>x.reason==='DOCUMENT_IDENTITY_MISMATCH'));assert.equal(store.inspect(result.runId).responses.length,6);}finally{store.close();}
});

test('reverse discovery deduplicates PO details, retains search limitations and explicit bill evidence',async()=>{
 const {discoverPilotPurchaseOrders}=await import('../pilot/discovery.ts');const store=createPilotMemoryStore();let poDetails=0;
 const client=createPilotClient(credentials,async(input)=>{
  const u=new URL(String(input));let body:unknown;
  if(u.searchParams.has('custom_field_contains'))body={code:0,purchaseorders:[],page_context:{has_more_page:true}};
  else if(u.searchParams.has('reference_number_contains'))body={code:0,purchaseorders:[{purchaseorder_id:'8'}],page_context:{has_more_page:false}};
  else if(u.pathname.endsWith('/purchaseorders/8')){poDetails++;body={code:0,purchaseorder:{purchaseorder_id:'8',date:'2026-04-01',line_items:[],bills:[{bill_id:'9'}]}};}
  else body={code:0,bill:{bill_id:'9',date:'2026-04-02'}};
  return new Response(JSON.stringify(body));
 });
 try{const r=await discoverPilotPurchaseOrders(client,store,'123');assert.equal(r.candidates,1);assert.equal(poDetails,1);assert.equal(r.commercialStatus,'INCOMPLETE');const events=store.inspect(r.runId).events;assert.equal(events.filter(e=>e.code==='DISCOVERY_INCOMPLETE').length,3);assert.equal(events.filter(e=>e.code==='EXPLICIT_PO_BILL_REFERENCE').length,1);}finally{store.close();}
});
test('live document dates must be real calendar dates and within approved historical range',async()=>{
 const {validatePilotDocumentDate}=await import('../pilot/validation.ts');
 for(const value of [undefined,'2023-02-29','2026-04-31','2022-03-31','2026-99-01'])assert.throws(()=>validatePilotDocumentDate(value),/DATE/);
 for(const value of ['2022-04-01','2024-02-29','2026-04-01'])assert.doesNotThrow(()=>validatePilotDocumentDate(value));
});
test('candidate detail validates current identity, follows bills once and makes no allocation claim',async()=>{
 const {acquirePilotCandidates}=await import('../pilot/candidates.ts');const store=createPilotMemoryStore();
 const c=createPilotClient(credentials,async(input)=>new Response(JSON.stringify(String(input).includes('/purchaseorders/')?{code:0,purchaseorder:{purchaseorder_id:'8',date:'2026-04-01',custom_fields:[{label:'Sales Order No',value:'SO-2627065 & SO-2627071'}],bills:[{bill_id:'9'},{bill_id:'9'}]}}:{code:0,bill:{bill_id:'9',date:'2026-04-02'}})));
 try{const result=await acquirePilotCandidates(c,store,'123',[{module:'purchaseorders',remoteId:'8'}]);assert.equal(result.requests,2);assert.equal(result.acquired,2);assert.equal(result.commercialStatus,'INCOMPLETE');assert.equal(result.failed,0);}finally{store.close();}
});
test('live normalization preserves decimal lexemes beyond JS integer precision',async()=>{
 const {normalizePilotDetail}=await import('../pilot/normalize.ts');
 const d=normalizePilotDetail('/books/v3/salesorders/1','{"code":0,"salesorder":{"salesorder_id":"1","date":"2026-04-01","line_items":[{"line_item_id":"l","quantity":9007199254740993.25}]}}');
 assert.equal(d?.lines[0].quantity,'9007199254740993.25');assert.equal(d?.fyId,'2026-27');
 assert.throws(()=>normalizePilotDetail('/books/v3/salesorders/1','{"code":0,"salesorder":{"salesorder_id":"1","date":"2026-04-01","line_items":[]}}'),/LINES/);
});
test('captured detail publication is idempotent and missing amounts remain unknown',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-pilot-test-'));try{const s=openPilotStore(root);const run=s.start('123');
 s.capture(run,'/books/v3/salesorders/1','{"code":0,"salesorder":{"salesorder_id":"1","date":"2026-04-01","line_items":[{"line_item_id":"l","quantity":1.25,"unit":"Nos"}]}}');
 assert.equal(s.publishCapturedDetails().published,1);assert.equal(s.publishCapturedDetails().published,0);s.close();
 const db=new DatabaseSync(pilotDatabasePath(root),{readOnly:true});try{const row=db.prepare('SELECT quantity,amount,amount_missing_reason FROM document_version_lines').get();assert.equal(row?.quantity,'1.25');assert.equal(row?.amount,null);assert.equal(row?.amount_missing_reason,'AMOUNT_SEMANTICS_NOT_VALIDATED');assert.equal(db.prepare('SELECT count(*) AS n FROM document_versions').get()?.n,1);}finally{db.close();}
 }finally{rmSync(root,{recursive:true});}
});
test('local trace report uses exact document references and leaves financial results unknown',async()=>{
 const {writePilotReport}=await import('../pilot/report.ts');const {readFileSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'v2-pilot-test-'));
 try{const s=openPilotStore(root);const run=s.start('123');
 s.capture(run,'/books/v3/salesorders/1',JSON.stringify({code:0,salesorder:{salesorder_id:'1',salesorder_number:'SO-2627024',date:'2026-05-18',line_items:[{line_item_id:'a',quantity:10}]}}));
 s.capture(run,'/books/v3/purchaseorders/2',JSON.stringify({code:0,purchaseorder:{purchaseorder_id:'2',purchaseorder_number:'P2',date:'2026-05-19',custom_fields:[{label:'Sales Order No',value:' SO-2627024 '}],line_items:[{line_item_id:'b',quantity:3}],bills:[]}}));
 s.capture(run,'/books/v3/purchaseorders/3',JSON.stringify({code:0,purchaseorder:{purchaseorder_id:'3',purchaseorder_number:'SHARED',date:'2026-05-19',custom_fields:[{label:'Sales Order No',value:'SO-2627024 & SO-2627009'}],line_items:[{line_item_id:'c',quantity:2}],bills:[]}}));
 assert.equal(s.publishCapturedDetails().published,3);s.close();const report=readFileSync(writePilotReport(root).path,'utf8');assert.match(report,/SO-2627024 \| 2026-05-18 \| 1 \| 1 \| 0 \| Unknown/);assert.match(report,/SHARED: SO ownership needs review/);assert.match(report,/Status: PARTIAL/);
 }finally{rmSync(root,{recursive:true});}
});
