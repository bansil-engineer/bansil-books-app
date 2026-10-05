'use client';

import React, { useState, useRef } from 'react';
import { ZohoSyncManager } from './ZohoSyncManager';

interface StagedFile {
  filename: string;
  evidenceType: string;
  selectedFy: string;
  detectedFy: string;
  detectedPeriod: string;
  detectedGstin: string;
  size: number;
  hash: string;
  docCount: number;
  totalTaxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  validationStatus: string;
  processingStatus: string;
  warnings: string[];
}

interface EvidenceUploadManagerProps {
  globalFY: string;
  requiredSources?: string[];
  mode?: 'panel' | 'global';
}

export default function EvidenceUploadManager({ globalFY, requiredSources = [], mode = 'global' }: EvidenceUploadManagerProps) {
  const [stagedFiles, setStagedFiles] = useState<Record<string, StagedFile>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadType, setActiveUploadType] = useState<string | null>(null);
  const [zohoPreviewSource, setZohoPreviewSource] = useState<string | null>(null);
  
  const sources = mode === 'global' ? [
    'Books Sales', 'Purchase Bills', 'GSTR-1', 'GSTR-2B', 
    'GSTR-3B', 'Liability Ledger', 'Credit Ledger', 'Cash Ledger', 
    'Challan', 'RCM'
  ] : requiredSources;

  const handleUploadClick = (type: string) => {
    setActiveUploadType(type);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeUploadType) return;
    
    // reset input
    e.target.value = '';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('fy', globalFY);
    formData.append('type', activeUploadType);

    try {
      const res = await fetch('/api/audit/evidence/stage', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      setStagedFiles(prev => ({
        ...prev,
        [activeUploadType]: data
      }));
      
    } catch (err) {
      console.error(err);
      alert('Upload staging failed');
    }
  };

  const handleAction = (type: string, action: 'PROCESS' | 'REJECT' | 'REPLACE') => {
    if (action === 'REJECT') {
      setStagedFiles(prev => {
        const copy = { ...prev };
        delete copy[type];
        return copy;
      });
    } else if (action === 'REPLACE') {
      handleUploadClick(type);
    } else if (action === 'PROCESS') {
      alert('OWNER GATE: Automatic processing is disabled in this phase. (ZOHO WRITE: 0)');
      // Normally would POST to a /process endpoint
    }
  };

  // Fake statuses for matrix
  const getMockStatus = (fy: string, src: string) => {
    if (fy === '2025-26') return 'AVAILABLE';
    if (src.includes('Books') || src.includes('Purchase')) return 'PARTIAL';
    if (fy === '2026-27') return 'NOT YET DUE';
    return 'MISSING';
  };

  const fys = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27'];

  return (
    <div style={{ padding: "20px", background: "#fff", border: "1px solid var(--border)", borderRadius: "8px", marginTop: "16px" }}>
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} accept=".pdf,.xlsx,.xls,.csv,.json" />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: "16px" }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          {mode === 'global' ? 'MULTI-FY EVIDENCE DASHBOARD' : 'EVIDENCE REQUIREMENTS'}
        </h3>
        {globalFY === '2025-26' && <span className="status-chip paid">AUTHORITATIVE FY LOCKED</span>}
      </div>

      {mode === 'global' && (
        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px' }}>Evidence</th>
                {fys.map(fy => (
                  <th key={fy} style={{ padding: '8px' }}>{fy}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map(src => (
                <tr key={src} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{src}</td>
                  {fys.map(fy => {
                    const status = getMockStatus(fy, src);
                    return (
                      <td key={fy} style={{ padding: '8px' }}>
                        <span style={{ 
                          fontSize: '10px', 
                          padding: '2px 6px', 
                          borderRadius: '4px',
                          background: status === 'AVAILABLE' ? 'var(--google-green)' : status === 'PARTIAL' ? 'var(--google-amber)' : 'var(--bg-subtle)',
                          color: status === 'AVAILABLE' ? '#fff' : status === 'PARTIAL' ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer'
                        }}>
                          {status}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {globalFY !== '2025-26' && (
        <ZohoSyncManager globalFY={globalFY} period="FULL FY" />
      )}

      {globalFY !== '2025-26' && (
        <div>
          <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>ACTION REQUIRED FOR {globalFY}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sources.map(src => {
              const status = getMockStatus(globalFY, src);
              if (status === 'AVAILABLE' || status === 'NOT YET DUE') return null;
              
              const staged = stagedFiles[src];
              const isBooksSource = src.includes('Books') || src.includes('Purchase') || src.includes('Vendor') || src.includes('Sales');
              
              return (
                <div key={src} style={{ border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{src}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                          Source: {isBooksSource ? 'ZOHO BOOKS — READ ONLY' : 'GST RETURN FILE'}
                        </span>
                      </div>
                      <span className={`status-chip ${staged ? 'paid' : (status === 'PARTIAL' ? 'pending' : 'draft')}`} style={{ fontSize: '10px' }}>
                        {staged ? 'STAGED' : status}
                      </span>
                    </div>
                    {!staged && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {isBooksSource ? (
                          <button onClick={() => setZohoPreviewSource(zohoPreviewSource === src ? null : src)} className="btn-secondary" style={{ fontSize: '11px', padding: '4px 12px' }}>[Acquire from Zoho Books]</button>
                        ) : (
                          <>
                            <button onClick={() => handleUploadClick(src)} className="btn-secondary" style={{ fontSize: '11px', padding: '4px 12px' }}>[Upload]</button>
                            <button disabled className="btn-secondary" style={{ fontSize: '11px', padding: '4px 12px', opacity: 0.5 }}>[BROWSE EXISTING — NOT YET WIRED]</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {zohoPreviewSource === src && !staged && (
                    <div style={{ padding: '16px', background: '#f8f9fa', fontSize: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                      <h5 style={{ margin: '0 0 12px 0', fontSize: '13px' }}>ZOHO ACQUISITION PREVIEW</h5>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Financial Year:</span> {globalFY}</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Period:</span> FULL FY</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Source Type Required:</span> {src}</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Local Coverage:</span> PARTIAL</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Missing Coverage:</span> EST 8,500 ROWS</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Estimated GETs:</span> 45 (Paginated)</div>
                        <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-secondary)' }}>Endpoints:</span> /api/v3/invoices, /api/v3/vendorcredits</div>
                      </div>
                      <div style={{ padding: '8px', background: '#e8f0fe', color: '#174ea6', borderRadius: '4px', marginBottom: '16px', fontWeight: 500 }}>
                        READ ONLY MODE. Original Books data will not be modified.
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => alert('OWNER GATE: Automatic GET is disabled in this phase. (ZOHO GET: 0)')} className="btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }}>REQUEST OWNER AUTHORIZATION</button>
                        <button onClick={() => setZohoPreviewSource(null)} className="btn-secondary" style={{ padding: '6px 16px', fontSize: '12px' }}>CANCEL</button>
                      </div>
                    </div>
                  )}
                  
                  {staged && (
                    <div style={{ padding: '16px', background: '#fff', fontSize: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Filename:</span> {staged.filename}</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Status:</span> <span style={{ color: staged.validationStatus === 'VALIDATED' ? 'var(--google-green)' : 'var(--google-red)', fontWeight: 600 }}>{staged.validationStatus}</span></div>
                        
                        <div><span style={{ color: 'var(--text-secondary)' }}>FY:</span> {staged.detectedFy} {staged.detectedFy !== globalFY && <span style={{ color: 'var(--google-red)' }}>(MISMATCH)</span>}</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Period:</span> {staged.detectedPeriod}</div>
                        
                        <div><span style={{ color: 'var(--text-secondary)' }}>GSTIN:</span> {staged.detectedGstin}</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Size:</span> {(staged.size / 1024).toFixed(2)} KB</div>
                        
                        <div><span style={{ color: 'var(--text-secondary)' }}>Doc Count:</span> {staged.docCount}</div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Total Taxable:</span> ₹{staged.totalTaxable}</div>
                        <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-secondary)' }}>Hash:</span> {staged.hash}</div>
                      </div>
                      
                      {staged.warnings.length > 0 && (
                        <div style={{ padding: '8px', background: '#fef0ef', color: 'var(--google-red)', borderRadius: '4px', marginBottom: '16px' }}>
                          <ul style={{ margin: 0, paddingLeft: '20px' }}>
                            {staged.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}
                      
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleAction(src, 'PROCESS')} disabled={staged.warnings.length > 0} className="btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }}>ACCEPT & PROCESS</button>
                        <button onClick={() => handleAction(src, 'REPLACE')} className="btn-secondary" style={{ padding: '6px 16px', fontSize: '12px' }}>REPLACE</button>
                        <button onClick={() => handleAction(src, 'REJECT')} className="btn-secondary" style={{ padding: '6px 16px', fontSize: '12px', color: 'var(--google-red)' }}>REJECT</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
