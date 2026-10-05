import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {hasReadOnlyOwnerSession,readPilotView} from '../pilot/view-model.ts';import {openPilotStore} from '../pilot/store.ts';
test('owner gate fails closed, does not create missing DB or update session records',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-view-test-'));try{
 assert.equal(hasReadOnlyOwnerSession(root,'x'),false);assert.equal(existsSync(join(root,'data/audit_workspace.db')),false);mkdirSync(join(root,'data'));
 const db=new DatabaseSync(join(root,'data/audit_workspace.db'));db.exec("CREATE TABLE audit_sessions(session_token TEXT,expires_at TEXT,last_seen_at TEXT); INSERT INTO audit_sessions VALUES('valid','2099-01-01T00:00:00.000Z','unchanged'),('expired','2000-01-01T00:00:00.000Z','unchanged')");
 assert.equal(hasReadOnlyOwnerSession(root,'valid'),true);assert.equal(hasReadOnlyOwnerSession(root,'expired'),false);assert.equal(hasReadOnlyOwnerSession(root,"' OR 1=1--"),false);assert.equal(db.prepare('SELECT count(*) AS n FROM audit_sessions').get()?.n,2);assert.ok(db.prepare('SELECT last_seen_at FROM audit_sessions').all().every(r=>r.last_seen_at==='unchanged'));db.close();
 }finally{rmSync(root,{recursive:true});}
});
test('pilot projection minimizes sensitive data and verifies exact parent line IDs',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-view-test-'));try{const s=openPilotStore(root);const run=s.start('123');
 const input=[['salesorders','salesorder',{salesorder_id:'1',salesorder_number:'SO-2627024',date:'2026-05-01',billing_address:{address:'PRIVATE_ADDRESS'},line_items:[{line_item_id:'sl',quantity:10,name:'Item'}]}],['purchaseorders','purchaseorder',{purchaseorder_id:'2',purchaseorder_number:'PO2',date:'2026-05-02',custom_fields:[{label:'Sales Order No',value:'SO-2627024'}],bills:[{bill_id:'3'}],line_items:[{line_item_id:'pl',quantity:5,name:'Item'}]}],['bills','bill',{bill_id:'3',bill_number:'B3',date:'2026-05-03',line_items:[{line_item_id:'bl',quantity:2,name:'Item',purchaseorder_id:'2',purchaseorder_item_id:'pl'},{line_item_id:'bl2',quantity:1,purchaseorder_id:'2',purchaseorder_item_id:'missing'}]}]] as const;
 for(const [module,singular,d] of input)s.capture(run,'/books/v3/'+module+'/'+(d as Record<string,unknown>)[singular+'_id'],JSON.stringify({code:0,[singular]:d}));assert.equal(s.publishCapturedDetails().published,3);s.close();
 const view=readPilotView(root);assert.equal(view.documents.length,3);assert.equal(view.coverage,'INCOMPLETE');assert.ok(!JSON.stringify(view).includes('PRIVATE_ADDRESS'));const b=view.documents.find(d=>d.type==='BILL')!;assert.equal(b.lines.find(l=>l.id==='bl')?.referenceStatus,'MATCHED');assert.equal(b.lines.find(l=>l.id==='bl2')?.referenceStatus,'UNRESOLVED');assert.equal(view.documents.find(d=>d.type==='PO')?.lines[0].referenceStatus,'ABSENT');
 }finally{rmSync(root,{recursive:true});}
});
test('purchase source money is lossless, zero stays zero and missing values are not inferred',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-money-test-'));try{const s=openPilotStore(root);const run=s.start('123');
 s.capture(run,'/books/v3/purchaseorders/2','{"code":0,"purchaseorder":{"purchaseorder_id":"2","purchaseorder_number":"PO2","date":"2026-05-02","currency_code":"INR","is_inclusive_tax":false,"sub_total":9007199254740993.25,"tax_total":0,"total":9007199254740993.25,"line_items":[{"line_item_id":"pl","quantity":1,"rate":9007199254740993.25,"item_total":9007199254740993.25},{"line_item_id":"p2","quantity":0,"rate":0,"item_total":0},{"line_item_id":"p3","quantity":2,"rate":"invalid"}]}}');
 assert.equal(s.publishCapturedDetails().published,1);s.close();const d=readPilotView(root).documents[0];assert.equal(d.currency,'INR');assert.equal(d.priceTaxBasis,'EXCLUSIVE');assert.equal(d.purchaseTotal,'9007199254740993.25');assert.equal(d.purchaseTax,'0');assert.equal(d.lines.find(l=>l.id==='pl')?.purchaseRate,'9007199254740993.25');assert.equal(d.lines.find(l=>l.id==='p2')?.purchaseAmount,'0');assert.equal(d.lines.find(l=>l.id==='p3')?.purchaseRate,null);assert.equal(d.lines.find(l=>l.id==='p3')?.purchaseAmount,null);
 }finally{rmSync(root,{recursive:true});}
});
test('invoice projection preserves explicit SO references and exact sales amounts separately from purchases',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-invoice-view-'));try{const s=openPilotStore(root);const run=s.start('123');
 s.capture(run,'/books/v3/salesorders/1',JSON.stringify({code:0,salesorder:{salesorder_id:'1',date:'2026-05-01',invoices:[{invoice_id:'9'},{invoice_id:'9'},{invoice_id:'10'}],line_items:[{line_item_id:'s',quantity:1}]}}));
 s.capture(run,'/books/v3/invoices/9','{"code":0,"invoice":{"invoice_id":"9","invoice_number":"INV9","date":"2026-05-02","salesorder_id":"1","salesorders":[{"salesorder_id":"1"},{"salesorder_id":"2"}],"currency_code":"INR","sub_total":123.45,"tax_total":22.221,"total":145.671,"line_items":[{"line_item_id":"i","quantity":1,"rate":123.45,"item_total":123.45}]}}');
 assert.equal(s.publishCapturedDetails().published,2);s.close();const v=readPilotView(root),so=v.documents.find(d=>d.type==='SO')!,inv=v.documents.find(d=>d.type==='INVOICE')!;assert.deepEqual(so.invoiceIds,['9','10']);assert.deepEqual(inv.salesOrderIds,['1','2']);assert.equal(inv.salesTotal,'145.671');assert.equal(inv.lines[0].salesRate,'123.45');assert.equal(inv.purchaseTotal,null);assert.equal(inv.lines[0].purchaseRate,null);assert.equal(v.coverage,'INCOMPLETE');
 }finally{rmSync(root,{recursive:true});}
});
