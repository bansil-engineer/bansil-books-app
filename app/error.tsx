"use client";

import React from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#f8f9fa",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #dadce0",
          borderRadius: 12,
          padding: 32,
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "#fce8e6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
            fontSize: 24,
            color: "#d93025",
          }}
        >
          !
        </div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#202124",
            margin: "0 0 8px",
          }}
        >
          Something went wrong
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "#5f6368",
            margin: "0 0 20px",
            lineHeight: 1.5,
          }}
        >
          {error.message || "An unexpected error occurred while loading the page."}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            style={{
              background: "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "10px 24px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
          <button
            onClick={() => (window.location.href = "/")}
            style={{
              background: "#fff",
              color: "#1a73e8",
              border: "1px solid #dadce0",
              borderRadius: 6,
              padding: "10px 24px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Go Home
          </button>
        </div>
        {error.digest && (
          <p
            style={{
              fontSize: 11,
              color: "#80868b",
              marginTop: 16,
            }}
          >
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
