/** Offline evidence graph. References do not prove allocation, fulfilment or margin. */
export type CommercialType='SO'|'PO'|'BILL'|'INVOICE';
export interface TraceScope {organizationId:string;fyId:string;snapshotId:string}
export interface DocumentRef {documentType:CommercialType;remoteId:string;versionId:string}
export interface TraceDocument extends DocumentRef,TraceScope {documentDate:string;lineIds:readonly string[]}
export interface Endpoint extends DocumentRef {lineId:string|null}
export interface LinkEvidence extends TraceScope {
 id:string;from:Endpoint;to:Endpoint;
 source:DocumentRef;sourceField:string;evidenceReference:string;
}
export type LinkReason='DOCUMENT_MISSING'|'VERSION_MISMATCH'|'LINE_MISSING'|'PARTIAL_LINE_REFERENCE'|'EVIDENCE_MISSING'|'EVIDENCE_SOURCE_NOT_ENDPOINT';
export interface AssessedLink {evidence:LinkEvidence;status:'SUPPORTED_REFERENCE'|'INCOMPLETE';level:'DOCUMENT'|'LINE';reasons:LinkReason[]}
const present=(s:string)=>typeof s==='string' && s.trim().length>0;
const key=(r:DocumentRef)=>JSON.stringify([r.documentType,r.remoteId]);
const sameVersion=(a:DocumentRef,b:DocumentRef)=>key(a)===key(b)&&a.versionId===b.versionId;
function checkScope(scope:TraceScope,value:TraceScope){
 for(const field of ['organizationId','fyId','snapshotId'] as const)
  if(!present(scope[field])||scope[field]!==value[field])throw new Error('TRACE_SCOPE_MISMATCH');
}
function validateDocumentFY(doc:TraceDocument){
 const match=/^(\d{4})-(\d{2})$/.exec(doc.fyId);
 const year=match?Number(match[1]):NaN;
 const date=new Date(doc.documentDate+'T00:00:00.000Z');
 if(!match||String((year+1)%100).padStart(2,'0')!==match[2]||!/^\d{4}-\d{2}-\d{2}$/.test(doc.documentDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==doc.documentDate||doc.documentDate<`${year}-04-01`||doc.documentDate>`${year+1}-03-31`)throw new Error('DOCUMENT_FY_DATE_MISMATCH');
}
const pairs=new Set(['SO:PO','PO:BILL','SO:INVOICE']);
export function buildCommercialGraph(scope:TraceScope,documents:readonly TraceDocument[],evidence:readonly LinkEvidence[]){
 checkScope(scope,scope);
 const docs=new Map<string,TraceDocument>();
 for(const doc of documents){
  checkScope({...scope,fyId:doc.fyId},doc);
  validateDocumentFY(doc);
  if(!['SO','PO','BILL','INVOICE'].includes(doc.documentType)||!present(doc.remoteId)||!present(doc.versionId))throw new Error('INVALID_DOCUMENT_REFERENCE');
  if(docs.has(key(doc)))throw new Error('AMBIGUOUS_DOCUMENT_VERSION');
  if(doc.lineIds.some(id=>!present(id))||new Set(doc.lineIds).size!==doc.lineIds.length)throw new Error('INVALID_LINE_IDENTITIES');
  docs.set(key(doc),{...doc,lineIds:[...doc.lineIds]});
 }
 const ids=new Set<string>();const relationships=new Set<string>();
 const links:AssessedLink[]=evidence.map(item=>{
  checkScope(scope,item);
  if(!present(item.id)||ids.has(item.id))throw new Error('DUPLICATE_OR_EMPTY_EVIDENCE_ID');ids.add(item.id);
  if(!pairs.has(`${item.from.documentType}:${item.to.documentType}`))throw new Error('UNSUPPORTED_RELATIONSHIP');
  const relationship=JSON.stringify([item.from.documentType,item.from.remoteId,item.from.versionId,item.from.lineId,item.to.documentType,item.to.remoteId,item.to.versionId,item.to.lineId]);
  if(relationships.has(relationship))throw new Error('DUPLICATE_RELATIONSHIP');relationships.add(relationship);
  const reasons:LinkReason[]=[];
  for(const endpoint of [item.from,item.to]){
   const doc=docs.get(key(endpoint));
   if(!doc)reasons.push('DOCUMENT_MISSING');
   else if(doc.versionId!==endpoint.versionId)reasons.push('VERSION_MISMATCH');
   else if(endpoint.lineId!==null&&!doc.lineIds.includes(endpoint.lineId))reasons.push('LINE_MISSING');
  }
  if((item.from.lineId===null)!==(item.to.lineId===null))reasons.push('PARTIAL_LINE_REFERENCE');
  if(!present(item.sourceField)||!present(item.evidenceReference))reasons.push('EVIDENCE_MISSING');
  if(!sameVersion(item.source,item.from)&&!sameVersion(item.source,item.to))reasons.push('EVIDENCE_SOURCE_NOT_ENDPOINT');
  return {evidence:{...item,from:{...item.from},to:{...item.to},source:{...item.source}},status:reasons.length?'INCOMPLETE':'SUPPORTED_REFERENCE',level:item.from.lineId===null&&item.to.lineId===null?'DOCUMENT':'LINE',reasons:[...new Set(reasons)]};
 });
 return {scope:{...scope},documents:[...docs.values()],links};
}
/** Forward traversal only: a shared PO does not pull in another SO or its invoice.
 * Bill reachability through a PO is reference context, never an SO cost allocation. */
export function traceSalesOrder(graph:ReturnType<typeof buildCommercialGraph>,remoteId:string){
 const root=graph.documents.find(d=>d.documentType==='SO'&&d.remoteId===remoteId);
 if(root&&root.fyId!==graph.scope.fyId)throw new Error('ROOT_FY_MISMATCH');
 if(!root)throw new Error('SALES_ORDER_NOT_IN_SNAPSHOT');
 const reached=new Set([key(root)]);const links:AssessedLink[]=[];
 for(const pair of ['SO:PO','SO:INVOICE','PO:BILL'])for(const link of graph.links){
  if(`${link.evidence.from.documentType}:${link.evidence.to.documentType}`!==pair||!reached.has(key(link.evidence.from)))continue;
  links.push(link);
  if(link.status==='SUPPORTED_REFERENCE')reached.add(key(link.evidence.to));
 }
 return {root,documents:graph.documents.filter(d=>reached.has(key(d))),links,
  evidenceStatus:links.length===0||links.some(l=>l.status==='INCOMPLETE')?'INCOMPLETE' as const:'REFERENCES_AVAILABLE' as const,
  allocationStatus:'NOT_EVALUATED' as const,fulfilmentStatus:'NOT_EVALUATED' as const,marginStatus:'NOT_EVALUATED' as const};
}
