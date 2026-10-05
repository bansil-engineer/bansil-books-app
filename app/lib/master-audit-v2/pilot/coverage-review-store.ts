import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existingPath} from './verification-store.ts';
import {readPilotView,type PilotView} from './view-model.ts';
import {validateCoverageCommand,type CoverageCommand,type CoverageReviews,type CoverageReview} from './coverage-review.ts';
export function coverageReviews(db:DatabaseSync):CoverageReviews{
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='v2_coverage_reviews'").get())return {};
 return Object.fromEntries(db.prepare('SELECT * FROM v2_coverage_reviews WHERE seq IN (SELECT max(seq) FROM v2_coverage_reviews GROUP BY document_key)').all().map(r=>[String(r.document_key),{revision:Number(r.seq),snapshot:String(r.snapshot),status:String(r.status) as CoverageReview['status'],note:String(r.note),at:String(r.at),amounts:JSON.parse(String(r.amounts))}]));
}
export function readCoverageReviews(root:string){const db=new DatabaseSync(existingPath(root),{readOnly:true});try{return coverageReviews(db);}finally{db.close();}}
export function appendCoverageReview(db:DatabaseSync,data:PilotView,input:CoverageCommand,actor:string){
 validateCoverageCommand(data,input);const key=input.kind+':'+input.documentId;
 if((coverageReviews(db)[key]?.revision??0)!==input.revision)throw Error('Review: Another review was saved. Reload before editing.');
 db.exec(`CREATE TABLE IF NOT EXISTS v2_coverage_reviews(seq INTEGER PRIMARY KEY AUTOINCREMENT,document_key TEXT NOT NULL,so_id TEXT NOT NULL,snapshot TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,amounts TEXT NOT NULL CHECK(json_valid(amounts)),at TEXT NOT NULL,actor_hash TEXT NOT NULL) STRICT;
 CREATE TRIGGER IF NOT EXISTS v2_coverage_reviews_no_update BEFORE UPDATE ON v2_coverage_reviews BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
 CREATE TRIGGER IF NOT EXISTS v2_coverage_reviews_no_delete BEFORE DELETE ON v2_coverage_reviews BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
 CREATE TRIGGER IF NOT EXISTS v2_coverage_reviews_no_replace BEFORE INSERT ON v2_coverage_reviews WHEN EXISTS(SELECT 1 FROM v2_coverage_reviews WHERE seq=NEW.seq) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`);
 db.prepare('INSERT INTO v2_coverage_reviews(document_key,so_id,snapshot,status,note,amounts,at,actor_hash) VALUES(?,?,?,?,?,?,?,?)').run(key,input.soId,input.snapshot,input.status,input.note.trim(),JSON.stringify(input.amounts),new Date().toISOString(),createHash('sha256').update(actor).digest('hex'));
 return coverageReviews(db);
}
export function saveCoverageReview(root:string,input:CoverageCommand,actor:string){const db=new DatabaseSync(existingPath(root));try{db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');try{const reviews=appendCoverageReview(db,readPilotView(root),input,actor);db.exec('COMMIT');return reviews;}catch(e){db.exec('ROLLBACK');throw e;}}finally{db.close();}}
