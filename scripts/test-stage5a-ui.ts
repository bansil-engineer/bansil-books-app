import fs from "fs";

function assertPattern(content: string, pattern: RegExp, shouldExist: boolean, message: string) {
  const exists = pattern.test(content);
  if (exists !== shouldExist) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const content = fs.readFileSync("app/components/audit/cash/CashBooksView.tsx", "utf-8");

console.log("Running UI Structural Verification...");

assertPattern(content, /Export Excel/i, false, "Duplicate inner toolbar for Excel should be absent");
assertPattern(content, /Print PDF/i, false, "Duplicate inner toolbar for PDF should be absent");
assertPattern(content, /Sync from Zoho/i, false, "Duplicate inner toolbar for Sync should be absent");

assertPattern(content, /Net Cash in Hand/, true, "Summary cards: Net Cash must exist");
assertPattern(content, /Cash Accounts/, true, "Summary cards: Cash Accounts must exist");
assertPattern(content, /Negative Closing Accounts/, true, "Summary cards: Negative Closing Accounts must exist");
assertPattern(content, /Physical Count/, true, "Summary cards: Physical Count must exist");

assertPattern(content, /Negative Closing Accounts.*?Accounts Negative During FY.*?Negative Transactions.*?Negative Balance Dates.*?Continuous Negative Periods/s, true, "Five negative metric cards exist");

assertPattern(content, /<table/i, true, "Cash register table exists");
assertPattern(content, /Cash & Imprest Register/, true, "Cash register table exists");

assertPattern(content, /Negative Evidence Details/, true, "Evidence drill-down exists");
assertPattern(content, /toggleRow/, true, "Evidence drill-down exists (toggle)");

assertPattern(content, /₹2,87,009\.51/, false, "Hardcoded accounting values should not exist");
assertPattern(content, /287009/, false, "Hardcoded accounting values should not exist");
assertPattern(content, /\b19\b/, false, "Hardcoded accounting values (19 accounts) should not exist");
assertPattern(content, /\b54\b/, false, "Hardcoded accounting values (54 periods) should not exist");

assertPattern(content, /Bansil Books/i, false, "No 'Bansil Books' text");
assertPattern(content, /Corporate/i, false, "No 'Corporate' text");

assertPattern(content, /unrecorded receipts/i, false, "No presumptive tax/cause language (unrecorded receipts)");
assertPattern(content, /capital infusion/i, false, "No presumptive tax/cause language (capital infusion)");
assertPattern(content, /tax violation/i, false, "No presumptive tax/cause language (tax violation)");

console.log("PASS: CashBooksView structural tests");
