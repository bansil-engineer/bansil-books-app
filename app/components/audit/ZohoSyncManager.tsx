"use client";

import React, { useState } from "react";

export function ZohoSyncManager({ globalFY, period, coverage }: { globalFY: string; period: string; coverage?: any }) {
  const [syncState, setSyncState] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/evidence/zoho-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fy: globalFY, period, syncModule: "all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSyncState(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  if (globalFY === "2025-26") {
    // FY25-26 is authoritative, do not show bulk sync button per instructions
    return null; 
  }

  return (
    <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button 
          onClick={handleSync} 
          disabled={true} 
          className="btn-primary" 
          style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '4px', background: 'var(--google-blue)', color: 'white', border: 'none', fontWeight: 600, cursor: 'not-allowed', opacity: 0.6 }}
        >
          {isSyncing ? "SYNCING..." : "CONTINUE SYNC (DISABLED FOR REPAIR)"}
        </button>
        <button 
          className="btn-primary" 
          style={{ padding: '8px 16px', fontSize: '13px', borderRadius: '4px', background: 'var(--google-green)', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer' }}
        >
          SYNC ALL FY
        </button>
      </div>

      {coverage && coverage.total && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
          <div><strong style={{color: 'var(--text-primary)'}}>Universe:</strong> {coverage.total.universe}</div>
          <div><strong style={{color: 'var(--text-primary)'}}>Total Cached Now:</strong> {coverage.total.acquired}</div>
          <div><strong style={{color: 'var(--text-primary)'}}>Remaining:</strong> {coverage.total.remaining}</div>
          <div style={{ color: (coverage.total.acquired + coverage.total.remaining) === coverage.total.universe ? 'var(--google-green)' : 'var(--google-red)', fontWeight: 600, marginTop: '4px' }}>
            Equation: {coverage.total.acquired} + {coverage.total.remaining} = {coverage.total.acquired + coverage.total.remaining} / {coverage.total.universe}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "8px", background: "#fef0ef", color: "var(--google-red)", borderRadius: "4px", fontSize: "12px", position: "absolute", top: "100%", right: 0, zIndex: 10, width: "300px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
          <strong>SYNC BLOCKED:</strong> {error}
        </div>
      )}

      {syncState && (
        <div style={{ position: "absolute", top: "100%", right: 0, background: "#fff", border: "1px solid var(--border-subtle)", borderRadius: "6px", padding: "16px", fontSize: "12px", zIndex: 10, width: "400px", boxShadow: "0 8px 16px rgba(0,0,0,0.1)", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>SYNC PROGRESS</h4>
            <button onClick={() => setSyncState(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
            <div><span style={{ color: "var(--text-secondary)" }}>Documents Universe:</span> {syncState.universe}</div>
            <div><span style={{ color: "var(--text-secondary)" }}>Cached Before Run:</span> {syncState.cachedBeforeRun ?? (syncState.universe - (syncState.remaining + syncState.newlyFetched))}</div>
            <div><span style={{ color: "var(--text-secondary)" }}>Newly Fetched This Run:</span> {syncState.newlyFetched}</div>
            <div><span style={{ color: "var(--text-secondary)" }}>Revised This Run:</span> 0</div>
            <div><span style={{ color: "var(--text-secondary)" }}>Failed This Run:</span> 0</div>
            <div><span style={{ color: "var(--text-secondary)" }}>Total Cached Now:</span> {syncState.totalCachedNow ?? (syncState.universe - syncState.remaining)}</div>
            <div><span style={{ color: "var(--text-secondary)" }}>Remaining:</span> {syncState.remaining}</div>
            <div><span style={{ color: "var(--text-secondary)" }}>GETs This Run:</span> {syncState.getsUsed} / 100</div>
            <div style={{ gridColumn: "1 / -1", color: "var(--google-blue)", fontWeight: 500 }}>ZOHO WRITE: 0</div>
          </div>
          
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", marginTop: "8px", marginBottom: "12px" }}>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>GST FILING</div>
            <div><span style={{ color: "var(--text-secondary)" }}>GSTR-1:</span> NOT EXPOSED / FILE REQUIRED</div>
            <div><span style={{ color: "var(--text-secondary)" }}>GSTR-3B:</span> NOT EXPOSED / FILE REQUIRED</div>
          </div>

          {syncState.status === "paused" && (
            <div style={{ padding: "8px", background: "#fff3e0", color: "#e65100", borderRadius: "4px", marginBottom: "12px", fontWeight: 500 }}>
              SYNC PAUSED — API SAFETY LIMIT
            </div>
          )}

          {syncState.status === "completed" && (
            <div style={{ padding: "8px", background: "#e6f4ea", color: "var(--google-green)", borderRadius: "4px", marginBottom: "12px", fontWeight: 500 }}>
              BOOKS DATA SYNCED
            </div>
          )}

          {syncState.status === "paused" && (
            <button 
              onClick={handleSync} 
              disabled={isSyncing || syncState.universe !== ((syncState.totalCachedNow ?? (syncState.universe - syncState.remaining)) + syncState.remaining)} 
              className="btn-primary" 
              style={{ fontSize: "11px", padding: "6px 12px", width: "100%" }}
            >
              {syncState.universe !== ((syncState.totalCachedNow ?? (syncState.universe - syncState.remaining)) + syncState.remaining) ? "SYNC STATE REQUIRES REVIEW" : "Continue Sync"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
