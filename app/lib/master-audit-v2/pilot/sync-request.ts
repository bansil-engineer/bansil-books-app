/** Bounded browser request. A timeout does not imply the server cancelled publication. */
export function requestDocumentSync(input:{type:string;id:string;snapshot:string},transport:typeof fetch=fetch,timeoutMs=45000):Promise<unknown>{return requestPilotAction('/api/master-audit-v2/sync',input,transport,timeoutMs);}
export function requestLinkedDiscovery(input:{soId:string;snapshot:string}){return requestPilotAction('/api/master-audit-v2/discovery',input,fetch,100000);}
export async function requestPilotAction(path:'/api/master-audit-v2/sync'|'/api/master-audit-v2/discovery',input:unknown,transport:typeof fetch=fetch,timeoutMs=45000):Promise<unknown>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{reject(Error('Sync response timed out. Reload saved data to check the result before trying again.'));controller.abort();},timeoutMs);});
 const request=(async()=>{
  const response=await transport(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
  let result;
  try{result=await response.json();}catch{throw Error('Sync returned an unreadable response. Reload saved data to check the result.');}
  if(!response.ok)throw Error(result.error??'Sync failed. Reload saved data before trying again.');
  return result;
 })();
 try{return await Promise.race([request,timeout]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
