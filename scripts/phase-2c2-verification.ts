import { openAuditDatabaseAt, getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { getValidAccessToken } from "../app/lib/zoho-api.ts";
import fs from "fs";
import { listBankAccountTransactions } from "../app/lib/audit/accounts/zoho-read-source.ts";

async function verifyMigrationAndData() {
  const db = getAuditDatabase();
  console.log("== 2. VERIFY REAL PHASE 2C.1 MIGRATION RESULT ==");
  
  const schemaRows = db.prepare("SELECT sql, name FROM sqlite_master WHERE type='table' AND name IN ('audit_zoho_coa', 'audit_zoho_bank_accounts', 'audit_zoho_bank_transactions', 'audit_bank_coa_mappings')").all() as any[];
  
  for (const row of schemaRows) {
    let action = "CASCADE (UNSAFE)";
    if (row.sql.includes('ON DELETE RESTRICT')) action = "RESTRICT";
    else if (row.sql.includes('ON DELETE NO ACTION')) action = "NO ACTION";
    else if (!row.sql.includes('ON DELETE')) action = "DEFAULT (RESTRICT)";
    
    console.log(`${row.name.toUpperCase()} FK DELETE ACTION: ${action}`);
  }
  
  console.log("\n== 3. VERIFY SOURCE-RUN MIGRATION PRESERVED DATA ==");
  const counts = {
    coa: (db.prepare("SELECT count(*) as c FROM audit_zoho_coa").get() as any).c,
    bank: (db.prepare("SELECT count(*) as c FROM audit_zoho_bank_accounts").get() as any).c,
    tx: (db.prepare("SELECT count(*) as c FROM audit_zoho_bank_transactions").get() as any).c,
    runs: (db.prepare("SELECT count(*) as c FROM audit_zoho_source_runs").get() as any).c
  };
  
  console.log(`CoA count: ${counts.coa}`);
  console.log(`Bank count: ${counts.bank}`);
  console.log(`Tx count: ${counts.tx}`);
  console.log(`Runs count: ${counts.runs}`);
  console.log(`DATA LOSS DETECTED: ${counts.coa === 0 ? 'YES' : 'NO'}`);

  console.log("\n== 7. SAMPLE CASH TRANSACTION READ PROBE ==");
  const activeCash = db.prepare("SELECT account_id FROM audit_zoho_bank_accounts WHERE account_type = 'cash' AND is_active = 1 LIMIT 1").get() as any;
  if (!activeCash) {
    const inactiveCash = db.prepare("SELECT account_id FROM audit_zoho_bank_accounts WHERE account_type = 'cash' LIMIT 1").get() as any;
    if (inactiveCash) {
       console.log(`No active cash account, testing with inactive ${inactiveCash.account_id}`);
       try {
         const { store } = await getValidAccessToken();
         const res = await listBankAccountTransactions(store.organization_id || "774390949", inactiveCash.account_id, { per_page: 5 });
         console.log(`CASH TRANSACTION READ: AVAILABLE`);
         console.log(`Count: ${res.transactions.length}`);
         const types = [...new Set(res.transactions.map(t => t.transaction_type))];
         const statuses = [...new Set(res.transactions.map(t => t.status))];
         console.log(`Transaction Types: ${types.join(', ')}`);
         console.log(`Statuses: ${statuses.join(', ')}`);
       } catch (e: any) {
         console.log(`CASH TRANSACTION READ: BLOCKED (${e.message})`);
       }
    } else {
      console.log(`CASH TRANSACTION READ: NO RECORDS (No cash accounts found)`);
    }
  } else {
    try {
      const { store } = await getValidAccessToken();
      const res = await listBankAccountTransactions(store.organization_id || "774390949", activeCash.account_id, { per_page: 5 });
      console.log(`CASH TRANSACTION READ: AVAILABLE`);
      console.log(`Count: ${res.transactions.length}`);
      if (res.transactions.length > 0) {
        const types = [...new Set(res.transactions.map(t => t.transaction_type))];
        const statuses = [...new Set(res.transactions.map(t => t.status))];
        console.log(`Transaction Types: ${types.join(', ')}`);
        console.log(`Statuses: ${statuses.join(', ')}`);
      } else {
        console.log(`CASH TRANSACTION READ: NO RECORDS in account`);
      }
    } catch (e: any) {
      console.log(`CASH TRANSACTION READ: BLOCKED (${e.message})`);
    }
  }
}

verifyMigrationAndData().catch(console.error);
