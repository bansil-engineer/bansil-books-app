"use client";

import React from "react";
import { UniversalSearchBox } from "./UniversalSearchBox";

interface TopHeaderProps {
  pageTitle: string;
  syncStatusText: string;
  lastSyncTime: string;
  syncing: boolean;
  connected?: boolean;
  onSync: () => void;
  onNavigateToCustomer?: (
    customerId: string,
    customerName?: string,
    preferredTab?: "OVERVIEW" | "RECONCILIATION"
  ) => void;
}

export function TopHeader({
  pageTitle,
  syncStatusText,
  lastSyncTime,
  syncing,
  connected = true,
  onSync,
  onNavigateToCustomer,
}: TopHeaderProps) {
  const isOffline = !connected || syncStatusText === "Offline";

  return (
    <header className="app-top-header" role="banner">
      <div className="app-top-header-left">
        <h1 className="app-page-title">{pageTitle}</h1>
        {process.env.NODE_ENV === "development" && (
          <a
            href="/master-audit-v2"
            title="Open Master Audit V2 — read-only pilot"
            style={{ display: "inline-flex", alignItems: "center", padding: "8px 12px", border: "1px solid #b9d7ea", borderRadius: 6, background: "#edf7fd", color: "#2877a5", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Master Audit V2 ↗
          </a>
        )}
        {/* Universal Search */}
        <UniversalSearchBox onNavigateToCustomer={onNavigateToCustomer} />
      </div>

      <div className="app-top-header-right">

        {/* Sync status chip */}
        <div className="header-sync-status">
          <span
            className={`header-sync-dot ${!isOffline && (syncStatusText === "Up to Date" || syncStatusText === "SUCCESS") ? "dot-green" : "dot-amber"}`}
          />
          <span className="header-sync-label">
            {isOffline ? (
              <span style={{ color: "#dc2626", fontWeight: 600 }}>Offline (SQLite Cache)</span>
            ) : (
              <>Last sync: <strong>{lastSyncTime}</strong></>
            )}
          </span>
        </div>

        {/* Security badge */}
        <div className="header-security-badge" title="Zoho Books — Read Only">
          🔒 Read Only
        </div>

        {/* Sync button */}
        <button
          className="header-sync-btn"
          onClick={onSync}
          disabled={syncing || isOffline}
          title={isOffline ? "Offline — viewing last synchronized local data." : "Fetch new or modified records from Zoho Books (Incremental, GET only)"}
          style={isOffline ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
        >
          <span>{syncing ? "⏳" : "↻"}</span>
          <span>{syncing ? "Syncing…" : "Sync Zoho Books"}</span>
        </button>
      </div>
    </header>
  );
}
