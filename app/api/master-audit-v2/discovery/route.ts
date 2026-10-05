import {cookies} from 'next/headers';
import {pilotFeatureDenied} from '../../../lib/master-audit-v2/pilot/feature-access';
import {hasReadOnlyOwnerSession} from '../../../lib/master-audit-v2/pilot/view-model';
import {handleLinkedDiscovery} from '../../../lib/master-audit-v2/pilot/linked-discovery-http';
import {discoverLinkedDocuments} from '../../../lib/master-audit-v2/pilot/linked-discovery';
import {createPilotClient} from '../../../lib/master-audit-v2/pilot/client';
import {readTokenStore} from '../../../lib/zoho-token-store';
import {getValidAccessToken} from '../../../lib/zoho-api';
export const runtime='nodejs';
export async function POST(request:Request){
 const denied=pilotFeatureDenied(process.cwd());if(denied)return denied;
 return handleLinkedDiscovery(request,{
  environment:process.env.NODE_ENV,
  owner:async()=>hasReadOnlyOwnerSession(process.cwd(),(await cookies()).get('bansil_owner_session')?.value),
  discover:input=>discoverLinkedDocuments(process.cwd(),input,async(organizationId,endpoint)=>{
   const before=readTokenStore();if((before?.organization_id||process.env.ZOHO_DEFAULT_ORG_ID)!==organizationId)throw Error('SYNC_ORGANIZATION_MISMATCH');
   const auth=await getValidAccessToken(),token=readTokenStore();
   if(!token||(token.organization_id||process.env.ZOHO_DEFAULT_ORG_ID)!==organizationId)throw Error('SYNC_ORGANIZATION_MISMATCH');
   return createPilotClient({accessToken:auth.token,expiresAt:token.expires_at,apiDomain:token.api_domain,organizationId}).get(endpoint);
  }),
 });
}
