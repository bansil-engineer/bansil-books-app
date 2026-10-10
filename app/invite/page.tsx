"use client";

// OA-U2 — Public page to accept an invitation or password-reset link.
// The token lives in the URL #fragment (never sent to the server, so it
// never appears in access logs). It is read once, removed from the address
// bar, and POSTed in the request body to /api/auth/invitations/accept.

import { useEffect, useRef, useState, FormEvent } from "react";
import { readTokenOnce } from "@/app/lib/invite-token";

const MIN_LEN = 12;

export default function InvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  // QC F4: React Strict Mode (next dev) runs effects twice. The ref survives
  // the simulated remount, so the fragment is read exactly once and the
  // second run cannot overwrite the token with "" after the hash is stripped.
  const readOnce = useRef(false);

  useEffect(() => {
    readTokenOnce(
      readOnce,
      () => window.location.hash,
      setToken,
      // Strip the token from the address bar / history.
      () => window.history.replaceState(null, "", window.location.pathname),
    );
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LEN) return setError(`Password must be at least ${MIN_LEN} characters.`);
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "This link is invalid or has expired. Ask the Owner for a new one.");
      } else {
        setDone(true);
        setPassword("");
        setConfirm("");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <div style={styles.logoCircle}>BE</div>
          <h1 style={styles.title}>Set your password</h1>
          <p style={styles.subtitle}>Bansil Engineers — Analytics &amp; Reconciliation</p>
        </div>

        {token === null ? null : token === "" ? (
          <div style={styles.error}>
            This link is incomplete. Open the full link you received, or ask the Owner for a new one.
          </div>
        ) : done ? (
          <div style={styles.success}>
            Your password has been set. <a href="/login">Sign in</a>.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
              <label htmlFor="pw" style={styles.label}>New password</label>
              <input id="pw" type="password" autoComplete="new-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} style={styles.input}
                placeholder={`At least ${MIN_LEN} characters`} />
            </div>
            <div style={styles.field}>
              <label htmlFor="pw2" style={styles.label}>Confirm password</label>
              <input id="pw2" type="password" autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} style={styles.input} />
            </div>
            {error && <div style={styles.error}>{error}</div>}
            <button type="submit" disabled={loading} style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}>
              {loading ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
        <p style={styles.footer}>This link works once and expires automatically.</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh", flex: 1, width: "100%", display: "flex", alignItems: "center",
    justifyContent: "center", background: "linear-gradient(135deg, #f6f7fb 0%, #e8eaed 100%)", padding: "16px",
  },
  card: {
    width: "100%", maxWidth: "400px", background: "#ffffff", borderRadius: "12px",
    boxShadow: "0 4px 24px rgba(60, 64, 67, 0.12), 0 1px 3px rgba(60, 64, 67, 0.08)", padding: "40px 36px 32px",
  },
  brand: { textAlign: "center", marginBottom: "28px" },
  logoCircle: {
    width: "56px", height: "56px", borderRadius: "50%", background: "linear-gradient(135deg, #1a73e8, #174ea6)",
    color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "20px",
    fontWeight: 700, marginBottom: "16px", letterSpacing: "1px",
  },
  title: { fontSize: "20px", fontWeight: 600, color: "#263044", margin: 0 },
  subtitle: { fontSize: "13px", color: "#66738a", marginTop: "4px" },
  form: { display: "flex", flexDirection: "column", gap: "18px" },
  field: { display: "flex", flexDirection: "column", gap: "6px" },
  label: { fontSize: "13px", fontWeight: 500, color: "#263044" },
  input: {
    padding: "10px 14px", border: "1px solid #dce2ec", borderRadius: "8px", fontSize: "14px", color: "#263044",
    outline: "none",
  },
  error: {
    padding: "10px 14px", background: "#fce8e6", border: "1px solid #d93025", borderRadius: "8px",
    color: "#d93025", fontSize: "13px",
  },
  success: {
    padding: "10px 14px", background: "#e6f4ea", border: "1px solid #188038", borderRadius: "8px",
    color: "#137333", fontSize: "13px",
  },
  button: {
    padding: "12px", background: "linear-gradient(135deg, #1a73e8, #174ea6)", color: "#ffffff", border: "none",
    borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", marginTop: "4px",
  },
  footer: { textAlign: "center", fontSize: "11px", color: "#80868b", marginTop: "24px" },
};
