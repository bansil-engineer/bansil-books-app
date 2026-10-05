"use client";

export function OrchestratorView() {
  return (
    <section className="section-card" style={{ padding: 0, overflow: "hidden", minHeight: "calc(100vh - 112px)" }}>
      <iframe
        title="AI Orchestrator"
        src="/orchestrator/index.html"
        style={{ width: "100%", minHeight: "calc(100vh - 116px)", border: 0, display: "block", background: "#eef3f7" }}
      />
    </section>
  );
}
