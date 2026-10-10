"use client";

// ============================================================
// OA-U2 — User Management for the DATABASE user store.
// Rendered by UserManagementView only when GET /api/auth/users reports
// store === "db". Changes persist immediately — no Render redeploy. Session
// revocation scope is limited in Phase 1 (see SESSION_LIMITATION_NOTICE).
//
// Security notes:
//  - No credential material is ever received from the API.
//  - Invitation / reset links are shown ONCE (the server stores only a
//    hash) and are never written to the console.
// ============================================================

import React, { useCallback, useEffect, useState } from "react";

type Role = "super_admin" | "admin" | "viewer";
type Status = "invited" | "active" | "deactivated";

interface DbUser {
  email: string;
  name: string;
  role: Role;
  status: Status;
  isOwner: boolean;
  modules: string[];
  lastLoginAt: string | null;
  pendingInvitation: { purpose: "invite" | "reset"; expiresAt: string } | null;
}

interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  target_email: string | null;
  action: string;
  changed_categories: string[];
  result: string;
}

const MODULES = [
  "dashboard", "reconciliation", "exclusions", "inventory", "transactions", "services", "customers",
  "reports", "estimation", "ai-assistant", "settings", "audit", "tender-hub", "connections",
];
const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard", reconciliation: "Reconciliation", exclusions: "Exclusions", inventory: "Inventory",
  transactions: "Transactions", services: "Services", customers: "Customers", reports: "Reports",
  estimation: "Estimation", "ai-assistant": "AI Assistant", settings: "Settings", audit: "Audit",
  "tender-hub": "Tender Hub", connections: "Connections",
};
const ALL_FNS = ["view", "add", "edit", "delete", "export"];
const VIEWER_FNS = ["view", "export"];

type Perms = Record<string, string[]>;

function permsFromModules(modules: string[]): { full: boolean; perms: Perms } {
  if (modules.includes("*")) return { full: true, perms: {} };
  const perms: Perms = {};
  for (const e of modules) {
    const [m, f] = e.split(":");
    perms[m] = f ? f.split(",") : [...ALL_FNS];
  }
  return { full: false, perms };
}

function modulesFromPerms(role: Role, full: boolean, perms: Perms): string[] {
  if (role === "admin" && full) return ["*"];
  return Object.entries(perms)
    .filter(([, fns]) => fns.length > 0)
    .map(([m, fns]) => (fns.length === ALL_FNS.length ? m : `${m}:${[...fns].sort().join(",")}`));
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ------------------------------------------------------------------ permission editor

function PermissionEditor(props: {
  role: Role;
  full: boolean;
  perms: Perms;
  onChange: (full: boolean, perms: Perms) => void;
}) {
  const { role, full, perms, onChange } = props;
  const fns = role === "viewer" ? VIEWER_FNS : ALL_FNS;

  const toggleModule = (m: string) => {
    const next = { ...perms };
    if (next[m]) delete next[m];
    else next[m] = role === "viewer" ? ["view"] : [...ALL_FNS];
    onChange(full, next);
  };
  const toggleFn = (m: string, f: string) => {
    const cur = perms[m] ?? [];
    const upd = cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f];
    const next = { ...perms };
    if (upd.length === 0) delete next[m];
    else next[m] = upd;
    onChange(full, next);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {role === "admin" && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginBottom: 10 }}>
          <input type="checkbox" checked={full} onChange={(e) => onChange(e.target.checked, perms)} />
          Full access to all modules and functions
        </label>
      )}
      {role === "viewer" && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px" }}>
          Viewer accounts are limited to View and Export.
        </p>
      )}
      {!(role === "admin" && full) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {MODULES.map((m) => {
            const on = !!perms[m];
            return (
              <div key={m} style={{ border: `1px solid ${on ? "var(--google-blue)" : "var(--border)"}`, borderRadius: 8,
                padding: "8px 10px", background: on ? "var(--google-blue-bg)" : "#fff" }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggleModule(m)} />
                  {MODULE_LABELS[m]}
                </label>
                {on && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, paddingLeft: 20 }}>
                    {fns.map((f) => (
                      <label key={f} style={{ display: "flex", gap: 3, alignItems: "center", fontSize: 10, cursor: "pointer" }}>
                        <input type="checkbox" checked={(perms[m] ?? []).includes(f)} onChange={() => toggleFn(m, f)} />
                        {f[0].toUpperCase() + f.slice(1)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ main view

export function UserManagementDbView() {
  const [users, setUsers] = useState<DbUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState<{ email: string; url: string; expiresAt: string; purpose: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // add form
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [full, setFull] = useState(true);
  const [perms, setPerms] = useState<Perms>({});
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");

  // edit
  const [editing, setEditing] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eRole, setERole] = useState<Role>("viewer");
  const [eFull, setEFull] = useState(false);
  const [ePerms, setEPerms] = useState<Perms>({});

  const load = useCallback(async () => {
    const r = await api("GET", "/api/auth/users");
    if (r.ok) setUsers(r.data.users ?? []);
    else setError(r.data.error || "Failed to load users");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setError("");
    setNotice("");
  };

  const showLink = (targetEmail: string, inv: { path: string; expiresAt: string }, purpose: string) => {
    setLink({ email: targetEmail, url: `${window.location.origin}${inv.path}`, expiresAt: inv.expiresAt, purpose });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setLink(null);
    const modules = modulesFromPerms(role, full, perms);
    if (modules.length === 0) return setError("Select at least one module.");
    setBusy("add");
    const r = await api("POST", "/api/auth/users", {
      name, email, role, modules, ...(usePassword ? { password } : {}),
    });
    setBusy(null);
    if (!r.ok) return setError(r.data.error || "Failed to create user");
    setShowAdd(false);
    setName(""); setEmail(""); setPassword(""); setPerms({}); setRole("viewer"); setFull(true); setUsePassword(false);
    if (r.data.invitation) {
      showLink(r.data.user.email, r.data.invitation, "invitation");
      setNotice(`"${r.data.user.name}" created — status: invited. They can sign in after opening the link below and setting a password.`);
    } else {
      setNotice(`"${r.data.user.name}" created and active. Share the initial password through a secure channel.`);
    }
    load();
  };

  const startEdit = (u: DbUser) => {
    reset();
    const p = permsFromModules(u.modules);
    setEditing(u.email);
    setEName(u.name);
    setERole(u.role === "admin" ? "admin" : "viewer");
    setEFull(p.full);
    setEPerms(p.perms);
  };

  const saveEdit = async () => {
    if (!editing) return;
    reset();
    const modules = modulesFromPerms(eRole, eFull, ePerms);
    if (modules.length === 0) return setError("Select at least one module.");
    setBusy(editing);
    const r = await api("PATCH", "/api/auth/users", { action: "update", email: editing, name: eName, role: eRole, modules });
    setBusy(null);
    if (!r.ok) return setError(r.data.error || "Failed to update user");
    setEditing(null);
    // Server-provided wording (QC F1): never claim immediate sign-out.
    setNotice(r.data.sessionNotice ? `Saved. New rights apply from the user's next sign-in. ${r.data.sessionNotice}` : "Saved.");
    load();
  };

  const setActive = async (u: DbUser, active: boolean) => {
    if (!active && !confirm(
      `Deactivate ${u.email}?\n\nThey will not be able to sign in. Pages they already have open may keep ` +
      `working until their current session expires (at most 8 hours).`,
    )) return;
    reset();
    setBusy(u.email);
    const r = await api("PATCH", "/api/auth/users", { action: active ? "activate" : "deactivate", email: u.email });
    setBusy(null);
    if (!r.ok) return setError(r.data.error || "Failed to update status");
    if (!active) {
      setNotice(`${u.email} deactivated. ${r.data.sessionNotice ?? ""}`.trim());
    } else if (r.data.user?.status === "invited") {
      // QC F2 recovery: never-activated users return to "invited".
      setNotice(`${u.email} reactivated as an invited user. Issue a new link so they can set a password — earlier links no longer work.`);
    } else {
      setNotice(`${u.email} reactivated.`);
    }
    load();
  };

  const issue = async (u: DbUser, purpose: "invite" | "reset") => {
    reset();
    setLink(null);
    setBusy(u.email);
    const r = await api("POST", "/api/auth/invitations", { email: u.email, purpose });
    setBusy(null);
    if (!r.ok) return setError(r.data.error || "Failed to create link");
    showLink(u.email, r.data.invitation, purpose === "reset" ? "password reset" : "invitation");
    setNotice(r.data.resent ? "A new link was issued; the previous link no longer works." : "Link issued.");
    load();
  };

  const cancel = async (u: DbUser) => {
    reset();
    setBusy(u.email);
    const r = await api("DELETE", "/api/auth/invitations", { email: u.email });
    setBusy(null);
    if (!r.ok) return setError(r.data.error || "Failed to cancel");
    setNotice(`Cancelled ${r.data.cancelled} outstanding link(s) for ${u.email}.`);
    if (link?.email === u.email) setLink(null);
    load();
  };

  const loadAudit = async () => {
    const r = await api("GET", "/api/auth/audit-log?limit=100");
    if (r.ok) setAudit(r.data.entries ?? []);
    else setError(r.data.error || "Failed to load history");
  };

  if (loading) return <div className="section-card" style={{ padding: 24 }}>Loading users...</div>;

  const badge = (s: Status) => {
    const map: Record<Status, [string, string]> = {
      active: ["var(--google-green-bg)", "var(--google-green)"],
      invited: ["var(--google-blue-bg)", "var(--google-blue)"],
      deactivated: ["var(--google-red-bg)", "var(--google-red)"],
    };
    return (
      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, textTransform: "uppercase",
        background: map[s][0], color: map[s][1] }}>{s}</span>
    );
  };

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1040 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>User Management</h2>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Database user store — changes are saved immediately, without a redeploy. Accounts are deactivated,
            never deleted. Deactivation blocks sign-in at once; already-open pages can keep working until the
            user&apos;s session expires (at most 8 hours).
          </p>
        </div>
        <button onClick={() => { setShowAdd(!showAdd); reset(); }} style={primaryBtn(showAdd)}>
          {showAdd ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {error && <div style={msg("red")}>{error}</div>}
      {notice && <div style={msg("green")}>{notice}</div>}

      {link && (
        <div style={{ ...msg("blue"), display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>One-time {link.purpose} link for {link.email}</strong>
          <span>
            This link is shown only once and expires {fmt(link.expiresAt)}. Send it through a secure channel.
            No email is sent automatically.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={link.url} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }}
              onFocus={(e) => e.currentTarget.select()} />
            <button type="button" style={smallBtn()} onClick={() => navigator.clipboard?.writeText(link.url)}>Copy</button>
            <button type="button" style={smallBtn()} onClick={() => setLink(null)}>Hide</button>
          </div>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} style={panel}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Role *</label>
              <select value={role} onChange={(e) => { setRole(e.target.value as Role); setPerms({}); }} style={inputStyle}>
                <option value="viewer">Viewer (view / export)</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <PermissionEditor role={role} full={full} perms={perms} onChange={(f, p) => { setFull(f); setPerms(p); }} />
          <div style={{ marginBottom: 14, fontSize: 12 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" checked={!usePassword} onChange={() => setUsePassword(false)} />
              Create a one-time invitation link (recommended — the user chooses their own password)
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <input type="radio" checked={usePassword} onChange={() => setUsePassword(true)} />
              Set an initial password now
            </label>
            {usePassword && (
              <input type="password" required minLength={12} value={password} placeholder="At least 12 characters"
                onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginTop: 6, maxWidth: 320 }} />
            )}
          </div>
          <button type="submit" disabled={busy === "add"} style={primaryBtn(false)}>
            {busy === "add" ? "Creating..." : "Create User"}
          </button>
        </form>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Access</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <React.Fragment key={u.email}>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)", opacity: u.status === "deactivated" ? 0.6 : 1 }}>
                <td style={tdStyle}>{u.name}</td>
                <td style={tdStyle}><span style={{ fontFamily: "monospace", fontSize: 11 }}>{u.email}</span></td>
                <td style={tdStyle}>{u.isOwner ? "Owner" : u.role}</td>
                <td style={tdStyle}>
                  {badge(u.status)}
                  {u.pendingInvitation && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
                      {u.pendingInvitation.purpose} link until {fmt(u.pendingInvitation.expiresAt)}
                    </div>
                  )}
                </td>
                <td style={tdStyle}>
                  {u.modules.includes("*") ? (
                    <span style={{ fontSize: 10, color: "var(--google-green)", fontWeight: 600 }}>All modules</span>
                  ) : (
                    <span style={{ fontSize: 10 }}>{u.modules.map((m) => {
                      const [mod, f] = m.split(":");
                      return `${MODULE_LABELS[mod] ?? mod}${f ? ` (${f})` : ""}`;
                    }).join(", ") || "—"}</span>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {u.isOwner ? (
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Protected</span>
                  ) : (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {u.status !== "deactivated" && (
                        <button style={smallBtn()} disabled={busy === u.email} onClick={() => startEdit(u)}>Edit</button>
                      )}
                      {u.status === "invited" && (
                        <button style={smallBtn()} disabled={busy === u.email} onClick={() => issue(u, "invite")}>
                          {u.pendingInvitation ? "Resend link" : "New link"}
                        </button>
                      )}
                      {u.status === "active" && (
                        <button style={smallBtn()} disabled={busy === u.email} onClick={() => issue(u, "reset")}>Reset password</button>
                      )}
                      {u.pendingInvitation && (
                        <button style={smallBtn()} disabled={busy === u.email} onClick={() => cancel(u)}>Cancel link</button>
                      )}
                      {u.status === "deactivated" ? (
                        <button style={smallBtn()} disabled={busy === u.email} onClick={() => setActive(u, true)}>Reactivate</button>
                      ) : (
                        <button style={smallBtn("red")} disabled={busy === u.email} onClick={() => setActive(u, false)}>Deactivate</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
              {editing === u.email && (
                <tr>
                  <td colSpan={6} style={{ padding: 0 }}>
                    <div style={panel}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={labelStyle}>Name</label>
                          <input value={eName} onChange={(e) => setEName(e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>Role</label>
                          <select value={eRole} onChange={(e) => { setERole(e.target.value as Role); setEPerms({}); setEFull(false); }}
                            style={inputStyle}>
                            <option value="viewer">Viewer (view / export)</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      </div>
                      <PermissionEditor role={eRole} full={eFull} perms={ePerms} onChange={(f, p) => { setEFull(f); setEPerms(p); }} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={primaryBtn(false)} disabled={busy === u.email} onClick={saveEdit}>Save</button>
                        <button style={smallBtn()} onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 20 }}>
        <button style={smallBtn()} onClick={() => (audit ? setAudit(null) : loadAudit())}>
          {audit ? "Hide history" : "Show change history"}
        </button>
        {audit && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 10 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={thStyle}>When</th><th style={thStyle}>Actor</th><th style={thStyle}>Target</th>
                <th style={thStyle}>Action</th><th style={thStyle}>Changed</th><th style={thStyle}>Result</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={tdStyle}>{fmt(a.occurred_at)}</td>
                  <td style={tdStyle}>{a.actor_email ?? "—"}</td>
                  <td style={tdStyle}>{a.target_email ?? "—"}</td>
                  <td style={tdStyle}>{a.action}</td>
                  <td style={tdStyle}>{a.changed_categories.join(", ") || "—"}</td>
                  <td style={tdStyle}>{a.result}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle, color: "var(--text-muted)" }}>No history yet</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  padding: 18, background: "var(--bg-subtle)", borderRadius: 8, border: "1px solid var(--border)", margin: "0 0 18px",
};
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12,
  color: "var(--text-primary)", background: "#fff",
};
const thStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px",
};
const tdStyle: React.CSSProperties = { padding: "10px", verticalAlign: "middle" };
function msg(c: "red" | "green" | "blue"): React.CSSProperties {
  return {
    padding: "10px 14px", background: `var(--google-${c}-bg)`, border: `1px solid var(--google-${c})`, borderRadius: 6,
    color: `var(--google-${c})`, fontSize: 12, marginBottom: 16, whiteSpace: "pre-wrap",
  };
}
function primaryBtn(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px", background: active ? "var(--bg-active)" : "var(--google-blue)", color: active ? "var(--text-primary)" : "#fff",
    border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
}
function smallBtn(tone?: "red"): React.CSSProperties {
  return {
    padding: "3px 10px", background: tone ? "var(--google-red-bg)" : "#fff", color: tone ? "var(--google-red)" : "var(--text-primary)",
    border: `1px solid ${tone ? "var(--google-red)" : "var(--border)"}`, borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
  };
}
