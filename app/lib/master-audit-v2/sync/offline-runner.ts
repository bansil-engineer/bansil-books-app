/** Fixture simulation only. No transport, disk store, OAuth or checkpoint writer. */
import { createOfflinePublicationStore } from './offline-publication.ts';
import { FIXTURE_RULE } from './fixture-acquisition.ts';
import { planSync } from './planner.ts';
import type { Observation, SavedEvidence, Scope } from './planner.ts';
import type { SyncState } from '../types/schema.ts';
export interface FixtureRunInput {
 observations: readonly Observation[];
 details: ReadonlyMap<string,string>;
 observedAt: string;
 listingComplete: boolean;
 /** Test-only assertion about synthetic revision semantics. Default false.
  * This must never be interpreted as proof about a Zoho list endpoint. */
 simulateCompleteRevisionCoverage?: boolean;
}
export interface FixtureOutcome {
 remoteId: string; classification: SyncState; status:'SKIPPED'|'PUBLISHED'|'FAILED';
 versionId: string|null; reason: string;
}
export function createOfflineRunner(inputScope:Scope,dateFrom:string,dateTo:string) {
 const scope={...inputScope};
 const store=createOfflinePublicationStore(scope,dateFrom,dateTo);
 return {
  run(input:FixtureRunInput) {
   // Preflight the whole listing before any publication: duplicates/scope errors abort it.
   planSync(scope,input.observations,[],null,FIXTURE_RULE,input.listingComplete);
   const saved:SavedEvidence[]=[];
   for(const observation of input.observations){
    const snapshot=store.inspect(observation.remoteId);
    if(snapshot.current===null) continue;
    const version=snapshot.versions.find(v=>v.version_id===snapshot.current);
    if(!version) throw new Error('CURRENT_VERSION_MISSING');
    const seal=snapshot.seals.find(v=>v.version_id===snapshot.current);
    saved.push({...observation,revision:version.source_revision as string|null,
     versionId:version.version_id as string,sealed:!!seal,
     validationRule:seal?.validation_rule_version as string ?? '',revisionContract:FIXTURE_RULE,
     expectedLines:Number(version.expected_line_count),storedLines:snapshot.lines.filter(l=>l.version_id===snapshot.current).length});
   }
   const proof=input.simulateCompleteRevisionCoverage===true
    ?{contractId:FIXTURE_RULE,evidenceReference:'SYNTHETIC_FIXTURE_ASSUMPTION_ONLY',coversDetailChanges:true}:null;
   const plan=planSync(scope,input.observations,saved,proof,FIXTURE_RULE,input.listingComplete);
   const outcomes:FixtureOutcome[]=[];let detailReads=0;
   for(let i=0;i<plan.entries.length;i++){
    const entry=plan.entries[i];
    if(!entry.classification.detailRequired){
     outcomes.push({remoteId:entry.identity.remoteId,classification:'UNCHANGED',status:'SKIPPED',versionId:entry.previousVersionId,reason:entry.classification.reason});continue;
    }
    try {
     detailReads++;
     const raw=input.details.get(entry.identity.remoteId);
     if(raw===undefined) throw new Error('FIXTURE_DETAIL_MISSING');
     const published=store.publish(input.observations[i],raw,input.observedAt,entry.previousVersionId);
     outcomes.push({remoteId:entry.identity.remoteId,classification:entry.classification.state,status:'PUBLISHED',versionId:published.versionId,reason:'OFFLINE_FIXTURE_PUBLISHED'});
    }catch(error){
     outcomes.push({remoteId:entry.identity.remoteId,classification:entry.classification.state,status:'FAILED',versionId:entry.previousVersionId,reason:error instanceof Error?error.message:'FIXTURE_PUBLICATION_FAILED'});
    }
   }
   return {status:input.listingComplete && outcomes.every(o=>o.status!=='FAILED')?'COMPLETE' as const:'INCOMPLETE' as const,
    mode:'OFFLINE_FIXTURE_ONLY' as const,outcomes,detailReads,checkpointAdvanceAllowed:false as const};
  },
  inspect:store.inspect,
  close:store.close,
 };
}
