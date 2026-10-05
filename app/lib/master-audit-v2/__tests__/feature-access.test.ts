import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pilotFeatureEnabled,pilotFeatureDenied,PILOT_FEATURE} from '../pilot/feature-access.ts';
test('central feature and parent OFF block access, ON restores it without data loss',()=>{
 const root=mkdtempSync(join(tmpdir(),'v2-gate-'));mkdirSync(join(root,'data'));const db=new DatabaseSync(join(root,'data/bansil_books.db'));
 try{db.exec('CREATE TABLE app_feature_settings(feature_key TEXT PRIMARY KEY,enabled INTEGER);CREATE TABLE preserved(value TEXT);INSERT INTO preserved VALUES (\'keep\')');
 assert.equal(pilotFeatureEnabled(root),true);
 for(const key of [PILOT_FEATURE,'module_audit_workspace']){db.prepare('INSERT OR REPLACE INTO app_feature_settings VALUES (?,0)').run(key);assert.equal(pilotFeatureEnabled(root),false);assert.equal(pilotFeatureDenied(root)?.status,403);db.prepare('UPDATE app_feature_settings SET enabled=1 WHERE feature_key=?').run(key);assert.equal(pilotFeatureEnabled(root),true);}
 assert.equal(db.prepare('SELECT value FROM preserved').get()?.value,'keep');assert.equal(db.prepare('SELECT count(*) n FROM app_feature_settings').get()?.n,2);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test('missing settings fail closed and all real V2 entrypoints enforce the central gate',()=>{
 assert.equal(pilotFeatureEnabled('/does-not-exist'),false);
 for(const route of ['sync','verification','discovery','coverage-review','unlinked-bills']){const source=readFileSync(new URL(`../../../api/master-audit-v2/${route}/route.ts`,import.meta.url),'utf8');assert.match(source,/const denied=pilotFeatureDenied\(process.cwd\(\)\);if\(denied\)return denied/);}
 const page=readFileSync(new URL('../../../master-audit-v2/page.tsx',import.meta.url),'utf8');assert.match(page,/if\(!pilotFeatureEnabled\(process.cwd\(\)\)\)/);assert.match(page,/NODE_ENV!=='development'/);
});

test('coverage feature respects its own flag and parent flags without clearing review data',()=>{const root=mkdtempSync(join(tmpdir(),'v2-coverage-gate-'));mkdirSync(join(root,'data'));const db=new DatabaseSync(join(root,'data/bansil_books.db'));try{db.exec("CREATE TABLE app_feature_settings(feature_key TEXT PRIMARY KEY,enabled INTEGER)");for(const key of ['sub_audit_v2_coverage_review',PILOT_FEATURE,'module_audit_workspace']){db.prepare('INSERT OR REPLACE INTO app_feature_settings VALUES (?,0)').run(key);assert.equal(pilotFeatureEnabled(root,'sub_audit_v2_coverage_review'),false);db.prepare('UPDATE app_feature_settings SET enabled=1 WHERE feature_key=?').run(key);assert.equal(pilotFeatureEnabled(root,'sub_audit_v2_coverage_review'),true);}for(const route of ['coverage-review','unlinked-bills'])assert.match(readFileSync(new URL(`../../../api/master-audit-v2/${route}/route.ts`,import.meta.url),'utf8'),/coverageFeatureDenied\(process.cwd\(\)\)/);}finally{db.close();rmSync(root,{recursive:true,force:true});}});
