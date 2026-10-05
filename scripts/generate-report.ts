import { listChartOfAccounts, listBankAccounts } from "../app/lib/audit/accounts/zoho-read-source.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import fs from "fs";

async function generateReport() {
  const { store } = await getValidAccessToken();
  const orgId = store.organization_id || "774390949";
  
  const coaRes = await listChartOfAccounts(orgId);
  const bankRes = await listBankAccounts(orgId);

  let md = "";

  md += "## F. Actual Chart of Accounts Universe\n\n";
  const accounts = coaRes.accounts;
  const activeCount = accounts.filter(a => a.is_active).length;
  const inactiveCount = accounts.filter(a => !a.is_active).length;
  
  const counts: Record<string, number> = {};
  for (const a of accounts) {
    counts[a.account_type] = (counts[a.account_type] || 0) + 1;
  }

  md += `Total accounts: ${accounts.length}\n`;
  md += `Active: ${activeCount} | Inactive: ${inactiveCount}\n`;
  md += `Count by type: ${JSON.stringify(counts)}\n\n`;

  for (const a of accounts) {
    md += `- ID: ${a.account_id} | Name: ${a.account_name} | Code: ${a.account_code || "N/A"} | Type: ${a.account_type} | Subtype: ${a.account_sub_type || "N/A"} | Parent: ${a.parent_account_name || "N/A"} (${a.parent_account_id || "N/A"}) | Active: ${a.is_active}\n`;
  }

  md += "\n## G. Financial Account Classification\n\n";
  const classification: Record<string, string[]> = {
    "Bank": [], "Cash": [], "Accounts Receivable": [], "Accounts Payable": [], "Sales / Income": [],
    "Other / Indirect Income": [], "Expenses": [], "Fixed Assets": [], "Current Assets": [],
    "Current Liabilities": [], "Loans": [], "Capital / Equity": [], "Tax-related": [],
    "GST-related": [], "TDS-related": [], "Investment-related": [], "Unclassified / Needs OWNER Review": []
  };

  for (const a of accounts) {
    const t = a.account_type.toLowerCase();
    const name = a.account_name.toLowerCase();
    
    if (t === "bank") classification["Bank"].push(a.account_name);
    else if (t === "cash") classification["Cash"].push(a.account_name);
    else if (t === "accounts_receivable") classification["Accounts Receivable"].push(a.account_name);
    else if (t === "accounts_payable") classification["Accounts Payable"].push(a.account_name);
    else if (t === "income") classification["Sales / Income"].push(a.account_name);
    else if (t === "other_income") classification["Other / Indirect Income"].push(a.account_name);
    else if (t === "expense" || t === "cost_of_goods_sold" || t === "other_expense") classification["Expenses"].push(a.account_name);
    else if (t === "fixed_asset") classification["Fixed Assets"].push(a.account_name);
    else if (t === "other_current_asset") {
      if (name.includes("gst") || name.includes("tax") || name.includes("tds")) {
         // wait, tax related is general, we will put into Current Assets and also tag later.
         classification["Current Assets"].push(a.account_name);
      } else {
         classification["Current Assets"].push(a.account_name);
      }
    }
    else if (t === "other_current_liability" || t === "other_liability") classification["Current Liabilities"].push(a.account_name);
    else if (t === "long_term_liability") classification["Loans"].push(a.account_name);
    else if (t === "equity") classification["Capital / Equity"].push(a.account_name);
    else classification["Unclassified / Needs OWNER Review"].push(a.account_name);
    
    if (name.includes("gst")) classification["GST-related"].push(a.account_name);
    if (name.includes("tds")) classification["TDS-related"].push(a.account_name);
    if (name.includes("tax")) classification["Tax-related"].push(a.account_name);
    if (name.includes("invest") || name.includes("mutual fund") || name.includes("shares") || name.includes("securities") || name.includes("dividend")) classification["Investment-related"].push(a.account_name);
  }

  for (const [k, v] of Object.entries(classification)) {
    if (v.length > 0) {
      md += `**${k}**: ${v.length} accounts\n`;
    }
  }

  md += "\n## H. Exact Bank Account Universe\n\n";
  for (const b of bankRes.bankAccounts) {
    md += `- ID: ${b.account_id} | Name: ${b.account_name} | Type: ${b.account_type} | Currency: ${b.currency_code} | Active: ${b.is_active} | Masked#: ${b.masked_account_number || "N/A"} | Balance: ${b.balance !== undefined ? b.balance : "N/A"} | Uncategorized Txns: ${b.uncategorized_transactions !== undefined ? b.uncategorized_transactions : "N/A"}\n`;
  }

  md += "\n## J. GST/TDS/Investment Account Observations\n\n";
  const observations: string[] = [];
  for (const a of accounts) {
    const name = a.account_name.toLowerCase();
    if (name.includes("gst") || name.includes("tds") || name.includes("interest") || name.includes("dividend") || name.includes("mutual fund") || name.includes("shares") || name.includes("securities") || name.includes("invest")) {
      observations.push(`${a.account_name} (${a.account_type})`);
    }
  }
  md += observations.join("\n") + "\n";

  fs.writeFileSync("report_body.md", md);
}

generateReport().catch(console.error);
