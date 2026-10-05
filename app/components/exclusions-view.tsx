import React, { useState, useEffect, useCallback } from "react";
import { formatSyncDate } from "@/app/lib/date-utils";
import { ExportDialog } from "./ExportDialog";
import type { ExportOptions } from "@/app/types/reconciliation";

export function ExclusionsView() {
  const [exclusions, setExclusions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState<boolean>(false);

  const loadExclusions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/exclusions?status=ALL");
      if (!res.ok) throw new Error("Failed to fetch exclusions");
      const data = await res.json();
      setExclusions(data.exclusions || []);
    } catch (err: any) {
      setError(err.message || "Failed to load exclusions");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExecuteExport = async (options: ExportOptions) => {
    const params = new URLSearchParams({
      reportType: "excluded-items",
      status: "ALL",
      includeTotals: options.includeTotals ? "true" : "false",
    });
    if (options.selectedFields && options.selectedFields.length > 0) {
      params.set("selectedFields", options.selectedFields.join(","));
    }
    const endpoint = options.format === "pdf" ? "/api/export/pdf" : "/api/export/excel";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error("Exclusions export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Bansil_Excluded_Items_${new Date().toISOString().slice(0, 10)}.${options.format === "pdf" ? "pdf" : "xlsx"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    loadExclusions();
  }, [loadExclusions]);

  const toggleStatus = async (exclusionId: string, currentStatus: string) => {
    const action = currentStatus === "ACTIVE" ? "DEACTIVATE" : "REACTIVATE";
    if (!confirm(`Are you sure you want to ${action.toLowerCase()} this rule?`)) return;

    try {
      const res = await fetch("/api/exclusions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exclusionId, action })
      });
      if (!res.ok) throw new Error("Failed to update status");
      loadExclusions();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteExclusion = async (exclusionId: string) => {
    if (!confirm("Are you sure you want to PERMANENTLY DELETE this rule?")) return;

    try {
      const res = await fetch(`/api/exclusions?id=${exclusionId}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Failed to delete rule");
      loadExclusions();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>
        Loading Exclusion Rules...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "var(--google-red)" }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 20 }}>
      <div style={{ padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 500, margin: 0, color: "var(--text-primary)" }}>
            Exclusion Rules
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>
            Manage items and customers excluded from the Master Reconciliation report.
          </p>
        </div>
        <button
          className="btn-export-excel btn-sm"
          onClick={() => setShowExportDialog(true)}
          style={{ fontWeight: 600, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span>📥</span>
          <span>Export Exclusions</span>
        </button>
      </div>

      <div style={{ flex: 1, padding: "0 24px 24px", overflowY: "auto" }}>
        {exclusions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, background: "#f8f9fa", borderRadius: 8, color: "var(--text-secondary)" }}>
            No exclusion rules found.
          </div>
        ) : (
          <div className="table-container">
            <table className="reconciliation-table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 140 }}>Financial Year</th>
                  <th>Customer</th>
                  <th>Item</th>
                  <th>Reason</th>
                  <th>Approver</th>
                  <th style={{ width: 120 }}>Date Added</th>
                  <th style={{ width: 160, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {exclusions.map((ex) => {
                  const isGlobal = !ex.customer_id;
                  const isAllFY = !ex.financial_year;
                  const scopeLabel = isGlobal ? "Global (All Customers)" : ex.customer_name;
                  const fyLabel = isAllFY ? "All Periods" : ex.financial_year;

                  return (
                    <tr key={ex.exclusion_id} style={{ opacity: ex.status === "ACTIVE" ? 1 : 0.6 }}>
                      <td>
                        <span className={`status-chip ${ex.status === "ACTIVE" ? "reconciled" : ""}`}>
                          {ex.status}
                        </span>
                      </td>
                      <td>{fyLabel}</td>
                      <td>{scopeLabel}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{ex.item_name}</div>
                        {ex.sku && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{ex.sku}</div>}
                      </td>
                      <td>
                        <div>{ex.reason}</div>
                        {ex.notes && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{ex.notes}</div>}
                      </td>
                      <td>{ex.approved_by}</td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {formatSyncDate(ex.created_at)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn btn-sm"
                          style={{ marginRight: 8 }}
                          onClick={() => toggleStatus(ex.exclusion_id, ex.status)}
                        >
                          {ex.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ color: "var(--google-red)", borderColor: "var(--google-red)" }}
                          onClick={() => deleteExclusion(ex.exclusion_id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onExport={handleExecuteExport}
        reportType="excluded-items"
        totalRecords={exclusions.length}
      />
    </div>
  );
}
