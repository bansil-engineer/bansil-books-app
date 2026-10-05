import type {CoverageCommand} from './coverage-review.ts';
export async function handleCoverageReview(request:Request,deps:{environment:string|undefined;owner:()=>Promise<string|null>;save:(input:CoverageCommand,actor:string)=>unknown}){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}}),url=new URL(request.url);
 if(deps.environment!=='development')return reply({error:'Pilot unavailable in production'},403);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Same-origin local request required'},403);
 const actor=await deps.owner();if(!actor)return reply({error:'Owner sign-in required'},401);
 try{
  const text=await request.text();if(text.length>4096)return reply({error:'Request too large'},400);const v=JSON.parse(text);
  if(!v||Object.keys(v).sort().join(',')!=='amounts,documentId,kind,note,revision,snapshot,soId,status'||!/^\d{1,40}$/.test(v.soId)||!/^\d{1,40}$/.test(v.documentId)||!/^[a-f0-9]{20}$/.test(v.snapshot)||!['BILL','PO'].includes(v.kind)||!Number.isSafeInteger(v.revision)||v.revision<0||typeof v.note!=='string'||!v.amounts||typeof v.amounts!=='object'||Array.isArray(v.amounts)||Object.values(v.amounts).some(n=>typeof n!=='string'))return reply({error:'Invalid review request'},400);
  return reply({reviews:deps.save(v,actor)});
 }catch(e){return reply({error:e instanceof Error&&e.message.startsWith('Review:')?e.message:'Review could not be saved. Reload before retrying.'},409);}
}
