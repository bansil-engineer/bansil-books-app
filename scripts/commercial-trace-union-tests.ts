import { calculateFulfilment } from "../app/lib/audit/commercial-trace-service.ts";

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    console.error(`❌ FAIL: ${msg}. Expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

console.log("Running commercial-trace-union-tests...");

// 1. Exact fulfilment
let res = calculateFulfilment(10, 10);
assertEqual(res.balance, 0, "Exact fulfilment balance");
assertEqual(res.percent, 100, "Exact fulfilment percent");
assertEqual(res.status, "FULFILLED", "Exact fulfilment status");

// 2. Partial fulfilment
res = calculateFulfilment(10, 4);
assertEqual(res.balance, 6, "Partial fulfilment balance");
assertEqual(res.percent, 40, "Partial fulfilment percent");
assertEqual(res.status, "PARTIAL", "Partial fulfilment status");

// 3. Over fulfilment
res = calculateFulfilment(10, 15);
assertEqual(res.balance, -5, "Over fulfilment balance");
assertEqual(res.percent, 150, "Over fulfilment percent");
assertEqual(res.status, "OVER_FULFILLED", "Over fulfilment status");

// 4. Zero denominator (Unresolved item in target but not source)
res = calculateFulfilment(0, 5);
assertEqual(res.balance, -5, "Orphan item balance");
assertEqual(res.percent, null, "Orphan item percent");
assertEqual(res.status, "UNRESOLVED", "Orphan item status");

// 5. Zero denominator (No source, No target) - NOT_STARTED
res = calculateFulfilment(0, 0);
assertEqual(res.balance, 0, "Zero source/target balance");
assertEqual(res.percent, null, "Zero source/target percent");
assertEqual(res.status, "NOT_STARTED", "Zero source/target status");

console.log("✅ commercial-trace-union-tests PASSED\n");
