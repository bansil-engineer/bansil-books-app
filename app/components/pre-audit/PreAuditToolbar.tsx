"use client";

import React, { useState, useEffect } from "react";
import { SourceWatermark, PreAuditSourceConfig } from "@/app/lib/audit/pre-audit-sync-service";

interface PreAuditToolbarProps {
  sourceId: string;
  financialYear: string;
  accountId?: string;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onSyncComplete?: () => void;
  isExternalSource?: boolean;
}

export function PreAuditToolbar({
  sourceId,
  financialYear,
  accountId = "",
  onExportExcel,
  onExportPdf,
  onSyncComplete,
  isExternalSource = false,
}: PreAuditToolbarProps) {
  const [watermark, setWatermark] = useState<SourceWatermark | null>(null);
  const [sourceConfig, setSourceConfig] = useState<PreAuditSourceConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showSelectiveModal, setShowSelectiveModal] = useState(false);

  // Fetch watermark for this source
  const fetchWatermark = async () => {
    try {
      const res = await fetch(
        `/api/audit/pre-audit/sync?sourceId=${encodeURIComponent(sourceId)}&financialYear=${encodeURIComponent(financialYear)}&accountId=${encodeURIComponent(accountId)}`
      );
      const data = await res.json();
      if (data.success) {
        setWatermark(data.watermark);
        setSourceConfig(data.currentSource);
      }
    } catch (e) {
      console.error("Failed to load watermark:", e);
    }
  };

  useEffect(() => {
    fetchWatermark();
  }, [sourceId, financialYear, accountId]);

  const handleSmartSync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/audit/pre-audit/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          financialYear,
          accountId
        })
      });
      const data = await res.json();
      if (data.success || data.status === "SKIPPED_FRESH") {
        setWatermark(data.watermark);
        setFeedback(`✓ ${data.message}`);
        if (onSyncComplete) onSyncComplete();
      } else {
        setFeedback(`⚠ ${data.message}`);
      }
    } catch (e: any) {
      setFeedback(`✕ Sync error: ${e.message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  };

  const handleExternalUploadClick = () => {
    alert(`External Evidence Intake: Please attach/upload official government portal exports (.json/.xlsx/.pdf) for ${sourceConfig?.display_name || sourceId}. Files are stored in the local audit vault.`);
  };

  const isExternal = isExternalSource || sourceConfig?.classification === "EXTERNAL_SOURCE";

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "12px 16px",
      background: "var(--card-bg, #ffffff)",
      border: "1px solid var(--border-color, #e2e8f0)",
      borderRadius: "8px",
      marginBottom: "16px",
      boxShadow: "0 1px 2px rgba(0,0,0,0.03)"
    }}>
      {/* Left: Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        {isExternal ? (
          <button
            onClick={handleExternalUploadClick}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#ffffff",
              background: "#4b5563",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "background 0.15s ease"
            }}
            title="External portal data cannot be retrieved from Zoho. Upload official JSON/Excel files."
          >
            <span>📎</span>
            <span>IMPORT / ATTACH EXTERNAL EVIDENCE</span>
          </button>
        ) : (
          <>
            <button
              onClick={handleSmartSync}
              disabled={syncing}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#ffffff",
                background: syncing ? "#94a3b8" : "var(--primary-color, #2563eb)",
                border: "none",
                borderRadius: "6px",
                cursor: syncing ? "not-allowed" : "pointer",
                transition: "background 0.15s ease"
              }}
              title="Incremental Delta Sync: Fetches new/changed records only, preserves unchanged data, advances watermark only upon complete success."
            >
              <span className={syncing ? "animate-spin" : ""}>🔄</span>
              <span>{syncing ? "SYNCING DELTA..." : "SMART SYNC ALL CHANGED"}</span>
            </button>

            <button
              onClick={() => setShowSelectiveModal(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "7px 12px",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--text-primary, #1e293b)",
                background: "var(--bg-subtle, #f8fafc)",
                border: "1px solid var(--border-color, #cbd5e1)",
                borderRadius: "6px",
                cursor: "pointer"
              }}
            >
              <span>⚙</span>
              <span>SELECTIVE SYNC</span>
            </button>
          </>
        )}

        <div style={{ width: "1px", height: "24px", background: "var(--border-color, #e2e8f0)", margin: "0 2px" }} />

        <button
          onClick={onExportExcel}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "7px 12px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#166534",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            cursor: "pointer"
          }}
          title="Export current table view and audit context to Excel (.xlsx)"
        >
          <span>📊</span>
          <span>EXPORT EXCEL</span>
        </button>

        <button
          onClick={onExportPdf}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "7px 12px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#991b1b",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            cursor: "pointer"
          }}
          title="Export isolated report-only PDF (excludes browser chrome, sidebar, and search bars)"
        >
          <span>📄</span>
          <span>EXPORT PDF</span>
        </button>

        {feedback && (
          <span style={{
            fontSize: "12px",
            fontWeight: 500,
            color: feedback.startsWith("✓") ? "#15803d" : "#b91c1c",
            marginLeft: "6px"
          }}>
            {feedback}
          </span>
        )}
      </div>

      {/* Right: Watermark & Telemetry Badges */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontSize: "11px" }}>
        {sourceConfig && (
          <span style={{
            padding: "3px 8px",
            borderRadius: "4px",
            background: isExternal ? "#fef3c7" : "#e0e7ff",
            color: isExternal ? "#92400e" : "#3730a3",
            fontWeight: 600
          }}>
            {sourceConfig.classification.replace(/_/g, " ")}
          </span>
        )}

        <div style={{ color: "var(--text-secondary, #64748b)" }}>
          <span>Smart Sync: </span>
          <strong style={{ color: "var(--text-primary, #1e293b)" }}>
            {watermark?.last_successful_sync 
              ? new Date(watermark.last_successful_sync).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) 
              : "NOT RUN"}
          </strong>
        </div>

        <div style={{ color: "var(--text-secondary, #64748b)" }}>
          <span>Local Evidence Through: </span>
          <strong style={{ color: "var(--text-primary, #1e293b)" }}>
            {watermark?.coverage_through ? new Date(watermark.coverage_through).toLocaleDateString("en-IN") : "NO EVIDENCE"}
          </strong>
        </div>

        <div style={{ color: "var(--text-secondary, #64748b)" }}>
          <span>API Calls: </span>
          <strong style={{ color: "var(--text-primary, #1e293b)" }}>
            {watermark?.api_calls_used ?? 0}
          </strong>
        </div>

        <span style={{
          padding: "2px 7px",
          borderRadius: "10px",
          fontSize: "10px",
          fontWeight: 700,
          background: watermark?.status === "SUCCESS" ? "#dcfce7" : (isExternal ? "#fef3c7" : "#f1f5f9"),
          color: watermark?.status === "SUCCESS" ? "#15803d" : (isExternal ? "#92400e" : "#475569")
        }}>
          {isExternal ? "EXTERNAL EVIDENCE NEEDED" : (watermark?.status || "READY")}
        </span>
      </div>

      {/* Selective Sync Modal */}
      {showSelectiveModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999
        }}>
          <div style={{
            background: "#ffffff",
            padding: "24px",
            borderRadius: "8px",
            maxWidth: "480px",
            width: "90%",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)"
          }}>
            <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Selective Source Sync</h3>
            <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "16px" }}>
              Configure targeted synchronization for <strong>{sourceConfig?.display_name || sourceId}</strong> ({financialYear}).
            </p>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                Target Financial Year
              </label>
              <input
                type="text"
                readOnly
                value={financialYear}
                style={{ width: "100%", padding: "8px", fontSize: "12px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "4px" }}
              />
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                Classification
              </label>
              <div style={{ fontSize: "12px", color: "#334155", padding: "8px", background: "#f1f5f9", borderRadius: "4px" }}>
                {sourceConfig?.classification} — {sourceConfig?.description}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                onClick={() => setShowSelectiveModal(false)}
                style={{ padding: "8px 14px", fontSize: "12px", background: "#e2e8f0", border: "none", borderRadius: "4px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowSelectiveModal(false);
                  handleSmartSync();
                }}
                style={{ padding: "8px 14px", fontSize: "12px", background: "var(--primary-color, #2563eb)", color: "#ffffff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: 600 }}
              >
                Sync Selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
