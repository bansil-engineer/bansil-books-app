import type {VerificationCommand} from './verification-store.ts';
import {validSelection,type VerificationState} from './verification-model.ts';
export async function handleVerification(request:Request,deps:{environment:string|undefined;ownerToken:()=>Promise<string|null>;save:(input:VerificationCommand,token:string)=>Record<string,VerificationState>}){
 const reply=(body:object,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(deps.environment!=='development')return reply({error:'Pilot unavailable in production'},403);
 const origin=request.headers.get('origin');const url=new URL(request.url);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Same-origin local request required'},403);
 const token=await deps.ownerToken();
 if(!token)return reply({error:'Owner sign-in required'},401);
 try{
  const text=await request.text();if(text.length>32768)return reply({error:'Request too large'},400);
  const input=JSON.parse(text);
  if(!input||typeof input.soId!=='string'||!/^\d{1,40}$/.test(input.soId)||typeof input.snapshot!=='string'||!/^[a-f0-9]{20}$/.test(input.snapshot)||!Number.isSafeInteger(input.revision)||input.revision<0||!['VERIFY_PO','UNVERIFY_PO','UNVERIFY'].includes(input.action))return reply({error:'Invalid verification request'},400);
  if(input.action!=='UNVERIFY'&&(typeof input.poId!=='string'||!/^\d{1,40}$/.test(input.poId)))return reply({error:'Invalid PO request'},400);
  if(input.selection!==undefined&&!validSelection(input.selection))return reply({error:'Invalid document selection'},400);
  return reply({states:deps.save(input,token)});
 }catch(e){const message=e instanceof Error?e.message:'';const safe=/^(Source data changed|Verification changed|Sales Order not found|Owner confirmation required|Already verified|No active manual verification|Invalid document selection|Selected PO|Selected document|No Purchase Bill|No linked Invoice|Linked Bill|Linked Bills|Linked Invoice|Shared PO|A Bill|An Invoice|Currency|GST-exclusive|Source subtotal|Negative source|Invoice sales|Document already approved)/.test(message);return reply({error:safe?message:'Verification could not be saved. Reload and try again.'},409);}
}
