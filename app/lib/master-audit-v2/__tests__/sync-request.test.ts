import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDocumentSync} from '../pilot/sync-request.ts';
const input={type:'SO',id:'1',snapshot:'a'.repeat(20)};
test('sync timeout bounds stalled headers, aborts request and does not retry',async()=>{
 let calls=0,signal:AbortSignal|undefined;
 await assert.rejects(requestDocumentSync(input,async(_url,init)=>{calls++;signal=init?.signal as AbortSignal;return new Promise<Response>(()=>{});},15),/timed out.*Reload saved data/);
 assert.equal(calls,1);assert.equal(signal?.aborted,true);
});
test('sync timeout also bounds a stalled response body',async()=>{
 await assert.rejects(requestDocumentSync(input,async()=>new Response(new ReadableStream({start(){}})),15),/timed out/);
});
test('sync preserves successful result and safe API error',async()=>{
 assert.deepEqual(await requestDocumentSync(input,async()=>Response.json({status:'UNCHANGED'}),100),{status:'UNCHANGED'});
 await assert.rejects(requestDocumentSync(input,async()=>Response.json({error:'Saved data changed. Refresh this page and try again.'},{status:409}),100),/Saved data changed/);
 await assert.rejects(requestDocumentSync(input,async()=>new Response('<html>error</html>',{status:502}),100),/unreadable response/);
});
