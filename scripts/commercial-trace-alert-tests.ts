import { getCommercialTrace } from "../app/lib/audit/commercial-trace-service.ts";

function assertCondition(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
}

console.log("Running commercial-trace-alert-tests...");

// Assuming SO-2627230 exists and has some trace data in the DB
const trace = getCommercialTrace("SO-2627230");
if (trace) {
  assertCondition(trace.alerts !== undefined, "Trace contains alerts array");
  
  // Verify alert severities are constrained
  const validSeverities = ["INFO", "WARNING", "CRITICAL"];
  for (const alert of trace.alerts) {
     assertCondition(validSeverities.includes(alert.severity), `Valid severity ${alert.severity}`);
     assertCondition(typeof alert.ownerReviewRequired === 'boolean', "ownerReviewRequired exists");
  }
}

console.log("✅ commercial-trace-alert-tests PASSED\n");
