import { getGenuineCashAccounts } from "./app/lib/audit/cash-sync-service";
import { calculateCashEquation } from "./app/lib/audit/cash-equation";
import { getAuditDatabase } from "./app/lib/db/audit-database";

function testFY(fy: string) {
  const fromDate = fy === "2025-26" ? "2025-04-01" : fy === "2024-25" ? "2024-04-01" : "2026-04-01";
  const toDate = fy === "2025-26" ? "2026-03-31" : fy === "2024-25" ? "2025-03-31" : "2027-03-31";
  
  const cashAccounts = getGenuineCashAccounts();
  const results = cashAccounts.map((acc: any) => calculateCashEquation(acc.account_id, fromDate, toDate));
  
  console.log(`\n=== FY ${fy} ===`);
  console.log(`From: ${fromDate}, To: ${toDate}`);
  
  const company = results.find((r: any) => r.account_name.includes("Company"));
  const petty = results.find((r: any) => r.account_name.includes("Petty"));
  
  const netCash = results.reduce((sum: number, r: any) => sum + r.closing_balance, 0);
  const negAccounts = results.filter((r: any) => r.closing_balance < 0).length;
  const negExposure = results.filter((r: any) => r.closing_balance < 0).reduce((sum: number, r: any) => sum + r.closing_balance, 0);
  
  console.log(`Cash For Company closing: ${company?.closing_balance}`);
  console.log(`Petty Cash closing: ${petty?.closing_balance}`);
  console.log(`Net Cash: ${netCash}`);
  console.log(`negative account count: ${negAccounts}`);
  console.log(`negative exposure: ${negExposure}`);
}

testFY("2024-25");
testFY("2025-26");
testFY("2026-27");
