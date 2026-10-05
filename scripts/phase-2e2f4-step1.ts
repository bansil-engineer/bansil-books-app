import { getAuditDatabase } from "../app/lib/db/audit-database";

function main() {
  const db = getAuditDatabase();
  
  const selectedRun = 'bank_source_recovery_1789801003182';
  const targetPayments = [
    '3166667000018529068',
    '3166667000019210027',
    '3166667000019210092',
    '3166667000019210139'
  ];

  console.log("## 7. TARGET PAYMENT CANDIDATE RE-RUN");

  for (const pid of targetPayments) {
    const payment = db.prepare(`SELECT amount, reference_number, paid_through_account_id, date FROM audit_zoho_vendor_payments WHERE payment_id = ?`).get(pid) as any;
    if (!payment) {
      console.log(`Payment ${pid} not found.`);
      continue;
    }

    // ALL snapshots query (the incorrect old way)
    const oldCandidates = db.prepare(`
      SELECT * FROM audit_zoho_bank_transactions
      WHERE account_id = ?
        AND date >= date(?, '-5 days')
        AND date <= date(?, '+5 days')
    `).all(payment.paid_through_account_id, payment.date, payment.date) as any[];

    const exactOld = oldCandidates.filter(c => payment.reference_number && c.reference_number && c.reference_number.includes(payment.reference_number));

    // FROZEN snapshot query
    const frozenCandidates = db.prepare(`
      SELECT * FROM audit_zoho_bank_transactions
      WHERE account_id = ?
        AND source_run_id = ?
        AND date >= date(?, '-5 days')
        AND date <= date(?, '+5 days')
    `).all(payment.paid_through_account_id, selectedRun, payment.date, payment.date) as any[];

    const exactFrozen = frozenCandidates.filter(c => payment.reference_number && c.reference_number && c.reference_number.includes(payment.reference_number));
    const amountDateFrozen = frozenCandidates.filter(c => Math.abs(c.amount) === payment.amount && c.date === payment.date);

    console.log(`\nPAYMENT ID: ${pid}`);
    console.log(`PAYMENT AMOUNT: ${payment.amount}`);
    console.log(`BANK SOURCE RUN: ${selectedRun}`);
    console.log(`REFERENCE PRESENT: ${!!payment.reference_number ? payment.reference_number : "NO"}`);
    console.log(`EXACT REFERENCE CANDIDATES: ${exactFrozen.length} (Old was ${exactOld.length})`);
    console.log(`ACCOUNT + AMOUNT + DATE CANDIDATES: ${amountDateFrozen.length}`);
    
    // Determine uniqueness and duplication cause
    const uniqueTxns = new Set(frozenCandidates.map(c => c.transaction_id));
    console.log(`TOTAL UNIQUE REAL CANDIDATES: ${uniqueTxns.size}`);

    let duplicationCause = "N/A";
    let finalResult = "NO_MATCH";

    if (exactFrozen.length === 1) {
      finalResult = "CONFIRMED_BANK_REFERENCE";
      if (exactOld.length > 1) {
        duplicationCause = "HISTORICAL_SNAPSHOT_DUPLICATION";
      } else {
        duplicationCause = "UNIQUE_VALID_CANDIDATE";
      }
    } else if (exactFrozen.length > 1) {
      const distinctTxns = new Set(exactFrozen.map(c => c.transaction_id));
      if (distinctTxns.size > 1) {
         duplicationCause = "TRUE_DUPLICATE_REFERENCE";
         finalResult = "AMBIGUOUS";
      } else {
         // Should not happen since source_run_id + transaction_id is unique
         duplicationCause = "HISTORICAL_SNAPSHOT_DUPLICATION (Error in frozen query)";
      }
    } else if (amountDateFrozen.length === 1) {
      finalResult = "CONFIRMED_AMOUNT_DATE_ACCOUNT";
      duplicationCause = "UNIQUE_VALID_CANDIDATE";
    } else if (amountDateFrozen.length > 1) {
      finalResult = "AMBIGUOUS";
      duplicationCause = "TRUE_DUPLICATE_AMOUNT_DATE";
    }

    if (frozenCandidates.length > 0 && finalResult === "NO_MATCH") {
      duplicationCause = "NO_VALID_CANDIDATE";
    }

    console.log(`DUPLICATION CAUSE: ${duplicationCause}`);
    console.log(`FINAL BankMatchResult: ${finalResult}`);
  }
}

main();
