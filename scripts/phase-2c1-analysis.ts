import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import fs from "fs";

function runAnalysis() {
  const db = getAuditDatabase();
  console.log("== 13 UNMATCHED BANK-SOURCE RECORDS ==");
  
  // Find the latest successful runs for CoA and Bank Accounts
  const coaRun = db.prepare("SELECT source_run_id FROM audit_zoho_source_runs WHERE source_type = 'chart_of_accounts' AND status = 'SUCCESS' ORDER BY started_at DESC LIMIT 1").get() as any;
  const bankRun = db.prepare("SELECT source_run_id FROM audit_zoho_source_runs WHERE source_type = 'bank_accounts' AND status = 'SUCCESS' ORDER BY started_at DESC LIMIT 1").get() as any;

  if (!coaRun || !bankRun) {
    console.error("Missing successful runs in DB");
    return;
  }

  const unmatchedBanks = db.prepare(`
    SELECT b.* 
    FROM audit_zoho_bank_accounts b
    LEFT JOIN audit_zoho_coa c ON b.account_id = c.account_id AND c.source_run_id = ?
    WHERE b.source_run_id = ? AND c.account_id IS NULL
  `).all(coaRun.source_run_id, bankRun.source_run_id) as any[];

  let categoryCounts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0 };
  let mappingSummary = { EXACT: 30, DETERMINISTIC: 0, CANDIDATE: 0, NOT_REQUIRED: 0, UNRESOLVED: 0 };
  let accountUniverse = { bank: 0, cash: 0, credit_card: 0, payment_clearing: 0, other: 0 };

  const allBanks = db.prepare(`SELECT account_type FROM audit_zoho_bank_accounts WHERE source_run_id = ?`).all(bankRun.source_run_id) as any[];
  for (const b of allBanks) {
    if (accountUniverse.hasOwnProperty(b.account_type)) {
      accountUniverse[b.account_type as keyof typeof accountUniverse]++;
    } else {
      accountUniverse.other++;
    }
  }

  for (const b of unmatchedBanks) {
    console.log(`\nID: ${b.account_id}`);
    console.log(`Name: ${b.account_name}`);
    console.log(`Type: ${b.account_type}`);
    console.log(`Status: ${b.is_active ? 'Active' : 'Inactive'}`);
    
    // Find candidates
    const candidatesByName = db.prepare(`
      SELECT account_id, account_name, account_type 
      FROM audit_zoho_coa 
      WHERE source_run_id = ? AND account_name = ?
    `).all(coaRun.source_run_id, b.account_name) as any[];

    // Heuristics for classification
    let classification = "H. unknown — OWNER review required";
    let candidate = "None";
    let evidence = "None";
    let mappingRequired = "UNKNOWN";

    if (b.account_type === 'cash') {
      classification = "B. cash account representation difference";
      mappingRequired = "YES";
    } else if (b.account_type === 'payment_clearing') {
      classification = "C. payment-clearing representation difference";
      mappingRequired = "NO"; // Often these don't map to a single GL, or are pseudo-accounts
    } else if (b.account_type === 'credit_card') {
      classification = "D. credit-card representation difference";
      mappingRequired = "YES";
    } else if (!b.is_active) {
      classification = "E. inactive/legacy account";
      mappingRequired = "NO";
    }

    if (candidatesByName.length === 1) {
      classification = "F. likely corresponding CoA record under a DIFFERENT ID";
      candidate = `CoA ID ${candidatesByName[0].account_id} (${candidatesByName[0].account_name}, Type: ${candidatesByName[0].account_type})`;
      evidence = "Exact account name match";
      mappingRequired = "YES";
      mappingSummary.CANDIDATE++;
    } else if (candidatesByName.length > 1) {
      classification = "F. likely corresponding CoA record under a DIFFERENT ID";
      candidate = "Multiple exact name matches";
      evidence = "Ambiguous exact account name match";
      mappingRequired = "YES";
      mappingSummary.UNRESOLVED++;
    } else {
      if (classification.startsWith("H")) {
        mappingSummary.UNRESOLVED++;
      } else if (mappingRequired === "NO") {
        mappingSummary.NOT_REQUIRED++;
      } else {
        mappingSummary.UNRESOLVED++;
      }
    }

    console.log(`Classification: ${classification}`);
    console.log(`Mapping required?: ${mappingRequired}`);
    console.log(`Candidate CoA if deterministic: ${candidate}`);
    console.log(`Evidence: ${evidence}`);
  }

  console.log("\n== H. Mapping Summary ==");
  console.log(`EXACT: ${mappingSummary.EXACT}`);
  console.log(`DETERMINISTIC: ${mappingSummary.DETERMINISTIC}`);
  console.log(`CANDIDATE: ${mappingSummary.CANDIDATE}`);
  console.log(`NOT_REQUIRED: ${mappingSummary.NOT_REQUIRED}`);
  console.log(`UNRESOLVED: ${mappingSummary.UNRESOLVED}`);
  
  console.log("\n== J. Persisted Account-Type Universe ==");
  console.log(`BANK: ${accountUniverse.bank}`);
  console.log(`CASH: ${accountUniverse.cash}`);
  console.log(`CREDIT_CARD: ${accountUniverse.credit_card}`);
  console.log(`PAYMENT_CLEARING: ${accountUniverse.payment_clearing}`);
  console.log(`OTHER: ${accountUniverse.other}`);
  
  // Also check mapping table readiness
  console.log("\n== I. Mapping Table Readiness ==");
  const schemaRows = db.prepare("PRAGMA table_info(audit_bank_coa_mappings)").all() as any[];
  console.log("audit_bank_coa_mappings columns:");
  schemaRows.forEach(r => console.log(`- ${r.name} (${r.type})`));
}

runAnalysis();
