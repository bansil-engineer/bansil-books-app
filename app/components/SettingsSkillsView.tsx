"use client";

import React, { useEffect, useState } from "react";

interface SkillVersion {
  version_id: string;
  version: string;
  status: string;
  package_filename: string;
  package_sha256: string;
  package_size_bytes: number;
  guard_verdict: "PASS" | "BLOCKED";
  guard_reasons: string[];
  approved_by: string | null;
  activated_at: string | null;
  created_at: string;
}

interface SkillRecord {
  skill_id: string;
  name: string;
  module_scope: string;
  description: string | null;
  versions: SkillVersion[];
}

const NEXT_ACTION: Record<string, { action: string; label: string } | null> = {
  DRAFT: { action: "VALIDATE", label: "Run Validation" },
  VALIDATING: { action: "MARK_TESTED", label: "Mark Tested" },
  TESTED: { action: "SUBMIT_FOR_APPROVAL", label: "Submit for Approval" },
  PENDING_APPROVAL: { action: "APPROVE_AND_ACTIVATE", label: "Approve & Activate" },
  ACTIVE: { action: "DEACTIVATE", label: "Deactivate" },
  DISABLED: { action: "ARCHIVE", label: "Archive" },
  ARCHIVED: null,
};

export function SettingsSkillsView() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [skillName, setSkillName] = useState("");
  const [moduleScope, setModuleScope] = useState("reconciliation_audit");
  const [version, setVersion] = useState("0.1.0");
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/audit/skills");
      const json = await res.json();
      if (json.success) setSkills(json.skills);
    } catch {
      // keep prior state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload() {
    if (!file) {
      setError("Choose a .zip Skill package first.");
      return;
    }
    if (!skillName.trim()) {
      setError("Skill name is required.");
      return;
    }
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("package", file);
      form.append("skillName", skillName.trim());
      form.append("moduleScope", moduleScope.trim());
      form.append("version", version.trim());

      const res = await fetch("/api/audit/skills/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Upload failed");
        return;
      }
      setMessage(
        json.guard.verdict === "PASS"
          ? "Imported as DRAFT. Content guard: PASS — still requires validation and explicit reviewer approval before it can activate."
          : `Imported as DRAFT, but content guard verdict is BLOCKED: ${json.guard.reasons.join("; ")}`
      );
      setFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleTransition(versionId: string, action: string) {
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/audit/skills/${versionId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Transition failed");
        return;
      }
      setMessage(`Version now ${json.version.status}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    }
  }

  return (
    <div className="section-card" style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>Settings — Skills</h2>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
          Shared registry for reviewed instruction/rule packages. Uploaded packages are stored as immutable DRAFT
          versions and are never executed or auto-activated. Activation always requires an explicit reviewer name.
        </div>
      </div>

      <div style={{ border: "1px solid #dadce0", borderRadius: 8, padding: 18, marginBottom: 24, background: "#fff" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Import Skill Package (DRAFT)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 12.5 }}>
            Skill name
            <input value={skillName} onChange={(e) => setSkillName(e.target.value)} style={inputStyle} placeholder="e.g. bansil-ca-reconciliation" />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Module scope
            <input value={moduleScope} onChange={(e) => setModuleScope(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Version
            <input value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle} placeholder="0.1.0" />
          </label>
        </div>
        <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
        {error && <div style={{ color: "#dc2626", fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        {message && <div style={{ color: "#166534", fontSize: 12.5, marginTop: 10 }}>{message}</div>}
        <div style={{ marginTop: 14 }}>
          <button
            onClick={handleUpload}
            disabled={uploading}
            style={{ background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? "Importing…" : "Import as Draft"}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Loading skills registry…</div>
      ) : skills.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#64748b", border: "1px dashed #cbd5e1", borderRadius: 8 }}>
          No skills imported yet.
        </div>
      ) : (
        skills.map((skill) => (
          <div key={skill.skill_id} style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              {skill.name} <span style={{ fontWeight: 400, color: "#64748b", fontSize: 12 }}>({skill.module_scope})</span>
            </h4>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left" }}>
                    <th style={thStyle}>Version</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Guard</th>
                    <th style={thStyle}>SHA-256</th>
                    <th style={thStyle}>Approved by</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {skill.versions.map((v) => {
                    const next = NEXT_ACTION[v.status];
                    const blocked = v.guard_verdict === "BLOCKED";
                    const disableActivate = next?.action === "APPROVE_AND_ACTIVATE" && blocked;
                    return (
                      <tr key={v.version_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={tdStyle}>{v.version}</td>
                        <td style={tdStyle}>
                          <span style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{v.status}</span>
                        </td>
                        <td style={tdStyle}>
                          <span title={v.guard_reasons.join("; ")} style={{ color: blocked ? "#dc2626" : "#16a34a", fontWeight: 600, fontSize: 11.5 }}>
                            {v.guard_verdict}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{v.package_sha256.slice(0, 16)}…</td>
                        <td style={tdStyle}>{v.approved_by || "—"}</td>
                        <td style={tdStyle}>
                          {next ? (
                            <button
                              onClick={() => handleTransition(v.version_id, next.action)}
                              disabled={disableActivate}
                              title={disableActivate ? "Blocked by content guard — upload a corrected version instead" : undefined}
                              style={{
                                background: disableActivate ? "#e2e8f0" : "#1a73e8",
                                color: disableActivate ? "#94a3b8" : "#fff",
                                border: "none",
                                borderRadius: 4,
                                padding: "4px 10px",
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: disableActivate ? "not-allowed" : "pointer",
                              }}
                            >
                              {next.label}
                            </button>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 11.5 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 13,
};

const thStyle: React.CSSProperties = { padding: "8px 10px", color: "#475569", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase" };
const tdStyle: React.CSSProperties = { padding: "8px 10px", color: "#0f172a" };
