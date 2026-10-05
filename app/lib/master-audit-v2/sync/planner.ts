/** Offline planning only: no network, database, clock or filesystem access.
 * A future adapter must prove that its list revision covers detail-only changes.
 * No production Zoho endpoint currently has that proof registered here.
 */
import type { DocumentIdentity, DocumentType, SyncClassification } from '../types/schema.ts';
export interface Scope { organizationId: string; fyId: string; documentType: DocumentType }
export interface Observation extends DocumentIdentity { fyId: string; revision: string | null }
export interface SavedEvidence extends Observation {
  versionId: string; sealed: boolean; validationRule: string;
  revisionContract: string; expectedLines: number; storedLines: number;
}
export interface RevisionProof {
  contractId: string; evidenceReference: string; coversDetailChanges: boolean;
}
export interface PlanEntry { identity: DocumentIdentity; fyId: string; classification: SyncClassification; previousVersionId: string | null }
const nonempty = (v: string | null): v is string => typeof v === 'string' && v.trim().length > 0;
function identityKey(v: DocumentIdentity): string { return JSON.stringify([v.organizationId,v.documentType,v.remoteId]); }
function assertScope(scope: Scope, v: Observation): void {
  if (!nonempty(scope.organizationId) || !nonempty(scope.fyId) || !nonempty(v.remoteId)) throw new Error('INVALID_IDENTITY');
  if (v.organizationId !== scope.organizationId || v.documentType !== scope.documentType || v.fyId !== scope.fyId) throw new Error('SCOPE_MISMATCH');
}
export function classify(observation: Observation, prior: SavedEvidence | undefined, proof: RevisionProof | null, validationRule: string): SyncClassification {
  if (!nonempty(validationRule)) throw new Error('VALIDATION_RULE_REQUIRED');
  if (prior && (identityKey(prior)!==identityKey(observation) || prior.fyId!==observation.fyId)) throw new Error('SCOPE_MISMATCH');
  if (!prior) return {state:'NEW',reason:'NO_SAVED_VERSION',detailRequired:true};
  const complete = prior.sealed && nonempty(prior.versionId) && prior.validationRule===validationRule &&
    Number.isSafeInteger(prior.expectedLines) && prior.expectedLines>=0 && prior.storedLines===prior.expectedLines;
  if (!complete) return {state:'INCOMPLETE',reason:'SAVED_DETAIL_NOT_COMPLETE',detailRequired:true};
  if (!proof || !proof.coversDetailChanges || !nonempty(proof.contractId) || !nonempty(proof.evidenceReference) || prior.revisionContract!==proof.contractId)
    return {state:'INCOMPLETE',reason:'REVISION_COVERAGE_UNPROVEN',detailRequired:true};
  if (!nonempty(observation.revision) || !nonempty(prior.revision)) return {state:'INCOMPLETE',reason:'REVISION_MISSING',detailRequired:true};
  if (observation.revision!==prior.revision) return {state:'CHANGED',reason:'SOURCE_REVISION_CHANGED',detailRequired:true};
  return {state:'UNCHANGED',reason:'SEALED_DETAIL_AND_PROVEN_REVISION_MATCH',detailRequired:false};
}
/** A plan is not a completed sync run, checkpoint, deletion list or watermark. */
export function planSync(scope: Scope, observations: readonly Observation[], saved: readonly SavedEvidence[], proof: RevisionProof | null, validationRule: string, listingComplete: boolean) {
  if (!nonempty(validationRule)) throw new Error('VALIDATION_RULE_REQUIRED');
  const old = new Map<string,SavedEvidence>();
  for (const row of saved) {
    assertScope(scope,row); const key=identityKey(row);
    if (old.has(key)) throw new Error('DUPLICATE_SAVED_IDENTITY');
    old.set(key,row);
  }
  const seen = new Set<string>();
  const entries: PlanEntry[] = observations.map(row=>{
    assertScope(scope,row); const key=identityKey(row);
    if (seen.has(key)) throw new Error('DUPLICATE_LIST_IDENTITY');
    seen.add(key); const prior=old.get(key);
    return {identity:{organizationId:row.organizationId,documentType:row.documentType,remoteId:row.remoteId},fyId:row.fyId,
      classification:classify(row,prior,proof,validationRule),previousVersionId:prior?.versionId??null};
  });
  return {entries, detailQueue:entries.filter(e=>e.classification.detailRequired),
    listingStatus:listingComplete?'COMPLETE' as const:'INCOMPLETE' as const,
    // Even a complete listing cannot advance a watermark before detail validation/publication.
    checkpointAdvanceAllowed:false as const};
}
