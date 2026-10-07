"use client";

import React, { useEffect, useState } from "react";

interface OwnerAuthGateProps {
  children: React.ReactNode;
}

/**
 * Client-side gate for the OWNER-ONLY local authorization model. The real
 * enforcement is server-side (every privileged /api/audit/* write route
 * checks the session cookie itself via requireOwnerSession) — this
 * component only avoids showing privileged controls to a signed-out
 * viewer and offers the sign-in/bootstrap form. A disabled button here is
 * never the only protection.
 *
 * On Vercel when env-var credentials are not configured, shows a clear
 * "setup required" message instead of the broken "set one-time" form.
 */
export function OwnerAuthGate({ children }: OwnerAuthGateProps) {
  const [loading, setLoading] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [vercelSetupRequired, setVercelSetupRequired] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showChangeForm, setShowChangeForm] = useState(false);
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState("");
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/audit/auth/status", { credentials: "include" });
      const json = await res.json();
      setBootstrapped(Boolean(json.bootstrapped));
      setAuthenticated(Boolean(json.authenticated));
      setVercelSetupRequired(Boolean(json.vercelSetupRequired));
    } catch {
      setBootstrapped(false);
      setAuthenticated(false);
      setVercelSetupRequired(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleBootstrap() {
    setError(null);
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/audit/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passphrase }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Failed to set owner passphrase");
        return;
      }
      setPassphrase("");
      setConfirmPassphrase("");
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set owner passphrase");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/audit/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passphrase }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Invalid passphrase");
        return;
      }
      setPassphrase("");
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/audit/auth/logout", { method: "POST", credentials: "include" });
    await loadStatus();
  }

  async function handleChangePassphrase() {
    setChangeError(null);
    if (newPassphrase.length < 8) {
      setChangeError("New passphrase must be at least 8 characters.");
      return;
    }
    if (newPassphrase !== confirmNewPassphrase) {
      setChangeError("New passphrases do not match.");
      return;
    }
    setChangeBusy(true);
    try {
      const res = await fetch("/api/audit/auth/change-passphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassphrase, newPassphrase }),
      });
      const json = await res.json();
      if (!json.success) {
        setChangeError(json.error || "Failed to change passphrase");
        return;
      }
      setCurrentPassphrase("");
      setNewPassphrase("");
      setConfirmNewPassphrase("");
      setShowChangeForm(false);
      // The server invalidated every session (including this one) — reload to sign-in.
      await loadStatus();
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : "Failed to change passphrase");
    } finally {
      setChangeBusy(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Checking owner session…</div>;
  }

  // Vercel production: env-var credentials not configured
  if (vercelSetupRequired) {
    return (
      <div style={{ maxWidth: 480, margin: "40px auto", border: "1px solid #fbbf24", borderRadius: 8, padding: 24, background: "#fffbeb" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: "#92400e" }}>Owner Passphrase Setup Required</h3>
        <p style={{ fontSize: 12.5, color: "#78350f", marginBottom: 16, lineHeight: 1.5 }}>
          Owner passphrase authentication is not yet configured for production.
          A super_admin must set the <code style={{ background: "#fef3c7", padding: "1px 4px", borderRadius: 2 }}>OWNER_PASSPHRASE_HASH</code> and{" "}
          <code style={{ background: "#fef3c7", padding: "1px 4px", borderRadius: 2 }}>OWNER_PASSPHRASE_SALT</code> environment
          variables in the Vercel dashboard and redeploy.
        </p>
        <p style={{ fontSize: 11.5, color: "#92400e", lineHeight: 1.5 }}>
          To generate these values, run the following on your local development machine:
        </p>
        <pre style={{ background: "#fef3c7", padding: 12, borderRadius: 4, fontSize: 11.5, overflowX: "auto", marginTop: 8, color: "#78350f" }}>
{`node -e "
  const crypto = require('crypto');
  const passphrase = '<YOUR_PASSPHRASE>';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(passphrase, salt, 64).toString('hex');
  console.log('OWNER_PASSPHRASE_SALT=' + salt);
  console.log('OWNER_PASSPHRASE_HASH=' + hash);
"`}
        </pre>
      </div>
    );
  }

  if (!bootstrapped) {
    return (
      <div style={{ maxWidth: 420, margin: "40px auto", border: "1px solid #dadce0", borderRadius: 8, padding: 24, background: "#fff" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Set Owner Passphrase (one-time)</h3>
        <p style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>
          No owner passphrase exists yet. Set one now to protect Settings &gt; Skills and audit-workspace writes —
          this can only be done once; changing it afterwards requires an authenticated session.
        </p>
        <input
          type="password"
          placeholder="New passphrase (min 8 characters)"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          style={authInputStyle}
        />
        <input
          type="password"
          placeholder="Confirm passphrase"
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          style={authInputStyle}
        />
        {error && <div style={{ color: "#dc2626", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button onClick={handleBootstrap} disabled={busy} style={authButtonStyle}>
          {busy ? "Setting…" : "Set Passphrase"}
        </button>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div style={{ maxWidth: 420, margin: "40px auto", border: "1px solid #dadce0", borderRadius: 8, padding: 24, background: "#fff" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Owner Sign-in Required</h3>
        <p style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>
          This screen writes to the audit workspace / Skills registry. Sign in as the local owner to continue.
        </p>
        <input
          type="password"
          placeholder="Owner passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          style={authInputStyle}
        />
        {error && <div style={{ color: "#dc2626", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button onClick={handleLogin} disabled={busy} style={authButtonStyle}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "3px 10px", borderRadius: 4 }}>
          Signed in as OWNER
        </span>
        <button
          onClick={() => setShowChangeForm((v) => !v)}
          style={{ fontSize: 11.5, color: "#475569", background: "none", border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}
        >
          {showChangeForm ? "Cancel" : "Change passphrase"}
        </button>
        <button onClick={handleLogout} style={{ fontSize: 11.5, color: "#475569", background: "none", border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>
          Sign out
        </button>
      </div>

      {showChangeForm && (
        <div style={{ maxWidth: 380, marginLeft: "auto", marginBottom: 16, border: "1px solid #dadce0", borderRadius: 8, padding: 16, background: "#fff" }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Change Owner Passphrase</h4>
          <input type="password" placeholder="Current passphrase" value={currentPassphrase} onChange={(e) => setCurrentPassphrase(e.target.value)} style={authInputStyle} />
          <input type="password" placeholder="New passphrase (min 8 characters)" value={newPassphrase} onChange={(e) => setNewPassphrase(e.target.value)} style={authInputStyle} />
          <input type="password" placeholder="Confirm new passphrase" value={confirmNewPassphrase} onChange={(e) => setConfirmNewPassphrase(e.target.value)} style={authInputStyle} />
          {changeError && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{changeError}</div>}
          <button onClick={handleChangePassphrase} disabled={changeBusy} style={authButtonStyle}>
            {changeBusy ? "Changing…" : "Change Passphrase"}
          </button>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
            This signs you out everywhere — you&apos;ll need to sign in again with the new passphrase.
          </p>
        </div>
      )}

      {children}
    </div>
  );
}

const authInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginBottom: 10,
  padding: "8px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 13,
};

const authButtonStyle: React.CSSProperties = {
  background: "#1a73e8",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
};
