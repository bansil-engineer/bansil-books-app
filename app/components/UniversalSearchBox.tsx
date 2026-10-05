"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { UniversalSearchResult } from "../lib/search/universal-search-service";
import { LocalBillDrawer, LocalInvoiceDrawer } from "./LocalDocumentDrawer";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import { VendorDetailDrawer } from "./VendorDetailDrawer";

export interface UniversalSearchBoxProps {
  onNavigateToCustomer?: (
    customerId: string,
    customerName?: string,
    preferredTab?: "OVERVIEW" | "RECONCILIATION",
    periodContext?: {
      period?: string;
      financialYear?: string;
      fromDate?: string;
      toDate?: string;
    }
  ) => void;
}

export function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

export function formatSafeDecimal(val: unknown, decimals = 2): string | null {
  if (!isFiniteNumber(val)) return null;
  return val.toFixed(decimals);
}

export function UniversalSearchBox({ onNavigateToCustomer }: UniversalSearchBoxProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UniversalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [activeDrawer, setActiveDrawer] = useState<{
    type: "bill" | "invoice" | "item" | "vendor";
    id: string;
    name?: string;
    financialYear?: string;
  } | null>(null);

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
        setSelectedIndex(0);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  const handleSelect = (item: UniversalSearchResult) => {
    setIsOpen(false);
    if (item.sourceType === "BILL" && item.id) {
      setActiveDrawer({ type: "bill", id: item.id });
    } else if (item.sourceType === "INVOICE" && item.id) {
      setActiveDrawer({ type: "invoice", id: item.id });
    } else if (item.sourceType === "ITEM" && item.id) {
      setActiveDrawer({ type: "item", id: item.id, financialYear: "ALL" });
    } else if (item.deeplink) {
      router.push(item.deeplink);
    }
  };

  const highlightMatches = (text: string) => {
    if (!text) return text;
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&')})`, 'gi');
    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} style={{ backgroundColor: "#fef08a", color: "#854d0e", borderRadius: "2px", padding: "0 2px" }}>
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  const groupedResults = results.reduce((acc, item) => {
    if (!acc[item.sourceType]) acc[item.sourceType] = [];
    acc[item.sourceType].push(item);
    return acc;
  }, {} as Record<string, UniversalSearchResult[]>);

  const formatSourceType = (type: string) => {
    const map: Record<string, string> = {
      INVOICE: "Sales Invoices",
      BILL: "Bills",
      ITEM: "Items",
      ACTIVITY: "Other Transactions",
      COMPOSITE: "Composite Assemblies",
      ORDER: "Sales Orders",
    };
    return map[type] || type;
  };

  return (
    <>
      <div ref={containerRef} style={{ position: "relative", width: "100%", maxWidth: "450px", zIndex: 1000, marginLeft: "16px" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <svg
            style={{ position: "absolute", left: "10px", width: "16px", height: "16px", color: "#5f6368" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search bills, invoices, items, narration, JV..."
            style={{
              width: "100%",
              padding: "8px 12px 8px 34px",
              fontSize: "13px",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              backgroundColor: "#f1f3f4",
              outline: "none",
              transition: "background-color 0.2s, box-shadow 0.2s",
            }}
            onFocusCapture={(e) => {
              e.target.style.backgroundColor = "#fff";
              e.target.style.boxShadow = "0 1px 6px rgba(32,33,36,.28)";
              e.target.style.borderColor = "transparent";
            }}
            onBlurCapture={(e) => {
              if (!query) {
                e.target.style.backgroundColor = "#f1f3f4";
                e.target.style.boxShadow = "none";
                e.target.style.borderColor = "#dadce0";
              }
            }}
          />
          <div style={{ position: "absolute", right: "10px", fontSize: "11px", color: "#80868b", pointerEvents: "none", border: "1px solid #dadce0", borderRadius: "4px", padding: "1px 4px", backgroundColor: "#fff" }}>
            Cmd+K
          </div>
        </div>

        {isOpen && (query || results.length > 0) && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              backgroundColor: "#fff",
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              border: "1px solid #dadce0",
              maxHeight: "60vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {loading && <div style={{ padding: "16px", textAlign: "center", color: "#5f6368", fontSize: "13px" }}>Searching...</div>}
            {!loading && query && results.length === 0 && (
              <div style={{ padding: "16px", textAlign: "center", color: "#5f6368", fontSize: "13px" }}>No results found for "{query}"</div>
            )}

            {!loading &&
              Object.entries(groupedResults).map(([sourceType, items]) => (
                <div key={sourceType} style={{ borderBottom: "1px solid #f1f3f4" }}>
                  <div style={{ padding: "8px 12px", backgroundColor: "#f8f9fa", fontSize: "11px", fontWeight: 600, color: "#5f6368", textTransform: "uppercase" }}>
                    {formatSourceType(sourceType)}
                  </div>
                  {items.map((result) => {
                    const globalIndex = results.findIndex((r) => r.id === result.id && r.sourceType === result.sourceType);
                    const isSelected = globalIndex === selectedIndex;
                    const hasQty = isFiniteNumber(result.qty);
                    const rateStr = formatSafeDecimal(result.rate, 2);
                    const amountStr = formatSafeDecimal(result.amount, 2);
                    const hasRate = rateStr !== null;
                    const hasAmount = amountStr !== null;

                    const hasDetailView = Boolean(
                      result.deeplink ||
                      result.sourceType === "BILL" ||
                      result.sourceType === "INVOICE" ||
                      result.sourceType === "ITEM"
                    );

                    return (
                      <div
                        key={result.id}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        style={{
                          padding: "10px 12px",
                          cursor: "pointer",
                          backgroundColor: isSelected ? "#e8f0fe" : "transparent",
                          transition: "background-color 0.1s",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          borderBottom: "1px solid #f8f9fa",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <div style={{ fontSize: "13px", fontWeight: 500, color: "#202124" }}>
                            {highlightMatches(result.title)}
                          </div>
                          {result.date && <div style={{ fontSize: "11px", color: "#5f6368", whiteSpace: "nowrap" }}>{result.date}</div>}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#5f6368", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 500 }}>{highlightMatches(result.subtitle)}</span>
                          
                          {(hasQty || hasRate || hasAmount) && (
                            <div style={{ display: "flex", gap: "6px", backgroundColor: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                              {hasQty && <span>Qty: <strong>{result.qty}</strong></span>}
                              {hasRate && <span>Rate: <strong>₹{rateStr}</strong></span>}
                              {hasAmount && <span style={{ color: "#1a73e8" }}>Amt: <strong>₹{amountStr}</strong></span>}
                            </div>
                          )}
                        </div>

                        <div style={{ fontSize: "12px", color: "#5f6368" }}>
                          {highlightMatches(result.snippet)}
                        </div>
                        
                        {hasDetailView ? (
                          <div style={{ fontSize: "11px", color: "#1a73e8", fontWeight: 500, marginTop: "2px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            Open <span style={{ fontSize: "14px", lineHeight: 1 }}>→</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: "11px", color: "#9e9e9e", marginTop: "2px" }}>
                            Detail view not available
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </div>

      {activeDrawer?.type === "bill" && (
        <LocalBillDrawer
          billId={activeDrawer.id}
          onClose={() => setActiveDrawer(null)}
          onOpenItem={(itemId: any, itemName?: any) => setActiveDrawer({ type: "item", id: itemId, financialYear: "ALL" })}
          onNavigateToCustomer={(customerId, customerName) => {
            setActiveDrawer(null);
            onNavigateToCustomer?.(customerId, customerName);
          }}
          onOpenVendor={(vendorName, vendorId) => {
            if (vendorId) setActiveDrawer({ type: "vendor", id: vendorId, name: vendorName });
          }}
        />
      )}
      {activeDrawer?.type === "invoice" && (
        <LocalInvoiceDrawer
          invoiceId={activeDrawer.id}
          onClose={() => setActiveDrawer(null)}
          onOpenItem={(itemId: any, itemName?: any) => setActiveDrawer({ type: "item", id: itemId, financialYear: "ALL" })}
          onNavigateToCustomer={(customerId, customerName) => {
            setActiveDrawer(null);
            onNavigateToCustomer?.(customerId, customerName);
          }}
        />
      )}
      {activeDrawer?.type === "item" && (
        <ItemDetailDrawer
          itemId={activeDrawer.id}
          financialYear={activeDrawer.financialYear || "ALL"}
          onClose={() => setActiveDrawer(null)}
          onNavigateToCustomer={(customerId: any, customerName?: any, preferredTab?: any) => {
            setActiveDrawer(null);
            onNavigateToCustomer?.(customerId, customerName, preferredTab);
          }}
        />
      )}
      {activeDrawer?.type === "vendor" && (
        <VendorDetailDrawer
          vendorId={activeDrawer.id}
          vendorName={activeDrawer.name}
          onClose={() => setActiveDrawer(null)}
          onOpenItem={(itemId) => setActiveDrawer({ type: "item", id: itemId, financialYear: "ALL" })}
          onOpenBill={(billId) => setActiveDrawer({ type: "bill", id: billId })}
          onNavigateToCustomer={(customerId, customerName) => {
            setActiveDrawer(null);
            onNavigateToCustomer?.(customerId, customerName);
          }}
        />
      )}
    </>
  );
}

