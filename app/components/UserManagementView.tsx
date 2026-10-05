"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthProvider";

interface UserRecord {
  email: string;
  name: string;
  role: "super_admin" | "admin" | "viewer";
  modules: string[];
}

const ALL_MODULES = [
  "dashboard",
  "reconciliation",
  "exclusions",
  "inventory",
  "transactions",
  "services",
  "customers",
  "reports",
  "estimation",
  "ai-assistant",
  "settings",
  "audit",
  "tender-hub",
  "connections",
];

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  reconciliation: "Reconciliation",
  exclusions: "Exclusions",
  inventory: "Inventory",
  transactions: "Transactions",
  services: "Services",
  customers: "Customers",
  reports: "Reports",
  estimation: "Estimation",
  "ai-assistant": "AI Assistant",
  settings: "Settings",
  audit: "Audit",
  "tender-hub": "Tender Hub",
  connections: "Connections",
};

export function UserManagementView() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Add user form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "viewer">("viewer");
  const [newModules, setNewModules] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Delete
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/users");
      if (!res.ok) {
        setError("Failed to load users");
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setAdding(true);

    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          name: newName,
          password: newPassword,
          role: newRole,
          modules: newRole === "admin" ? ["*"] : newModules,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to add user");
        setAdding(false);
        return;
      }

      setSuccess(
        `User "${newName}" added. Update AUTH_USERS in Vercel with the value shown below.`
      );
      setShowAddForm(false);
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("viewer");
      setNewModules([]);
      fetchUsers();

      // Show the new AUTH_USERS JSON
      if (data.updatedAuthUsers) {
        setSuccess(
          `User "${newName}" added!\n\n⚠️ Copy this JSON and update AUTH_USERS in Vercel Environment Variables:\n\n${data.updatedAuthUsers}`
        );
      }
    } catch {
      setError("Network error");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteUser = async (email: string) => {
    if (!confirm(`Remove user ${email}?`)) return;
    clearMessages();
    setDeleting(email);

    try {
      const res = await fetch("/api/auth/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove user");
        setDeleting(null);
        return;
      }

      setSuccess(`User "${email}" removed. Update AUTH_USERS in Vercel.`);
      if (data.updatedAuthUsers) {
        setSuccess(
          `User removed!\n\n⚠️ Copy this JSON and update AUTH_USERS in Vercel:\n\n${data.updatedAuthUsers}`
        );
      }
      fetchUsers();
    } catch {
      setError("Network error");
    } finally {
      setDeleting(null);
    }
  };

  const toggleModule = (mod: string) => {
    setNewModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  };

  if (user?.role !== "super_admin") {
    return (
      <div className="section-card" style={{ padding: 24, maxWidth: 800 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--google-red)" }}>
          Access Denied
        </h2>
        <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
          Only Super Admin can manage users.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="section-card" style={{ padding: 24 }}>
        Loading users...
      </div>
    );
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 900 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          👤 User Management
        </h2>
        <button
          onClick={() => {
            setShowAddForm(!showAddForm);
            clearMessages();
          }}
          style={{
            padding: "8px 16px",
            background: showAddForm ? "var(--bg-active)" : "var(--google-blue)",
            color: showAddForm ? "var(--text-primary)" : "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showAddForm ? "✕ Cancel" : "+ Add User"}
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--google-red-bg)",
            border: "1px solid var(--google-red)",
            borderRadius: 6,
            color: "var(--google-red)",
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--google-green-bg)",
            border: "1px solid var(--google-green)",
            borderRadius: 6,
            color: "var(--google-green)",
            fontSize: 12,
            marginBottom: 16,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {success}
        </div>
      )}

      {/* Add User Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddUser}
          style={{
            padding: 20,
            background: "var(--bg-subtle)",
            borderRadius: 8,
            border: "1px solid var(--border)",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={inputStyle}
                placeholder="Full Name"
              />
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={inputStyle}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label style={labelStyle}>Password *</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={inputStyle}
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label style={labelStyle}>Role *</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "viewer")}
                style={inputStyle}
              >
                <option value="viewer">Viewer (read-only)</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>
          </div>

          {/* Module Access - only for viewer role */}
          {newRole === "viewer" && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle, marginBottom: 8, display: "block" }}>
                Module Access (select allowed modules)
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ALL_MODULES.map((mod) => (
                  <button
                    type="button"
                    key={mod}
                    onClick={() => toggleModule(mod)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 12,
                      border: "1px solid",
                      borderColor: newModules.includes(mod)
                        ? "var(--google-blue)"
                        : "var(--border)",
                      background: newModules.includes(mod)
                        ? "var(--google-blue-bg)"
                        : "#fff",
                      color: newModules.includes(mod)
                        ? "var(--google-blue)"
                        : "var(--text-secondary)",
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {newModules.includes(mod) ? "✓ " : ""}
                    {MODULE_LABELS[mod] || mod}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={adding}
            style={{
              padding: "8px 24px",
              background: "var(--google-blue)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              opacity: adding ? 0.7 : 1,
            }}
          >
            {adding ? "Adding..." : "Add User"}
          </button>
        </form>
      )}

      {/* Users Table */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: "2px solid var(--border)",
              textAlign: "left",
            }}
          >
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Modules</th>
            <th style={{ ...thStyle, width: 80 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.email}
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <td style={tdStyle}>{u.name}</td>
              <td style={tdStyle}>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {u.email}
                </span>
              </td>
              <td style={tdStyle}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    background:
                      u.role === "super_admin"
                        ? "var(--google-blue-bg)"
                        : u.role === "admin"
                        ? "var(--google-green-bg)"
                        : "var(--bg-active)",
                    color:
                      u.role === "super_admin"
                        ? "var(--google-blue)"
                        : u.role === "admin"
                        ? "var(--google-green)"
                        : "var(--text-secondary)",
                  }}
                >
                  {u.role.replace("_", " ")}
                </span>
              </td>
              <td style={tdStyle}>
                {u.modules.includes("*") ? (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--google-green)",
                      fontWeight: 600,
                    }}
                  >
                    All Modules
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                    {u.modules.length} module{u.modules.length !== 1 ? "s" : ""}
                  </span>
                )}
              </td>
              <td style={tdStyle}>
                {u.email !== user?.email && (
                  <button
                    onClick={() => handleDeleteUser(u.email)}
                    disabled={deleting === u.email}
                    style={{
                      padding: "3px 10px",
                      background: "var(--google-red-bg)",
                      color: "var(--google-red)",
                      border: "1px solid var(--google-red)",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      opacity: deleting === u.email ? 0.5 : 1,
                    }}
                  >
                    {deleting === u.email ? "..." : "Remove"}
                  </button>
                )}
                {u.email === user?.email && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>You</span>
                )}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted)" }}>
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Info */}
      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 6,
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
        }}
      >
        <strong>Note:</strong> After adding or removing a user, copy the
        updated AUTH_USERS JSON and paste it into your Vercel Environment
        Variables. Then redeploy for changes to take effect.
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-secondary)",
  display: "block",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--text-primary)",
  background: "#fff",
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle: React.CSSProperties = {
  padding: "10px",
  verticalAlign: "middle",
};
