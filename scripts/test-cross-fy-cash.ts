import { getGenuineCashAccounts } from "../app/lib/audit/cash-sync-service.js";
import { calculateCashEquation } from "../app/lib/audit/cash-equation.js";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runTests() {
  console.log("=== STARTING STAGE 5A CROSS-FY CASH TESTS ===");
  
  // 1. Verify backend logic for different FY boundaries
  const testFYs = [
    { label: "FY 2024-25", from: "2024-04-01", to: "2025-03-31" },
    { label: "FY 2025-26", from: "2025-04-01", to: "2026-03-31" },
    { label: "FY 2026-27", from: "2026-04-01", to: "2027-03-31" },
  ];
  
  const cashAccounts = getGenuineCashAccounts();
  const fyResults: Record<string, any> = {};

  for (const fy of testFYs) {
    const results = cashAccounts.map((acc: any) => calculateCashEquation(acc.account_id, fy.from, fy.to));
    const netCash = results.reduce((sum: number, r: any) => sum + r.closing_balance, 0);
    const negativeAccounts = results.filter((r: any) => r.closing_balance < 0).length;
    fyResults[fy.label] = { netCash, negativeAccounts };
    
    console.log(`\n[${fy.label}] Bounds: ${fy.from} to ${fy.to}`);
    console.log(`  Net Cash: ₹${netCash.toFixed(2)}`);
    console.log(`  Negative Closing Accounts: ${negativeAccounts}`);
  }

  // Verify FYs yield different data subsets (Source universe varies)
  assert.notStrictEqual(fyResults["FY 2024-25"].netCash, fyResults["FY 2025-26"].netCash, "FY24-25 and FY25-26 Net Cash should differ");
  assert.notStrictEqual(fyResults["FY 2025-26"].netCash, fyResults["FY 2026-27"].netCash, "FY25-26 and FY26-27 Net Cash should differ");
  
  console.log("\n✓ PASS: Date bounds correctly isolate cash transactions by Financial Year.");

  // 2. Verify removal of hardcoded literals in PreAuditCashTab.tsx
  const tabPath = path.join(__dirname, "..", "app", "components", "audit", "cash", "CashBooksView.tsx");
  const tabSource = fs.readFileSync(tabPath, 'utf8');
  
  const badLiterals = [
    "219692.51", // Old Company Cash
    "511399",    // Old Net Cash
    "37209.78",  // Old Negative Exposure
    "3166667000000123049" // Hardcoded account ID
  ];

  for (const literal of badLiterals) {
    if (tabSource.includes(literal)) {
      throw new Error(`FAIL: Found hardcoded literal '${literal}' in CashBooksView.tsx!`);
    }
  }
  
  console.log("✓ PASS: Hardcoded cash literals removed from CashBooksView.tsx.");
  
  console.log("\n=== ALL CROSS-FY CASH TESTS PASSED ===");
}

runTests();
