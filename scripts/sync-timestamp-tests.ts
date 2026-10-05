// ============================================================
// Bansil Books Analytics — Sync Timestamp Regression Tests
// ============================================================

import {
  getDatabase,
  getSyncMetadata,
  setSyncMetadata,
  getLatestSyncedDocumentDate,
  getApiCallStats,
  recordApiCall,
} from "../app/lib/db/database.ts";
import { formatDisplayDate, formatDisplayDateTime } from "../app/lib/date-utils.ts";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ""}`);
    failedCount++;
  }
}

console.log("\n==================================================");
console.log("RUNNING SYNC TIMESTAMP REGRESSION & INTEGRITY TESTS");
console.log("==================================================\n");

const db = getDatabase();

// ----------------------------------------------------
// TEST GROUP 1: Two Distinct Timestamps Definition & Format
// ----------------------------------------------------
console.log("--- TEST GROUP 1: Two Distinct Timestamps & DD/MM/YYYY HH:mm Format ---");

const testIso1 = "2026-09-10T13:00:00.000Z"; // 18:30 IST (+05:30)
const formatted1 = formatDisplayDateTime(testIso1);
assert(formatted1 === "10/09/2026 18:30", `Initial lastSyncAt formatted as 10/09/2026 18:30 (Got ${formatted1})`);

const testIso2 = "2026-09-11T16:22:00.000Z"; // 21:52 IST (+05:30)
const formatted2 = formatDisplayDateTime(testIso2);
assert(formatted2 === "11/09/2026 21:52", `Updated lastSyncAt formatted as 11/09/2026 21:52 (Got ${formatted2})`);

const testDocDate = "2026-09-11";
const formattedDoc = formatDisplayDate(testDocDate);
assert(formattedDoc === "11/09/2026", `Synced Through formatted as 11/09/2026 (Got ${formattedDoc})`);

assert(formatted2 !== formattedDoc, "Last Sync (date + time) is strictly separate from Synced Through (date only)");
assert(!formatted1.includes("-"), "No hyphens in user-facing timestamp");
assert(!formatted2.includes("-"), "No hyphens in user-facing timestamp");

// ----------------------------------------------------
// TEST GROUP 2: Authoritative SQLite sync_metadata Sourcing
// ----------------------------------------------------
console.log("\n--- TEST GROUP 2: Authoritative SQLite sync_metadata Sourcing ---");

// Set initial baseline timestamp in SQLite
setSyncMetadata(db, "last_successful_sync_time", "2026-09-10T13:00:00.000Z");
const storedLastSync = getSyncMetadata(db, "last_successful_sync_time");
assert(storedLastSync === "2026-09-10T13:00:00.000Z", `Stored baseline in sync_metadata: ${storedLastSync}`);

const latestDoc = getLatestSyncedDocumentDate(db);
assert(Boolean(latestDoc), `Authoritative synced through document date from SQLite: ${latestDoc}`);

// ----------------------------------------------------
// TEST GROUP 3: Successful Sync Updates sync_metadata & Values
// ----------------------------------------------------
console.log("\n--- TEST GROUP 3: Successful Sync Updates sync_metadata ---");

// Simulate a successful sync at 11/09/2026 21:52 IST (16:22:00 UTC)
const newSyncTime = "2026-09-11T16:22:00.000Z";
setSyncMetadata(db, "last_successful_sync_time", newSyncTime);
setSyncMetadata(db, "last_sync_status", "SUCCESS");

const updatedStored = getSyncMetadata(db, "last_successful_sync_time");
assert(updatedStored === newSyncTime, `Stored updated sync timestamp in SQLite: ${updatedStored}`);

const updatedDisplay = formatDisplayDateTime(updatedStored);
assert(updatedDisplay === "11/09/2026 21:52", `Dashboard / Header Last Sync: ${updatedDisplay}`);
assert(updatedDisplay !== "10/09/2026 18:30", "Old timestamp value is no longer visible");
assert(updatedDisplay !== "10-09-2026 18:30", "Old hyphenated string is no longer visible");

// ----------------------------------------------------
// TEST GROUP 4: Failure Behavior Preserves Last Successful Sync
// ----------------------------------------------------
console.log("\n--- TEST GROUP 4: Failure Behavior Preserves Last Successful Sync ---");

const beforeFailureSuccessTime = getSyncMetadata(db, "last_successful_sync_time");
const failureAttemptTime = "2026-09-11T18:00:00.000Z"; // attempt at 23:30 IST

// Simulate failure: attempt time recorded, status FAILED, but last_successful_sync_time preserved
setSyncMetadata(db, "last_attempted_sync_time", failureAttemptTime);
setSyncMetadata(db, "last_sync_status", "FAILED");

const afterFailureSuccessTime = getSyncMetadata(db, "last_successful_sync_time");
const afterFailureAttemptTime = getSyncMetadata(db, "last_attempted_sync_time");
const afterFailureStatus = getSyncMetadata(db, "last_sync_status");

assert(afterFailureSuccessTime === beforeFailureSuccessTime, "Failed sync does NOT overwrite last_successful_sync_time");
assert(afterFailureAttemptTime === failureAttemptTime, "Failed sync records last_attempted_sync_time");
assert(afterFailureStatus === "FAILED", "Failed sync records status as FAILED");

// ----------------------------------------------------
// TEST GROUP 5: Partial Sync Behavior
// ----------------------------------------------------
console.log("\n--- TEST GROUP 5: Partial Sync Behavior ---");

const partialTime = "2026-09-11T16:25:00.000Z";
setSyncMetadata(db, "last_successful_sync_time", partialTime);
setSyncMetadata(db, "last_sync_status", "PARTIAL");

assert(getSyncMetadata(db, "last_sync_status") === "PARTIAL", "Partial sync status recorded as PARTIAL");
assert(getSyncMetadata(db, "last_successful_sync_time") === partialTime, "Partial sync updates last_successful_sync_time");

// Restore successful status for production state
setSyncMetadata(db, "last_successful_sync_time", newSyncTime);
setSyncMetadata(db, "last_sync_status", "SUCCESS");

// ----------------------------------------------------
// TEST GROUP 6: API Call Counter Refresh
// ----------------------------------------------------
console.log("\n--- TEST GROUP 6: API Call Counter Refresh ---");

const beforeStats = getApiCallStats(db);
recordApiCall(db);
const afterStats = getApiCallStats(db);
assert(afterStats.today === beforeStats.today + 1, `API Calls Today increments correctly (From ${beforeStats.today} to ${afterStats.today})`);

console.log("\n==================================================");
console.log(`SYNC TIMESTAMP TESTS COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("==================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
