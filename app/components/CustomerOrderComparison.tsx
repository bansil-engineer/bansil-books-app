"use client";
import React, { useEffect, useRef, useState } from "react";
import type { QuantityDocument, QuantityKind, QuantityRow, UnmatchedLine } from "@/app/lib/order-quantity";

interface OrderOption { id: string; number: string; customerId: string; customer: string; date: string; status: string; }
interface Result { rows: QuantityRow[]; unmatched: UnmatchedLine[]; documents: QuantityDocument[]; complete: Record<QuantityKind, boolean>; excluded: { number: string; kind: string; status: string }[]; notes: string[]; organization: string; checkedAt: string; sourceCoverage: string; }
type ViewSource = QuantityRow["sources"][number] & { review?: string };
const kinds: QuantityKind[] = ["SO", "PO", "Invoice", "Bill"];
const format = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(value);

export function CustomerOrderComparison() {
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [customer, setCustomer] = useState("");
  const [so, setSO] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<{ title: string; sources: ViewSource[] } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const catalogRequest = useRef<AbortController | null>(null);
  const loadCatalog = async (start = 1) => {
    catalogRequest.current?.abort();
    const controller = new AbortController(); catalogRequest.current = controller;
    setCatalogBusy(true); setCatalogError("");
    try {
      for (let page = start; page < start + 5; page++) {
        const response = await fetch(`/api/audit/order-quantities?catalog=1&page=${page}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Customer / SO list unavailable.");
        if (controller.signal.aborted) return;
        setOrders(previous => [...new Map([...previous, ...data.orders].map((order: OrderOption) => [order.id, order])).values()]);
        setNextPage(data.hasMore ? page + 1 : null);
        if (!data.hasMore) break;
      }
    } catch (e) { if (!controller.signal.aborted) setCatalogError(e instanceof Error ? e.message : "Customer list unavailable."); }
    finally { if (!controller.signal.aborted) setCatalogBusy(false); }
  };
  useEffect(() => { void loadCatalog(); return () => { catalogRequest.current?.abort(); request.current?.abort(); }; }, []);
  useEffect(() => { if (detail) { detailRef.current?.focus(); detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }, [detail]);
  const compare = async (id: string) => {
    request.current?.abort(); setSO(id); setResult(null); setDetail(null); setError(""); setQuery("");
    if (!id) { setBusy(false); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const response = await fetch(`/api/audit/order-quantities?${new URLSearchParams({ so: id, customer })}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Comparison unavailable.");
      if (!controller.signal.aborted) setResult(data);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Comparison unavailable."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const show = (title: string, sources: ViewSource[], origin: HTMLElement) => { returnFocus.current = origin; setDetail({ title, sources }); };
  const close = () => { setDetail(null); returnFocus.current?.focus(); };
  const customers = [...new Map(orders.filter(order => order.customerId && order.customer).map(order => [order.customerId, order.customer])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const sourcesFor = (row: QuantityRow): ViewSource[] => {
    const base = row.sources.find(source => source.kind === "SO")?.line;
    const candidates = result?.unmatched.filter(entry => base && ((base.itemId && entry.line.itemId === base.itemId) || (base.name.trim().toLowerCase() === entry.line.name.trim().toLowerCase()))).map(entry => ({ document: entry.document, kind: entry.kind, line: entry.line, review: entry.reason })) || [];
    return [...row.sources, ...candidates];
  };
  const visibleUnmatched = result?.unmatched.filter(entry => `${entry.document} ${entry.line.name} ${entry.line.description}`.toLowerCase().includes(query.toLowerCase())) || [];
  const visible = result?.rows.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(query.toLowerCase())) || [];
  return <section className="section-card audit-order-lookup audit-quantity">
    <div className="section-header"><div><h3 className="section-title">Customer → SO → Quantity comparison</h3><p className="section-subtitle">Customer અને SO પસંદ કરો. Item name અને specification સાથે quantity સરખાવો.</p></div><span className="status-chip sent">READ ONLY</span></div>
    <div className="audit-toolbar audit-customer-selects">
      <label>Customer name<select aria-label="Customer name" value={customer} disabled={!orders.length} onChange={event => { request.current?.abort(); setCustomer(event.target.value); setSO(""); setResult(null); setDetail(null); setError(""); setBusy(false); }}><option value="">{catalogBusy && !orders.length ? "Loading customers…" : "Select customer"}</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>SO number<select aria-label="SO number" disabled={!customer} value={so} onChange={event => void compare(event.target.value)}><option value="">Select Sales Order</option>{orders.filter(order => order.customerId === customer).map(order => <option key={order.id} value={order.id}>{order.number} · {order.date} · {order.status}</option>)}</select></label>
      {so && <button className="audit-action" disabled={busy} onClick={() => void compare(so)}>Refresh comparison</button>}
    </div>
    {catalogError && <p className="audit-note" role="alert">{catalogError} <button className="audit-action" onClick={() => void loadCatalog(nextPage || 1)}>Retry customer list</button></p>}
    {nextPage !== null && <p className="audit-note" role="status">{catalogBusy ? "Loading Sales Orders…" : <button className="audit-action" onClick={() => void loadCatalog(nextPage)}>Load more customers / SOs</button>} {orders.length} SOs loaded.</p>}
    {!so && <p className="audit-note">પહેલા customer, પછી SO પસંદ કરો. માત્ર SO ધરાવતા customers બતાવેલ છે.</p>}
    {busy && <p className="audit-note" role="status">SO, linked PO, Invoice અને Bill quantities વાંચી રહ્યા છીએ…</p>}
    {error && <p className="audit-note" role="alert">{error}</p>}
    {result && <>
      <p className="audit-note">આ SO સાથે explicit link ધરાવતા documentsની quantities છે. Unlinked invoices/bills સામેલ નથી. Draft, pending approval, void અને cancelled documents ગણતરીમાંથી બહાર છે.</p>
      <div className="audit-toolbar"><label htmlFor="quantity-item-search">Find item</label><input id="quantity-item-search" placeholder="Item name or specification…" value={query} onChange={event => setQuery(event.target.value)} /><button className="audit-action" onClick={() => setQuery("")}>Clear item filter</button><span>{visible.length} items · {result.organization}</span></div>
      <div className="table-scroll-container"><table className="data-table"><thead><tr><th>Item name / Specification</th><th>Unit</th>{kinds.map(kind => <th key={kind} className="right">{kind} Qty</th>)}<th className="right">Yet to PO<br/><small>SO − PO</small></th><th className="right">Yet to Invoice<br/><small>SO − Invoice</small></th><th className="right">Yet to Bill<br/><small>PO − Bill</small></th><th className="right">Bill − Invoice<br/><small>Qty difference</small></th></tr></thead><tbody>
      {visible.map((row, index) => <tr key={row.key}><td><button className="audit-link" aria-label={`Compare item ${index + 1}: ${row.name}`} onClick={event => show(`${row.name} · matched and candidate source lines`, sourcesFor(row), event.currentTarget)}>{row.name}</button><div className="audit-party">{row.description}</div>{sourcesFor(row).some(source => source.review) && <span className="audit-warning">Item / specification review needed</span>}</td><td>{row.unit}</td>{kinds.map(kind => <td className="right" key={kind}><button className="audit-link" aria-label={`${kind} quantities for item ${index + 1}`} onClick={event => show(`${row.name} · SO vs ${kind}`, sourcesFor(row).filter(source => source.kind === kind || source.kind === "SO"), event.currentTarget)}>{format(row.quantities[kind])}</button>{row.quantities[kind] === null && <div className="audit-party">{format(row.sources.filter(source => source.kind === kind).reduce((sum, source) => sum + (source.line.quantity || 0), 0))} matched · partial</div>}</td>)}{row.differences.map((value, i) => <td key={i} className={`right amount ${value !== null && value < 0 ? "audit-negative-qty" : ""}`}>{format(value)}</td>)}</tr>)}
      {!visible.length && <tr><td colSpan={10}>No items match this view.</td></tr>}
      </tbody></table></div>
      <p className="audit-note">Qty: linked documentsના item name, specification, identity અને unit મળ્યા હોય તે જ ગણાય છે. “—” = અધૂરું / unresolved; negative = વધારાની quantity. Bill−Invoice physical stock નથી; returns/credits અહીં net કરેલા નથી.</p>
      {result.unmatched.length > 0 && <details className="audit-unmatched"><summary>{visibleUnmatched.length} of {result.unmatched.length} source lines need item-name / unit review</summary><div className="table-scroll-container"><table className="data-table"><thead><tr><th>Document</th><th>Item / Specification</th><th className="right">Qty</th><th>Unit</th><th>Why not matched</th></tr></thead><tbody>{visibleUnmatched.map((entry, index) => <tr key={index}><td><button className="audit-link" onClick={event => show(entry.document, [{ document: entry.document, kind: entry.kind, line: entry.line, review: entry.reason }], event.currentTarget)}>{entry.document}</button></td><td>{entry.line.name}<div className="audit-party">{entry.line.description}</div></td><td className="right">{format(entry.line.quantity)}</td><td>{entry.line.unit || "Missing"}</td><td>{entry.reason}</td></tr>)}</tbody></table></div></details>}
      {detail && <div ref={detailRef} tabIndex={-1} role="region" aria-label="Item quantity details" className="audit-order-detail" onKeyDown={event => { if (event.key === "Escape") close(); }}><div className="section-header"><h3>{detail.title}</h3><button className="audit-action" onClick={close}>Close quantity details</button></div><div className="table-scroll-container"><table className="data-table"><thead><tr><th>Document</th><th>Item name / Specification</th><th>Unit</th><th className="right">Qty</th><th>Item check</th></tr></thead><tbody>{detail.sources.map((source, index) => <tr key={index}><td>{source.kind} · {source.document}</td><td>{source.line.name}<div className="audit-party">{source.line.description}</div></td><td>{source.line.unit || "Missing"}</td><td className="right">{format(source.line.quantity)}</td><td>{source.review || (source.kind === "SO" ? "SO source line" : "Source line; compare identity, name, specification and unit")}</td></tr>)}{!detail.sources.length && <tr><td colSpan={5}>No matched source lines available. Review coverage before interpreting as zero.</td></tr>}</tbody></table></div></div>}
      <details><summary>Source documents & coverage · {result.documents.length} documents</summary><div className="audit-toolbar">{result.documents.map(doc => <button className="audit-action" key={`${doc.kind}:${doc.id}`} onClick={event => show(`${doc.number} · ${doc.party}`, doc.lines.map(line => ({ document: doc.number, kind: doc.kind, line })), event.currentTarget)}>{doc.number} · {doc.status}</button>)}</div><p className="audit-note">{result.sourceCoverage}</p><p className="audit-note">Read {new Date(result.checkedAt).toLocaleString("en-IN")} · ZOHO WRITE 0 · No reconciliation run</p>{result.notes.map(note => <p className="audit-note" key={note}>{note}</p>)}{result.excluded.map(doc => <p className="audit-note" key={doc.kind + doc.number}>{doc.number} · {doc.status} · Excluded from quantities</p>)}</details>
    </>}
  </section>;
}
