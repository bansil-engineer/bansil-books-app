import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createInMemoryDatabase, openProductionDatabase } from "../db/connection.ts";
import { parseDecimal as p, formatDecimal as f, addDecimal, subtractDecimal, multiplyDecimal, divideDecimal, quantizeDecimal } from "../decimal.ts";

type DB = ReturnType<typeof createInMemoryDatabase>;
const hash = createHash("sha256").update("{}").digest("hex");
function fixture(): DB {
 const db=createInMemoryDatabase();
 for (const org of ["A","B"]) {
  db.prepare("INSERT INTO organizations VALUES(?)").run(org);
  db.prepare("INSERT INTO financial_years VALUES(?,?,?,?)").run(org,"2025-26","2025-04-01","2026-03-31");
  db.prepare("INSERT INTO financial_years VALUES(?,?,?,?)").run(org,"2026-27","2026-04-01","2027-03-31");
  db.prepare("INSERT INTO source_documents VALUES(?,?,?,?)").run(org,"doc","SO","remote-1");
 }
 return db;
}
function version(db:DB,id="v1", count=1, number=1, date="2026-03-31",fy="2025-26") {
 db.prepare("INSERT INTO document_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("A","doc",id,number,fy,date,"rev1","2026-09-29T00:00:00Z","{}",hash,count);
}
function line(db:DB,id="v1",lineId="line1") {
 db.prepare("INSERT INTO document_version_lines VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("A","doc",id,lineId,"item","Nos","1.2500",4,null,null,null,"NOT_PROVIDED");
}
function seal(db:DB,id="v1") {db.prepare("INSERT INTO version_seals VALUES(?,?,?,?,?,?)").run("A","doc",id,"validation-v1","fixture-evidence","2026-09-29T00:00:00Z");}
function withDB(fn:(db:DB)=>void) {const db=fixture();try{fn(db);}finally{db.close();}}

test("decimal math preserves precision beyond Number.MAX_SAFE_INTEGER",()=>{
 assert.equal(f(addDecimal(p("9007199254740993.01"),p("0.09"))),"9007199254740993.10");
 assert.equal(f(subtractDecimal(p("0.10"),p("0.30"))),"-0.20");
 assert.equal(f(multiplyDecimal(p("1.2500"),p("12.34"))),"15.425000");
 assert.equal(f(p("0.000001")),"0.000001");
});
test("explicit rounding covers signed ties, carries and division",()=>{
 for(const [input,expected] of [["1.245","1.24"],["1.255","1.26"],["-1.245","-1.24"],["-1.255","-1.26"],["9.999","10.00"]])
  assert.equal(f(quantizeDecimal(p(input),2,"HALF_EVEN")),expected);
 assert.equal(f(quantizeDecimal(p("-1.245"),2,"HALF_AWAY_FROM_ZERO")),"-1.25");
 assert.equal(f(quantizeDecimal(p("-1.249"),2,"TRUNCATE")),"-1.24");
 assert.equal(f(divideDecimal(p("1"),p("8"),2,"HALF_EVEN")),"0.12");
 assert.equal(f(divideDecimal(p("1"),p("-8"),2,"HALF_AWAY_FROM_ZERO")),"-0.13");
 assert.equal(f(divideDecimal(p("1.20"),p("0.03"),2,"HALF_EVEN")),"40.00");
 assert.throws(()=>divideDecimal(p("1"),p("0"),2,"HALF_EVEN"),/DIVISION_BY_ZERO/);
});
test("invalid decimals and unsupported scales fail instead of rounding",()=>{
 for(const input of ["NaN","Infinity","1e3"," 1","01.2","-0.00",".2","1.","1."+"0".repeat(31)]) assert.throws(()=>p(input));
 assert.throws(()=>quantizeDecimal(p("1"),-1,"HALF_EVEN"));
 assert.throws(()=>multiplyDecimal(p("0."+"1".repeat(20)),p("0."+"1".repeat(20))));
});
test("organization composite FKs reject cross-org version references",()=>withDB(db=>{
 version(db);
 assert.throws(()=>db.prepare("INSERT INTO version_seals VALUES('B','doc','v1','r','e','t')").run(),/FOREIGN KEY/);
 assert.equal(db.prepare("SELECT count(*) AS n FROM source_documents").get()?.n,2);
}));
test("FY date boundaries are explicit and validated",()=>withDB(db=>{
 version(db); version(db,"v2",0,2,"2026-04-01","2026-27");
 assert.throws(()=>version(db,"v3",0,3,"2026-04-01","2025-26"),/OUTSIDE_FY/);
 assert.throws(()=>version(db,"v4",0,4,"2026-02-30","2025-26"));
}));
test("no publication before completeness seal or with missing lines",()=>withDB(db=>{
 version(db);
 assert.throws(()=>db.prepare("INSERT INTO document_current VALUES('A','doc','v1')").run(),/FOREIGN KEY/);
 assert.throws(()=>seal(db),/INCOMPLETE_LINES/);
 line(db);seal(db);
 db.prepare("INSERT INTO document_current VALUES('A','doc','v1')").run();
 assert.throws(()=>line(db,"v1","line2"),/VERSION_SEALED/);
}));
test("history rejects update, delete and INSERT OR REPLACE",()=>withDB(db=>{
 version(db);line(db);seal(db);
 for(const table of ["document_versions","document_version_lines","version_seals"]){
  assert.throws(()=>db.exec(`UPDATE ${table} SET version_id='changed'`),/APPEND_ONLY/);
  assert.throws(()=>db.exec(`DELETE FROM ${table}`),/APPEND_ONLY/);
 }
 assert.throws(()=>db.exec("INSERT OR REPLACE INTO document_versions SELECT * FROM document_versions"),/APPEND_ONLY/);
}));
test("missing is distinct from zero and decimal validation is enforced by DB",()=>withDB(db=>{
 version(db);
 const insert=db.prepare("INSERT INTO document_version_lines VALUES('A','doc','v1',?,'item','Nos',?,?,?,NULL,NULL,'UNKNOWN')");
 assert.throws(()=>insert.run("bad",null,null,null),/CHECK/);
 assert.throws(()=>insert.run("bad","01.0",1,null),/CHECK/);
 assert.throws(()=>insert.run("bad","1.234",2,null),/CHECK/);
 insert.run("zero","0.00",2,null);
 assert.equal(db.prepare("SELECT quantity FROM document_version_lines").get()?.quantity,"0.00");
}));
test("failed transaction preserves prior current version and has no partial rows",()=>withDB(db=>{
 version(db);line(db);seal(db);db.exec("INSERT INTO document_current VALUES('A','doc','v1')");
 db.exec("BEGIN");
 try{version(db,"v2",2,2);line(db,"v2");seal(db,"v2");assert.fail("must reject incomplete version");}
 catch(error){db.exec("ROLLBACK");assert.match(String(error),/INCOMPLETE_LINES/);}
 assert.equal(db.prepare("SELECT version_id FROM document_current").get()?.version_id,"v1");
 assert.equal(db.prepare("SELECT count(*) AS n FROM document_versions").get()?.n,1);
}));
test("promotion advances only to a sealed version and preserves old evidence",()=>withDB(db=>{
 version(db);line(db);seal(db);db.exec("INSERT INTO document_current VALUES('A','doc','v1')");
 db.exec("BEGIN");version(db,"v2",0,2);seal(db,"v2");db.exec("UPDATE document_current SET version_id='v2'; COMMIT");
 assert.equal(db.prepare("SELECT count(*) AS n FROM document_versions").get()?.n,2);
 assert.throws(()=>db.exec("UPDATE document_current SET version_id='v1'"),/REGRESSION/);
 assert.throws(()=>db.exec("INSERT OR REPLACE INTO document_current VALUES('A','doc','v1')"),/EXPLICIT_PROMOTION/);
 assert.throws(()=>db.exec("DELETE FROM document_current"),/DELETE_FORBIDDEN/);
 assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
}));
test("production disk access fails closed and does not create a file",()=>{
 const target=new URL("../../../../data/master-audit-v2/db/master-audit-v2.sqlite",import.meta.url);
 const before=existsSync(target);
 assert.deepEqual(openProductionDatabase(),{status:"UNAVAILABLE",reason:"DISK_ACCESS_NOT_APPROVED",target:"data/master-audit-v2/db/master-audit-v2.sqlite"});
 assert.equal(existsSync(target),before);
});
test("V2 runtime imports are isolated except for the declarative central feature registry",()=>{
 const root=new URL("../",import.meta.url);
 function walk(dir:URL):void{for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(entry.name==="__tests__")continue;
  const file=new URL(entry.name+(entry.isDirectory()?"/":""),dir);
  if(entry.isDirectory()){walk(file);continue;}
  assert.ok(!["page.tsx","route.ts","layout.tsx"].includes(entry.name));
  if(!entry.name.endsWith(".ts"))continue;
  const source=readFileSync(file,"utf8");
  for(const match of source.matchAll(/from\s+["']([^"']+)["']/g)){
   const spec=match[1];
   const centralRegistry = entry.name === "feature-access.ts" && spec === "../../feature-registry.ts";
   assert.ok(centralRegistry || spec.startsWith("node:") || (spec.startsWith(".") && new URL(spec,file).pathname.startsWith(root.pathname)),spec);
  }
 }}walk(root);
});

test("FY overflow cannot pass CHECK through SQL NULL",()=>withDB(db=>{
 assert.throws(()=>db.exec("INSERT INTO financial_years VALUES('A','overflow','9999-04-01','nonsense')"),/CHECK/);
}));
test("alternate unique-key REPLACE cannot erase immutable identity even with recursive triggers off",()=>withDB(db=>{
 version(db);db.exec("PRAGMA recursive_triggers=OFF");
 assert.throws(()=>db.exec("INSERT OR REPLACE INTO source_documents VALUES('A','different','SO','remote-1')"),/APPEND_ONLY/);
 assert.throws(()=>db.prepare("INSERT OR REPLACE INTO document_versions VALUES('A','doc','different',1,'2025-26','2026-03-31','r','t','{}',?,0)").run(hash),/APPEND_ONLY/);
 assert.equal(db.prepare("SELECT version_id FROM document_versions").get()?.version_id,"v1");
}));
