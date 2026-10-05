import {tenderHubEnabled} from '../../../tender-hub/feature-access';
export const dynamic='force-dynamic';
export function GET(){const enabled=tenderHubEnabled();return Response.json({enabled},{status:enabled?200:403,headers:{'Cache-Control':'no-store'}});}
