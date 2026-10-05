// ============================================================
// Bansil Books Analytics — Phase 4B: Tender/RFQ Document Intake Tests
// Real assertions for intake pipeline, revision incrementing, SHA-256
// hashing, format rejection, and database persistence without AI/OCR.
//
// Safety: operational DBs are opened READ-ONLY only; their SHA-256 is
// recorded before/after and must be unchanged.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";

process.env.AI_WORKSPACE_DB_PATH = path.join(
  os.tmpdir(),
  `phase4b_isolated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`,
);
process.env.ESTIMATION_DB_PATH = path.join(
  os.tmpdir(),
  `phase4b_estimation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sqlite`,
);

const ROOT = process.cwd();
const OP_DBS = ["ai_workspace.db", "bansil_books.db", "audit_workspace.db"].map((f) => path.join(ROOT, "data", f));
const hashFile = (p: string) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const opHashesBefore = OP_DBS.map(hashFile);

type T = () => void | Promise<void>;
const tests: Array<{ name: string; fn: T }> = [];
const test = (name: string, fn: T) => tests.push({ name, fn });

async function main() {
  const { intakeEstimationDocument, getEstimationDocumentsForProject } = await import("../app/lib/ai/estimation/intake.ts");
  const { fingerprintContent, selectCurrentRevision } = await import("../app/lib/ai/estimation/evidence.ts");

  test("01 Intake rejects unsupported formats", () => {
    const resWord = intakeEstimationDocument("PROJ-1", "BOQ", "BOQ", "tender.docx", Buffer.from("data"));
    assert.strictEqual(resWord.success, false);
    assert.strictEqual(resWord.error, "UNSUPPORTED_FORMAT");
    assert.ok(resWord.violations?.includes("ONLY_PDF_XLSX_CSV_SUPPORTED"));

    const resImg = intakeEstimationDocument("PROJ-1", "BOQ", "BOQ", "diagram.png", Buffer.from("data"));
    assert.strictEqual(resImg.success, false);
  });

  test("02 Intake stores PDF correctly", () => {
    const data = Buffer.from("mock pdf data");
    const res = intakeEstimationDocument("PROJ-1", "TENDER_DOC", "TENDER", "specs.pdf", data);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.document!.projectId, "PROJ-1");
    assert.strictEqual(res.document!.format, "PDF");
    assert.strictEqual(res.document!.revision, 0);
    assert.strictEqual(res.document!.status, "CURRENT");
    assert.strictEqual(res.document!.sha256, fingerprintContent(data));
  });

  test("03 Revisions are incremented correctly and old docs are superseded", () => {
    const data1 = Buffer.from("boq v1");
    const res1 = intakeEstimationDocument("PROJ-2", "BOQ", "BOQ", "boq.xlsx", data1);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.document!.revision, 0);

    const data2 = Buffer.from("boq v2");
    const res2 = intakeEstimationDocument("PROJ-2", "BOQ", "BOQ", "boq_rev1.xlsx", data2, "Rev 1");
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.document!.revision, 1);
    assert.strictEqual(res2.document!.revisionLabel, "Rev 1");

    const docs = getEstimationDocumentsForProject("PROJ-2");
    assert.strictEqual(docs.length, 2);

    const doc0 = docs.find(d => d.revision === 0)!;
    const doc1 = docs.find(d => d.revision === 1)!;

    assert.strictEqual(doc0.status, "SUPERSEDED");
    assert.strictEqual(doc0.supersededByDocumentId, doc1.documentId);

    assert.strictEqual(doc1.status, "CURRENT");
    assert.strictEqual(doc1.supersededByDocumentId, null);

    const currentBoq = selectCurrentRevision(docs, "BOQ");
    assert.strictEqual(currentBoq?.documentId, doc1.documentId);
  });

  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ❌ ${t.name}\n     ${(e as Error).message}`);
    }
  }

  const opHashesAfter = OP_DBS.map(hashFile);
  const dbSafe = opHashesBefore.every((h, i) => h === opHashesAfter[i]);
  OP_DBS.forEach((p, i) => console.log(`  ${opHashesBefore[i] === opHashesAfter[i] ? "🔒" : "⚠️"} ${path.basename(p)} ${opHashesBefore[i]?.slice(0, 16) ?? "absent"} → ${opHashesAfter[i]?.slice(0, 16) ?? "absent"}`));
  if (!dbSafe) { failed++; console.log("  ❌ OPERATIONAL DB HASH CHANGED"); } else { passed++; console.log("  ✅ Operational DB hashes unchanged"); }

  try { fs.rmSync(process.env.ESTIMATION_DB_PATH!, { force: true }); } catch { /* temp */ }

  console.log(`\nPhase 4B Tender Intake: ${passed} passed / ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
