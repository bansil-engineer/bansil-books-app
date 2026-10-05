/** Local owner report only. No web route, network, credential access or database writes. */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getMasterAuditV2DbPath} from '../../db/db-resolver';
import {buildCommercialGraph,traceSalesOrder} from '../commercial/linkage.ts';
import type {TraceDocument,LinkEvidence,CommercialType,Endpoint} from '../commercial/linkage.ts';
import {PILOT_NUMBERS} from './store.ts';
const singular={SO:'salesorder',PO:'purchaseorder',BILL:'bill',INVOICE:'invoice'} as const;
export function writePilotReport(root:string){
 const db=new DatabaseSync(getMasterAuditV2DbPath(),{readOnly:true});
 try{
  const rows=db.prepare('SELECT d.document_type,d.remote_id,v.* FROM document_current c JOIN document_versions v USING(organization_id,document_id,version_id) JOIN source_documents d USING(organization_id,document_id) ORDER BY d.document_type,d.remote_id').all();
  const orgs=[...new Set(rows.map(r=>String(r.organization_id)))];if(orgs.length!==1)throw Error('REPORT_ORGANIZATION_AMBIGUOUS');
  const snapshotId=createHash('sha256').update(JSON.stringify(rows.map(r=>[r.document_id,r.version_id,r.payload_sha256]))).digest('hex').slice(0,20);
  const scope={organizationId:orgs[0],fyId:'2026-27',snapshotId};
  const docs:TraceDocument[]=[],raw=new Map<string,Record<string,any>>(),numbers=new Map<string,string>(),versionHashes=new Map<string,string>();
  for(const row of rows){
   const type=row.document_type as CommercialType;if(!(type in singular))continue;
   const d=JSON.parse(String(row.raw_payload))[singular[type]];const remoteId=String(row.remote_id);const key=type+':'+remoteId;
   docs.push({...scope,documentType:type,remoteId,versionId:String(row.version_id),fyId:String(row.fy_id),documentDate:String(row.document_date),lineIds:d.line_items.map((l:{line_item_id:string})=>l.line_item_id)});
   raw.set(key,d);numbers.set(key,d[singular[type]+'_number']);versionHashes.set(key,String(row.payload_sha256));
  }
  const endpoint=(d:TraceDocument):Endpoint=>({documentType:d.documentType,remoteId:d.remoteId,versionId:d.versionId,lineId:null});
  const links:LinkEvidence[]=[],warnings:string[]=[];
  const add=(from:TraceDocument,to:TraceDocument,source:TraceDocument,field:string)=>links.push({...scope,id:'link-'+links.length,from:endpoint(from),to:endpoint(to),source:endpoint(source),sourceField:field,evidenceReference:`sha256:${versionHashes.get(source.documentType+':'+source.remoteId)}`});
  for(const po of docs.filter(d=>d.documentType==='PO')){
   const p=raw.get('PO:'+po.remoteId)!;
   const refs=(p.custom_fields??[]).filter((f:{label?:string})=>/^Sales Order No$/i.test(f.label??''));
   const values=[...new Set(refs.map((f:{value?:unknown})=>typeof f.value==='string'?f.value.trim():''))];
   const owners=docs.filter(d=>d.documentType==='SO'&&values.length===1&&values[0]===numbers.get('SO:'+d.remoteId));
   if(owners.length===1)add(owners[0],po,po,'custom_fields[Sales Order No].value');
   else warnings.push(`${numbers.get('PO:'+po.remoteId)}: SO ownership needs review; no automatic allocation.`);
   for(const b of p.bills??[]){const bill=docs.find(d=>d.documentType==='BILL'&&d.remoteId===b.bill_id);if(bill&&!links.some(l=>l.from.remoteId===po.remoteId&&l.to.remoteId===bill.remoteId))add(po,bill,po,'bills[].bill_id');}
  }
  const graph=buildCommercialGraph(scope,docs,links);
  const total=db.prepare('SELECT count(*) AS n FROM v2_pilot_responses').get()?.n;
  const lines=['# Master Audit V2 — Phase 4C Pilot Evidence', '', 'Status: PARTIAL — source acquisition and structural publication verified; commercial completeness remains unproven.', '', `Pilot FY: 2026–27 (Owner approved). Historical evidence floor: 2022-04-01.`, `Snapshot: ${snapshotId}. This combines sequential observations; it is not an atomic remote snapshot.`, '', `Saved HTTP responses: ${total}. Current documents: ${docs.length}.`, '', '| Pilot SO | Date | SO lines | Observed PO references | Observed Bills | Pending / GP |','| --- | --- | ---: | ---: | ---: | --- |'];
  for(const number of PILOT_NUMBERS){
   const so=docs.find(d=>d.documentType==='SO'&&numbers.get('SO:'+d.remoteId)===number);if(!so){lines.push(`| ${number} | Missing | — | — | — | Unknown |`);continue;}
   const trace=traceSalesOrder(graph,so.remoteId);lines.push(`| ${number} | ${so.documentDate} | ${so.lineIds.length} | ${trace.documents.filter(d=>d.documentType==='PO').length} | ${trace.documents.filter(d=>d.documentType==='BILL').length} | Unknown |`);
  }
  lines.push('','## Document evidence','', '| Type | Number | Date | Lines | Version |','| --- | --- | --- | ---: | --- |');
  const safe=(v:unknown)=>String(v??'').replaceAll('|','\\|').replaceAll('\n',' ');
  for(const d of docs)lines.push(`| ${d.documentType} | ${safe(numbers.get(d.documentType+':'+d.remoteId))} | ${d.documentDate} | ${d.lineIds.length} | ${d.versionId} |`);
  lines.push('','## What remains unresolved','','- The SO native PO/Invoice arrays were empty. This does not prove absence of related transactions.','- Custom-field search coverage is incomplete; local historical indexes are candidates only and may be stale.','- Only the exact current Sales Order No custom-field reference supports the displayed SO–PO document links. Leading/trailing whitespace is trimmed; fuzzy matching is not used.','- PO–Bill document references are supported by PO bills[].bill_id. They do not establish SO cost allocation.','- Full invoice coverage, line allocations, pending quantities, landed cost and GP remain unverified.','- Quantities preserve source decimal lexemes. Monetary fields remain null with AMOUNT_SEMANTICS_NOT_VALIDATED.','- The structural seal is not proof of accounting completeness or unchanged-revision coverage.','- The localhost UI remains the earlier fictional demo; this local report is the real pilot evidence view.','','## Safety record','','Zoho accounting writes: 0. Legacy database writes by this pilot: 0. Scope changes: 0. One owner-approved routine access-token refresh completed. New isolated V2 database and journal writes occurred. No commit, push or deployment.','','## Reference','','[Zoho Books purchase-order GET documentation](https://www.zoho.com/books/api/v3/purchase-order/) defines the reference/custom-field discovery parameters. Returned search coverage is evaluated separately.','',...warnings);
  const path=join(root,'data/master-audit-v2/PHASE4C-PILOT-REPORT.md');writeFileSync(path,lines.join('\n')+'\n',{mode:0o600});return {path,snapshotId,documents:docs.length,links:links.length};
 }finally{db.close();}
}
