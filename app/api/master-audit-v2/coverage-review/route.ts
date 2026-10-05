import {cookies} from 'next/headers';
import {pilotFeatureDenied,coverageFeatureDenied} from '../../../lib/master-audit-v2/pilot/feature-access';
import {hasReadOnlyOwnerSession} from '../../../lib/master-audit-v2/pilot/view-model';
import {saveCoverageReview} from '../../../lib/master-audit-v2/pilot/coverage-review-store';
import {handleCoverageReview} from '../../../lib/master-audit-v2/pilot/coverage-review-http';
export const runtime='nodejs';
export async function POST(request:Request){const denied=pilotFeatureDenied(process.cwd());if(denied)return denied;const coverageDenied=coverageFeatureDenied(process.cwd());if(coverageDenied)return coverageDenied;return handleCoverageReview(request,{environment:process.env.NODE_ENV,owner:async()=>{const token=(await cookies()).get('bansil_owner_session')?.value;return hasReadOnlyOwnerSession(process.cwd(),token)?token!:null;},save:(input,actor)=>saveCoverageReview(process.cwd(),input,actor)});}
