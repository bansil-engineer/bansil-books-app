"use client";

import React, { useState, useEffect, useMemo } from "react";
import EvidenceUploadManager from "./EvidenceUploadManager";
import { formatDisplayDate, formatINR } from "@/app/lib/date-utils";

type RecoRow = {
  classification: string;
  book: any;
  g2b: any;
  reason: string;
  provenance?: string;
  sub_type?: string;
  previous_classification?: string;
};

export default function PurchaseRecoControl({ selectedMonth = "FULL", globalFY = "2025-26" }: { selectedMonth?: string, globalFY?: string }) {
  const [fullManifest, setFullManifest] = useState<RecoRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Drilldown states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<RecoRow | null>(null);
  
  // Pagination
  const [visibleRows, setVisibleRows] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (globalFY !== "2025-26") {
      setFullManifest([]);
      setLoading(false);
      return;
    }
    fetch('/reco_manifest.json')
      .then(r => r.json())
      .then(d => {
        setFullManifest(d);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  }, [globalFY]);

  const manifest = useMemo(() => {
    if (!selectedMonth || selectedMonth === 'FULL') return fullManifest;
    const [mm, yyyy] = selectedMonth.split(' ');
    const booksPrefix = `${yyyy}-${mm}`;
    const g2bSuffix = `/${mm}/${yyyy}`;
    
    return fullManifest.filter(r => {
      const bDate = r.book?.date || "";
      const gDate = r.g2b?.document_date || "";
      if (bDate) {
        return bDate.startsWith(booksPrefix);
      }
      if (gDate) {
        return gDate.includes(g2bSuffix);
      }
      return false;
    });
  }, [fullManifest, selectedMonth]);

  if (loading) return <div style={{ padding: "20px" }}>Loading Reconciliation Manifest...</div>;

  const exact = manifest.filter(r => r.classification === "EXACT");
  const rounding = manifest.filter(r => r.classification === "ROUNDING");
  const valueTax = manifest.filter(r => r.classification === "VALUE_TAX_MISMATCH");
  const dateMismatch = manifest.filter(r => r.classification === "DATE_MISMATCH");
  const booksOnly = manifest.filter(r => r.classification === "BOOKS_ONLY");
  const g2bOnly = manifest.filter(r => r.classification === "G2B_ONLY");
  const dupGroups = manifest.filter(r => r.classification === "DUPLICATE_GROUP");
  const sourceLim = manifest.filter(r => r.classification === "SOURCE_DETAIL_UNAVAILABLE");

  if (selectedRow) {
    const b = selectedRow.book;
    const g = selectedRow.g2b;
    const st = selectedRow.sub_type || selectedRow.provenance || "";
    
    const isDiscount = st.startsWith('DISCOUNT_BRIDGED');
    const isRcm = st.startsWith('RCM_BRIDGED');
    const isVc = st.startsWith('VENDOR_CREDIT');

    return (
      <div className="section-card" style={{ padding: "20px" }}>
        <button 
          onClick={() => setSelectedRow(null)}
          className="audit-action"
          style={{ marginBottom: "16px", padding: "6px 12px" }}
        >
          &larr; Back to List
        </button>
        <h3 className="section-title">Reconciliation Evidence Comparison</h3>
        
        {isDiscount && (
          <div style={{ marginBottom: "16px", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "6px", display: "inline-block" }}>
            <strong style={{ color: "var(--google-blue)" }}>Status: </strong>
            <span>MATCHED — {st === 'DISCOUNT_BRIDGED_EXACT' ? 'DISCOUNT BRIDGE + EXACT' : 'DISCOUNT BRIDGE + ROUNDING'}</span>
          </div>
        )}
        {isRcm && (
          <div style={{ marginBottom: "16px", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "6px", display: "inline-block" }}>
            <strong style={{ color: "var(--google-blue)" }}>Status: </strong>
            <span>MATCHED — RCM BRIDGE</span>
          </div>
        )}
        {isVc && (
          <div style={{ marginBottom: "16px", padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "6px", display: "inline-block" }}>
            <strong style={{ color: "var(--google-blue)" }}>Status: </strong>
            <span>MATCHED — VENDOR CREDIT/CDNR</span>
          </div>
        )}

        <div style={{ display: "flex", gap: "24px", marginBottom: "24px" }}>
          <div style={{ flex: 1, padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: "#f8fafc" }}>
            <h4 style={{ margin: "0 0 12px 0", color: "var(--google-blue)" }}>
              {isVc ? "BOOKS VENDOR CREDIT" : "PURCHASE BOOKS BILL"}
            </h4>
            {b ? (
              <table style={{ width: "100%", fontSize: "13px", fontFamily: "monospace" }}>
                <tbody>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>{isVc ? "Credit Note" : "Document Number"}</td><td style={{ textAlign: "right", fontWeight: 600 }}>{b.number}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Date</td><td style={{ textAlign: "right", fontWeight: 600 }}>{formatDisplayDate(b.date)}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>GSTIN</td><td style={{ textAlign: "right", fontWeight: 600 }}>{b.gstin}</td></tr>
                  
                  {isVc && b.associated_bill && (
                    <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Associated Bill</td><td style={{ textAlign: "right", fontWeight: 600 }}>{b.associated_bill}</td></tr>
                  )}
                  
                  <tr><td colSpan={2} style={{ borderBottom: "1px solid var(--border-subtle)", margin: "8px 0" }}></td></tr>
                  
                  {b.discount_amount ? (
                    <>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Subtotal before discount</td><td style={{ textAlign: "right" }}>{formatINR(b.subtotal_before_discount)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Less: Taxable Discount</td><td style={{ textAlign: "right" }}>{formatINR(b.discount_amount)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0", fontWeight: 600 }}>Net GST Taxable</td><td style={{ textAlign: "right", fontWeight: 600 }}>{formatINR(b.taxable)}</td></tr>
                    </>
                  ) : (
                    <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Taxable</td><td style={{ textAlign: "right" }}>{formatINR(b.taxable)}</td></tr>
                  )}
                  
                  {isRcm ? (
                    <>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Supplier-side IGST</td><td style={{ textAlign: "right" }}>{formatINR(b.igst)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Supplier-side CGST</td><td style={{ textAlign: "right" }}>{formatINR(b.cgst)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Supplier-side SGST</td><td style={{ textAlign: "right" }}>{formatINR(b.sgst)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Supplier-side Cess</td><td style={{ textAlign: "right" }}>{formatINR(b.cess)}</td></tr>
                    </>
                  ) : (
                    <>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>IGST</td><td style={{ textAlign: "right" }}>{formatINR(b.igst)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>CGST</td><td style={{ textAlign: "right" }}>{formatINR(b.cgst)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>SGST</td><td style={{ textAlign: "right" }}>{formatINR(b.sgst)}</td></tr>
                      <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Cess</td><td style={{ textAlign: "right" }}>{formatINR(b.cess)}</td></tr>
                    </>
                  )}
                  
                  {isVc && (
                    <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0", fontWeight: 600 }}>Total</td><td style={{ textAlign: "right", fontWeight: 600 }}>{formatINR((b.taxable||0)+(b.igst||0)+(b.cgst||0)+(b.sgst||0)+(b.cess||0))}</td></tr>
                  )}
                </tbody>
              </table>
            ) : <div style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>No Books Evidence Available</div>}
          </div>
          
          {isRcm && (
          <div style={{ flex: 1, padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: "#f8f9fa" }}>
            <h4 style={{ margin: "0 0 12px 0", color: "var(--google-blue)" }}>REVERSE CHARGE BRIDGE</h4>
            <table style={{ width: "100%", fontSize: "13px", fontFamily: "monospace" }}>
              <tbody>
                <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>RCM IGST</td><td style={{ textAlign: "right" }}>{formatINR(b?.rcm_igst)}</td></tr>
                <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>RCM CGST</td><td style={{ textAlign: "right" }}>{formatINR(b?.rcm_cgst)}</td></tr>
                <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>RCM SGST</td><td style={{ textAlign: "right" }}>{formatINR(b?.rcm_sgst)}</td></tr>
                <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>RCM Cess</td><td style={{ textAlign: "right" }}>{formatINR(0)}</td></tr>
                <tr><td colSpan={2} style={{ borderBottom: "1px solid var(--border-subtle)", margin: "8px 0" }}></td></tr>
                <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0", fontWeight: 600 }}>RCM Total</td><td style={{ textAlign: "right", fontWeight: 600 }}>{formatINR(b?.rcm_total)}</td></tr>
              </tbody>
            </table>
          </div>
          )}

          <div style={{ flex: 1, padding: "16px", border: "1px solid var(--border)", borderRadius: "8px", background: "#f0fdf4" }}>
            <h4 style={{ margin: "0 0 12px 0", color: "var(--google-green)" }}>
              {isVc ? "GSTR-2B CDNR" : "GSTR-2B DOCUMENT"}
            </h4>
            {g ? (
              <table style={{ width: "100%", fontSize: "13px", fontFamily: "monospace" }}>
                <tbody>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Document Number</td><td style={{ textAlign: "right", fontWeight: 600 }}>{g.document_number}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Date</td><td style={{ textAlign: "right", fontWeight: 600 }}>{g.document_date}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>GSTIN</td><td style={{ textAlign: "right", fontWeight: 600 }}>{g.supplier_gstin}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Source Section</td><td style={{ textAlign: "right", fontWeight: 600 }}>{g.type || 'CDNR'}</td></tr>
                  <tr><td colSpan={2} style={{ borderBottom: "1px solid var(--border-subtle)", margin: "8px 0" }}></td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Taxable</td><td style={{ textAlign: "right" }}>{formatINR(g.taxable_value)}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>IGST</td><td style={{ textAlign: "right" }}>{formatINR(g.igst)}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>CGST</td><td style={{ textAlign: "right" }}>{formatINR(g.cgst)}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>SGST</td><td style={{ textAlign: "right" }}>{formatINR(g.sgst)}</td></tr>
                  <tr><td style={{ color: "var(--text-secondary)", padding: "4px 0" }}>Cess</td><td style={{ textAlign: "right" }}>{formatINR(g.cess)}</td></tr>
                </tbody>
              </table>
            ) : <div style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>No GSTR-2B Candidate Available</div>}
          </div>
        </div>

        <div style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "8px" }}>
          <h4 style={{ margin: "0 0 12px 0" }}>RESIDUAL</h4>
          <table style={{ width: "100%", fontSize: "13px", fontFamily: "monospace" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", color: "var(--text-secondary)", paddingBottom: "8px", borderBottom: "1px solid var(--border-subtle)" }}>Component</th>
                <th style={{ textAlign: "right", color: "var(--text-secondary)", paddingBottom: "8px", borderBottom: "1px solid var(--border-subtle)" }}>Books {isRcm ? "(RCM)" : ""}</th>
                <th style={{ textAlign: "right", color: "var(--text-secondary)", paddingBottom: "8px", borderBottom: "1px solid var(--border-subtle)" }}>GSTR-2B</th>
                <th style={{ textAlign: "right", color: "var(--text-secondary)", paddingBottom: "8px", borderBottom: "1px solid var(--border-subtle)" }}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {['Taxable', 'IGST', 'CGST', 'SGST', 'Cess'].map(comp => {
                let bv = null;
                if (b) {
                  if (comp === 'Taxable') bv = b.taxable;
                  else if (isRcm) {
                    if (comp === 'IGST') bv = b.rcm_igst || 0;
                    if (comp === 'CGST') bv = b.rcm_cgst || 0;
                    if (comp === 'SGST') bv = b.rcm_sgst || 0;
                    if (comp === 'Cess') bv = 0;
                  } else {
                    if (comp === 'IGST') bv = b.igst;
                    if (comp === 'CGST') bv = b.cgst;
                    if (comp === 'SGST') bv = b.sgst;
                    if (comp === 'Cess') bv = b.cess;
                  }
                }
                const gv = g ? (comp === 'Taxable' ? g.taxable_value : comp === 'IGST' ? g.igst : comp === 'CGST' ? g.cgst : comp === 'SGST' ? g.sgst : g.cess) : null;
                
                if (bv === null && gv === null) return null;
                const diff = (bv || 0) - (gv || 0);
                const isDiff = Math.abs(diff) > 0.001;

                return (
                  <tr key={comp}>
                    <td style={{ padding: "8px 0" }}>{comp}</td>
                    <td style={{ padding: "8px 0", textAlign: "right" }}>{bv !== null ? formatINR(bv) : '—'}</td>
                    <td style={{ padding: "8px 0", textAlign: "right" }}>{gv !== null ? formatINR(gv) : '—'}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", color: isDiff ? "var(--google-red)" : "inherit", fontWeight: isDiff ? 600 : "normal" }}>
                      {isDiff ? formatINR(diff) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (selectedCategory) {
    let filteredList = manifest.filter(r => r.classification === selectedCategory);
    
    // Exact search logic
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filteredList = filteredList.filter(r => {
        const b = r.book || {};
        const g = r.g2b || {};
        return (b.number?.toLowerCase() || '').includes(q) || 
               (g.document_number?.toLowerCase() || '').includes(q) ||
               (b.gstin?.toLowerCase() || '').includes(q) ||
               (g.supplier_gstin?.toLowerCase() || '').includes(q);
      });
    }

    const totalPages = Math.ceil(filteredList.length / visibleRows);
    const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages || 1));
    const paginatedList = filteredList.slice((safeCurrentPage - 1) * visibleRows, safeCurrentPage * visibleRows);

    return (
      <div className="section-card" style={{ padding: "20px" }}>
        <button 
          onClick={() => { setSelectedCategory(null); setSearchQuery(""); setCurrentPage(1); }}
          className="audit-action"
          style={{ marginBottom: "16px", padding: "6px 12px" }}
        >
          &larr; Back to Summary
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 className="section-title" style={{ margin: 0 }}>Drilldown: {selectedCategory} ({filteredList.length}/{manifest.filter(r => r.classification === selectedCategory).length})</h3>
          {selectedCategory === "EXACT" && (
            <input 
              type="text" 
              placeholder="Search Bill/Document # or GSTIN..." 
              value={searchQuery}
              onChange={(e) => {setSearchQuery(e.target.value); setCurrentPage(1);}}
              style={{ width: "250px", padding: "6px 12px", border: "1px solid var(--border)", borderRadius: "4px" }}
            />
          )}
        </div>
        
        <div className="table-scroll-container">
          <table className="data-table" style={{ width: "100%", fontSize: "12px", fontFamily: "monospace" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg-subtle)", zIndex: 1 }}>
              <tr>
                <th style={{ textAlign: "left", padding: "8px" }}>Books Bill #</th>
                <th style={{ textAlign: "left", padding: "8px" }}>2B Doc #</th>
                <th style={{ textAlign: "left", padding: "8px" }}>GSTIN</th>
                {selectedCategory === 'DATE_MISMATCH' && <th style={{ textAlign: "left", padding: "8px" }}>Books Date</th>}
                {selectedCategory === 'DATE_MISMATCH' && <th style={{ textAlign: "left", padding: "8px" }}>2B Date</th>}
                {selectedCategory === 'DATE_MISMATCH' && <th style={{ textAlign: "left", padding: "8px" }}>Diff Days</th>}
                
                {selectedCategory === 'G2B_ONLY' && <th style={{ textAlign: "left", padding: "8px" }}>Section</th>}
                
                {selectedCategory !== 'DATE_MISMATCH' && <th style={{ textAlign: "right", padding: "8px" }}>Books Taxable</th>}
                {selectedCategory !== 'DATE_MISMATCH' && <th style={{ textAlign: "right", padding: "8px" }}>2B Taxable</th>}
                
                {selectedCategory === 'VALUE_TAX_MISMATCH' && <th style={{ textAlign: "right", padding: "8px" }}>Taxable Diff</th>}
                {selectedCategory === 'VALUE_TAX_MISMATCH' && <th style={{ textAlign: "right", padding: "8px" }}>Tax Diff</th>}
                
                {selectedCategory === 'ROUNDING' && <th style={{ textAlign: "right", padding: "8px" }}>Total Diff</th>}

                <th style={{ textAlign: "left", padding: "8px" }}>Reason</th>
                <th style={{ textAlign: "center", padding: "8px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedList.map((r, idx) => {
                const b = r.book || {};
                const g = r.g2b || {};
                
                const taxableDiff = (b.taxable || 0) - (g.taxable_value || 0);
                const taxDiff = ((b.igst || 0) + (b.cgst || 0) + (b.sgst || 0) + (b.cess || 0)) - ((g.igst || 0) + (g.cgst || 0) + (g.sgst || 0) + (g.cess || 0));
                
                let diffDays = "—";
                if (r.classification === 'DATE_MISMATCH' && b.date && g.document_date) {
                    const parseDate = (d: string) => {
                        if (d.includes("-") && d.split("-")[0].length === 4) return new Date(d);
                        if (d.includes("-")) { const p = d.split("-"); return new Date(`${p[2]}-${p[1]}-${p[0]}`); }
                        if (d.includes("/")) { const p = d.split("/"); return new Date(`${p[2]}-${p[1]}-${p[0]}`); }
                        return new Date();
                    };
                    const bd = parseDate(b.date);
                    const gd = parseDate(g.document_date);
                    diffDays = Math.abs(Math.floor((bd.getTime() - gd.getTime()) / (1000 * 3600 * 24))).toString();
                }

                const st = r.sub_type || r.provenance || "";
                const isDiscount = st.startsWith('DISCOUNT_BRIDGED');
                const isRcm = st.startsWith('RCM_BRIDGED');
                const isVc = st.startsWith('VENDOR_CREDIT');

                return (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "8px", fontWeight: b.number ? 600 : "normal" }}>{b.number || '—'}</td>
                    <td style={{ padding: "8px", fontWeight: g.document_number ? 600 : "normal", color: g.document_number ? "var(--google-green)" : "inherit" }}>{g.document_number || '—'}</td>
                    <td style={{ padding: "8px" }}>{b.gstin || g.supplier_gstin || '—'}</td>
                    
                    {selectedCategory === 'DATE_MISMATCH' && <td style={{ padding: "8px" }}>{formatDisplayDate(b.date) || '—'}</td>}
                    {selectedCategory === 'DATE_MISMATCH' && <td style={{ padding: "8px", color: "var(--google-green)" }}>{g.document_date || '—'}</td>}
                    {selectedCategory === 'DATE_MISMATCH' && <td style={{ padding: "8px", color: "var(--google-red)" }}>{diffDays}</td>}
                    
                    {selectedCategory === 'G2B_ONLY' && <td style={{ padding: "8px", color: "var(--google-blue)", fontWeight: 600 }}>{g.type || '—'}</td>}
                    
                    {selectedCategory !== 'DATE_MISMATCH' && <td style={{ padding: "8px", textAlign: "right" }}>{b.taxable !== undefined ? formatINR(b.taxable) : '—'}</td>}
                    {selectedCategory !== 'DATE_MISMATCH' && <td style={{ padding: "8px", textAlign: "right", color: "var(--google-green)" }}>{g.taxable_value !== undefined ? formatINR(g.taxable_value) : '—'}</td>}
                    
                    {selectedCategory === 'VALUE_TAX_MISMATCH' && <td style={{ padding: "8px", textAlign: "right", color: Math.abs(taxableDiff) > 1 ? "var(--google-red)" : "inherit" }}>{formatINR(taxableDiff)}</td>}
                    {selectedCategory === 'VALUE_TAX_MISMATCH' && <td style={{ padding: "8px", textAlign: "right", color: Math.abs(taxDiff) > 1 ? "var(--google-red)" : "inherit" }}>{formatINR(taxDiff)}</td>}
                    
                    {selectedCategory === 'ROUNDING' && <td style={{ padding: "8px", textAlign: "right" }}>{formatINR(taxableDiff + taxDiff)}</td>}
                    
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                        {isDiscount && (
                          <span style={{ background: "var(--google-blue)", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", marginRight: "6px" }}>Discount Bridge</span>
                        )}
                        {isRcm && (
                          <span style={{ background: "var(--google-blue)", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", marginRight: "6px" }}>RCM Bridge</span>
                        )}
                        {isVc && (
                          <span style={{ background: "var(--google-blue)", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", marginRight: "6px" }}>Vendor Credit/CDNR</span>
                        )}
                        {r.classification === 'ROUNDING' ? 'MATCH_WITH_ROUNDING' : r.reason || r.sub_type}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button onClick={() => setSelectedRow(r)} className="audit-action" style={{ padding: "4px 8px", fontSize: "11px" }}>View</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        
        {/* Pagination controls for drilldown */}
        {selectedCategory === "EXACT" && (
            <div style={{ padding: "16px", background: "var(--bg-subtle)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", borderRadius: "0 0 8px 8px" }}>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                Showing {((safeCurrentPage - 1) * visibleRows) + 1}–{Math.min(safeCurrentPage * visibleRows, filteredList.length)} of {filteredList.length}
              </div>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <select value={visibleRows} onChange={e => {setVisibleRows(Number(e.target.value)); setCurrentPage(1);}}>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={safeCurrentPage === 1}
                    className="audit-action"
                    style={{ opacity: safeCurrentPage === 1 ? 0.5 : 1, padding: "4px 8px", fontSize: "12px" }}
                  >
                    Previous
                  </button>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={safeCurrentPage >= totalPages}
                    className="audit-action"
                    style={{ opacity: safeCurrentPage >= totalPages ? 0.5 : 1, padding: "4px 8px", fontSize: "12px" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
    );
  }

  // Summary View
  return (
    <div className="section-card" style={{ padding: "20px" }}>
      <div style={{ marginBottom: "16px" }}>
        <h3 className="section-title" style={{ margin: "0 0 8px 0" }}>PURCHASE ↔ GSTR-2B EVIDENCE MATCHING</h3>
        {globalFY === "2025-26" && <span className="status-chip paid" style={{ textTransform: "uppercase" }}>DETERMINISTIC MANIFEST LOADED</span>}
      </div>

      {globalFY !== "2025-26" && (
        <div style={{ margin: "16px 0", padding: "16px", background: "var(--bg-subtle)", borderRadius: "8px", border: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>FY {globalFY} EVIDENCE MATCHING</div>
          <span className="status-chip draft">NOT YET RECONCILED</span>
        </div>
      )}

      {globalFY === "2025-26" && (
        <>
      
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px", fontSize: "12px", fontFamily: "monospace" }}>
        <div style={{ padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}>
          <span style={{ color: "var(--text-secondary)" }}>BOOKS DETAILS: </span><span style={{ fontWeight: 700 }}>1192</span>
        </div>
        <div style={{ padding: "8px 12px", background: "var(--bg-subtle)", borderRadius: "4px", border: "1px solid var(--border-subtle)" }}>
          <span style={{ color: "var(--text-secondary)" }}>AUTHORITATIVE GSTR-2B: </span><span style={{ fontWeight: 700, color: "var(--google-green)" }}>1048</span>
        </div>
        <div style={{ padding: "8px 12px", background: "#fef0ef", borderRadius: "4px", border: "1px solid #f8cdce", color: "var(--google-red)" }}>
          <span>HISTORICAL 1049 — SUPERSEDED PARSER ARTIFACT</span>
        </div>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "13px", fontFamily: "monospace", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
        
        <div 
          onClick={() => setSelectedCategory("EXACT")}
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--border)" }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--google-blue)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <span style={{ color: "var(--text-secondary)" }}>Exact Match:</span>
          <span style={{ fontWeight: 600 }}>{exact.length}</span>
        </div>
        
        <div 
          onClick={() => setSelectedCategory("ROUNDING")}
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--border)" }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--google-blue)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <span style={{ color: "var(--text-secondary)" }}>Rounding Tolerance:</span>
          <span style={{ fontWeight: 600 }}>{rounding.length}</span>
        </div>
        
        <div 
          onClick={() => setSelectedCategory("VALUE_TAX_MISMATCH")}
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "#fef0ef", borderRadius: "6px", cursor: "pointer", border: "1px solid #f8cdce" }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--google-red)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "#f8cdce"}
        >
          <span style={{ color: "var(--google-red)", fontWeight: 600 }}>Value/Tax Mismatch:</span>
          <span style={{ fontWeight: 700, color: "var(--google-red)" }}>{valueTax.length}</span>
        </div>
        
        <div 
          onClick={() => setSelectedCategory("DATE_MISMATCH")}
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "#fef0ef", borderRadius: "6px", cursor: "pointer", border: "1px solid #f8cdce" }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--google-red)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "#f8cdce"}
        >
          <span style={{ color: "var(--google-red)", fontWeight: 600 }}>Date Deviation:</span>
          <span style={{ fontWeight: 700, color: "var(--google-red)" }}>{dateMismatch.length}</span>
        </div>
        
        <div 
          onClick={() => setSelectedCategory("BOOKS_ONLY")}
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--border)" }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--google-blue)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <span style={{ color: "var(--text-secondary)" }}>Books Only (No 2B):</span>
          <span style={{ fontWeight: 600 }}>{booksOnly.length}</span>
        </div>
        
        <div 
          onClick={() => setSelectedCategory("G2B_ONLY")}
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px", cursor: "pointer", border: "1px solid var(--border)" }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--google-blue)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "var(--text-secondary)" }}>2B Only (No Books):</span>
            <span style={{ fontSize: "10px", color: "var(--google-amber)", marginTop: "2px" }}>INCLUDES B2B-CDNR/REJECTED | HISTORICAL: 20 SUPERSEDED</span>
          </div>
          <span style={{ fontWeight: 600 }}>{g2bOnly.length}</span>
        </div>
        
        <div 
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "#f8f9fa", borderRadius: "6px", border: "1px solid #e9ecef" }}
        >
          <span style={{ color: "#adb5bd" }}>Duplicate Groups:</span>
          <span style={{ fontWeight: 600, color: "#adb5bd" }}>{dupGroups.length}</span>
        </div>
        
        <div 
          style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--bg-subtle)", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "var(--text-secondary)" }}>Source Detail Unavailable:</span>
            {sourceLim.length > 0 && (
              <span style={{ fontSize: "10px", color: "var(--google-amber)", marginTop: "2px" }}>
                {sourceLim[0].book?.number || 'BILL'} - SOURCE_DETAIL_NOT_FOUND
              </span>
            )}
          </div>
          <span style={{ fontWeight: 600 }}>{sourceLim.length}</span>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
