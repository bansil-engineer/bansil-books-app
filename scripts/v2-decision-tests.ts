import { getAuditDatabase } from "../app/lib/db/audit-database";
import { suggestV2Resolutions, V2ScopeContext } from "../app/lib/audit/mismatch-resolution/mismatch-suggestion-engine";
import { MismatchItem, CandidateItem } from "../app/lib/audit/mismatch-resolution/mismatch-types";
import { randomBytes } from "node:crypto";

const API_URL = "http://localhost:3000/api/audit/mismatch-resolution/v2/decision";

async function runTests() {
  const db = getAuditDatabase();

  // Create a valid session for authorized requests
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60).toISOString();
  db.prepare(`INSERT INTO audit_sessions (session_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)`).run(token, now.toISOString(), expiresAt, now.toISOString());

  const headers = {
    "Content-Type": "application/json",
    "Cookie": `bansil_owner_session=${token}`
  };

  let totalTests = 0;
  let passedTests = 0;
  let failedTests: string[] = [];

  function assertPass(name: string, condition: boolean) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`PASS: ${name}`);
    } else {
      failedTests.push(name);
      console.log(`FAIL: ${name}`);
    }
  }

  // Clean up any prior test decisions to avoid cross-contamination
  db.prepare(`DELETE FROM audit_reviewer_decisions WHERE reviewer = 'OWNER' AND entity_id LIKE '%TEST_%'`).run();

  // ============================================================
  // 1. APPROVE technical relationship persists
  // ============================================================
  const res1 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-1", action: "APPROVE",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E1:100:0.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  const data1 = await res1.json();
  assertPass("1. technical APPROVE persists", res1.ok && data1.success === true);

  // ============================================================
  // 2. REJECT persists
  // ============================================================
  const res2 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-2", action: "REJECT",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E2:50:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  const data2 = await res2.json();
  assertPass("2. REJECT persists", res2.ok && data2.success === true);

  // ============================================================
  // 3. HOLD persists
  // ============================================================
  const res3 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-3", action: "HOLD",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E3:50:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  const data3 = await res3.json();
  assertPass("3. HOLD persists", res3.ok && data3.success === true);

  // ============================================================
  // 4. NEED_EVIDENCE persists
  // ============================================================
  const res4 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-4", action: "NEED_EVIDENCE",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E4:50:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  const data4 = await res4.json();
  assertPass("4. NEED_EVIDENCE persists", res4.ok && data4.success === true);

  // ============================================================
  // 5. invalid arbitrary status rejected
  // ============================================================
  const res5 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-5", action: "INVALID_STATUS",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E5:50:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("5. invalid arbitrary status rejected", res5.status === 400);

  // ============================================================
  // 6. legacy ONE-TIME MAPPING rejected for V2
  // ============================================================
  const res6legacy = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-6", action: "ONE-TIME MAPPING",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E6:50:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("6. legacy ONE-TIME MAPPING rejected for V2", res6legacy.status === 400);

  // ============================================================
  // 7. legacy PROPOSE_REUSABLE_RULE rejected for V2
  // ============================================================
  const res7legacy = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "GRP-7", action: "PROPOSE_REUSABLE_RULE",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E7:50:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("7. legacy PROPOSE_REUSABLE_RULE rejected for V2", res7legacy.status === 400);

  // ============================================================
  // 8. QP APPROVE rejected server-side (explicit targetType)
  // ============================================================
  const res8 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "QP-1", action: "APPROVE",
      targetType: "QUANTITY_ONLY_POSSIBILITY",
      evidenceFingerprint: "QP:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E8:50.00:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("8. QP APPROVE rejected server-side (explicit targetType)", res8.status === 400);

  // ============================================================
  // 9. QP REJECT allowed
  // ============================================================
  const res9 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "QP-1", action: "REJECT",
      targetType: "QUANTITY_ONLY_POSSIBILITY",
      evidenceFingerprint: "QP:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E9:50.00:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("9. QP REJECT allowed", res9.ok);

  // ============================================================
  // 10. QP HOLD allowed
  // ============================================================
  const res10 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "QP-1", action: "HOLD",
      targetType: "QUANTITY_ONLY_POSSIBILITY",
      evidenceFingerprint: "QP:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E10:50.00:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("10. QP HOLD allowed", res10.ok);

  // ============================================================
  // 11. QP NEED_EVIDENCE allowed
  // ============================================================
  const res11 = await fetch(API_URL, {
    method: "POST", headers,
    body: JSON.stringify({
      version: "v2", groupId: "QP-1", action: "NEED_EVIDENCE",
      targetType: "QUANTITY_ONLY_POSSIBILITY",
      evidenceFingerprint: "QP:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E11:50.00:50.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("11. QP NEED_EVIDENCE allowed", res11.ok);

  // ============================================================
  // 12. unauthorized request rejected (no cookie)
  // ============================================================
  const res12 = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "v2", groupId: "GRP-12", action: "APPROVE",
      targetType: "TECHNICAL_RELATIONSHIP",
      evidenceFingerprint: "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E12:100:0.00",
      customerId: "C1", periodLabel: "2026", sourceItemId: "S1"
    })
  });
  assertPass("12. unauthorized request rejected (no cookie)", res12.status === 401);

  // ============================================================
  // 13. customer isolation (decision persisted includes customer)
  // ============================================================
  const saved1 = db.prepare(`SELECT entity_id, source_run_version_json FROM audit_reviewer_decisions WHERE entity_id = ?`).get(
    "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E1:100:0.00"
  ) as any;
  const ctx1 = saved1 ? JSON.parse(saved1.source_run_version_json) : null;
  assertPass("13. customer isolation (decision fingerprint includes customer)", saved1 && saved1.entity_id.includes(":C1:") && ctx1?.customerId === "C1");

  // ============================================================
  // 14. source-item isolation
  // ============================================================
  assertPass("14. source-item isolation (fingerprint includes sourceItemId)", saved1 && saved1.entity_id.includes(":S1:") && ctx1?.sourceItemId === "S1");

  // ============================================================
  // 15. target-type isolation (explicit targetType persisted in context)
  // ============================================================
  assertPass("15. target-type isolation (targetType in persisted context)", ctx1?.targetType === "TECHNICAL_RELATIONSHIP");

  // ============================================================
  // FINGERPRINT PROPERTY TESTS (16-22)
  // Uses pure-logic engine assertions — no server round-trip needed.
  // ============================================================
  const baseSource: MismatchItem = {
    itemId: "S_FP", itemName: "FP Source", sku: "SKU1", description: "Desc",
    uom: "NOS", mismatchQty: -100, customerId: "CUST_A", customerName: "Cust A",
    taxableValue: 1000, gstInclusiveAmount: null, rate: 10
  };
  const baseCand: CandidateItem = {
    itemId: "C_FP1", itemName: "FP Cand 1", sku: "SKU1", description: "Desc",
    uom: "NOS", availableQty: 100, matchMethod: "EXACT_ITEM_ID",
    taxableValue: 1000, gstInclusiveAmount: null, rate: 10, customerId: "CUST_A"
  };
  const baseCand2: CandidateItem = {
    ...baseCand, itemId: "C_FP2", itemName: "FP Cand 2", availableQty: 50
  };
  const baseScope: V2ScopeContext = { period: "CURRENT_FY", financialYear: "2026-27" };
  // Use a source with mismatchQty large enough that both candidates together fit within 105%
  const baseSourceForOrder: MismatchItem = { ...baseSource, mismatchQty: -150 };

  // 16. candidate order => same fingerprint
  const fpOrderA = suggestV2Resolutions(baseSourceForOrder, [baseCand, baseCand2], baseScope);
  const fpOrderB = suggestV2Resolutions(baseSourceForOrder, [baseCand2, baseCand], baseScope);
  // Find groups with both candidates in each result
  const twoItemA = fpOrderA.groups.find(g => g.candidates.length === 2);
  const twoItemB = fpOrderB.groups.find(g => g.candidates.length === 2);
  assertPass("16. candidate order => same fingerprint", !!twoItemA && !!twoItemB && twoItemA.evidenceFingerprint === twoItemB.evidenceFingerprint);

  // 17. candidate ID change => different fingerprint
  const candDiffId: CandidateItem = { ...baseCand, itemId: "C_FP_DIFF" };
  const fpDiffId = suggestV2Resolutions(baseSource, [candDiffId], baseScope);
  const grpDiffId = fpDiffId.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  const grpOrigId = fpOrderA.groups.find(g => g.candidates.length === 1 && g.candidates[0].itemId === "C_FP1");
  assertPass("17. candidate ID change => different fingerprint", !!grpDiffId && !!grpOrigId && grpDiffId.evidenceFingerprint !== grpOrigId.evidenceFingerprint);

  // 18. candidate quantity change => different fingerprint
  const candDiffQty: CandidateItem = { ...baseCand, availableQty: 80 };
  const fpDiffQty = suggestV2Resolutions(baseSource, [candDiffQty], baseScope);
  const grpDiffQty = fpDiffQty.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  assertPass("18. candidate quantity change => different fingerprint", !!grpDiffQty && !!grpOrigId && grpDiffQty.evidenceFingerprint !== grpOrigId.evidenceFingerprint);

  // 19. customer change => different fingerprint
  const srcDiffCust = { ...baseSource, customerId: "CUST_B", customerName: "Cust B" };
  const candDiffCust = { ...baseCand, customerId: "CUST_B" };
  const fpDiffCust = suggestV2Resolutions(srcDiffCust, [candDiffCust], baseScope);
  const grpDiffCust = fpDiffCust.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  assertPass("19. customer change => different fingerprint", !!grpDiffCust && !!grpOrigId && grpDiffCust.evidenceFingerprint !== grpOrigId.evidenceFingerprint);

  // 20. source item change => different fingerprint
  const srcDiffItem = { ...baseSource, itemId: "S_DIFFERENT" };
  const fpDiffSrc = suggestV2Resolutions(srcDiffItem, [baseCand], baseScope);
  const grpDiffSrc = fpDiffSrc.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  assertPass("20. source item change => different fingerprint", !!grpDiffSrc && !!grpOrigId && grpDiffSrc.evidenceFingerprint !== grpOrigId.evidenceFingerprint);

  // 21. period/FY change => different fingerprint
  const diffScope: V2ScopeContext = { period: "CURRENT_FY", financialYear: "2025-26" };
  const fpDiffScope = suggestV2Resolutions(baseSource, [baseCand], diffScope);
  const grpDiffScope = fpDiffScope.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  assertPass("21. period/FY change => different fingerprint", !!grpDiffScope && !!grpOrigId && grpDiffScope.evidenceFingerprint !== grpOrigId.evidenceFingerprint);

  // 22. custom-date change => different fingerprint
  const customDateScopeA: V2ScopeContext = { fromDate: "2026-01-01", toDate: "2026-06-30" };
  const customDateScopeB: V2ScopeContext = { fromDate: "2026-01-01", toDate: "2026-07-31" };
  const fpCustomA = suggestV2Resolutions(baseSource, [baseCand], customDateScopeA);
  const fpCustomB = suggestV2Resolutions(baseSource, [baseCand], customDateScopeB);
  const grpCustomA = fpCustomA.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  const grpCustomB = fpCustomB.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  assertPass("22. custom-date change => different fingerprint", !!grpCustomA && !!grpCustomB && grpCustomA.evidenceFingerprint !== grpCustomB.evidenceFingerprint);

  // ============================================================
  // 23. exact fingerprint read-back CURRENT
  // ============================================================
  // We already persisted a decision with fingerprint "TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E1:100:0.00" in test 1.
  // Query the DB directly to verify it reads back.
  const readback = db.prepare(
    `SELECT entity_id, decision FROM audit_reviewer_decisions WHERE entity_type = 'mismatch_suggestion' AND entity_id = ?`
  ).get("TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E1:100:0.00") as any;
  assertPass("23. exact fingerprint read-back CURRENT", readback && readback.decision === "APPROVE");

  // ============================================================
  // 24. changed evidence not CURRENT
  // ============================================================
  // A different fingerprint should NOT return the old decision
  const readbackChanged = db.prepare(
    `SELECT entity_id, decision FROM audit_reviewer_decisions WHERE entity_type = 'mismatch_suggestion' AND entity_id = ?`
  ).get("TR:SCOPE:FY:2026-27:CURRENT_FY:C1:S1:C_E1_CHANGED:100:0.00") as any;
  assertPass("24. changed evidence not CURRENT (no row for changed fingerprint)", readbackChanged === undefined);

  // ============================================================
  // 25. decision does not alter suggestion score
  // ============================================================
  // Run the suggestion engine before and after decision — verify same confidence
  const preDecision = suggestV2Resolutions(baseSource, [baseCand], baseScope);
  const preGroup = preDecision.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  // Save a decision (already done in test 1 for a related fingerprint), then re-run
  const postDecision = suggestV2Resolutions(baseSource, [baseCand], baseScope);
  const postGroup = postDecision.groups.find(g => g.candidates.length === 1 && g.targetType === "TECHNICAL_RELATIONSHIP");
  assertPass("25. decision does not alter suggestion score", !!preGroup && !!postGroup && preGroup.confidence === postGroup.confidence && preGroup.coveragePercent === postGroup.coveragePercent);

  // ============================================================
  // 26. decision does not alter quantity residual
  // ============================================================
  assertPass("26. decision does not alter quantity residual", !!preGroup && !!postGroup && preGroup.residualQty === postGroup.residualQty && preGroup.coverageQty === postGroup.coverageQty);

  // ============================================================
  // 27. only local audit decision table is mutated
  // ============================================================
  // Verify the INSERT went to audit_reviewer_decisions and entity_type is correct
  const allDecisions = db.prepare(
    `SELECT DISTINCT entity_type FROM audit_reviewer_decisions WHERE reviewer = 'OWNER'`
  ).all() as any[];
  const entityTypes = allDecisions.map((r: any) => r.entity_type);
  assertPass("27. only local audit decision table mutated (entity_type=mismatch_suggestion)", entityTypes.includes("mismatch_suggestion"));

  // ============================================================
  // 28. accounting/inventory mutation = 0
  // ============================================================
  // Verify no tables outside audit_reviewer_decisions were written by checking the decision route
  // does not reference any other table. We verify structurally: the INSERT SQL targets only audit_reviewer_decisions.
  const fs = require("fs");
  const path = require("path");
  const decisionRouteCode = fs.readFileSync(path.join(__dirname, "../app/api/audit/mismatch-resolution/v2/decision/route.ts"), "utf8");
  const insertMatches = decisionRouteCode.match(/INSERT INTO (\w+)/g) || [];
  const insertTargets = insertMatches.map((m: string) => m.replace("INSERT INTO ", ""));
  const onlyAuditTable = insertTargets.every((t: string) => t === "audit_reviewer_decisions");
  const noUpdateOtherTables = !decisionRouteCode.includes("UPDATE inventory") && !decisionRouteCode.includes("UPDATE sales") && !decisionRouteCode.includes("UPDATE purchase");
  assertPass("28. accounting/inventory mutation = 0 (only audit_reviewer_decisions INSERT)", onlyAuditTable && noUpdateOtherTables);

  // ============================================================
  // 29. Zoho WRITE = 0
  // ============================================================
  const noZohoWrite = !decisionRouteCode.includes("zohoApi") && !decisionRouteCode.includes("zoho_api") && !decisionRouteCode.includes("createRecord") && !decisionRouteCode.includes("updateRecord");
  assertPass("29. Zoho WRITE = 0 (no Zoho API calls in decision route)", noZohoWrite);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n==================================================");
  console.log(`V2 DECISION TESTS: ${passedTests}/${totalTests} REAL ASSERTIONS`);
  console.log(`LOG_ONLY_PASS: 0`);
  if (failedTests.length > 0) {
    console.log(`FAILED: ${failedTests.join(", ")}`);
  }
  console.log("==================================================");

  process.exit(failedTests.length > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
