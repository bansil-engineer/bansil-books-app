 'use client';
import {useEffect,useRef,useState} from 'react';
import type {PilotView,PilotDocument} from '../lib/master-audit-v2/pilot/view-model';
import type {CoverageReviews} from '../lib/master-audit-v2/pilot/coverage-review';
import {emptyVerification,type VerificationState} from '../lib/master-audit-v2/pilot/verification-model';
import {poReview,poProblem} from '../lib/master-audit-v2/pilot/po-verification';
import s from './pilot.module.css';
export default function VerificationPanel({data,soId,states,coverageReviews,onSaved,onClose,onOpenDocument,onSync,syncBusy}:{data:PilotView;soId:string;states:Record<string,VerificationState>;coverageReviews?:CoverageReviews;onSaved:(v:Record<string,VerificationState>)=>void;onClose:()=>void;onOpenDocument:(d:PilotDocument)=>void;onSync:(d:PilotDocument)=>void;syncBusy:boolean}){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{panel.current?.scrollIntoView({block:'start'});},[soId]);
 const state=states[soId]??emptyVerification;
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
 const approvedIds=state.mode==='PO'&&state.status!=='STALE'?(state.selection?.poIds??[]):[];
 const review=poReview(data,soId,approvedIds,coverageReviews),so=data.documents.find(d=>d.type==='SO'&&d.id===soId)!;
 const preview=poReview(data,soId,review.pos.map(p=>p.id),coverageReviews);
 const complete=state.mode==='PO'&&state.status==='VERIFIED';
 function money(value:string|null|undefined){if(value==null)return 'Not available';const [whole,fraction]=value.split('.');return `${so.currency??''} ${whole.replace(/(\d)(?=(\d\d)+\d$)/g,'$1,')}.${fraction??'00'}`;}
 async function save(action:'VERIFY_PO'|'UNVERIFY_PO'|'UNVERIFY',poId?:string){
  setBusy(true);setError('');try{const response=await fetch('/api/master-audit-v2/verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({soId,poId,snapshot:data.snapshotId,revision:state.revision,action})});const result=await response.json();if(!response.ok)throw Error(result.error??'Unable to save');onSaved(result.states);}catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}
 }
 return <section ref={panel} className={s.panel} aria-label="PO verification">
 <button className={s.linkButton} disabled={busy||syncBusy} onClick={onClose}>Close verification</button>
 <h2>{so.number} — Verify Purchase Orders</h2>
 <button className={s.linkButton} disabled={busy||syncBusy} onClick={()=>window.location.reload()}>Refresh saved data</button>
 {error&&<p className={s.notice} role="alert">{error} Use Refresh saved data if this page is out of date.</p>}
 <h3>Sales Invoices</h3>
 <div className={s.tableWrap}><table><thead><tr><th>Invoice No.</th><th>Date</th><th>Sales (excl. GST)</th><th>Evidence</th></tr></thead><tbody>{preview.gp.invoices.map(inv=><tr key={inv.id}><td><button className={s.linkButton} disabled={busy||syncBusy} onClick={()=>onOpenDocument(inv)}>{inv.number}</button><button className={s.syncButton} disabled={busy||syncBusy} aria-label={'Sync '+ inv.number} title={'Sync '+ inv.number+' from Zoho'} onClick={()=>onSync(inv)}><span aria-hidden="true">↻</span></button></td><td>{inv.date}</td><td>{money(inv.salesSubtotal)}</td><td>{inv.salesOrderIds.includes(so.id)||so.invoiceIds.includes(inv.id)?'Direct SO reference':'Same customer PO reference — Owner review required'}</td></tr>)}{!preview.gp.invoices.length&&<tr><td colSpan={4}>No linked Invoice saved for this SO. GP cannot be calculated yet.</td></tr>}</tbody></table></div>
 <section className={s.cards} aria-label="Invoice minus Bills calculation"><article><span>Invoice sales (excl. GST)</span><b>{money(complete?state.sales:preview.gp.sales)}</b></article><article><span>Purchase Bills (excl. GST)</span><b>{money(complete?state.cost:preview.gp.cost)}</b></article><article><span>GP amount — Sales − Purchase</span><b>{money(complete?state.profit:preview.gp.profit)}</b></article><article><span>{complete?'Owner-verified GP %':'GP preview % — not verified'}</span><b>{(complete?state.percent:preview.gp.percent)!=null?(complete?state.percent:preview.gp.percent)+'%':'Not available'}</b></article></section>
 <p>{complete?(state.gpReason?`All POs verified. GP unavailable: ${state.gpReason}`:'All POs verified. GP uses linked Invoice sales minus linked Purchase Bills, excluding GST.'):preview.reason?`GP unavailable: ${preview.reason}`:'Preview uses all captured linked Bills. It becomes Owner-verified only after all POs are verified.'}</p>
 <p><button className={s.syncButton} disabled={busy||syncBusy} aria-label={'Sync '+ so.number} title={'Sync '+ so.number+' from Zoho'} onClick={()=>onSync(so)}><span aria-hidden="true">↻</span></button></p>
 <p><strong>{complete?'Verified':`${review.approved.length} of ${review.pos.length} POs verified`}</strong>{state.status==='STALE'?' · Source changed — verify POs again':''}</p>
 <p>Click <strong>Verify PO</strong> after checking the PO and its listed Bills. Its linked Bills are then automatically verified. When all POs are verified, this SO shows <strong>Verified</strong>.</p>
 <div className={s.controls}><label>Find PO<input placeholder="Search PO number" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
 <div className={s.tableWrap}><table><thead><tr><th>Purchase Order</th><th>Date</th><th>PO amount (excl. GST)</th><th>Linked Bills</th><th>Status</th><th>Action</th></tr></thead><tbody>{review.pos.filter(p=>p.number.toLowerCase().includes(query.toLowerCase())).map(po=>{
 const verified=approvedIds.includes(po.id),problem=poProblem(data,soId,po,coverageReviews),ids=[...new Set(po.billIds)];
 const isShared=!(po.owners.length===1&&po.owners[0]===so.number);
 const alloc=isShared&&coverageReviews?.['PO:'+po.id]?.status==='ALLOCATED'?coverageReviews['PO:'+po.id].amounts?.[so.number]:null;
 return <tr key={po.id}><td><strong>{po.number}</strong></td><td>{po.date}</td><td><div>{money(po.purchaseSubtotal)}</div>{isShared&&<small>{alloc?`Allocated: ${money(alloc)}`:'Shared — unallocated'}</small>}</td><td>{ids.length?<details><summary>{ids.length} Bills · {verified?'Automatically verified':'Verify with PO'}{isShared?' (Shared)':''}</summary>{ids.map(id=>{const bill=data.documents.find(d=>d.type==='BILL'&&d.id===id);return <p key={id}>{bill?.number??'Missing Bill detail'} · {money(bill?.purchaseSubtotal)}{verified?' · Verified':''}{bill&&<button className={s.syncButton} disabled={busy||syncBusy} aria-label={'Sync '+ bill.number} title={'Sync '+ bill.number+' from Zoho'} onClick={()=>onSync(bill)}><span aria-hidden="true">↻</span></button>}</p>;})}</details>:<span>No Bills captured</span>}</td><td>{verified?'Verified':problem?'Needs review':'Not verified'}{problem&&<small>{problem}</small>}</td><td><button className={s.linkButton} disabled={busy||syncBusy||(!verified&&!!problem)} onClick={()=>save(verified?'UNVERIFY_PO':'VERIFY_PO',po.id)}>{busy?'Saving…':verified?'Unverify PO':'Verify PO'}</button><button className={s.syncButton} disabled={busy||syncBusy} aria-label={'Sync '+ po.number} title={'Sync '+ po.number+' from Zoho'} onClick={()=>onSync(po)}><span aria-hidden="true">↻</span></button></td></tr>;
 })}{!review.pos.length&&<tr><td colSpan={6}>No PO references captured.</td></tr>}</tbody></table></div>
 <details><summary>Calculation details</summary><p>GP % = (Invoice sales − Purchase Bills) ÷ Invoice sales × 100. Bills are counted once; PO amounts are not added again. Saved Invoice references: {review.gp.invoices.map(d=>d.number).join(', ')||'None captured'}. This is the Owner-approved comparison of captured documents. Missing purchases, returns, credits and landed costs remain outside this calculation. A PO with no captured Bills does not prove there are no costs.</p></details>
 {state.revision>0&&<p><button className={s.linkButton} disabled={busy||syncBusy||(!approvedIds.length&&state.status!=='STALE'&&state.status!=='VERIFIED')} onClick={()=>save('UNVERIFY')}>Unverify all POs</button> Saved documents and verification history are retained.</p>}
 
 </section>;
}
