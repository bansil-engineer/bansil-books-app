import type {SyncInput} from './document-sync.ts';
export async function handleDocumentSync(request:Request,deps:{environment:string|undefined;owner:()=>Promise<boolean>;sync:(input:SyncInput)=>Promise<unknown>}){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(deps.environment!=='development')return reply({error:'Pilot unavailable in production'},403);
 const url=new URL(request.url);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Same-origin local request required'},403);
 if(!await deps.owner())return reply({error:'Owner sign-in required'},401);
 try{const text=await request.text();if(text.length>1024)return reply({error:'Request too large'},400);const v=JSON.parse(text);
 if(!v||Object.keys(v).length!==3||!['SO','PO','BILL','INVOICE'].includes(v.type)||typeof v.id!=='string'||!/^\d{1,40}$/.test(v.id)||typeof v.snapshot!=='string'||!/^[a-f0-9]{20}$/.test(v.snapshot))return reply({error:'Invalid document sync request'},400);
 return reply(await deps.sync(v));
 }catch(e){const code=e instanceof Error?e.message:'';const messages:Record<string,string>={SYNC_SOURCE_CHANGED:'Saved data changed. Refresh this page and try again.',SYNC_ALREADY_RUNNING:'This document is already syncing.',SYNC_DOCUMENT_NOT_SAVED:'Document is not in the saved pilot.',SYNC_ORGANIZATION_MISMATCH:'Zoho organization differs from this pilot.',TOKEN_REFRESH_REQUIRED:'Zoho access token needs refresh.'};return reply({error:messages[code]??'Document sync could not finish. Refresh saved data before retrying.'},409);}
}
