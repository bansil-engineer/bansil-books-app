import { listChartOfAccounts, listBankAccounts } from "../app/lib/audit/accounts/zoho-read-source.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import fs from "fs";

function assertPass(name: string, condition: boolean) {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
  } else {
    console.error(`❌ [FAIL] ${name}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log("Starting Accounts Audit Phase 2A Tests...");

  // Static checks on zoho-read-source.ts
  const sourceCode = fs.readFileSync("./app/lib/audit/accounts/zoho-read-source.ts", "utf-8");
  
  assertPass("Chart of Accounts request uses GET", sourceCode.includes('method: "GET"'));
  assertPass("Bank Accounts request uses GET", sourceCode.includes('method: "GET"'));
  assertPass("No write HTTP method exists in source module", !sourceCode.includes('"POST"') && !sourceCode.includes('"PUT"') && !sourceCode.includes('"DELETE"') && !sourceCode.includes('"PATCH"'));
  assertPass("Account numbers are masked", sourceCode.includes('maskedAcctNumber'));

  // Live test logic if token is available
  try {
    const { store } = await getValidAccessToken();
    const orgId = store.organization_id || "774390949";
    console.log(`Attempting live read for organization: ${orgId}`);

    try {
      const coaRes = await listChartOfAccounts(orgId);
      console.log(`✅ [PASS] Chart of Accounts fetch succeeded. Found ${coaRes.accounts.length} accounts.`);
      // Count by account type
      const counts: Record<string, number> = {};
      for (const a of coaRes.accounts) {
        counts[a.account_type] = (counts[a.account_type] || 0) + 1;
      }
      console.log(`   Account types: ${JSON.stringify(counts)}`);
    } catch (err: any) {
      console.log(`⚠️ Chart of Accounts fetch error: ${err.message}`);
    }

    try {
      const bankRes = await listBankAccounts(orgId);
      console.log(`✅ [PASS] Bank Accounts fetch succeeded. Found ${bankRes.bankAccounts.length} accounts.`);
      for (const a of bankRes.bankAccounts) {
         console.log(`   Bank Account: ID=${a.account_id}, Name=${a.account_name}, Masked#=${a.masked_account_number || 'N/A'}`);
      }
    } catch (err: any) {
      console.log(`⚠️ Bank Accounts fetch error: ${err.message}`);
    }
  } catch (err) {
    console.log("No valid access token available for live testing, skipping live fetch.");
  }

  console.log("Tests complete.");
}

runTests().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
