import type {UnlinkedInput} from './unlinked-bills.ts';
export async function handleUnlinkedBills(request:Request,deps:{environment:string|undefined;owner:()=>Promise<boolean>;discover:(input:UnlinkedInput)=>Promise<unknown>}){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(deps.environment!=='development')return reply({error:'Pilot unavailable in production'},403);
 const url=new URL(request.url);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Same-origin local request required'},403);
 if(!await deps.owner())return reply({error:'Owner sign-in required'},401);
 try{
  const text=await request.text();if(text.length>1024)return reply({error:'Request too large'},400);const v=JSON.parse(text);
  if(!v||Object.keys(v).sort().join(',')!=='poId,snapshot,soId'||typeof v.poId!=='string'||!/^\d{1,40}$/.test(v.poId)||typeof v.soId!=='string'||!/^\d{1,40}$/.test(v.soId)||typeof v.snapshot!=='string'||!/^[a-f0-9]{20}$/.test(v.snapshot))return reply({error:'Invalid discovery request'},400);
  return reply(await deps.discover(v));
 }catch(e){const code=e instanceof Error?e.message:'';return reply({error:code==='DISCOVERY_ALREADY_RUNNING'?'A linked-document search is already running.':code==='DISCOVERY_SO_NOT_ALLOWED'?'Sales Order is outside this pilot.':'Discovery could not finish. Reload saved data before retrying.'},409);}
}
