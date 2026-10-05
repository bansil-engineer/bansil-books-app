"use client";

import React, { useState, useEffect } from "react";
import { FEATURE_REGISTRY, isFeatureEffectivelyEnabled, allModuleKeys, type FeatureDefinition } from "@/app/lib/feature-registry";

interface SettingsModulesViewProps {
  onSettingsChanged?: () => void;
}

const MODULE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  reconciliation: "Reconciliation",
  transactions: "Transactions",
  services: "Services",
  inventory: "Inventory",
  customers: "Customers",
  reports: "Reports",
  other: "Additional Features",
  sync: "Zoho / Sync",
  audit: "Reconciliation & Audit",
  settings: "Settings / Administration",
};

const MODULE_ORDER = ["dashboard", "reconciliation", "transactions", "services", "inventory", "customers", "reports", "other", "sync", "audit", "settings"];

const EXPANDED_STATE_STORAGE_KEY = "bansil.settings.moduleSectionsExpanded";

export function SettingsModulesView({ onSettingsChanged }: SettingsModulesViewProps) {
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Every top-level module section is COLLAPSED by default; the owner's
  // expand/collapse choice per module is remembered locally (per-browser)
  // so this page never grows unnecessarily long on a normal visit.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleModuleExpanded = (moduleKey: string) => {
    setExpanded((prev) => ({
      ...prev,
      [moduleKey]: !prev[moduleKey],
    }));
  };

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        const res = await fetch("/api/settings", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          if (json.settings) setSettings(json.settings);
        }
      } catch {
        // silent fallback
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleToggle = async (key: string, newCheckedState: boolean) => {
    // Optimistically update the UI using functional state to prevent stale closures
    setSettings((prev) => ({ ...prev, [key]: newCheckedState }));

    try {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key, enabled: newCheckedState }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        if (json.settings) {
          setSettings(json.settings);
        }
        setErrorMessage(null);
        setSaveMessage("✓ Settings updated in local SQLite");
        setTimeout(() => setSaveMessage(null), 3000);
        if (onSettingsChanged) onSettingsChanged();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.error || "Failed to update setting. Unauthorized or locked.");
        setTimeout(() => setErrorMessage(null), 6000);
        // Revert on failure
        setSettings((prev) => ({ ...prev, [key]: !newCheckedState }));
      }
    } catch {
      setErrorMessage("Network error updating setting.");
      setTimeout(() => setErrorMessage(null), 6000);
      // Revert on error
      setSettings((prev) => ({ ...prev, [key]: !newCheckedState }));
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const ownValue = (def: FeatureDefinition): boolean => (settings[def.feature_key] !== undefined ? settings[def.feature_key] : def.default_enabled);
  const ancestorsOk = (def: FeatureDefinition): boolean => (def.parent_feature_key ? isFeatureEffectivelyEnabled(def.parent_feature_key, settings) : true);

  function renderRow(def: FeatureDefinition, indent: number) {
    const parentOk = ancestorsOk(def);
    const value = ownValue(def);
    const notImplemented = def.implementation_status === "NOT_IMPLEMENTED";
    const isSaving = savingKeys.has(def.feature_key);

    return (
      <div
        key={def.feature_key}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "7px 0",
          paddingLeft: indent * 16,
          borderBottom: "1px solid #f1f5f9",
          opacity: parentOk ? 1 : 0.5,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{def.label}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>{def.description}</div>
        </div>
        {notImplemented ? (
          <span style={{ fontSize: 10.5, background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontWeight: 700, whiteSpace: "nowrap" }}>
            COMING SOON
          </span>
        ) : def.server_guard_required ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10.5, background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", padding: "2px 8px", borderRadius: 4, fontWeight: 700, whiteSpace: "nowrap" }}>
              LOCKED / REQUIRED
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!parentOk && (
              <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>
                (Disabled by parent)
              </span>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, opacity: isSaving ? 0.5 : 1 }}>
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => handleToggle(def.feature_key, e.target.checked)}
                style={{ width: 15, height: 15, cursor: "pointer" }}
              />
              <span style={{ color: value ? "#16a34a" : "#94a3b8", fontWeight: 500 }}>
                {value ? "ON" : "OFF"}
              </span>
            </label>
            {isSaving && <span style={{ fontSize: 10, color: "#3b82f6" }}>Saving...</span>}
          </div>
        )}
      </div>
    );
  }

  function renderModuleSection(moduleKey: string) {
    const defs = FEATURE_REGISTRY.filter((f) => f.module_key === moduleKey).sort((a, b) => a.sort_order - b.sort_order);
    if (defs.length === 0) return null;

    const roots = defs.filter((f) => f.parent_feature_key === null || !defs.some((d) => d.feature_key === f.parent_feature_key));
    const isExpanded = expanded[moduleKey] === true;

    // Recursively renders every descendant of `parentKey` within this
    // module, honoring arbitrary nesting depth (e.g. Reconciliation &
    // Audit's root -> sub_audit_uploads -> "Source Intake" group ->
    // audit_feat_pdf_intake is 3 levels deep) — grouping by ui_group at
    // whichever level it is declared, direct children otherwise.
    const renderSubtree = (parentKey: string, indent: number): React.ReactNode => {
      const directChildren = defs.filter((f) => f.parent_feature_key === parentKey && f.ui_group === null);
      const groupNames = [...new Set(defs.filter((f) => f.parent_feature_key === parentKey && f.ui_group).map((f) => f.ui_group as string))];
      return (
        <>
          {directChildren.map((c) => (
            <React.Fragment key={c.feature_key}>
              {renderRow(c, indent)}
              {renderSubtree(c.feature_key, indent + 1)}
            </React.Fragment>
          ))}
          {groupNames.map((groupName) => (
            <div key={groupName} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 4px " + indent * 16 + "px" }}>
                {groupName}
              </div>
              {defs
                .filter((f) => f.parent_feature_key === parentKey && f.ui_group === groupName)
                .map((c) => (
                  <React.Fragment key={c.feature_key}>
                    {renderRow(c, indent + 1)}
                    {renderSubtree(c.feature_key, indent + 2)}
                  </React.Fragment>
                ))}
            </div>
          ))}
        </>
      );
    };

    return (
      <div key={moduleKey} style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", background: "#ffffff" }}>
        <button
          onClick={() => toggleModuleExpanded(moduleKey)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "14px 18px",
            background: "#f8fafc",
            border: "none",
            borderBottom: isExpanded ? "1px solid #e2e8f0" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: "#64748b" }}>{isExpanded ? "▾" : "▸"}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{MODULE_TITLES[moduleKey] ?? moduleKey}</span>
          <span style={{ fontSize: 11.5, color: "#94a3b8", marginLeft: "auto" }}>{defs.length} feature{defs.length === 1 ? "" : "s"}</span>
        </button>

        {isExpanded && (
          <div style={{ padding: "10px 18px 18px 18px" }}>
            {roots.map((root) => (
              <div key={root.feature_key} style={{ marginBottom: 10 }}>
                {renderRow(root, 0)}
                {renderSubtree(root.feature_key, 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Modules &amp; Feature Controls
          </h2>
          <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
            One central registry for every Bansil Books module and feature. Server-side enforced where marked (not just hidden in the UI). Stored in local SQLite.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
          {saveMessage && (
            <span style={{ fontSize: 12, color: "#16a34a", background: "#f0fdf4", padding: "4px 10px", borderRadius: 4, fontWeight: 600, border: "1px solid #bbf7d0" }}>
              {saveMessage}
            </span>
          )}
          {errorMessage && (
            <span style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", padding: "4px 10px", borderRadius: 4, fontWeight: 600, border: "1px solid #fecaca" }}>
              {errorMessage}
            </span>
          )}
        </div>
      </div>

      {/* Owner Control Notice */}
      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          padding: "12px 16px",
          marginBottom: 20,
          fontSize: 12.5,
          color: "#334155",
          lineHeight: 1.5,
        }}
      >
        🔒 <strong>Owner Control Note:</strong> Turning a feature OFF hides/blocks it (navigation and, where server-enforced, the API itself) — it never deletes accounting data, audit data, settings, snapshots, or history. Turning a parent OFF never resets its children&apos;s stored state; re-enabling the parent restores exactly what was there before. Inventory / Customers / Reports remain LOCKED protected modules — these controls only gate access, never their calculations.
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Loading module settings…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {MODULE_ORDER.filter((m) => allModuleKeys().includes(m)).map((moduleKey) => renderModuleSection(moduleKey))}
        </div>
      )}
    </div>
  );
}
