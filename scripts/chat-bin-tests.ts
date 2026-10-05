// ============================================================
// AI CEO Chat Bin (reversible soft delete) regression tests
//
// ISOLATION: unique temp DB. AI_WORKSPACE_DB_PATH is set and the process
// chdir()s into the temp dir BEFORE any project module is imported.
// Zero AI/model calls. Operational DB hash is verified unchanged.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";

const PROJECT_ROOT = process.cwd();
const OPERATIONAL_AI_DB = path.join(PROJECT_ROOT, "data", "ai_workspace.db");
const sha = (f: string) => (fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null);
const hashBefore = sha(OPERATIONAL_AI_DB);

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ai-ceo-chat-bin-"));
fs.mkdirSync(path.join(TEMP_ROOT, "data"));
const TEST_DB = path.join(TEMP_ROOT, "data", "ai_workspace.db");
assert.notStrictEqual(path.resolve(TEST_DB), path.resolve(OPERATIONAL_AI_DB), "FATAL: test DB equals operational DB");
process.env.AI_WORKSPACE_DB_PATH = TEST_DB;
process.chdir(TEMP_ROOT);

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  ✗ [FAIL] ${name}\n    ${e.message}`);
  }
}

const MD_TABLE = "### Sales Summary\n\n| Particular | Amount |\n|---|---:|\n| Gross Sales | ₹41,72,060.58 |\n\nData Basis:\n- Period: 01/09/2026–30/09/2026";

async function main() {
  const aiDb = await import("../app/lib/db/ai-database");
  const bin = await import("../app/lib/ai/conversation-bin");
  const listRoute = await import("../app/api/ai/conversations/route");
  const oneRoute = await import("../app/api/ai/conversations/[id]/route");
  const stateRoute = await import("../app/api/ai/conversations/[id]/state/route");
  const impactRoute = await import("../app/api/ai/conversations/[id]/impact/route");
  const msgRoute = await import("../app/api/ai/conversations/[id]/messages/route");
  const { assertZohoReadOnlyRequest } = await import("../app/lib/zoho-security-guard");

  const db = aiDb.getAiDatabase();
  const ledgerBefore = (db.prepare(`SELECT count(*) c FROM ai_usage_ledger`).get() as any).c;

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const listApi = async (state?: string) => {
    const res = await listRoute.GET(new Request(`http://x/api/ai/conversations${state ? `?state=${state}` : ""}`));
    return { status: res.status, body: (await res.json()) as any };
  };
  const stateApi = async (id: string, body: unknown) => {
    const res = await stateRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      ctx(id)
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  const A = crypto.randomUUID();
  const B = crypto.randomUUID();
  const base = Date.parse("2026-09-01T00:00:00Z");
  const iso = (n: number) => new Date(base + n * 1000).toISOString();
  const insConv = (id: string, title: string, n: number) =>
    db.prepare(`INSERT INTO ai_conversations (id, title, user_identifier, created_at, updated_at) VALUES (?,?,?,?,?)`).run(id, title, "owner", iso(n), iso(n));
  const insMsg = (conv: string, role: string, content: string, n: number) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at) VALUES (?,?,?,?,?,?)`).run(id, conv, role, content, "CEO", iso(n));
    return id;
  };
  insConv(A, "September Sales", 1);
  insConv(B, "Receivables", 10);
  const msgIdsA = [insMsg(A, "user", "last month sale?", 2), insMsg(A, "assistant", MD_TABLE, 3), insMsg(A, "user", "show in table", 4)];
  insMsg(B, "user", "how much receivable?", 11);
  const RUN = "run_" + crypto.randomUUID();
  db.prepare(`INSERT INTO ai_runs (id, conversation_id, status, started_at) VALUES (?,?,?,?)`).run(RUN, A, "COMPLETED", iso(3));
  const TASK = "task_" + crypto.randomUUID();
  db.prepare(`INSERT INTO ai_tasks (id, run_id, objective, requested_by, priority, status, created_at) VALUES (?,?,?,?,?,?,?)`).run(TASK, RUN, "obj", "CEO", "HIGH", "COMPLETED", iso(3));

  const msgSnapshot = (conv: string) =>
    JSON.stringify(db.prepare(`SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(conv));
  const countMsgs = (conv: string) => (db.prepare(`SELECT count(*) c FROM ai_messages WHERE conversation_id = ?`).get(conv) as any).c;
  const snapBefore = msgSnapshot(A);
  const titleBefore = (db.prepare(`SELECT title FROM ai_conversations WHERE id = ?`).get(A) as any).title;
  let countBefore = 0, countInBin = 0, countAfter = 0;

  console.log("==================================================");
  console.log("CHAT BIN TESTS (isolated temp DB)");
  console.log(`  test DB: ${TEST_DB}`);
  console.log("==================================================\n");

  await t("1. new conversation defaults to ACTIVE", () => {
    assert.strictEqual(bin.getConversation(db, A)!.status, "ACTIVE");
    assert.strictEqual(bin.getConversation(db, A)!.binned_at, null);
  });

  await t("2. active conversation appears in Recent (API, server-filtered)", async () => {
    const r = await listApi();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.map((c: any) => c.id).sort(), [A, B].sort());
  });

  countBefore = countMsgs(A);
  const convCountBeforeBin = (db.prepare(`SELECT count(*) c FROM ai_conversations`).get() as any).c;
  const totalMsgsBeforeBin = (db.prepare(`SELECT count(*) c FROM ai_messages`).get() as any).c;
  const totalRunsBeforeBin = (db.prepare(`SELECT count(*) c FROM ai_runs`).get() as any).c;
  const rowBeforeBin = db.prepare(`SELECT id, title, user_identifier, created_at, updated_at FROM ai_conversations WHERE id = ?`).get(A);
  await t("3. Move to Bin changes state to BINNED and records binned_at / binned_by", async () => {
    const moved = await stateApi(A, { action: "MOVE_TO_BIN" });
    assert.strictEqual(moved.status, 200);
    assert.strictEqual(moved.body.status, "BINNED");
    assert.ok(moved.body.binned_at && !Number.isNaN(Date.parse(moved.body.binned_at)));
    assert.strictEqual((db.prepare(`SELECT binned_by FROM ai_conversations WHERE id = ?`).get(A) as any).binned_by, "OWNER");
  });

  await t("3b. Move to Bin is a STATE CHANGE, not a copy: same row, same id, counts unchanged", () => {
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations`).get() as any).c, convCountBeforeBin, "conversation count changed");
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations WHERE id = ?`).get(A) as any).c, 1, "exactly one row for the id");
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations WHERE title = ?`).get(titleBefore) as any).c, 1, "no duplicate title/copy");
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_messages`).get() as any).c, totalMsgsBeforeBin, "messages were copied");
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_runs`).get() as any).c, totalRunsBeforeBin, "runs were copied");
    const rowNow = db.prepare(`SELECT id, title, user_identifier, created_at, updated_at FROM ai_conversations WHERE id = ?`).get(A);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rowNow)), JSON.parse(JSON.stringify(rowBeforeBin)), "only status columns may change");
  });

  await t("4. Move to Bin does NOT delete the conversation row (title unchanged)", () => {
    const row = bin.getConversation(db, A)!;
    assert.ok(row);
    assert.strictEqual(row.title, titleBefore);
  });

  countInBin = countMsgs(A);
  await t("5+6. messages remain and message count is unchanged while binned", () => {
    assert.strictEqual(countInBin, countBefore);
    assert.strictEqual(msgSnapshot(A), snapBefore);
  });

  await t("7. linked runs and tasks remain while binned", () => {
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_runs WHERE id = ? AND conversation_id = ?`).get(RUN, A) as any).c, 1);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_tasks WHERE id = ? AND run_id = ?`).get(TASK, RUN) as any).c, 1);
  });

  await t("8. active Recent list excludes the binned conversation", async () => {
    const r = await listApi("active");
    assert.deepStrictEqual(r.body.map((c: any) => c.id), [B]);
    assert.strictEqual((await listApi()).body.some((c: any) => c.id === A), false);
  });

  await t("9. Bin list includes the binned conversation (with title and binned_at)", async () => {
    const r = await listApi("binned");
    assert.deepStrictEqual(r.body.map((c: any) => c.id), [A]);
    assert.strictEqual(r.body[0].title, titleBefore);
    assert.ok(r.body[0].binned_at);
  });

  await t("9b. binned conversation messages are still readable via the messages API", async () => {
    const res = await msgRoute.GET(new Request("http://x"), ctx(A));
    const rows = (await res.json()) as any[];
    assert.strictEqual(rows.length, countBefore);
    assert.strictEqual(rows[1].content, MD_TABLE);
  });

  await t("9c. direct URL metadata reports BINNED truthfully (no replacement conversation created)", async () => {
    const res = await oneRoute.GET(new Request("http://x"), ctx(A));
    const body = (await res.json()) as any;
    assert.strictEqual(body.status, "BINNED");
    assert.strictEqual(body.id, A);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations`).get() as any).c, 2);
  });

  await t("9d. creating another conversation does not touch the Bin", async () => {
    const C = crypto.randomUUID();
    insConv(C, "New Chat Convo", 20);
    insMsg(C, "user", "hello", 21);
    assert.deepStrictEqual((await listApi("binned")).body.map((c: any) => c.id), [A]);
    assert.strictEqual(bin.getConversation(db, A)!.status, "BINNED");
    assert.strictEqual(countMsgs(A), countBefore);
    assert.strictEqual(bin.getConversation(db, C)!.status, "ACTIVE");
  });

  await t("10. Restore returns the SAME conversation id", async () => {
    const r = await stateApi(A, { action: "RESTORE" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.id, A);
    assert.strictEqual(r.body.status, "ACTIVE");
    assert.strictEqual(r.body.binned_at, null);
  });

  countAfter = countMsgs(A);
  await t("11. Restore preserves the same messages (ids, order, Markdown exactly)", () => {
    assert.strictEqual(msgSnapshot(A), snapBefore);
    assert.deepStrictEqual(
      (db.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ? ORDER BY created_at`).all(A) as any[]).map(r => r.id),
      msgIdsA
    );
    assert.strictEqual((db.prepare(`SELECT content FROM ai_messages WHERE id = ?`).get(msgIdsA[1]) as any).content, MD_TABLE);
    assert.strictEqual(bin.getConversation(db, A)!.title, titleBefore);
  });

  await t("12. Restore returns the conversation to Recent (Bin empty, run still linked)", async () => {
    assert.ok((await listApi("active")).body.some((c: any) => c.id === A));
    assert.deepStrictEqual((await listApi("binned")).body, []);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_runs WHERE id = ? AND conversation_id = ?`).get(RUN, A) as any).c, 1);
  });

  await t("13. duplicate message count = 0 (before/bin/after equal, ids unique)", () => {
    assert.strictEqual(countBefore, 3);
    assert.strictEqual(countInBin, 3);
    assert.strictEqual(countAfter, 3);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM (SELECT id FROM ai_messages GROUP BY id HAVING count(*) > 1)`).get() as any).c, 0);
  });

  await t("14. duplicate conversation count = 0; no new conversation id from bin/restore", () => {
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM (SELECT id FROM ai_conversations GROUP BY id HAVING count(*) > 1)`).get() as any).c, 0);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations WHERE title = ?`).get(titleBefore) as any).c, 1);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_conversations`).get() as any).c, 3); // A, B, C
  });

  await t("15. invalid transitions / actions / ids are rejected", async () => {
    assert.strictEqual((await stateApi(A, { action: "RESTORE" })).status, 409, "restore of ACTIVE");
    assert.strictEqual((await stateApi(A, { action: "MOVE_TO_BIN" })).status, 200);
    assert.strictEqual((await stateApi(A, { action: "MOVE_TO_BIN" })).status, 409, "double bin");
    assert.strictEqual((await stateApi(A, { action: "DELETE" })).status, 400);
    assert.strictEqual((await stateApi(A, { action: "PURGE" })).status, 400);
    assert.strictEqual((await stateApi(A, { status: "ACTIVE" })).status, 400, "client cannot set arbitrary state");
    assert.strictEqual((await stateApi(A, {})).status, 400);
    assert.strictEqual((await stateApi("does-not-exist", { action: "MOVE_TO_BIN" })).status, 404);
    assert.strictEqual((await listApi("everything")).status, 400);
    assert.strictEqual(bin.getConversation(db, A)!.status, "BINNED", "failed requests must not change state");
    assert.strictEqual((await stateApi(A, { action: "RESTORE" })).status, 200);
    assert.strictEqual(countMsgs(A), 3);
  });

  await t("16. no HTTP DELETE/PUT/PATCH handler and no generic delete SQL in routes", () => {
    for (const mod of [listRoute, oneRoute, stateRoute, msgRoute, impactRoute]) {
      assert.strictEqual((mod as any).DELETE, undefined, "DELETE handler must not exist");
      assert.strictEqual((mod as any).PUT, undefined);
      assert.strictEqual((mod as any).PATCH, undefined);
    }
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(PROJECT_ROOT, "app/api/ai/conversations"))) {
      const src = fs.readFileSync(f, "utf8");
      assert.ok(!/DELETE\s+FROM/i.test(src), `DELETE FROM found in route ${f}`);
      assert.ok(!/export\s+(async\s+)?function\s+DELETE/.test(src), `DELETE handler in ${f}`);
    }
    // The bin module has no delete SQL of its own: permanent delete goes through the shared verified core.
    const src = fs.readFileSync(path.join(PROJECT_ROOT, "app/lib/ai/conversation-bin.ts"), "utf8");
    assert.deepStrictEqual([...src.matchAll(/DELETE FROM (\w+)/g)].map(m => m[1]), []);

  });

  await t("17. operational DB is not used (test DB path is in the temp dir)", () => {
    assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(TEST_DB));
    assert.notStrictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(OPERATIONAL_AI_DB));
  });

  await t("17b. migration is additive and idempotent; legacy rows become ACTIVE", () => {
    const legacy = new DatabaseSync(":memory:");
    legacy.exec(`CREATE TABLE ai_conversations (id TEXT PRIMARY KEY, title TEXT, user_identifier TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO ai_conversations VALUES ('old','Test Chat','u','2026-01-01','2026-01-01');`);
    aiDb.initAiDatabase(legacy);
    aiDb.initAiDatabase(legacy);
    const row = legacy.prepare(`SELECT title, status, binned_at FROM ai_conversations WHERE id='old'`).get() as any;
    assert.strictEqual(row.title, "Test Chat");
    assert.strictEqual(row.status, "ACTIVE");
    assert.strictEqual(row.binned_at, null);
    legacy.close();
  });

  // ================= PERMANENT DELETE (isolated temp DB only) =================
  const D = crypto.randomUUID();   // conversation that will be permanently deleted
  const U = crypto.randomUUID();   // unrelated conversation (must stay untouched)
  insConv(D, "Disposable Test Chat", 30);
  insConv(U, "Unrelated Chat", 31);
  insMsg(D, "user", "d1", 32); insMsg(D, "assistant", "d2", 33);
  const uMsgId = insMsg(U, "user", "u1", 34);
  const nowIso = iso(35);
  // global records
  const AGENT = "agent_" + crypto.randomUUID();
  const agentRowsBefore = (db.prepare(`SELECT count(*) c FROM ai_agents`).get() as any).c;
  db.prepare(`INSERT INTO ai_agents (id, name, role, department, level, status, risk_class, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(AGENT, "Shared Agent", "ANALYST", "ACCOUNTS", "SPECIALIST", "ACTIVE", "STANDARD", "TEST", nowIso, nowIso);
  const globalSnap = () => JSON.stringify({
    agents: db.prepare(`SELECT * FROM ai_agents ORDER BY id`).all(),
    periods: db.prepare(`SELECT * FROM ai_budget_periods ORDER BY id`).all(),
    models: db.prepare(`SELECT * FROM model_cost_catalog ORDER BY 1`).all(),
    ledger: db.prepare(`SELECT * FROM ai_usage_ledger ORDER BY id`).all(),
    memory: db.prepare(`SELECT * FROM ai_memory_entries ORDER BY id`).all(),
    evidence: db.prepare(`SELECT * FROM ai_evidence_index ORDER BY id`).all(),
  });
  // runs / tasks / dependent rows for D (and one run for U)
  const RD = "run_D_" + crypto.randomUUID(), RU = "run_U_" + crypto.randomUUID();
  db.prepare(`INSERT INTO ai_runs (id, conversation_id, status, started_at) VALUES (?,?,?,?)`).run(RD, D, "COMPLETED", nowIso);
  db.prepare(`INSERT INTO ai_runs (id, conversation_id, status, started_at) VALUES (?,?,?,?)`).run(RU, U, "COMPLETED", nowIso);
  const mkTask = (id: string, run: string, parent: string | null) =>
    db.prepare(`INSERT INTO ai_tasks (id, parent_task_id, run_id, objective, requested_by, priority, status, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, parent, run, "obj", "CEO", "HIGH", "COMPLETED", nowIso);
  const TD1 = "td1_" + crypto.randomUUID(), TD2 = "td2_" + crypto.randomUUID(), TU = "tu_" + crypto.randomUUID();
  mkTask(TD1, RD, null); mkTask(TD2, RD, TD1); mkTask(TU, RU, null);
  const mkBudget = (id: string, task: string) =>
    db.prepare(`INSERT INTO ai_task_budgets (id, task_id, agent_id, created_at) VALUES (?,?,?,?)`).run(id, task, AGENT, nowIso);
  mkBudget("tb_d", TD1); mkBudget("tb_u", TU);
  const mkRunRow = (table: string, cols: string, vals: any[]) =>
    db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${vals.map(() => "?").join(",")})`).run(...vals);
  for (const [run, tag] of [[RD, "d"], [RU, "u"]] as const) {
    mkRunRow("ai_tool_calls", "id, run_id, tool_name, tool_class, input_summary, status", [`tc_${tag}`, run, "t", "READ_ONLY", "i", "DONE"]);
    mkRunRow("ai_approvals", "id, run_id, action_type, requested_payload_summary, status, requested_at", [`ap_${tag}`, run, "a", "p", "PENDING", nowIso]);
    mkRunRow("ai_audit_events", "id, run_id, event_type, details, created_at", [`ae_${tag}`, run, "e", "d", nowIso]);
    mkRunRow("ai_agent_handoffs", "id, run_id, task_id, source_agent_id, target_agent_id, status, created_at", [`ho_${tag}`, run, tag === "d" ? TD1 : TU, AGENT, AGENT, "DONE", nowIso]);
    mkRunRow("ai_tool_executions", "id, run_id, agent_id, tool_code, classification, input_summary, status, started_at", [`te_${tag}`, run, AGENT, "tool", "READ_ONLY", "i", "DONE", nowIso]);
  }
  const bp = (db.prepare(`SELECT id FROM ai_budget_periods LIMIT 1`).get() as any)?.id;
  if (bp) mkRunRow("ai_usage_ledger", "id, budget_period_id, task_id, provider, model, usage_type, created_at", ["led_d", bp, TD1, "none", "none", "TEST", nowIso]);
  const countOf = (sql: string, ...a: string[]) => (db.prepare(sql).get(...a) as any).c as number;
  const globalBefore = globalSnap();
  const uSnapBefore = msgSnapshot(U);
  const convCountBeforeDelete = countOf(`SELECT count(*) c FROM ai_conversations`);
  let binCountBeforeDelete = 0;
  const aiLedgerCountBefore = countOf(`SELECT count(*) c FROM ai_usage_ledger`);

  await t("19a. impact preview is read-only and reports real counts", async () => {
    const res = await impactRoute.GET(new Request("http://x"), ctx(D));
    const imp = (await res.json()) as any;
    assert.strictEqual(imp.messageCount, 2);
    assert.strictEqual(imp.runCount, 1);
    assert.strictEqual(imp.taskCount, 2);
    assert.strictEqual(imp.otherLinkedRecordCount, 6, JSON.stringify(imp)); // tc+te+ap+ae+ho + task budget
    assert.strictEqual(imp.title, "Disposable Test Chat");
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, D), 1, "preview must not mutate");
  });

  // The server requires the preview fingerprint; fetch it from the (read-only) impact preview like the UI does.
  const del = async (id: string, body: any) => {
    const b = { ...body };
    if (!("previewFingerprint" in b) && b.confirm === true && b.conversationId === id) {
      const r = await impactRoute.GET(new Request("http://x"), ctx(id));
      if (r.status === 200) b.previewFingerprint = ((await r.json()) as any).fingerprint;
    }
    return stateApi(id, { action: "DELETE_PERMANENTLY", ...b });
  };

  await t("D6. ACTIVE conversation cannot be permanently deleted (even with confirmation)", async () => {
    const r = await del(D, { confirm: true, conversationId: D });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, "NOT_IN_BIN");
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, D), 1);
    assert.strictEqual(countMsgs(D), 2);
  });

  assert.strictEqual((await stateApi(D, { action: "MOVE_TO_BIN" })).status, 200);
  binCountBeforeDelete = (await listApi("binned")).body.length; // D is the only binned conversation

  await t("D7a. BINNED conversation is NOT deleted without explicit confirmation", async () => {
    for (const body of [{}, { confirm: false, conversationId: D }, { confirm: true }, { confirm: true, conversationId: U }, { confirm: "true", conversationId: D }]) {
      const r = await del(D, body);
      assert.strictEqual(r.status, 400, JSON.stringify(body));
      assert.strictEqual(r.body.code, "CONFIRMATION_REQUIRED");
    }
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, D), 1);
    assert.strictEqual(countMsgs(D), 2);
  });

  await t("D7b. atomicity: a failure mid-delete rolls back EVERYTHING", () => {
    // A trigger makes the final conversation delete fail after children were already deleted.
    db.exec(`CREATE TRIGGER _fail_conv_delete BEFORE DELETE ON ai_conversations
             WHEN old.id = '${D}' BEGIN SELECT RAISE(ABORT, 'forced failure'); END;`);
    try {
      const r = bin.deleteBinnedConversationPermanently(db, D, { confirm: true, conversationId: D, previewFingerprint: bin.getDeleteImpact(db, D)!.fingerprint });
      assert.strictEqual(r.ok, false);
      assert.strictEqual((r as any).code, "FAILED");
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS _fail_conv_delete`);
    }
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, D), 1, "row must remain");
    assert.strictEqual(countMsgs(D), 2, "messages must remain");
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_runs WHERE conversation_id = ?`, D), 1, "runs must remain");
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_tasks WHERE id IN (?, ?)`, TD1, TD2), 2, "tasks must remain");
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_tool_executions WHERE run_id = ?`, RD), 1);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_task_budgets WHERE id = 'tb_d'`), 1);
    assert.strictEqual(bin.getConversation(db, D)!.status, "BINNED");
  });

  let deleteRes: any;
  await t("D7c. BINNED conversation is permanently deleted after explicit confirmation", async () => {
    deleteRes = await del(D, { confirm: true, conversationId: D });
    assert.strictEqual(deleteRes.status, 200, JSON.stringify(deleteRes.body));
    assert.strictEqual(deleteRes.body.deleted, true);
    assert.strictEqual(deleteRes.body.impact.messageCount, 2);
  });

  await t("D8. conversation row removed", () => {
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, D), 0);
    assert.strictEqual(bin.getConversation(db, D), null);
  });

  await t("D9. messages for that conversation removed", () => {
    assert.strictEqual(countMsgs(D), 0);
  });

  await t("D10. conversation-scoped runs and run records removed", () => {
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_runs WHERE id = ?`, RD), 0);
    for (const tbl of ["ai_tool_calls", "ai_approvals", "ai_audit_events", "ai_agent_handoffs", "ai_tool_executions"]) {
      assert.strictEqual(countOf(`SELECT count(*) c FROM ${tbl} WHERE run_id = ?`, RD), 0, tbl);
    }
  });

  await t("D11. conversation-scoped tasks (incl. child tasks) and task budgets removed", () => {
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_tasks WHERE id IN (?, ?)`, TD1, TD2), 0);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_task_budgets WHERE id = 'tb_d'`), 0);
  });

  await t("D12+13. unrelated conversation, its messages, runs, tasks and run records untouched", () => {
    assert.ok(bin.getConversation(db, U));
    assert.strictEqual(msgSnapshot(U), uSnapBefore);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_messages WHERE id = ?`, uMsgId), 1);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_runs WHERE id = ?`, RU), 1);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_tasks WHERE id = ?`, TU), 1);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_task_budgets WHERE id = 'tb_u'`), 1);
    for (const tbl of ["ai_tool_calls", "ai_approvals", "ai_audit_events", "ai_agent_handoffs", "ai_tool_executions"]) {
      assert.strictEqual(countOf(`SELECT count(*) c FROM ${tbl} WHERE run_id = ?`, RU), 1, tbl);
    }
    // and conversations A and B from earlier tests
    assert.ok(bin.getConversation(db, A) && bin.getConversation(db, B));
    assert.strictEqual(countMsgs(A), 3);
    assert.strictEqual(convCountBeforeDelete - 1, countOf(`SELECT count(*) c FROM ai_conversations`));
  });

  await t("D14+15. global agents, budgets, model catalog, ledger, memory, evidence untouched", () => {
    assert.strictEqual(globalSnap(), globalBefore);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_agents WHERE id = ?`, AGENT), 1);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_agents`), agentRowsBefore + 1);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_usage_ledger`), aiLedgerCountBefore, "usage ledger is a financial audit trail and is preserved");
  });

  await t("D16. PRAGMA foreign_key_check returns zero rows; integrity_check ok", () => {
    assert.strictEqual((db.prepare(`PRAGMA foreign_key_check`).all() as any[]).length, 0);
    assert.strictEqual((db.prepare(`PRAGMA integrity_check`).get() as any).integrity_check, "ok");
    assert.strictEqual(countOf(`SELECT count(*) c FROM sqlite_temp_master WHERE name = '_bin_delete_tasks'`), 0, "temp table cleaned up");
  });

  await t("D17. direct URL of the deleted conversation has not-found semantics (no replacement created)", async () => {
    const meta = await oneRoute.GET(new Request("http://x"), ctx(D));
    assert.strictEqual(meta.status, 404);
    const imp = await impactRoute.GET(new Request("http://x"), ctx(D));
    assert.strictEqual(imp.status, 404);
    assert.strictEqual((await stateApi(D, { action: "RESTORE" })).status, 404);
    assert.strictEqual((await del(D, { confirm: true, conversationId: D })).status, 404);
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, D), 0);
  });

  await t("D18. Bin count decreases by exactly one", async () => {
    assert.strictEqual(binCountBeforeDelete, 1);
    assert.strictEqual((await listApi("binned")).body.length, binCountBeforeDelete - 1);
    assert.ok(!(await listApi("binned")).body.some((c: any) => c.id === D));
  });

  await t("D19+20. permanent delete used zero AI/model calls and never touched the operational DB", () => {
    assert.strictEqual(countOf(`SELECT count(*) c FROM ai_usage_ledger`), aiLedgerCountBefore);
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_usage_ledger`).get() as any).c, aiLedgerCountBefore);
    assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(TEST_DB));
    assert.notStrictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(OPERATIONAL_AI_DB));
  });

  await t("18. ZOHO WRITE = 0 (security guard rejects writes) and zero AI/model usage", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.throws(() => assertZohoReadOnlyRequest("https://www.zohoapis.com/books/v3/invoices", m), /ZOHO READ-ONLY SECURITY POLICY/);
    }
    assert.strictEqual((db.prepare(`SELECT count(*) c FROM ai_usage_ledger`).get() as any).c, aiLedgerCountBefore);
  });

  // ================= BULK CHAT MANAGEMENT (separate isolated temp DB) =================
  aiDb.closeAiDatabase();
  const BULK_DIR = path.join(TEMP_ROOT, "bulkdata");
  fs.mkdirSync(BULK_DIR);
  const BULK_DB = path.join(BULK_DIR, "ai_workspace.db");
  assert.ok(BULK_DB.startsWith(TEMP_ROOT) && path.resolve(BULK_DB) !== path.resolve(OPERATIONAL_AI_DB));
  process.env.AI_WORKSPACE_DB_PATH = BULK_DB;
  const bulk = await import("../app/lib/ai/conversation-bulk");
  const bulkRoute = await import("../app/api/ai/conversation-bulk/route");
  const bdb = aiDb.getAiDatabase();
  assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(BULK_DB));

  const bnow = Date.now();
  const biso = (n: number) => new Date(bnow + n * 1000).toISOString();
  const BAGENT = "bagent_" + crypto.randomUUID();
  bdb.prepare(`INSERT INTO ai_agents (id, name, role, department, level, status, risk_class, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(BAGENT, "Bulk Agent", "ANALYST", "ACCOUNTS", "SPECIALIST", "ACTIVE", "STANDARD", "TEST", biso(0), biso(0));
  const bc = (sql: string, ...a: any[]) => (bdb.prepare(sql).get(...a) as any).c as number;
  let seq = 0;
  const mkFull = (title: string, status: "ACTIVE" | "BINNED") => {
    const id = crypto.randomUUID(); const n = ++seq * 10;
    bdb.prepare(`INSERT INTO ai_conversations (id, title, user_identifier, created_at, updated_at, status, binned_at, binned_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, title, "owner", biso(n), biso(n), status, status === "BINNED" ? biso(n + 1) : null, status === "BINNED" ? "OWNER" : null);
    for (const r of ["user", "assistant"]) bdb.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at) VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(), id, r, `${title} ${r}`, "CEO", biso(n + 2));
    const run = "brun_" + crypto.randomUUID();
    bdb.prepare(`INSERT INTO ai_runs (id, conversation_id, status, started_at) VALUES (?,?,?,?)`).run(run, id, "COMPLETED", biso(n));
    const t1 = "bt1_" + crypto.randomUUID(), t2 = "bt2_" + crypto.randomUUID();
    const mkT = (tid: string, parent: string | null) => bdb.prepare(`INSERT INTO ai_tasks (id, parent_task_id, run_id, objective, requested_by, priority, status, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(tid, parent, run, "obj", "CEO", "HIGH", "COMPLETED", biso(n));
    mkT(t1, null); mkT(t2, t1);
    bdb.prepare(`INSERT INTO ai_task_budgets (id, task_id, agent_id, created_at) VALUES (?,?,?,?)`).run("btb_" + id, t1, BAGENT, biso(n));
    const rr = (table: string, cols: string, vals: any[]) => bdb.prepare(`INSERT INTO ${table} (${cols}) VALUES (${vals.map(() => "?").join(",")})`).run(...vals);
    rr("ai_tool_calls", "id, run_id, tool_name, tool_class, input_summary, status", ["btc_" + id, run, "t", "READ_ONLY", "i", "DONE"]);
    rr("ai_approvals", "id, run_id, action_type, requested_payload_summary, status, requested_at", ["bap_" + id, run, "a", "p", "PENDING", biso(n)]);
    rr("ai_audit_events", "id, run_id, event_type, details, created_at", ["bae_" + id, run, "e", "d", biso(n)]);
    rr("ai_agent_handoffs", "id, run_id, task_id, source_agent_id, target_agent_id, status, created_at", ["bho_" + id, run, t1, BAGENT, BAGENT, "DONE", biso(n)]);
    rr("ai_tool_executions", "id, run_id, agent_id, tool_code, classification, input_summary, status, started_at", ["bte_" + id, run, BAGENT, "tool", "READ_ONLY", "i", "DONE", biso(n)]);
    return id;
  };
  const st = (id: string) => (bdb.prepare(`SELECT status FROM ai_conversations WHERE id = ?`).get(id) as any)?.status as string | undefined;
  const exists = (id: string) => bc(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, id) === 1;
  const bpost = async (body: any) => {
    const res = await bulkRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };
  const bget = async (scope: string) => {
    const res = await bulkRoute.GET(new Request(`http://x/api/ai/conversation-bulk?scope=${scope}`));
    return { status: res.status, body: (await res.json()) as any };
  };
  const bglobal = () => JSON.stringify({
    agents: bdb.prepare(`SELECT * FROM ai_agents ORDER BY id`).all(),
    periods: bdb.prepare(`SELECT * FROM ai_budget_periods ORDER BY id`).all(),
    models: bdb.prepare(`SELECT * FROM model_cost_catalog ORDER BY 1`).all(),
    ledger: bdb.prepare(`SELECT * FROM ai_usage_ledger ORDER BY id`).all(),
    memory: bdb.prepare(`SELECT * FROM ai_memory_entries ORDER BY id`).all(),
    evidence: bdb.prepare(`SELECT * FROM ai_evidence_index ORDER BY id`).all(),
  });

  const ACT1 = mkFull("Active One", "ACTIVE"), ACT2 = mkFull("Active Two", "ACTIVE");
  const BIN1 = mkFull("Binned One", "BINNED"), BIN2 = mkFull("Binned Two", "BINNED"), BIN3 = mkFull("Binned Three", "BINNED");
  const globalB = bglobal();
  const ledgerB = bc(`SELECT count(*) c FROM ai_usage_ledger`);
  const realFileTables = new Set(["ai_conversations"]);

  await t("BK1. Move All to Bin moves every ACTIVE chat to BINNED (state change, not copy)", async () => {
    const before = bc(`SELECT count(*) c FROM ai_conversations`);
    const r = await bpost({ action: "MOVE_ALL_TO_BIN" });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.changed, 2);
    assert.strictEqual(st(ACT1), "BINNED"); assert.strictEqual(st(ACT2), "BINNED");
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_conversations`), before, "no copies created");
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_conversations WHERE status='ACTIVE'`), 0);
  });
  await t("BK2. Move All to Bin preserves messages and runs", () => {
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_messages WHERE conversation_id IN (?,?)`, ACT1, ACT2), 4);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_runs WHERE conversation_id IN (?,?)`, ACT1, ACT2), 2);
  });
  await t("BK3. Restore All brings every BINNED chat back to ACTIVE with binned_at cleared", async () => {
    const r = await bpost({ action: "RESTORE_ALL" });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.changed, 5);
    for (const id of [ACT1, ACT2, BIN1, BIN2, BIN3]) assert.strictEqual(st(id), "ACTIVE");
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_conversations WHERE binned_at IS NOT NULL`), 0);
  });
  await t("BK4. Restore All preserves messages/runs and counts", () => {
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_messages`), 10);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_runs`), 5);
  });
  await t("BK5. Move All / Restore All on empty sets are safe no-ops", async () => {
    assert.strictEqual((await bpost({ action: "RESTORE_ALL" })).body.changed, 0);
    await bpost({ action: "MOVE_ALL_TO_BIN" });
    assert.strictEqual((await bpost({ action: "MOVE_ALL_TO_BIN" })).body.changed, 0);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_conversations WHERE status='BINNED'`), 5);
  });
  // leave ACT1/ACT2 active again, BIN1-3 binned
  await bpost({ action: "RESTORE_ALL" });
  bdb.prepare(`UPDATE ai_conversations SET status='BINNED', binned_at=?, binned_by='OWNER' WHERE id IN (?,?,?)`).run(biso(999), BIN1, BIN2, BIN3);

  await t("BK6. Impact preview (binned) is read-only and reports exact counts + fingerprint", async () => {
    const before = bc(`SELECT count(*) c FROM ai_conversations`);
    const r = await bget("binned");
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.counts.conversations, r.body.counts.messages, r.body.counts.runs, r.body.counts.tasks], [3, 6, 3, 6]);
    assert.strictEqual(r.body.otherScopedRows, 3 * 6, JSON.stringify(r.body));
    assert.match(r.body.fingerprint, /^[0-9a-f]{64}$/);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_conversations`), before);
  });
  await t("BK7. Impact preview rejects invalid scope", async () => {
    assert.strictEqual((await bget("all")).status, 400);
  });
  const plan0 = bulk.computePlan(bdb, "BINNED");
  const okReq = (extra: any = {}) => ({ action: "DELETE_ALL_PERMANENTLY", confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan0.fingerprint, ...extra });
  let expMsgs = 10;
  const nothingDeleted = () => [BIN1, BIN2, BIN3, ACT1, ACT2].every(exists) && bc(`SELECT count(*) c FROM ai_messages`) === expMsgs;

  await t("BK8. Delete All is refused without confirm:true", async () => {
    const r = await bpost(okReq({ confirm: undefined }));
    assert.strictEqual(r.status, 400); assert.ok(nothingDeleted());
  });
  await t("BK9. Delete All is refused without / with wrong typed phrase (case-sensitive)", async () => {
    for (const p of [undefined, "", "delete all", "DELETE", "DELETE ALL "]) {
      assert.strictEqual((await bpost(okReq({ typedConfirmation: p }))).status, 400);
    }
    assert.ok(nothingDeleted());
  });
  await t("BK10. Delete All is refused with missing or stale fingerprint", async () => {
    assert.strictEqual((await bpost(okReq({ expectedFingerprint: undefined }))).status, 409);
    assert.strictEqual((await bpost(okReq({ expectedFingerprint: "0".repeat(64) }))).status, 409);
    assert.ok(nothingDeleted());
  });
  await t("BK11. No backup directory/file is created by refused attempts", () => {
    assert.ok(!fs.existsSync(path.join(BULK_DIR, "backups")), "refusals must not create backups");
  });
  await t("BK12. Backup failure aborts: nothing deleted", () => {
    const r = bulk.bulkDeleteBinnedPermanently(bdb, { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan0.fingerprint }, {}, { createBackup: () => { throw new Error("disk full (injected)"); } });
    assert.ok(!r.ok && (r as any).code === "BACKUP_FAILED"); assert.ok(nothingDeleted());
  });
  await t("BK13. Missing backup proof aborts: nothing deleted", () => {
    const r = bulk.executeBulkDeleteWithProof(bdb, plan0, null);
    assert.ok(!r.ok && (r as any).code === "BACKUP_PROOF_MISSING"); assert.ok(nothingDeleted());
  });
  await t("BK14. Backup SHA256 mismatch (tampered backup) aborts: nothing deleted", () => {
    const r = bulk.bulkDeleteBinnedPermanently(bdb, { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan0.fingerprint }, {}, {
      afterBackup: p => { fs.chmodSync(p.backupPath, 0o644); fs.appendFileSync(p.backupPath, "tamper"); },
    });
    assert.ok(!r.ok && (r as any).code === "BACKUP_VERIFICATION_FAILED", JSON.stringify(r)); assert.ok(nothingDeleted());
  });
  await t("BK15. Manifest fingerprint mismatch aborts: nothing deleted", () => {
    const r = bulk.bulkDeleteBinnedPermanently(bdb, { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan0.fingerprint }, {}, {
      afterBackup: p => {
        fs.chmodSync(p.manifestPath, 0o644);
        const m = JSON.parse(fs.readFileSync(p.manifestPath, "utf8")); m.pre_delete_fingerprint = "f".repeat(64);
        fs.writeFileSync(p.manifestPath, JSON.stringify(m));
      },
    });
    assert.ok(!r.ok && (r as any).code === "BACKUP_VERIFICATION_FAILED", JSON.stringify(r)); assert.ok(nothingDeleted());
  });
  await t("BK16. Race: Bin changed after backup (new chat binned) aborts via fingerprint recheck", () => {
    let extra = "";
    const r = bulk.bulkDeleteBinnedPermanently(bdb, { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan0.fingerprint }, {}, {
      afterBackup: () => { extra = mkFull("Late Arrival", "BINNED"); },
    });
    assert.ok(!r.ok && (r as any).code === "FINGERPRINT_CHANGED", JSON.stringify(r));
    expMsgs = 12; // the late-arrival fixture (2 messages) now exists and must survive
    assert.ok(nothingDeleted() && exists(extra));
    // remove the late fixture by restoring it to ACTIVE-free state: bin it back out of the way
    bdb.prepare(`UPDATE ai_conversations SET status='ACTIVE', binned_at=NULL, binned_by=NULL WHERE id = ?`).run(extra);
  });
  await t("BK17. Race: a binned chat restored after preview aborts (stale fingerprint)", () => {
    bdb.prepare(`UPDATE ai_conversations SET status='ACTIVE', binned_at=NULL, binned_by=NULL WHERE id = ?`).run(BIN3);
    const r = bulk.bulkDeleteBinnedPermanently(bdb, { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan0.fingerprint });
    assert.ok(!r.ok && (r as any).code === "STALE_PREVIEW"); assert.ok(nothingDeleted());
    bdb.prepare(`UPDATE ai_conversations SET status='BINNED', binned_at=?, binned_by='OWNER' WHERE id = ?`).run(biso(999), BIN3);
  });
  await t("BK18. Injected mid-transaction failure rolls back everything", () => {
    bdb.exec(`CREATE TEMP TRIGGER bk_fail BEFORE DELETE ON ai_conversations BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    const plan = bulk.computePlan(bdb, "BINNED");
    const r = bulk.bulkDeleteBinnedPermanently(bdb, { confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: plan.fingerprint });
    bdb.exec(`DROP TRIGGER bk_fail`);
    assert.ok(!r.ok && (r as any).code === "FAILED", JSON.stringify(r));
    assert.ok(nothingDeleted());
    assert.strictEqual(bulk.computePlan(bdb, "BINNED").fingerprint, plan.fingerprint, "state identical after rollback");
    assert.strictEqual(bc(`SELECT count(*) c FROM sqlite_temp_master WHERE name LIKE '_bulk_delete_%'`), 0);
  });

  const planFinal = bulk.computePlan(bdb, "BINNED");
  const activeFpBefore = bulk.computePlan(bdb, "ACTIVE").fingerprint;
  const activeMsgsBefore = bc(`SELECT count(*) c FROM ai_messages WHERE conversation_id IN (?,?)`, ACT1, ACT2);
  const backupDirBefore = fs.existsSync(path.join(BULK_DIR, "backups")) ? fs.readdirSync(path.join(BULK_DIR, "backups")) : [];
  let delRes: any;
  await t("BK19. Successful Delete All Permanently (confirm + phrase + fingerprint) reports exact counts", async () => {
    const r = await bpost(okReq({ expectedFingerprint: planFinal.fingerprint }));
    delRes = r;
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.deleted, true);
    assert.deepStrictEqual([r.body.counts.conversations, r.body.counts.messages, r.body.counts.runs, r.body.counts.tasks], [3, 6, 3, 6]);
  });
  await t("BK20. Delete All is Bin-only: all BINNED chats and their dependents are gone", () => {
    for (const id of [BIN1, BIN2, BIN3]) assert.ok(!exists(id));
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_messages WHERE conversation_id IN (?,?,?)`, BIN1, BIN2, BIN3), 0);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_runs WHERE conversation_id IN (?,?,?)`, BIN1, BIN2, BIN3), 0);
    for (const tbl of ["ai_tool_calls", "ai_approvals", "ai_audit_events", "ai_agent_handoffs", "ai_tool_executions", "ai_task_budgets"]) {
      assert.strictEqual(bc(`SELECT count(*) c FROM ${tbl}`), 3, `${tbl} must keep only the 3 active chats' rows`);
    }
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_tasks`), 6);
  });
  await t("BK21. ACTIVE chats are untouched (identity, messages, fingerprint)", () => {
    assert.ok(exists(ACT1) && exists(ACT2));
    assert.strictEqual(st(ACT1), "ACTIVE"); assert.strictEqual(st(ACT2), "ACTIVE");
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_messages WHERE conversation_id IN (?,?)`, ACT1, ACT2), activeMsgsBefore);
    assert.strictEqual(bulk.computePlan(bdb, "ACTIVE").fingerprint, activeFpBefore);
  });
  await t("BK22. Global records (agents, budgets, models, ledger, memory, evidence) untouched", () => {
    assert.strictEqual(bglobal(), globalB);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_usage_ledger`), ledgerB);
  });
  await t("BK23. Backup exists in the temp dir only, with sha256 matching and read-only integrity", () => {
    const dir = path.join(BULK_DIR, "backups");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".db") && !backupDirBefore.includes(f));
    assert.ok(files.length >= 1);
    const f = path.join(dir, files[files.length - 1]);
    assert.ok(f.startsWith(TEMP_ROOT) && !f.startsWith(path.join(PROJECT_ROOT, "data")));
    assert.strictEqual(bulk.sha256File(f), delRes.body.backup.sha256);
    const ro = new DatabaseSync(f, { readOnly: true });
    try { assert.strictEqual((ro.prepare(`PRAGMA integrity_check`).get() as any).integrity_check, "ok"); } finally { ro.close(); }
  });
  await t("BK24. Backup is WAL-consistent: it contains the full pre-delete Bin and ACTIVE chats", () => {
    const f = path.join(BULK_DIR, "backups", delRes.body.backup.file);
    const ro = new DatabaseSync(f, { readOnly: true });
    try {
      const n = (s: string) => (ro.prepare(s).get() as any).c as number;
      assert.strictEqual(n(`SELECT count(*) c FROM ai_conversations WHERE status='BINNED'`), 3);
      assert.strictEqual(n(`SELECT count(*) c FROM ai_conversations`), 6);
      assert.strictEqual(n(`SELECT count(*) c FROM ai_messages`), 12);
      assert.strictEqual(bulk.computePlan(ro, "BINNED").fingerprint, planFinal.fingerprint);
    } finally { ro.close(); }
  });
  await t("BK25. Manifest has every required field and matches the operation", () => {
    const m = JSON.parse(fs.readFileSync(path.join(BULK_DIR, "backups", delRes.body.backup.manifest), "utf8"));
    for (const k of ["operation", "created_at", "source_db", "backup_path", "backup_sha256", "conversation_count", "conversation_ids", "message_count", "run_count", "task_count", "other_impacted_rows", "pre_delete_fingerprint", "verification"]) assert.ok(k in m, `manifest missing ${k}`);
    assert.strictEqual(m.conversation_count, 3);
    assert.deepStrictEqual([...m.conversation_ids].sort(), [BIN1, BIN2, BIN3].sort());
    assert.strictEqual(m.pre_delete_fingerprint, planFinal.fingerprint);
    assert.strictEqual(m.backup_sha256, delRes.body.backup.sha256);
  });
  await t("BK26. API response exposes backup file name + hash but no filesystem path", () => {
    const s = JSON.stringify(delRes.body);
    assert.ok(!s.includes(TEMP_ROOT) && !s.includes("/") , s);
  });
  await t("BK27. After delete: foreign_key_check clean, integrity ok, no temp tables left", () => {
    assert.strictEqual((bdb.prepare(`PRAGMA foreign_key_check`).all() as any[]).length, 0);
    assert.strictEqual((bdb.prepare(`PRAGMA integrity_check`).get() as any).integrity_check, "ok");
    assert.strictEqual(bc(`SELECT count(*) c FROM sqlite_temp_master WHERE name LIKE '_bulk_delete_%'`), 0);
  });
  await t("BK28. Empty Bin: Delete All is a safe no-op (ACTIVE chats survive, no backup made)", async () => {
    const backupsBefore = fs.readdirSync(path.join(BULK_DIR, "backups")).length;
    const fp = (await bget("binned")).body.fingerprint;
    for (const fpv of [fp, undefined, "x"]) {
      const r = await bpost({ action: "DELETE_ALL_PERMANENTLY", confirm: true, typedConfirmation: "DELETE ALL", expectedFingerprint: fpv });
      assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, "EMPTY_BIN");
    }
    assert.ok(exists(ACT1) && exists(ACT2));
    assert.strictEqual(fs.readdirSync(path.join(BULK_DIR, "backups")).length, backupsBefore, "no backup for a no-op");
    assert.strictEqual((await bget("binned")).body.counts.conversations, 0);
  });
  await t("BK29. No HTTP DELETE handler; unknown actions rejected; bulk SQL deletes only scoped tables via id-lists", async () => {
    assert.strictEqual((bulkRoute as any).DELETE, undefined);
    assert.strictEqual((await bpost({ action: "WIPE_EVERYTHING" })).status, 400);
    assert.strictEqual((await bpost({})).status, 400);
    const src = fs.readFileSync(path.join(PROJECT_ROOT, "app/lib/ai/conversation-bulk.ts"), "utf8");
    const tables = [...src.matchAll(/DELETE FROM (\w+)/g)].map(m => m[1]).sort();
    assert.deepStrictEqual(tables, ["ai_agent_handoffs", "ai_approvals", "ai_audit_events", "ai_conversations", "ai_messages", "ai_runs", "ai_task_budgets", "ai_tasks", "ai_tool_calls", "ai_tool_executions"].sort());
    for (const m of src.matchAll(/DELETE FROM \w+[^;`]*/g)) assert.ok(/WHERE/.test(m[0]), `unscoped delete: ${m[0]}`);
    assert.ok(!fs.readFileSync(path.join(PROJECT_ROOT, "app/api/ai/conversation-bulk/route.ts"), "utf8").match(/DELETE\s+FROM/i));
    assert.ok(realFileTables.has("ai_conversations"));
  });
  await t("BK30. Bulk features used zero AI/model calls, zero Zoho writes, and never touched the operational DB", () => {
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_usage_ledger`), ledgerB);
    assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(BULK_DB));
    assert.notStrictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(OPERATIONAL_AI_DB));
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.throws(() => assertZohoReadOnlyRequest("https://www.zohoapis.com/books/v3/invoices", m), /ZOHO READ-ONLY SECURITY POLICY/);
  });

  // ================= SINGLE PERMANENT DELETE: verified shared core (temp DB only) =================
  const SBK_DIR = path.join(BULK_DIR, "backups");
  const S1 = mkFull("Single Target", "BINNED");
  const S2 = mkFull("Other Binned Control", "BINNED");
  const S3 = mkFull("Single Via API", "BINNED");
  const S4 = mkFull("Late Failure Target", "BINNED");
  const S5 = mkFull("WAL Target", "BINNED");
  const SACT = ACT1; // ACTIVE control conversation
  const fpOf = (id: string) => bin.getDeleteImpact(bdb, id)!.fingerprint;
  const snapOf = (id: string, scope: "ACTIVE" | "BINNED" = "BINNED") => JSON.stringify(bulk.computePlan(bdb, scope, [id]));
  const sreq = (id: string, extra: any = {}) => ({ confirm: true, conversationId: id, previewFingerprint: fpOf(id), ...extra });
  const sdel = (id: string, hooks: any = {}, extra: any = {}) => bin.deleteBinnedConversationPermanently(bdb, id, sreq(id, extra), {}, hooks);
  const backupList = () => (fs.existsSync(SBK_DIR) ? fs.readdirSync(SBK_DIR).sort() : []);
  const sGlobal0 = bglobal();
  const sLedger0 = bc(`SELECT count(*) c FROM ai_usage_ledger`);
  const sActive0 = snapOf(SACT, "ACTIVE");
  const s2Snap0 = snapOf(S2);
  const failCode = (r: any) => (r.ok ? "OK" : r.code);
  const dependentRows = (id: string) => ({
    msgs: bc(`SELECT count(*) c FROM ai_messages WHERE conversation_id = ?`, id),
    runs: bc(`SELECT count(*) c FROM ai_runs WHERE conversation_id = ?`, id),
    tasks: bulk.computePlan(bdb, "BINNED", [id]).counts.tasks,
    other: bulk.computePlan(bdb, "BINNED", [id]).otherScopedRows,
  });
  const s1Pre = { ...dependentRows(S1), plan: bulk.computePlan(bdb, "BINNED", [S1]) };

  await t("SD1. single impact preview returns a deterministic fingerprint (required for delete)", async () => {
    const a = (await (await impactRoute.GET(new Request("http://x"), ctx(S1))).json()) as any;
    const b = (await (await impactRoute.GET(new Request("http://x"), ctx(S1))).json()) as any;
    assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
    assert.strictEqual(a.fingerprint, b.fingerprint);
    assert.notStrictEqual(a.fingerprint, fpOf(S2), "different conversations => different fingerprints");
    assert.strictEqual(a.messageCount, 2); assert.strictEqual(a.runCount, 1); assert.strictEqual(a.taskCount, 2);
  });
  await t("SD2. missing/empty/non-string fingerprint is rejected (HTTP 400), nothing deleted, no backup made", async () => {
    const before = snapOf(S1), bl = backupList();
    for (const fpv of [undefined, "", null, 123]) {
      const r = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: fpv });
      assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, "PREVIEW_REQUIRED");
    }
    assert.strictEqual(snapOf(S1), before); assert.deepStrictEqual(backupList(), bl);
  });
  await t("SD3. wrong fingerprint / wrong target are rejected with no fallback to any other delete", async () => {
    const before = snapOf(S1), bl = backupList();
    const wrong = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: "0".repeat(64) });
    assert.strictEqual(wrong.status, 409); assert.strictEqual(wrong.body.code, "STALE_PREVIEW");
    const otherFp = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: fpOf(S2) });
    assert.strictEqual(otherFp.status, 409);
    assert.strictEqual((await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S2, previewFingerprint: fpOf(S1) })).status, 400, "mismatched conversationId");
    assert.strictEqual((await stateApi("no-such-id", { action: "DELETE_PERMANENTLY", confirm: true, conversationId: "no-such-id", previewFingerprint: "x" })).status, 404);
    const act = await stateApi(SACT, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: SACT, previewFingerprint: fpOf(SACT) });
    assert.strictEqual(act.status, 409); assert.strictEqual(act.body.code, "NOT_IN_BIN");
    assert.strictEqual((await stateApi(S1, { action: "DELETE_PERMANENTLY", confirmed: true })).status, 400);
    assert.strictEqual(snapOf(S1), before); assert.strictEqual(snapOf(S2), s2Snap0); assert.strictEqual(snapOf(SACT, "ACTIVE"), sActive0);
    assert.deepStrictEqual(backupList(), bl, "refusals create no backup");
  });
  await t("SD4. stale preview: a message added after the preview is rejected", async () => {
    const old = fpOf(S1);
    bdb.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at) VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(), S1, "user", "late message", "CEO", biso(5000));
    const before = snapOf(S1), bl = backupList();
    const r = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: old });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, "STALE_PREVIEW");
    assert.strictEqual(snapOf(S1), before); assert.deepStrictEqual(backupList(), bl);
    assert.notStrictEqual(fpOf(S1), old, "fresh preview differs");
  });
  await t("SD5. stale preview: a task added after the preview is rejected", async () => {
    const old = fpOf(S1);
    const run = (bdb.prepare(`SELECT id FROM ai_runs WHERE conversation_id = ?`).get(S1) as any).id;
    bdb.prepare(`INSERT INTO ai_tasks (id, parent_task_id, run_id, objective, requested_by, priority, status, created_at) VALUES (?,?,?,?,?,?,?,?)`).run("late_task_" + crypto.randomUUID(), null, run, "obj", "CEO", "HIGH", "COMPLETED", biso(5001));
    const before = snapOf(S1);
    const r = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: old });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.code, "STALE_PREVIEW");
    assert.strictEqual(snapOf(S1), before);
  });
  await t("SD6. stale preview: restore / re-bin after the preview is rejected (never deleted)", async () => {
    const old = fpOf(S1);
    assert.strictEqual((await stateApi(S1, { action: "RESTORE" })).status, 200);
    const whileActive = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: old });
    assert.strictEqual(whileActive.status, 409); assert.strictEqual(whileActive.body.code, "NOT_IN_BIN");
    assert.strictEqual((await stateApi(S1, { action: "MOVE_TO_BIN" })).status, 200);
    const rebinned = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: old });
    assert.strictEqual(rebinned.status, 409); assert.strictEqual(rebinned.body.code, "STALE_PREVIEW");
    assert.ok(exists(S1));
  });
  // from here S1 carries one extra message and one extra task; capture the pre-delete graph
  const s1Graph = { ...dependentRows(S1), plan: bulk.computePlan(bdb, "BINNED", [S1]) };
  const s1Ids = (bdb.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ? ORDER BY id`).all(S1) as any[]).map(r => r.id);
  assert.strictEqual(s1Graph.msgs, 3); assert.strictEqual(s1Graph.tasks, 3);
  assert.ok(s1Pre.plan.fingerprint !== s1Graph.plan.fingerprint);
  const intactS1 = () => snapOf(S1) === JSON.stringify(s1Graph.plan);
  const noMoreThan = (n: number) => assert.ok(backupList().length >= n);

  await t("SD7. backup failure aborts: nothing deleted", () => {
    const r = sdel(S1, { createBackup: () => { throw new Error("disk full (injected)"); } });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.ok(intactS1());
  });
  await t("SD8. backup SHA256 mismatch aborts: nothing deleted", () => {
    const r = sdel(S1, { afterBackup: (p: any) => { fs.chmodSync(p.backupPath, 0o644); fs.appendFileSync(p.backupPath, "tamper"); } });
    assert.strictEqual(failCode(r), "BACKUP_VERIFICATION_FAILED"); assert.ok(intactS1());
  });
  await t("SD9. manifest failure (cannot write / tampered) aborts: nothing deleted", () => {
    let r: any = bin.deleteBinnedConversationPermanently(bdb, S1, sreq(S1), {
      beforeVerify: (p: any) => fs.writeFileSync(p.manifestPath, "squatter"),
    });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /EEXIST|exists/i); assert.ok(intactS1());
    r = sdel(S1, { afterBackup: (p: any) => {
      fs.chmodSync(p.manifestPath, 0o644);
      const m = JSON.parse(fs.readFileSync(p.manifestPath, "utf8")); m.pre_delete_fingerprint = "f".repeat(64);
      fs.writeFileSync(p.manifestPath, JSON.stringify(m));
    } });
    assert.strictEqual(failCode(r), "BACKUP_VERIFICATION_FAILED"); assert.ok(intactS1());
  });
  const withBackupMutation = (fn: (p: any) => void) =>
    bin.deleteBinnedConversationPermanently(bdb, S1, sreq(S1), { beforeVerify: fn });
  await t("SD10. backup that cannot be re-opened read-only aborts", () => {
    const r: any = withBackupMutation(p => fs.writeFileSync(p.backupPath, "this is not a sqlite database"));
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /not a database|malformed|integrity/i); assert.ok(intactS1());
  });
  await t("SD11. backup failing integrity_check aborts", () => {
    const r: any = withBackupMutation(p => {
      const fd = fs.openSync(p.backupPath, "r+");
      try { fs.writeSync(fd, Buffer.alloc(3000, 0xff), 0, 3000, 8192); } finally { fs.closeSync(fd); }
    });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /integrity|malformed|corrupt|not a database|disk image/i, r.message); assert.ok(intactS1());
  });
  await t("SD12. backup failing foreign_key_check aborts", () => {
    const r: any = withBackupMutation(p => {
      const w = new DatabaseSync(p.backupPath);
      try { w.exec(`PRAGMA foreign_keys = OFF; DELETE FROM ai_conversations WHERE id = '${S1}'`); } finally { w.close(); }
    });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /foreign_key_check/); assert.ok(intactS1());
  });
  await t("SD13. target conversation missing in backup aborts", () => {
    const r: any = withBackupMutation(p => {
      const w = new DatabaseSync(p.backupPath);
      try { w.exec(`UPDATE ai_conversations SET status = 'ACTIVE' WHERE id = '${S1}'`); } finally { w.close(); }
    });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /missing from backup/); assert.ok(intactS1());
  });
  await t("SD14. message/run/task/dependent count mismatch in backup aborts", () => {
    const r: any = withBackupMutation(p => {
      const w = new DatabaseSync(p.backupPath);
      try { w.exec(`DELETE FROM ai_messages WHERE id = (SELECT id FROM ai_messages WHERE conversation_id = '${S1}' LIMIT 1)`); } finally { w.close(); }
    });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /counts/); assert.ok(intactS1());
  });
  await t("SD15. backup fingerprint mismatch aborts", () => {
    const r: any = withBackupMutation(p => {
      const w = new DatabaseSync(p.backupPath);
      try { w.exec(`UPDATE ai_conversations SET title = 'tampered title' WHERE id = '${S1}'`); } finally { w.close(); }
    });
    assert.strictEqual(failCode(r), "BACKUP_FAILED"); assert.match(r.message, /fingerprint/); assert.ok(intactS1());
  });
  await t("SD15b. source changed between fingerprint check and delete aborts (race recheck under write lock)", () => {
    let late = "";
    const r = sdel(S1, { afterBackup: () => {
      bdb.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at) VALUES (?,?,?,?,?,?)`).run("racemsg_" + crypto.randomUUID(), S1, "user", "race", "CEO", biso(6000));
    } });
    assert.strictEqual(failCode(r), "FINGERPRINT_CHANGED");
    assert.ok(exists(S1));
    bdb.prepare(`DELETE FROM ai_messages WHERE id LIKE 'racemsg_%'`).run();
    assert.ok(intactS1(), "state restored to the validated graph" + late);
  });

  const preList = backupList();
  const rec: any = {};
  await t("SD16. valid backup allows delete (single, Bin-only, ONE chat)", () => {
    const r = sdel(S1, {
      afterBackup: (p: any) => {
        rec.targetStillInSource = exists(S1);
        rec.msgsStillInSource = dependentRows(S1).msgs;
        rec.backupExistedBeforeTxn = fs.existsSync(p.backupPath) && fs.existsSync(p.manifestPath);
        rec.proof = p;
      },
    });
    assert.ok(r.ok, JSON.stringify(r));
    rec.result = r;
    assert.ok(!exists(S1));
    assert.strictEqual(dependentRows(S1).msgs, 0); assert.strictEqual(dependentRows(S1).runs, 0);
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_tasks WHERE run_id IN (SELECT id FROM ai_runs WHERE conversation_id = ?)`, S1), 0);
    // the API path (single chat via HTTP) too, receipt without any filesystem path
    return (async () => {
      const api = await stateApi(S3, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S3, previewFingerprint: fpOf(S3) });
      assert.strictEqual(api.status, 200, JSON.stringify(api.body));
      assert.ok(!exists(S3));
      assert.ok(!JSON.stringify(api.body).includes("/"), "API receipt must not expose a filesystem path");
      assert.match(api.body.backup.sha256, /^[0-9a-f]{64}$/);
    })();
  });
  await t("SD17. backup (and manifest) existed, verified, BEFORE the destructive transaction", () => {
    assert.strictEqual(rec.backupExistedBeforeTxn, true);
    assert.strictEqual(rec.targetStillInSource, true, "target still present in source when backup completed");
    assert.strictEqual(rec.msgsStillInSource, s1Graph.msgs);
    assert.ok(backupList().length >= preList.length + 2);
  });
  await t("SD18. manifest names exactly the single conversation and operation", () => {
    const m = JSON.parse(fs.readFileSync(rec.proof.manifestPath, "utf8"));
    assert.strictEqual(m.operation, "DELETE_SINGLE_BINNED_CONVERSATION");
    for (const k of ["created_at", "source_db_path", "backup_path", "backup_sha256", "conversation_id", "conversation_title", "conversation_status", "message_count", "run_count", "task_count", "other_impacted_rows", "source_size_bytes", "backup_size_bytes", "pre_delete_fingerprint"]) assert.ok(k in m, `manifest missing ${k}`);
    assert.deepStrictEqual(m.conversation_ids, [S1]);
    assert.strictEqual(m.conversation_id, S1); assert.strictEqual(m.conversation_title, "Single Target"); assert.strictEqual(m.conversation_status, "BINNED");
    assert.strictEqual(m.conversation_count, 1);
    assert.strictEqual(m.message_count, s1Graph.msgs); assert.strictEqual(m.run_count, s1Graph.runs); assert.strictEqual(m.task_count, s1Graph.tasks);
    assert.strictEqual(m.other_impacted_rows.total, s1Graph.other);
    assert.strictEqual(m.pre_delete_fingerprint, s1Graph.plan.fingerprint);
    assert.strictEqual(m.backup_sha256, bulk.sha256File(rec.proof.backupPath));
    assert.ok(m.source_size_bytes > 0 && m.backup_size_bytes > 0);
  });
  const openBk = () => new DatabaseSync(rec.proof.backupPath, { readOnly: true });
  await t("SD19. backup contains the pre-delete messages (exact ids)", () => {
    const ro = openBk();
    try {
      const ids = (ro.prepare(`SELECT id FROM ai_messages WHERE conversation_id = ? ORDER BY id`).all(S1) as any[]).map(r => r.id);
      assert.deepStrictEqual(ids, s1Ids);
      assert.strictEqual((ro.prepare(`SELECT status FROM ai_conversations WHERE id = ?`).get(S1) as any).status, "BINNED");
      assert.strictEqual((ro.prepare(`PRAGMA integrity_check`).get() as any).integrity_check, "ok");
      assert.strictEqual((ro.prepare(`PRAGMA foreign_key_check`).all() as any[]).length, 0);
    } finally { ro.close(); }
  });
  await t("SD20. backup contains the pre-delete run/task/dependent graph", () => {
    const ro = openBk();
    try {
      const p = bulk.computePlan(ro, "BINNED", [S1]);
      assert.deepStrictEqual(p.counts, s1Graph.plan.counts);
      assert.strictEqual(p.fingerprint, s1Graph.plan.fingerprint);
      assert.strictEqual(p.counts.runs, 1); assert.strictEqual(p.counts.tasks, 3); assert.strictEqual(p.otherScopedRows, s1Graph.other);
    } finally { ro.close(); }
  });
  await t("SD21. ACTIVE control chat and the other BINNED chat are untouched", () => {
    assert.strictEqual(snapOf(SACT, "ACTIVE"), sActive0);
    assert.strictEqual(snapOf(S2), s2Snap0);
    assert.strictEqual(st(S2), "BINNED");
  });
  await t("SD22. global data (agents, budgets, models, memory, evidence) preserved", () => {
    assert.strictEqual(bglobal(), sGlobal0);
  });
  await t("SD23. usage ledger preserved", () => {
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_usage_ledger`), sLedger0);
  });
  const rowTotals = (id: string) => JSON.stringify([
    bc(`SELECT count(*) c FROM ai_conversations WHERE id = ?`, id), dependentRows(id),
    bc(`SELECT count(*) c FROM ai_tool_calls WHERE id = ?`, "btc_" + id), bc(`SELECT count(*) c FROM ai_approvals WHERE id = ?`, "bap_" + id),
    bc(`SELECT count(*) c FROM ai_audit_events WHERE id = ?`, "bae_" + id), bc(`SELECT count(*) c FROM ai_agent_handoffs WHERE id = ?`, "bho_" + id),
    bc(`SELECT count(*) c FROM ai_tool_executions WHERE id = ?`, "bte_" + id), bc(`SELECT count(*) c FROM ai_task_budgets WHERE id = ?`, "btb_" + id),
  ]);
  const s4Before = rowTotals(S4);
  const bl4 = backupList();
  let s4Proof: any = null;
  await t("SD24. late transaction failure rolls back: every target row remains", () => {
    bdb.exec(`CREATE TEMP TRIGGER sd_late_fail BEFORE DELETE ON ai_conversations WHEN old.id = '${S4}' BEGIN SELECT RAISE(ABORT, 'forced late failure'); END`);
    let r: any;
    try { r = sdel(S4, { afterBackup: (p: any) => { s4Proof = p; } }); } finally { bdb.exec(`DROP TRIGGER IF EXISTS sd_late_fail`); }
    assert.strictEqual(failCode(r), "FAILED", JSON.stringify(r));
    assert.strictEqual(rowTotals(S4), s4Before);
    assert.strictEqual(st(S4), "BINNED");
    assert.strictEqual(bc(`SELECT count(*) c FROM sqlite_temp_master WHERE name LIKE '_bulk_delete_%'`), 0);
    assert.strictEqual((bdb.prepare(`PRAGMA foreign_key_check`).all() as any[]).length, 0);
  });
  await t("SD25. backup + manifest retained after the late failure (and valid)", () => {
    assert.ok(s4Proof && fs.existsSync(s4Proof.backupPath) && fs.existsSync(s4Proof.manifestPath));
    assert.ok(backupList().length >= bl4.length + 2);
    const m = JSON.parse(fs.readFileSync(s4Proof.manifestPath, "utf8"));
    assert.strictEqual(m.backup_sha256, bulk.sha256File(s4Proof.backupPath));
    assert.strictEqual(m.conversation_id, S4);
  });
  await t("SD26. backup + manifest retained after success; deleted id is not-found everywhere", async () => {
    assert.ok(fs.existsSync(rec.proof.backupPath) && fs.existsSync(rec.proof.manifestPath));
    assert.strictEqual(bulk.sha256File(rec.proof.backupPath), rec.result.backup.sha256);
    assert.strictEqual((await impactRoute.GET(new Request("http://x"), ctx(S1))).status, 404);
    const again = await stateApi(S1, { action: "DELETE_PERMANENTLY", confirm: true, conversationId: S1, previewFingerprint: "x" });
    assert.strictEqual(again.status, 404);
    assert.strictEqual(st(S2), "BINNED", "a failed/duplicate target lookup never widens into another delete");
  });
  await t("SD27. WAL-backed committed data is captured by the backup", () => {
    const mode = (bdb.prepare(`PRAGMA journal_mode`).get() as any).journal_mode;
    assert.strictEqual(mode, "wal");
    const marker = "wal-marker-" + crypto.randomUUID();
    bdb.prepare(`INSERT INTO ai_messages (id, conversation_id, role, content, agent, created_at) VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(), S5, "user", marker, "CEO", biso(7000));
    const walFile = BULK_DB + "-wal";
    assert.ok(fs.existsSync(walFile) && fs.statSync(walFile).size > 0, "committed data is sitting in the WAL");
    let backupPath = "";
    const r = sdel(S5, { afterBackup: (p: any) => { backupPath = p.backupPath; } });
    assert.ok(r.ok, JSON.stringify(r));
    const ro = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.strictEqual((ro.prepare(`SELECT count(*) c FROM ai_messages WHERE content = ?`).get(marker) as any).c, 1);
    } finally { ro.close(); }
    assert.ok(!exists(S5));
  });
  await t("SD28. no operational DB used: temp DB + temp backup dir only", () => {
    assert.strictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(BULK_DB));
    assert.notStrictEqual(path.resolve(aiDb.getDbFilePath()), path.resolve(OPERATIONAL_AI_DB));
    for (const p of [rec.proof.backupPath, rec.proof.manifestPath, s4Proof.backupPath]) {
      const realP = fs.realpathSync(path.dirname(p));
      const realTemp = fs.realpathSync(TEMP_ROOT);
      assert.ok(realP.startsWith(realTemp) && !realP.startsWith(path.join(PROJECT_ROOT, "data")));
    }
    assert.strictEqual(snapOf(SACT, "ACTIVE"), sActive0);
    assert.strictEqual(snapOf(S2), s2Snap0);
  });
  await t("SD29. single delete made zero AI/model calls (ledger unchanged) and has no network code", () => {
    assert.strictEqual(bc(`SELECT count(*) c FROM ai_usage_ledger`), sLedger0);
    for (const f of ["app/lib/ai/conversation-bin.ts", "app/lib/ai/conversation-bulk.ts"]) {
      const src = fs.readFileSync(path.join(PROJECT_ROOT, f), "utf8");
      assert.ok(!/\bfetch\(|openai|anthropic|generateContent/i.test(src), `${f} must not call any model`);
    }
    const bsrc = fs.readFileSync(path.join(PROJECT_ROOT, "app/lib/ai/conversation-bin.ts"), "utf8");
    assert.deepStrictEqual([...bsrc.matchAll(/DELETE FROM (\w+)/g)].map(m => m[1]), [], "single delete has no private delete SQL; it uses the shared verified core");
  });
  await t("SD30. ZOHO WRITE = 0", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.throws(() => assertZohoReadOnlyRequest("https://www.zohoapis.com/books/v3/invoices", m), /ZOHO READ-ONLY SECURITY POLICY/);
    void noMoreThan;
  });

  aiDb.closeAiDatabase();
}

(async () => {
  try {
    await main();
  } catch (e) {
    failed++;
    console.error("FATAL:", e);
  } finally {
    process.chdir(PROJECT_ROOT);
    try {
      const real = fs.realpathSync(TEMP_ROOT);
      assert.ok(path.basename(real).startsWith("ai-ceo-chat-bin-"));
      fs.rmSync(real, { recursive: true, force: true });
    } catch (e) { failed++; console.error("cleanup failed", e); }
  }
  const hashAfter = sha(OPERATIONAL_AI_DB);
  console.log(`  operational DB: before=${hashBefore} after=${hashAfter}`);
  if (hashBefore !== hashAfter) { failed++; console.error("FAIL: operational DB hash changed"); }
  else console.log("  ✓ operational DB unchanged");
  console.log(`\nCHAT BIN TESTS: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
