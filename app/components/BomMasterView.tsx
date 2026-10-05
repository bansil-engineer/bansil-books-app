"use client";

import React, { useState, useEffect } from 'react';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#6b7280",
  TESTING: "#2563eb",
  PENDING_APPROVAL: "#d97706",
  ACTIVE: "#16a34a",
  DISABLED: "#dc2626",
  SUPERSEDED: "#94a3b8",
  ARCHIVED: "#94a3b8"
};

interface BomItem {
  bom_id: string;
  composite_item_id: string;
  composite_item_name: string;
  version: number;
  status: string;
  effective_from?: string;
  effective_to?: string;
  approved_by?: string;
  approved_at?: string;
}

interface ComponentItem {
  bom_component_id: string;
  component_item_id: string;
  component_description?: string;
  component_sku?: string;
  qty_per_composite_unit: number;
  uom: string;
  tolerance_qty?: number;
  tolerance_percent?: number;
  required_flag: boolean;
}

interface EventItem {
  event_id: string;
  event_time: string;
  event_type: string;
  actor: string;
  previous_status?: string;
  new_status?: string;
  created_at?: string;
  comment?: string;
}

export default function BomMasterView() {
  const [boms, setBoms] = useState<BomItem[]>([]);
  const [selectedBomId, setSelectedBomId] = useState<string>("");
  const [components, setComponents] = useState<ComponentItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [allVersions, setAllVersions] = useState<BomItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assemblyId, setAssemblyId] = useState<string>("");
  const [coverageResult, setCoverageResult] = useState<any>(null);

  async function loadBoms() {
    const res = await fetch("/api/audit/bom/boms");
    const data = await res.json();
    if (data.success) setBoms(data.boms);
    else setError(data.error);
  }

  async function loadDetail(bomId: string) {
    setSelectedBomId(bomId);
    const res = await fetch(`/api/audit/bom/boms/${bomId}`);
    const data = await res.json();
    if (data.success) {
      setComponents(data.components);
      setEvents(data.events);
      const versionsRes = await fetch(`/api/audit/bom/boms?compositeItemId=${encodeURIComponent(data.bom.composite_item_id)}`);
      const versionsData = await versionsRes.json();
      if (versionsData.success) setAllVersions(versionsData.boms);
    } else setError(data.error);
  }

  useEffect(() => {
    loadBoms();
  }, []);

  async function disableSelected() {
    if (!selectedBomId) return;
    const reason = window.prompt("Reason for disabling this BOM snapshot?");
    if (!reason) return;
    const res = await fetch(`/api/audit/bom/boms/${selectedBomId}/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (data.success) {
      setMessage("Disabled. Data is preserved, not deleted.");
      await loadBoms();
      loadDetail(selectedBomId);
    } else setError(data.error);
  }

  async function runCoverage() {
    setError(null);
    setCoverageResult(null);
    const res = await fetch("/api/audit/bom/coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assemblyId })
    });
    const data = await res.json();
    if (data.success) setCoverageResult(data.result);
    else setError(data.error);
  }

  const selectedBom = allVersions.find((b) => b.bom_id === selectedBomId) ?? boms.find((b) => b.bom_id === selectedBomId);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: "100%", overflowX: "hidden" }}>
      <h2 style={{ marginBottom: 4 }}>BOM / Composite Audit</h2>
      <p style={{ color: "#6b7280", marginBottom: 8, maxWidth: 760 }}>
        Zoho / the approved Zoho ecosystem remains the MASTER for Composite Items and BOM. This page reads, inspects, and cross-verifies only — it does not author or approve business master data. Local BOM creation, editing, new-version authoring, and rollback have been disabled from this UI; the underlying tables and coverage/history code are retained as audit infrastructure.
      </p>
      <p style={{ color: "#b45309", marginBottom: 16, maxWidth: 760, fontSize: 13 }}>
        Composite/BOM source status in Zoho itself is <b>NOT_VERIFIED</b> — Zoho Books' own Items API has no composite/BOM concept; Composite Items exist (if at all, for this org) in Zoho Inventory, a separate product not yet confirmed connected. See ITEM_TRACEABILITY_DESIGN.md §D.2. This page never claims full coverage.
      </p>

      {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: 8, borderRadius: 6, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ background: "#dcfce7", color: "#166534", padding: 8, borderRadius: 6, marginBottom: 12 }}>{message}</div>}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 340px", minWidth: 280 }}>
          <h3>Composite Items</h3>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 320, overflowY: "auto" }}>
            {boms.map((b) => (
              <div
                key={b.bom_id}
                onClick={() => loadDetail(b.bom_id)}
                style={{ padding: 10, cursor: "pointer", borderBottom: "1px solid #f3f4f6", background: selectedBomId === b.bom_id ? "#f0f9ff" : "transparent" }}
              >
                <div style={{ fontWeight: 600 }}>{b.composite_item_name}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{b.composite_item_id} · v{b.version}</div>
                <span style={{ fontSize: 11, color: "#fff", background: STATUS_COLOR[b.status] ?? "#6b7280", padding: "1px 6px", borderRadius: 4 }}>{b.status}</span>
              </div>
            ))}
            {boms.length === 0 && <div style={{ padding: 12, color: "#9ca3af" }}>No BOM snapshots on file yet.</div>}
          </div>
        </div>

        <div style={{ flex: "1 1 400px", minWidth: 0 }}>
          {!selectedBom && <p style={{ color: "#9ca3af" }}>Select a composite item to view its BOM snapshot.</p>}
          
          {selectedBom && (
            <>
              <h3>
                {selectedBom.composite_item_name} — v{selectedBom.version} <span style={{ fontSize: 12, color: "#fff", background: STATUS_COLOR[selectedBom.status] ?? "#6b7280", padding: "2px 8px", borderRadius: 4 }}>{selectedBom.status}</span>
              </h3>
              
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Effective {selectedBom.effective_from ?? "—"} to {selectedBom.effective_to ?? "—"}
                {selectedBom.approved_by && <> · reviewed by {selectedBom.approved_by} at {selectedBom.approved_at}</>}
              </div>

              {allVersions.length > 1 && (
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  {allVersions.map((v) => (
                    <button
                      key={v.bom_id}
                      onClick={() => loadDetail(v.bom_id)}
                      style={{ fontSize: 12, padding: "3px 8px", borderRadius: 4, border: "1px solid #d1d5db", background: v.bom_id === selectedBomId ? "#eff6ff" : "#fff", cursor: "pointer" }}
                    >
                      v{v.version} <span style={{ color: STATUS_COLOR[v.status] ?? "#6b7280" }}>{v.status}</span>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {["ACTIVE", "PENDING_APPROVAL", "DRAFT", "TESTING"].includes(selectedBom.status) && (
                  <button onClick={disableSelected}>Disable</button>
                )}
              </div>

              <div style={{ overflowX: "auto", marginBottom: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      <th>Component Item</th>
                      <th>SKU</th>
                      <th>Qty/Unit</th>
                      <th>UOM</th>
                      <th>Tolerance</th>
                      <th>Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((c) => (
                      <tr key={c.bom_component_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td>{c.component_item_id}{c.component_description ? ` — ${c.component_description}` : ""}</td>
                        <td>{c.component_sku ?? "—"}</td>
                        <td>{c.qty_per_composite_unit}</td>
                        <td>{c.uom}</td>
                        <td>{c.tolerance_qty ?? c.tolerance_percent ? `${c.tolerance_qty ?? ""}${c.tolerance_percent ? ` / ${c.tolerance_percent}%` : ""}` : "—"}</td>
                        <td>{c.required_flag ? "Yes" : "Optional"}</td>
                      </tr>
                    ))}
                    {components.length === 0 && <tr><td colSpan={6} style={{ color: "#9ca3af", padding: 8 }}>No components on file.</td></tr>}
                  </tbody>
                </table>
              </div>

              <h4>Version History</h4>
              <div style={{ maxHeight: 160, overflowY: "auto", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                {events.map((e) => (
                  <div key={e.event_id} style={{ marginBottom: 4 }}>
                    <b>{e.event_type}</b> {e.previous_status ?? "—"} &rarr; {e.new_status ?? "—"} by {e.actor} at {e.created_at}
                    {e.comment && <> — {e.comment}</>}
                  </div>
                ))}
                {events.length === 0 && <span style={{ color: "#9ca3af" }}>No events.</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <hr style={{ margin: "24px 0" }} />
      
      <h3>Composite Coverage Engine</h3>
      <p style={{ color: "#6b7280", maxWidth: 760 }}>
        Runs a deterministic expected-vs-actual check against an existing Composite Assembly execution record (from the Composite Assembly ledger), using the reviewed BOM snapshot for that composite item as of the assembly date. Read-only — never writes to the assembly ledger, Zoho, or any production accounting record.
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input 
          placeholder="Assembly ID (from Composite Assembly ledger)" 
          value={assemblyId} 
          onChange={(e) => setAssemblyId(e.target.value)} 
          style={{ width: 340 }} 
        />
        <button onClick={runCoverage} disabled={!assemblyId}>
          Run Coverage Check
        </button>
      </div>
      
      {coverageResult && (
        <pre style={{ background: "#f9fafb", padding: 12, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
          {JSON.stringify(coverageResult, null, 2)}
        </pre>
      )}
    </div>
  );
}
