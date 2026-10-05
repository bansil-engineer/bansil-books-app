import { getDatabase } from '../app/lib/db/database';
import { getAiDatabase } from '../app/lib/db/ai-database';
import { resolvePeriod } from '../app/lib/ai/ceo/date-resolver';
import * as assert from 'assert';

const API_URL = 'http://localhost:3000/api/ai/chat';
const db = getDatabase();

async function askCeo(message: string): Promise<any> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId: "live-test-" + Date.now() })
  });
  if (!res.ok) {
    throw new Error(`API failed with ${res.status}`);
  }
  return res.json();
}

function getSqlNumber(sql: string, params: any[] = []): number {
  const row: any = db.prepare(sql).get(...params);
  if (!row) return 0;
  const val = Object.values(row)[0];
  if (val === null || val === undefined) return 0;
  return val as number;
}

function extractCurrency(text: string, label: string): string {
  const regex = new RegExp(`\\|\\s*${label}\\s*\\|\\s*₹([0-9,.]+)`, 'i');
  const match = text.match(regex);
  if (match) {
    return match[1].replace(/,/g, '');
  }
  // Fallback for Top N table
  const m = text.match(/\|\s*1\s*\|\s*[^|]+\s*\|\s*₹([0-9,.]+)/i);
  return m ? m[1].replace(/,/g, '') : "0";
}

async function runTests() {
  console.log("==================================================");
  console.log("LIVE ACCEPTANCE TESTS: 8 BUSINESS QUERIES");
  console.log("==================================================");

  let passed = 0;
  
  // 1. last month sale?
  console.log("\n--- TEST 1: LAST MONTH SALES ---");
  let response = await askCeo("last month sale?");
  let content = response.response;
  let p = resolvePeriod("last month sale?");
  
  let sqlGross = getSqlNumber(`SELECT SUM(total) FROM sales_invoices WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?`, [p.startDate, p.endDate]);
  
  let ceoGross = extractCurrency(content, "Gross Sales");
  
  console.log(`Gross: ₹${ceoGross} (SQL: ₹${sqlGross.toFixed(2)})`);
  if (Math.abs(parseFloat(ceoGross) - sqlGross) < 1 && content.includes(p.description)) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
    console.log("Content received:\n" + content);
  }

  // 2. this month sale?
  console.log("\n--- TEST 2: THIS MONTH SALES ---");
  response = await askCeo("this month sale?");
  content = response.response;
  p = resolvePeriod("this month sale?");
  
  sqlGross = getSqlNumber(`SELECT SUM(total) FROM sales_invoices WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?`, [p.startDate, p.endDate]);
  ceoGross = extractCurrency(content, "Gross Sales");
  
  console.log(`Gross: ₹${ceoGross} (SQL: ₹${sqlGross.toFixed(2)})`);
  if (Math.abs(parseFloat(ceoGross) - sqlGross) < 1 && content.includes(p.description)) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
  }
  
  // 3. last month purchase?
  console.log("\n--- TEST 3: LAST MONTH PURCHASE ---");
  response = await askCeo("last month purchase?");
  content = response.response;
  p = resolvePeriod("last month purchase?");
  
  sqlGross = getSqlNumber(`SELECT SUM(total) FROM purchase_bills WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?`, [p.startDate, p.endDate]);
  ceoGross = extractCurrency(content, "Gross Purchase");
  
  console.log(`Gross: ₹${ceoGross} (SQL: ₹${sqlGross.toFixed(2)})`);
  if (Math.abs(parseFloat(ceoGross) - sqlGross) < 1 && content.includes(p.description)) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
  }
  
  // 4. how much receivable?
  console.log("\n--- TEST 4: RECEIVABLE ---");
  response = await askCeo("how much receivable?");
  content = response.response;
  
  sqlGross = getSqlNumber(`SELECT SUM(balance) FROM sales_invoices WHERE status != 'void' AND status != 'draft' AND status != 'paid' AND balance > 0`);
  ceoGross = extractCurrency(content, "Total Receivable");
  
  console.log(`Amount: ₹${ceoGross} (SQL: ₹${sqlGross.toFixed(2)})`);
  if (Math.abs(parseFloat(ceoGross) - sqlGross) < 1) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
  }

  // 5. how much payable?
  console.log("\n--- TEST 5: PAYABLE ---");
  response = await askCeo("how much payable?");
  content = response.response;
  
  sqlGross = getSqlNumber(`SELECT SUM(balance) FROM purchase_bills WHERE status != 'void' AND status != 'draft' AND status != 'paid' AND balance > 0`);
  ceoGross = extractCurrency(content, "Total Payable");
  
  console.log(`Amount: ₹${ceoGross} (SQL: ₹${sqlGross.toFixed(2)})`);
  if (Math.abs(parseFloat(ceoGross) - sqlGross) < 1) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
  }

  // 6. top 5 customers last month
  console.log("\n--- TEST 6: TOP 5 CUSTOMERS ---");
  response = await askCeo("top 5 customers last month");
  content = response.response;
  p = resolvePeriod("top 5 customers last month");
  
  const sqlTopC = getSqlNumber(`
    SELECT SUM(total) FROM sales_invoices 
    WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?
    GROUP BY customer_name ORDER BY SUM(total) DESC LIMIT 1
  `, [p.startDate, p.endDate]);
  
  ceoGross = extractCurrency(content, "Top 1");
  console.log(`Top 1 Amount: ₹${ceoGross} (SQL: ₹${sqlTopC.toFixed(2)})`);
  if ((Math.abs(parseFloat(ceoGross) - sqlTopC) < 1 || (parseFloat(ceoGross) === 0 && sqlTopC === 0)) && content.includes(p.description)) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
  }

  // 7. top 5 vendors last month
  console.log("\n--- TEST 7: TOP 5 VENDORS ---");
  response = await askCeo("top 5 vendors last month");
  content = response.response;
  p = resolvePeriod("top 5 vendors last month");
  
  const sqlTopV = getSqlNumber(`
    SELECT SUM(total) FROM purchase_bills 
    WHERE status != 'void' AND status != 'draft' AND date >= ? AND date <= ?
    GROUP BY vendor_name ORDER BY SUM(total) DESC LIMIT 1
  `, [p.startDate, p.endDate]);
  
  ceoGross = extractCurrency(content, "Top 1");
  console.log(`Top 1 Amount: ₹${ceoGross} (SQL: ₹${sqlTopV.toFixed(2)})`);
  if ((Math.abs(parseFloat(ceoGross) - sqlTopV) < 1 || (parseFloat(ceoGross) === 0 && sqlTopV === 0)) && content.includes(p.description)) {
    console.log("Independent match: PASS");
    passed++;
  } else {
    console.log("Independent match: FAIL");
  }

  // 8. Balance Sheet
  console.log("\n--- TEST 8: BALANCE SHEET ---");
  response = await askCeo("analise fy 2025-26 balance sheet");
  
  const runId = response.runId || "none";
  console.log(`Run ID: ${runId}`);
  
  const aiDb = getAiDatabase();
  const runRow: any = aiDb.prepare(`SELECT status, reviewer_required, reviewer_status FROM ai_runs WHERE id = ?`).get(runId);
  if (!runRow) {
      console.log("Could not find run in DB.");
      console.log("Independent match: FAIL");
  } else {
    console.log(`Run status: ${runRow.status}`);
    console.log(`Reviewer status: ${runRow.reviewer_status}`);
    
    if (runRow.status === 'COMPLETED' || runRow.status === 'REVIEWED_AND_VERIFIED') {
      console.log("Independent match: PASS");
      passed++;
    } else {
      console.log("Independent match: FAIL");
    }
  }

  console.log(`\nLIVE ACCEPTANCE: ${passed} / 8`);
}

runTests().catch(console.error);
