"use client";

import React, { useState, useEffect } from "react";
import "./PeriodFilter.css";
import type { MasterPeriodOption } from "@/app/lib/date-period-utils";

export interface PeriodFilterState {
  period: MasterPeriodOption;
  customFrom?: string;
  customTo?: string;
}

interface PeriodFilterProps {
  value: PeriodFilterState;
  onChange: (newState: PeriodFilterState) => void;
  allowedPeriods?: MasterPeriodOption[]; // E.g. ["CURRENT_FY", "PREVIOUS_FY", "ALL_FY", "CUSTOM"]
}

export const PeriodFilter: React.FC<PeriodFilterProps> = ({ 
  value, 
  onChange,
  allowedPeriods = ["CURRENT_FY", "PREVIOUS_FY", "ALL_FY", "CUSTOM"]
}) => {
  const [error, setError] = useState<string | null>(null);
  
  // Local state for custom dates to prevent immediate re-renders
  const [localFrom, setLocalFrom] = useState(value.customFrom || "");
  const [localTo, setLocalTo] = useState(value.customTo || "");

  // Sync local state if value props change externally
  useEffect(() => {
    if (value.period === "CUSTOM") {
      setLocalFrom(value.customFrom || "");
      setLocalTo(value.customTo || "");
    }
  }, [value.period, value.customFrom, value.customTo]);

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPeriod = e.target.value as MasterPeriodOption;
    if (newPeriod !== "CUSTOM") {
      onChange({ period: newPeriod });
      setError(null);
    } else {
      onChange({
        period: newPeriod,
        customFrom: localFrom || undefined,
        customTo: localTo || undefined,
      });
    }
  };

  const handleApplyCustom = () => {
    if (localFrom && localTo && new Date(localFrom) > new Date(localTo)) {
      setError("From date cannot be after To date.");
      return;
    }
    setError(null);
    onChange({
      period: "CUSTOM",
      customFrom: localFrom || undefined,
      customTo: localTo || undefined,
    });
  };

  const periodLabels: Record<MasterPeriodOption, string> = {
    TODAY: "Today",
    THIS_WEEK: "This Week",
    THIS_MONTH: "This Month",
    THIS_QUARTER: "This Quarter",
    CURRENT_FY: "Current FY",
    PREVIOUS_FY: "Previous FY",
    ALL_FY: "All Periods",
    CUSTOM: "Custom Range"
  };

  return (
    <div className="period-filter-container">
      <div className="period-filter-controls">
        <label className="period-filter-label">Period</label>
        <select 
          className="period-filter-select" 
          value={value.period} 
          onChange={handlePeriodChange}
        >
          {allowedPeriods.map(p => (
            <option key={p} value={p}>{periodLabels[p] || p}</option>
          ))}
        </select>

        {value.period === "CUSTOM" && (
          <div className="period-filter-custom">
            <span className="period-filter-separator">From</span>
            <input 
              type="date" 
              className={`period-filter-date ${error ? 'error-border' : ''}`}
              value={localFrom} 
              onChange={e => {
                setLocalFrom(e.target.value);
                setError(null);
              }}
              placeholder="From"
            />
            <span className="period-filter-separator">To</span>
            <input 
              type="date" 
              className={`period-filter-date ${error ? 'error-border' : ''}`}
              value={localTo} 
              onChange={e => {
                setLocalTo(e.target.value);
                setError(null);
              }}
              placeholder="To"
            />
            <button 
              className="period-filter-apply-btn"
              onClick={handleApplyCustom}
              disabled={!localFrom || !localTo}
            >
              Apply
            </button>
          </div>
        )}
      </div>
      {error && <div className="period-filter-error">{error}</div>}
    </div>
  );
};
