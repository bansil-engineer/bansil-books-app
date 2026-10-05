import { CONNECTORS, readPolicy, writePolicy, localControlRequest } from '@/app/lib/external-connections.cjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const respond = (body: unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
  try{localControlRequest(request);return respond({policy:readPolicy(),connectors:CONNECTORS});}
  catch(e){return respond({error:e instanceof Error?e.message:'Connection controls unavailable'},403);}
}
export async function POST(request:Request){
  try{
    localControlRequest(request);
    if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'JSON required'},415);
    const text=await request.text();if(text.length>2000)return respond({error:'Request too large'},413);
    const body=JSON.parse(text);
    if(!body||typeof body.action!=='string'||typeof body.id!=='string'||!Number.isSafeInteger(body.revision))return respond({error:'Invalid request'},400);
    return respond({policy:writePolicy(body.action,body.id,body.revision),connectors:CONNECTORS});
  }catch(e){return respond({error:e instanceof Error?e.message:'Connection change failed'},400);}
}
