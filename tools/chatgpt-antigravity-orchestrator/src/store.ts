import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { WorkflowError, terminal } from './types.ts';
import type { Approval, Decision, Gate, State, Task } from './types.ts';
const transitions:Record<State,State[]>={QUEUED:['PLANNING','PAUSED','REJECTED','FAILED'],PLANNING:['AWAITING_APPROVAL','PAUSED','REJECTED','RUNNING','FAILED'],RUNNING:['AWAITING_APPROVAL','PAUSED','REJECTED','REVIEWING','FAILED'],REVIEWING:['AWAITING_APPROVAL','PAUSED','REJECTED','PLANNING','COMPLETED','FAILED'],AWAITING_APPROVAL:['PAUSED','RUNNING','PLANNING','COMPLETED','REJECTED','FAILED'],PAUSED:['QUEUED','REJECTED'],COMPLETED:[],REJECTED:[],FAILED:[]};
export class Store {
  db:DatabaseSync;
  constructor(file=path.join(process.cwd(),'data','orchestrator.db')){
    mkdirSync(path.dirname(file),{recursive:true,mode:0o700}); this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,state TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,kind TEXT NOT NULL,details TEXT NOT NULL,decision TEXT,createdAt TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_gate ON approvals(taskId) WHERE decision IS NULL;
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,details TEXT NOT NULL,createdAt TEXT NOT NULL);`);
  }
  tx<T>(fn:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v}catch(e){this.db.exec('ROLLBACK');throw e}}
  event(taskId:string,kind:string,details:string,actor='SYSTEM'){this.db.prepare('INSERT INTO events(taskId,kind,actor,details,createdAt) VALUES(?,?,?,?,?)').run(taskId,kind,actor,details,new Date().toISOString())}
  create(request:string,auto:boolean,maxRounds:number){
    if(!request.trim()||request.length>12000||typeof auto!=='boolean'||!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>5)throw new WorkflowError('Task must be 1–12000 characters and rounds 1–5.',400);
    const now=new Date().toISOString(); const t:Task={id:randomUUID(),request:request.trim(),state:'QUEUED',auto,acceptAllReadOnly:false,maxRounds,round:0,plan:null,report:null,review:null,error:null,createdAt:now,updatedAt:now,version:1};
    return this.tx(()=>{if(Number(this.db.prepare("SELECT COUNT(*) n FROM tasks WHERE state NOT IN ('COMPLETED','REJECTED','FAILED')").get()?.n)>=20)throw new WorkflowError('Queue full.');this.db.prepare('INSERT INTO tasks VALUES(?,?,?)').run(t.id,t.state,JSON.stringify(t));this.event(t.id,'CREATED',t.request,'OWNER');return t});
  }
  get(id:string):Task{const r=this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id);if(!r)throw new WorkflowError('Task not found',404);return JSON.parse(String(r.body))}
  list():Task[]{return this.db.prepare('SELECT body FROM tasks ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.body)))}
  history(id:string){return this.db.prepare('SELECT * FROM events WHERE taskId=? ORDER BY id').all(id)}
  remove(id:string){return this.tx(()=>{const t=this.get(id);if(!terminal(t.state))throw new WorkflowError('Only completed, failed or rejected tasks can be deleted.',409);this.db.prepare('DELETE FROM approvals WHERE taskId=?').run(id);this.db.prepare('DELETE FROM events WHERE taskId=?').run(id);this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);return t})}
  pending(id:string){return (this.db.prepare('SELECT * FROM approvals WHERE taskId=? AND decision IS NULL').get(id) as unknown as Approval)??null}
  approval(id:string){return this.db.prepare('SELECT * FROM approvals WHERE id=?').get(id) as unknown as Approval}
  move(id:string,state:State,patch:Partial<Task>={}){const t=this.get(id);if(!transitions[t.state].includes(state))throw new WorkflowError(`Cannot move ${t.state} to ${state}`);const n={...t,...patch,id:t.id,state,version:t.version+1,updatedAt:new Date().toISOString()};this.db.prepare('UPDATE tasks SET state=?,body=? WHERE id=?').run(state,JSON.stringify(n),id);this.event(id,state,JSON.stringify(patch));return n}
  transition(id:string,state:State,patch:Partial<Task>={}){return this.tx(()=>this.move(id,state,patch))}
  gate(id:string,kind:Gate,details:string){return this.tx(()=>{const a:Approval={id:randomUUID(),taskId:id,kind,details,decision:null,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?)').run(a.id,id,kind,details,null,a.createdAt);this.move(id,'AWAITING_APPROVAL');this.event(id,'GATE',JSON.stringify(a));return a})}
  decide(id:string,approvalId:string,decision:Decision,note=''){return this.tx(()=>{const t=this.get(id),a=this.pending(id);if(t.state!=='AWAITING_APPROVAL'||!a||a.id!==approvalId)throw new WorkflowError('Stale approval. Refresh.');if(!['ACCEPT','ACCEPT_ALL','REJECT','UNTOUCH'].includes(decision)||note.length>2000||decision==='ACCEPT_ALL'&&a.kind!=='TOOL')throw new WorkflowError('Invalid decision',400);this.event(id,decision,JSON.stringify({approvalId,note,scope:decision==='ACCEPT_ALL'?'CURRENT_TASK_READ_ONLY_TOOLS':undefined}),'OWNER');if(decision==='ACCEPT_ALL'){const current=this.get(id);this.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify({...current,acceptAllReadOnly:true}),id)}if(decision!=='UNTOUCH')this.db.prepare('UPDATE approvals SET decision=? WHERE id=?').run(decision,approvalId);if(decision==='REJECT')this.move(id,'REJECTED');return this.get(id)})}
  claim(){return this.tx(()=>{const r=this.db.prepare("SELECT id FROM tasks WHERE state='QUEUED' ORDER BY rowid LIMIT 1").get();if(!r)return null;const t=this.get(String(r.id));return this.move(t.id,'PLANNING',{round:t.round||1})})}
  pause(id:string){return this.tx(()=>{const t=this.get(id);if(terminal(t.state)||t.state==='PAUSED')return t;this.db.prepare("UPDATE approvals SET decision='REJECT' WHERE taskId=? AND decision IS NULL").run(id);return this.move(id,'PAUSED',{error:null})})}
  resume(id:string){return this.transition(id,'QUEUED',{error:null})}
  stop(id:string){return this.tx(()=>{const t=this.get(id);if(terminal(t.state))return t;this.db.prepare("UPDATE approvals SET decision='REJECT' WHERE taskId=? AND decision IS NULL").run(id);return this.move(id,'REJECTED',{error:'Stopped by owner.'})})}
  fail(id:string,message:string){this.tx(()=>{if(terminal(this.get(id).state))return;this.db.prepare("UPDATE approvals SET decision='REJECT' WHERE taskId=? AND decision IS NULL").run(id);this.move(id,'FAILED',{error:message})})}
  recover(){this.tx(()=>{for(const r of this.db.prepare("SELECT id FROM tasks WHERE state NOT IN ('QUEUED','PAUSED','COMPLETED','REJECTED','FAILED')").all()){const id=String(r.id);this.db.prepare("UPDATE approvals SET decision='REJECT' WHERE taskId=? AND decision IS NULL").run(id);this.move(id,'FAILED',{error:'Server interrupted. Inspect the project before creating another task; no automatic replay.'})}})}
}
