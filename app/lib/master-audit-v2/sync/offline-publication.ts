/** Owns a private :memory: store. No disk DB handle, path or network client accepted. */
import { createHash } from 'node:crypto';
import { createInMemoryDatabase } from '../db/connection.ts';
import { FIXTURE_RULE, parseFixture } from './fixture-acquisition.ts';
import type { Observation, Scope } from './planner.ts';
export function createOfflinePublicationStore(inputScope: Scope, dateFrom: string, dateTo: string) {
 const scope={...inputScope};
 if(!scope.organizationId.trim() || !scope.fyId.trim()) throw new Error('INVALID_SCOPE');
 const db=createInMemoryDatabase();
 try {
  db.prepare('INSERT INTO organizations VALUES(?)').run(scope.organizationId);
  db.prepare('INSERT INTO financial_years VALUES(?,?,?,?)').run(scope.organizationId,scope.fyId,dateFrom,dateTo);
 } catch(error) {db.close();throw error;}
 function documentId(remoteId:string) { return JSON.stringify([scope.documentType,remoteId]); }
 return {
  publish(expected: Observation, rawPayload: string, observedAt: string, expectedCurrentVersion: string|null) {
   const detail=parseFixture(rawPayload,scope,expected);
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString()!==observedAt) throw new Error('INVALID_OBSERVED_AT');
   const doc=documentId(detail.remoteId), org=scope.organizationId;
   const hash=createHash('sha256').update(rawPayload).digest('hex');
   db.exec('BEGIN IMMEDIATE');
   try {
    const current=db.prepare('SELECT version_id FROM document_current WHERE organization_id=? AND document_id=?').get(org,doc);
    if((current?.version_id??null)!==expectedCurrentVersion) throw new Error('STALE_PLAN');
    const last=db.prepare('SELECT max(version_number) AS n FROM document_versions WHERE organization_id=? AND document_id=?').get(org,doc);
    const number=Number(last?.n??0)+1, version=`v${number}`;
    if(!current) db.prepare('INSERT INTO source_documents VALUES(?,?,?,?)').run(org,doc,scope.documentType,detail.remoteId);
    db.prepare('INSERT INTO document_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(org,doc,version,number,scope.fyId,detail.documentDate,detail.revision,observedAt,rawPayload,hash,detail.expectedLines);
    const insert=db.prepare('INSERT INTO document_version_lines VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const line of detail.lines) insert.run(org,doc,version,line.id,line.itemId,line.unit,line.quantity.value,line.quantity.scale,line.quantity.missingReason,line.amount.value,line.amount.scale,line.amount.missingReason);
    // Seal proves only the documented fixture structure, not accounting completeness.
    db.prepare('INSERT INTO version_seals VALUES(?,?,?,?,?,?)').run(org,doc,version,FIXTURE_RULE,`sha256:${hash}`,observedAt);
    if(current) db.prepare('UPDATE document_current SET version_id=? WHERE organization_id=? AND document_id=?').run(version,org,doc);
    else db.prepare('INSERT INTO document_current VALUES(?,?,?)').run(org,doc,version);
    db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(org,JSON.stringify([doc,version]),'OFFLINE_FIXTURE_PUBLISHED',observedAt,JSON.stringify({documentId:doc,previousVersionId:expectedCurrentVersion,versionId:version,payloadSha256:hash,validationRule:FIXTURE_RULE}));
    db.exec('COMMIT'); return {versionId:version,payloadSha256:hash};
   } catch(error) {db.exec('ROLLBACK');throw error;}
  },
  /** Returns detached rows; no SQL execution or mutation handle is exposed. */
  inspect(remoteId:string) {
   const doc=documentId(remoteId),org=scope.organizationId;
   return {
    current:db.prepare('SELECT version_id FROM document_current WHERE organization_id=? AND document_id=?').get(org,doc)?.version_id??null,
    versions:db.prepare('SELECT * FROM document_versions WHERE organization_id=? AND document_id=? ORDER BY version_number').all(org,doc),
    lines:db.prepare('SELECT * FROM document_version_lines WHERE organization_id=? AND document_id=? ORDER BY version_id,line_id').all(org,doc),
    seals:db.prepare('SELECT * FROM version_seals WHERE organization_id=? AND document_id=?').all(org,doc),
    events:db.prepare("SELECT * FROM audit_events WHERE organization_id=? AND json_extract(evidence_json,'$.documentId')=?").all(org,doc),
    identityCount:db.prepare('SELECT count(*) AS n FROM source_documents WHERE organization_id=? AND document_id=?').get(org,doc)?.n,
   };
  },
  close(){db.close();}
 };
}
