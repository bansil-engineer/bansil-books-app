import type {PilotView,PilotDocument} from './view-model.ts';
import type {VerificationState} from './verification-model.ts';
export type SyncResult={data:PilotView;states:Record<string,VerificationState>;status:'CHANGED'|'UNCHANGED'};
/** Sequential, bounded by the saved queue; every request uses the last published snapshot. */
export async function refreshSavedDocuments(data:PilotView,documents:PilotDocument[],deps:{
 request:(input:{type:string;id:string;snapshot:string})=>Promise<SyncResult>;
 progress:(document:PilotDocument,index:number,total:number)=>void;
 published:(result:SyncResult)=>void;
 stopped:()=>boolean;
}){
 let current=data,completed=0;
 const queue=[...new Map(documents.map(d=>[d.key,d])).values()];
 for(const document of queue){
  if(deps.stopped())return {completed,total:queue.length,stopped:true};
  deps.progress(document,completed+1,queue.length);
  const result=await deps.request({type:document.type,id:document.id,snapshot:current.snapshotId});
  current=result.data;completed++;deps.published(result);
 }
 return {completed,total:queue.length,stopped:false};
}
