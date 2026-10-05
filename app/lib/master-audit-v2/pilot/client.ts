/** Narrow GET-only Books client. No OAuth refresh, token writes or arbitrary URLs. */
export interface PilotCredentials {accessToken:string;expiresAt:number;apiDomain:string;organizationId:string}
export function createPilotClient(credentials:PilotCredentials,transport:typeof fetch=fetch){
 const c={...credentials};const origin=new URL(c.apiDomain);
 if(origin.protocol!=='https:'||!/^www\.zohoapis\.(com|in|eu|com\.au|jp|ca|uk)$/.test(origin.hostname)||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw Error('UNTRUSTED_ZOHO_DOMAIN');
 if(!/^\d+$/.test(c.organizationId))throw Error('ORGANIZATION_REQUIRED');
 let calls=0;
 return {organizationId:c.organizationId,async get(endpoint:string){
  if(!Number.isFinite(c.expiresAt)||Date.now()>=c.expiresAt-30000||!c.accessToken)throw Error('TOKEN_REFRESH_REQUIRED');
  const url=new URL(endpoint,origin.origin);
  if(url.origin!==origin.origin||!/^\/books\/v3\/(salesorders|purchaseorders|invoices|bills)(\/\d+)?$/.test(url.pathname)||url.hash)throw Error('ENDPOINT_NOT_ALLOWED');
  for(const name of url.searchParams.keys())if(!['search_text','salesorder_number','page','per_page','custom_field_contains','reference_number_contains','vendor_id'].includes(name))throw Error('QUERY_NOT_ALLOWED');
  if(url.searchParams.has('vendor_id')&&(url.pathname!=='/books/v3/bills'||!/^\d{1,40}$/.test(url.searchParams.get('vendor_id')!)))throw Error('QUERY_NOT_ALLOWED');
  url.searchParams.set('organization_id',c.organizationId);
  if(++calls>60)throw Error('PILOT_REQUEST_BUDGET_EXCEEDED');
  let response:Response;
  try{response=await transport(url,{method:'GET',redirect:'error',cache:'no-store',headers:{Authorization:`Zoho-oauthtoken ${c.accessToken}`},signal:AbortSignal.timeout(20000)});}catch{throw Error('ZOHO_GET_NETWORK_FAILED');}
  if(!response.ok)throw Error(`ZOHO_GET_HTTP_${response.status}`);
  const raw=await response.text();if(raw.length>10_000_000)throw Error('RESPONSE_TOO_LARGE');
  const body=JSON.parse(raw);if(body.code!==0)throw Error('ZOHO_GET_API_FAILED');
  return {raw,body};
 },requestCount:()=>calls};
}
