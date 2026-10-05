"use client";
import { CustomerOrderComparison } from "./CustomerOrderComparison";
import React, { useRef, useState } from "react";

interface Order {
  kind: string; number: string; party: string; date: string; status: string; reference: string; total: number; currency: string; deliveryName: string; workflowApprover: string;
  customFields: { label: string; value: string }[];
  lines: { itemId: string; name: string; description: string; quantity: number; unit: string; rate: number; amount: number }[];
}
interface LinkEvidence {
  mappingSource: string;
  soReference: string | null;
  soLookupResult: "FOUND" | "NOT_FOUND" | "NOT_ATTEMPTED";
  customerFieldRaw: string | null;
  soCustomerRaw: string | null;
  customerVerification: "EXACT_MATCH" | "MISMATCH" | "NOT_AVAILABLE";
  deliveryCustomerRaw: string | null;
  deliveryVerification: "EXACT_MATCH" | "MISMATCH" | "NOT_AVAILABLE";
  checkAndVerifyRaw: string | null;
  mappingStatus: string;
}
interface Result { document: Order; linkedSalesOrder: Order | null; linkNote: string; linkEvidence: LinkEvidence | null; organization: string; checkedAt: string; }
const money = (value: number, currency = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(value);

const statusColor = (status: string) => {
  if (status === "EXACT_CUSTOMER_VERIFIED") return "var(--google-green)";
  if (status === "EXACT_CUSTOM_FIELD_LINK") return "var(--google-blue)";
  if (status === "CUSTOMER_NAME_MISMATCH") return "var(--google-amber)";
  if (status === "SO_REFERENCE_NOT_FOUND" || status === "READ_ERROR") return "var(--google-red)";
  if (status === "MULTIPLE_SO_REFERENCE") return "var(--google-red)";
  return "var(--text-secondary)";
};

const verificationLabel = (v: string) => {
  if (v === "EXACT_MATCH") return "Exact normalized name match";
  if (v === "MISMATCH") return "Mismatch — review required";
  return "Not available";
};

const lookupLabel = (v: string) => {
  if (v === "FOUND") return "Exact SO document found";
  if (v === "NOT_FOUND") return "Not found";
  return "Not attempted";
};

export function OrderComparison() {
  return <><CustomerOrderComparison /><details className="audit-direct-lookup"><summary>Find a PO / SO directly by number</summary><DirectOrderLookup /></details></>;
}

function DirectOrderLookup() {
  const [kind, setKind] = useState("PO");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const details = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLButtonElement | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const open = (order: Order, button: HTMLButtonElement) => {
    origin.current = button;
    setSelected(order); setItemQuery("");
    requestAnimationFrame(() => { details.current?.focus(); details.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
  };
  const close = () => { setSelected(null); origin.current?.focus(); };
  const lookup = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setResult(null); setSelected(null);
    try {
      const response = await fetch(`/api/audit/order-comparison?${new URLSearchParams({ kind, number: number.trim() })}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Document unavailable.");
      setResult(data);
    } catch (error) { setError(error instanceof Error ? error.message : "Document unavailable."); }
    finally { setBusy(false); }
  };
  const order = result?.document;
  const so = result?.linkedSalesOrder;
  const ev = result?.linkEvidence;
  return <section className="section-card audit-order-lookup">
    <div className="section-header"><div><h3 className="section-title">Find PO / SO · Live source comparison</h3><p className="section-subtitle">Document numberથી શોધો. વિગતો આ જ પેજ પર ખુલશે.</p></div><span className="status-chip sent">READ ONLY</span></div>
    <form className="audit-toolbar" onSubmit={lookup}>
      <label htmlFor="order-kind">Document</label><select id="order-kind" value={kind} disabled={busy} onChange={e => setKind(e.target.value)}><option>PO</option><option>SO</option></select>
      <label htmlFor="order-number">Number</label><input ref={search} id="order-number" placeholder="e.g. PO-2627283" required maxLength={100} value={number} disabled={busy} onChange={e => setNumber(e.target.value)} />
      <button className="audit-action" disabled={busy || !number.trim()} type="submit">{busy ? "Reading Zoho…" : "Find & compare"}</button>
      <button className="audit-action" disabled={busy} type="button" onClick={() => { setNumber(""); setResult(null); setSelected(null); setError(""); search.current?.focus(); }}>Clear lookup</button>
    </form>
    {error && <p className="audit-note" role="alert">{error}</p>}
    {busy && <p className="audit-note" role="status">Zohoમાંથી document અને linked SO વાંચી રહ્યા છીએ. કોઈ entry બદલાતી નથી.</p>}
    {result && order && <>
      <p className="audit-note" role="status">{result.organization} · Live read {new Date(result.checkedAt).toLocaleString("en-IN")} · ZOHO WRITE 0</p>
      <div className="table-scroll-container"><table className="data-table"><thead><tr><th>Document</th><th>Customer / Vendor</th><th>Date</th><th>Status</th><th className="right">Total</th></tr></thead><tbody>
        {[order, ...(so ? [so] : [])].map(doc => <tr key={doc.kind + doc.number}><td><button className="audit-link" onClick={e => open(doc, e.currentTarget)}>{doc.number}</button></td><td>{doc.party}</td><td>{doc.date}</td><td>{doc.status}</td><td className="right amount">{money(doc.total, doc.currency)}</td></tr>)}
      </tbody></table></div>

      {/* CUSTOM FIELDS section */}
      <div className="audit-order-fields"><h4>Custom fields · {order.number}</h4><dl>{order.customFields.length ? order.customFields.map((field, index) => <React.Fragment key={index}><dt>{field.label}</dt><dd>{field.value || "Not recorded"}</dd></React.Fragment>) : <><dt>Custom fields</dt><dd>Not returned by source</dd></>}</dl>
      <p className="audit-note">{result.linkNote}</p>

      {/* SO–PO LINK EVIDENCE section — deterministic classification */}
      {ev && <div className="audit-name-comparison">
        <h4>SO–PO Link Evidence</h4>
        <dl>
          <dt>Mapping Source</dt>
          <dd>{ev.mappingSource}</dd>

          <dt>Reference</dt>
          <dd>{ev.soReference || "Not available"}</dd>

          <dt>SO Lookup</dt>
          <dd>{lookupLabel(ev.soLookupResult)}</dd>

          <dt>PO Custom Field — Customer Name</dt>
          <dd>{ev.customerFieldRaw || "Not recorded"}</dd>

          <dt>SO Customer</dt>
          <dd>{ev.soCustomerRaw || "Not available"}</dd>

          <dt>Customer Verification</dt>
          <dd style={{ color: ev.customerVerification === "EXACT_MATCH" ? "var(--google-green)" : ev.customerVerification === "MISMATCH" ? "var(--google-red)" : "inherit", fontWeight: 500 }}>{verificationLabel(ev.customerVerification)}</dd>

          <dt>Delivery Customer</dt>
          <dd>{ev.deliveryCustomerRaw || "Not returned by source"}</dd>

          <dt>Delivery Customer Verification</dt>
          <dd style={{ color: ev.deliveryVerification === "EXACT_MATCH" ? "var(--google-green)" : ev.deliveryVerification === "MISMATCH" ? "var(--google-red)" : "inherit", fontWeight: 500 }}>{verificationLabel(ev.deliveryVerification)}</dd>

          <dt>Check And Verify</dt>
          <dd>{ev.checkAndVerifyRaw || "Not recorded"}</dd>

          <dt>Mapping Status</dt>
          <dd><span className="status-chip" style={{ background: statusColor(ev.mappingStatus), color: "#fff", fontWeight: 600 }}>{ev.mappingStatus.replaceAll("_", " ")}</span></dd>
        </dl>

        <p className="audit-note" style={{ marginTop: 8 }}><strong>Document Relationship:</strong> {ev.mappingStatus === "EXACT_CUSTOMER_VERIFIED" || ev.mappingStatus === "EXACT_CUSTOM_FIELD_LINK" ? "Explicit PO custom-field SO reference verified." : ev.mappingStatus === "CUSTOMER_NAME_MISMATCH" ? "SO reference exists but customer name does not match after safe normalization." : ev.mappingStatus === "MULTIPLE_SO_REFERENCE" ? "Conflicting SO references — owner review required." : ev.mappingStatus === "SO_REFERENCE_NOT_FOUND" ? "SO reference exists but referenced document not found." : ev.mappingStatus === "SO_REFERENCE_MISSING" ? "No Sales Order No custom field found on this PO." : "Read error — unable to verify."}</p>
        <p className="audit-note"><strong>Commercial / Audit Verification:</strong> Item match, quantity match, rate match, taxable value match, GST match, fulfilment completeness, invoice completeness, bill completeness, and payment completeness are NOT established by this document relationship check.</p>
      </div>}
      </div>

      {/* Selected order detail panel (unchanged) */}
      {selected && (
        <div className="audit-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="audit-drawer" role="dialog" aria-label={`${selected.number} complete comparison`} style={{ width: '800px' }} onKeyDown={event => { if (event.key === "Escape") close(); }}>
            <div className="drawer-header">
              <h2 className="drawer-title">{selected.number} · Details & comparison</h2>
              <button type="button" className="drawer-close" onClick={close}>✕</button>
            </div>
            
            <div className="drawer-content">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div><div className="period-filter-label">Party</div><div style={{ fontWeight: 500 }}>{selected.party}</div></div>
                <div><div className="period-filter-label">Reference</div><div style={{ fontWeight: 500 }}>{selected.reference || "Not recorded"}</div></div>
                <div><div className="period-filter-label">Delivery name</div><div style={{ fontWeight: 500 }}>{selected.deliveryName || "Not returned by source"}</div></div>
                <div><div className="period-filter-label">Workflow approver</div><div style={{ fontWeight: 500 }}>{selected.workflowApprover || "Not returned by source — separate from Check And Verify"}</div></div>
              </div>
              
              <details style={{ marginBottom: '24px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--google-blue)' }}>Custom fields · {selected.number}</summary>
                <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {selected.customFields.map((field, index) => (
                    <div key={index}>
                      <div className="period-filter-label">{field.label}</div>
                      <div>{field.value || "Not recorded"}</div>
                    </div>
                  ))}
                </div>
              </details>
              
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <input style={{ flex: 1, padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }} id="order-item-search" placeholder="Item name or description…" value={itemQuery} onChange={e => setItemQuery(e.target.value)} />
                <button className="period-filter-apply-btn" onClick={() => setItemQuery("")}>Clear search</button>
              </div>
              
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item / Description</th>
                    <th className="right">Quantity</th>
                    <th className="right">Rate</th>
                    <th className="right">Amount</th>
                    {so && selected.kind === "PO" && <th>SO comparison</th>}
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.filter(line => `${line.name} ${line.description}`.toLowerCase().includes(itemQuery.toLowerCase())).map((line, index) => { 
                    const matching = so?.lines.filter(other => line.itemId && other.itemId === line.itemId) || []; 
                    return (
                      <tr key={index}>
                        <td>{line.name}<div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{line.description}</div></td>
                        <td className="right">{line.quantity} {line.unit}</td>
                        <td className="amount right">{money(line.rate, selected.currency)}</td>
                        <td className="amount right">{money(line.amount, selected.currency)}</td>
                        {so && selected.kind === "PO" && (
                          <td>
                            {matching.length ? matching.map((other, i) => (
                              <div key={i}>
                                <span style={{ fontWeight: 500 }}>{other.name}</span> · {other.quantity} {other.unit} · {money(other.rate, so.currency)}
                                <div style={{ fontSize: '11px', color: 'var(--google-amber)' }}>Same source item; quantities/rates require review</div>
                              </div>
                            )) : (
                              <span style={{ color: 'var(--google-red)' }}>No exact item link — unresolved</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ); 
                  })}
                  {!selected.lines.some(line => `${line.name} ${line.description}`.toLowerCase().includes(itemQuery.toLowerCase())) && (
                    <tr><td colSpan={5} style={{ textAlign: 'center' }}>No items match this search.</td></tr>
                  )}
                </tbody>
              </table>
              <p style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Bill / payment coverage અહીં ચકાસાયેલ નથી. નીચેની local chain tablesની coverage અલગ છે. કોઈ reconciliation ચલાવ્યું નથી.</p>
            </div>
          </div>
        </div>
      )}
    </>}
  </section>;
}

