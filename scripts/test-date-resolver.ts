import { resolvePeriod } from '../app/lib/ai/ceo/date-resolver';
import * as assert from 'assert';

function testDateResolver() {
  let result = resolvePeriod("last month", "2026-10-01");
  assert.strictEqual(result.startDate, "2026-09-01");
  assert.strictEqual(result.endDate, "2026-09-30");

  result = resolvePeriod("last month", "2026-11-15");
  assert.strictEqual(result.startDate, "2026-10-01");
  assert.strictEqual(result.endDate, "2026-10-31");

  result = resolvePeriod("last month", "2027-01-10");
  assert.strictEqual(result.startDate, "2026-12-01");
  assert.strictEqual(result.endDate, "2026-12-31");

  console.log("Date resolver tests passed.");
}
testDateResolver();
