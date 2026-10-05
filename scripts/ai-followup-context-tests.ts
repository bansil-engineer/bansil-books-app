// ============================================================
// AI CEO follow-up context / period retention tests
//
// Fully isolated: the process chdir()s into a unique temp directory BEFORE any
// project module is loaded, so data/bansil_books.db and data/ai_workspace.db
// resolve inside the temp dir. AI_WORKSPACE_DB_PATH is also set explicitly.
// Operational DB hashes are verified unchanged at the end.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";

const PROJECT_ROOT = process.cwd();
const OPERATIONAL = [
  path.join(PROJECT_ROOT, "data", "ai_workspace.db"),
  path.join(PROJECT_ROOT, "data", "bansil_books.db"),
];
const sha = (f: string) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null);
const hashesBefore = OPERATIONAL.map(sha);

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ai-ceo-followup-"));
fs.mkdirSync(path.join(TEMP_ROOT, "data"));
const TEST_AI_DB = path.join(TEMP_ROOT, "data", "ai_workspace.db");
assert.notStrictEqual(path.resolve(TEST_AI_DB), path.resolve(OPERATIONAL[0]), "FATAL: test DB equals operational DB");
process.env.AI_WORKSPACE_DB_PATH = TEST_AI_DB;
process.chdir(TEMP_ROOT);

const NOW = "2026-10-15"; // fixed clock: "last month" = September 2026
let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  ✗ [FAIL] ${name}\n    ${e.message}`);
  }
}

type Msg = { id: string; role: "user" | "assistant"; content: string };

async function main() {
  const { getDatabase } = await import("../app/lib/db/database");
  const { getAiDatabase, closeAiDatabase } = await import("../app/lib/db/ai-database");
  const { handleOwnerMessage } = await import("../app/lib/ai/ceo/ceo-orchestrator");
  const { resolveFollowUp, deriveConversationContext } = await import("../app/lib/ai/ceo/conversation-context");

  assert.ok(path.resolve(getDatabase().prepare("PRAGMA database_list").all().map((r: any) => r.file)[0]).startsWith(fs.realpathSync(TEMP_ROOT)),
    "business DB must be inside the temp dir");

  // ---- seed isolated business data ----
  const db = getDatabase();
  const synced = "2026-10-15T00:00:00.000Z";
  const addInv = (id: string, date: string, cust: string, total: number, taxable: number) => {
    db.prepare(`INSERT INTO sales_invoices (invoice_id, organization_id, invoice_number, date, customer_id, customer_name, status, total, balance, synced_at)
                VALUES (?, 'org', ?, ?, ?, ?, 'sent', ?, 0, ?)`).run(id, id, date, cust, cust, total, synced);
    db.prepare(`INSERT INTO sales_invoice_line_items (line_item_id, invoice_id, item_id, item_name, quantity, rate, line_total, synced_at)
                VALUES (?, ?, 'it', 'Item', 1, ?, ?, ?)`).run("L" + id, id, taxable, taxable, synced);
  };
  for (let i = 0; i < 27; i++) addInv(`SEP${i}`, `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, `Customer ${(i % 14) + 1}`, 100000, 84000);
  addInv("SEP27", "2026-09-30", "Mega Customer", 1472060.58, 1269932.7);
  for (let i = 0; i < 3; i++) addInv(`AUG${i}`, `2026-08-1${i}`, "Aug Only Customer", 500000, 420000);
  for (let i = 0; i < 2; i++) addInv(`OCT${i}`, `2026-10-0${i + 2}`, "Oct Customer", 250000, 210000);
  db.prepare(`INSERT INTO purchase_bills (bill_id, organization_id, bill_number, date, vendor_id, vendor_name, status, total, balance, synced_at)
              VALUES ('B1','org','B1','2026-09-05','V1','Vendor One','open',12345,12345,?)`).run(synced);

  const ai = getAiDatabase();
  const countAi = () => ({
    ledger: (ai.prepare(`SELECT count(*) c FROM ai_usage_ledger`).get() as any).c,
    runs: (ai.prepare(`SELECT count(*) c FROM ai_runs`).get() as any).c,
  });
  const aiBefore = countAi();

  // ---- simulate the chat route: current user message is already in history ----
  const history: Msg[] = [];
  let seq = 0;
  const turn = async (hist: Msg[], message: string, now = NOW) => {
    hist.push({ id: `m${seq++}`, role: "user", content: message });
    const res = await handleOwnerMessage(message, [...hist], undefined, now);
    hist.push({ id: `m${seq++}`, role: "assistant", content: res.content });
    return res;
  };

  console.log("==================================================");
  console.log("AI CEO FOLLOW-UP CONTEXT TESTS (isolated)");
  console.log("==================================================\n");

  let sales = "";
  await runTest("A. 'last month sale?' -> SALES_QUERY with September period", async () => {
    const fu = resolveFollowUp("last month sale?", [{ id: "x", role: "user", content: "last month sale?" }]);
    assert.strictEqual(fu.intent, "SALES_QUERY");
    const res = await turn(history, "last month sale?");
    sales = res.content;
    assert.ok(sales.includes("### Sales Summary"));
    assert.ok(sales.includes("- Period: 01/09/2026–30/09/2026"), sales);
    assert.ok(sales.includes("₹41,72,060.58"));
  });

  let reformatted = "";
  await runTest("B. 'give all data structured in table format' -> REFORMAT, same period & exact values", async () => {
    const msg = "can you give all data structured in table format?";
    const probe = resolveFollowUp(msg, [...history, { id: "p", role: "user", content: msg }]);
    assert.strictEqual(probe.kind, "REFORMAT");
    assert.strictEqual(probe.intent, "REFORMAT_FOLLOW_UP");
    const res = await turn(history, msg);
    reformatted = res.content;
    assert.ok(!reformatted.includes("I am the AI CEO"), "must not be generic DIRECT_CHAT");
    for (const v of [
      "01/09/2026–30/09/2026", "₹41,72,060.58", "₹35,37,932.70", "₹6,34,127.88",
      "| Invoice Count | 28 |", "| Customers | 15 |",
    ]) assert.ok(reformatted.includes(v), `missing ${v}\n${reformatted}`);
    // every table line of the original answer survives unchanged
    for (const line of sales.split("\n").filter(l => l.startsWith("|"))) assert.ok(reformatted.includes(line), `row changed: ${line}`);
    assert.ok(reformatted.includes("- Period: 01/09/2026–30/09/2026"));
    assert.strictEqual(res.runId, "");
  });

  await runTest("C. 'show top 5 customers also' -> CUSTOMER_QUERY inheriting 01/09/2026–30/09/2026", async () => {
    const msg = "show top 5 customers also";
    const probe = resolveFollowUp(msg, [...history, { id: "p", role: "user", content: msg }]);
    assert.strictEqual(probe.intent, "CUSTOMER_QUERY");
    assert.strictEqual(probe.kind, "INHERIT_PERIOD");
    assert.strictEqual(probe.periodOverride?.startDate, "2026-09-01");
    assert.strictEqual(probe.periodOverride?.endDate, "2026-09-30");
    const res = await turn(history, msg);
    assert.ok(res.content.includes("### Top 5 Customers"));
    assert.ok(res.content.includes("- Period: 01/09/2026–30/09/2026"), res.content);
    assert.ok(!res.content.includes("01/04/2026"), "must not fall back to FY-to-date");
    // verify against source data
    const top = db.prepare(`SELECT customer_name n, SUM(total) s FROM sales_invoices
      WHERE status!='void' AND status!='draft' AND date>='2026-09-01' AND date<='2026-09-30'
      GROUP BY customer_name ORDER BY s DESC LIMIT 1`).get() as any;
    assert.strictEqual(top.n, "Mega Customer");
    assert.ok(res.content.includes(`| 1 | Mega Customer | ₹${top.s.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |`), res.content);
    assert.ok(!res.content.includes("Oct Customer") && !res.content.includes("Aug Only Customer"));
  });

  await runTest("D. 'show top customers this month' -> explicit period overrides inherited September", async () => {
    const msg = "show top customers this month";
    const probe = resolveFollowUp(msg, [...history, { id: "p", role: "user", content: msg }]);
    assert.strictEqual(probe.kind, "NONE");
    const res = await turn(history, msg);
    assert.ok(res.content.includes("- Period: 01/10/2026–15/10/2026"), res.content);
    assert.ok(res.content.includes("Oct Customer"));
    assert.ok(!res.content.includes("Mega Customer"));
  });

  await runTest("E. 'how much payable?' after a period query -> current snapshot, not September", async () => {
    // context now comes from the 'this month' result; add a September result again to prove the point
    await turn(history, "show top customers last month");
    const res = await turn(history, "how much payable?");
    assert.ok(res.content.includes("### Payables Summary"));
    assert.ok(res.content.includes("- Period: Current"), res.content);
    assert.ok(!res.content.includes("01/09/2026"));
    assert.ok(res.content.includes("₹12,345.00"));
    const probe = resolveFollowUp("how much payable?", [...history.slice(0, -2), { id: "p", role: "user", content: "how much payable?" }]);
    assert.strictEqual(probe.intent, "PAYABLE_QUERY");
    assert.strictEqual(probe.kind, "NONE");
    assert.strictEqual(probe.periodOverride, undefined);
  });

  await runTest("F. brand-new conversation: no inherited context or period", async () => {
    const fresh: Msg[] = [];
    const ctx = deriveConversationContext([{ id: "n", role: "user", content: "show top 5 customers also" }], "show top 5 customers also");
    assert.deepStrictEqual(ctx, {
      lastBusinessIntent: null, lastResolvedPeriod: null, lastEntityScope: null,
      lastBusinessResultType: null, lastResultContent: null,
    });
    const res = await turn(fresh, "show top 5 customers also");
    assert.ok(res.content.includes("- Period: 01/04/2026–15/10/2026"), res.content);
    assert.ok(!res.content.includes("01/09/2026–30/09/2026"));
    // and a reformat request in a fresh conversation has nothing to reformat -> not REFORMAT
    const r = resolveFollowUp("give all data structured in table format", [{ id: "n", role: "user", content: "give all data structured in table format" }]);
    assert.strictEqual(r.kind, "NONE");
  });

  await runTest("G. follow-ups made no model call / no AI usage / no governed run", async () => {
    const after = countAi();
    assert.deepStrictEqual(after, aiBefore, "ai_usage_ledger / ai_runs changed");
    const r1 = await handleOwnerMessage("summarize this", [
      { id: "1", role: "user", content: "last month sale?" },
      { id: "2", role: "assistant", content: sales },
      { id: "3", role: "user", content: "summarize this" },
    ], undefined, NOW);
    assert.strictEqual(r1.modelTier, "FAST_OPERATIONAL");
    assert.strictEqual(r1.runId, "");
    assert.ok(r1.content.includes("**Executive Summary**") && !r1.content.includes("| Gross Sales |"));
    assert.ok(r1.content.includes("Sales for 01/09/2026–30/09/2026 were"), r1.content);
    assert.ok(r1.content.includes("- Period: 01/09/2026–30/09/2026"));
    assert.deepStrictEqual(countAi(), aiBefore);
  });

  await runTest("H. reformat chains: a second reformat keeps the same period", async () => {
    const h2: Msg[] = [];
    await turn(h2, "last month sale?");
    await turn(h2, "show in table");
    const res = await turn(h2, "show top 5 customers also");
    assert.ok(res.content.includes("- Period: 01/09/2026–30/09/2026"), res.content);
  });

  closeAiDatabase();
}

(async () => {
  let fatal: unknown = null;
  try {
    await main();
  } catch (e) {
    fatal = e;
    failed++;
    console.error("FATAL:", e);
  } finally {
    process.chdir(PROJECT_ROOT);
    try {
      const real = fs.realpathSync(TEMP_ROOT);
      assert.ok(path.basename(real).startsWith("ai-ceo-followup-"), "refusing to delete non-test dir");
      fs.rmSync(real, { recursive: true, force: true });
    } catch (e) { failed++; console.error("cleanup failed", e); }
  }
  const hashesAfter = OPERATIONAL.map(sha);
  const same = JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter);
  OPERATIONAL.forEach((f, i) => console.log(`  operational ${path.basename(f)}: before=${hashesBefore[i]} after=${hashesAfter[i]}`));
  if (!same) { failed++; console.error("FAIL: operational DB hash changed"); } else console.log("  ✓ operational DBs unchanged");
  console.log(`\nFOLLOW-UP CONTEXT TESTS: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
