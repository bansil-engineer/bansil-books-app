import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { assertOperationalDbsUnchanged, snapshotOperationalHashes } from './test-db-isolation';

// This suite only reads two source files (no DB access). The hash guard proves it.
const OPERATIONAL_BEFORE = snapshotOperationalHashes();

function runTests() {
  console.log("==================================================");
  console.log("RUNNING RESPONSE CONTRACT TESTS");
  console.log("==================================================");

  const routeContent = fs.readFileSync(path.join(__dirname, '../app/api/ai/chat/route.ts'), 'utf-8');
  const uiContent = fs.readFileSync(path.join(__dirname, '../app/components/AiAssistantView.tsx'), 'utf-8');

  // API returning response
  assert.ok(routeContent.includes('response: responseText'), "API must return 'response'");
  assert.ok(!routeContent.includes('content: responseText'), "API must NOT return 'content'");

  // UI expecting response
  assert.ok(uiContent.includes('data.response'), "UI must read 'data.response'");

  console.log("[PASS] [API_UI_CONTRACT] API and UI agree on 'response' payload shape.");

  assertOperationalDbsUnchanged(OPERATIONAL_BEFORE, "phase-2h");

  console.log("==================================================");
  console.log("TOTAL TESTS: 1 | PASSED: 1 | FAILED: 0");
  console.log("ALL RESPONSE CONTRACT TESTS PASSED!");
}
runTests();
