"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pre_audit_engine_ts_1 = require("./app/lib/audit/pre-audit-engine.ts");
async function run() {
    console.log("Starting run...");
    const runId = (0, pre_audit_engine_ts_1.startPreAuditRun)("2025-26");
    console.log("Run ID:", runId);
    // Wait a bit for the async process to complete
    await new Promise(r => setTimeout(r, 2000));
    const runs = (0, pre_audit_engine_ts_1.getPreAuditRuns)();
    console.log("RUNS:", runs);
    const results = (0, pre_audit_engine_ts_1.getPreAuditRunResults)(runId);
    console.log("RESULTS COUNT:", results.length);
    results.forEach(r => {
        console.log(`[${r.process_status}] [${r.result_status}] ${r.checkpoint_key}`);
    });
}
run();
