const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CONNECTORS = Object.freeze([
  {id:'zoho',name:'Zoho Books',available:true,permissions:'Approved READ scopes only · accounting WRITE blocked'},
  {id:'openai',name:'OpenAI',available:true,permissions:'AI Orchestrator prompts and responses'},
  {id:'claude',name:'Claude / Anthropic',available:true,permissions:'AI Orchestrator prompts and responses'},
  {id:'gemini',name:'Gemini / Antigravity',available:true,permissions:'AI Orchestrator coding bridge'},
  {id:'sharepoint',name:'SharePoint / Microsoft 365',available:false,permissions:'No server connector implemented'},
  {id:'email',name:'Email / Outlook / Gmail',available:false,permissions:'Manual drafts only · no sending connector'},
  {id:'web',name:'External web research / rate feeds',available:false,permissions:'Research tool is a stub · no feed connector'},
]);
function policyPath(){return path.join(process.env.ORCHESTRATOR_PROJECT_DIR || process.cwd(),'data','external-connections.json');}
function defaults(){return {version:1,revision:0,enabled:Object.fromEntries(CONNECTORS.map(c=>[c.id,c.available])),updatedAt:null};}
function readPolicy(file=policyPath()){
  try{
    const p=JSON.parse(fs.readFileSync(file,'utf8'));
    if(p.version!==1||!Number.isSafeInteger(p.revision)||p.revision<0||!p.enabled||CONNECTORS.some(c=>typeof p.enabled[c.id]!=='boolean'))throw Error('Invalid connection policy');
    return {...p,enabled:Object.fromEntries(CONNECTORS.map(c=>[c.id,c.available&&p.enabled[c.id]]))};
  }catch(e){if(e.code==='ENOENT')return defaults();throw Error('Connection policy cannot be read; external access blocked');}
}
function assertConnectionAllowed(id,file=policyPath()){
  const c=CONNECTORS.find(c=>c.id===id);
  if(!c?.available||!readPolicy(file).enabled[id])throw Error(`${c?.name||id}: app connection disconnected; external request blocked`);
}
function writePolicy(action,id,expectedRevision,file=policyPath()){
  if(!['connect','disconnect','disconnect-all'].includes(action))throw Error('Invalid action');
  const c=CONNECTORS.find(c=>c.id===id);
  if(action!=='disconnect-all'&&!c)throw Error('Unknown connector');
  if(action==='connect'&&!c.available)throw Error('Connector not implemented');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const lock=file+'.lock';let fd;
  try{
    fd=fs.openSync(lock,'wx',0o600);
    const p=readPolicy(file);
    if(expectedRevision!==p.revision)throw Error('Connection settings changed; refresh and try again');
    if(action==='disconnect-all')for(const c of CONNECTORS)p.enabled[c.id]=false;
    else p.enabled[id]=action==='connect';
    p.revision++;p.updatedAt=new Date().toISOString();
    const tmp=file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(p,null,2),{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    return p;
  }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
async function connectionFetch(id,input,init={}){
  assertConnectionAllowed(id);
  const controller=new AbortController();
  const timer=setInterval(()=>{try{assertConnectionAllowed(id);}catch{controller.abort(Error('App connection disconnected'));}},250);
  try{
    const signal=init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal;
    const response=await fetch(input,{...init,signal});
    // Existing callers use JSON, not streaming. Keep the guard active through body consumption.
    const bytes=response.body?await response.arrayBuffer():null;
    clearInterval(timer);
    return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(e){clearInterval(timer);throw e;}
}
function localControlRequest(request){
  const u=new URL(request.url), host=request.headers.get('host')||u.host;
  if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||host!==u.host)throw Error('Connection controls require the local application host');
  if(request.method!=='GET'&&(request.headers.get('origin')!==u.origin||request.headers.get('sec-fetch-site')==='cross-site'))throw Error('Same-origin local request required');
}
module.exports={CONNECTORS,policyPath,defaults,readPolicy,writePolicy,assertConnectionAllowed,connectionFetch,localControlRequest};
