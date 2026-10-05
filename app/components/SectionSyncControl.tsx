"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PeriodFilterState } from "./PeriodFilter";

export interface SyncState {
  started_at: string | null;
  completed_at: string | null;
  status: string | null; // SUCCESS, FAILED, RUNNING
  records_checked: number;
  records_created: number;
  records_updated: number;
  records_unchanged: number;
  records_failed: number;
  last_error: string | null;
}

interface Props {
  sectionKey: string;
  period: PeriodFilterState;
  onSyncComplete?: () => void;
  buttonLabel?: string;
  runningLabel?: string;
}

export function SectionSyncControl({
  sectionKey,
  period,
  onSyncComplete,
  buttonLabel,
  runningLabel,
}: Props) {
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchInitialLoading, setFetchInitialLoading] = useState(true);

  const isApprovalPending = sectionKey === "APPROVAL_PENDING";

  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit/section-sync?sectionKey=${encodeURIComponent(sectionKey)}`);
      if (res.ok) {
        const data = await res.json();
        setSyncState(data.syncState);
      }
    } catch (err) {
      console.error("Failed to fetch sync state", err);
    } finally {
      setFetchInitialLoading(false);
    }
  }, [sectionKey]);

  useEffect(() => {
    fetchSyncState();
  }, [fetchSyncState]);

  const handleSync = async () => {
    if (loading || syncState?.status === "RUNNING") return;

    setLoading(true);
    setError(null);
    setSyncState(prev => prev ? { ...prev, status: "RUNNING" } : {
      started_at: new Date().toISOString(),
      completed_at: null,
      status: "RUNNING",
      records_checked: 0,
      records_created: 0,
      records_updated: 0,
      records_unchanged: 0,
      records_failed: 0,
      last_error: null,
    });

    try {
      const res = await fetch("/api/audit/section-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionKey,
          period,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Sync failed");
      }

      setSyncState(data.syncState);
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (err: any) {
      setError(err.message);
      await fetchSyncState();
    } finally {
      setLoading(false);
    }
  };

  const isRunning = loading || syncState?.status === "RUNNING";

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString("en-IN");
  };

  const resolvedButtonLabel = buttonLabel || (isApprovalPending ? "🔄 SMART SYNC ALL CHANGED" : "Sync from Zoho");
  const resolvedRunningLabel = runningLabel || (isApprovalPending ? "SYNCING CHANGES..." : "Syncing...");

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-md" style={{ minWidth: "280px" }}>
      <div className="flex justify-between items-start">
        <div className="text-xs text-slate-500">Data Source:</div>
        <div className="text-xs font-medium text-slate-700">Local Zoho Snapshot</div>
      </div>

      <div className="flex justify-between items-center mt-1">
        <div className="text-xs text-slate-500">Last Sync:</div>
        <div className="text-xs font-medium text-slate-700">
          {fetchInitialLoading ? "..." : formatDate(syncState?.completed_at)}
        </div>
      </div>

      <button
        onClick={handleSync}
        disabled={isRunning}
        className={
          isApprovalPending
            ? `mt-2 w-full py-2 px-3 text-xs font-semibold rounded-md transition-all shadow-sm flex items-center justify-center gap-1.5 ${
                isRunning
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed border border-slate-300"
                  : "bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 active:scale-[0.99] cursor-pointer"
              }`
            : `mt-2 w-full py-1.5 px-3 text-sm font-medium rounded transition-colors shadow-sm ${
                isRunning
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 cursor-pointer"
              }`
        }
      >
        {isRunning ? resolvedRunningLabel : resolvedButtonLabel}
      </button>

      {syncState?.status === "SUCCESS" && syncState.completed_at && !loading && (
        <div className="text-xs text-slate-800 bg-white p-2.5 rounded mt-2 border border-slate-200 flex flex-col gap-1.5 shadow-sm">
          <div className="font-semibold text-slate-900 flex items-center justify-between border-b border-slate-100 pb-1">
            <span className="text-emerald-700 font-bold">
              {isApprovalPending ? "SMART SYNC COMPLETED" : "Sync completed"}
            </span>
          </div>
          <div className="text-[11px] text-slate-600">
            <span className="font-medium text-slate-700">Last Sync: </span>
            {formatDate(syncState.completed_at)}
          </div>
          <div className="grid grid-cols-4 gap-1 text-center pt-1 font-medium">
            <div className="bg-slate-50 py-1 px-1 rounded border border-slate-200">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">New</div>
              <div className="text-sm font-bold text-slate-800">{syncState.records_created}</div>
            </div>
            <div className="bg-slate-50 py-1 px-1 rounded border border-slate-200">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Updated</div>
              <div className="text-sm font-bold text-slate-800">{syncState.records_updated}</div>
            </div>
            <div className="bg-slate-50 py-1 px-1 rounded border border-slate-200">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Unchanged</div>
              <div className="text-sm font-bold text-slate-800">{syncState.records_unchanged}</div>
            </div>
            <div className="bg-slate-50 py-1 px-1 rounded border border-slate-200">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Failed</div>
              <div className={`text-sm font-bold ${syncState.records_failed > 0 ? "text-red-600" : "text-slate-800"}`}>
                {syncState.records_failed}
              </div>
            </div>
          </div>
        </div>
      )}

      {(syncState?.status === "FAILED" || error) && !loading && (
        <div className="text-[10px] text-red-700 bg-red-50 px-2 py-1 rounded mt-1 border border-red-100">
          <div className="font-medium">Sync failed</div>
          <div>{error || syncState?.last_error || "Unknown error"}</div>
          <div className="mt-0.5 italic text-slate-600">Showing data from last successful sync.</div>
        </div>
      )}
    </div>
  );
}
