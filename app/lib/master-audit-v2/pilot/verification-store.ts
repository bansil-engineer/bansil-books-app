import {poReview,poProblem,orderPOs} from './po-verification.ts';
import {coverageReviews} from './coverage-review-store.ts';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readPilotView,type PilotView} from './view-model.ts';
import {verificationPreview,emptyVerification,type VerificationState,type VerificationSelection,defaultSelection} from './verification-model.ts';
// This web action requires an existing V2 database. It never creates source databases or folders.
export function existingPath(root:string){const base=realpathSync(root);let path=base;for(const part of ['data','master-audit-v2','db','master-audit-v2.sqlite']){path=join(path,part);if(!existsSync(path)||lstatSync(path).isSymbolicLink())throw Error('Existing isolated V2 database required');}for(const suffix of ['','-wal','-shm','-journal'])if(existsSync(path+suffix)){const s=lstatSync(path+suffix);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Unsafe V2 database path');}return path;}
export function initializeVerification(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS v2_owner_verifications (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, so_id TEXT NOT NULL, snapshot TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('VERIFY','UNVERIFY')), at TEXT NOT NULL, actor_hash TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(json_valid(evidence))) STRICT;
 CREATE TRIGGER IF NOT EXISTS v2_owner_verifications_no_update BEFORE UPDATE ON v2_owner_verifications BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
 CREATE TRIGGER IF NOT EXISTS v2_owner_verifications_no_delete BEFORE DELETE ON v2_owner_verifications BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
 CREATE TRIGGER IF NOT EXISTS v2_owner_verifications_no_replace BEFORE INSERT ON v2_owner_verifications WHEN EXISTS(SELECT 1 FROM v2_owner_verifications WHERE seq=NEW.seq) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`);
}
function latest(db:DatabaseSync){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='v2_owner_verifications' AND type='table'").get())return [];return db.prepare('SELECT * FROM v2_owner_verifications WHERE seq IN (SELECT max(seq) FROM v2_owner_verifications GROUP BY so_id)').all();}
export function verificationStates(db:DatabaseSync,data:PilotView):Record<string,VerificationState>{
 const states:Record<string,VerificationState>={};
 const reviews = coverageReviews(db);
 for(const row of latest(db)){
  const active=row.action==='VERIFY',e=JSON.parse(String(row.evidence));
  const poMode=e.mode==='PO';
  const soId=String(row.so_id);
  const so=data.documents.find(d=>d.type==='SO'&&d.id===soId);
  let same=row.snapshot===data.snapshotId;
  if(same && active && so) {
      const sharedPOIds = new Set(data.documents.filter(d=>d.type==='PO'&&!(d.owners.length===1&&d.owners[0]===so.number)).map(d=>d.id));
      const approvedIds:string[] = e.selection?.poIds ?? [];
      const relevantSharedPOs = approvedIds.filter(id => sharedPOIds.has(id));
      if (relevantSharedPOs.length > 0) {
          if (!e.allocations) same = false;
          else {
              for (const pid of relevantSharedPOs) {
                  const rev = reviews['PO:'+pid];
                  const saved = e.allocations[pid];
                  if (!rev || !saved || rev.revision !== saved.revision || rev.status !== saved.status || rev.snapshot !== saved.snapshot || rev.amounts?.[so.number] !== saved.amount) {
                      same = false;
                      break;
                  }
              }
          }
      }
  }
  states[soId]={revision:Number(row.seq),status:active?(same?(poMode&&!e.allPOsVerified?'INCOMPLETE':'VERIFIED'):'STALE'):'INCOMPLETE',percent:active&&same?e.percent:null,at:String(row.at),selection:active?e.selection:undefined,mode:poMode?'PO':undefined,gpReason:e.gpReason??null,sales:active&&same?e.sales:null,cost:active&&same?e.cost:null,profit:active&&same?e.profit:null,isProvisional:active&&same?e.isProvisional:undefined};
 }return states;
}
export function readVerificationStates(root:string,data:PilotView){const db=new DatabaseSync(existingPath(root),{readOnly:true});try{return verificationStates(db,data);}finally{db.close();}}
export type VerificationCommand={soId:string;snapshot:string;revision:number;action:'VERIFY'|'UNVERIFY'|'VERIFY_PO'|'UNVERIFY_PO';poId?:string;confirmed?:boolean;selection?:VerificationSelection};
/** Caller holds BEGIN IMMEDIATE. Concurrent changes require a fresh preview. */
export function appendVerification(db:DatabaseSync,data:PilotView,input:VerificationCommand,actor:string){
 if(input.snapshot!==data.snapshotId)throw Error('Source data changed. Reload and review again.');
 const prior=verificationStates(db,data)[input.soId]??emptyVerification;
 if(input.revision!==prior.revision)throw Error('Verification changed. Reload and review again.');
 const so=data.documents.find(d=>d.type==='SO'&&d.id===input.soId);if(!so)throw Error('Sales Order not found');
 const reviews=coverageReviews(db);
 let evidence:object={invoiceIds:[],billIds:[],percent:null};
 let storedAction:'VERIFY'|'UNVERIFY'=input.action==='UNVERIFY'?'UNVERIFY':'VERIFY';
 if(input.action==='VERIFY_PO'||input.action==='UNVERIFY_PO'){
  const po=orderPOs(data,input.soId).find(p=>p.id===input.poId);if(!po)throw Error('Selected PO does not belong to this SO');
  const approved=prior.mode==='PO'&&prior.status!=='STALE'?[...(prior.selection?.poIds??[])]:[];
  if(input.action==='VERIFY_PO'){
   const problem=poProblem(data,input.soId,po,reviews);if(problem)throw Error(problem);
   if(approved.includes(po.id))throw Error('Already verified');approved.push(po.id);
  }else{if(!approved.includes(po.id))throw Error('No active manual verification');approved.splice(approved.indexOf(po.id),1);}
  const review=poReview(data,input.soId,approved,reviews);
  // Source-derived Bills only: client-provided Bill/Invoice selections and amounts are ignored.
  const invoiceIds=review.all&&!review.reason?review.selection.invoiceIds:[];
  for(const row of latest(db))if(row.so_id!==input.soId&&row.action==='VERIFY'){
   const old=JSON.parse(String(row.evidence));
   const sharedPOIds=new Set(data.documents.filter(d=>d.type==='PO'&&!(d.owners.length===1&&d.owners[0]===so.number)).map(d=>d.id));
   const sharedBillIds=new Set(data.documents.filter(d=>d.type==='PO'&&sharedPOIds.has(d.id)).flatMap(p=>p.billIds));
   if(approved.some(id=>!sharedPOIds.has(id)&&(old.selection?.poIds??[]).includes(id))||review.billIds.some(id=>!sharedBillIds.has(id)&&old.billIds.includes(id))||invoiceIds.some(id=>old.invoiceIds.includes(id)))throw Error('Document already approved for another SO. Unverify that SO first.');
  }
  const allocations: Record<string, any> = {};
  const allPOs = orderPOs(data, input.soId);
  for(const pid of approved) {
      const p = allPOs.find((x: any) => x.id === pid)!;
      if (!(p.owners.length===1&&p.owners[0]===so.number)) {
          const rev = reviews['PO:'+pid];
          if(rev) allocations[pid] = {revision: rev.revision, status: rev.status, snapshot: rev.snapshot, amount: rev.amounts?.[so.number]};
      }
  }
  evidence={mode:'PO',changedPO:po.id,operation:input.action,allPOsVerified:review.all,selection:{poIds:approved,invoiceIds,billIds:review.billIds},invoiceIds,billIds:review.billIds,fy:so.fy,gpReason:review.reason,percent:review.reason?null:review.gp.percent,sales:review.reason?null:review.gp.sales,cost:review.reason?null:review.gp.cost,profit:review.reason?null:review.gp.profit,isProvisional:review.reason?false:review.gp.isProvisional,currency:so.currency,basis:'OWNER_PO_VERIFIED_AUTO_BILLS_GST_EXCLUSIVE',documents:data.documents.filter(d=>(d.type==='PO'&&approved.includes(d.id))||(d.type==='BILL'&&review.billIds.includes(d.id))||(d.type==='INVOICE'&&invoiceIds.includes(d.id))).map(d=>({key:d.key,version:d.version,sha256:d.sha256})), allocations};
 }else if(input.action==='VERIFY'){
  if(input.confirmed!==true)throw Error('Owner confirmation required');
  if(prior.status==='VERIFIED')throw Error('Already verified');
  const p=verificationPreview(data,input.soId,input.selection,reviews);if(p.reason)throw Error(p.reason);
  for(const row of latest(db))if(row.so_id!==input.soId&&row.action==='VERIFY'){
   const old=JSON.parse(String(row.evidence));
   const sharedPOIds=new Set(data.documents.filter(d=>d.type==='PO'&&!(d.owners.length===1&&d.owners[0]===so.number)).map(d=>d.id));
   const sharedBillIds=new Set(data.documents.filter(d=>d.type==='PO'&&sharedPOIds.has(d.id)).flatMap(p=>p.billIds));
   if(p.pos.some(d=>!sharedPOIds.has(d.id)&&(old.selection?.poIds??[]).includes(d.id))||p.invoices.some(d=>old.invoiceIds.includes(d.id))||p.bills.some(d=>!sharedBillIds.has(d.id)&&old.billIds.includes(d.id)))throw Error('Document already approved for another SO. Unverify that SO first.');
  }
  const allocations: Record<string, any> = {};
  for(const poDoc of p.pos) {
      if (!(poDoc.owners.length===1&&poDoc.owners[0]===so.number)) {
          const rev = reviews['PO:'+poDoc.id];
          if(rev) allocations[poDoc.id] = {revision: rev.revision, status: rev.status, snapshot: rev.snapshot, amount: rev.amounts?.[so.number]};
      }
  }
  evidence={selection:p.selection,excludedLinked:Object.fromEntries(Object.entries(defaultSelection(data,input.soId)).map(([field,ids])=>[field,ids.filter(id=>!p.selection[field as keyof VerificationSelection].includes(id))])),fy:so.fy,invoiceIds:p.invoices.map(d=>d.id),billIds:p.bills.map(d=>d.id),sales:p.sales,cost:p.cost,profit:p.profit,percent:p.percent,isProvisional:p.isProvisional,currency:p.currency,basis:'OWNER_APPROVED_GST_EXCLUSIVE_SOURCE_SUBTOTALS',documents:[...p.pos,...p.invoices,...p.bills].map(d=>({key:d.key,version:d.version,sha256:d.sha256})), allocations};
 }else if(input.action==='UNVERIFY'){if(prior.status==='INCOMPLETE'&&!prior.selection?.poIds.length)throw Error('No active manual verification');}else throw Error('Invalid action');
 initializeVerification(db);
 db.prepare('INSERT INTO v2_owner_verifications(so_id,snapshot,action,at,actor_hash,evidence) VALUES(?,?,?,?,?,?)').run(input.soId,data.snapshotId,storedAction,new Date().toISOString(),createHash('sha256').update(actor).digest('hex'),JSON.stringify(evidence));
 return verificationStates(db,data);
}
export function saveVerification(root:string,input:VerificationCommand,actor:string){const db=new DatabaseSync(existingPath(root));try{db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');try{const data=readPilotView(root);const states=appendVerification(db,data,input,actor);db.exec('COMMIT');return states;}catch(e){db.exec('ROLLBACK');throw e;}}finally{db.close();}}
