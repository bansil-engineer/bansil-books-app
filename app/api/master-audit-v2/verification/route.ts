import {pilotFeatureDenied} from '../../../lib/master-audit-v2/pilot/feature-access';
import {cookies} from 'next/headers';
import {hasReadOnlyOwnerSession} from '../../../lib/master-audit-v2/pilot/view-model';
import {saveVerification} from '../../../lib/master-audit-v2/pilot/verification-store';
import {handleVerification} from '../../../lib/master-audit-v2/pilot/verification-http';
export const runtime='nodejs';
export async function POST(request:Request){const denied=pilotFeatureDenied(process.cwd());if(denied)return denied;return handleVerification(request,{
 environment:process.env.NODE_ENV,
 ownerToken:async()=>{const token=(await cookies()).get('bansil_owner_session')?.value;return hasReadOnlyOwnerSession(process.cwd(),token)?token!:null;},
 save:(input,token)=>saveVerification(process.cwd(),input,token),
});}
