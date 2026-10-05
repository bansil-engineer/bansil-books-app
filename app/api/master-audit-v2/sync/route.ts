import {pilotFeatureDenied} from '../../../lib/master-audit-v2/pilot/feature-access';
import {cookies} from 'next/headers';
import {hasReadOnlyOwnerSession} from '../../../lib/master-audit-v2/pilot/view-model';
import {handleDocumentSync} from '../../../lib/master-audit-v2/pilot/document-sync-http';
import {syncDocument} from '../../../lib/master-audit-v2/pilot/document-sync';
import {createPilotClient} from '../../../lib/master-audit-v2/pilot/client';
import {readTokenStore} from '../../../lib/zoho-token-store';
import {getValidAccessToken} from '../../../lib/zoho-api';
export const runtime='nodejs';
export async function POST(request:Request){const denied=pilotFeatureDenied(process.cwd());if(denied)return denied;return handleDocumentSync(request,{
 environment:process.env.NODE_ENV,
 owner:async()=>hasReadOnlyOwnerSession(process.cwd(),(await cookies()).get('bansil_owner_session')?.value),
 sync:input=>syncDocument(process.cwd(),input,async(organizationId,endpoint)=>{
  const before=readTokenStore();if((before?.organization_id||process.env.ZOHO_DEFAULT_ORG_ID)!==organizationId)throw Error('SYNC_ORGANIZATION_MISMATCH');
  const auth=await getValidAccessToken(),token=readTokenStore();
  if(!token||(token.organization_id||process.env.ZOHO_DEFAULT_ORG_ID)!==organizationId)throw Error('SYNC_ORGANIZATION_MISMATCH');
  return createPilotClient({accessToken:auth.token,expiresAt:token.expires_at,apiDomain:token.api_domain,organizationId}).get(endpoint);
 }),
});}
