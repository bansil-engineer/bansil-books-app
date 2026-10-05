"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { MasterInventoryMismatchItem } from "@/app/types/reconciliation";
import { formatINR } from "@/app/lib/date-utils";

export function ExclusionSuggestionsView() {
  const [suggestions, setSuggestions] = useState<MasterInventoryMismatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch the master inventory mismatch report for all time (no specific FY) to find global patterns
      const res = await fetch("/api/inventory-mismatch?financialYear=ALL");
      if (!res.ok) throw new Error("Failed to load inventory data");
      const data = await res.json();
      
      if (data.report && data.report.items) {
        // Filter items that have 100% mismatch (Sales = 0 or Purchase = 0) and are not already excluded
        const suggested = data.report.items.filter((item: MasterInventoryMismatchItem) => {
          if (item.isExcluded) return false;
          // E.g. raw material, internal consumption (no sales) or purely services/gifts (no purchase)
          // We suggest if Qty > 5 to avoid trivial noise
          if (item.salesQty === 0 && item.purchaseQty >= 5) return true;
          if (item.purchaseQty === 0 && item.salesQty >= 5) return true;
          return false;
        });

        // Sort by quantity mismatch descending
        suggested.sort((a: MasterInventoryMismatchItem, b: MasterInventoryMismatchItem) => {
          const aMismatch = Math.max(a.yetToPurchaseQty, a.yetToSaleQty);
          const bMismatch = Math.max(b.yetToPurchaseQty, b.yetToSaleQty);
          return bMismatch - aMismatch;
        });

        setSuggestions(suggested);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const handleAcceptSuggestion = async (item: MasterInventoryMismatchItem) => {
    const reason = item.salesQty === 0 ? "INTERNAL_USE" : "OTHER"; // Default guesses
    
    try {
      const res = await fetch("/api/exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: null, // Suggesting Global Exclusion
          customerName: null,
          itemId: item.itemId,
          itemName: item.itemName,
          sku: item.sku,
          financialYear: null, // All Periods
          reason,
          notes: "Auto-accepted from Exclusion Suggestions based on 100% mismatch pattern.",
          approvedBy: "System Suggestion"
        })
      });

      if (!res.ok) throw new Error("Failed to create exclusion");
      
      // Remove from suggestions
      setSuggestions(prev => prev.filter(s => !(s.itemId === item.itemId && s.customerId === item.customerId)));
    } catch (err: any) {
      alert("Error accepting suggestion: " + err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>
        Analyzing inventory patterns for suggestions...
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
      <div style={{ padding: "0 24px" }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, margin: 0, color: "var(--text-primary)" }}>
          Exclusion Suggestions
        </h2>
        <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>
          AI-detected patterns suggesting potential exclusions (e.g. items with 100% purchase but 0 sales, indicating internal consumption).
        </p>
      </div>

      <div style={{ flex: 1, padding: "0 24px 24px", overflowY: "auto" }}>
        {suggestions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, background: "#f8f9fa", borderRadius: 8, color: "var(--text-secondary)" }}>
            No exclusion suggestions found. All good!
          </div>
        ) : (
          <div className="table-container">
            <table className="reconciliation-table">
              <thead>
                <tr>
                  <th>Suggestion Reason</th>
                  <th>Customer (if any)</th>
                  <th>Item</th>
                  <th style={{ textAlign: "right" }}>Purchases</th>
                  <th style={{ textAlign: "right" }}>Sales</th>
                  <th style={{ width: 180, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((item) => (
                  <tr key={`sugg-${item.customerId || 'cust'}-${item.itemId || 'item'}`}>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>
                        {item.salesQty === 0 ? "Likely Internal Use / Raw Material" : "Likely Service / Free Sample"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {item.salesQty === 0 ? `Purchased ${item.purchaseQty} but sold 0` : `Sold ${item.salesQty} but purchased 0`}
                      </div>
                    </td>
                    <td>{item.customerName || "—"}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{item.itemName}</div>
                      {item.sku && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{item.sku}</div>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 500 }}>{item.purchaseQty} {item.unit}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>₹ {formatINR(item.purchaseAmount)}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 500 }}>{item.salesQty} {item.unit}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>₹ {formatINR(item.salesAmount)}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleAcceptSuggestion(item)}
                      >
                        Accept as Global Exclusion
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
