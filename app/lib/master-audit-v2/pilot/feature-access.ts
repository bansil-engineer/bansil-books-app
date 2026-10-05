/** Uses the central feature registry and settings, without legacy migrations or writes. */
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {getBansilBooksDbPath} from '../../db/db-resolver';
import {getFeatureDefinition,isFeatureEffectivelyEnabled} from '../../feature-registry.ts';
export const PILOT_FEATURE='sub_audit_v2_pilot';
export function pilotFeatureEnabled(root:string,feature=PILOT_FEATURE){
 let db:DatabaseSync|undefined;
 try{
  if(!getFeatureDefinition(feature))return false;
  db=new DatabaseSync(getBansilBooksDbPath(),{readOnly:true});
  const settings:Record<string,boolean>={};
  for(const row of db.prepare('SELECT feature_key,enabled FROM app_feature_settings').all())settings[String(row.feature_key)]=Boolean(row.enabled);
  return isFeatureEffectivelyEnabled(feature,settings);
 }catch{return false;}finally{db?.close();}
}
export function pilotFeatureDenied(root:string){return pilotFeatureEnabled(root)?null:Response.json({error:'Master Audit V2 is disabled in Settings > Modules & Features.'},{status:403,headers:{'Cache-Control':'no-store'}});}

export function coverageFeatureDenied(root:string){return pilotFeatureEnabled(root,'sub_audit_v2_coverage_review')?null:Response.json({error:'Coverage review is disabled in Settings > Modules & Features.'},{status:403,headers:{'Cache-Control':'no-store'}});}
