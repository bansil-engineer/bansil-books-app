import React, { useState, useEffect, useMemo } from "react";
import type { ExportOptions } from "../types/reconciliation";
import {
  ReportExportConfig,
  getReportExportConfig,
} from "../lib/export/export-field-config";

export interface ExportFieldSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  reportType?: string;
  config?: ReportExportConfig;
  filter?: Record<string, unknown> | any;
  totalRecords?: number;
  onExport?: (options: ExportOptions) => Promise<void>;
  excelEnabled?: boolean;
  pdfEnabled?: boolean;
}

export function ExportFieldSelector({
  isOpen,
  onClose,
  reportType = "summary",
  config: customConfig,
  filter,
  totalRecords,
  onExport,
  excelEnabled: propExcelEnabled,
  pdfEnabled: propPdfEnabled,
}: ExportFieldSelectorProps) {
  // 1. Resolve configuration for the specific report
  const config: ReportExportConfig = useMemo(() => {
    return customConfig || getReportExportConfig(reportType);
  }, [customConfig, reportType]);

  const availableFields = config.fields;
  const fieldGroups = config.fieldGroups;

  const defaultKeys = useMemo(() => {
    return availableFields.filter((f) => f.defaultSelected).map((f) => f.key);
  }, [availableFields]);

  const allKeys = useMemo(() => {
    return availableFields.map((f) => f.key);
  }, [availableFields]);

  // State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(defaultKeys.length > 0 ? defaultKeys : allKeys)
  );
  const [includeTotals, setIncludeTotals] = useState<boolean>(true);
  const [downloadingFormat, setDownloadingFormat] = useState<"excel" | "pdf" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync / Reset on modal open or config change
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setDownloadingFormat(null);
      setSelectedKeys(new Set(defaultKeys.length > 0 ? defaultKeys : allKeys));
      setIncludeTotals(config.includeTotalsSupported);
    }
  }, [isOpen, config, defaultKeys, allKeys]);

  if (!isOpen) return null;

  const isExcelEnabled = (propExcelEnabled ?? true) && config.excelEnabled;
  const isPdfEnabled = (propPdfEnabled ?? true) && config.pdfEnabled;

  const toggleField = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedKeys(new Set(allKeys));
  };

  const clearAll = () => {
    setSelectedKeys(new Set());
  };

  const resetDefault = () => {
    setSelectedKeys(new Set(defaultKeys.length > 0 ? defaultKeys : allKeys));
  };

  const handleDownload = async (format: "excel" | "pdf") => {
    if (selectedKeys.size === 0) {
      setErrorMsg("Please select at least one field to export.");
      return;
    }

    setErrorMsg(null);
    setDownloadingFormat(format);

    // Maintain the order defined in the config fields
    const orderedSelectedFields = availableFields
      .filter((f) => selectedKeys.has(f.key))
      .map((f) => f.key);

    const options: ExportOptions = {
      selectedFields: orderedSelectedFields as any,
      includeTotals: config.includeTotalsSupported ? includeTotals : false,
      reportType: reportType as any,
      format,
    };

    try {
      if (onExport) {
        await onExport(options);
      } else {
        // Direct default API download
        const endpoint = format === "excel" ? "/api/export/excel" : "/api/export/pdf";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...filter,
            reportType,
            selectedFields: orderedSelectedFields,
            includeTotals: config.includeTotalsSupported ? includeTotals : false,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Export failed with status ${res.status}`);
        }

        const blob = await res.blob();
        const contentDisposition = res.headers.get("content-disposition");
        let filename = `Bansil_${config.reportType}_${new Date().toISOString().slice(0, 10)}.${
          format === "excel" ? "xlsx" : "pdf"
        }`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="?([^"]+)"?/);
          if (match && match[1]) filename = match[1];
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }

      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate export file";
      setErrorMsg(msg);
    } finally {
      setDownloadingFormat(null);
    }
  };

  // Dynamically calculate grid columns based on number of groups
  const columnCount = Math.min(Math.max(fieldGroups.length, 1), 5);

  return (
    <div
      className="export-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div className="export-modal-card">
        {/* Header */}
        <div className="export-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="export-modal-icon">📊</div>
            <div>
              <h2 id="export-dialog-title" className="export-modal-title">
                SELECT EXPORT FIELDS
              </h2>
              <p className="export-modal-subtitle">
                {config.title} — {config.subtitle}
                {typeof totalRecords === "number" && (
                  <span style={{ marginLeft: 6, opacity: 0.85, fontWeight: 600 }}>
                    ({totalRecords} records)
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="export-modal-close-btn"
            onClick={onClose}
            aria-label="Close export dialog"
          >
            ✕
          </button>
        </div>

        {/* Error notification */}
        {errorMsg && (
          <div className="export-modal-error">
            <span>⚠️ {errorMsg}</span>
          </div>
        )}

        {/* Categories Grid - dynamic columns based on actual groups */}
        <div
          className="export-fields-container"
          style={{
            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          }}
        >
          {fieldGroups.map((group) => {
            const fieldsInGroup = availableFields.filter((f) => f.group === group);
            if (fieldsInGroup.length === 0) return null;

            const selectedInGroupCount = fieldsInGroup.filter((f) =>
              selectedKeys.has(f.key)
            ).length;

            return (
              <div key={group} className="export-category-column">
                <div className="export-category-header">
                  <h3>{group}</h3>
                  <span className="export-category-badge">
                    {selectedInGroupCount}/{fieldsInGroup.length}
                  </span>
                </div>

                <div className="export-category-fields">
                  {fieldsInGroup.map((field) => {
                    const isChecked = selectedKeys.has(field.key);
                    return (
                      <label
                        key={field.key}
                        className={`export-field-checkbox-row ${isChecked ? "checked" : ""}`}
                        title={field.type ? `Type: ${field.type}` : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleField(field.key)}
                          id={`export-field-${config.reportType}-${field.key}`}
                        />
                        <span className="export-field-custom-box" aria-hidden="true" />
                        <span className="export-field-label">{field.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selection Toolbar & Options */}
        <div className="export-modal-toolbar">
          <div className="export-toolbar-buttons">
            <button
              type="button"
              className="export-toolbar-btn"
              onClick={selectAll}
              title="Select all available export fields"
            >
              Select All
            </button>
            <button
              type="button"
              className="export-toolbar-btn"
              onClick={clearAll}
              title="Clear all selected fields"
            >
              Clear All
            </button>
            <button
              type="button"
              className="export-toolbar-btn"
              onClick={resetDefault}
              title="Reset to recommended default fields"
            >
              Default Fields
            </button>
            <span className="export-selected-count">
              {selectedKeys.size} of {availableFields.length} fields selected
            </span>
          </div>

          {/* Conditional Totals Checkbox */}
          {config.includeTotalsSupported ? (
            <div className="export-totals-toggle-group">
              <label className="export-totals-label">
                <input
                  type="checkbox"
                  checked={includeTotals}
                  onChange={(e) => setIncludeTotals(e.target.checked)}
                  id="export-include-totals"
                />
                <span className="export-field-custom-box" aria-hidden="true" />
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  Include Totals
                </span>
              </label>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              Totals not applicable for this report
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="export-modal-footer">
          <button
            type="button"
            className="export-btn-cancel"
            onClick={onClose}
            disabled={downloadingFormat !== null}
          >
            Cancel
          </button>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {isExcelEnabled && (
              <button
                type="button"
                className="btn-export-excel export-action-btn"
                onClick={() => handleDownload("excel")}
                disabled={downloadingFormat !== null || selectedKeys.size === 0}
                id="btn-confirm-download-excel"
              >
                <span>{downloadingFormat === "excel" ? "⏳" : "📊"}</span>
                <span>
                  {downloadingFormat === "excel" ? "Generating Excel..." : "Download Excel"}
                </span>
              </button>
            )}

            {isPdfEnabled && (
              <button
                type="button"
                className="btn-export-pdf export-action-btn"
                onClick={() => handleDownload("pdf")}
                disabled={downloadingFormat !== null || selectedKeys.size === 0}
                id="btn-confirm-download-pdf"
              >
                <span>{downloadingFormat === "pdf" ? "⏳" : "📄"}</span>
                <span>
                  {downloadingFormat === "pdf" ? "Generating PDF..." : "Download PDF"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
