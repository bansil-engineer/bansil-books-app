import test from 'node:test';import assert from 'node:assert/strict';
import {reconcilePilotPurchaseIndex} from '../pilot/discovery.ts';
import {createPilotClient} from '../pilot/client.ts';
import {createPilotMemoryStore} from '../pilot/store.ts';
const credentials={accessToken:'test',expiresAt:Date.now()+3600000,apiDomain:'https://www.zohoapis.in',organizationId:'123'};
test('missing POs on later pages are recovered with Bills; saved detail is reused and duplicates ignored',async()=>{
 const store=createPilotMemoryStore(),calls:string[]=[];
 const client=createPilotClient(credentials,async(input)=>{
  const u=new URL(String(input));calls.push(u.pathname+u.search);
  const page=u.searchParams.get('page');
  const body=page?{purchaseorders:page==='1'?[{purchaseorder_id:'1',cf_sales_order_no:'SO-2627009'}]:[{purchaseorder_id:'1',cf_sales_order_no:'SO-2627009'},{purchaseorder_id:'53',cf_sales_order_no:'SO-2627009'},{purchaseorder_id:'51',custom_fields:[{api_name:'cf_sales_order_no',value:'SO-2627009'}]},{purchaseorder_id:'99',cf_sales_order_no:'SO-26270090'}],page_context:{page:Number(page),has_more_page:page==='1'}}:u.pathname.includes('/purchaseorders/')?{purchaseorder:{purchaseorder_id:u.pathname.split('/').at(-1),date:'2026-05-08',bills:[{bill_id:'7'}]}}:{bill:{bill_id:'7',date:'2026-05-10'}};
  return new Response(JSON.stringify({code:0,...body}));
 });
 try{const r=await reconcilePilotPurchaseIndex(client,store,'123',new Map([['1',[]]]),new Set());assert.equal(r.pages,2);assert.equal(r.acquired,3);assert.equal(r.reused,1);assert.equal(r.failed,0);assert.equal(r.listTraversalComplete,true);assert.equal(r.commercialStatus,'INCOMPLETE');assert.equal(calls.length,5);assert.ok(!calls.some(c=>c.includes('/purchaseorders/1?')||c.includes('/purchaseorders/99?')));}finally{store.close();}
});
test('page cap and malformed/stalled lists never imply full discovery',async()=>{
 for(const mode of ['cap','stalled','malformed']){
 const store=createPilotMemoryStore();const client=createPilotClient(credentials,async(input)=>new Response(JSON.stringify({code:0,purchaseorders:[{purchaseorder_id:'1'}],page_context:{page:Number(new URL(String(input)).searchParams.get('page')),has_more_page:mode==='malformed'?undefined:true}})));
 try{const r=await reconcilePilotPurchaseIndex(client,store,'123',new Map(),new Set(),mode==='cap'?1:3);assert.equal(r.listTraversalComplete,false);assert.equal(r.commercialStatus,'INCOMPLETE');assert.ok(r.pages<=2);}finally{store.close();}}
});
test('missing Bill retries without refetching a saved PO; invalid identity stays incomplete',async()=>{
 for(const mismatch of [false,true]){
 const store=createPilotMemoryStore();const calls:string[]=[];const client=createPilotClient(credentials,async(input)=>{const u=new URL(String(input));calls.push(u.pathname);return new Response(JSON.stringify({code:0,...(u.searchParams.has('page')?{purchaseorders:[{purchaseorder_id:'1',cf_sales_order_no:'SO-2627009'}],page_context:{page:1,has_more_page:false}}:{bill:{bill_id:mismatch?'9':'7',date:'2026-05-10'}})}));});
 try{const r=await reconcilePilotPurchaseIndex(client,store,'123',new Map([['1',['7']]]),new Set());assert.deepEqual(calls,['/books/v3/purchaseorders','/books/v3/bills/7']);assert.equal(r.failed,mismatch?1:0);}finally{store.close();}}
});
