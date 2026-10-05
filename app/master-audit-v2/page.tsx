import {pilotFeatureEnabled} from '../lib/master-audit-v2/pilot/feature-access';
import type { Metadata } from 'next';
import {cookies} from 'next/headers';
import {readCoverageReviews} from '../lib/master-audit-v2/pilot/coverage-review-store';
import Preview from './preview';
import PilotViewScreen from './pilot-view';
import {hasReadOnlyOwnerSession,readPilotView} from '../lib/master-audit-v2/pilot/view-model';
import s from './pilot.module.css';
import {readVerificationStates} from '../lib/master-audit-v2/pilot/verification-store';
export const metadata:Metadata={title:'Master Audit V2 — Pilot Evidence',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}){
 if((await searchParams).view==='demo')return <Preview/>;
 // Development pilot only. Production enablement requires the central feature-registry gate.
 if(process.env.NODE_ENV!=='development')return <main className={s.gate}><h1>Pilot unavailable</h1><p>Production enablement and feature controls have not been approved.</p></main>;
 if(!pilotFeatureEnabled(process.cwd()))return <main className={s.gate}><h1>Pilot disabled</h1><p>Enable Master Audit V2 and its parent in Settings → Modules &amp; Features.</p><a href="/">Open Settings</a></main>;
 const token=(await cookies()).get('bansil_owner_session')?.value;
 if(!hasReadOnlyOwnerSession(process.cwd(),token))return <main className={s.gate}><h1>Owner sign-in required</h1><p>Real pilot evidence is protected. Open the existing application, choose Settings → Modules & Features, and use Owner sign-in. Then return here in the same browser. This is separate from Zoho sign-in.</p><a href="/">Open existing application</a><p><a href="/master-audit-v2?view=demo">View fictional demo</a></p><p>This screen does not refresh sessions, read Zoho credentials or write any database.</p></main>;
 try{const data=readPilotView(process.cwd());return <PilotViewScreen data={data} coverageEnabled={pilotFeatureEnabled(process.cwd(),'sub_audit_v2_coverage_review')} coverageReviews={pilotFeatureEnabled(process.cwd(),'sub_audit_v2_coverage_review')?readCoverageReviews(process.cwd()):{}} verifications={readVerificationStates(process.cwd(),data)}/>;}catch{return <main className={s.gate}><h1>Pilot evidence unavailable</h1><p>No complete local projection could be loaded. Source data has not been changed.</p></main>;}
}
